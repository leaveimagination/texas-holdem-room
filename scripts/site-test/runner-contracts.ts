import { EXPERIENCE_CASES, experienceAttemptIds } from "../../tests/experience/case-catalog";
import type {
  CaseReport,
  EvidenceEvent,
  OverallVerdict,
  RunReport
} from "../../tests/experience/evidence/contracts";
import type { KnownSecret } from "../../tests/experience/evidence/redaction";
import type {
  WriteExperienceReportInput
} from "../../tests/experience/evidence/report-writer";
import type { EvidenceValidationResult } from "../../tests/experience/evidence/validator";
import type { DockerSiteTestStackSnapshot } from "./docker-stack";
import type {
  PlaywrightGroupResult,
  RunPlaywrightGroupInput
} from "./playwright-group";

export const SITE_TEST_HARD_DEADLINE_MS = 30 * 60 * 1_000;
export const SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS = Object.freeze({
  productFailureEvidence: 15_000,
  finalReport: 15_000,
  finalValidation: 30_000,
  dockerDiagnostics: 60_000,
  diagnosticsPersistence: 15_000,
  finalizedPackValidation: 30_000,
  exactCleanup: 120_000,
  cleanupStatusReport: 15_000
});
export const SITE_TEST_FINALIZATION_RESERVE_MS = Object.values(
  SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS
).reduce((total, budget) => total + budget, 0);
export const SITE_TEST_FINALIZATION_REQUIRED_REMAINING_MS = Object.freeze({
  productFailureEvidence: SITE_TEST_FINALIZATION_RESERVE_MS,
  finalReport:
    SITE_TEST_FINALIZATION_RESERVE_MS -
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.productFailureEvidence,
  finalValidation:
    SITE_TEST_FINALIZATION_RESERVE_MS -
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.productFailureEvidence -
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalReport,
  dockerDiagnostics:
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.dockerDiagnostics +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.diagnosticsPersistence +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalizedPackValidation +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.exactCleanup +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.cleanupStatusReport,
  diagnosticsPersistence:
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.diagnosticsPersistence +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalizedPackValidation +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.exactCleanup +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.cleanupStatusReport,
  finalizedPackValidation:
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.finalizedPackValidation +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.exactCleanup +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.cleanupStatusReport,
  exactCleanup:
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.exactCleanup +
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.cleanupStatusReport,
  cleanupStatusReport:
    SITE_TEST_FINALIZATION_STAGE_BUDGETS_MS.cleanupStatusReport
});
export const SITE_TEST_OPERATIONAL_STAGE_BUDGETS_MS = Object.freeze({
  allocation: 10_000,
  browserVersion: 30_000,
  metadata: 30_000,
  imageInspection: 30_000,
  stackStart: 285_000,
  preflight: 30_000,
  playwrightMinimum: 30_000,
  evidenceCollection: 30_000,
  productFailureEvidence: 15_000,
  partialReport: 15_000,
  partialValidation: 30_000
});
export const DEFAULT_SITE_TEST_CASE_IDS = Object.freeze(
  EXPERIENCE_CASES.map(({ caseId }) => caseId)
);
export const SMOKE_CASE_ID = "EXP-010";

const SUPPORTED_ENVIRONMENT_INJECTION = "postgres-health";
const knownCaseIds = new Set(DEFAULT_SITE_TEST_CASE_IDS);

export interface ProductFailureInjection {
  caseId: string;
  attemptId: string;
}

export interface SiteTestSelection {
  caseIds: readonly string[];
  injectProductFailure?: ProductFailureInjection;
  injectEnvironmentFailure?: typeof SUPPORTED_ENVIRONMENT_INJECTION;
}

export interface SiteTestRunContext {
  runId: string;
  rootDirectory: string;
  outputRoot: string;
  caseOutputRoot: string;
  startedAt: string;
  image: string;
  ports: { app: number; postgres: number; redis: number };
  postgresPassword: string;
  isolatedBaseUrl: string;
  redisUrl: string;
  databaseUrl: string;
  smokeBaseUrl: string;
  knownSecrets: readonly KnownSecret[];
}

export interface CollectedCaseEvidence {
  cases: readonly CaseReport[];
  events: readonly EvidenceEvent[];
  issues?: readonly Error[];
}

export interface SiteTestStageControl {
  signal: AbortSignal;
  timeoutMs: number;
}

export interface SiteTestStackHandle {
  readonly runId: string;
  readonly projectName: string;
  readonly snapshot?: DockerSiteTestStackSnapshot;
  start(control: SiteTestStageControl): Promise<DockerSiteTestStackSnapshot>;
  collectDiagnostics(control: SiteTestStageControl): Promise<string>;
  stop(control: SiteTestStageControl): Promise<void>;
}

export interface SiteTestDiagnostics {
  imageId?: string;
  docker?: string;
  playwright: Array<{
    caseIds: readonly string[];
    result: PlaywrightGroupResult;
  }>;
  issues: string[];
}

