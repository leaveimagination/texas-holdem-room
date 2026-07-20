# Texas Hold'em Production Deploy Skill Design

**Date:** 2026-07-20

## Objective

Create a personal Codex Skill that deploys the Texas Hold'em project from Windows to its existing Linux production host through one directly executable PowerShell orchestrator. The workflow must preserve production data by default, provide a masked graphical password prompt, build before switching, retain rollback material, verify the public service, and remove temporary access.

## Fixed Production Identity

| Setting | Value |
| --- | --- |
| SSH host | `120.27.143.111` |
| Bootstrap administrator | `account-admin` |
| Deployment account | `FD-222398` |
| Deployment directory | `/home/FD-222398/app` |
| Public port | `32768` |
| Public URL | `http://120.27.143.111:32768` |
| Compose command | `docker-compose` |
| Compose file | `docker-compose.prod.yml` |
| Environment file | `.env.production` |
| Compose project | `texas-holdem` |

These values are intentionally project-specific. The script must not substitute `root`, `admin`, or another deployment account.

## Skill Layout

Install the Skill at:

```text
C:\Users\admin\.codex\skills\deploying-texas-holdem-production\
├── SKILL.md
├── agents\openai.yaml
├── references\production-contract.md
└── scripts\
    ├── deploy.ps1
    ├── ssh-askpass.ps1
    └── test-deploy-contract.ps1
```

`SKILL.md` stays concise and routes execution to `scripts/deploy.ps1`. The production constants, invariants, recovery rules, and operator-visible outcomes live in `references/production-contract.md`. The deployment behavior lives in executable scripts rather than copy-pasted commands.

## Command Contract

The normal command directly deploys:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\deploy.ps1 -ProjectRoot C:\Users\admin\Documents\liubai\.worktrees\texas-holdem-main
```

The script accepts an explicit project root and otherwise discovers the current Git worktree. Running the script does not require an `-Execute` flag. It supports `-WhatIf` for read-only inspection and testability, but `-WhatIf` is never implied by normal execution.

The script must reject:

- a project root without `Dockerfile`, `docker-compose.prod.yml`, `package.json`, and `.git` worktree metadata;
- a dirty tracked worktree unless `-AllowDirtyTrackedFiles` is explicitly supplied;
- a detached or unresolved Git `HEAD`;
- unexpected SSH host keys;
- an identity chain other than `account-admin` to `FD-222398`;
- an unexpected remote deployment directory or Compose project;
- existing run-specific staging or backup paths;
- missing or unreadable `.env.production`;
- Docker volumes whose labels do not match the `texas-holdem` project;
- missing volume backing directories, unhealthy storage, or insufficient disk capacity.

## Authentication and Temporary Access

1. Generate a run-scoped ED25519 key under a validated local temporary directory.
2. Invoke OpenSSH with `SSH_ASKPASS_REQUIRE=force` and a WinForms password dialog.
3. The dialog displays `account-admin@120.27.143.111`, masks the password, and writes it only to the requesting SSH process.
4. Use one password attempt to append the exact temporary public key to `account-admin`.
5. Verify administrator key-only access with `BatchMode=yes`, `IdentitiesOnly=yes`, and strict host-key checking.
6. Through `account-admin`, verify `FD-222398`, its home directory, Docker group membership, and passwordless administrative capability needed to install the same key.
7. Install the exact public key for `FD-222398`, preserving unrelated keys and permissions.
8. Verify deployment-account key-only access and Docker access.

Passwords must never be accepted as script parameters, command-line arguments, environment-file values, transcript text, or persistent files.

## Deployment Flow

### Preflight

- Resolve the local project root and Git `HEAD`.
- Confirm the fixed host key from known hosts before password submission.
- Confirm remote Docker `24.x` or newer and standalone Compose `2.x`.
- Inspect `/home/FD-222398/app` without mutation.
- Verify `.env.production` mode and required variable names without printing values.
- Verify the two named volumes and their backing directories:
  - `texas-holdem_postgres-data`
  - `texas-holdem_redis-data`
- Confirm sufficient bytes and inodes in the Docker data filesystem.
- Record the currently running image ID and public health status.

### Package and Upload

- Create an archive from Git `HEAD`; do not pipe a binary tar stream through PowerShell.
- Transfer the archive with `scp` to a unique remote staging directory.
- Extract remotely and copy the existing `.env.production` with mode `600`.
- Never upload `.git`, local environment files, test evidence, `node_modules`, or untracked files.

### Candidate Build

- Define `shortSha` as the first eight lowercase hexadecimal characters of Git `HEAD`.
- Build `texas-holdem-friends-room:candidate-{shortSha}` inside the staging directory.
- Leave the current containers and deployment directory unchanged while building.
- Stop if the build fails or if the candidate image cannot be inspected.

### Switch and Rollback

- Define `runId` as a UTC timestamp plus the short Git SHA, safe for paths and Docker tags.
- Tag the current image as `texas-holdem-friends-room:rollback-{runId}`.
- Rename the current app directory to `app-backup-{runId}`.
- Atomically rename the staging directory to `/home/FD-222398/app`.
- Tag the candidate image as `texas-holdem-friends-room:latest`.
- Run `docker-compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build`.
- If startup fails, move the failed directory aside, restore the backup directory and rollback image, and start the previous Compose stack.
- Do not run `docker-compose down --volumes`, `docker volume rm`, or Docker prune operations.

### Verification

- Do not keep a long-running SSH polling session after `up -d`; the remote environment can associate process cleanup with session termination.
- Poll `http://120.27.143.111:32768/api/health` and `/` from the local machine with a bounded deadline.
- Open a short SSH session only after public HTTP succeeds.
- Verify application, PostgreSQL, and Redis are healthy; the application restart count is zero; the running image ID equals the candidate image ID; migrations completed; and recent logs contain no fatal startup errors or secrets.
- Preserve the backup directory and rollback image unless the user separately requests cleanup.

