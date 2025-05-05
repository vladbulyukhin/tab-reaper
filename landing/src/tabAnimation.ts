interface TabData {
  domain: string;
  title: string;
  faviconColor: string;
}

const TAB_TEMPLATES: TabData[] = [
  {
    domain: "stackoverflow.com",
    title: "That Stack Overflow answer you'll never read",
    faviconColor: "#FF4500",
  },
  {
    domain: "amazon.com",
    title: "Shopping cart from 3 months ago",
    faviconColor: "#2BAB4E",
  },
  {
    domain: "docs.example.com",
    title: "15 tabs of documentation",
    faviconColor: "#1B73E8",
  },
  {
    domain: "youtube.com",
    title: "Tutorial video you'll watch later",
    faviconColor: "#FF0000",
  },
  {
    domain: "medium.com",
    title: "Interesting article from last week",
    faviconColor: "#2E69FF",
  },
  {
    domain: "github.com",
    title: "Open source project you forgot about",
    faviconColor: "#333333",
  },
  {
    domain: "reddit.com",
    title: "Subreddit rabbit hole",
    faviconColor: "#FF4500",
  },
  {
    domain: "twitter.com",
    title: "Tweet you never liked",
    faviconColor: "#1DA1F2",
  },
  {
    domain: "facebook.com",
    title: "Friend's birthday post from last year",
    faviconColor: "#4267B2",
  },
  {
    domain: "instagram.com",
    title: "Photo from last summer's vacation",
    faviconColor: "#C13584",
  },
];

export class TabAnimation {
  private container: HTMLElement;
  private tabs: HTMLElement[] = [];
  private animationInterval: ReturnType<typeof setInterval> | undefined;
  private isRunning = false;
  private readonly MIN_TABS = 3;
  private readonly MAX_TABS = 8;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);
    this.container = container;
  }

  private createTabElement(): HTMLElement {
    const template =
      TAB_TEMPLATES[Math.floor(Math.random() * TAB_TEMPLATES.length)];
    const tab = document.createElement("div");
    tab.className = "tab-card";
    tab.style.left = `${Math.random() * (this.container.clientWidth - 280)}px`;
    tab.style.transform = `translateY(-50px) rotate(${(Math.random() - 0.5) * 30}deg)`;

    const favicon = document.createElement("div");
    favicon.style.cssText = `
      position: absolute;
      left: 20px;
      top: 16px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: ${template.faviconColor};
    `;

    const domain = document.createElement("div");
    domain.style.cssText = `
      position: absolute;
      left: 44px;
      top: 10px;
      font-size: 10px;
      color: #666;
    `;
    domain.textContent = template.domain;

    const title = document.createElement("div");
    title.style.cssText = `
      position: absolute;
      left: 44px;
      top: 24px;
      font-size: 11px;
      color: #333;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 220px;
    `;
    title.textContent = template.title;

    tab.appendChild(favicon);
    tab.appendChild(domain);
    tab.appendChild(title);

    return tab;
  }

  private addNewTab() {
    if (this.tabs.length >= this.MAX_TABS) return;

    const tab = this.createTabElement();
    this.container.appendChild(tab);
    this.tabs.push(tab);

    requestAnimationFrame(() => {
      tab.style.opacity = "1";
      tab.style.transform = `translateY(${this.container.clientHeight + 100}px) rotate(${(Math.random() - 0.5) * 30}deg)`;

      tab.addEventListener("transitionend", (e) => {
        if ((e as TransitionEvent).propertyName === "transform") {
          tab.remove();
          this.tabs = this.tabs.filter((t) => t !== tab);
        }
      });
    });
  }

  private animate() {
    if (!this.isRunning) return;

    if (this.tabs.length < this.MIN_TABS) {
      this.addNewTab();
      return;
    }

    if (Math.random() < 0.3) {
      this.addNewTab();
    }
  }

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;

    for (let i = 0; i < this.MIN_TABS; i++) {
      setTimeout(() => this.addNewTab(), i * 500);
    }

    this.animationInterval = setInterval(() => this.animate(), 1000);
  }

  public stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }
  }

  public cleanup() {
    this.stop();
    for (const tab of this.tabs) {
      tab.remove();
    }
    this.tabs = [];
  }
}
