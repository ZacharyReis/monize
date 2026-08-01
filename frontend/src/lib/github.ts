/** The project's GitHub repository, used for help links and issue references. */
export const GITHUB_REPO_URL = 'https://github.com/kenlasko/monize';

/**
 * Canonical URL for an issue or pull-request number. GitHub redirects
 * `/issues/<n>` to the pull request when the number is a PR, so one shape
 * covers both -- release notes reference them interchangeably.
 */
export function githubIssueUrl(number: number | string): string {
  return `${GITHUB_REPO_URL}/issues/${number}`;
}
