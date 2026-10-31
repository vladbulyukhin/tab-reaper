// Captures Chrome Web Store images from the built extension in `dist/`.
// Run `pnpm build` first. Output: artifacts/chrome-store/.
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const extensionPath = path.join(root, "dist");
const outDir = path.join(root, "artifacts/chrome-store");
const site = "https://en.wikipedia.org/wiki/Lisbon";
const popupSize = { width: 412, height: 600 };
const scale = 2;

const scenes = [
  {
    file: "01-forgotten-tabs-close-themselves",
    title: "Forgotten tabs close themselves",
    subtitle: "Idle tabs and duplicates get tidied up for you",
    prepare: async (popup) => {
      // Start at a row boundary so no text line is cut off at the top.
      await popup
        .getByText("Always protect this site")
        .evaluate((el) => el.scrollIntoView());
    },
  },
  {
    file: "02-keep-the-tabs-that-matter",
    title: "Keep the tabs that matter",
    subtitle: "Keep one tab, or protect a whole site",
    prepare: async (popup) => {
      await popup.getByTestId("currentTabKeepToggle").click();
      await popup.getByTestId("currentSiteProtectToggle").click();
      await popup.waitForTimeout(500);
    },
  },
  {
    file: "03-bring-any-tab-back",
    title: "Bring any tab back",
    subtitle: "Search your last 50 closed tabs and reopen in one click",
    prepare: async (popup) => {
      await popup.getByTestId("recentlyClosedExpand").click();
      await popup.getByTestId("recentlyClosedSearch").fill("lisbon");
      await popup.getByTestId("recentlyClosedSearch").blur();
      await popup
        .getByText("Recently closed", { exact: true })
        .evaluate((el) => el.closest("section").scrollIntoView());
    },
  },
  {
    file: "04-pause-when-you-need-to",
    title: "Pause when you need to",
    subtitle: "Stop cleanup for 30 minutes, an hour or a day",
    prepare: async (popup) => {
      await popup.getByTestId("pause-cleanup-toggle").click();
      await popup.getByTestId("snooze-30m").waitFor();
    },
  },
  {
    file: "05-set-your-own-rules",
    title: "Set your own rules",
    subtitle: "Idle time, duplicates and a safety threshold",
    hash: "#/settings",
    prepare: async (popup) => {
      await popup.getByTestId("removeExactDuplicates").check();
      await popup.getByText("Settings saved").waitFor();
      await popup.getByTestId("tabCountThreshold").fill("8");
      await popup.getByTestId("tabCountThreshold").blur();
      await popup.waitForTimeout(1500);
      // Reload so the saved settings show without the save status line.
      await popup.reload();
      await popup.getByTestId("tabRemovalDelayMin").waitFor();
      if (!(await popup.getByTestId("removeExactDuplicates").isChecked())) {
        throw new Error("Remove duplicates was not saved");
      }
    },
  },
];

// Oldest first: the popup shows the newest entry at the top.
const history = [
  ["Fado - Wikipedia", "https://en.wikipedia.org/wiki/Fado", "idle", 95],
  [
    "Lisbon Cathedral - Wikipedia",
    "https://en.wikipedia.org/wiki/Lisbon_Cathedral",
    "idle",
    180,
  ],
  [
    "Tram 28 (Lisbon) - Wikipedia",
    "https://en.wikipedia.org/wiki/Lisbon_tram_28",
    "duplicate",
    70,
  ],
  ["Alfama - Wikipedia", "https://en.wikipedia.org/wiki/Alfama", "idle", 52],
  [
    "Pastel de nata - Wikipedia",
    "https://en.wikipedia.org/wiki/Pastel_de_nata",
    "idle",
    41,
  ],
  [
    "Lisbon Oceanarium - Wikipedia",
    "https://en.wikipedia.org/wiki/Lisbon_Oceanarium",
    "idle",
    33,
  ],
  ["Sintra - Wikipedia", "https://en.wikipedia.org/wiki/Sintra", "idle", 26],
  [
    "Belém Tower - Wikipedia",
    "https://en.wikipedia.org/wiki/Bel%C3%A9m_Tower",
    "duplicate",
    14,
  ],
  [
    "Pomodoro Technique - Wikipedia",
    "https://en.wikipedia.org/wiki/Pomodoro_Technique",
    "idle",
    6,
  ],
  [
    "Getting Things Done - Wikipedia",
    "https://en.wikipedia.org/wiki/Getting_Things_Done",
    "idle",
    1,
  ],
];

