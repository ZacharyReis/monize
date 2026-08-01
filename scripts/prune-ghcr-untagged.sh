#!/usr/bin/env bash
# Prune orphaned, untagged GHCR manifests for the Monize container packages.
#
# Why this exists: the CI publishes moving tags (`:latest`, `:beta`,
# `:pr-<n>`). Every time one of those tags is re-pointed at a new digest, the
# digest it used to point at loses its tag and becomes a dangling, SHA-only
# manifest. Per-PR builds (`:pr-<n>` is force-moved on every push to a PR) and
# the `:beta` tag (moved on every merge to main) generate these by the dozen.
# GHCR never garbage-collects them, so they accumulate indefinitely.
#
# The hard part is doing this SAFELY. Not every untagged manifest is garbage:
#
#   1. Platform children -- a multi-arch tag (`:latest`, `:beta`) is an image
#      INDEX that references one untagged child manifest per platform
#      (amd64/arm64). Those children are untagged by nature but are still in
#      use; deleting one breaks the tag on that architecture.
#   2. Attestation manifests -- the signed release build attaches provenance
#      and SBOM attestations. buildx stores them as extra (untagged) entries
#      inside the image index; `attest-sbom` may also push them as OCI
#      referrers. Deleting them breaks `gh attestation verify` / `cosign`.
#
# So we cannot "delete all untagged". Instead we build a KEEP set of every
# digest that a live tag still references -- the tag's own digest, its platform
# children, and any OCI referrers of those -- and only delete untagged
# manifests that are NOT in the keep set AND older than a grace window (which
# protects an in-flight multi-arch push whose index tag has not landed yet).
#
# The script FAILS CLOSED: if it cannot resolve a tagged manifest (auth or
# network error), it aborts rather than risk deleting a referenced child.
#
# Usage (all inputs via env):
#   OWNER            GHCR namespace owner            (default: kenlasko)
#   PACKAGES         space-separated package names   (default: the two images)
#   GRACE_DAYS       don't delete anything newer     (default: 7)
#   DRY_RUN          "true" logs only, "false" deletes (default: true)
#   GH_API_TOKEN     token for the GitHub REST API (list + delete versions)
#   REGISTRY_TOKEN   token for ghcr.io manifest reads (default: GH_API_TOKEN)
#
# Requires: bash, curl, jq, GNU date, base64.

set -euo pipefail

OWNER="${OWNER:-kenlasko}"
PACKAGES="${PACKAGES:-monize-backend monize-frontend}"
GRACE_DAYS="${GRACE_DAYS:-7}"
DRY_RUN="${DRY_RUN:-true}"
GH_API_TOKEN="${GH_API_TOKEN:?GH_API_TOKEN is required}"
REGISTRY_TOKEN="${REGISTRY_TOKEN:-$GH_API_TOKEN}"

API="https://api.github.com"
REG="https://ghcr.io"

cutoff_epoch="$(date -u -d "${GRACE_DAYS} days ago" +%s)"

# Manifest Accept headers: match an OCI/Docker index (list) or a plain manifest
# so the registry returns whichever the tag actually points at.
MANIFEST_ACCEPT=(
  -H "Accept: application/vnd.oci.image.index.v1+json"
  -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json"
  -H "Accept: application/vnd.oci.image.manifest.v1+json"
  -H "Accept: application/vnd.docker.distribution.manifest.v2+json"
)

