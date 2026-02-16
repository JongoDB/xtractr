/**
 * Auto-scroll controller for paginating through followers/following lists.
 *
 * Scrolls the page at a configurable interval. Detects stale state
 * (no new users after N consecutive scrolls) and stops automatically.
 * Never makes its own API calls - just scrolls the page so Twitter loads more.
 */

const AutoScroll = (() => {
  let scrollTimer = null;
  let staleCount = 0;
  let lastKnownCount = 0;
  let isRunning = false;
  let settings = { scrollDelay: 2000, staleThreshold: 5 };
  let onStateChange = null;

  function start(currentCount, opts = {}) {
    if (isRunning) return;

    if (opts.scrollDelay) settings.scrollDelay = opts.scrollDelay;
    if (opts.staleThreshold) settings.staleThreshold = opts.staleThreshold;
    if (opts.onStateChange) onStateChange = opts.onStateChange;

    isRunning = true;
    staleCount = 0;
    lastKnownCount = currentCount || 0;
    notifyState();
    tick();
  }

  function stop() {
    if (!isRunning) return;
    clearTimeout(scrollTimer);
    scrollTimer = null;
    isRunning = false;
    notifyState();
  }

  function updateCount(newCount) {
    if (newCount > lastKnownCount) {
      staleCount = 0;
      lastKnownCount = newCount;
    }
  }

  function tick() {
    if (!isRunning) return;

    // Scroll to bottom
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    staleCount++;

    if (staleCount >= settings.staleThreshold) {
      // No new data after threshold scrolls - we've likely reached the end
      stop();
      return;
    }

    scrollTimer = setTimeout(tick, settings.scrollDelay);
  }

  function notifyState() {
    const state = {
      isRunning,
      staleCount,
      lastKnownCount,
      staleThreshold: settings.staleThreshold,
    };
    if (onStateChange) onStateChange(state);
    // Also notify background
    try {
      chrome.runtime.sendMessage({
        type: 'XPRTR_AUTOSCROLL_STATUS',
        payload: state,
      });
    } catch { /* extension context may be invalid */ }
  }

  function getState() {
    return {
      isRunning,
      staleCount,
      lastKnownCount,
      staleThreshold: settings.staleThreshold,
    };
  }

  return { start, stop, updateCount, getState };
})();