const dataUri = (buffer, type = "image/png") =>
  `data:${type};base64,${buffer.toString("base64")}`;

const launch = () =>
  chromium.launchPersistentContext("", {
    headless: false,
    deviceScaleFactor: scale,
    viewport: { width: 1120, height: 560 },
    args: [
      "--headless=new",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

const captureScene = async (scene) => {
  const context = await launch();
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = worker.url().split("/")[2];

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(site, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content:
        "#siteNotice, .cn-fundraising, .frb, .vector-sticky-header { display: none !important; }",
    });
    const siteShot = await page.screenshot();

    await worker.evaluate(async (entries) => {
      const now = Date.now();
      const elements = entries.map(([title, url, reason, minutes], index) => ({
        id: 900 + index,
        title,
        url,
        favIconUrl: "",
        reason,
        removedAt: new Date(now - minutes * 60_000).toISOString(),
      }));
      await chrome.storage.session.set({
        recentlyRemovedTabs: JSON.stringify({ capacity: 50, elements }),
      });
    }, history);

    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html${
      scene.hash ?? "#/"
    }`;
    const popupPromise = context.waitForEvent("page");
    await worker.evaluate(
      (url) =>
        chrome.windows.create({
          url,
          type: "popup",
          width: 412,
          height: 600,
          focused: false,
        }),
      popupUrl,
    );
    const popup = await popupPromise;
    await popup.setViewportSize(popupSize);
    await popup.waitForLoadState("networkidle");
    await popup
      .getByTestId("current-tab-status")
      .or(popup.getByTestId("tabRemovalDelayMin"))
      .first()
      .waitFor();
    await popup.waitForTimeout(500);
    await scene.prepare(popup);
    await popup.waitForTimeout(400);
    const popupShot = await popup.screenshot();
    return { siteShot, popupShot };
  } finally {
    await context.close();
  }
};

const fonts = `
  :root { --red: #ff4c4c; --ink: #14181f; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .headline { font-weight: 800; letter-spacing: -0.035em; color: #fff; line-height: 1; }
  .sub { color: rgb(255 255 255 / .92); font-weight: 500; letter-spacing: -0.01em; }
`;

const browserFrame = ({ siteShot, popupShot, x, y, width, height }) => `
  <div class="window" style="left:${x}px; top:${y}px; width:${width}px; height:${height}px">
    <div class="tabstrip">
      <span class="dots"><i></i><i></i><i></i></span>
      <span class="tab"><img src="https://en.wikipedia.org/static/favicon/wikipedia.ico" alt="">Lisbon - Wikipedia<b>×</b></span>
      <span class="plus">+</span>
    </div>
    <div class="toolbar">
      <span class="nav">‹ › ↻</span>
      <span class="omnibox">en.wikipedia.org/wiki/Lisbon</span>
      <span class="ext"><img src="${extensionIcon}" alt=""></span>
      <span class="avatar"></span>
    </div>
    <img class="site" src="${dataUri(siteShot)}" alt="">
    <img class="popup" src="${dataUri(popupShot)}" alt="">
  </div>`;

const browserCss = `
  .window { position: absolute; border-radius: 14px 14px 0 0; overflow: hidden; background: #fff;
    box-shadow: 0 40px 90px -30px rgb(60 0 0 / .55), 0 0 0 1px rgb(0 0 0 / .08); }
  .tabstrip { height: 40px; background: #dfe3ea; display: flex; align-items: flex-end; padding: 0 12px; gap: 8px; }
  .dots { display: flex; gap: 8px; align-self: center; margin-right: 10px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; }
  .dots i:nth-child(2) { background: #febc2e; } .dots i:nth-child(3) { background: #28c840; }
  .tab { display: flex; align-items: center; gap: 8px; height: 32px; width: 240px; padding: 0 12px;
    background: #fff; border-radius: 10px 10px 0 0; font: 500 12.5px/1 system-ui; color: #1f1f1f; }
  .tab img { width: 16px; height: 16px; } .tab b { margin-left: auto; font-weight: 400; color: #5f6368; }
  .plus { align-self: center; font: 300 20px/1 system-ui; color: #444; }
  .toolbar { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 14px;
    border-bottom: 1px solid #e3e3e3; }
  .nav { font: 400 17px/1 system-ui; color: #5f6368; letter-spacing: 8px; }
  .omnibox { flex: 1; height: 32px; border-radius: 16px; background: #f1f3f4; display: flex; align-items: center;
    padding: 0 16px; font: 400 13.5px/1 system-ui; color: #202124; }
  .ext { width: 30px; height: 30px; border-radius: 50%; background: #e8eaed; display: grid; place-items: center; }
  .ext img { width: 18px; height: 18px; }
  .avatar { width: 24px; height: 24px; border-radius: 50%; background: #a8c7fa; }
  .site { display: block; width: 100%; }
  .popup { position: absolute; top: 80px; right: 50px; width: ${popupSize.width}px; border-radius: 10px;
    box-shadow: 0 12px 40px rgb(0 0 0 / .28), 0 0 0 1px rgb(0 0 0 / .1); }
`;

const screenshotHtml = (scene, shots) => `<!doctype html><html><head><style>
  ${fonts} ${browserCss}
  body { width: 1280px; height: 800px; overflow: hidden; background: var(--red); position: relative; }
  .headline { position: absolute; left: 80px; top: 52px; font-size: 64px; }
  .sub { position: absolute; left: 82px; top: 132px; font-size: 26px; }
</style></head><body>
  <h1 class="headline">${scene.title}</h1>
  <p class="sub">${scene.subtitle}</p>
  ${browserFrame({ ...shots, x: 80, y: 196, width: 1120, height: 640 })}
</body></html>`;

const promoHtml = () => `<!doctype html><html><head><style>
  ${fonts}
  body { width: 440px; height: 280px; overflow: hidden; background: var(--red); display: flex;
    flex-direction: column; justify-content: center; padding: 0 36px; gap: 14px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { width: 64px; height: 64px; border-radius: 16px; background: #fff; padding: 6px; }
  .brand span { font: 800 34px/1 -apple-system, system-ui; color: #fff; letter-spacing: -0.03em; }
  .headline { font-size: 28px; letter-spacing: -0.03em; }
</style></head><body>
  <div class="brand"><img src="${extensionIcon}" alt=""><span>Tab Reaper</span></div>
  <p class="headline">Forgotten tabs<br>close themselves</p>
</body></html>`;

const marqueeHtml = (shots) => `<!doctype html><html><head><style>
  ${fonts} ${browserCss}
  body { width: 1400px; height: 560px; overflow: hidden; background: var(--red); position: relative; }
  .brand { position: absolute; left: 80px; top: 120px; display: flex; align-items: center; gap: 16px; }
  .brand img { width: 64px; height: 64px; border-radius: 16px; background: #fff; padding: 6px; }
  .brand span { font: 800 36px/1 -apple-system, system-ui; color: #fff; letter-spacing: -0.03em; }
  .headline { position: absolute; left: 80px; top: 216px; font-size: 60px; width: 560px; }
  .sub { position: absolute; left: 82px; top: 362px; font-size: 24px; width: 520px; }
</style></head><body>
  <div class="brand"><img src="${extensionIcon}" alt=""><span>Tab Reaper</span></div>
  <h1 class="headline">Forgotten tabs close themselves</h1>
  <p class="sub">Idle tabs and duplicates get tidied up. Bring any tab back in one click.</p>
  ${browserFrame({ ...shots, x: 660, y: 64, width: 740, height: 560 })}
</body></html>`;

const render = async (browser, html, size, file) => {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(outDir, file),
    type: "png",
    omitBackground: false,
  });
  await page.close();
};

const extensionIcon = dataUri(
  await readFile(path.join(extensionPath, "icons/icon-active-128.png")),
);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const shots = [];
for (const scene of scenes) {
  console.log(`Capturing ${scene.file}`);
  shots.push(await captureScene(scene));
}

const browser = await chromium.launch();
for (const [index, scene] of scenes.entries()) {
  await render(
    browser,
    screenshotHtml(scene, shots[index]),
    { width: 1280, height: 800 },
    `${scene.file}.png`,
  );
}
await render(
  browser,
  promoHtml(),
  { width: 440, height: 280 },
  "promo-small-440x280.png",
);
await render(
  browser,
  marqueeHtml(shots[0]),
  { width: 1400, height: 560 },
  "promo-marquee-1400x560.png",
);
await browser.close();
console.log(`Wrote ${outDir}`);
