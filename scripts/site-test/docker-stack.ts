import { join, resolve } from "node:path";

import {
  EnvironmentCleanupError,
  SITE_TEST_PROJECT_PREFIX,
  SITE_TEST_RUN_LABEL,
  createSiteTestRunIdentity,
  type SiteTestPorts,
  type SiteTestRunIdentity
} from "./contracts";
import {
  runProcess,
  type ProcessLogEntry,
  type ProcessResult,
  type RunProcessOptions
} from "./process-runner";

const REQUIRED_SERVICES = ["app", "postgres", "redis"] as const;
type SiteTestService = (typeof REQUIRED_SERVICES)[number];
const verifiedStackSnapshots = new WeakSet<DockerSiteTestStackSnapshot>();

export interface DockerProcessRunOptions
  extends Pick<
    RunProcessOptions,
    "cwd" | "env" | "timeoutMs" | "signal" | "redact" | "onLog"
  > {}

export type DockerProcessRunner = (
  command: string,
  args: readonly string[],
  options?: DockerProcessRunOptions
) => Promise<ProcessResult>;

export interface DockerContainerInspect {
  Id: string;
  Image: string;
  Config: {
    Labels: Record<string, string> | null;
  };
  State: {
    Status: string;
    Health?: {
      Status: string;
    };
  };
}

export interface DockerServiceState {
  service: SiteTestService;
  containerId: string;
  projectName: string;
  runLabel: string;
  status: string;
  health: string;
  imageId: string;
}

export interface DockerSiteTestStackSnapshot {
  runId: string;
  projectName: string;
  image: string;
  imageId: string;
  ports: SiteTestPorts;
  services: DockerServiceState[];
}

export interface DockerSiteTestStackOptions {
  runId: string;
  rootDirectory: string;
  ports: SiteTestPorts;
  postgresPassword: string;
  image?: string;
  run?: DockerProcessRunner;
  onLog?(entry: ProcessLogEntry): void;
}

export function assertVerifiedDockerSiteTestStackSnapshot(
  snapshot: DockerSiteTestStackSnapshot
): void {
  if (!verifiedStackSnapshots.has(snapshot)) {
    throw new Error(
      "Docker stack snapshot was not issued by a verified Docker site test stack lifecycle"
    );
  }
}

export class DockerSiteTestStack {
  readonly identity: SiteTestRunIdentity;
  readonly projectName: string;
  readonly ports: SiteTestPorts;

  private readonly rootDirectory: string;
  private readonly productionComposePath: string;
  private readonly experienceComposePath: string;
  private readonly postgresPassword: string;
  private readonly image: string;
  private readonly run: DockerProcessRunner;
  private readonly onLog?: (entry: ProcessLogEntry) => void;
  private signal?: AbortSignal;
  private recorded?: DockerSiteTestStackSnapshot;

  constructor(options: DockerSiteTestStackOptions) {
    this.identity = createSiteTestRunIdentity(options.runId);
    this.projectName = this.identity.projectName;
    this.ports = validatePorts(options.ports);
    this.rootDirectory = resolve(options.rootDirectory);
    this.productionComposePath = join(this.rootDirectory, "docker-compose.prod.yml");
    this.experienceComposePath = join(this.rootDirectory, "docker-compose.experience.yml");
    this.postgresPassword = requireNonempty(options.postgresPassword, "PostgreSQL password");
    this.image = requireNonempty(
      options.image ?? process.env.SITE_TEST_IMAGE ?? "texas-holdem-friends-room:latest",
      "Site test image"
    );
    this.run = options.run ?? runProcess;
    this.onLog = options.onLog;
  }

  async start(signal?: AbortSignal): Promise<DockerSiteTestStackSnapshot> {
    if (this.recorded !== undefined) {
      throw new Error(`Site test stack ${this.projectName} has already been started`);
    }

    this.signal = signal;
    const imageResult = await this.run(
      "docker",
      ["image", "inspect", "--format", "{{.Id}}", this.image],
      this.processOptions(30_000)
    );
    const imageId = requireNonempty(imageResult.stdout.trim(), "Docker image ID");

    try {
      await this.run(
        "docker",
        this.composeArgs([
          "up",
          "--detach",
          "--wait",
          "--wait-timeout",
          "180",
          "--no-build",
          "--pull",
          "never"
        ]),
        this.processOptions(195_000)
      );
    } catch (error) {
      await this.recordPartialOwnership(imageId);
      throw error;
    }

    const services = await this.inspect();
    const snapshot: DockerSiteTestStackSnapshot = {
      runId: this.identity.runId,
      projectName: this.projectName,
      image: this.image,
      imageId,
      ports: { ...this.ports },
      services
    };
    this.recorded = snapshot;
    validateStartState(snapshot);
    const verifiedSnapshot = cloneAndFreezeSnapshot(snapshot);
    verifiedStackSnapshots.add(verifiedSnapshot);
    return verifiedSnapshot;
  }

