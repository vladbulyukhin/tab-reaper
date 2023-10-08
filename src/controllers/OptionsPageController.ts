import { IConfigurationManager } from '../managers/IConfigurationManager';
import { toConfiguration } from '../models/Configuration';
import { IPageController } from './IPageController';

export class OptionsPageController implements IPageController {
  private $audibleTabCheckbox: HTMLInputElement;
  private $delayInput: HTMLInputElement;
  private $groupedTabCheckbox: HTMLInputElement;
  private $pinnedTabCheckbox: HTMLInputElement;
  private $saveButton: HTMLButtonElement;
  private $savedMessage: HTMLParagraphElement;

  constructor(private readonly configurationManager: IConfigurationManager) {
    this.attach = this.attach.bind(this);
    this.saveConfiguration = this.saveConfiguration.bind(this);
  }

  public async attach(): Promise<void> {
    this.prepareControls();
    await this.reloadConfiguration();
  }

  private prepareControls(): void {
    this.$audibleTabCheckbox = OptionsPageController.getPageElementById<HTMLInputElement>('audible-tabs', HTMLInputElement);
    this.$delayInput = OptionsPageController.getPageElementById<HTMLInputElement>('inactivity-minutes', HTMLInputElement);
    this.$groupedTabCheckbox = OptionsPageController.getPageElementById<HTMLInputElement>('grouped-tabs', HTMLInputElement);
    this.$pinnedTabCheckbox = OptionsPageController.getPageElementById<HTMLInputElement>('pinned-tabs', HTMLInputElement);
    this.$saveButton = OptionsPageController.getPageElementById<HTMLButtonElement>('save', HTMLButtonElement);
    this.$savedMessage = OptionsPageController.getPageElementById<HTMLParagraphElement>('saved-message', HTMLParagraphElement);

    if (
      !this.$audibleTabCheckbox ||
      !this.$delayInput ||
      !this.$groupedTabCheckbox ||
      !this.$pinnedTabCheckbox ||
      !this.$saveButton ||
      !this.$savedMessage
    ) {
      throw new ReferenceError('Inputs are not available on the options page.');
    }

    this.$saveButton.addEventListener('click', this.saveConfiguration);
    this.watchSaveButtonState();
  }

  private async reloadConfiguration(): Promise<void> {
    const configuration = await this.configurationManager.get();

    this.$delayInput.value = String(configuration.tabRemovalDelayMin);
    this.$audibleTabCheckbox.checked = configuration.keepAudibleTabs;
    this.$groupedTabCheckbox.checked = configuration.keepGroupedTabs;
    this.$pinnedTabCheckbox.checked = configuration.keepPinnedTabs;
  }

  private async saveConfiguration(): Promise<void> {
    const configuration = toConfiguration({
      keepAudibleTabs: this.$audibleTabCheckbox.checked,
      keepGroupedTabs: this.$groupedTabCheckbox.checked,
      keepPinnedTabs: this.$pinnedTabCheckbox.checked,
      tabRemovalDelayMin: parseFloat(this.$delayInput.value),
    });

    await this.configurationManager.save(configuration);

    this.$savedMessage.classList.remove('hidden');
    this.$savedMessage.classList.add('inline');

    this.$saveButton.disabled = true;

    setTimeout(() => {
      this.$savedMessage.classList.add('hidden');
      this.$savedMessage.classList.remove('inline');
    }, 5000);
  }

  private watchSaveButtonState(): void {
    const dependencies: ReadonlyArray<HTMLElement> = [
      this.$audibleTabCheckbox,
      this.$delayInput,
      this.$groupedTabCheckbox,
      this.$pinnedTabCheckbox,
    ];

    dependencies.forEach((dep) => {
      dep.addEventListener('change', async () => {
        const configuration = await this.configurationManager.get();

        this.$saveButton.disabled = !(
          configuration.keepAudibleTabs !== this.$audibleTabCheckbox.checked ||
          configuration.keepGroupedTabs !== this.$groupedTabCheckbox.checked ||
          configuration.keepPinnedTabs !== this.$pinnedTabCheckbox.checked ||
          String(configuration.tabRemovalDelayMin) !== this.$delayInput.value
        );
      });
    });
  }

  private static getPageElementById<T extends HTMLElement>(id: string, constructor: { new (): T }): T | null {
    const element = document.getElementById(id);
    return element instanceof constructor ? element : null;
  }
}
