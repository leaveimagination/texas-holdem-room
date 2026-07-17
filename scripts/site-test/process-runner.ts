import { spawn as spawnChildProcess } from "node:child_process";
import type { Readable } from "node:stream";
import { EventEmitter } from "node:events";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProcessLogEntry {
  stream: "stdout" | "stderr";
  text: string;
}

export interface SpawnProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal: AbortSignal;
  shell: false;
  windowsHide: true;
  stdio: ["ignore", "pipe", "pipe"];
}

export interface SpawnedProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnProcessOptions
) => SpawnedProcess;

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  terminationGraceMs?: number;
  spawn?: SpawnProcess;
  signal?: AbortSignal;
  redact?(value: string): string;
  onLog?(entry: ProcessLogEntry): void;
}

interface ProcessErrorDetails {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
}

export class ProcessExecutionError extends Error implements ProcessErrorDetails {
  readonly command: string;
  readonly args: string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;

  constructor(
    message: string,
    details: ProcessErrorDetails & {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      cause?: unknown;
    }
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ProcessExecutionError";
    this.command = details.command;
    this.args = [...details.args];
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
  }
}

export class ProcessTimeoutError extends Error implements ProcessErrorDetails {
  readonly command: string;
  readonly args: string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly timeoutMs: number;

  constructor(message: string, details: ProcessErrorDetails & { timeoutMs: number }) {
    super(message);
    this.name = "ProcessTimeoutError";
    this.command = details.command;
    this.args = [...details.args];
    this.stdout = details.stdout;
    this.stderr = details.stderr;
    this.timeoutMs = details.timeoutMs;
  }
}

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawnChildProcess(command, args, options) as unknown as SpawnedProcess;

export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {}
): Promise<ProcessResult> {
  if (command.length === 0) {
    throw new Error("Process command must not be empty");
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("Process timeout must be a positive number of milliseconds");
  }
  const terminationGraceMs = options.terminationGraceMs ?? 1_000;
  if (!Number.isFinite(terminationGraceMs) || terminationGraceMs <= 0) {
    throw new RangeError("Process termination grace must be a positive number of milliseconds");
  }

  const processArgs = [...args];
  const controller = new AbortController();
  const redact = options.redact ?? ((value: string) => value);
  const spawn = options.spawn ?? defaultSpawn;
  let stdout = "";
  let stderr = "";
  let stdoutLogBuffer = "";
  let stderrLogBuffer = "";
  let timedOut = false;
  let settled = false;

  const streamRedactedLines = (stream: ProcessLogEntry["stream"], text: string) => {
    if (options.onLog === undefined) {
      return;
    }
    if (stream === "stdout") {
      stdoutLogBuffer += text;
      const completeThrough = stdoutLogBuffer.lastIndexOf("\n") + 1;
      if (completeThrough > 0) {
        options.onLog({
          stream,
          text: redact(stdoutLogBuffer.slice(0, completeThrough))
        });
        stdoutLogBuffer = stdoutLogBuffer.slice(completeThrough);
      }
      return;
    }

    stderrLogBuffer += text;
    const completeThrough = stderrLogBuffer.lastIndexOf("\n") + 1;
    if (completeThrough > 0) {
      options.onLog({
        stream,
        text: redact(stderrLogBuffer.slice(0, completeThrough))
      });
      stderrLogBuffer = stderrLogBuffer.slice(completeThrough);
    }
  };

  const flushRedactedLogs = () => {
    if (stdoutLogBuffer.length > 0) {
      options.onLog?.({ stream: "stdout", text: redact(stdoutLogBuffer) });
      stdoutLogBuffer = "";
    }
    if (stderrLogBuffer.length > 0) {
      options.onLog?.({ stream: "stderr", text: redact(stderrLogBuffer) });
      stderrLogBuffer = "";
    }
  };

  const child = spawn(command, processArgs, {
    cwd: options.cwd,
    env: options.env,
    signal: controller.signal,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  return await new Promise<ProcessResult>((resolve, reject) => {
    let closed = false;
    let deadlineTimer: NodeJS.Timeout;
    let escalationTimer: NodeJS.Timeout | undefined;

    const onStdoutData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      streamRedactedLines("stdout", text);
    };
    const onStderrData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      streamRedactedLines("stderr", text);
    };
    const lateErrorGuard = () => {
      // A cancelled child can emit an AbortError or kill error after settlement.
    };
    const detachOutputListeners = () => {
      child.stdout.off("data", onStdoutData);
      child.stderr.off("data", onStderrData);
    };
    const redactedFailureOutput = () => ({
      stdout: redact(stdout),
      stderr: redact(stderr)
    });
    const safelyKill = (signal: NodeJS.Signals) => {
      try {
        child.kill(signal);
      } catch {
        // Termination errors cannot replace the bounded process result.
      }
    };
    const onExternalAbort = () => terminate();
    const finish = (callback: () => void, retainLateErrorGuard = false) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadlineTimer);
      if (escalationTimer !== undefined) {
        clearTimeout(escalationTimer);
      }
      options.signal?.removeEventListener("abort", onExternalAbort);
      detachOutputListeners();
      child.off("error", onError);
      child.off("close", onClose);
      if (!retainLateErrorGuard) {
        child.off("error", lateErrorGuard);
      }
      flushRedactedLogs();
      callback();
    };
    const rejectTimeout = () =>
      finish(
        () =>
          reject(
            new ProcessTimeoutError(`Process ${command} exceeded its ${timeoutMs}ms deadline`, {
              command,
              args: processArgs,
              ...redactedFailureOutput(),
              timeoutMs
            })
          ),
        true
      );
    const onError = (error: Error) => {
      if (timedOut) {
        return;
      }
      finish(() =>
        reject(
          new ProcessExecutionError(`Failed to start process ${command}: ${redact(error.message)}`, {
            command,
            args: processArgs,
            ...redactedFailureOutput(),
            exitCode: null,
            signal: null,
            cause: error
          })
        )
      );
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      closed = true;
      if (timedOut) {
        rejectTimeout();
        return;
      }
      finish(() => {
        if (code !== 0) {
          const detail = redact(stderr.trim() || stdout.trim());
          reject(
            new ProcessExecutionError(
              `Process ${command} exited with code ${code ?? "null"}${detail ? `: ${detail}` : ""}`,
              {
                command,
                args: processArgs,
                ...redactedFailureOutput(),
                exitCode: code,
                signal
              }
            )
          );
          return;
        }
        resolve({ exitCode: code, stdout, stderr });
      });
    };
    function terminate(): void {
      if (settled || closed || timedOut) {
        return;
      }
      timedOut = true;
      controller.abort(new Error(`Process deadline exceeded after ${timeoutMs}ms`));
      if (closed) {
        return;
      }
      safelyKill("SIGTERM");
      if (closed) {
        return;
      }
      escalationTimer = setTimeout(() => {
        if (settled || closed) {
          return;
        }
        safelyKill("SIGKILL");
        rejectTimeout();
      }, terminationGraceMs);
      escalationTimer.unref?.();
    }

    child.stdout.on("data", onStdoutData);
    child.stderr.on("data", onStderrData);
    child.on("error", lateErrorGuard);
    child.on("error", onError);
    child.once("close", onClose);
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });

    deadlineTimer = setTimeout(terminate, timeoutMs);
    deadlineTimer.unref?.();
    if (options.signal?.aborted) {
      queueMicrotask(terminate);
    }
  });
}
