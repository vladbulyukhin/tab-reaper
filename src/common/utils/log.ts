// Development-only logging. Release builds define __DEBUG__ as false, so these
// calls compile away; a broken console must never break the extension.
export function logInfo(...args: unknown[]): void {
  if (typeof __DEBUG__ === "undefined" || !__DEBUG__) return;
  try {
    console.info(`[tab-reaper][${new Date().toISOString()}]`, ...args);
  } catch {}
}
