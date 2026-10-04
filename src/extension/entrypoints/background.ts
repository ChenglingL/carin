// Clicking the toolbar button opens the side panel.
export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
