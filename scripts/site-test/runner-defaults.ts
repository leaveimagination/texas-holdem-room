import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { experienceAttemptIds } from "../../tests/experience/case-catalog";
import {
  CaseReportSchema,
  EXPERIENCE_THRESHOLDS,
  EvidenceEventSchema,
  type CaseReport,
  type EvidenceEvent,
  type RunResourceRecord
} from "../../tests/experience/evidence/contracts";
import { redactForEvidence } from "../../tests/experience/evidence/redaction";
import type {
  CollectedCaseEvidence,
  SiteTestDiagnostics,
  SiteTestRunContext,
  SiteTestSelection,
  SiteTestStageControl,
  SiteTestStackHandle
} from "./runner-contracts";
import { DockerSiteTestStack } from "./docker-stack";
import { reserveLoopbackPorts } from "./ports";
import { runProcess } from "./process-runner";

const POSTGRES_HEALTH_INJECTION = "postgres-health";

export async function allocateDefaultRun(
  control?: SiteTestStageControl
): Promise<SiteTestRunContext> {
  control?.signal.throwIfAborted();
  const rootDirectory = process.cwd();
  const runId = randomUUID().replaceAll("-", "").slice(0, 6);
  const outputBase = resolve(rootDirectory, "outputs", "site-test");
  const outputRoot = join(outputBase, runId);
  const caseOutputRoot = join(outputBase, `.case-evidence-${runId}`);
  const [app, postgres, redis] = await reserveLoopbackPorts(3);
  control?.signal.throwIfAborted();
  const postgresPassword = randomBytes(24).toString("base64url");
  const image = process.env.SITE_TEST_IMAGE?.trim() || "texas-holdem-friends-room:latest";
  await Promise.all([
    mkdir(outputRoot, { recursive: true }),
    mkdir(caseOutputRoot, { recursive: true })
  ]);
  control?.signal.throwIfAborted();
  return {
    runId,
    rootDirectory,
    outputRoot,
    caseOutputRoot,
    startedAt: new Date().toISOString(),
    image,
    ports: { app, postgres, redis },
    postgresPassword,
    isolatedBaseUrl: `http://127.0.0.1:${app}`,
    redisUrl: `redis://127.0.0.1:${redis}`,
    databaseUrl:
      `postgresql://holdem:${encodeURIComponent(postgresPassword)}` +
      `@127.0.0.1:${postgres}/holdem?schema=public`,
    smokeBaseUrl: process.env.SITE_TEST_SMOKE_URL?.trim() || "http://localhost:3000",
    knownSecrets: [postgresPassword]
  };
}

