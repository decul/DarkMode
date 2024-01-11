
/**
 * Debug this by clicking 'Inspect views service worker' by your extension, on the extensions tab.
 */

chrome.action.onClicked.addListener(activeTab => {
  let toggle = () => ByzioDarkMode.toggle();
  let update = () => ByzioDarkMode.update();

  let togglePromise = chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    function: toggle
  });

  let condition = { 
    url: /^.*:\/\/[^/]+\//.exec(activeTab.url)[0] + "*"
  };

  chrome.tabs.query(condition, async tabs => {
    console.log("Tabs found: ", tabs);
    await togglePromise;

    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: update
      })
      .then(() => console.log("Theme changed on: " + tab.url))
      .catch(err => console.log("Failed to change theme on: " + tab.url, err));
    };
  });
});