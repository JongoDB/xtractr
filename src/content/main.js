/**
 * ISOLATED world content script - bridge between MAIN world interceptor and
 * background service worker. Also hosts the floating UI panel.
 *
 * The interceptor captures Twitter's first GraphQL request (giving us the
 * auth template), then this script drives pagination by sending XPRTR_FETCH_PAGE
 * commands to the MAIN world, which replays the request with updated cursors.
 */

// ---- Page Detection (inline) ----

const PAGE_PATTERNS = {
  followers: /^https:\/\/(x|twitter)\.com\/([^/]+)\/followers\/?(\?.*)?$/,
  following: /^https:\/\/(x|twitter)\.com\/([^/]+)\/following\/?(\?.*)?$/,
};

function detectPage(url) {
  const href = url || window.location.href;
  for (const [type, pattern] of Object.entries(PAGE_PATTERNS)) {
    const match = href.match(pattern);
    if (match) return { type, username: match[2] };
  }
  return null;
}

console.log('[xtractr] Content script loaded at', new Date().toISOString(),
  'URL:', window.location.href,
  'Detected page:', detectPage());

// ---- Extension context guard ----
// After extension reload/update, old content scripts become orphaned.
// chrome.runtime calls will throw "Extension context invalidated".

function isContextValid() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

function cleanup() {
  console.log('[xtractr] Extension context invalidated, cleaning up');
  try { Paginator.stop(); } catch { /* */ }
  try { urlObserver.disconnect(); } catch { /* */ }
  try { hidePanel(); } catch { /* */ }
}

function safeSendMessage(message, callback) {
  if (!isContextValid()) { cleanup(); return; }
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message?.includes('invalidated')) {
          cleanup();
          return;
        }
        console.warn('[xtractr] sendMessage error:', chrome.runtime.lastError.message);
        return;
      }
      if (callback) callback(response);
    });
  } catch {
    cleanup();
  }
}

// ---- Paginator: drives cursor-based API fetching ----

