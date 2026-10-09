export type SaveStatus = "idle" | "saving" | "saved" | "error";

// Serialize writes so older edits cannot overwrite newer ones.
export class SettingsAutosave<T> {
  private tail: Promise<void> = Promise.resolve();
  private revision = 0;

  constructor(
    private readonly persist: (value: T) => Promise<{ status: string }>,
    private readonly confirmed: (value: T) => void,
    private readonly status: (status: SaveStatus) => void,
  ) {}

  public save(value: T): Promise<void> {
    const revision = ++this.revision;
    this.status("saving");

    const operation = this.tail.then(async () => {
      try {
        const result = await this.persist(value);
        if (result.status !== "ok") throw new Error("Settings were not saved");

        this.confirmed(value);
        if (revision === this.revision) this.status("saved");
      } catch {
        if (revision === this.revision) this.status("error");
      }
    });

    this.tail = operation;
    return operation;
  }
}
