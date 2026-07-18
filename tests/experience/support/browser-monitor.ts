export interface BrowserMonitor<T = unknown> {
  result: Promise<T>;
  cancel(): Promise<void>;
}

export function createBrowserMonitorLifecycle<T>(input: {
  observe(signal: AbortSignal): Promise<T>;
  cancelBrowser(): Promise<void>;
  cleanupBrowser(): Promise<void>;
}): BrowserMonitor<T> {
  const controller = new AbortController();
  const result = input.observe(controller.signal).finally(input.cleanupBrowser);
  void result.catch(() => undefined);
  return {
    result,
    cancel: async () => {
      controller.abort(new Error("Browser monitor cancelled"));
      await input.cancelBrowser();
    }
  };
}

export async function settleBrowserMonitors(
  monitors: readonly BrowserMonitor[]
): Promise<void> {
  await Promise.allSettled(monitors.map((monitor) => monitor.cancel()));
  await Promise.allSettled(monitors.map((monitor) => monitor.result));
}
