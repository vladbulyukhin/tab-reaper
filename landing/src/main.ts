const ambientCards = [
  ["That search again", "google.com · duplicate"],
  ["Read this later", "An article from last Tuesday"],
  ["Just browsing…", "tab.example · idle"],
  ["Another documentation tab", "docs.example · idle"],
  ["The perfect sourdough", "Saved for someday"],
  ["Window shopping", "This one can go"],
  ["Yesterday’s rabbit hole", "Recently closed · recoverable"],
  ["Someday, maybe", "One less open loop"],
] as const;


const ambientFaviconColors = ["#d96868", "#6f9bad", "#718eaf", "#8b7fa7", "#ad9564", "#719783", "#ae707c"];

let spawnId = 0;

class AmbientTabLoop {
  private readonly cards = new Set<HTMLElement>();
  private readonly container: HTMLElement;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  private spawn(progress = 0) {
    if (this.cards.size >= 6) return;
    const templateIndex = Math.floor(Math.random() * ambientCards.length);
    const [title, detail] = ambientCards[templateIndex];
    const card = document.createElement("span");
    const duration = 4.8 + Math.random() * 1.8;
    const left = Math.random() < 0.5 ? 1 + Math.random() * 10 : 84 + Math.random() * 10;
    card.className = "ambient-tab is-falling";
    card.dataset.spawnId = String(++spawnId);
    card.style.setProperty("--fall-left", `${left}%`);
    card.style.setProperty("--fall-rotation", `${-10 + Math.random() * 20}deg`);
    card.style.setProperty("--fall-drift", `${-45 + Math.random() * 90}px`);
    card.style.setProperty("--fall-duration", `${duration}s`);
    card.style.setProperty("--fall-distance", `${this.container.clientHeight + 160}px`);
    card.style.setProperty("--static-top", `${8 + progress * 78}%`);
    card.style.setProperty("--favicon-color", ambientFaviconColors[templateIndex % ambientFaviconColors.length]);
    card.style.animationDelay = `${-progress * duration}s`;
    card.innerHTML = `<strong>${title}</strong><small>${detail}</small>`;
    card.addEventListener("animationend", () => {
      this.cards.delete(card);
      card.remove();
    }, { once: true });
    this.cards.add(card);
    this.container.append(card);
  }

  start() {
    if (this.timer) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!this.cards.size) for (let index = 0; index < 4; index++) this.spawn(index / 5);
      return;
    }
    if (!this.cards.size) for (let index = 0; index < 5; index++) this.spawn(index / 5);
    this.container.classList.remove("is-paused");
    this.timer = setInterval(() => this.spawn(), 950);
  }

  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.container.classList.add("is-paused");
  }
}

const ambientLoops = new Map([...document.querySelectorAll<HTMLElement>("[data-ambient]")].map((container) => [container, new AmbientTabLoop(container)]));
const visibleAmbient = new Set<Element>();
let motionPaused = false;
const updateAmbient = () => {
  for (const [container, loop] of ambientLoops) {
    if (visibleAmbient.has(container) && !document.hidden && !motionPaused) loop.start();
    else loop.pause();
  }
};
const ambientObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) visibleAmbient.add(entry.target);
    else visibleAmbient.delete(entry.target);
  }
  updateAmbient();
});
for (const container of ambientLoops.keys()) ambientObserver.observe(container);
document.addEventListener("visibilitychange", updateAmbient);
window.addEventListener("pageshow", updateAmbient);
const motionToggles = document.querySelectorAll<HTMLButtonElement>(".motion-toggle");
for (const motionToggle of motionToggles) motionToggle.addEventListener("click", () => {
  motionPaused = !motionPaused;
  for (const toggle of motionToggles) {
    toggle.setAttribute("aria-pressed", String(motionPaused));
    toggle.textContent = motionPaused ? "Resume background animation" : "Pause background animation";
  }
  updateAmbient();
});

