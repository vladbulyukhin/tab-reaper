import type React from "react";
import { useState } from "react";

interface ITabFaviconProps {
  readonly favIconUrl?: string | null;
  readonly pageUrl?: string | null;
  readonly title?: string | null;
}

const hostnameFromUrl = (url: string | null | undefined): string | null => {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const displayHost = (url: string | null | undefined): string | null => {
  const host = hostnameFromUrl(url);
  return !host ? null : host.replace(/^www\./, "");
};

// Second-level labels that sit under a country code, as in example.co.uk.
const genericSecondLevel = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org",
]);

// The label people recognise a site by: "wikipedia" for en.wikipedia.org,
// "mozilla" for developer.mozilla.org, "bbc" for www.bbc.co.uk.
export const siteName = (host: string): string => {
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  let index = labels.length - 2;
  if (index > 0 && genericSecondLevel.has(labels[index])) index -= 1;
  return labels[index];
};

// Safari may not supply favIconUrl for tabs. Keep initials as the local
// fallback rather than guessing a website URL and making a network request.
export const initials = (
  pageUrl: string | null | undefined,
  title: string | null | undefined,
) => {
  const host = hostnameFromUrl(pageUrl);
  const candidate = (host && siteName(host)) || title || "";
  const first = candidate.trim().charAt(0).toUpperCase();
  return first || "?";
};

const bgClassFor = (seed: string) => {
  const palette = [
    "bg-sky-100 text-sky-800",
    "bg-violet-100 text-violet-800",
    "bg-emerald-100 text-emerald-800",
    "bg-amber-100 text-amber-800",
    "bg-rose-100 text-rose-800",
    "bg-indigo-100 text-indigo-800",
    "bg-teal-100 text-teal-800",
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
};

export const TabFavicon: React.FC<ITabFaviconProps> = ({
  favIconUrl,
  pageUrl,
  title,
}) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = favIconUrl !== failedSrc ? favIconUrl : null;

  if (src) {
    return (
      <img
        src={src}
        className="w-7 h-7 rounded-lg bg-muted"
        alt=""
        aria-hidden="true"
        onError={() => setFailedSrc(src)}
      />
    );
  }

  const letter = initials(pageUrl, title);
  const host = hostnameFromUrl(pageUrl);
  // One colour per site, so every tab from the same site looks the same.
  const bgClass = bgClassFor((host && siteName(host)) || title || letter);
  return (
    <div
      className={`flex h-8 w-8 min-h-8 min-w-8 items-center justify-center rounded-xl ${bgClass} text-[11px] font-semibold`}
      aria-hidden="true"
      title={displayHost(pageUrl) ?? undefined}
    >
      {letter}
    </div>
  );
};

TabFavicon.displayName = "TabFavicon";
