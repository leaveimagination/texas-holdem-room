# Texas Hold'em Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production Docker Compose stack for the existing Texas Hold'em application, deploy it to `120.27.143.111` through the verified administrator-to-deployment-account SSH flow, and prove HTTP, WebSocket, database, Redis, migration, runtime, and public-port behavior.

**Architecture:** Preserve the existing development-only `docker-compose.yml`. Add a multi-stage application `Dockerfile`, a strict `.dockerignore`, and `docker-compose.prod.yml` containing the app, PostgreSQL, and Redis. Store production variables only in a remote mode-`600` `.env.production`, build on the Linux host, and retain a structured evidence pack for deployment and acceptance.

**Tech Stack:** Node.js 22 Alpine, Next.js 15, custom Node HTTP/WebSocket server, Prisma 6, PostgreSQL 16, Redis 7, Docker Compose, Vitest, PowerShell 5.1, OpenSSH

## Global Constraints

- Work only in `C:\Users\admin\Documents\liubai\.worktrees\texas-holdem-friends-room`.
- Preserve the existing `docker-compose.yml` for local database and Redis development.
- Never read, upload, print, or overwrite the local `.env` values.
- Do not publish PostgreSQL or Redis host ports in production.
- Publish only the assigned application port to container port `3000`.
- Generate a URL-safe 48-character hexadecimal PostgreSQL password and keep it only in the remote `.env.production`.
- Keep strict SSH host-key verification enabled.
- Use the existing deployment account after verifying it exists and retains Docker daemon access; do not recreate it unless inspection proves it is absent and the user authorizes creation.
- Use run-scoped temporary SSH keys and remove both administrator and deployment-account authorizations after acceptance.
- Preserve the production database and Redis volumes during failure cleanup and rollback unless the user explicitly authorizes destructive removal.
- Do not overwrite an unexpected existing `~/app/` deployment.
- Do not claim success from container running state alone.
- Retain deployment evidence under `outputs/evidence/texas-holdem-deploy/20260716-01/`.

---

### Task 1: Define Production Container Contracts With a Failing Test

**Files:**
- Create: `tests/deployment/docker-config.test.ts`
- Test: `tests/deployment/docker-config.test.ts`

**Interfaces:**
- Consumes: repository root, Docker Compose CLI, and future `Dockerfile`, `.dockerignore`, and `docker-compose.prod.yml`.
- Produces: executable assertions for multi-stage build behavior, non-root runtime, migrations, internal data services, health checks, and public-port isolation.

- [ ] **Step 1: Write the failing deployment configuration test**

Create `tests/deployment/docker-config.test.ts`:

```typescript
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
      services: Record<string, {
        ports?: Array<{ target: number; published: string }>;
        healthcheck?: unknown;
        depends_on?: Record<string, { condition: string }>;
        environment?: Record<string, string>;
      }>;
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
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run tests/deployment/docker-config.test.ts
```

Expected: failure because `Dockerfile`, `.dockerignore`, or `docker-compose.prod.yml` does not exist.

---

### Task 2: Implement the Production Docker Stack

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.prod.yml`
- Modify: `.gitignore`
- Test: `tests/deployment/docker-config.test.ts`

**Interfaces:**
- Consumes: `package-lock.json`, `src/`, `prisma/`, `next.config.mjs`, `tsconfig.json`, and Compose variables `APP_PORT`, `APP_ORIGIN`, `POSTGRES_PASSWORD`.
- Produces: image `texas-holdem-friends-room:latest` and Compose project `texas-holdem` with services `app`, `postgres`, and `redis`.

- [ ] **Step 1: Create the multi-stage Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY prisma ./prisma
RUN npx --no-install prisma generate
COPY next.config.mjs tsconfig.json next-env.d.ts ./
COPY src ./src
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/next.config.mjs /app/tsconfig.json /app/next-env.d.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=12 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && npm run start"]
```

- [ ] **Step 2: Create `.dockerignore`**

Create `.dockerignore`:

```dockerignore
.git
.gitignore
.worktrees
.env
.env.*
node_modules
.next
tests
docs
output
outputs
test-results
playwright-report
coverage
tmp-dev*.log
*.log
npm-debug.log
tsconfig.tsbuildinfo
```

- [ ] **Step 3: Create the production Compose definition**

Create `docker-compose.prod.yml`:

```yaml
name: texas-holdem

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: holdem
      POSTGRES_USER: holdem
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U holdem -d holdem"]
      interval: 3s
      timeout: 5s
      retries: 30
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 3s
      timeout: 5s
      retries: 30
    restart: unless-stopped

  app:
    image: texas-holdem-friends-room:latest
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: "3000"
      DATABASE_URL: postgresql://holdem:${POSTGRES_PASSWORD}@postgres:5432/holdem?schema=public
      REDIS_URL: redis://redis:6379
      APP_ORIGIN: ${APP_ORIGIN:?APP_ORIGIN is required}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    ports:
      - "${APP_PORT:?APP_PORT is required}:3000"
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]
      interval: 10s
      timeout: 3s
      start_period: 20s
      retries: 12
    restart: unless-stopped

volumes:
  postgres-data:
  redis-data:
```

- [ ] **Step 4: Ignore the server-side environment filename**

Append to `.gitignore`:

```gitignore
.env.production
```

- [ ] **Step 5: Run the deployment contract test and verify GREEN**

Run:

```powershell
npx vitest run tests/deployment/docker-config.test.ts
```

Expected: all three tests pass.

- [ ] **Step 6: Commit the Docker stack**

Run:

```powershell
git add Dockerfile .dockerignore docker-compose.prod.yml .gitignore tests/deployment/docker-config.test.ts
git commit -m "feat: add production docker deployment"
```

Expected: one commit containing only the five deployment files.

---

### Task 3: Run Local Regression and Build Verification

**Files:**
- Verify: all tracked project files
- Create temporarily: `outputs/evidence/texas-holdem-deploy/20260716-01/`

**Interfaces:**
- Consumes: the production Docker stack from Task 2.
- Produces: local test, typecheck, Next build, Compose rendering, archive whitelist, and evidence-pack prerequisites.

- [ ] **Step 1: Read the evidence-driven testing method**

Read `C:\Users\admin\.codex\skills\evidence-driven-testing\references\method.md` completely before building the evidence pack.

- [ ] **Step 2: Run deployment tests and the complete unit/integration suite**

Run:

```powershell
npm test
```

Expected: all Vitest tests pass, including `tests/deployment/docker-config.test.ts`.

- [ ] **Step 3: Run static type checking**

Run:

```powershell
npm run typecheck
```

Expected: exit code `0`.

- [ ] **Step 4: Run the production Next.js build**

Run:

```powershell
npm run build
```

Expected: Next.js production build succeeds.

- [ ] **Step 5: Render and inspect production Compose configuration**

Create a temporary local test env outside the source archive with:

```text
APP_PORT=43000
APP_ORIGIN=http://127.0.0.1:43000
POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef0123456789abcdef
```

Run:

```powershell
docker compose --env-file <temporary-env> -f docker-compose.prod.yml config --format json
```

Expected: three services; only `app` has a published port; both named volumes exist; no `${...}` placeholders remain. Delete the temporary env immediately afterward.

- [ ] **Step 6: Record the local Docker limitation honestly**

Run:

```powershell
docker info --format '{{.ServerVersion}}'
```

Expected in the current environment: failure because Docker Desktop's Linux engine is not running. Record this as an environment limitation; do not classify it as a project failure. Perform the real image build on the remote Docker host.

- [ ] **Step 7: Build and inspect the upload archive**

Create a source archive containing only:

```text
Dockerfile
.dockerignore
docker-compose.prod.yml
package.json
package-lock.json
next.config.mjs
tsconfig.json
next-env.d.ts
prisma/
src/
```

List the archive and fail if it contains `.env`, `.git`, `node_modules`, `.next`, tests, output, logs, or caches.

---

### Task 4: Bootstrap SSH, Inspect the Host, and Select the Port

**Files:**
- Create temporarily: `tmp/texas-holdem-deploy/20260716-01/id_ed25519`
- Create remotely: administrator and deployment-account run-scoped authorized-key entries
- Preserve: no password artifact

**Interfaces:**
- Consumes: the administrator credential through a user-controlled graphical prompt and the existing deployment account.
- Produces: verified key-only access to the deployment account, Docker/Compose preflight, safe deployment directory status, and a verified assigned public port.

- [ ] **Step 1: Generate a run-scoped ED25519 key**

Use comment:

```text
codex-texas-holdem-deploy-20260716-01
```

