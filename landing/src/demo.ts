interface Template {
  readonly title: string;
  readonly host: string;
  readonly color: string;
  readonly protected?: boolean;
}

interface DemoTab {
  readonly id: number;
  readonly template: Template;
  readonly el: HTMLButtonElement;
  kept: boolean;
  idle: number;
  reaping: boolean;
}

const IDLE_SECONDS = 11;
const REAP_GAP_MS = 1700;
const FIRST_REAP_S = 2.2;
const MARK_MS = 750;
const MAX_TABS = 14;

const templates = {
  project: { title: "Project plan", host: "docs.example.com", color: "#ff4c4c", protected: true },
  inbox: { title: "Inbox (3)", host: "mail.example.com", color: "#e0874a", protected: true },
  docs: { title: "Getting started", host: "docs.example.com/guide", color: "#5b8def" },
  article: { title: "That article from Tuesday", host: "blog.example.com", color: "#a77bd6" },
  flights: { title: "Flights to Lisbon", host: "travel.example.com", color: "#2bb3c0" },
  search: { title: "best desk lamp - Search", host: "search.example.com", color: "#7d8590" },
  sourdough: { title: "Sourdough, day 4", host: "bread.example.com", color: "#4fae84" },
  music: { title: "Focus playlist", host: "music.example.com", color: "#e05a9b", protected: true },
  someday: { title: "Someday, maybe", host: "notes.example.com", color: "#c9a227" },
  rabbit: { title: "Yesterday’s rabbit hole", host: "wiki.example.com", color: "#6b7b8c" },
  pr: { title: "Pull request #42", host: "code.example.com", color: "#3d4450" },
  weather: { title: "Weather this weekend", host: "weather.example.com", color: "#3ba1e6" },
  recipe: { title: "One-pot pasta", host: "recipes.example.com", color: "#d9634a" },
} satisfies Record<string, Template>;

const initial: ReadonlyArray<[Template, number]> = [
  [templates.project, 0],
  [templates.inbox, 0],
  [templates.docs, 0.2],
  [templates.article, 0.72],
  [templates.docs, 0],
  [templates.flights, 0.1],
  [templates.search, 0.35],
  [templates.sourdough, 0.55],
  [templates.search, 0],
  [templates.music, 0],
];

const spawnPool: ReadonlyArray<Template> = [
  templates.someday, templates.rabbit, templates.pr, templates.weather, templates.recipe,
  templates.article, templates.flights, templates.sourdough, templates.search,
];

const lockSvg = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="7" width="8" height="6" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let fallLayer: HTMLElement | undefined;

/** Detaches a tab-shaped element and lets it fall through the viewport. */
export function dropElement(source: HTMLElement, reason: string) {
  if (reducedMotion.matches) return;
  const rect = source.getBoundingClientRect();
  if (!rect.width) return;
  if (!fallLayer) {
    fallLayer = document.createElement("div");
    fallLayer.className = "fall-layer";
    fallLayer.setAttribute("aria-hidden", "true");
    document.body.append(fallLayer);
  }
  const clone = document.createElement("div");
  clone.className = "falling-tab";
  clone.innerHTML = source.innerHTML;
  for (const extra of clone.querySelectorAll(".reason, .tab-lock, .idle-ring")) extra.remove();
  const tag = document.createElement("span");
  tag.className = "reason";
  tag.textContent = reason;
  clone.append(tag);
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.minWidth = `${Math.min(Math.max(rect.width, 150), 220)}px`;
  fallLayer.append(clone);

  const fall = innerHeight - rect.top + 120;
  const drift = (Math.random() - 0.5) * 220;
  const spin = (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 26);
  const frames: Keyframe[] = [];
  for (let step = 0; step <= 14; step++) {
    const t = step / 14;
    const y = -70 * t + (fall + 70) * t * t;
    const opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    frames.push({ transform: `translate(${drift * t}px, ${y}px) rotate(${spin * t ** 1.4}deg)`, opacity });
  }
  clone.animate(frames, { duration: 1500 + Math.random() * 500, easing: "linear", fill: "forwards" }).finished
    .then(() => clone.remove(), () => clone.remove());
}

const siteOf = (host: string) => host.split("/")[0];

