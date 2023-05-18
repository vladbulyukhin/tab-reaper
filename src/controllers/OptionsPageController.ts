import { IConfigurationManager } from '../managers/IConfigurationManager';
import { toConfiguration } from '../models/Configuration';
import { IPageController } from './IPageController';

export class OptionsPageController implements IPageController {
  private $timeoutSelect: HTMLSelectElement;
  private $limitCheckbox: HTMLInputElement;
  private $limitInput: HTMLInputElement;
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
    const timeoutSelect = document.getElementById('timeoutSelect');
    if (timeoutSelect instanceof HTMLSelectElement) {
      this.$timeoutSelect = timeoutSelect;
    }

    const limitCheckbox = document.getElementById('limitCheckbox');
    if (limitCheckbox instanceof HTMLInputElement) {
      this.$limitCheckbox = limitCheckbox;
    }

    const limitInput = document.getElementById('limitInput');
    if (limitInput instanceof HTMLInputElement) {
      this.$limitInput = limitInput;
    }

    const saveButton = document.getElementById('save');
    if (saveButton instanceof HTMLButtonElement) {
      this.$saveButton = saveButton;
    }

    if (!this.$timeoutSelect || !this.$limitCheckbox || !this.$limitInput || !this.$saveButton) {
      throw new ReferenceError('Inputs have not been found.');
    }

    this.$saveButton.addEventListener('click', this.saveConfiguration);
  }

  private async reloadConfiguration(): Promise<void> {
    const configuration = await this.configurationManager.get();

    this.$timeoutSelect.value = String(configuration.tabRemovalTimeoutMin);
    this.$limitCheckbox.checked = configuration.tabLimit > 0;
    this.$limitInput.value = String(configuration.tabLimit);
  }

  private async saveConfiguration(): Promise<void> {
    const configuration = toConfiguration({
      tabRemovalTimeoutMin: parseInt(this.$timeoutSelect.value, 10),
      tabLimit: parseInt(this.$limitInput.value, 10),
    });

    await this.configurationManager.save(configuration);
  }
}