Verify the public key has exactly the expected type, blob, and final comment.

- [ ] **Step 2: Authorize the key for the administrator through one graphical password attempt**

Use strict host-key checking. Transfer the public key through raw standard input or an isolated file, not a multiply quoted inline value. Run the remote authorization command with `set -eu`.

- [ ] **Step 3: Verify administrator key-only login independently**

Use:

```text
BatchMode=yes
IdentitiesOnly=yes
PreferredAuthentications=publickey
StrictHostKeyChecking=yes
```

Expected: separate connection exits `0`.

- [ ] **Step 4: Inspect and authorize the deployment account**

Through the administrator account:

- verify the deployment account exists;
- verify its home directory;
- verify `docker` group membership;
- install the run-scoped public key with `.ssh` mode `700` and `authorized_keys` mode `600`;
- preserve unrelated existing keys.

- [ ] **Step 5: Verify deployment-account access and Docker**

Open a separate deployment-account connection and run:

```bash
id
docker --version
docker info --format '{{.ServerVersion}}'
docker compose version || docker-compose version
command -v tar
command -v curl
```

Expected: Docker daemon access succeeds and a Compose implementation is available.

- [ ] **Step 6: Inspect `~/app/` without mutation**

If `~/app/` exists, list only its top-level metadata and Compose project labels. Stop and ask before overwriting an unexpected deployment. If it is absent or is already the same `texas-holdem` project, continue.

- [ ] **Step 7: Discover the assigned port range**

Inspect account-scoped port variables, login messages, approved allocation files, and any platform-provided port command without printing unrelated environment values. Compare the allowed range with:

```bash
ss -ltn
docker ps --format '{{.Ports}}'
```

Choose one allowed unused TCP port. If no authoritative allocation source is discoverable, stop and request the port range instead of choosing an arbitrary public port.

- [ ] **Step 8: Generate production variables**

Generate a 48-character hexadecimal `POSTGRES_PASSWORD`. Set:

```text
APP_PORT=<verified-assigned-port>
APP_ORIGIN=http://120.27.143.111:<verified-assigned-port>
POSTGRES_PASSWORD=<generated-hex-value>
```

Keep values in memory until writing the remote environment file; never print the password.

---

### Task 5: Upload and Deploy the Compose Stack

**Files:**
- Upload: the verified archive from Task 3
- Create remotely: `~/app/`
- Create remotely: `~/app/.env.production` with mode `600`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/`

**Interfaces:**
- Consumes: verified archive, assigned port, production variables, deployment-account SSH key.
- Produces: running Compose project `texas-holdem`, persistent volumes, migration output, image build log, container state, and sanitized deployment evidence.

- [ ] **Step 1: Create or confirm the deployment directory**

Create `~/app/` only after Task 4 proves it is safe. Do not use `--delete` against unknown contents.

- [ ] **Step 2: Upload and extract the source archive**

Upload via `scp` with the temporary identity. Extract into `~/app/`, list the resulting files, and compare them against the approved archive list.

- [ ] **Step 3: Write the production environment file**

Transfer the three-line environment content through standard input to a newly created `~/app/.env.production`, set mode `600`, and verify only its owner and mode. Do not display its contents.

- [ ] **Step 4: Validate remote Compose configuration**

Run:

```bash
cd ~/app
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

Use `docker-compose` only if the host lacks the plugin. Expected: exit code `0`.

- [ ] **Step 5: Build the application image**

Detect buildx. Use compatible plain `docker compose build app` when buildx is unavailable. Save sanitized build output to:

```text
outputs/evidence/texas-holdem-deploy/20260716-01/outputs/docker-build.log
```

Expected: Prisma generation and Next.js build succeed.

- [ ] **Step 6: Start the complete stack**

Run:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

Poll for at most five minutes. Continue only when PostgreSQL, Redis, and app health states are healthy.

- [ ] **Step 7: Verify migration and runtime state**

Capture:

- `docker compose ps`;
- app logs containing successful Prisma migration or no-pending-migration output;
- `docker exec <app-container> id -u`, which must not be `0`;
- app port binding, which must be exactly the assigned host port to container port `3000`;
- PostgreSQL and Redis must have no host port bindings.

---

### Task 6: Execute Public HTTP, Page, and WebSocket Acceptance