# GitHub REST helper (list/delete package versions).
gh_api() {
  curl -fsSL \
    -H "Authorization: Bearer ${GH_API_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

total_deleted=0
total_kept=0

for PKG in ${PACKAGES}; do
  echo "::group::Package ${OWNER}/${PKG}"

  # A pull-scoped registry bearer for this package. The token endpoint is the
  # officially supported exchange (a plain base64 of the PAT is fragile). If
  # this fails we cannot resolve manifests safely, so let the -f abort us.
  reg_bearer="$(
    curl -fsSL -u "${OWNER}:${REGISTRY_TOKEN}" \
      "${REG}/token?service=ghcr.io&scope=repository:${OWNER}/${PKG}:pull" |
      jq -r '.token'
  )"

  # Fetch every version (paginated) as JSONL: one compact object per line.
  versions_file="$(mktemp)"
  page=1
  while :; do
    resp="$(gh_api "${API}/users/${OWNER}/packages/container/${PKG}/versions?per_page=100&page=${page}")"
    count="$(printf '%s' "${resp}" | jq 'length')"
    [ "${count}" -eq 0 ] && break
    printf '%s' "${resp}" | jq -c '.[]' >>"${versions_file}"
    page=$((page + 1))
  done
  echo "Found $(wc -l <"${versions_file}" | tr -d ' ') versions"

  # Resolve the digests referenced by a manifest index (platform children plus
  # buildx attestation manifests). Aborts the run on fetch failure.
  resolve_children() {
    local digest="$1" body
    if ! body="$(curl -fsSL \
      -H "Authorization: Bearer ${reg_bearer}" \
      "${MANIFEST_ACCEPT[@]}" \
      "${REG}/v2/${OWNER}/${PKG}/manifests/${digest}")"; then
      echo "::error::Cannot fetch manifest ${digest} for ${PKG}; aborting to avoid unsafe deletion" >&2
      return 1
    fi
    printf '%s' "${body}" | jq -r 'if .manifests then .manifests[].digest else empty end'
  }

  # Resolve OCI referrers (external attestations/signatures). Best-effort: a
  # missing referrers API or empty result is fine and never aborts.
  resolve_referrers() {
    local digest="$1" body
    if body="$(curl -fsSL \
      -H "Authorization: Bearer ${reg_bearer}" \
      -H "Accept: application/vnd.oci.image.index.v1+json" \
      "${REG}/v2/${OWNER}/${PKG}/referrers/${digest}" 2>/dev/null)"; then
      printf '%s' "${body}" | jq -r 'if .manifests then .manifests[].digest else empty end'
    fi
  }

  # Build the keep set from every TAGGED version.
  keep_file="$(mktemp)"
  tagged_digests="$(jq -rs '.[] | select(((.metadata.container.tags // []) | length) > 0) | .name' "${versions_file}")"
  while IFS= read -r d; do
    [ -z "${d}" ] && continue
    echo "${d}" >>"${keep_file}"
    children="$(resolve_children "${d}")" || exit 1
    if [ -n "${children}" ]; then
      echo "${children}" >>"${keep_file}"
      while IFS= read -r c; do
        [ -z "${c}" ] && continue
        resolve_referrers "${c}" >>"${keep_file}" || true
      done <<<"${children}"
    fi
    resolve_referrers "${d}" >>"${keep_file}" || true
  done <<<"${tagged_digests}"
  sort -u "${keep_file}" -o "${keep_file}"
  echo "Keep set (digests referenced by a live tag): $(wc -l <"${keep_file}" | tr -d ' ')"

  # Delete untagged versions that are neither referenced nor within the grace
  # window. Tagged versions are never touched.
  while IFS= read -r row; do
    tags_len="$(printf '%s' "${row}" | jq '(.metadata.container.tags // []) | length')"
    [ "${tags_len}" -gt 0 ] && continue

    digest="$(printf '%s' "${row}" | jq -r '.name')"
    vid="$(printf '%s' "${row}" | jq -r '.id')"
    created="$(printf '%s' "${row}" | jq -r '.created_at')"
    created_epoch="$(date -u -d "${created}" +%s)"

    if grep -qxF "${digest}" "${keep_file}"; then
      total_kept=$((total_kept + 1))
      continue
    fi
    if [ "${created_epoch}" -ge "${cutoff_epoch}" ]; then
      echo "SKIP within ${GRACE_DAYS}d grace: ${digest} (${created})"
      total_kept=$((total_kept + 1))
      continue
    fi

    if [ "${DRY_RUN}" = "true" ]; then
      echo "DRY-RUN would delete untagged ${digest} id=${vid} (${created})"
    else
      echo "DELETE untagged ${digest} id=${vid} (${created})"
      gh_api -X DELETE \
        "${API}/users/${OWNER}/packages/container/${PKG}/versions/${vid}"
    fi
    total_deleted=$((total_deleted + 1))
  done <"${versions_file}"

  rm -f "${versions_file}" "${keep_file}"
  echo "::endgroup::"
done

echo "Summary: pruned=${total_deleted} kept=${total_kept} dry_run=${DRY_RUN}"
if [ "${DRY_RUN}" = "true" ]; then
  echo "Dry-run only -- nothing was deleted. Re-run with DRY_RUN=false to prune."
fi
