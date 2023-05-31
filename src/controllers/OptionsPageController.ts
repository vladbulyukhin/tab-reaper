import { IConfigurationManager } from '../managers/IConfigurationManager';
import { toConfiguration } from '../models/Configuration';
import { IPageController } from './IPageController';

export class OptionsPageController implements IPageController {
  private $timeoutInput: HTMLInputElement;
  private $pinnedTabCheckbox: HTMLInputElement;
  private $groupedTabCheckbox: HTMLInputElement;
  private $audibleTabCheckbox: HTMLInputElement;
  private $saveButton: HTMLButtonElement;

  constructor(private readonly configurationManager: IConfigurationManager) {
    this.attach = this.attach.bind(this);
    this.saveConfiguration = this.saveConfiguration.bind(this);
  }

  public async attach(): Promise<void> {
    this.prepareControls();
    await this.reloadConfiguration();
  }

  private prepareControls(): void {
    const timeoutInput = document.getElementById('inactivity-minutes');
    if (timeoutInput instanceof HTMLInputElement) {
      this.$timeoutInput = timeoutInput;
    }

    const pinnedTabCheckbox = document.getElementById('pinned-tabs');
    if (pinnedTabCheckbox instanceof HTMLInputElement) {
      this.$pinnedTabCheckbox = pinnedTabCheckbox;
    }

    const groupedTabsCheckbox = document.getElementById('grouped-tabs');
    if (groupedTabsCheckbox instanceof HTMLInputElement) {
      this.$groupedTabCheckbox = groupedTabsCheckbox;
    }

    const audibleTabsCheckbox = document.getElementById('audible-tabs');
    if (audibleTabsCheckbox instanceof HTMLInputElement) {
      this.$audibleTabCheckbox = audibleTabsCheckbox;
    }

    const saveButton = document.getElementById('save');
    if (saveButton instanceof HTMLButtonElement) {
      this.$saveButton = saveButton;
    }

    if (
      !this.$timeoutInput ||
      !this.$audibleTabCheckbox ||
      !this.$groupedTabCheckbox ||
      !this.$pinnedTabCheckbox ||
      !this.$saveButton
    ) {
      throw new ReferenceError('Inputs have not been found.');
    }

    this.$saveButton.addEventListener('click', this.saveConfiguration);
  }

  private async reloadConfiguration(): Promise<void> {
    const configuration = await this.configurationManager.get();

    this.$timeoutInput.value = String(configuration.tabRemovalTimeoutMin);
  }

  private async saveConfiguration(): Promise<void> {
    const configuration = toConfiguration({
      tabRemovalTimeoutMin: parseInt(this.$timeoutInput.value, 10),
    });

    await this.configurationManager.save(configuration);
  }
}