const Paginator = (() => {
  let isRunning = false;
  let isPaused = false;
  let fetchTimer = null;
  let pauseTimer = null;
  let lastCursor = null;
  let lastKnownCount = 0;
  let consecutiveEmpty = 0;
  let retryCount = 0;
  let backoffMs = 0;
  let requestCounter = 0;
  let onStateChange = null;

  const FETCH_DELAY = 2000;       // ms between API calls
  const MAX_EMPTY = 3;            // stop after N responses with 0 new users
  const BASE_BACKOFF = 30000;     // 30s initial rate-limit backoff
  const MAX_BACKOFF = 300000;     // 5 min max
  const MAX_RETRIES = 6;

  // Pending fetch promises keyed by requestId
  const pendingFetches = {};

  function start(currentCount, opts = {}) {
    if (isRunning) return;
    if (opts.onStateChange) onStateChange = opts.onStateChange;
    isRunning = true;
    isPaused = false;
    consecutiveEmpty = 0;
    retryCount = 0;
    backoffMs = 0;
    lastKnownCount = currentCount || 0;
    // lastCursor is preserved across start/stop so we can resume
    console.log('[xtractr] Paginator started, count:', currentCount, 'cursor:', lastCursor ? 'yes' : 'null');
    notifyState();
    fetchNext();
  }

  function stop() {
    if (!isRunning && !isPaused) return;
    clearTimeout(fetchTimer);
    clearTimeout(pauseTimer);
    fetchTimer = null;
    pauseTimer = null;
    isRunning = false;
    isPaused = false;
    console.log('[xtractr] Paginator stopped');
    notifyState();
  }

  function updateCount(newCount) {
    if (newCount > lastKnownCount) {
      consecutiveEmpty = 0;
      lastKnownCount = newCount;
    }
  }

  function setCursor(cursor) {
    if (cursor) {
      console.log('[xtractr] Cursor updated:', cursor.slice(0, 30) + '...');
      lastCursor = cursor;
    }
  }

  function onRateLimit(retryAfterSecs) {
    if (!isRunning || isPaused) return;

    retryCount++;
    if (retryCount > MAX_RETRIES) {
      console.log('[xtractr] Max retries reached, stopping');
      stop();
      return;
    }

    isPaused = true;
    clearTimeout(fetchTimer);

    if (retryAfterSecs && retryAfterSecs > 0) {
      backoffMs = retryAfterSecs * 1000;
    } else {
      backoffMs = Math.min(BASE_BACKOFF * Math.pow(2, retryCount - 1), MAX_BACKOFF);
    }

    console.log(`[xtractr] Rate limited, backing off ${backoffMs}ms (retry ${retryCount}/${MAX_RETRIES})`);
    notifyState();

    pauseTimer = setTimeout(() => {
      isPaused = false;
      notifyState();
      fetchNext();
    }, backoffMs);
  }

  function onNoNewData() {
    if (!isRunning) return;
    consecutiveEmpty++;
    console.log(`[xtractr] No new data from page (${consecutiveEmpty}/${MAX_EMPTY})`);
    if (consecutiveEmpty >= MAX_EMPTY) {
      console.log('[xtractr] Stopping: consecutive pages with no new users');
      stop();
    }
  }

  function fetchNext() {
    if (!isRunning || isPaused) return;

    const listType = currentPage?.type;
    if (!listType) {
      console.warn('[xtractr] No currentPage, stopping paginator');
      stop();
      return;
    }

    const requestId = `req_${++requestCounter}_${Date.now()}`;

    console.log(`[xtractr] Sending fetch command: ${listType}, cursor=${lastCursor ? 'yes' : 'null'}, requestId=${requestId}`);

    // Send fetch command to MAIN world interceptor
    window.postMessage({
      type: 'XPRTR_FETCH_PAGE',
      payload: { listType, cursor: lastCursor, requestId },
    }, '*');

    pendingFetches[requestId] = true;

    // Safety timeout: if we don't hear back in 15s, try again
    fetchTimer = setTimeout(() => {
      console.warn(`[xtractr] Fetch timeout for ${requestId}`);
      delete pendingFetches[requestId];
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY) {
        stop();
      } else {
        fetchNext();
      }
    }, 15000);
  }

  function onFetchResult(requestId, result) {
    if (!pendingFetches[requestId]) return;
    delete pendingFetches[requestId];
    clearTimeout(fetchTimer);

    console.log(`[xtractr] Fetch result for ${requestId}:`,
      result.error ? `error: ${result.error}` :
      result.rateLimited ? 'rate limited' :
      result.data ? 'got data' : 'unknown');

    if (result.error) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= MAX_EMPTY) {
        stop();
        return;
      }
    }

    // Rate limit is handled by the XPRTR_RATE_LIMITED listener
    if (result.rateLimited) return;

    // Schedule next fetch after delay
    if (isRunning && !isPaused) {
      fetchTimer = setTimeout(fetchNext, FETCH_DELAY);
    }
  }

  function notifyState() {
    const state = getState();
    if (onStateChange) onStateChange(state);
    try {
      chrome.runtime.sendMessage({ type: 'XPRTR_AUTOSCROLL_STATUS', payload: state });
    } catch { /* ignore */ }
  }

  function getState() {
    return {
      isRunning,
      isPaused,
      consecutiveEmpty,
      maxEmpty: MAX_EMPTY,
      lastKnownCount,
      backoffMs,
      retryCount,
      hasCursor: !!lastCursor,
    };
  }

  return { start, stop, updateCount, setCursor, onRateLimit, onFetchResult, onNoNewData, getState };
})();

// ---- State ----

let currentPage = null;
let panelElement = null;
let userCount = 0;

