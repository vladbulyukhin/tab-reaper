import type { IBrowserStorageAPI } from "../../api/IBrowserApiProvider";
import { redactDiagnostics } from "../../common/utils/diagnosticRedaction";

import type { CleanupDiagnosticEvent } from "../../common/models/CleanupDiagnostics";

const diagnosticStorageKey = "cleanupDiagnosticsEvents";
const defaultMaxEvents = 100;

function sanitizeEvent(event: CleanupDiagnosticEvent): CleanupDiagnosticEvent {
  return {
    at: event.at,
    ...(event.details
      ? {
          details: redactDiagnostics(event.details, "journal") as Record<
            string,
            unknown
          >,
        }
      : {}),
    event: event.event,
  };
}

function parseEvents(raw: unknown): CleanupDiagnosticEvent[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is CleanupDiagnosticEvent =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as CleanupDiagnosticEvent).at === "string" &&
        typeof (entry as CleanupDiagnosticEvent).event === "string" &&
        ((entry as CleanupDiagnosticEvent).details === undefined ||
          (Boolean((entry as CleanupDiagnosticEvent).details) &&
            typeof (entry as CleanupDiagnosticEvent).details === "object")),
    );
  } catch {
    return [];
  }
}

export class CleanupDiagnosticsJournal {
  private enabled: boolean;
  private memoryEvents: CleanupDiagnosticEvent[] = [];
  private pendingWrites: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: IBrowserStorageAPI,
    private readonly maxEvents = defaultMaxEvents,
    enabled = true,
  ) {
    this.enabled = enabled;
  }

  public record(event: CleanupDiagnosticEvent): void {
    if (!this.enabled) return;

    const sanitizedEvent = sanitizeEvent(event);
    this.memoryEvents = [...this.memoryEvents, sanitizedEvent].slice(
      -this.maxEvents,
    );
    this.pendingWrites = this.pendingWrites.then(async () => {
      try {
        const stored = (await this.storage.get(
          diagnosticStorageKey,
        )) as unknown as Record<string, unknown>;
        const persisted = parseEvents(stored?.[diagnosticStorageKey]);
        const events = [...persisted, sanitizedEvent].slice(-this.maxEvents);
        await this.storage.set({
          [diagnosticStorageKey]: JSON.stringify(events),
        });
        this.memoryEvents = events;
      } catch {
        // Diagnostics are best effort: storage failure must not block cleanup.
      }
    });
  }

  public async list(): Promise<ReadonlyArray<CleanupDiagnosticEvent>> {
    if (!this.enabled) return [];

    await this.pendingWrites;
    try {
      const stored = (await this.storage.get(
        diagnosticStorageKey,
      )) as unknown as Record<string, unknown>;
      const raw = stored?.[diagnosticStorageKey];
      if (raw !== undefined) {
        const events = parseEvents(raw).slice(-this.maxEvents);
        this.memoryEvents = events;
        return [...events];
      }
    } catch {}
    return [...this.memoryEvents];
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) await this.clear();
  }

  public async clear(): Promise<void> {
    this.memoryEvents = [];
    this.pendingWrites = this.pendingWrites.then(async () => {
      this.memoryEvents = [];
      try {
        await this.storage.remove(diagnosticStorageKey);
      } catch {}
    });
    await this.pendingWrites;
  }
}