## Data Safety

The deployment script must never rebuild or delete production volumes automatically. If a volume is missing, its mountpoint is absent, or a write probe cannot be proven safe, stop and report the exact condition.

Data rebuilding is a separate destructive recovery operation. It requires a new, explicit user authorization that names PostgreSQL and Redis data loss. It is deliberately excluded from the normal deployment script.

## Cleanup

Cleanup runs on success, failure, interruption, and rollback:

1. Remove the exact run-scoped key from `FD-222398` while preserving unrelated authorized keys.
2. Remove the exact run-scoped key from `account-admin`.
3. Prove both identities reject the removed key.
4. Remove only the validated local run directory.
5. Remove remote upload archives and incomplete staging directories owned by the current run.
6. If any access cleanup cannot be verified, report the deployment as incomplete even when HTTP is healthy.

## Failure Reporting

Every failure reports:

- the failed phase;
- whether production remained unchanged, switched successfully, or rolled back;
- current public HTTP status;
- whether volumes were untouched;
- retained backup, failed, or staging paths;
- temporary-key cleanup status;
- the exact safe next action.

The script must not hide nonzero SSH, SCP, Docker, Compose, health, migration, or cleanup exits.

## Testing Strategy

`test-deploy-contract.ps1` statically and behaviorally verifies:

- the fixed host, administrator, deployment account, port, directory, and Compose command;
- a masked graphical askpass flow with no password parameter;
- binary upload through an archive file and `scp`;
- candidate-before-switch ordering;
- rollback tags and directory backups;
- absence of volume deletion and prune commands;
- local public polling rather than a long SSH wait;
- exact temporary-key removal and rejection checks;
- `-WhatIf` performs no SSH, SCP, Docker, or filesystem mutation;
- failure paths return nonzero and preserve inspectable state.

Skill validation also includes:

- `quick_validate.py` for Skill metadata and structure;
- PowerShell parser validation for every `.ps1` file;
- a no-Skill baseline scenario demonstrating the known account-confusion and unsafe binary-pipeline failures;
- the same scenario with the Skill, proving selection of `account-admin → FD-222398`, candidate build, volume preservation, bounded verification, and cleanup;
- a dry-run against the real project with mocked process boundaries, never the live production host.

## Completion Criteria

The work is complete when:

1. The Skill is auto-discoverable from the personal Skill directory.
2. The normal command directly deploys without an `-Execute` flag.
3. The password is entered only through the masked `account-admin` dialog.
4. The script uses `FD-222398` for Docker deployment.
5. The script cannot automatically remove production volumes.
6. Candidate build, rollback, public verification, and exact access cleanup are implemented.
7. All contract tests, parser checks, Skill validation, and forward scenarios pass.
