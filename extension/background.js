// Toolbar icon click = show/hide the menu in the active chess.com tab
chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ede:toggle' }).catch(() => {});
});
