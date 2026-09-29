import type React from "react";
import { useContext, useState } from "react";
import { Label } from "../../../components/Label";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";

export const SweepDuplicates: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onClick = async () => {
    if (!sendMessage || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const { closed, kept } = await sendMessage("sweepDuplicates", undefined);
      setResult(
        closed === 0
          ? `No duplicates (${kept} unique)`
          : `Closed ${closed} · kept ${kept}`,
      );
    } catch {
      setResult("Failed to sweep");
    } finally {
      setBusy(false);
      setTimeout(() => setResult(null), 4000);
    }
  };

  return (
    <div className="px-3 py-4 border-b">
      <div className="flex flex-row items-center justify-between gap-20">
        <div className="flex flex-col gap-1">
          <Label>Sweep duplicates now</Label>
          <p className="text-sm text-muted-foreground">
            Close duplicate tabs in this window. Pinned, grouped, and audible
            tabs are kept.
          </p>
          {result && (
            <p className="text-xs text-muted-foreground mt-1">{result}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {busy ? "Sweeping…" : "Sweep"}
        </button>
      </div>
    </div>
  );
};

SweepDuplicates.displayName = "SweepDuplicates";
