import { resolve } from "node:path";

import {
  ProcessExecutionError,
  runProcess,
  type ProcessLogEntry,
  type ProcessResult,
  type RunProcessOptions
} from "./process-runner";

export type PlaywrightProcessRunner = (
  command: string,
  args: readonly string[],
  options?: Pick<
    RunProcessOptions,
    "cwd" | "env" | "timeoutMs" | "onLog" | "redact"
  >
) => Promise<ProcessResult>;

export interface RunPlaywrightGroupInput {
  rootDirectory: string;
  runId: string;
  outputRoot: string;
  caseOutputRoot: string;
  caseIds: readonly string[];
  isolatedBaseUrl: string;
  redisUrl: string;
  databaseUrl: string;
  smokeBaseUrl: string;
  timeoutMs: number;
  run?: PlaywrightProcessRunner;
  writeStdout?(text: string): void;
  writeStderr?(text: string): void;
}

export async function runPlaywrightGroup(
  input: RunPlaywrightGroupInput
): Promise<ProcessResult> {
  if (input.caseIds.length === 0) {
    throw new Error("A Playwright group must contain at least one explicit case ID");
  }
  if (new Set(input.caseIds).size !== input.caseIds.length) {
    throw new Error("A Playwright group must not contain duplicate case IDs");
  }

  const run = input.run ?? runProcess;
  const redact = credentialRedactor(input.databaseUrl);
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
      SITE_TEST_REDIS_URL: input.redisUrl,
      SITE_TEST_DATABASE_URL: input.databaseUrl,
      SITE_TEST_SMOKE_URL: input.smokeBaseUrl
    },
    timeoutMs: input.timeoutMs,
    redact,
    onLog
  };

  try {
    return await run(process.execPath, args, options);
  } catch (error) {
    if (error instanceof ProcessExecutionError) {
      return {
        exitCode: error.exitCode ?? 2,
        stdout: error.stdout,
        stderr: error.stderr
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

function credentialRedactor(databaseUrl: string): (value: string) => string {
  const password = new URL(databaseUrl).password;
  const secrets = new Set(
    [password, safeDecodeURIComponent(password)].filter(
      (value) => value.length > 0
    )
  );
  return (value) => {
    let redacted = value;
    for (const secret of secrets) {
      redacted = redacted.replaceAll(secret, "[REDACTED]");
    }
    return redacted;
  };
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
