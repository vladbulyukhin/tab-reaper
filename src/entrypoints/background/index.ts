import { defineBackground } from "#imports";
import { chromeApiProvider } from "../../api/chromeApiProvider";
import { BackgroundService } from "./services/BackgroundService";

export default defineBackground(() => {
  new BackgroundService(chromeApiProvider).start();
});
