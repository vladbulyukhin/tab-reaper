export function initDebug(): void {
  if (typeof __DEBUG__ !== "undefined" && __DEBUG__) {
    try {
      // Preserve the development-only runtime flag used by diagnostic UI.
      (globalThis as typeof globalThis & { __DEBUG__?: boolean }).__DEBUG__ =
        true;
    } catch {}
  }
}

// Optional logging must never interrupt production behavior or direct imports.
export function debugLog(...values: unknown[]): void {
  if (typeof __DEBUG__ === "undefined" || !__DEBUG__) return;

  try {
    console.info(...values);
  } catch {
    // A broken development console is not an application failure.
  }
}
