import { chromeApiProvider } from "../api/chromeApiProvider";
import { logInfo } from "../common/utils/log";
import { BackgroundService } from "./services/BackgroundService";

try {
  new BackgroundService(chromeApiProvider).start();
} catch (error) {
  logInfo("BackgroundService crashed", error);
}
