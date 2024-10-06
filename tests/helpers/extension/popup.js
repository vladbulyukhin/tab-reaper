document.getElementById("pinTabButton").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.example.com", pinned: true });
});

document.getElementById("groupTabsButton").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.example.org" }, (tab1) => {
    chrome.tabs.create({ url: "https://www.example.com" }, (tab2) => {
      chrome.tabs.group({ tabIds: [tab1.id, tab2.id] });
    });
  });
});

document.getElementById("createTabButton").addEventListener("click", () => {
  const input = document.getElementById("tabUrl");
  chrome.tabs.create({ url: input.value });
});
