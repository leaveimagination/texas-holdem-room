# Texas Hold'em Docker Deployment Design

## Goal

Deploy the existing friends-room Texas Hold'em application to the contest Linux host as a persistent, production-like Docker Compose stack with one public application port and internal PostgreSQL and Redis services.

## Architecture

Use three Compose services:

- `app`: Next.js 15 plus the custom HTTP/WebSocket server from `src/server/index.ts`.
- `postgres`: PostgreSQL 16 with a named data volume.
- `redis`: Redis 7 for live room state.

Only the application port is published on the host. PostgreSQL and Redis remain reachable only through the Compose network. The app receives `DATABASE_URL`, `REDIS_URL`, `APP_ORIGIN`, `HOST=0.0.0.0`, and `PORT=3000` through a server-side production environment file.

## Container Build

Create a multi-stage Node 22 Alpine Dockerfile:

1. Install locked dependencies with `npm ci`.
2. Generate Prisma Client and run `npm run build` inside the build stage.
3. Copy the built Next.js output, application source, Prisma files, package metadata, and generated dependencies into a non-root runtime stage.
4. Start the existing production command through the custom server so HTTP, Next.js upgrades, and game WebSockets share port `3000`.

The runtime retains `tsx` because the checked-in production command executes the TypeScript custom server directly. This is larger than a standalone Next.js image but minimizes deployment-time code changes and risk.

## Compose Lifecycle

- Wait for PostgreSQL and Redis health checks.
- Run `npx prisma migrate deploy` before the application server starts.
- Restart services unless explicitly stopped.
- Add an application health check against `http://127.0.0.1:3000/api/health`.
- Use a stable Compose project name and deployment directory under `~/app/` after confirming the directory does not conflict with an existing deployment.

## Secrets and Port Selection

- Never upload the local `.env` file.
- Generate a new production PostgreSQL password locally in memory and write it only to the remote server-side environment file with mode `600`.
- Do not print environment values in logs or evidence.
- Query the server for the assigned port range or existing allocation mechanism after SSH access is established. Select one free assigned port and publish it as `<assigned-port>:3000`.
- Set `APP_ORIGIN` to `http://120.27.143.111:<assigned-port>` unless the server provides a different public hostname.

## Deployment Flow

1. Add `Dockerfile`, `.dockerignore`, and a production Compose definition without embedding secrets.
2. Validate TypeScript, unit tests, production build, Dockerfile structure, and resolved Compose configuration locally where tooling permits.
3. Authenticate through the administrator-to-deployment-account flow already verified for this host. Password entry remains user-controlled; subsequent operations use a temporary SSH key.
4. Upload a source archive that excludes `.git`, `.env`, `node_modules`, `.next`, test results, logs, output artifacts, and local caches.
5. Create the remote production environment file and deploy with Docker Compose.
6. Verify migrations, container health, logs, the public health endpoint twice, the landing page, and a WebSocket upgrade path.

## Failure Handling and Rollback

- Stop before upload if SSH key-only access, Docker daemon access, or port allocation cannot be verified.
- Stop if an existing deployment directory or Compose project would be overwritten unexpectedly.
- If image build, migration, or startup fails, retain sanitized logs, stop the new stack, and preserve the database volume unless the user explicitly authorizes its removal.
- Do not delete an existing healthy deployment until the replacement stack has built successfully.
- Never report success based only on containers being in the running state.

## Acceptance Criteria

The deployment is complete only when:

1. Local project tests and production build pass.
2. All three Compose services are running, and PostgreSQL, Redis, and the application are healthy.
3. Prisma migrations complete successfully.
4. The assigned public URL returns HTTP 200 from `/api/health` twice and loads the landing page.
5. The application container runs as a non-root user and only the assigned application port is published.
6. Recent logs contain no fatal errors or secret values.
7. The final URL, assigned port, Compose services, deployment directory, and rollback instructions are reported.

## Out of Scope

- TLS certificates and a custom domain.
- Multiple application replicas.
- External managed PostgreSQL or Redis.
- Destructive removal of the persistent database volume after deployment.
