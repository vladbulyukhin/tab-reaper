export function displayHost(host: string): string {
  return host.replace(/^www\./, "");
}

export function hostMonogram(host: string): string {
  return displayHost(host).split(".")[0]?.charAt(0).toUpperCase() || "?";
}
