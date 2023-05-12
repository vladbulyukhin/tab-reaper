const saveOptions = () => {
  const timeout = document.getElementById('timeout');

  if (timeout instanceof HTMLSelectElement) {
    const value = timeout.value;

    chrome.storage.sync.set({ timeout: value }, () => {
      const status = document.getElementById('status');

      if (status) {
        status.textContent = 'Options saved.';
        setTimeout(() => {
          status.textContent = '';
        }, 750);
      }
    });
  }
};

const restoreOptions = () => {
  chrome.storage.sync.get({ timeout: '15' }, (items) => {
    const timeout = document.getElementById('timeout');

    if (timeout instanceof HTMLSelectElement) {
      timeout.value = items.timeout;
    }
  });
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save')!.addEventListener('click', saveOptions);
