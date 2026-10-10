import { TabDemo, dropElement } from "./demo";

const CHROME_URL = "https://chromewebstore.google.com/detail/lpdcbkckljbnkjbajmjhehdilncjjgii";
// Set to the App Store listing once the Safari version ships; every Safari CTA switches over.
const SAFARI_URL = "";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|FxiOS|Firefox/.test(navigator.userAgent);
const prefersSafari = isAppleMobile || isSafari;

// Calls to action: lead with the visitor's own browser.
for (const group of document.querySelectorAll<HTMLElement>("[data-cta]")) {
  const chrome = group.querySelector<HTMLAnchorElement>("[data-cta-chrome]");
  const safari = group.querySelector<HTMLAnchorElement>("[data-cta-safari]");
  if (!chrome || !safari) continue;
  if (SAFARI_URL) {
    safari.href = SAFARI_URL;
    safari.target = "_blank";
    safari.rel = "noreferrer";
    safari.querySelector("span")!.textContent = "Get it for Safari";
  }
  if (prefersSafari) {
    group.prepend(safari);
    safari.classList.replace("secondary", "primary");
    chrome.classList.replace("primary", "secondary");
    if (!SAFARI_URL) safari.querySelector("span")!.textContent = "Coming soon to Safari";
  }
}
const navInstall = document.querySelector<HTMLAnchorElement>('[data-install="nav"]');
if (navInstall && prefersSafari) {
  navInstall.href = SAFARI_URL || "#get";
  navInstall.textContent = SAFARI_URL ? "Get for Safari" : "Safari · soon";
  if (!SAFARI_URL) navInstall.removeAttribute("target");
} else if (navInstall) {
  navInstall.href = CHROME_URL;
}

// Platforms section: the visitor's own browser comes first.
const platformCards = document.querySelector<HTMLElement>("[data-platform-cards]");
const safariCard = platformCards?.querySelector<HTMLElement>('[data-platform="safari"]');
const chromeCard = platformCards?.querySelector<HTMLElement>('[data-platform="chrome"]');
const platformsLede = document.querySelector<HTMLElement>("[data-platforms-lede]");
if (safariCard && SAFARI_URL) {
  safariCard.classList.add("is-live");
  safariCard.querySelector("[data-safari-status]")!.textContent = "Available now";
  const link = document.createElement("a");
  link.className = "button secondary small";
  link.href = SAFARI_URL;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Get it on the App Store ↗";
  safariCard.querySelector("[data-safari-card-link]")!.replaceWith(link);
  if (platformsLede) platformsLede.textContent = "Available for Chrome on desktop and Safari on Mac, iPhone and iPad. Same rules everywhere.";
}
if (platformCards && safariCard && chromeCard && prefersSafari) {
  platformCards.prepend(safariCard);
  if (SAFARI_URL) {
    safariCard.querySelector(".button")!.classList.replace("secondary", "primary");
    chromeCard.querySelector(".button")!.classList.replace("primary", "secondary");
  }
  if (platformsLede && !SAFARI_URL) platformsLede.textContent = "Coming soon to Safari on Mac, iPhone and iPad, and available now for Chrome on desktop. Same rules everywhere.";
}

// Hero demo: runs only while visible, the page is in the foreground, and the visitor hasn't paused it.
const demoRoot = document.querySelector<HTMLElement>("[data-demo]");
if (demoRoot) {
  const demo = new TabDemo(demoRoot);
  let visible = false;
  let paused = false;
  const update = () => (visible && !paused && !document.hidden ? demo.start() : demo.stop());
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }).observe(demoRoot);
  document.addEventListener("visibilitychange", update);
  const toggle = demoRoot.querySelector<HTMLButtonElement>("[data-motion-toggle]");
  toggle?.addEventListener("click", () => {
    paused = !paused;
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.textContent = paused ? "Resume demo" : "Pause demo";
    update();
  });
}

const onceInView = (element: Element, callback: () => void, threshold = 0.5) => {
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    callback();
  }, { threshold });
  observer.observe(element);
};

// "You have 47 tabs open": the count piles up as it scrolls in.
const countdown = document.querySelector<HTMLElement>("[data-countdown]");
if (countdown && !reducedMotion) {
  const target = Number(countdown.textContent);
  countdown.textContent = "9";
  onceInView(countdown, () => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / 1800, 1);
      countdown.textContent = String(Math.round(9 + (target - 9) * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 1);
}

// Promise vignettes loop only while on screen.
const vignetteObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) entry.target.classList.toggle("in-view", entry.isIntersecting);
}, { threshold: 0.4 });
for (const vignette of document.querySelectorAll("[data-vignette]")) vignetteObserver.observe(vignette);

// Final call to action: stray tabs keep wandering in and getting reaped; the strip stays calm.
const strays = [
  ["Article", "#a77bd6", "idle 5 days"],
  ["Search results", "#7d8590", "duplicate"],
  ["Rabbit hole", "#6b7b8c", "idle 2 days"],
  ["Weather", "#3ba1e6", "idle 1 day"],
  ["Docs", "#5b8def", "duplicate"],
  ["Sourdough", "#4fae84", "idle 4 days"],
] as const;
const calm = document.querySelector<HTMLElement>("[data-calm]");
if (calm && !reducedMotion) {
  let visible = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let strayIndex = 0;
  const wait = (ms: number, next: () => void) => { pending = setTimeout(() => { pending = undefined; if (visible && !document.hidden) next(); }, ms); };
  const cycle = () => {
    const [title, color, reason] = strays[strayIndex++ % strays.length];
    const tab = document.createElement("span");
    tab.className = "v-tab is-hidden";
    tab.innerHTML = `<i class="fav" style="--fav:${color}">${title[0]}</i>${title}`;
    calm.append(tab);
    requestAnimationFrame(() => requestAnimationFrame(() => tab.classList.remove("is-hidden")));
    wait(2400, () => {
      tab.classList.add("is-marked");
      tab.insertAdjacentHTML("beforeend", `<span class="reason">${reason}</span>`);
      wait(800, () => {
        tab.querySelector(".reason")?.remove();
        tab.classList.remove("is-marked");
        dropElement(tab, reason);
        tab.classList.add("is-hidden");
        setTimeout(() => tab.remove(), 600);
        wait(1600, cycle);
      });
    });
  };
  const restart = () => {
    if (pending || !visible || document.hidden) return;
    for (const tab of calm.querySelectorAll(".is-hidden, .is-marked")) tab.remove();
    wait(700, cycle);
  };
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart(); }, { threshold: 0.6 }).observe(calm);
  document.addEventListener("visibilitychange", restart);
}

// Mobile menu
const menuToggle = document.querySelector<HTMLButtonElement>(".menu-toggle");
const mobileMenu = document.querySelector<HTMLElement>(".mobile-menu");
const setMenu = (open: boolean) => {
  if (!menuToggle || !mobileMenu) return;
  mobileMenu.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
};
menuToggle?.addEventListener("click", () => setMenu(Boolean(mobileMenu?.hidden)));
for (const link of mobileMenu?.querySelectorAll("a") ?? []) link.addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !mobileMenu || mobileMenu.hidden) return;
  setMenu(false);
  menuToggle?.focus();
});
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Node) || !mobileMenu || mobileMenu.hidden) return;
  if (!mobileMenu.contains(event.target) && !menuToggle?.contains(event.target)) setMenu(false);
});
