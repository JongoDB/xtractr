/**
 * Popup script - status, filtering, export, follow queue.
 */

const $ = (id) => document.getElementById(id);

// Preset keywords (duplicated from constants since popup can't use ES modules)
const FILTER_PRESETS = {
  'Tech': [
    'developer', 'engineer', 'software', 'devops', 'sre', 'cloud',
    'infrastructure', 'sysadmin', 'backend', 'frontend', 'fullstack',
    'full-stack', 'programming', 'coder', 'architect', 'tech lead',
    'cto', 'cio', 'vp engineering', 'python', 'javascript',
    'typescript', 'golang', 'rust', 'java ', 'kubernetes', 'k8s', 'docker',
    'aws', 'azure', 'gcp', 'terraform', 'linux', 'open source',
    'web dev', 'mobile dev', 'ios dev', 'android dev', 'react', 'node',
    'database', 'sql', 'nosql', 'api', 'microservices',
  ],
  'Security': [
    'security', 'infosec', 'cybersecurity', 'cyber', 'pentester',
    'penetration test', 'red team', 'blue team', 'soc ', 'threat',
    'malware', 'vulnerability', 'ciso', 'appsec', 'devsecops',
    'incident response', 'forensic', 'osint', 'bug bounty', 'hacker',
    'offensive sec', 'defensive sec', 'compliance', 'grc',
  ],
  'Data': [
    'data scientist', 'data analyst', 'analytics', 'big data',
    'data engineering', 'business intelligence', 'tableau', 'power bi',
    'statistics', 'machine learning', 'ml ', 'ai ', 'artificial intelligence',
    'deep learning', 'nlp', 'computer vision', 'data engineer',
  ],
  'Design': [
    'designer', 'ux ', 'ui ', 'product design', 'ux research',
    'user experience', 'figma', 'interaction design', 'design system',
    'graphic design', 'creative director', 'visual design', 'brand design',
  ],
  'Marketing': [
    'marketing', 'growth', 'seo', 'sem', 'social media', 'brand',
    'digital marketing', 'content marketing', 'copywriter', 'ppc',
    'email marketing', 'demand gen', 'cmo', 'marketing manager',
    'influencer', 'ad tech', 'growth hacker', 'community manager',
  ],
  'Finance': [
    'finance', 'fintech', 'banking', 'investment', 'trading',
    'venture capital', 'vc ', 'private equity', 'cfo', 'financial analyst',
    'portfolio', 'asset management', 'crypto', 'defi', 'blockchain',
    'accounting', 'cpa', 'hedge fund', 'wealth management',
  ],
  'Healthcare': [
    'healthcare', 'medical', 'physician', 'nurse', 'biotech', 'pharma',
    'clinical', 'health tech', 'telemedicine', 'public health',
    'hospital', 'doctor', 'surgeon', 'mental health', 'therapeutics',
  ],
  'Legal': [
    'lawyer', 'attorney', 'legal', 'law firm', 'paralegal', 'litigation',
    'corporate counsel', 'ip law', 'patent', 'compliance', 'regulatory',
    'legal tech', 'contract', 'general counsel', 'law school',
  ],
  'Education': [
    'educator', 'teacher', 'professor', 'academic', 'university',
    'edtech', 'learning', 'curriculum', 'school', 'higher education',
    'research', 'stem education', 'instructional design', 'dean',
  ],
  'Media': [
    'journalist', 'reporter', 'media', 'news', 'editor', 'publisher',
    'content creator', 'podcaster', 'writer', 'author', 'broadcaster',
    'filmmaker', 'producer', 'press', 'correspondent',
  ],
};

let activePresets = new Set();
let filterDebounceTimer = null;

// ---- Load state ----

async function loadStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'XPRTR_GET_STATUS' });

  if (response?.active) {
    $('inactive').style.display = 'none';
    $('active').style.display = '';
    $('username').textContent = `@${response.username}`;
    $('listType').textContent = response.type;
    $('count').textContent = response.count.toLocaleString();
  } else {
    $('inactive').style.display = '';
    $('active').style.display = 'none';
  }
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'XPRTR_GET_HISTORY' });
  const container = $('history');

  if (!response?.history?.length) {
    container.innerHTML = '<p class="hint">No export history yet.</p>';
    return;
  }

  container.innerHTML = response.history.slice(0, 10).map(item => `
    <div class="history-item">
      <div>
        <strong>@${item.username}</strong> ${item.type}
        <span class="meta">${item.count} users</span>
      </div>
      <div class="meta">${formatDate(item.completedAt || item.startedAt)}</div>
    </div>
  `).join('');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

