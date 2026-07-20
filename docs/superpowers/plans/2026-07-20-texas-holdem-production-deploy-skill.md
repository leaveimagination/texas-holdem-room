# Texas Hold'em Production Deploy Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install a personal Codex Skill with a directly executable PowerShell orchestrator for safe deployment of the Texas Hold'em project to its fixed production host.

**Architecture:** A concise `SKILL.md` routes deployment requests to one PowerShell entrypoint. The entrypoint owns configuration, graphical SSH bootstrap, Git archive transfer, remote candidate build, rollback-aware switch, local public verification, and exact key cleanup; a separate contract test parses and exercises the script without contacting production.

**Tech Stack:** PowerShell 5.1+, WinForms, Windows OpenSSH (`ssh`, `scp`, `ssh-keygen`), Git, remote Docker 24.x, standalone Docker Compose 2.x, Python Skill validation.

## Global Constraints

- Install under `C:\Users\admin\.codex\skills\deploying-texas-holdem-production`.
- Use `account-admin@120.27.143.111` only for graphical bootstrap and privileged key installation.
- Use `FD-222398@120.27.143.111` for Docker deployment under `/home/FD-222398/app`.
- Publish only `http://120.27.143.111:32768`.
- Run standalone `docker-compose`, not `docker compose`.
- Normal invocation deploys immediately; `-WhatIf` is explicitly read-only.
- Never accept a password parameter or persist a password.
- Never delete or rebuild `texas-holdem_postgres-data` or `texas-holdem_redis-data`.
- Package only Git `HEAD` into a file and transfer it with `scp`; never pipe binary tar through PowerShell.
- Build a candidate image before switching and retain rollback image plus old app directory.
- Poll public HTTP locally; never keep a long SSH health-wait session.
- Remove and prove rejection of both temporary SSH authorizations on every terminal path.

---

### Task 1: Capture the Failing Contract and Initialize the Skill

**Files:**
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\SKILL.md`
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\agents\openai.yaml`
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\test-deploy-contract.ps1`
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\references\baseline-failures.md`

**Interfaces:**
- Consumes: the approved design and the observed failed deployment transcript.
- Produces: a scaffolded Skill folder and a contract test whose `$DeployScript` target is `scripts\deploy.ps1`.

- [ ] **Step 1: Record the no-Skill baseline failures**

Write `references\baseline-failures.md` with these mechanically observed failures: confused `root`, `admin`, `account-admin`, and `FD-222398`; corrupted a binary Git archive through a PowerShell pipeline; held a remote SSH wait until timeout; and considered volume reconstruction before proving the volume mountpoint.

- [ ] **Step 2: Initialize the Skill**

Run:

```powershell
python C:\Users\admin\.codex\skills\.system\skill-creator\scripts\init_skill.py deploying-texas-holdem-production --path C:\Users\admin\.codex\skills --resources scripts,references --interface "display_name=Deploy Texas Hold'em Production" --interface "short_description=Safely deploy the fixed Texas Hold'em production stack" --interface "default_prompt=Deploy the Texas Hold'em project to its production Docker host using the verified workflow."
```

Expected: the Skill directory, `SKILL.md`, `agents\openai.yaml`, `scripts`, and `references` exist.

- [ ] **Step 3: Write the failing contract test**

The test must parse every `.ps1` file, require `deploy.ps1`, and assert these literal contracts:

```powershell
$source | Should -Match 'account-admin'
$source | Should -Match 'FD-222398'
$source | Should -Match '120\.27\.143\.111'
$source | Should -Match '32768'
$source | Should -Match 'docker-compose'
$source | Should -Match 'SSH_ASKPASS_REQUIRE'
$source | Should -Match 'candidate-'
$source | Should -Match 'rollback-'
$source | Should -Match 'git archive'
$source | Should -Match '\bscp\b'
$source | Should -Not -Match 'docker volume rm|down\s+--volumes|system prune'
$source | Should -Not -Match 'param\s*\([^)]*Password'
```

Implement the test as a standalone PowerShell script that accumulates failures and exits `1`, avoiding a Pester dependency.

- [ ] **Step 4: Run the test and verify RED**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\test-deploy-contract.ps1
```

Expected: exit `1` with `deploy.ps1 is missing`.

---

### Task 2: Implement Configuration, Project Validation, and Graphical Bootstrap

**Files:**
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\deploy.ps1`
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\ssh-askpass.ps1`
- Modify: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\test-deploy-contract.ps1`

