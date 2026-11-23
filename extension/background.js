// Clic sur l'icône = afficher/masquer le menu dans l'onglet chess.com actif
chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'ede:toggle' }).catch(() => {});
});
