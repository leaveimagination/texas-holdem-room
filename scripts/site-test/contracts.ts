export const SITE_TEST_PROJECT_PREFIX = "holdem-site-";
export const SITE_TEST_RUN_LABEL = "com.texas-holdem.site-test-run";
export const SITE_TEST_MAX_RUN_ID_LENGTH = 6;

export interface SiteTestRunIdentity {
  runId: string;
  projectName: string;
  runLabel: string;
}

export interface SiteTestPorts {
  app: number;
  postgres: number;
  redis: number;
}

export function sanitizeSiteTestRunId(value: string): string {
  const runId = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (runId.length === 0) {
    throw new Error("A site test run ID must contain at least one safe character (a-z or 0-9)");
  }
  if (runId.length > SITE_TEST_MAX_RUN_ID_LENGTH) {
    throw new Error(`A site test run ID must be at most ${SITE_TEST_MAX_RUN_ID_LENGTH} characters after sanitization`);
  }

  return runId;
}

export function createSiteTestRunIdentity(value: string): SiteTestRunIdentity {
  const runId = sanitizeSiteTestRunId(value);
  return {
    runId,
    projectName: `${SITE_TEST_PROJECT_PREFIX}${runId}`,
    runLabel: runId
  };
}

export class EnvironmentCleanupError extends Error {
  readonly code = "ENVIRONMENT_CLEANUP_FAILURE";
  readonly retained = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvironmentCleanupError";
  }
}