**Interfaces:**
- Consumes: `-ProjectRoot [string]`, `-WhatIf [switch]`, and `-AllowDirtyTrackedFiles [switch]`.
- Produces: `New-RunContext`, `Assert-LocalProject`, `Invoke-CheckedProcess`, `Grant-TemporaryAccess`, and `Revoke-TemporaryAccess` functions.

- [ ] **Step 1: Extend the failing test for configuration and askpass**

Require a `Get-DeploymentConfig` function returning exactly:

```powershell
@{
    Host = '120.27.143.111'
    AdminUser = 'account-admin'
    DeployUser = 'FD-222398'
    RemoteApp = '/home/FD-222398/app'
    PublicPort = 32768
    ComposeCommand = 'docker-compose'
}
```

Require `ssh-askpass.ps1` to use `System.Windows.Forms`, `UseSystemPasswordChar = $true`, and no filesystem writes.

- [ ] **Step 2: Run the test and verify RED**

Expected: exit `1` naming missing configuration and askpass contracts.

- [ ] **Step 3: Implement minimal local validation and askpass**

Implement:

```powershell
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$AllowDirtyTrackedFiles
)
```

Resolve the root with `[IO.Path]::GetFullPath`, require the four project markers, read `git rev-parse HEAD`, enforce an eight-character lowercase `shortSha`, and reject dirty tracked output from `git status --porcelain --untracked-files=no` unless allowed.

`ssh-askpass.ps1` must show a topmost fixed dialog labeled `account-admin@120.27.143.111`, use a masked textbox, write only the submitted password to stdout, clear the textbox, and exit nonzero on cancel.

- [ ] **Step 4: Implement temporary key authorization**

Generate a run directory beneath `[IO.Path]::GetTempPath()` with leaf `texas-holdem-deploy-{runId}`. Generate ED25519 key comment `codex-texas-holdem-deploy-{runId}`. Force graphical askpass for one administrator password attempt, verify administrator key login, inspect `FD-222398`, and install the exact public key through stdin using administrator `sudo`.

- [ ] **Step 5: Run the contract and parser checks**

Expected: all Task 2 checks pass while later deployment checks still fail.

---

### Task 3: Implement Preflight, Archive Transfer, and Candidate Build

**Files:**
- Modify: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\deploy.ps1`
- Modify: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\test-deploy-contract.ps1`

**Interfaces:**
- Consumes: validated run context and deployment-account SSH key.
- Produces: `Assert-RemotePreflight`, `New-GitArchive`, `Send-StagingArchive`, and `Build-CandidateImage`.

- [ ] **Step 1: Add failing tests for protected data and binary transfer**

Require the script to inspect exact volume names and labels, check mountpoint existence, use `git archive --output=... HEAD`, call `scp`, and reject these patterns:

```text
git archive ... | ssh
docker volume rm
docker-compose down --volumes
docker system prune
docker builder prune
```

- [ ] **Step 2: Run the test and verify RED**

Expected: exit `1` for missing preflight, archive, and candidate functions.

- [ ] **Step 3: Implement remote preflight**

Verify Docker, standalone Compose, `/home/FD-222398/app`, `.env.production` mode `600`, Compose project labels, both named volumes, both volume mountpoints, free bytes, free inodes, and absence of the run-specific staging and backup paths. Never print environment values.

- [ ] **Step 4: Implement file archive and SCP upload**

Create `source-{shortSha}.tar` in the validated run directory using `git archive --format=tar --output=$archivePath HEAD`. Create the unique remote staging directory, send the archive with `scp`, extract it, delete the remote archive, and copy `.env.production` with mode `600`.

- [ ] **Step 5: Implement candidate build**

Build `texas-holdem-friends-room:candidate-{shortSha}` in staging and inspect the resulting image ID. Do not tag `latest`, rename directories, or invoke Compose in this function.

- [ ] **Step 6: Run tests and verify GREEN for Task 3**

Expected: protected-data and transfer tests pass; no forbidden command is present.

---

### Task 4: Implement Switch, Rollback, Public Verification, and Cleanup

**Files:**
- Modify: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\deploy.ps1`
- Modify: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\test-deploy-contract.ps1`

**Interfaces:**
- Consumes: candidate image ID and run context.
- Produces: `Switch-Production`, `Restore-Rollback`, `Wait-PublicHealth`, `Assert-RemoteRuntime`, and `Complete-Cleanup`.

- [ ] **Step 1: Add failing lifecycle tests**

Assert candidate build text precedes `Switch-Production`; rollback tags and `app-backup-{runId}` exist; `Wait-PublicHealth` uses local `curl.exe`; no SSH command contains a health polling loop; cleanup runs from `finally`; and key-rejection checks require nonzero exits.

