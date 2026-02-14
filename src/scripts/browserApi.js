(function (globalScope) {
  const isFirefox = typeof browser !== "undefined";

  const chromiumApi = {
    runtime: chrome.runtime,
    action: chrome.action,
    async storageLocalGet(keys) {
      return chrome.storage.local.get(keys);
    },
    async storageLocalSet(items) {
      return chrome.storage.local.set(items);
    },
    async executeFunctionInTab(tabId, fn) {
      return chrome.scripting.executeScript({
        target: { tabId },
        function: fn
      });
    },
    async queryTabs(condition) {
      return new Promise(resolve => chrome.tabs.query(condition, resolve));
    },
    async setIcon(path) {
      return chrome.action.setIcon({ path });
    }
  };

  const firefoxApi = {
    runtime: browser.runtime,
    action: browser.action,
    async storageLocalGet(keys) {
      return browser.storage.local.get(keys);
    },
    async storageLocalSet(items) {
      return browser.storage.local.set(items);
    },
    async executeFunctionInTab(tabId, fn) {
      if (browser.scripting?.executeScript) {
        return browser.scripting.executeScript({
          target: { tabId },
          function: fn
        });
      }

      return browser.tabs.executeScript(tabId, {
        code: `(${fn.toString()})();`
      });
    },
    async queryTabs(condition) {
      return browser.tabs.query(condition);
    },
    async setIcon(path) {
      return browser.action.setIcon({ path });
    }
  };

  globalScope.ExtensionApi = isFirefox ? firefoxApi : chromiumApi;
})(globalThis);
