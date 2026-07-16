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
    "POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef0123456789abcdef"
  ].join("\n"),
  "utf8"
);

afterAll(() => rmSync(tempRoot, { recursive: true, force: true }));

describe("production Docker deployment", () => {
  test("uses a multi-stage non-root application image with build and migration gates", () => {
    const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM node:22-alpine AS");
    expect(dockerfile).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(dockerfile).toContain("npx --no-install prisma generate");
    expect(dockerfile).toContain("npm run build");
    expect(dockerfile).toContain("USER node");
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
});