- [ ] **Step 2: Run the test and verify RED**

Expected: exit `1` naming the missing lifecycle contracts.

- [ ] **Step 3: Implement switch and rollback**

Save the current image under `rollback-{runId}`, move `app` to `app-backup-{runId}`, move staging to `app`, tag candidate as `latest`, and call `docker-compose --env-file .env.production -f docker-compose.prod.yml up -d --no-build`. On nonzero exit, move the failed app aside, restore the backup and rollback tag, start the previous stack, and return nonzero.

- [ ] **Step 4: Implement bounded local verification**

Poll `/api/health` and `/` with `curl.exe --max-time 5` for at most 90 seconds. After HTTP succeeds, open one short deployment SSH call to verify Compose health, application restart count, image ID equality, migration completion, and recent fatal-log absence.

- [ ] **Step 5: Implement exact cleanup in `finally`**

Remove the run key first from `FD-222398`, then `account-admin`, matching the exact key comment. Verify both key-only connections exit `255`. Remove only the validated local run directory and current-run remote archive or incomplete staging directory. A cleanup verification failure must force the overall exit nonzero.

- [ ] **Step 6: Run the complete contract test**

Expected: `PASS` with zero failures.

---

### Task 5: Write the Skill Guidance and Interface Metadata

**Files:**
- Modify: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\SKILL.md`
- Create: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\references\production-contract.md`
- Regenerate: `C:\Users\admin\.codex\skills\deploying-texas-holdem-production\agents\openai.yaml`

**Interfaces:**
- Consumes: the verified script contract.
- Produces: an auto-discoverable Skill whose normal action runs `deploy.ps1` directly.

- [ ] **Step 1: Write a failing metadata check**

Require frontmatter name `deploying-texas-holdem-production`, a third-person description beginning `Use when`, and body instructions that explicitly run the script, surface password popup timing, forbid manual command reconstruction, and link `references/production-contract.md`.

- [ ] **Step 2: Run and verify RED**

Expected: exit `1` against the generated placeholder Skill.

- [ ] **Step 3: Write minimal Skill guidance**

Keep `SKILL.md` below 500 words. Route any request to deploy, update, restart, publish, or recover this exact poker production site to the bundled script. Require reading the production contract before destructive recovery. State that normal deployment is direct and `-WhatIf` is for inspection only.

- [ ] **Step 4: Write the production contract reference**

Document the fixed identity table, phases, stop conditions, output contract, rollback locations, and separate destructive data-rebuild authorization. Do not duplicate script internals line by line.

- [ ] **Step 5: Regenerate interface metadata**

Read `skill-creator/references/openai_yaml.md`, then run `generate_openai_yaml.py` with the approved display name, short description, and default prompt.

- [ ] **Step 6: Run contract and Skill validation**

Expected: metadata checks pass and `quick_validate.py` returns success.

---

### Task 6: Verify Dry-Run Behavior and Complete the Skill

**Files:**
- Modify if required: Skill files from Tasks 1–5.

**Interfaces:**
- Consumes: completed Skill and the real project worktree.
- Produces: parser, contract, dry-run, and discovery evidence without touching production.

- [ ] **Step 1: Parse every PowerShell file**

Run `[System.Management.Automation.Language.Parser]::ParseFile` for each `.ps1` and fail on any parse error.

- [ ] **Step 2: Run the standalone contract test**

Expected: exit `0` and `PASS`.

- [ ] **Step 3: Run `deploy.ps1 -WhatIf` against the real worktree**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Users\admin\.codex\skills\deploying-texas-holdem-production\scripts\deploy.ps1 -ProjectRoot C:\Users\admin\Documents\liubai\.worktrees\texas-holdem-main -WhatIf
```

Expected: prints resolved host, identity chain, commit, candidate name, staging path, backup path, and public URL; creates no key, SSH, SCP, remote, Docker, or project changes.

- [ ] **Step 4: Validate the Skill folder**

Run:

```powershell
python C:\Users\admin\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\admin\.codex\skills\deploying-texas-holdem-production
```

Expected: validation success.

- [ ] **Step 5: Verify discovery and completion criteria**

Confirm the Skill appears in the personal Skill catalog on a fresh task, every approved design criterion maps to a passing assertion, and no secret or private key remains under the Skill folder or project worktree.

- [ ] **Step 6: Report installation**

Provide clickable links to `SKILL.md`, `deploy.ps1`, `test-deploy-contract.ps1`, and the design/plan. State that the personal Skill directory is not a Git repository, so the implementation is installed and validated locally while the design and plan are versioned in the project branch.
