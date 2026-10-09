import type React from "react";
import { Switch } from "../../../components/Switch";
import { SavedKeepRecovery } from "../components/SavedKeepRecovery";
import { currentTabPresentation } from "./currentTabPresentation";
import { useCurrentTabProtection } from "./useCurrentTabProtection";

export const CurrentTabStatus: React.FC = () => {
  const {
    resource,
    refresh,
    busy,
    error,
    toggleExcluded,
    toggleSiteProtected,
  } = useCurrentTabProtection();
  const excluded = resource.data?.excluded ?? false;
  const uncertainKeep = resource.data?.uncertainKeep ?? false;
  const siteProtected = resource.data?.siteProtected ?? false;
  const siteSupported = resource.data?.siteSupported ?? false;
  const hostname = resource.data?.hostname ?? null;
  const heading = resource.data
    ? hostname ?? "Not a website tab"
    : "Current tab";
  const presentation = currentTabPresentation(
    resource.data,
    resource.loading,
    Boolean(error),
  );

  return (
    <section className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b bg-gradient-to-br from-rose-50 via-white to-orange-50">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Current tab
            </p>
            <h2 className="mt-1 truncate text-lg font-semibold text-foreground">
              {heading}
            </h2>
          </div>

          <div
            data-testid="current-tab-status"
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${presentation.className}`}
          >
            {presentation.label}
          </div>
        </div>
      </div>

      <div className="px-4 py-2">
        {error ? (
          <p role="alert" className="py-2 text-xs text-red-700">
            Could not confirm tab protection. {error}{" "}
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => void refresh().catch(() => undefined)}
            >
              Retry
            </button>
          </p>
        ) : null}
        {uncertainKeep ? (
          <div className="py-3 text-xs text-muted-foreground">
            This tab may match a kept tab from another group or session. Cleanup
            is blocked for safety. Turn on Keep to protect it explicitly, or{" "}
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => void toggleExcluded(false)}
            >
              allow cleanup for this tab
            </button>
            .
            <SavedKeepRecovery onRecovered={refresh} />
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p
              id="current-tab-keep-label"
              className="text-sm font-medium text-foreground"
            >
              Keep this tab
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Skip only this tab. Other tabs can still be cleaned up.
            </p>
          </div>
          <Switch
            data-testid="currentTabKeepToggle"
            aria-labelledby="current-tab-keep-label"
            checked={excluded}
            onCheckedChange={toggleExcluded}
            disabled={busy || !resource.data}
          />
        </div>

        <div className="border-t" />

        <div className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p
              id="current-site-protect-label"
              className="text-sm font-medium text-foreground"
            >
              Always protect this site
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {siteSupported
                ? `Keep every tab from ${hostname} until you remove the site from protected sites.`
                : "Site protection is available only for website tabs (HTTP or HTTPS)."}
            </p>
          </div>
          <Switch
            data-testid="currentSiteProtectToggle"
            aria-labelledby="current-site-protect-label"
            checked={siteProtected}
            onCheckedChange={toggleSiteProtected}
            disabled={busy || !siteSupported}
          />
        </div>
      </div>
    </section>
  );
};

CurrentTabStatus.displayName = "CurrentTabStatus";
