import { TabAnimation } from "./tabAnimation";

const heroAnimation = new TabAnimation("hero-tab-container");
const graveyardAnimation = new TabAnimation("tab-container");

heroAnimation.start();
graveyardAnimation.start();

window.addEventListener("pagehide", () => {
  heroAnimation.cleanup();
  graveyardAnimation.cleanup();
});
