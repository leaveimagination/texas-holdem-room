import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { experienceAttemptIds } from "../../tests/experience/case-catalog";
import {
  CaseReportSchema,
  EXPERIENCE_THRESHOLDS,
  EvidenceEventSchema,
  type CaseReport,
  type EvidenceEvent
} from "../../tests/experience/evidence/contracts";
import { redactForEvidence } from "../../tests/experience/evidence/redaction";
import type {
  CollectedCaseEvidence,
  SiteTestDiagnostics,
  SiteTestRunContext,
  SiteTestSelection,
  SiteTestStackHandle
} from "./runner-contracts";
import { DockerSiteTestStack } from "./docker-stack";
import { reserveLoopbackPorts } from "./ports";
import { runProcess } from "./process-runner";

const POSTGRES_HEALTH_INJECTION = "postgres-health";

export async function allocateDefaultRun(): Promise<SiteTestRunContext> {
  const rootDirectory = process.cwd();
  const runId = randomUUID().replaceAll("-", "").slice(0, 6);
  const outputBase = resolve(rootDirectory, "outputs", "site-test");
  const outputRoot = join(outputBase, runId);
  const caseOutputRoot = join(outputBase, `.case-evidence-${runId}`);
  const [app, postgres, redis] = await reserveLoopbackPorts(3);
  const postgresPassword = randomBytes(24).toString("base64url");
  const image = process.env.SITE_TEST_IMAGE?.trim() || "texas-holdem-friends-room:latest";
  await Promise.all([
    mkdir(outputRoot, { recursive: true }),
    mkdir(caseOutputRoot, { recursive: true })
  ]);
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
  selection: SiteTestSelection
): Promise<void> {
  const git = await runProcess("git", ["rev-parse", "HEAD"], {
    cwd: context.rootDirectory,
    timeoutMs: 10_000
  });
  const packageJson = JSON.parse(
    await readFile(
      resolve(context.rootDirectory, "node_modules", "@playwright", "test", "package.json"),
      "utf8"
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
    "utf8"
  );
}

export async function inspectDefaultImage(
  context: SiteTestRunContext
): Promise<string> {
  const result = await runProcess(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", context.image],
    { cwd: context.rootDirectory, timeoutMs: 30_000 }
  );
  const imageId = result.stdout.trim();
  if (imageId.length === 0) {
    throw new Error("Docker image inspection returned an empty immutable image ID");
  }
  return imageId;
}

export async function startDefaultStack(
  context: SiteTestRunContext
): Promise<SiteTestStackHandle> {
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
  const snapshot = await stack.start();
  return {
    snapshot,
    collectDiagnostics: async () => await stack.collectDiagnostics(),
    stop: async () => await stack.stop()
  };
}

export async function preflightDefaultStack(
  context: SiteTestRunContext,
  _stack: SiteTestStackHandle,
  injection: SiteTestSelection["injectEnvironmentFailure"],
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(`${context.isolatedBaseUrl}/api/health`, { signal });
  if (!response.ok) {
    throw new Error(`Application health endpoint returned HTTP ${response.status}`);
  }
  if (injection === POSTGRES_HEALTH_INJECTION) {
    throw new Error("Injected PostgreSQL health failure");
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    datasources: { db: { url: context.databaseUrl } }
  });
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } finally {
    await prisma.$disconnect();
  }

  const { default: Redis } = await import("ioredis");
  const redis = new Redis(context.redisUrl, {
    lazyConnect: true,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1
  });
  try {
    await redis.connect();
    if ((await redis.ping()) !== "PONG") {
      throw new Error("Redis health check did not return PONG");
    }
  } finally {
    redis.disconnect(false);
  }
}

export async function collectDefaultCaseEvidence(
  context: SiteTestRunContext,
  caseIds: readonly string[]
): Promise<CollectedCaseEvidence> {
  const cases: CaseReport[] = [];
  const events: EvidenceEvent[] = [];
  const issues: Error[] = [];
  for (const caseId of caseIds) {
    for (const attemptId of experienceAttemptIds(caseId)) {
      const attemptRoot = join(context.caseOutputRoot, caseId, attemptId);
      try {
        const [reportJson, eventsJson] = await Promise.all([
          readFile(join(attemptRoot, "report.json"), "utf8"),
          readFile(join(attemptRoot, "events.json"), "utf8")
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
  diagnostics: SiteTestDiagnostics
): Promise<void> {
  const root = join(context.outputRoot, "diagnostics");
  const playwrightRoot = join(root, "playwright");
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(playwrightRoot, { recursive: true })
  ]);
  const safe = redactForEvidence(diagnostics, context.knownSecrets) as SiteTestDiagnostics;
  const writes: Promise<void>[] = [
    writeFile(join(root, "runner.json"), `${JSON.stringify(safe, null, 2)}\n`, "utf8")
  ];
  if (safe.docker !== undefined) {
    writes.push(writeFile(join(root, "docker.txt"), `${safe.docker}\n`, "utf8"));
  }
  safe.playwright.forEach(({ caseIds, result }, index) => {
    const label = `${String(index + 1).padStart(2, "0")}-${caseIds.join("-")}`;
    writes.push(
      writeFile(join(playwrightRoot, `${label}.stdout.log`), result.stdout, "utf8"),
      writeFile(join(playwrightRoot, `${label}.stderr.log`), result.stderr, "utf8")
    );
  });
  await Promise.all(writes);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
