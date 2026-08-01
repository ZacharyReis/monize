# Monize Helm Chart

A Helm chart for deploying the Monize personal finance application on Kubernetes.

## Architecture

Monize is a two-tier application:
- **Backend**: Node.js API server (port 3001) connected to a PostgreSQL database
- **Frontend**: Web application (port 3000) that communicates with the backend internally

Only the frontend is exposed externally via HTTPRoute or Ingress. The backend is accessible only within the cluster.

## Prerequisites

- Kubernetes 1.27+
- Helm 3.x
- Either a Gateway API implementation (e.g., Cilium) **or** an Ingress controller

## Installation

```bash
# Install with default values (HTTPRoute enabled)
helm install monize ./helm/monize -n monize --create-namespace

# Install with Ingress instead of HTTPRoute
helm install monize ./helm/monize -n monize --create-namespace \
  --set httpRoute.enabled=false \
  --set ingress.enabled=true \
  --set ingress.className=nginx

# Dry-run to preview rendered templates
helm template monize ./helm/monize -n monize
```

## Routing Options

This chart supports two mutually exclusive routing strategies:

### HTTPRoute (Gateway API) - Default

Enabled by default. Uses the Kubernetes Gateway API with a Cilium TLS gateway.

```yaml
httpRoute:
  enabled: true
  parentRefs:
    - name: tls
      namespace: cilium
      sectionName: https
```

### Ingress (Traditional)

For clusters using a traditional Ingress controller (nginx, traefik, etc.):

```yaml
httpRoute:
  enabled: false

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    - secretName: monize-tls
      hosts:
        - monize.yourdomain.com
```

> **Note**: Both can technically be enabled simultaneously, but it is recommended to only enable one.

## Configuration

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Namespace for all resources | `monize` |
| `global.domain` | Application domain | `yourdomain.com` |
| `global.hostname` | Full hostname override | `monize.<domain>` |
| `global.timezone` | Container timezone | `America/Toronto` |
| `global.priorityClassName` | Pod priority class | `low-priority` |

### Namespace

| Parameter | Description | Default |
|-----------|-------------|---------|
| `namespace.create` | Create the namespace | `true` |
| `namespace.podSecurityEnforce` | Pod Security Standard level | `restricted` |

### Backend

| Parameter | Description | Default |
|-----------|-------------|---------|
| `backend.image.registry` | Image registry | `registry.yourdomain.com` |
| `backend.image.repository` | Image repository | `monize/backend` |
| `backend.image.tag` | Image tag | `latest` |
| `backend.image.pullPolicy` | Image pull policy | `Always` |
| `backend.replicas` | Number of replicas | `1` |
| `backend.service.port` | Service port | `3001` |
| `backend.service.type` | Service type | `ClusterIP` |
| `backend.resources` | CPU/memory requests and limits | See values.yaml |
| `backend.securityContext` | Container security context | Restricted (non-root, read-only fs) |
| `backend.livenessProbe` | Liveness probe config | `/api/v1/health/live` |
| `backend.readinessProbe` | Readiness probe config | `/api/v1/health/ready` |
| `backend.env.*` | Backend environment variables | See values.yaml |

### Frontend

| Parameter | Description | Default |
|-----------|-------------|---------|
| `frontend.image.registry` | Image registry | `registry.yourdomain.com` |
| `frontend.image.repository` | Image repository | `monize/frontend` |
| `frontend.image.tag` | Image tag | `latest` |
| `frontend.image.pullPolicy` | Image pull policy | `Always` |
| `frontend.replicas` | Number of replicas | `1` |
| `frontend.service.port` | Service port | `3000` |
| `frontend.service.type` | Service type | `ClusterIP` |
| `frontend.resources` | CPU/memory requests and limits | See values.yaml |
| `frontend.securityContext` | Container security context | Restricted (non-root, read-only fs) |
| `frontend.livenessProbe` | Liveness probe config | `/api/v1/health/live` |
| `frontend.readinessProbe` | Readiness probe config | `/api/v1/health/ready` |
| `frontend.env.*` | Frontend environment variables | See values.yaml |

### Row-Level Security (RLS)

RLS is an optional defense-in-depth layer that enforces per-user data isolation
in the database itself. It is **off by default**; the standard single-role setup
needs no changes here. See `docs/future-plans/row-level-security.md` (design) and
the runbook for the phased rollout.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `backend.rls.RLS_MODE` | `off` \| `shadow` \| `enforce` (rendered into the backend ConfigMap) | `off` |
| `backend.rls.DATABASE_APP_USER` | Name of the unprivileged runtime role (rendered into the ConfigMap) | `monize_app` |

`RLS_MODE` and `DATABASE_APP_USER` are non-secret and go in the
`env-vars-backend` ConfigMap. The role's password, `DATABASE_APP_PASSWORD`, is a
**secret**: supply it the same way as `DATABASE_PASSWORD`, via `backend.extraEnvFrom`
(a `secretRef`) or `backend.extraEnv` (a `valueFrom.secretKeyRef`). Never put it
in `values.yaml`.

**CNPG `DatabaseRole` requirement.** On the CloudNativePG deployment the
database owner (`DATABASE_USER`) is not a superuser and has **no `CREATEROLE`**,
so the application cannot create the `monize_app` role at startup. Provision it
declaratively with the `DatabaseRole` CRD (CloudNativePG **1.30+**), which gives
the role its own object and reconciliation loop rather than nesting it in the
`Cluster` spec's older `managed.roles` stanza:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: DatabaseRole
metadata:
  name: monize-app
  namespace: monize
spec:
  cluster:
    name: home            # your CNPG Cluster name (matches DATABASE_HOST)
  name: monize_app        # must equal backend.rls.DATABASE_APP_USER
  ensure: present
  login: true
  # Leave superuser/bypassrls at their defaults (false): the runtime role must
  # NOT bypass RLS -- that is the whole point of the unprivileged role.
  passwordSecret:
    name: monize-app-role # a kubernetes.io/basic-auth Secret (username+password)
```

The referenced Secret (`kubernetes.io/basic-auth`, keys `username` +
`password`) also feeds `DATABASE_APP_PASSWORD` into the backend -- point
`backend.extraEnv` at its `password` key:

```yaml
backend:
  extraEnv:
    - name: DATABASE_APP_PASSWORD
      valueFrom:
        secretKeyRef:
          name: monize-app-role
          key: password
```

With the role provisioned this way, backend startup skips role creation and only
applies the role's DML grants (idempotently, on every boot).

> On CloudNativePG **older than 1.30** (no `DatabaseRole` CRD), fall back to the
> `Cluster` spec's `spec.managed.roles` stanza with the same
> `name`/`login`/`passwordSecret` fields.

## Security

All containers enforce the `restricted` Pod Security Standard:
- Run as non-root user (UID 1000)
- Read-only root filesystem
- All Linux capabilities dropped
- RuntimeDefault seccomp profile
- No privilege escalation

## Testing

```bash
# Lint the chart
helm lint ./helm/monize

# Render templates without deploying
helm template monize ./helm/monize -n monize

# Dry-run install
helm install monize ./helm/monize -n monize --dry-run

# Test with Ingress instead of HTTPRoute
helm template monize ./helm/monize -n monize \
  --set httpRoute.enabled=false \
  --set ingress.enabled=true \
  --set ingress.className=nginx
```
