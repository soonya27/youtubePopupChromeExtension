// 확장 아이콘 클릭(또는 Alt+P) → 현재 탭에서 팝아웃 토글
// 유튜브가 아닌 사이트도 activeTab 권한으로 content.js를 주입해서 <video>를 팝아웃할 수 있다.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    // 유튜브는 이미 content script가 있지만, 다른 사이트용으로 한 번 더 주입 (중복 실행은 content.js가 막음)
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__ytPop && window.__ytPop.toggle(),
    });
  } catch (e) {
    // chrome:// 페이지 등 주입 불가 페이지
    console.warn('[YT Pop] 이 페이지에서는 실행할 수 없어요:', e);
  }
});