export async function writeDefaultMetadata(
  context: SiteTestRunContext,
  selection: SiteTestSelection,
  chromiumVersion: string,
  control?: SiteTestStageControl
): Promise<void> {
  const git = await runProcess("git", ["rev-parse", "HEAD"], {
    cwd: context.rootDirectory,
    timeoutMs: Math.min(10_000, control?.timeoutMs ?? 10_000),
    signal: control?.signal
  });
  const packageJson = JSON.parse(
    await readFile(
      resolve(context.rootDirectory, "node_modules", "@playwright", "test", "package.json"),
      { encoding: "utf8", signal: control?.signal }
    )
  ) as { version?: unknown };
  const metadata = redactForEvidence(
    {
      schemaVersion: "1.0",
      runId: context.runId,
      startedAt: context.startedAt,
      gitRevision: git.stdout.trim(),
      image: context.image,
      nodeVersion: process.version,
      platform: process.platform,
      playwrightVersion: packageJson.version,
      chromiumVersion,
      selectedCaseIds: selection.caseIds,
      hardDeadlineMs: 30 * 60 * 1_000,
      thresholds: EXPERIENCE_THRESHOLDS
    },
    context.knownSecrets
  );
  await mkdir(join(context.outputRoot, "diagnostics"), { recursive: true });
  await writeFile(
    join(context.outputRoot, "diagnostics", "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { encoding: "utf8", signal: control?.signal }
  );
}

export async function inspectDefaultBrowserVersion(
  context: SiteTestRunContext,
  control: SiteTestStageControl,
  run: typeof runProcess = runProcess
): Promise<string> {
  const script = [
    'const { chromium } = require("@playwright/test");',
    "(async () => {",
    "  let browser;",
    "  try {",
    "    browser = await chromium.launch();",
    "    process.stdout.write(browser.version());",
    "  } finally {",
    "    if (browser) await browser.close();",
    "  }",
    "})().catch((error) => { console.error(error); process.exitCode = 1; });"
  ].join("\n");
  const result = await run(process.execPath, ["-e", script], {
    cwd: context.rootDirectory,
    timeoutMs: control.timeoutMs,
    signal: control.signal
  });
  const version = result.stdout.trim();
  if (version.length === 0) {
    throw new Error("Chromium version child returned no version");
  }
  return version;
}

export async function inspectDefaultImage(
  context: SiteTestRunContext,
  control: SiteTestStageControl
): Promise<string> {
  const result = await runProcess(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", context.image],
    {
      cwd: context.rootDirectory,
      timeoutMs: Math.min(30_000, control.timeoutMs),
      signal: control.signal
    }
  );
  const imageId = result.stdout.trim();
  if (imageId.length === 0) {
    throw new Error("Docker image inspection returned an empty immutable image ID");
  }
  return imageId;
}

export function createDefaultStack(
  context: SiteTestRunContext
): SiteTestStackHandle {
  const stack = new DockerSiteTestStack({
    runId: context.runId,
    rootDirectory: context.rootDirectory,
    ports: context.ports,
    postgresPassword: context.postgresPassword,
    image: context.image,
    onLog: ({ stream, text }) => {
      (stream === "stdout" ? process.stdout : process.stderr).write(text);
    }
  });
  let snapshot = stack.recordedSnapshot;
  return {
    runId: stack.identity.runId,
    projectName: stack.projectName,
    get snapshot() {
      return snapshot ?? stack.recordedSnapshot;
    },
    start: async (control) => {
      try {
        snapshot = await stack.start(control);
        return snapshot;
      } catch (error) {
        snapshot = stack.recordedSnapshot;
        throw error;
      }
    },
    collectDiagnostics: async (control) =>
      await stack.collectDiagnostics(control),
    stop: async (control) => await stack.stop(control)
  };
}

export async function preflightDefaultStack(
  context: SiteTestRunContext,
  _stack: SiteTestStackHandle,
  injection: SiteTestSelection["injectEnvironmentFailure"],
  control: SiteTestStageControl
): Promise<void> {
  const response = await fetch(`${context.isolatedBaseUrl}/api/health`, {
    signal: control.signal
  });
  if (!response.ok) {
    throw new Error(`Application health endpoint returned HTTP ${response.status}`);
  }
  if (injection === POSTGRES_HEALTH_INJECTION) {
    throw new Error("Injected PostgreSQL health failure");
  }
  const snapshot = _stack.snapshot;
  if (snapshot === undefined) {
    throw new Error("Verified Docker health snapshot is unavailable");
  }
  for (const serviceName of ["postgres", "redis"] as const) {
    const service = snapshot.services.find(({ service }) => service === serviceName);
    if (service?.status !== "running" || service.health !== "healthy") {
      throw new Error(
        `${serviceName} is not healthy in the verified Docker snapshot`
      );
    }
  }
}

export async function collectDefaultCaseEvidence(
  context: SiteTestRunContext,
  caseIds: readonly string[],
  control: SiteTestStageControl
): Promise<CollectedCaseEvidence> {
  const cases: CaseReport[] = [];
  const events: EvidenceEvent[] = [];
  const issues: Error[] = [];
  for (const caseId of caseIds) {
    for (const attemptId of experienceAttemptIds(caseId)) {
      control.signal.throwIfAborted();
      const attemptRoot = join(context.caseOutputRoot, caseId, attemptId);
      try {
        const [reportJson, eventsJson] = await Promise.all([
          readFile(join(attemptRoot, "report.json"), {
            encoding: "utf8",
            signal: control.signal
          }),
          readFile(join(attemptRoot, "events.json"), {
            encoding: "utf8",
            signal: control.signal
          })
        ]);
        const report = CaseReportSchema.parse(JSON.parse(reportJson));
        if (
          report.runId !== context.runId ||
          report.caseId !== caseId ||
          report.attemptId !== attemptId
        ) {
          throw new Error(`Case evidence identity mismatch for ${caseId}/${attemptId}`);
        }
        cases.push(report);
        events.push(...EvidenceEventSchema.array().min(1).parse(JSON.parse(eventsJson)));
      } catch (error) {
        if (control.signal.aborted) {
          throw control.signal.reason;
        }
        issues.push(
          new Error(
            `Could not load durable evidence for ${caseId}/${attemptId}: ${errorMessage(error)}`,
            { cause: error }
          )
        );
      }
    }
  }
  return { cases, events, issues };
}

export async function persistDefaultDiagnostics(
  context: SiteTestRunContext,
  diagnostics: SiteTestDiagnostics,
  control: SiteTestStageControl
): Promise<void> {
  control.signal.throwIfAborted();
  const root = join(context.outputRoot, "diagnostics");
  const playwrightRoot = join(root, "playwright");
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(playwrightRoot, { recursive: true })
  ]);
  control.signal.throwIfAborted();
  const safe = redactForEvidence(diagnostics, context.knownSecrets) as SiteTestDiagnostics;
  const writes: Promise<void>[] = [
    writeFile(join(root, "runner.json"), `${JSON.stringify(safe, null, 2)}\n`, {
      encoding: "utf8",
      signal: control.signal
    })
  ];
  if (safe.docker !== undefined) {
    writes.push(
      writeFile(join(root, "docker.txt"), `${safe.docker}\n`, {
        encoding: "utf8",
        signal: control.signal
      })
    );
  }
  safe.playwright.forEach(({ caseIds, result }, index) => {
    const label = `${String(index + 1).padStart(2, "0")}-${caseIds.join("-")}`;
    writes.push(
      writeFile(join(playwrightRoot, `${label}.stdout.log`), result.stdout, {
        encoding: "utf8",
        signal: control.signal
      }),
      writeFile(join(playwrightRoot, `${label}.stderr.log`), result.stderr, {
        encoding: "utf8",
        signal: control.signal
      })
    );
  });
  await Promise.all(writes);
}

export async function persistDefaultRetainedResources(
  context: SiteTestRunContext,
  resources: readonly RunResourceRecord[],
  reason: string,
  control: SiteTestStageControl
): Promise<void> {
  control.signal.throwIfAborted();
  const root = join(context.outputRoot, "diagnostics");
  await mkdir(root, { recursive: true });
  control.signal.throwIfAborted();
  const record = redactForEvidence(
    {
      schemaVersion: "1.0",
      runId: context.runId,
      recordedAt: new Date().toISOString(),
      reason,
      resources
    },
    context.knownSecrets
  );
  await writeFile(
    join(root, "retained-resources.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    { encoding: "utf8", signal: control.signal }
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
