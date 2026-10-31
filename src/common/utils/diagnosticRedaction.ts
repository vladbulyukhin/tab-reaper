export function redactDiagnosticUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin
      : parsed.protocol;
  } catch {
    return "invalid:";
  }
}

// The journal historically redacts exact "url" keys; exported reports also
// redact related fields such as favIconUrl. Keep that distinction explicit.
export function redactDiagnostics(
  value: unknown,
  policy: "journal" | "support",
  key?: string,
): unknown {
  const isUrl =
    policy === "journal" ? key === "url" : key?.toLowerCase().endsWith("url");

  if (isUrl && typeof value === "string") return redactDiagnosticUrl(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactDiagnostics(entry, policy));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDiagnostics(entryValue, policy, entryKey),
      ]),
    );
  }

  return value;
}
