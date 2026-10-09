import { useCallback, useContext } from "react";
import { BackgroundCommunicationContext } from "../../../contexts/BackgroundCommunication";
import { useAsyncMutation } from "../../../hooks/useAsyncMutation";
import { useAsyncResource } from "../../../hooks/useAsyncResource";

export function useCurrentTabProtection() {
  const { sendMessage } = useContext(BackgroundCommunicationContext);
  const mutation = useAsyncMutation();
  const load = useCallback(async () => {
    if (!sendMessage) throw new Error("Background connection unavailable");
    const [keep, site] = await Promise.all([
      sendMessage("getCurrentTabKeepState", undefined),
      sendMessage("isCurrentSiteProtected", undefined),
    ]);
    if (keep.status !== "ok") throw new Error("Keep state unavailable");
    return {
      excluded: keep.kept,
      uncertainKeep: keep.uncertain,
      siteProtected: site.protected,
      siteSupported: site.supported,
      hostname: site.hostname,
    };
  }, [sendMessage]);
  const resource = useAsyncResource(sendMessage ? load : null);
  const busy = resource.loading || mutation.pending;

  async function mutate(operation: () => Promise<{ status: string }>) {
    if (busy || !sendMessage) return;

    await mutation.run(async () => {
      const result = await operation();
      if (result.status !== "ok")
        throw new Error("Protection change was not confirmed");
      await resource.refresh();
    });
  }

  async function toggleExcluded(excluded: boolean) {
    if (!sendMessage) return;
    await mutate(() => sendMessage("setCurrentTabExcluded", { excluded }));
  }

  async function toggleSiteProtected(protectedSite: boolean) {
    if (!sendMessage) return;
    await mutate(() =>
      sendMessage("setCurrentSiteProtected", { protected: protectedSite }),
    );
  }

  async function refresh() {
    mutation.clearError();
    return resource.refresh();
  }

  return {
    resource,
    refresh,
    busy,
    error: mutation.error ?? resource.error,
    toggleExcluded,
    toggleSiteProtected,
  };
}