const story = document.querySelector<HTMLElement>(".story");
const caption = document.querySelector<HTMLElement>("[data-caption]");
const count = document.querySelector<HTMLElement>("[data-count]");
const steps = [...document.querySelectorAll<HTMLElement>("[data-story-step]")];
const stageCopy = [
  ["A little crowded. Nothing unusual.", "8 open tabs · 4 protected"],
  ["One Docs copy stays. The duplicate goes.", "7 open tabs · 4 protected"],
  ["Idle tabs are gone. Your protected tabs remain.", "4 open tabs · 4 protected"],
] as const;
let currentStage = -1;
function setStage(nextStage: number) {
  if (!story || !caption || !count || nextStage === currentStage) return;
  currentStage = nextStage;
  story.dataset.stage = String(nextStage);
  caption.textContent = stageCopy[nextStage][0];
  count.textContent = stageCopy[nextStage][1];
  for (const [index, step] of steps.entries()) step.classList.toggle("is-active", index === nextStage);
}
setStage(0);
let scrollFrame = 0;
function updateScrollStory() {
  scrollFrame = 0;
  if (!steps.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let nearest = 0;
  let distance = Infinity;
  for (const [index, step] of steps.entries()) {
    const bounds = step.getBoundingClientRect();
    const nextDistance = Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2);
    if (nextDistance < distance) { nearest = index; distance = nextDistance; }
  }
  setStage(nearest);
}
function queueScrollStory() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateScrollStory);
}
window.addEventListener("scroll", queueScrollStory, { passive: true });
window.addEventListener("resize", queueScrollStory);
queueScrollStory();

const mobileStages = [
  ["Project", "Inbox", "Docs", "Docs", "Read", "Shop", "Recipe", "Music"],
  ["Project", "Inbox", "Docs", "Read", "Shop", "Recipe", "Music"],
  ["Project", "Inbox", "Docs", "Music"],
];
const tabColors: Record<string, string> = { Project: "coral", Inbox: "sky", Docs: "blue", Read: "violet", Shop: "amber", Recipe: "green", Music: "rose" };
for (const [index, titles] of mobileStages.entries()) {
  const stage = document.querySelector<HTMLElement>(`[data-mobile-stage="${index}"]`);
  if (stage) stage.innerHTML = `<div class="browser-tabs" aria-hidden="true">${titles.map(title => `<span class="browser-tab"><i class="favicon favicon-${tabColors[title]}"></i>${title}</span>`).join("")}<span class="new-tab">+</span></div><small>${stageCopy[index][1]}</small>`;
}

const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent);
const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg/.test(navigator.userAgent);
const prefersSafari = isAppleMobile || isSafari;

const mobileInstallLabel = document.querySelector<HTMLElement>(".mobile-install-label");
if (mobileInstallLabel) mobileInstallLabel.textContent = prefersSafari ? "Safari · soon" : "Chrome";
const mobileInstall = document.querySelector<HTMLAnchorElement>(".mobile-install");
if (mobileInstall) mobileInstall.href = prefersSafari ? "#safari-release" : "#install";

const menuToggle = document.querySelector<HTMLButtonElement>(".menu-toggle");
const mobileMenu = document.querySelector<HTMLElement>(".mobile-menu");
menuToggle?.addEventListener("click", () => {
  const menu = mobileMenu;
  if (!menu) return;
  const willOpen = menu.hidden;
  menu.hidden = !willOpen;
  menuToggle.setAttribute("aria-expanded", String(willOpen));
  menuToggle.setAttribute("aria-label", willOpen ? "Close menu" : "Open menu");
  menuToggle.textContent = willOpen ? "×" : "☰";
});
for (const link of mobileMenu?.querySelectorAll("a") ?? []) {
  link.addEventListener("click", () => {
    if (mobileMenu) mobileMenu.hidden = true;
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Open menu");
    if (menuToggle) menuToggle.textContent = "☰";
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !mobileMenu || mobileMenu.hidden) return;
  mobileMenu.hidden = true;
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open menu");
  if (menuToggle) { menuToggle.textContent = "☰"; menuToggle.focus(); }
});
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Node) || !mobileMenu || mobileMenu.hidden) return;
  if (mobileMenu.contains(event.target) || menuToggle?.contains(event.target)) return;
  mobileMenu.hidden = true;
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open menu");
  if (menuToggle) menuToggle.textContent = "☰";
});
window.addEventListener("pagehide", () => {
  for (const loop of ambientLoops.values()) loop.pause();
});
