/**
 * Detects whether the current page is a followers or following page.
 * Returns { type, username } or null.
 *
 * Note: Cannot use ES module imports here since content scripts in ISOLATED
 * world are not loaded as modules. Patterns are duplicated from constants.
 */

const PAGE_PATTERNS = {
  followers: /^https:\/\/(x|twitter)\.com\/([^/]+)\/followers\/?$/,
  following: /^https:\/\/(x|twitter)\.com\/([^/]+)\/following\/?$/,
};

function detectPage(url) {
  const href = url || window.location.href;

  for (const [type, pattern] of Object.entries(PAGE_PATTERNS)) {
    const match = href.match(pattern);
    if (match) {
      return { type, username: match[2] };
    }
  }
  return null;
}

/**
 * Watch for URL changes (Twitter is a SPA - URL changes without page reload).
 */
function watchUrlChanges(callback) {
  let lastUrl = window.location.href;

  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      callback(detectPage(lastUrl));
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Also listen for popstate
  window.addEventListener('popstate', () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      callback(detectPage(lastUrl));
    }
  });

  return observer;
}