/** Markup for one row of the popup's "Recently reaped tabs" list. */
export function closedRowHTML(title: string, host: string, color: string, reason: "Duplicate" | "Idle", time: string) {
  return `<i class="fav" style="--fav:${color}">${title[0]}</i><span class="rp-row-text"><b>${title}</b><small>${siteOf(host)}</small></span><span class="rp-row-meta"><span class="rp-reason">${reason}</span><time>${time}</time></span>`;
}

export class TabDemo {
  private readonly strip: HTMLElement;
  private readonly page: HTMLElement;
  private readonly pageHost: HTMLElement;
  private readonly pageTitle: HTMLElement;
  private readonly popup: HTMLElement;
  private readonly popupToggle: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly closedList: HTMLElement;
  private readonly closedEmpty: HTMLElement;
  private readonly closedCount: HTMLElement;
  private readonly currentHost: HTMLElement;
  private readonly currentStatus: HTMLElement;
  private readonly keepSwitch: HTMLInputElement;
  private readonly keepCopy: HTMLElement;
  private readonly siteSwitch: HTMLInputElement;
  private readonly siteCopy: HTMLElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly newTabButton: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly tabs: DemoTab[] = [];
  private readonly protectedSites = new Set<string>();
  private activeId = -1;
  private nextId = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;
  private clock = 0;
  private lastReapAt = -Infinity;
  private lastInteraction = 0;
  private lastSpawnAt = 0;
  private reapCount = 0;
  private userOpened = 0;
  private popupOpened = false;
  private paused = false;

