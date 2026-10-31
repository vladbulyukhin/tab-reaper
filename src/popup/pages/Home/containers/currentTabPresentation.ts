type TabPresentationState = {
  excluded: boolean;
  uncertainKeep: boolean;
  siteProtected: boolean;
};

export function currentTabPresentation(
  state: TabPresentationState | null,
  loading: boolean,
  failed: boolean,
) {
  if (!state) {
    return {
      label: failed ? "Status unavailable" : "Loading…",
      className: "bg-zinc-100 text-zinc-600",
    };
  }
  if (state.uncertainKeep)
    return { label: "Safety hold", className: "bg-amber-50 text-amber-700" };
  if (state.excluded)
    return { label: "Tab kept", className: "bg-amber-50 text-amber-700" };
  if (state.siteProtected)
    return { label: "Site protected", className: "bg-sky-50 text-sky-700" };
  return {
    label: loading ? "Updating…" : "Tab eligible",
    className: "bg-emerald-50 text-emerald-700",
  };
}
