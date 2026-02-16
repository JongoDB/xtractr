/**
 * Follow queue page - presents filtered users one at a time.
 * "Open Profile & Follow" opens the user's X profile in a new tab.
 * "Skip" advances to the next user without opening.
 */

const $ = (id) => document.getElementById(id);

let queue = null;

async function loadQueue() {
  const response = await chrome.runtime.sendMessage({ type: 'XPRTR_GET_FOLLOW_QUEUE' });
  queue = response?.queue || null;

  if (!queue || !queue.users || !queue.users.length) {
    $('emptyState').style.display = '';
    $('queueActive').style.display = 'none';
    return;
  }

  $('emptyState').style.display = 'none';
  $('queueActive').style.display = '';
  render();
}

function render() {
  if (!queue) return;

  const total = queue.users.length;
  const idx = queue.currentIndex || 0;
  const followed = queue.followed?.length || 0;
  const skipped = queue.skipped?.length || 0;
  const remaining = total - idx;
  const pct = total > 0 ? (idx / total) * 100 : 0;

  $('progressText').textContent = `${idx} / ${total}`;
  $('progressBar').style.width = `${pct}%`;
  $('followedCount').textContent = followed;
  $('skippedCount').textContent = skipped;
  $('remainingCount').textContent = remaining;

  if (idx >= total) {
    // All done
    $('userCard').style.display = 'none';
    $('doneState').style.display = '';
    $('doneSummary').textContent = `Followed ${followed} accounts, skipped ${skipped}.`;
    return;
  }

  $('userCard').style.display = '';
  $('doneState').style.display = 'none';

  const user = queue.users[idx];
  $('avatar').src = user.profileImageUrl || '';
  $('avatar').style.visibility = user.profileImageUrl ? 'visible' : 'hidden';
  $('displayName').textContent = user.displayName || user.username;
  $('handle').textContent = `@${user.username}`;
  $('bio').textContent = user.bio || '';
  $('cardFollowers').textContent = (user.followersCount || 0).toLocaleString();
  $('cardFollowing').textContent = (user.followingCount || 0).toLocaleString();
  $('cardLocation').textContent = user.location || '';

  // Show relevance score if available
  const scoreEl = $('relevanceScore');
  if (user._score != null) {
    scoreEl.style.display = '';
    scoreEl.textContent = `${user._score}% match`;
    scoreEl.className = 'relevance-score ' + (user._score >= 50 ? 'high' : user._score >= 20 ? 'med' : 'low');
  } else {
    scoreEl.style.display = 'none';
  }

  // Show matched keywords
  const kwEl = $('matchedKeywords');
  if (user._matches && user._matches.length > 0) {
    kwEl.style.display = '';
    kwEl.innerHTML = user._matches.slice(0, 5).map(m =>
      `<span class="kw-tag">${esc(m.keyword)}</span>`
    ).join('');
  } else {
    kwEl.style.display = 'none';
  }
}

// Follow: open profile in new tab, mark as followed, advance
$('followBtn').addEventListener('click', async () => {
  if (!queue || queue.currentIndex >= queue.users.length) return;

  const user = queue.users[queue.currentIndex];
  // Open the profile in a new tab
  window.open(user.profileUrl || `https://x.com/${user.username}`, '_blank');

  // Update queue state
  const response = await chrome.runtime.sendMessage({
    type: 'XPRTR_UPDATE_FOLLOW_QUEUE',
    payload: { action: 'follow', userId: user.userId },
  });
  queue = response?.queue || queue;
  render();
});

// Skip: advance without opening
$('skipBtn').addEventListener('click', async () => {
  if (!queue || queue.currentIndex >= queue.users.length) return;

  const user = queue.users[queue.currentIndex];
  const response = await chrome.runtime.sendMessage({
    type: 'XPRTR_UPDATE_FOLLOW_QUEUE',
    payload: { action: 'skip', userId: user.userId },
  });
  queue = response?.queue || queue;
  render();
});

// Clear queue
$('clearQueueBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'XPRTR_SET_FOLLOW_QUEUE',
    payload: { users: [] },
  });
  queue = null;
  $('emptyState').style.display = '';
  $('queueActive').style.display = 'none';
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'Enter') {
    $('followBtn').click();
  } else if (e.key === 's' || e.key === 'ArrowRight') {
    $('skipBtn').click();
  }
});

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

loadQueue();