// ---- Message listener from MAIN world interceptor ----

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data?.type === 'XPRTR_INTERCEPTED') {
    const { listType, data, rawQueryType } = event.data.payload;
    const isPrimary = /^(Followers|Following)$/i.test(rawQueryType || '');
    console.log(`[xtractr] Received intercepted data for ${listType} (raw: ${rawQueryType}, primary: ${isPrimary})`);

    // Forward to background service worker
    safeSendMessage({
      type: 'XPRTR_DATA_CAPTURED',
      payload: { listType, data, url: window.location.href },
    }, (response) => {
      console.log('[xtractr] Background response:', JSON.stringify(response));
      if (response?.count !== undefined) {
        userCount = response.count;
        Paginator.updateCount(userCount);
        updatePanel();
      }
      // Only update cursor from primary query types (Followers/Following),
      // not subtypes (BlueVerifiedFollowers, FollowersYouKnow) whose cursors
      // are incompatible with the main endpoint
      if (response?.cursor && isPrimary) {
        Paginator.setCursor(response.cursor);
      }
      // Track pages with no new users to detect end-of-list
      if (Paginator.getState().isRunning && response?.added === 0) {
        Paginator.onNoNewData();
        updatePanel();
      }
    });
  }

  if (event.data?.type === 'XPRTR_RATE_LIMITED') {
    const { retryAfter } = event.data.payload;
    console.log('[xtractr] Rate limit received, retryAfter:', retryAfter);
    Paginator.onRateLimit(retryAfter);
    updatePanel();
  }

  if (event.data?.type === 'XPRTR_FETCH_RESULT') {
    const { requestId, ...result } = event.data.payload;
    Paginator.onFetchResult(requestId, result);
  }

  if (event.data?.type === 'XPRTR_TEMPLATE_STATUS') {
    console.log('[xtractr] Template status:', event.data.payload);
  }
});

// ---- Message listener from background / popup ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'XPRTR_SESSION_UPDATE':
      userCount = message.payload?.count || 0;
      updatePanel();
      break;

    case 'XPRTR_START_AUTOSCROLL':
      Paginator.start(userCount, {
        onStateChange: updatePanel,
      });
      updatePanel();
      sendResponse({ ok: true });
      break;

    case 'XPRTR_STOP_AUTOSCROLL':
      Paginator.stop();
      updatePanel();
      sendResponse({ ok: true });
      break;

    case 'XPRTR_AUTOSCROLL_STATE':
      sendResponse(Paginator.getState());
      break;
  }
  return false;
});

// ---- URL Change Detection (SPA navigation) ----

function onPageChange(page) {
  if (page) {
    currentPage = page;
    console.log('[xtractr] Page changed:', page.type, '@' + page.username);

    safeSendMessage({
      type: 'XPRTR_PAGE_CHANGED',
      payload: page,
    }, (response) => {
      userCount = response?.count || 0;
      showPanel();
      updatePanel();

      // Ask the interceptor to resend any cached initial data
      // (it may have captured data before we loaded)
      setTimeout(() => {
        console.log('[xtractr] Requesting resend of cached initial data for', page.type);
        window.postMessage({
          type: 'XPRTR_RESEND_INITIAL',
          payload: { listType: page.type },
        }, '*');
      }, 500);
    });
  } else {
    currentPage = null;
    Paginator.stop();
    hidePanel();
  }
}

// Watch for URL changes
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (!isContextValid()) { cleanup(); return; }
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    onPageChange(detectPage(lastUrl));
  }
});

window.addEventListener('popstate', () => {
  if (!isContextValid()) return;
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    onPageChange(detectPage(lastUrl));
  }
});

// ---- Floating Panel ----

