importScripts("browserApi.js");


/**
 * Debug this by clicking 'Inspect views service worker' by your extension, on the extensions tab.
 */

let clicked = false;


ExtensionApi.runtime.onStartup.addListener(updateIcon);
ExtensionApi.runtime.onInstalled.addListener(updateIcon);


ExtensionApi.action.onClicked.addListener(async activeTab => {
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


async function onDoubleClick(activeTab) {
  const result = await ExtensionApi.storageLocalGet(["enabledGlobally"]);
  const enabled = !result.enabledGlobally;
  updateIcon(enabled);
  await ExtensionApi.storageLocalSet({ enabledGlobally: enabled });
  updateTabs({});
}


async function onClick(activeTab) {
  const result = await ExtensionApi.storageLocalGet(["enabledGlobally"]);
  if (!result.enabledGlobally)
    return;

  await ExtensionApi.executeFunctionInTab(activeTab.id, () => ByzioDarkMode.toggle());

  const condition = { 
    url: /^.*:\/\/[^/]+\//.exec(activeTab.url)[0] + "*"
  };
  updateTabs(condition);
}


function updateTabs(condition) {
  const update = () => ByzioDarkMode.update();

  ExtensionApi.queryTabs(condition).then(tabs => {
    console.log("Tabs found: ", tabs);

    for (const tab of tabs) {
      ExtensionApi.executeFunctionInTab(tab.id, update)
        .then(() => console.log("Theme changed on: " + tab.url))
        .catch(err => console.log("Failed to change theme on: " + tab.url, err));
    }
  });
}


async function updateIcon(enabled) {
  if (enabled === undefined) {
    const result = await ExtensionApi.storageLocalGet(["enabledGlobally"]);
    enabled = result.enabledGlobally;
  }

  const path = enabled ? "img/IconDark.png" : "img/IconLight.png"
  ExtensionApi.setIcon(path)
}


async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}