  constructor(root: HTMLElement) {
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
    this.strip = find("[data-strip]");
    this.page = find("[data-page] .page-inner");
    this.pageHost = find("[data-page-host]");
    this.pageTitle = find("[data-page-title]");
    this.popup = find("[data-popup]");
    this.popupToggle = find("[data-popup-toggle]");
    this.badge = find("[data-badge]");
    this.closedList = find("[data-closed-list]");
    this.closedEmpty = find("[data-closed-empty]");
    this.closedCount = find("[data-closed-count]");
    this.currentHost = find("[data-current-host]");
    this.currentStatus = find("[data-current-status]");
    this.keepSwitch = find("[data-keep-switch]");
    this.keepCopy = find("[data-keep-copy]");
    this.siteSwitch = find("[data-site-switch]");
    this.siteCopy = find("[data-site-copy]");
    this.pauseButton = find("[data-pause]");
    this.newTabButton = find("[data-new-tab]");
    this.hint = find("[data-demo-hint]");

    for (const [template, idle] of initial) this.open(template, { idle, animate: false });
    this.activate(this.tabs[0].id);

    this.newTabButton.addEventListener("click", () => {
      this.touch();
      this.userOpened++;
      this.newTabButton.classList.remove("is-nudging");
      const openHosts = new Set(this.tabs.map((tab) => tab.template.host));
      const fresh = spawnPool.filter((template) => !openHosts.has(template.host));
      const pool = fresh.length && Math.random() > 0.3 ? fresh : spawnPool;
      const tab = this.open(pool[Math.floor(Math.random() * pool.length)], { idle: 0 });
      if (tab) this.activate(tab.id);
      this.updateHint();
    });
    this.popupToggle.addEventListener("click", () => this.setPopup(this.popup.hidden));
    this.keepSwitch.addEventListener("change", () => {
      this.touch();
      const tab = this.find(this.activeId);
      if (!tab) return;
      tab.kept = this.keepSwitch.checked;
      this.renderAll();
    });
    this.siteSwitch.addEventListener("change", () => {
      this.touch();
      const tab = this.find(this.activeId);
      if (!tab) return;
      const site = siteOf(tab.template.host);
      if (this.siteSwitch.checked) this.protectedSites.add(site);
      else this.protectedSites.delete(site);
      this.renderAll();
    });
    this.pauseButton.addEventListener("click", () => {
      this.touch();
      this.paused = !this.paused;
      this.pauseButton.setAttribute("aria-pressed", String(this.paused));
      this.pauseButton.querySelector("span")!.textContent = this.paused ? "Paused" : "Pause";
      this.updateHint();
    });
    document.addEventListener("click", (event) => {
      if (this.popup.hidden || !(event.target instanceof Node)) return;
      if (!this.popup.contains(event.target) && !this.popupToggle.contains(event.target)) this.setPopup(false);
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.popup.hidden) { this.setPopup(false); this.popupToggle.focus(); }
    });
    setTimeout(() => { if (!this.userOpened) this.newTabButton.classList.add("is-nudging"); }, 7000);
  }

  start() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 120);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private touch() {
    this.lastInteraction = this.clock;
  }

  private find(id: number) {
    return this.tabs.find((tab) => tab.id === id);
  }

  private isProtected(tab: DemoTab) {
    return tab.kept || this.protectedSites.has(siteOf(tab.template.host));
  }

  private open(template: Template, { idle = 0, animate = true } = {}) {
    if (this.tabs.length >= MAX_TABS) return undefined;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "tab";
    el.innerHTML = `<i class="fav" style="--fav:${template.color}">${template.title[0]}<svg class="idle-ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg></i><span class="tab-title">${template.title}</span>`;
    const tab: DemoTab = { id: this.nextId++, template, el, kept: Boolean(template.protected), idle, reaping: false };
    el.addEventListener("click", () => { this.touch(); this.activate(tab.id); });
    this.tabs.push(tab);
    this.renderTab(tab);
    if (animate) {
      el.classList.add("is-entering");
      this.strip.append(el);
      void el.offsetWidth;
      el.classList.remove("is-entering");
    } else {
      this.strip.append(el);
    }
    return tab;
  }

  private renderTab(tab: DemoTab) {
    const isProtected = this.isProtected(tab);
    tab.el.style.setProperty("--idle", isProtected || tab.id === this.activeId ? "0" : String(Math.min(tab.idle, 1)));
    tab.el.classList.toggle("is-active", tab.id === this.activeId);
    tab.el.setAttribute("aria-label", `${tab.template.title}${isProtected ? ", protected" : ""}`);
    tab.el.setAttribute("aria-pressed", String(tab.id === this.activeId));
    const lock = tab.el.querySelector(".tab-lock");
    if (isProtected && !lock && !tab.reaping) tab.el.insertAdjacentHTML("beforeend", `<span class="tab-lock">${lockSvg}</span>`);
    if (!isProtected && lock) lock.remove();
  }

  private renderAll() {
    for (const tab of this.tabs) {
      if (this.isProtected(tab)) tab.idle = 0;
      this.renderTab(tab);
    }
    this.renderCurrent();
  }

  /** Mirrors the popup's "Current tab" card for the active tab. */
  private renderCurrent() {
    const tab = this.find(this.activeId);
    if (!tab) return;
    const site = siteOf(tab.template.host);
    const siteProtected = this.protectedSites.has(site);
    this.currentHost.textContent = site;
    this.keepSwitch.checked = tab.kept;
    this.siteSwitch.checked = siteProtected;
    this.keepCopy.textContent = `Skip only this tab. Other tabs from ${site} can still be cleaned up.`;
    this.siteCopy.textContent = `Keep every tab from ${site} until you remove the site from protected sites.`;
    const [label, tone] = siteProtected ? ["Site protected", "site"] : tab.kept ? ["Tab kept", "kept"] : ["Tab eligible", "eligible"];
    this.currentStatus.textContent = label;
    this.currentStatus.dataset.tone = tone;
  }

  private activate(id: number) {
    const tab = this.find(id);
    if (!tab || tab.reaping) return;
    const previous = this.activeId;
    this.activeId = id;
    tab.idle = 0;
    for (const other of this.tabs) if (other.id === id || other.id === previous) this.renderTab(other);
    this.pageHost.textContent = tab.template.host;
    this.pageTitle.textContent = tab.template.title;
    this.page.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 250 });
    this.renderCurrent();
  }

  private setPopup(open: boolean) {
    this.popup.hidden = !open;
    this.popupToggle.setAttribute("aria-expanded", String(open));
    if (open) {
      this.popupOpened = true;
      this.touch();
      this.badge.hidden = true;
      this.renderCurrent();
      this.updateHint();
    }
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(now - this.lastTick, 250) / 1000;
    this.lastTick = now;
    if (this.paused) return;
    this.clock += dt;

    for (const tab of this.tabs) {
      if (tab.reaping || this.isProtected(tab) || tab.id === this.activeId) continue;
      tab.idle += dt / IDLE_SECONDS;
      this.renderTab(tab);
    }

    if (this.clock > FIRST_REAP_S && this.clock * 1000 - this.lastReapAt > REAP_GAP_MS) {
      const duplicate = this.findDuplicate();
      if (duplicate) this.reap(duplicate, "duplicate");
      else {
        const idle = this.tabs.find((tab) => !tab.reaping && !this.isProtected(tab) && tab.id !== this.activeId && tab.idle >= 1);
        if (idle) this.reap(idle, "idle 3 days");
      }
    }

    const live = this.tabs.filter((tab) => !tab.reaping).length;
    if (!reducedMotion.matches && live <= 5 && this.clock - this.lastInteraction > 5 && this.clock - this.lastSpawnAt > 2.6) {
      this.lastSpawnAt = this.clock;
      const candidates = this.tabs.filter((tab) => !tab.reaping && !this.isProtected(tab));
      const template = candidates.length && Math.random() < 0.35
        ? candidates[Math.floor(Math.random() * candidates.length)].template
        : spawnPool[Math.floor(Math.random() * spawnPool.length)];
      const tab = this.open(template, { idle: Math.random() * 0.4 });
      if (tab) this.renderTab(tab);
    }
  }

  private findDuplicate() {
    const seen = new Map<string, DemoTab>();
    for (const tab of this.tabs) {
      if (tab.reaping) continue;
      const first = seen.get(tab.template.host);
      if (!first) { seen.set(tab.template.host, tab); continue; }
      // Keep the active or protected copy; reap the other one, unless both are protected.
      const victim = tab.id === this.activeId || this.isProtected(tab) ? first : tab;
      if (!this.isProtected(victim) && victim.id !== this.activeId) return victim;
    }
    return undefined;
  }

  private reap(tab: DemoTab, reason: string) {
    tab.reaping = true;
    this.lastReapAt = this.clock * 1000;
    const label = reason.startsWith("idle") ? reason : "duplicate";
    tab.el.querySelector(".tab-lock")?.remove();
    tab.el.classList.add("is-marked");
    tab.el.insertAdjacentHTML("beforeend", `<span class="reason">${label}</span>`);
    setTimeout(() => {
      tab.el.querySelector(".reason")?.remove();
      dropElement(tab.el, label);
      const index = this.tabs.indexOf(tab);
      for (const neighbour of [this.tabs[index - 1], this.tabs[index + 1]]) {
        if (!neighbour || !this.isProtected(neighbour)) continue;
        neighbour.el.classList.remove("is-wiggling");
        void neighbour.el.offsetWidth;
        neighbour.el.classList.add("is-wiggling");
      }
      tab.el.classList.add("is-leaving");
      setTimeout(() => {
        tab.el.remove();
        this.tabs.splice(this.tabs.indexOf(tab), 1);
      }, 450);
      this.addClosed(tab.template, label === "duplicate" ? "Duplicate" : "Idle");
    }, reducedMotion.matches ? 300 : MARK_MS);
  }

  private updateClosedCount() {
    const count = this.closedList.querySelectorAll(".closed-item").length;
    this.closedCount.textContent = `${count} saved`;
    this.closedEmpty.hidden = count > 0;
  }

  private addClosed(template: Template, reason: "Duplicate" | "Idle") {
    this.reapCount++;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "closed-item";
    item.innerHTML = closedRowHTML(template.title, template.host, template.color, reason, "now");
    item.setAttribute("aria-label", `Reopen ${template.title}`);
    item.addEventListener("click", () => {
      this.touch();
      item.remove();
      this.updateClosedCount();
      const tab = this.open(template, { idle: 0 });
      if (tab) this.activate(tab.id);
      this.setPopup(false);
    });
    this.closedList.prepend(item);
    for (const extra of [...this.closedList.querySelectorAll(".closed-item")].slice(12)) extra.remove();
    this.updateClosedCount();
    if (this.popup.hidden) {
      this.badge.hidden = false;
      this.badge.classList.remove("is-bumping");
      void this.badge.offsetWidth;
      this.badge.classList.add("is-bumping");
    }
    this.updateHint();
  }

  private updateHint() {
    if (this.paused) {
      this.hint.textContent = "Cleanup paused. Your tabs stay put until you resume.";
    } else if (this.popupOpened) {
      this.hint.textContent = "Keep a tab, protect a whole site, or click a closed tab to bring it back.";
    } else if (this.reapCount >= 3) {
      this.hint.textContent = `${this.reapCount} tabs reaped. Changed your mind? Open Tab Reaper in the toolbar to bring one back.`;
    } else if (this.userOpened) {
      this.hint.textContent = "Now leave them alone. Click a tab to keep it active, or keep it from the toolbar.";
    }
  }
}
