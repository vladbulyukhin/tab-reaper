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

// Safari may not supply favIconUrl for tabs. Keep initials as the local
// fallback rather than guessing a website URL and making a network request.
const initials = (
  pageUrl: string | null | undefined,
  title: string | null | undefined,
) => {
  const host = displayHost(pageUrl);
  const candidate = host?.split(".")[0] ?? title ?? "";
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
  const bgClass = bgClassFor(displayHost(pageUrl) ?? title ?? letter);
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
