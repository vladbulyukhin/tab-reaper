import { chromeSyncStorageAPI } from "./api/chromeSyncStorageAPI";
import { OptionsPageController } from "./controllers/OptionsPageController";
import "./css/options.css";
import { ConfigurationManager } from "./managers/ConfigurationManager";

const configurationManager = new ConfigurationManager(chromeSyncStorageAPI);
const optionsPageController = new OptionsPageController(configurationManager);

document.addEventListener("DOMContentLoaded", optionsPageController.attach);
