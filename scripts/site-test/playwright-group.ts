import { resolve } from "node:path";

import {
  ProcessExecutionError,
  ProcessTimeoutError,
  runProcess,
  type ProcessLogEntry,
  type ProcessResult,
  type RunProcessOptions
} from "./process-runner";
import {
  redactForEvidence,
  type KnownSecret
} from "../../tests/experience/evidence/redaction";

export interface PlaywrightGroupResult extends ProcessResult {
  timedOut: boolean;
}

export type PlaywrightProcessRunner = (
  command: string,
  args: readonly string[],
  options?: Pick<
    RunProcessOptions,
    "cwd" | "env" | "timeoutMs" | "signal" | "onLog" | "redact"
  >
) => Promise<ProcessResult>;

export interface RunPlaywrightGroupInput {
  rootDirectory: string;
  runId: string;
  outputRoot: string;
  caseOutputRoot: string;
  caseIds: readonly string[];
  isolatedBaseUrl: string;
  databaseUrl: string;
  smokeBaseUrl: string;
  isolatedAcceptancePassed?: boolean;
  fixtureSeedBroker?: {
    endpoint: string;
    authorizationToken: string;
  };
  timeoutMs: number;
  signal?: AbortSignal;
  knownSecrets?: readonly KnownSecret[];
  run?: PlaywrightProcessRunner;
  writeStdout?(text: string): void;
  writeStderr?(text: string): void;
}

export async function runPlaywrightGroup(
  input: RunPlaywrightGroupInput
): Promise<PlaywrightGroupResult> {
  if (input.caseIds.length === 0) {
    throw new Error("A Playwright group must contain at least one explicit case ID");
  }
  if (new Set(input.caseIds).size !== input.caseIds.length) {
    throw new Error("A Playwright group must not contain duplicate case IDs");
  }

  const run = input.run ?? runProcess;
  const redact = credentialRedactor(input.databaseUrl, input.knownSecrets ?? []);
  const onLog = (entry: ProcessLogEntry) => {
    if (entry.stream === "stdout") {
      (input.writeStdout ?? process.stdout.write.bind(process.stdout))(
        redact(entry.text)
      );
      return;
    }
    (input.writeStderr ?? process.stderr.write.bind(process.stderr))(
      redact(entry.text)
    );
  };
  const cliPath = resolve(
    input.rootDirectory,
    "node_modules",
    "@playwright",
    "test",
    "cli.js"
  );
  const args = [
    cliPath,
    "test",
    "--config",
    resolve(input.rootDirectory, "playwright.experience.config.ts"),
    "--grep",
    exactCasePattern(input.caseIds)
  ];
  const options = {
    cwd: input.rootDirectory,
    env: {
      ...process.env,
      SITE_TEST_RUN_ID: input.runId,
      SITE_TEST_OUTPUT_ROOT: input.outputRoot,
      SITE_TEST_CASE_OUTPUT_ROOT: input.caseOutputRoot,
      SITE_TEST_CASE_IDS: input.caseIds.join(","),
      SITE_TEST_ISOLATED_BASE_URL: input.isolatedBaseUrl,
      SITE_TEST_DATABASE_URL: input.databaseUrl,
      SITE_TEST_SMOKE_URL: input.smokeBaseUrl,
      ...(input.isolatedAcceptancePassed ? { SITE_TEST_ISOLATED_ACCEPTANCE_PASSED: "1" } : {}),
      ...(input.fixtureSeedBroker ? {
        SITE_TEST_FIXTURE_BROKER_ENDPOINT: input.fixtureSeedBroker.endpoint,
        SITE_TEST_FIXTURE_BROKER_TOKEN: input.fixtureSeedBroker.authorizationToken
      } : {})
    },
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    redact,
    onLog
  };

  try {
    return { ...(await run(process.execPath, args, options)), timedOut: false };
  } catch (error) {
    if (error instanceof ProcessExecutionError) {
      return {
        exitCode: error.exitCode ?? 2,
        stdout: error.stdout,
        stderr: error.stderr,
        timedOut: false
      };
    }
    if (error instanceof ProcessTimeoutError) {
      return {
        exitCode: 2,
        stdout: error.stdout,
        stderr: error.stderr,
        timedOut: true
      };
    }
    throw error;
  }
}

function exactCasePattern(caseIds: readonly string[]): string {
  return `\\b(?:${caseIds.map(escapeRegExp).join("|")})\\b`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function credentialRedactor(
  databaseUrl: string,
  knownSecrets: readonly KnownSecret[]
): (value: string) => string {
  const password = new URL(databaseUrl).password;
  const secrets: KnownSecret[] = [
    ...knownSecrets,
    ...[password, safeDecodeURIComponent(password)].filter((value) => value.length > 0)
  ];
  return (value) => {
    const redacted = redactForEvidence(value, secrets);
    return typeof redacted === "string" ? redacted : JSON.stringify(redacted);
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
