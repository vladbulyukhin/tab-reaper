export function logInfo(...args: unknown[]): void {
  if (globalThis?.__DEBUG__) {
    console.info(`[tab-reaper][${new Date().toISOString()}]`, ...args);
  }
}