export interface SiteTestRunnerDependencies {
  withDeadline<T>(
    timeoutMs: number,
    task: (signal: AbortSignal, remainingMs: () => number) => Promise<T>
  ): Promise<T>;
  allocateRun(
    selection: SiteTestSelection,
    control: SiteTestStageControl
  ): Promise<SiteTestRunContext>;
  inspectBrowserVersion(
    context: SiteTestRunContext,
    control: SiteTestStageControl
  ): Promise<string>;
  writeMetadata(
    context: SiteTestRunContext,
    selection: SiteTestSelection,
    chromiumVersion: string,
    control: SiteTestStageControl
  ): Promise<void>;
  inspectImage(
    context: SiteTestRunContext,
    control: SiteTestStageControl
  ): Promise<string>;
  createStack(context: SiteTestRunContext): SiteTestStackHandle;
  preflight(
    context: SiteTestRunContext,
    stack: SiteTestStackHandle,
    injection: SiteTestSelection["injectEnvironmentFailure"],
    control: SiteTestStageControl
  ): Promise<void>;
  runPlaywrightGroup(input: RunPlaywrightGroupInput): Promise<PlaywrightGroupResult>;
  collectCaseEvidence(
    context: SiteTestRunContext,
    caseIds: readonly string[],
    control: SiteTestStageControl
  ): Promise<CollectedCaseEvidence>;
  injectProductFailure(
    context: SiteTestRunContext,
    evidence: CollectedCaseEvidence,
    injection: ProductFailureInjection,
    control: SiteTestStageControl
  ): Promise<CollectedCaseEvidence>;
  writeReport(
    input: WriteExperienceReportInput,
    control: SiteTestStageControl
  ): Promise<RunReport>;
  validateEvidence(
    outputRoot: string,
    knownSecrets: readonly KnownSecret[],
    phase: "isolated" | "final" | "finalized-pack",
    control: SiteTestStageControl
  ): Promise<EvidenceValidationResult>;
  persistDiagnostics(
    context: SiteTestRunContext,
    diagnostics: SiteTestDiagnostics,
    control: SiteTestStageControl
  ): Promise<void>;
  now(): string;
}

export interface RunFullSiteTestOptions {
  selection: SiteTestSelection;
  dependencies: SiteTestRunnerDependencies;
}

export interface SiteTestRunResult {
  exitCode: 0 | 1 | 2;
  verdict: OverallVerdict;
  outputRoot?: string;
  report?: RunReport;
}

export class EnvironmentStageError extends Error {
  constructor(message: string, readonly stage: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EnvironmentStageError";
  }
}

export class HarnessStageError extends Error {
  constructor(message: string, readonly stage: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HarnessStageError";
  }
}

export class OverallDeadlineError extends HarnessStageError {
  constructor(readonly timeoutMs: number) {
    super(`Full site test exceeded its ${timeoutMs}ms hard deadline`, "overall-deadline");
    this.name = "OverallDeadlineError";
  }
}

export function parseSiteTestArguments(args: readonly string[]): SiteTestSelection {
  let filteredCaseIds: string[] | undefined;
  let productInjection: ProductFailureInjection | undefined;
  let environmentInjection: SiteTestSelection["injectEnvironmentFailure"];

  for (const argument of args) {
    if (argument.startsWith("--cases=")) {
      if (filteredCaseIds !== undefined) {
        throw new Error("The --cases option may be supplied only once");
      }
      filteredCaseIds = argument.slice("--cases=".length).split(",");
      if (filteredCaseIds.some((caseId) => caseId.length === 0)) {
        throw new Error("The --cases option requires a comma-separated list of case IDs");
      }
      continue;
    }
    if (argument.startsWith("--inject-product-failure=")) {
      if (productInjection !== undefined) {
        throw new Error("The product failure injection may be supplied only once");
      }
      const coordinate = argument.slice("--inject-product-failure=".length);
      const parts = coordinate.split("/");
      if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
        throw new Error("Product failure injection must use CASE-ID/ATTEMPT-ID");
      }
      productInjection = { caseId: parts[0], attemptId: parts[1] };
      continue;
    }
    if (argument.startsWith("--inject-environment-failure=")) {
      const stage = argument.slice("--inject-environment-failure=".length);
      if (stage !== SUPPORTED_ENVIRONMENT_INJECTION) {
        throw new Error(`Unsupported environment failure injection: ${stage}`);
      }
      if (environmentInjection !== undefined) {
        throw new Error("The environment failure injection may be supplied only once");
      }
      environmentInjection = stage;
      continue;
    }
    throw new Error(`Unknown site test argument: ${argument}`);
  }

  const caseIds = filteredCaseIds ?? [...DEFAULT_SITE_TEST_CASE_IDS];
  const seen = new Set<string>();
  for (const caseId of caseIds) {
    if (!knownCaseIds.has(caseId)) {
      throw new Error(`Unknown experience case: ${caseId}`);
    }
    if (seen.has(caseId)) {
      throw new Error(`Duplicate experience case: ${caseId}`);
    }
    seen.add(caseId);
  }
  if (productInjection !== undefined) {
    if (!knownCaseIds.has(productInjection.caseId)) {
      throw new Error(`Unknown experience case: ${productInjection.caseId}`);
    }
    const attempts: readonly string[] = experienceAttemptIds(productInjection.caseId);
    if (!attempts.includes(productInjection.attemptId)) {
      throw new Error(
        `Unknown experience attempt: ${productInjection.caseId}/${productInjection.attemptId}`
      );
    }
    if (!seen.has(productInjection.caseId)) {
      throw new Error("The injected product-failure case must be selected by --cases");
    }
  }
  if (productInjection !== undefined && environmentInjection !== undefined) {
    throw new Error("Product and environment failure injections are mutually exclusive");
  }

  return {
    caseIds: Object.freeze([...caseIds]),
    injectProductFailure: productInjection,
    injectEnvironmentFailure: environmentInjection
  };
}

export function exitCodeForVerdict(verdict: OverallVerdict): 0 | 1 | 2 {
  return verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2;
}
