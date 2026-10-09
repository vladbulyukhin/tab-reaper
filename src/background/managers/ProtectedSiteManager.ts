import type { IBrowserApiProvider } from "../../api/IBrowserApiProvider";
import { SyncedValue } from "../utils/SyncedValue";

export interface IProtectedSiteManager {
  list(): Promise<ReadonlyArray<string>>;
  add(hostnameOrUrl: string): Promise<void>;
  remove(hostnameOrUrl: string): Promise<void>;
  getMatchingRule(
    hostnameOrUrl: string | null | undefined,
  ): Promise<string | null>;
  isProtectedUrl(url: string | null | undefined): Promise<boolean>;
}

const normalizeHostname = (hostname: string): string | null => {
  const trimmed = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed) return null;
  return trimmed.replace(/^\.+/, "") || null;
};

const hostnameFromInput = (hostnameOrUrl: string): string | null => {
  const raw = hostnameOrUrl.trim();
  if (!raw) return null;

  // If the user pasted a full URL, extract hostname. Otherwise treat it as a
  // hostname and validate via URL parsing.
  try {
    if (raw.includes("://")) {
      return normalizeHostname(new URL(raw).hostname);
    }
    return normalizeHostname(new URL(`https://${raw}`).hostname);
  } catch {
    return null;
  }
};

const uniqSorted = (items: ReadonlyArray<string>): ReadonlyArray<string> => {
  return Array.from(
    new Set(
      items.map((site) => normalizeHostname(site)).filter(Boolean) as string[],
    ),
  ).sort((a, b) => a.localeCompare(b));
};

const parseSites = (value: unknown): ReadonlyArray<string> | null => {
  if (
    !Array.isArray(value) ||
    !value.every((site) => typeof site === "string")
  ) {
    return null;
  }

  return uniqSorted(value);
};

const matchesHostname = (hostname: string, rule: string): boolean => {
  return hostname === rule || hostname.endsWith(`.${rule}`);
};

export class ProtectedSiteManager implements IProtectedSiteManager {
  private readonly sites: SyncedValue<ReadonlyArray<string>>;
  constructor(
    storage: Pick<IBrowserApiProvider, "syncStorage" | "localStorage">,
  ) {
    this.sites = new SyncedValue(
      storage,
      "protectedSites",
      [],
      parseSites,
      true,
    );
  }
  public list(): Promise<ReadonlyArray<string>> {
    return this.sites.get();
  }
  public async add(hostnameOrUrl: string): Promise<void> {
    const host = hostnameFromInput(hostnameOrUrl);
    if (host)
      await this.sites.update((current) => uniqSorted([...current, host]));
  }
  public async remove(hostnameOrUrl: string): Promise<void> {
    const host = hostnameFromInput(hostnameOrUrl);
    if (!host) return;
    await this.sites.update((current) => {
      const matching = this.matchingRule(current, host);
      return current.filter((rule) => rule !== matching);
    });
  }
  public async getMatchingRule(
    hostnameOrUrl: string | null | undefined,
  ): Promise<string | null> {
    if (!hostnameOrUrl) return null;
    const host = hostnameFromInput(hostnameOrUrl);
    return host ? this.matchingRule(await this.list(), host) : null;
  }
  public async isProtectedUrl(
    url: string | null | undefined,
  ): Promise<boolean> {
    return (await this.getMatchingRule(url)) !== null;
  }
  private matchingRule(
    sites: ReadonlyArray<string>,
    hostname: string,
  ): string | null {
    return sites.reduce<string | null>(
      (match, rule) =>
        matchesHostname(hostname, rule) &&
        (!match || rule.length > match.length)
          ? rule
          : match,
      null,
    );
  }
}
