// Setup guide: one panel per browser, picked with a segmented control. Without JS every panel stays visible.
const setup = document.querySelector<HTMLElement>("[data-setup]");
if (setup) {
  const tabs = [...setup.querySelectorAll<HTMLButtonElement>("[data-setup-tab]")];
  const panels = [...setup.querySelectorAll<HTMLElement>("[data-setup-panel]")];
  const select = (key: string, focus = false) => {
    for (const tab of tabs) {
      const selected = tab.dataset.setupTab === key;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.setupPanel !== key;
  };

  const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox/.test(navigator.userAgent);
  setup.classList.add("is-enhanced");
  select(isAppleMobile ? "ios" : isSafari ? "mac" : "chrome");

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => select(tab.dataset.setupTab!));
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      select(tabs[(index + step + tabs.length) % tabs.length].dataset.setupTab!, true);
    });
  }
}