// ---- Filtering ----

function getFilters() {
  // Collect all active preset keywords + custom keywords
  const keywords = [];

  for (const preset of activePresets) {
    if (FILTER_PRESETS[preset]) {
      keywords.push(...FILTER_PRESETS[preset]);
    }
  }

  // Add custom keywords
  const customKw = $('keywords').value.trim();
  if (customKw) {
    keywords.push(...customKw.split(',').map(k => k.trim()).filter(Boolean));
  }

  const minFollowers = $('minFollowers').value ? parseInt($('minFollowers').value, 10) : null;
  const maxFollowers = $('maxFollowers').value ? parseInt($('maxFollowers').value, 10) : null;
  const verifiedOnly = $('verifiedOnly').checked;
  const hasBio = $('hasBio').checked;
  const minScore = parseInt($('threshold').value, 10) || 1;

  return {
    keywords: keywords.length > 0 ? keywords : null,
    minFollowers,
    maxFollowers,
    verifiedOnly,
    hasBio,
    minScore,
  };
}

async function runFilter() {
  const filters = getFilters();
  const response = await chrome.runtime.sendMessage({
    type: 'XPRTR_FILTER_USERS',
    payload: filters,
  });

  const count = response?.users?.length || 0;
  $('matchCount').textContent = count.toLocaleString();

  // Score distribution
  const buckets = response?.scoreBuckets;
  if (buckets && count > 0) {
    $('scoreBuckets').style.display = '';
    $('highCount').textContent = buckets.high;
    $('medCount').textContent = buckets.medium;
    $('lowCount').textContent = buckets.low;
  } else {
    $('scoreBuckets').style.display = 'none';
  }

  // Top matches preview
  const topMatches = response?.topMatches;
  if (topMatches && topMatches.length > 0) {
    $('topMatches').style.display = '';
    $('topMatchesList').innerHTML = topMatches.map(m => {
      const scoreClass = m.score >= 50 ? 'score-high' : m.score >= 20 ? 'score-med' : 'score-low';
      const kwText = m.topKeywords.length > 0 ? m.topKeywords.join(', ') : '';
      return `
        <div class="top-match-item">
          <span class="top-match-name" title="@${esc(m.username)}">${esc(m.displayName || m.username)}</span>
          <span class="top-match-keywords" title="${esc(kwText)}">${esc(kwText)}</span>
          <span class="top-match-score ${scoreClass}">${m.score}%</span>
        </div>
      `;
    }).join('');
  } else {
    $('topMatches').style.display = 'none';
  }
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scheduleFilter() {
  clearTimeout(filterDebounceTimer);
  filterDebounceTimer = setTimeout(runFilter, 300);
}

// Filter toggle
$('filterToggle').addEventListener('click', () => {
  const panel = $('filterPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : '';
  $('filterToggle').classList.toggle('open', !isOpen);
  $('filterToggle').textContent = isOpen ? 'Filter before export...' : 'Hide filters';
  if (!isOpen) runFilter();
});

// Preset chips
$('presetChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const preset = chip.dataset.preset;

  if (activePresets.has(preset)) {
    activePresets.delete(preset);
    chip.classList.remove('active');
  } else {
    activePresets.add(preset);
    chip.classList.add('active');
  }
  scheduleFilter();
});

// Filter inputs trigger re-filter
$('keywords').addEventListener('input', scheduleFilter);
$('minFollowers').addEventListener('input', scheduleFilter);
$('maxFollowers').addEventListener('input', scheduleFilter);
$('verifiedOnly').addEventListener('change', scheduleFilter);
$('hasBio').addEventListener('change', scheduleFilter);
$('threshold').addEventListener('input', () => {
  $('thresholdValue').textContent = $('threshold').value;
  scheduleFilter();
});

// Filtered exports
$('filteredCsvBtn').addEventListener('click', async () => {
  $('filteredCsvBtn').disabled = true;
  await chrome.runtime.sendMessage({
    type: 'XPRTR_EXPORT_FILTERED_CSV',
    payload: getFilters(),
  });
  $('filteredCsvBtn').disabled = false;
});

$('filteredJsonBtn').addEventListener('click', async () => {
  $('filteredJsonBtn').disabled = true;
  await chrome.runtime.sendMessage({
    type: 'XPRTR_EXPORT_FILTERED_JSON',
    payload: getFilters(),
  });
  $('filteredJsonBtn').disabled = false;
});

// Send to follow queue
$('queueBtn').addEventListener('click', async () => {
  $('queueBtn').disabled = true;
  $('queueBtn').textContent = 'Filtering...';

  const filters = getFilters();
  const response = await chrome.runtime.sendMessage({
    type: 'XPRTR_FILTER_USERS',
    payload: filters,
  });

  const users = response?.users || [];
  if (!users.length) {
    $('queueBtn').textContent = 'No matches';
    setTimeout(() => {
      $('queueBtn').textContent = 'Send to Follow Queue';
      $('queueBtn').disabled = false;
    }, 1500);
    return;
  }

  await chrome.runtime.sendMessage({
    type: 'XPRTR_SET_FOLLOW_QUEUE',
    payload: { users, source: 'filter' },
  });

  $('queueBtn').textContent = `${users.length} queued!`;

  // Open the queue page
  chrome.tabs.create({ url: chrome.runtime.getURL('src/queue/queue.html') });

  setTimeout(() => {
    $('queueBtn').textContent = 'Send to Follow Queue';
    $('queueBtn').disabled = false;
  }, 2000);
});

// ---- Fetch control ----

async function updateScrollButton() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'XPRTR_AUTOSCROLL_STATE' });
    if (state?.isPaused) {
      $('scrollBtn').textContent = 'Stop (paused)';
      $('scrollBtn').classList.remove('primary');
    } else if (state?.isRunning) {
      $('scrollBtn').textContent = 'Stop';
      $('scrollBtn').classList.remove('primary');
    } else {
      $('scrollBtn').textContent = state?.hasCursor ? 'Fetch' : 'Fetch All';
      $('scrollBtn').classList.add('primary');
    }
  } catch { /* content script not available */ }
}

