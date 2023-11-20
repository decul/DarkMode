
/**
 * Debug this by clicking 'Inspect views service worker' by your extension, on the extensions tab.
 */

chrome.action.onClicked.addListener(activeTab => {
  let toggle = () => ByzioDarkMode.toggle();
  let update = () => ByzioDarkMode.update();

  let condition = { 
    url: /^.*:\/\/[^/]+\//.exec(activeTab.url)[0] + "*"
  };

  chrome.tabs.query(condition, async tabs => {
    let toggled = false;

    for (const tab of tabs) {
      let promise = chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: !toggled ? toggle : update
      });
      if (!toggled) {
        await promise;
        toggled = true;
      }
      console.log(tab);
    };
  });
});