**Files:**
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/health-1.json`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/health-2.json`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/landing.html`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/websocket-smoke.json`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/compose-ps.txt`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/outputs/app.log`

**Interfaces:**
- Consumes: public URL and healthy stack.
- Produces: repeatable product, harness, and environment evidence.

- [ ] **Step 1: Probe the public health endpoint twice**

Request:

```text
http://120.27.143.111:<assigned-port>/api/health
```

twice in separate commands. Each must return HTTP `200` and JSON `{ "ok": true }`.

- [ ] **Step 2: Probe the public landing page**

Request `/`. Expected: HTTP `200`, HTML content, and product copy identifying the private friends-room poker application.

- [ ] **Step 3: Probe the public WebSocket endpoint**

Use the installed `ws` package to connect to:

```text
ws://120.27.143.111:<assigned-port>/ws
```

Wait for `open`, send the invalid frame `{`, and require a JSON error message with message `Invalid message`. Close the connection cleanly and save only the sanitized result:

```json
{
  "opened": true,
  "errorMessage": "Invalid message",
  "closed": true
}
```

- [ ] **Step 4: Inspect logs and secrets**

Save the last 200 lines of app logs. Fail if logs contain a fatal startup error, the generated database password, private-key headers, or password assignments.

- [ ] **Step 5: Repeat server-side health and dependency checks**

From the host:

- call the loopback published health endpoint;
- run `pg_isready` inside PostgreSQL;
- run `redis-cli ping` inside Redis;
- re-read app health after the public probes.

Expected: all pass.

---

### Task 7: Remove Temporary Access and Build the Evidence Pack

**Files:**
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/case-manifest.json`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/events.json`
- Create: `outputs/evidence/texas-holdem-deploy/20260716-01/report.json`
- Delete locally: `tmp/texas-holdem-deploy/20260716-01/`
- Preserve remotely: `~/app/`, `.env.production`, Compose containers, images, and named volumes

**Interfaces:**
- Consumes: all deployment, probe, log, and runtime artifacts.
- Produces: a mechanically valid pass/fail/inconclusive verdict and a production stack that remains running without temporary SSH credentials.

- [ ] **Step 1: Remove the deployment-account temporary key**

Use CRLF-safe exact-line matching with the run-scoped comment. Preserve unrelated keys and require at least one exact removal.

- [ ] **Step 2: Prove deployment-account key rejection**

Open a new key-only connection using only the temporary identity. Expected: authentication fails.

- [ ] **Step 3: Remove the administrator temporary key**

Remove only the exact full key and any exact consecutive type/blob/comment fragment left by this run. Preserve unrelated lines and require a positive removal count.

- [ ] **Step 4: Prove administrator key rejection**

Open a new key-only administrator connection. Expected: authentication fails.

- [ ] **Step 5: Delete local temporary credentials safely**

Resolve the exact local run directory, assert it is under the workspace `tmp/texas-holdem-deploy` parent with leaf `20260716-01`, then delete it recursively. Preserve the evidence directory.

- [ ] **Step 6: Populate the evidence templates**

Use case ID `TEXAS-HOLDEM-DEPLOY-001`, run ID `20260716-01`, and assertions for:

1. local tests, typecheck, and production build;
2. remote Compose build and migration;
3. three healthy services and non-root app runtime;
4. no public PostgreSQL or Redis ports;
5. two successful public health probes and landing page;
6. successful WebSocket open/error/close behavior;
7. sanitized logs and exact temporary-key cleanup.

Judge product, harness, and environment separately.

- [ ] **Step 7: Validate the evidence pack**

Run:

```powershell
python C:\Users\admin\.codex\skills\evidence-driven-testing\scripts\validate_evidence_pack.py C:\Users\admin\Documents\liubai\.worktrees\texas-holdem-friends-room\outputs\evidence\texas-holdem-deploy\20260716-01
```

Expected on full success: `VALID`, verdict `pass`, seven assertions, and no missing artifacts.

- [ ] **Step 8: Run final deployment verification**

Freshly verify the public health endpoint, landing page, WebSocket smoke, Compose health, non-root UID, port isolation, migration status, evidence validation, and absence of local/remote temporary keys before reporting completion.

- [ ] **Step 9: Report rollback without executing it**

Provide:

```bash
cd ~/app
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

Explain that this stops containers but preserves named volumes. Do not run `down -v` unless the user explicitly asks to destroy stored room and hand data.
