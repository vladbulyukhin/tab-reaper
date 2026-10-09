import { chromeApiProvider } from "../api/chromeApiProvider";
import { initDebug } from "../common/utils/debug";
import { BackgroundService } from "./services/BackgroundService";
import { initializeBackgroundDiagnostics } from "./utils/BackgroundDiagnostics";
import { debugBroadcast, logInfo } from "./utils/log";

initDebug();
logInfo("Background entry loaded");
debugBroadcast("background-entry-loaded");
// Raw diagnostics remain independent of service initialization.
initializeBackgroundDiagnostics();

try {
  new BackgroundService(chromeApiProvider).start();
} catch (error) {
  logInfo("BackgroundService crashed", error);
  debugBroadcast("background-service-error", {
    message: (error as Error)?.message ?? String(error),
  });
}
