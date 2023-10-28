import { IConfigurationManager } from '../managers/IConfigurationManager';
import { toConfiguration } from '../models/Configuration';
import { IPageController } from './IPageController';

export class OptionsPageController implements IPageController {
  private get $audibleTabCheckbox(): HTMLInputElement {
    return OptionsPageController.getPageElementById<HTMLInputElement>('audible-tabs', HTMLInputElement);
  }

  private get $delayInput(): HTMLInputElement {
    return OptionsPageController.getPageElementById<HTMLInputElement>('inactivity-minutes', HTMLInputElement);
  }

  private get $groupedTabCheckbox(): HTMLInputElement {
    return OptionsPageController.getPageElementById<HTMLInputElement>('grouped-tabs', HTMLInputElement);
  }

  private get $pinnedTabCheckbox(): HTMLInputElement {
    return OptionsPageController.getPageElementById<HTMLInputElement>('pinned-tabs', HTMLInputElement);
  }

  private get $saveButton(): HTMLButtonElement {
    return OptionsPageController.getPageElementById<HTMLButtonElement>('save', HTMLButtonElement);
  }

  private get $savedMessage(): HTMLParagraphElement {
    return OptionsPageController.getPageElementById<HTMLParagraphElement>('saved-message', HTMLParagraphElement);
  }

  constructor(private readonly configurationManager: IConfigurationManager) {
    this.attach = this.attach.bind(this);
    this.saveConfiguration = this.saveConfiguration.bind(this);
  }

  public async attach(): Promise<void> {
    this.$saveButton.addEventListener('click', this.saveConfiguration);
    this.watchSaveButtonState();

    await this.reloadConfiguration();
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

  private static getPageElementById<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
    const element = document.getElementById(id);

    if (!(element instanceof constructor)) {
      throw new Error(`Element of type ${constructor.name} with id ${id} was not found.`);
    }

    return element;
  }
}
