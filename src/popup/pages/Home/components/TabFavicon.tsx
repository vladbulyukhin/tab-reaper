import type React from "react";
import { useState } from "react";

interface ITabFaviconProps {
  readonly url: string | undefined;
}

export const TabFavicon: React.FC<ITabFaviconProps> = ({ url }) => {
  const [usePlaceholder, setUsePlaceholder] = useState(false);

  return !usePlaceholder && url ? (
    <img
      src={url}
      className="w-6 h-6 rounded-lg"
      alt="Favicon"
      onError={() => setUsePlaceholder(true)}
    />
  ) : (
    <div className="w-6 h-6 min-w-6 min-h-6 bg-gray-200 rounded-lg" />
  );
};

TabFavicon.displayName = "TabFavicon";
