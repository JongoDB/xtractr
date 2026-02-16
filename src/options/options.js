/**
 * Options page - list comparison, saved lists, settings.
 */

const $ = (id) => document.getElementById(id);

let comparisonResult = null;
let currentTab = 'notFollowingBack';

// ---- Load saved lists ----

async function loadSavedLists() {
  const response = await chrome.runtime.sendMessage({ type: 'XPRTR_GET_SAVED_LISTS' });
  const lists = response?.lists || {};
  const keys = Object.keys(lists);

  const container = $('savedLists');

  if (!keys.length) {
    container.innerHTML = '<p class="hint">No saved lists yet. Capture followers/following from X and save them.</p>';
    $('compareSection').style.display = 'none';
    return;
  }

  container.innerHTML = keys.map(key => {
    const list = lists[key];
    const meta = list.meta || {};
    return `
      <div class="list-card">
        <div class="name">@${escapeHtml(meta.username || '?')} - ${escapeHtml(meta.type || '?')}</div>
        <div class="meta">${(list.users || []).length} users &middot; ${formatDate(list.savedAt)}</div>
        <div class="actions">
          <button class="btn small danger" data-delete-key="${escapeHtml(key)}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Show compare section and populate dropdowns
  $('compareSection').style.display = '';
  populateSelects(lists, keys);
}

function populateSelects(lists, keys) {
  const followersSel = $('followersList');
  const followingSel = $('followingList');

  const makeOptions = (keys, lists) => keys.map(key => {
    const meta = lists[key].meta || {};
    const count = (lists[key].users || []).length;
    return `<option value="${key}">@${meta.username || '?'} ${meta.type || '?'} (${count})</option>`;
  }).join('');

  followersSel.innerHTML = makeOptions(keys, lists);
  followingSel.innerHTML = makeOptions(keys, lists);

  // Pre-select: first followers list for followers, first following list for following
  const followersKey = keys.find(k => lists[k].meta?.type === 'followers');
  const followingKey = keys.find(k => lists[k].meta?.type === 'following');
  if (followersKey) followersSel.value = followersKey;
  if (followingKey) followingSel.value = followingKey;
}

// ---- Compare ----

$('compareBtn').addEventListener('click', async () => {
  const followersKey = $('followersList').value;
  const followingKey = $('followingList').value;

  if (!followersKey || !followingKey) return;

  const response = await chrome.runtime.sendMessage({
    type: 'XPRTR_COMPARE_LISTS',
    payload: { followersKey, followingKey },
  });

  comparisonResult = response;
  $('resultsSection').style.display = '';
  renderStats(response.stats);
  renderUserList(response[currentTab] || []);
});

function renderStats(stats) {
  $('stats').innerHTML = `
    <div class="stat-card">
      <div class="value">${stats.totalFollowers.toLocaleString()}</div>
      <div class="label">Followers</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.totalFollowing.toLocaleString()}</div>
      <div class="label">Following</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.mutualCount.toLocaleString()}</div>
      <div class="label">Mutuals</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.notFollowingBackCount.toLocaleString()}</div>
      <div class="label">Don't Follow Back</div>
    </div>
    <div class="stat-card">
      <div class="value">${stats.notFollowedBackCount.toLocaleString()}</div>
      <div class="label">You Don't Follow Back</div>
    </div>
  `;
}

// ---- Tabs ----

$('tabs').addEventListener('click', (e) => {
  const tab = e.target.dataset?.tab;
  if (!tab || !comparisonResult) return;

  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  renderUserList(comparisonResult[tab] || []);
});

// ---- Search ----

$('searchInput').addEventListener('input', (e) => {
  if (!comparisonResult) return;
  const query = e.target.value.toLowerCase();
  const list = comparisonResult[currentTab] || [];
  const filtered = query
    ? list.filter(u =>
        u.username.toLowerCase().includes(query) ||
        u.displayName.toLowerCase().includes(query) ||
        (u.bio && u.bio.toLowerCase().includes(query))
      )
    : list;
  renderUserList(filtered);
});

// ---- Render users ----

function renderUserList(users) {
  const container = $('userList');
  if (!users.length) {
    container.innerHTML = '<p class="hint">No users in this category.</p>';
    return;
  }

  container.innerHTML = users.slice(0, 200).map(u => `
    <div class="user-item">
      <img class="user-avatar" src="${u.profileImageUrl || ''}" alt="" onerror="this.style.display='none'">
      <div class="user-info">
        <div class="name">${escapeHtml(u.displayName)}</div>
        <div class="handle">@${escapeHtml(u.username)}</div>
        ${u.bio ? `<div class="bio">${escapeHtml(u.bio)}</div>` : ''}
      </div>
      <div class="user-stats">
        ${u.followersCount.toLocaleString()} followers<br>
        ${u.followingCount.toLocaleString()} following
      </div>
    </div>
  `).join('');

  if (users.length > 200) {
    container.innerHTML += `<p class="hint" style="padding:12px 0">Showing 200 of ${users.length} users. Export for full list.</p>`;
  }
}

// ---- Export results ----

$('exportResultCSV').addEventListener('click', () => {
  if (!comparisonResult) return;
  const users = comparisonResult[currentTab] || [];
  downloadData(generateCSV(users), `comparison_${currentTab}.csv`, 'text/csv');
});

$('exportResultJSON').addEventListener('click', () => {
  if (!comparisonResult) return;
  const users = comparisonResult[currentTab] || [];
  downloadData(JSON.stringify(users, null, 2), `comparison_${currentTab}.json`, 'application/json');
});

function generateCSV(users) {
  const headers = ['Username', 'Display Name', 'Bio', 'Followers', 'Following', 'Verified', 'Location', 'Profile URL'];
  const keys = ['username', 'displayName', 'bio', 'followersCount', 'followingCount', 'verified', 'location', 'profileUrl'];
  const rows = users.map(u => keys.map(k => escapeCSV(u[k])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

function escapeCSV(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadData(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Delete list ----

$('savedLists').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-key]');
  if (!btn) return;
  const key = btn.dataset.deleteKey;
  await chrome.runtime.sendMessage({ type: 'XPRTR_DELETE_SAVED_LIST', payload: { key } });
  loadSavedLists();
});

// ---- Settings ----

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: 'XPRTR_GET_SETTINGS' });
  const settings = response?.settings || {};
  $('scrollDelay').value = settings.scrollDelay || 2000;
  $('staleThreshold').value = settings.staleThreshold || 5;
}

$('saveSettingsBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'XPRTR_UPDATE_SETTINGS',
    payload: {
      scrollDelay: parseInt($('scrollDelay').value, 10) || 2000,
      staleThreshold: parseInt($('staleThreshold').value, 10) || 5,
    },
  });
  $('saveSettingsBtn').textContent = 'Saved!';
  setTimeout(() => { $('saveSettingsBtn').textContent = 'Save Settings'; }, 1500);
});

// ---- Helpers ----

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// ---- Init ----

loadSavedLists();
loadSettings();
