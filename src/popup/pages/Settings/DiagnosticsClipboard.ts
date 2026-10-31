import { redactDiagnostics } from "../../../common/utils/diagnosticRedaction";

type ClipboardWriter = Pick<Clipboard, "writeText">;

export function sanitizeDiagnosticsForSupport(
  value: unknown,
  key?: string,
): unknown {
  return redactDiagnostics(value, "support", key);
}

export async function copyJsonToClipboard(
  value: unknown,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<void> {
  if (!clipboard) {
    throw new Error("Clipboard is unavailable");
  }

  await clipboard.writeText(JSON.stringify(value, null, 2));
}