function createPanel() {
  if (panelElement) return;

  const shadow = document.createElement('div');
  shadow.id = 'xtractr-panel-host';
  const root = shadow.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      .xprtr-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        background: var(--xprtr-bg, #15202b);
        color: var(--xprtr-text, #e7e9ea);
        border: 1px solid var(--xprtr-border, #38444d);
        border-radius: 16px;
        padding: 16px;
        width: 280px;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: opacity 0.2s;
        overflow: hidden;
      }
      .xprtr-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .xprtr-title {
        font-weight: 700;
        font-size: 15px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .xprtr-logo {
        font-size: 16px;
        font-weight: 800;
        opacity: 0.8;
      }
      .xprtr-close {
        background: none;
        border: none;
        color: var(--xprtr-text, #e7e9ea);
        cursor: pointer;
        font-size: 18px;
        padding: 2px 6px;
        border-radius: 50%;
        line-height: 1;
      }
      .xprtr-close:hover {
        background: rgba(255,255,255,0.1);
      }
      .xprtr-info {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .xprtr-count {
        font-size: 24px;
        font-weight: 700;
      }
      .xprtr-meta {
        font-size: 12px;
        color: var(--xprtr-secondary, #8899a6);
      }
      .xprtr-actions {
        display: flex;
        gap: 6px;
      }
      .xprtr-btn {
        flex: 1;
        padding: 8px 10px;
        border-radius: 9999px;
        border: 1px solid var(--xprtr-border, #38444d);
        background: transparent;
        color: var(--xprtr-text, #e7e9ea);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
        text-align: center;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .xprtr-btn:hover {
        background: rgba(255,255,255,0.08);
      }
      .xprtr-btn.primary {
        background: var(--xprtr-accent, #1d9bf0);
        border-color: var(--xprtr-accent, #1d9bf0);
        color: #fff;
      }
      .xprtr-btn.primary:hover {
        background: var(--xprtr-accent-hover, #1a8cd8);
      }
      .xprtr-progress {
        margin-top: 10px;
        height: 3px;
        background: var(--xprtr-border, #38444d);
        border-radius: 2px;
        overflow: hidden;
      }
      .xprtr-progress-bar {
        height: 100%;
        background: var(--xprtr-accent, #1d9bf0);
        transition: width 0.3s;
        border-radius: 2px;
      }
      .xprtr-status {
        margin-top: 8px;
        font-size: 12px;
        color: var(--xprtr-secondary, #8899a6);
      }
    </style>
    <div class="xprtr-panel" id="panel">
      <div class="xprtr-header">
        <div class="xprtr-title">
          <span class="xprtr-logo">xtractr</span>
          <span id="pageType"></span>
        </div>
        <button class="xprtr-close" id="closeBtn">&times;</button>
      </div>
      <div class="xprtr-info">
        <div>
          <div class="xprtr-count" id="count">0</div>
          <div class="xprtr-meta">users captured</div>
        </div>
        <div class="xprtr-meta" id="username"></div>
      </div>
      <div class="xprtr-actions">
        <button class="xprtr-btn primary" id="fetchBtn">Fetch All</button>
        <button class="xprtr-btn" id="csvBtn">CSV</button>
        <button class="xprtr-btn" id="jsonBtn">JSON</button>
      </div>
      <div class="xprtr-progress" id="progressWrap" style="display:none">
        <div class="xprtr-progress-bar" id="progressBar" style="width:0%"></div>
      </div>
      <div class="xprtr-status" id="status"></div>
    </div>
  `;

  // Theme detection
  applyTheme(root);

  // Event listeners
  root.getElementById('closeBtn').addEventListener('click', () => {
    shadow.style.display = 'none';
  });

  root.getElementById('fetchBtn').addEventListener('click', () => {
    const state = Paginator.getState();
    if (state.isRunning || state.isPaused) {
      Paginator.stop();
    } else {
      Paginator.start(userCount, {
        onStateChange: updatePanel,
      });
    }
    updatePanel();
  });

  root.getElementById('csvBtn').addEventListener('click', () => {
    safeSendMessage({ type: 'XPRTR_EXPORT_CSV' });
  });

  root.getElementById('jsonBtn').addEventListener('click', () => {
    safeSendMessage({ type: 'XPRTR_EXPORT_JSON' });
  });

  document.body.appendChild(shadow);
  panelElement = { host: shadow, root };
}

function applyTheme(root) {
  const bg = getComputedStyle(document.body).backgroundColor;
  const panel = root.getElementById('panel');
  if (!panel) return;

  if (bg === 'rgb(255, 255, 255)') {
    panel.style.setProperty('--xprtr-bg', '#ffffff');
    panel.style.setProperty('--xprtr-text', '#0f1419');
    panel.style.setProperty('--xprtr-border', '#eff3f4');
    panel.style.setProperty('--xprtr-secondary', '#536471');
  } else if (bg === 'rgb(21, 32, 43)') {
    panel.style.setProperty('--xprtr-bg', '#15202b');
    panel.style.setProperty('--xprtr-text', '#e7e9ea');
    panel.style.setProperty('--xprtr-border', '#38444d');
    panel.style.setProperty('--xprtr-secondary', '#8899a6');
  } else {
    panel.style.setProperty('--xprtr-bg', '#000000');
    panel.style.setProperty('--xprtr-text', '#e7e9ea');
    panel.style.setProperty('--xprtr-border', '#2f3336');
    panel.style.setProperty('--xprtr-secondary', '#71767b');
  }
}

function showPanel() {
  if (!panelElement) createPanel();
  panelElement.host.style.display = '';
  updatePanel();
}

function hidePanel() {
  if (panelElement) {
    panelElement.host.style.display = 'none';
  }
  Paginator.stop();
}

function updatePanel() {
  if (!panelElement) return;
  const root = panelElement.root;

  const countEl = root.getElementById('count');
  const pageTypeEl = root.getElementById('pageType');
  const usernameEl = root.getElementById('username');
  const fetchBtn = root.getElementById('fetchBtn');
  const statusEl = root.getElementById('status');
  const progressWrap = root.getElementById('progressWrap');
  const progressBar = root.getElementById('progressBar');

  if (countEl) countEl.textContent = userCount.toLocaleString();

  if (currentPage) {
    if (pageTypeEl) pageTypeEl.textContent = currentPage.type;
    if (usernameEl) usernameEl.textContent = `@${currentPage.username}`;
  }

  const state = Paginator.getState();
  if (fetchBtn) {
    if (state.isPaused) {
      fetchBtn.textContent = 'Stop (paused)';
      fetchBtn.classList.remove('primary');
    } else if (state.isRunning) {
      fetchBtn.textContent = 'Stop';
      fetchBtn.classList.remove('primary');
    } else {
      fetchBtn.textContent = state.hasCursor ? 'Fetch' : 'Fetch All';
      fetchBtn.classList.add('primary');
    }
  }

  if (state.isPaused) {
    if (progressWrap) progressWrap.style.display = '';
    if (progressBar) {
      progressBar.style.width = '100%';
      progressBar.style.background = '#ffd400';
    }
    const waitSec = Math.ceil((state.backoffMs || 30000) / 1000);
    if (statusEl) statusEl.textContent = `Rate limited \u2013 retrying in ~${waitSec}s (${state.retryCount}/6)`;
  } else if (state.isRunning) {
    if (progressWrap) progressWrap.style.display = '';
    if (progressBar) {
      progressBar.style.background = '';
      progressBar.style.width = '100%';
    }
    if (statusEl) statusEl.textContent = `Fetching page ${state.consecutiveEmpty === 0 ? '(getting data...)' : `(${state.consecutiveEmpty}/${state.maxEmpty} empty)`}`;
  } else {
    if (progressWrap) progressWrap.style.display = 'none';
    if (progressBar) progressBar.style.background = '';
    if (statusEl) {
      if (userCount > 0) {
        statusEl.textContent = state.hasCursor ? 'Paused \u2013 more data available' : 'Complete \u2013 ready to export';
      } else {
        statusEl.textContent = 'Waiting for data\u2026';
      }
    }
  }
}

// ---- Init ----

const page = detectPage();
if (page) {
  onPageChange(page);
}

if (document.body) {
  urlObserver.observe(document.body, { childList: true, subtree: true });
}
