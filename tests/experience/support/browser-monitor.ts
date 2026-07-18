export interface BrowserMonitor<T = unknown> {
  result: Promise<T>;
  cancel(): Promise<void>;
}

export async function settleBrowserMonitors(
  monitors: readonly BrowserMonitor[]
): Promise<void> {
  await Promise.allSettled(monitors.map((monitor) => monitor.cancel()));
  await Promise.allSettled(monitors.map((monitor) => monitor.result));
}
