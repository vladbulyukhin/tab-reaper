import type React from "react";
import { useCallback, useContext, useState } from "react";
import { Badge } from "../../components/Badge";
import { Input } from "../../components/Input";
import { BackgroundCommunicationContext } from "../../contexts/BackgroundCommunication";
import { useAsyncMutation } from "../../hooks/useAsyncMutation";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { displayHost, hostMonogram } from "../../utils/hostname";

export const ProtectedSites: React.FC = () => {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const [hostnameInput, setHostnameInput] = useState("");
  const mutation = useAsyncMutation();
  const load = useCallback(async () => {
    if (!sendMessage) throw new Error("Background connection unavailable");
    const [sitesResponse, currentSiteResponse] = await Promise.all([
      sendMessage("getProtectedSites", undefined),
      sendMessage("isCurrentSiteProtected", undefined),
    ]);
    return {
      sites: sitesResponse.sites,
      currentSiteSupported: currentSiteResponse.supported,
    };
  }, [sendMessage]);
  const resource = useAsyncResource(sendMessage ? load : null);
  const sites = resource.data?.sites ?? [];
  const currentSiteSupported = resource.data?.currentSiteSupported ?? false;
  const loading = resource.loading || mutation.pending;
  const error = mutation.error ?? resource.error;
  const summary = sites.length === 1 ? "1 site" : `${sites.length} sites`;

  async function refresh() {
    mutation.clearError();
    await resource.refresh().catch(() => undefined);
  }

  async function mutate(
    operation: () => Promise<{ status: string }>,
    message: string,
  ) {
    if (loading || !sendMessage) return;

    await mutation.run(async () => {
      const result = await operation();
      if (result.status !== "ok") throw new Error(message);
      await resource.refresh();
    });
  }

  async function addCurrentSite() {
    if (!sendMessage) return;
    await mutate(
      () => sendMessage("setCurrentSiteProtected", { protected: true }),
      "Failed to protect current site.",
    );
  }

  async function addFromInput() {
    const value = hostnameInput.trim();
    if (!sendMessage || !value) return;
    await mutate(async () => {
      const response = await sendMessage("addProtectedSite", {
        hostname: value,
      });
      if (response.status === "ok") setHostnameInput("");
      return response;
    }, "Failed to add protected site.");
  }

  async function removeSite(hostname: string) {
    if (!sendMessage) return;
    await mutate(
      () => sendMessage("removeProtectedSite", { hostname }),
      "Failed to remove protected site.",
    );
  }

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Protection
          </p>
          <h4 className="text-lg font-semibold">Protected sites</h4>
          <p className="text-sm text-muted-foreground">
            Keep important domains safe from cleanup rules and duplicate
            removal.
          </p>
        </div>

        <Badge
          variant="outline"
          className="shrink-0 rounded-full bg-zinc-50 px-3 py-1 whitespace-nowrap"
        >
          {summary}
        </Badge>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-xs text-destructive">Error: {error}</p>
          <button
            type="button"
            className="mt-2 h-8 rounded-full border bg-white px-3 text-xs font-medium disabled:opacity-50"
            onClick={refresh}
            disabled={loading}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          data-testid="addCurrentProtectedSite"
          className="h-10 w-full rounded-xl border bg-foreground px-4 text-xs font-medium text-background disabled:opacity-50"
          onClick={addCurrentSite}
          disabled={loading || !currentSiteSupported}
          title="Protect the site of the currently active tab"
        >
          {currentSiteSupported
            ? "Protect current site"
            : "Open a website tab to protect it"}
        </button>
      </div>

      <div className="mt-3 rounded-2xl border bg-zinc-50/70 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Add another site
        </p>
        <div className="flex items-center gap-2">
          <Input
            data-testid="protectedSiteInput"
            value={hostnameInput}
            onChange={(e) => setHostnameInput(e.target.value)}
            placeholder="example.com"
            className="h-10 flex-1 rounded-xl bg-white"
          />
          <button
            type="button"
            data-testid="addProtectedSite"
            className="shrink-0 h-10 rounded-xl border bg-white px-4 text-xs font-medium disabled:opacity-50 whitespace-nowrap"
            onClick={addFromInput}
            disabled={loading || hostnameInput.trim().length === 0}
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {sites.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-zinc-50/70 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No protected sites yet.
            </p>
          </div>
        ) : (
          sites.map((host) => (
            <div
              key={host}
              className="flex items-center justify-between gap-3 rounded-2xl border bg-zinc-50 px-3 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-xs font-semibold text-zinc-600">
                  {hostMonogram(host)}
                </div>
                <div className="min-w-0">
                  <code className="block truncate text-sm font-medium">
                    {displayHost(host)}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Tabs on this domain will always be kept.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 h-9 rounded-full border bg-white px-3 text-xs font-medium disabled:opacity-50"
                onClick={() => removeSite(host)}
                disabled={loading}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
};

ProtectedSites.displayName = "ProtectedSites";