  async inspect(): Promise<DockerServiceState[]> {
    const idsResult = await this.run(
      "docker",
      this.composeArgs(["ps", "--all", "--quiet"]),
      this.processOptions(30_000)
    );
    const containerIds = idsResult.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (containerIds.length === 0) {
      throw new Error(`No containers found for isolated Compose project ${this.projectName}`);
    }
    if (new Set(containerIds).size !== containerIds.length) {
      throw new Error(`Docker returned duplicate container IDs for ${this.projectName}`);
    }

    const inspectResult = await this.run(
      "docker",
      ["inspect", ...containerIds],
      this.processOptions(30_000)
    );
    const containers = parseDockerInspection(inspectResult.stdout);
    const inspectedIds = containers.map((container) => container.Id);
    if (!sameStringSet(containerIds, inspectedIds)) {
      throw new Error(`Docker inspection did not match the container IDs for ${this.projectName}`);
    }

    const services = containers.map((container) => this.toServiceState(container));
    const serviceNames = services.map((service) => service.service);
    if (!sameStringSet(REQUIRED_SERVICES, serviceNames)) {
      throw new Error(
        `Expected exactly app, postgres, and redis for ${this.projectName}; received ${serviceNames.join(", ")}`
      );
    }

    return REQUIRED_SERVICES.map((required) => {
      const service = services.find((candidate) => candidate.service === required);
      if (service === undefined) {
        throw new Error(`Missing required service ${required}`);
      }
      return service;
    });
  }

  async collectDiagnostics(signal?: AbortSignal): Promise<string> {
    this.signal = signal;
    const result = await this.run(
      "docker",
      this.composeArgs(["logs", "--no-color", "--timestamps"]),
      this.processOptions(60_000)
    );
    return (result.stdout + result.stderr).replaceAll(this.postgresPassword, "[REDACTED]");
  }

  get recordedSnapshot(): DockerSiteTestStackSnapshot | undefined {
    return this.recorded === undefined ? undefined : cloneAndFreezeSnapshot(this.recorded);
  }

  async stop(signal?: AbortSignal): Promise<void> {
    this.signal = signal;
    const recorded = this.recorded;
    if (recorded === undefined) {
      throw new EnvironmentCleanupError(
        `Refusing to tear down ${this.projectName}: no successfully recorded stack ownership exists`
      );
    }

    this.validateRecordedOwnership(recorded);

    let current: DockerServiceState[];
    try {
      current = await this.inspect();
    } catch (error) {
      throw new EnvironmentCleanupError(
        `Refusing to tear down ${recorded.projectName}: current ownership could not be proven`,
        { cause: error }
      );
    }

    const recordedIds = recorded.services.map((service) => service.containerId);
    const currentIds = current.map((service) => service.containerId);
    if (!sameStringSet(recordedIds, currentIds)) {
      throw new EnvironmentCleanupError(
        `Refusing to tear down ${recorded.projectName}: current container IDs differ from the recorded stack`
      );
    }
    for (const service of current) {
      if (service.projectName !== recorded.projectName || service.runLabel !== recorded.runId) {
        throw new EnvironmentCleanupError(
          `Refusing to tear down ${recorded.projectName}: Compose ownership labels changed`
        );
      }
    }

    await this.run(
      "docker",
      this.composeArgs(["down", "--volumes"]),
      this.processOptions(120_000)
    );
    this.recorded = undefined;
  }

  private toServiceState(container: DockerContainerInspect): DockerServiceState {
    const labels = container.Config.Labels ?? {};
    const service = labels["com.docker.compose.service"];
    if (!isSiteTestService(service)) {
      throw new Error(`Container ${container.Id} has an unexpected Compose service label: ${service}`);
    }
    const projectName = labels["com.docker.compose.project"];
    const runLabel = labels[SITE_TEST_RUN_LABEL];
    if (projectName !== this.projectName) {
      throw new Error(
        `Container ${container.Id} has Compose project ${projectName}; expected ${this.projectName}`
      );
    }
    if (runLabel !== this.identity.runLabel) {
      throw new Error(
        `Container ${container.Id} has site test run label ${runLabel}; expected ${this.identity.runLabel}`
      );
    }

    return {
      service,
      containerId: container.Id,
      projectName,
      runLabel,
      status: container.State.Status,
      health: container.State.Health?.Status ?? "missing",
      imageId: container.Image
    };
  }