// ---- Event listeners ----

$('scrollBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    const state = await chrome.tabs.sendMessage(tab.id, { type: 'XPRTR_AUTOSCROLL_STATE' });
    if (state?.isRunning) {
      await chrome.tabs.sendMessage(tab.id, { type: 'XPRTR_STOP_AUTOSCROLL' });
    } else {
      await chrome.tabs.sendMessage(tab.id, { type: 'XPRTR_START_AUTOSCROLL' });
    }
    updateScrollButton();
  } catch { /* content script not ready */ }
});

$('csvBtn').addEventListener('click', async () => {
  $('csvBtn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'XPRTR_EXPORT_CSV' });
  $('csvBtn').disabled = false;
});

$('jsonBtn').addEventListener('click', async () => {
  $('jsonBtn').disabled = true;
  await chrome.runtime.sendMessage({ type: 'XPRTR_EXPORT_JSON' });
  $('jsonBtn').disabled = false;
});

$('saveBtn').addEventListener('click', async () => {
  $('saveBtn').disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'XPRTR_SAVE_LIST' });
  if (result?.ok) {
    $('saveBtn').textContent = 'Saved!';
    setTimeout(() => {
      $('saveBtn').textContent = 'Save List';
      $('saveBtn').disabled = false;
    }, 1500);
  } else {
    $('saveBtn').textContent = result?.error || 'Error';
    setTimeout(() => {
      $('saveBtn').textContent = 'Save List';
      $('saveBtn').disabled = false;
    }, 1500);
  }
});

$('clearBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'XPRTR_CLEAR_SESSION' });
  loadStatus();
  loadHistory();
});

$('optionsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

$('queueLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('src/queue/queue.html') });
});

// ---- Listen for updates from background ----

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'XPRTR_SESSION_UPDATE') {
    $('count').textContent = (message.payload?.count || 0).toLocaleString();
    // Re-run filter if panel is open
    if ($('filterPanel').style.display !== 'none') {
      scheduleFilter();
    }
  }
});

// ---- Init ----

loadStatus();
loadHistory();
updateScrollButton();
setInterval(loadStatus, 3000);
