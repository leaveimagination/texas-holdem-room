# Full-Site Experience Testing

`npm run test:site` is the explicit, on-demand acceptance command for the complete desktop, mobile, realtime, accounting, recovery, and production-smoke journey. A normal run is expected to take 20–30 minutes and has a hard 30-minute deadline.

## Prerequisites

- Docker with Compose, Node.js, npm dependencies, and Playwright Chromium are installed.
- The application image named by `SITE_TEST_IMAGE` exists locally. The default remains `texas-holdem-friends-room:latest`.
- PostgreSQL and Redis ports can be allocated for the isolated stack.
- The smoke target is healthy and matches the selected image identity.

The runner creates a unique `holdem-site-<runId>` Compose project with fresh volumes and ports. It never restarts, rebuilds, replaces, or stops the smoke target. For validation work, point smoke at a unique disposable production project and URL; do not use a shared deployment.

## Commands

```powershell
npm run test:site
npm run test:site -- --inject-product-failure=EXP-001/A-001
npm run test:site -- --inject-environment-failure=postgres-health
```

The product injection must exit `1` with overall `FAIL` and durable product assertion evidence. The PostgreSQL-health injection must exit `2` with overall `INCONCLUSIVE`, environment diagnostics, no production smoke, and exact isolated cleanup.

## Environment

- `SITE_TEST_IMAGE`: immutable application image tag used by the isolated stack and smoke image check.
- `SITE_TEST_SMOKE_URL`: production-path smoke base URL; defaults to `http://localhost:3000`.
- `SITE_TEST_SMOKE_COMPOSE_PROJECT`: optional override accepted only for a disposable `holdem-site-*` project.
- `LONG_RUN_SECONDS` and `ACTION_DELAY_MS`: long-run simulation controls; they do not change the site-suite deadline.

Internal `SITE_TEST_*` run IDs, ports, database URLs, broker credentials, and evidence roots are allocated by the runner. Do not set or publish fixture-broker tokens.

## Exit Codes And Verdicts

- `0` — `PASS`: all selected product assertions, harness checks, and environment checks passed.
- `1` — `FAIL`: at least one product violation was proven. A later cleanup problem does not erase that product result.
- `2` — `INCONCLUSIVE`: harness or environment health prevented a trustworthy judgment.

EXP-010 executes only after every selected isolated case has passed, isolated evidence has validated, and the harness/environment planes remain healthy. Playwright uses one worker, zero automatic retries, and the catalog alone declares which realtime cases receive separate `A-001` and `A-002` attempts.

## Evidence And Cleanup

Each finalized run writes aggregate `case-manifest.json`, `events.json`, `report.json`, `report.html`, and `diagnostics/` under `outputs/site-test/<runId>/`. Per-attempt screenshots, videos, traces, and visual diffs are retained under `outputs/site-test/<runId>/cases/<caseId>/<attemptId>/`. A temporary `.case-evidence-<runId>` directory may exist only while structured attempt evidence is being collected. Partial evidence is made durable before cleanup. Known credentials and private payloads are redacted and the final validator checks ordinary files and decompressed trace entries.

Cleanup uses only exact resources recorded for the current run. The isolated project name and labels must match before Compose removal. Production smoke records its exact room ID and ownership marker as soon as creation succeeds, so browser failure still leaves a cleanup target. If ownership or deletion cannot be proven, the room is retained, harness and environment become inconclusive, and any already-proven product failure remains `FAIL`. No wildcard database deletion, Redis scan-delete, broad volume deletion, or production restart is allowed.

## Inspecting And Triaging Failures

Open `outputs/site-test/<runId>/report.html` first and follow the earliest-divergence links to events, screenshots, video, and traces. Open a trace with:

```powershell
npx playwright show-trace outputs/site-test/<runId>/cases/<caseId>/<attemptId>/traces/<role>.zip
```

Triage the three planes independently: product failures are reproducible assertion violations; harness failures cover browser, timing, collection, or evidence integrity; environment failures cover Docker, ports, image identity, PostgreSQL, or Redis. Check `diagnostics/docker.txt`, `server.log`, `browser-console.json`, and `websocket-events.json`, then confirm `resources` records show only run-scoped items as `cleaned` or explicitly `retained`.