  private async recordPartialOwnership(imageId: string): Promise<void> {
    try {
      const services = await this.inspect();
      this.recorded = {
        runId: this.identity.runId,
        projectName: this.projectName,
        image: this.image,
        imageId,
        ports: { ...this.ports },
        services
      };
    } catch {
      // Cleanup remains forbidden when exact current ownership cannot be proven.
    }
  }

  private validateRecordedOwnership(recorded: DockerSiteTestStackSnapshot): void {
    const exactExpectedName = `${SITE_TEST_PROJECT_PREFIX}${recorded.runId}`;
    if (
      recorded.projectName !== this.projectName ||
      recorded.projectName !== exactExpectedName ||
      recorded.projectName === "texas-holdem" ||
      !recorded.projectName.startsWith(SITE_TEST_PROJECT_PREFIX) ||
      recorded.runId !== this.identity.runLabel
    ) {
      throw new EnvironmentCleanupError(
        `Refusing to tear down project ${recorded.projectName}: recorded project identity is not exact`
      );
    }
    for (const service of recorded.services) {
      if (service.projectName !== recorded.projectName || service.runLabel !== recorded.runId) {
        throw new EnvironmentCleanupError(
          `Refusing to tear down ${recorded.projectName}: recorded Compose ownership labels are inconsistent`
        );
      }
    }
  }

  private composeArgs(commandArgs: readonly string[]): string[] {
    return [
      "compose",
      "--project-name",
      this.projectName,
      "-f",
      this.productionComposePath,
      "-f",
      this.experienceComposePath,
      ...commandArgs
    ];
  }

  private processOptions(timeoutMs: number): DockerProcessRunOptions {
    return {
      cwd: this.rootDirectory,
      env: {
        ...process.env,
        APP_PORT: String(this.ports.app),
        APP_ORIGIN: `http://127.0.0.1:${this.ports.app}`,
        POSTGRES_PASSWORD: this.postgresPassword,
        SITE_TEST_APP_PORT: String(this.ports.app),
        SITE_TEST_POSTGRES_PORT: String(this.ports.postgres),
        SITE_TEST_REDIS_PORT: String(this.ports.redis),
        SITE_TEST_IMAGE: this.image,
        SITE_TEST_RUN_ID: this.identity.runId
      },
      timeoutMs,
      signal: this.signal,
      redact: (value) => value.replaceAll(this.postgresPassword, "[REDACTED]"),
      onLog: this.onLog
    };
  }
}

function validateStartState(snapshot: DockerSiteTestStackSnapshot): void {
  for (const service of snapshot.services) {
    if (service.status !== "running" || service.health !== "healthy") {
      throw new Error(
        `Service ${service.service} is not healthy (status=${service.status}, health=${service.health})`
      );
    }
  }
  const app = snapshot.services.find((service) => service.service === "app");
  if (app?.imageId !== snapshot.imageId) {
    throw new Error(
      `Isolated app container does not use the inspected immutable image ID ${snapshot.imageId}`
    );
  }
}

function parseDockerInspection(value: string): DockerContainerInspect[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("Docker inspect returned invalid JSON", { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Docker inspect did not return an array");
  }
  return parsed as DockerContainerInspect[];
}

function validatePorts(ports: SiteTestPorts): SiteTestPorts {
  const values = [ports.app, ports.postgres, ports.redis];
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
      throw new RangeError(`Invalid site test port: ${value}`);
    }
  }
  if (new Set(values).size !== values.length) {
    throw new Error("The app, PostgreSQL, and Redis must use three distinct host ports");
  }
  return { ...ports };
}

function requireNonempty(value: string, field: string): string {
  const result = value.trim();
  if (result.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return result;
}

function isSiteTestService(value: string | undefined): value is SiteTestService {
  return REQUIRED_SERVICES.some((service) => service === value);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function cloneAndFreezeSnapshot(snapshot: DockerSiteTestStackSnapshot): DockerSiteTestStackSnapshot {
  const ports = Object.freeze({ ...snapshot.ports });
  const services = Object.freeze(
    snapshot.services.map((service) => Object.freeze({ ...service }))
  );
  return Object.freeze({
    ...snapshot,
    ports,
    services
  }) as DockerSiteTestStackSnapshot;
}
