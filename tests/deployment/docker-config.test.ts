import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";

const root = process.cwd();
if (!readFileSync(join(root, "package.json"), "utf8").includes('"name": "texas-holdem-friends-room"')) {
  throw new Error(`Run this test from the texas-holdem-friends-room repository root, got: ${root}`);
}

const tempRoot = mkdtempSync(join(tmpdir(), "holdem-compose-"));
const envPath = join(tempRoot, ".env.production");

writeFileSync(
  envPath,
  [
    "APP_PORT=43000",
    "APP_ORIGIN=http://example.test:43000",
    "POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef0123456789abcdef",
    "SITE_TEST_APP_PORT=43100",
    "SITE_TEST_POSTGRES_PORT=45432",
    "SITE_TEST_REDIS_PORT=46379",
    "SITE_TEST_IMAGE=example.test/holdem@sha256:fixture",
    "SITE_TEST_RUN_ID=run-01"
  ].join("\n"),
  "utf8"
);

afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

describe("production Docker deployment", () => {
  test("uses the reachable Prisma engine mirror during image generation", () => {
    const dockerfile = readFileSync(join(process.cwd(), "Dockerfile"), "utf8");
    expect(dockerfile).toContain("PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma");
  });
  test("uses a multi-stage non-root application image with build and migration gates", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM node:22-alpine AS");
    expect(dockerfile).toContain("https://mirrors.aliyun.com/alpine");
    expect(dockerfile.indexOf("https://mirrors.aliyun.com/alpine")).toBeLessThan(
      dockerfile.indexOf("apk add --no-cache")
    );
    expect(dockerfile).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(dockerfile).toContain("npx --no-install prisma generate");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("ENV TMPDIR=/app/.tmp");
    expect(dockerfile).toMatch(/mkdir -p \/app\/\.tmp.*chown node:node \/app\/\.tmp/);
    expect(dockerfile).toContain("npx --no-install prisma migrate deploy");
    expect(dockerfile).toContain("npm run start");
    expect(dockerfile).toContain("/api/health");
  });

  test("excludes local secrets, dependencies, builds, tests, and output artifacts", () => {
    const dockerignore = readFileSync(join(root, ".dockerignore"), "utf8");

    for (const entry of [
      ".git",
      ".env",
      ".env.*",
      "node_modules",
      ".next",
      "tests",
      "output",
      "outputs",
      "test-results",
      "playwright-report"
    ]) {
      expect(dockerignore).toContain(entry);
    }
  });

  test("keeps deployment secrets and generated evidence out of Git", () => {
    const gitignore = readFileSync(join(root, ".gitignore"), "utf8");

    for (const entry of [".env.production", "tmp/", "outputs/"]) {
      expect(gitignore).toContain(entry);
    }
  });

  test("publishes only the app and keeps PostgreSQL and Redis internal", () => {
    const rendered = execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        envPath,
        "-f",
        join(root, "docker-compose.prod.yml"),
        "config",
        "--format",
        "json"
      ],
      { cwd: root, encoding: "utf8" }
    );
    const config = JSON.parse(rendered) as {
      name: string;
      services: Record<
        string,
        {
          ports?: Array<{ target: number; published: string }>;
          healthcheck?: unknown;
          depends_on?: Record<string, { condition: string }>;
          environment?: Record<string, string>;
        }
      >;
      volumes?: Record<string, unknown>;
    };

    expect(config.name).toBe("texas-holdem");
    expect(Object.keys(config.services).sort()).toEqual(["app", "postgres", "redis"]);
    expect(config.services.postgres.ports).toBeUndefined();
    expect(config.services.redis.ports).toBeUndefined();
    expect(config.services.app.ports).toEqual(
      expect.arrayContaining([expect.objectContaining({ target: 3000, published: "43000" })])
    );
    expect(config.services.postgres.healthcheck).toBeTruthy();
    expect(config.services.redis.healthcheck).toBeTruthy();
    expect(config.services.app.healthcheck).toBeTruthy();
    expect(config.services.app.depends_on?.postgres.condition).toBe("service_healthy");
    expect(config.services.app.depends_on?.redis.condition).toBe("service_healthy");
    expect(config.services.app.environment?.APP_ORIGIN).toBe("http://example.test:43000");
    expect(config.volumes).toHaveProperty("postgres-data");
    expect(config.volumes).toHaveProperty("redis-data");
  });

  test("allows the deploy gate to run an exact candidate image before production switches", () => {
    const compose = readFileSync(join(root, "docker-compose.prod.yml"), "utf8");
    expect(compose).toContain("image: ${APP_IMAGE:-texas-holdem-friends-room:latest}");
  });

  test("renders an isolated loopback-only experience stack with run ownership labels", () => {
    const rendered = execFileSync(
      "docker",
      [
        "compose",
        "--project-name",
        "holdem-site-run-01",
        "--env-file",
        envPath,
        "-f",
        join(root, "docker-compose.prod.yml"),
        "-f",
        join(root, "docker-compose.experience.yml"),
        "config",
        "--format",
        "json"
      ],
      { cwd: root, encoding: "utf8" }
    );
    const config = JSON.parse(rendered) as {
      name: string;
      services: Record<
        string,
        {
          image?: string;
          labels?: Record<string, string>;
          ports?: Array<{ host_ip?: string; target: number; published: string }>;
        }
      >;
      volumes?: Record<string, { labels?: Record<string, string> }>;
    };

    expect(config.name).toBe("holdem-site-run-01");
    expect(config.services.app.image).toBe("example.test/holdem@sha256:fixture");
    expect(config.services.app.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "43100", target: 3000 })
    ]);
    expect(config.services.postgres.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "45432", target: 5432 })
    ]);
    expect(config.services.redis.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "46379", target: 6379 })
    ]);
    for (const service of Object.values(config.services)) {
      expect(service.labels?.["com.texas-holdem.site-test-run"]).toBe("run-01");
    }
    expect(config.volumes?.["postgres-data"]?.labels?.["com.texas-holdem.site-test-run"]).toBe(
      "run-01"
    );
    expect(config.volumes?.["redis-data"]?.labels?.["com.texas-holdem.site-test-run"]).toBe(
      "run-01"
    );
  });
});
