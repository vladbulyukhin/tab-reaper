export function isAppleMobilePlatform(
  platform: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): boolean {
  return (
    /iPhone|iPad|iPod/.test(platform.userAgent) ||
    (platform.platform === "MacIntel" && platform.maxTouchPoints > 1)
  );
}

export function initializePopupViewport(): void {
  if (isAppleMobilePlatform(navigator)) {
    document.documentElement.dataset.popupPlatform = "ios";
  }
}
