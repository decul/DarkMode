
/**
 * Debug this by clicking 'Inspect views service worker' by your extension, on the extensions tab.
 */

let clicked = false;


chrome.runtime.onStartup.addListener(updateIcon);
chrome.runtime.onInstalled.addListener(updateIcon);


chrome.action.onClicked.addListener(async activeTab => {
  if (clicked) {
    clicked = false;
    onDoubleClick(activeTab);
  }
  else {
    clicked = true;
    await sleep(200);

    if (clicked) {
      clicked = false;
      onClick(activeTab);
    }
  }
});


async function onClick(activeTab) {
  const result = await chrome.storage.local.get(["enabledGlobally"]);
  const enabled = !result.enabledGlobally;
  updateIcon(enabled);
  await chrome.storage.local.set({ enabledGlobally: enabled });
  updateTabs({});
}


async function onDoubleClick(activeTab) {
  const result = await chrome.storage.local.get(["enabledGlobally"]);
  if (!result.enabledGlobally)
    return;

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    function: () => ByzioDarkMode.toggle()
  });

  const condition = { 
    url: /^.*:\/\/[^/]+\//.exec(activeTab.url)[0] + "*"
  };
  updateTabs(condition);
}


function updateTabs(condition) {
  const update = () => ByzioDarkMode.update();

  chrome.tabs.query(condition, async tabs => {
    console.log("Tabs found: ", tabs);

    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: update
      })
      .then(() => console.log("Theme changed on: " + tab.url))
      .catch(err => console.log("Failed to change theme on: " + tab.url, err));
    };
  });
}


async function updateIcon(enabled) {
  if (enabled === undefined) {
    const result = await chrome.storage.local.get(["enabledGlobally"]);
    enabled = result.enabledGlobally;
  }

  const path = enabled ? "img/IconDark.png" : "img/IconLight.png"
  chrome.action.setIcon({ path: path })
}


async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}
