import { chromeApiProvider } from "../api/chromeApiProvider";
import { BackgroundService } from "./services/BackgroundService";

new BackgroundService(chromeApiProvider).start();
