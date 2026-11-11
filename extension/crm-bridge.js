/* Reads the CRM tab's existing Supabase session for the extension. Tokens stay in the extension, not on LinkedIn. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'read-crm-session') return;
  let session = null;
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith('sb-') && key.endsWith('-auth-token'));
    for (const key of keys) {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      const source = parsed && (parsed.access_token ? parsed : parsed.currentSession);
      if (source?.access_token && source?.refresh_token) {
        session = { access_token: source.access_token, refresh_token: source.refresh_token, expires_at: source.expires_at || null, expires_in: source.expires_in || null };
        break;
      }
    }
  } catch (e) { session = null; }
  sendResponse({ session });
});
