/**
 * chrome.storage.local CRUD operations for session data, history, and settings.
 */

const KEYS = {
  CURRENT_SESSION: 'currentSession',
  HISTORY: 'history',
  SAVED_LISTS: 'savedLists',
  SETTINGS: 'settings',
  FOLLOW_QUEUE: 'followQueue',
};

const DEFAULT_SETTINGS = {
  autoScroll: true,
  scrollDelay: 2000,
  staleThreshold: 5,
  exportFields: [
    'username', 'displayName', 'bio', 'followersCount',
    'followingCount', 'verified', 'joinDate', 'location', 'profileUrl',
  ],
};

export async function getSession() {
  const result = await chrome.storage.local.get(KEYS.CURRENT_SESSION);
  return result[KEYS.CURRENT_SESSION] || null;
}

export async function setSession(session) {
  await chrome.storage.local.set({ [KEYS.CURRENT_SESSION]: session });
}

export async function clearSession() {
  await chrome.storage.local.remove(KEYS.CURRENT_SESSION);
}

export async function createSession(username, type) {
  const session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    username,
    type,
    users: [],
    userIds: {},  // Map of rest_id -> true for fast dedup
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
  await setSession(session);
  return session;
}

export async function addUsersToSession(newUsers) {
  const session = await getSession();
  if (!session) return null;

  let added = 0;
  for (const user of newUsers) {
    if (!session.userIds[user.userId]) {
      session.userIds[user.userId] = true;
      session.users.push(user);
      added++;
    }
  }

  if (added > 0) {
    session.lastUpdatedAt = new Date().toISOString();
    await setSession(session);
  }

  return { count: session.users.length, added };
}

export async function getHistory() {
  const result = await chrome.storage.local.get(KEYS.HISTORY);
  return result[KEYS.HISTORY] || [];
}

export async function addToHistory(sessionMeta) {
  const history = await getHistory();
  history.unshift(sessionMeta);
  // Keep last 50 entries
  if (history.length > 50) history.length = 50;
  await chrome.storage.local.set({ [KEYS.HISTORY]: history });
}

export async function getSavedLists() {
  const result = await chrome.storage.local.get(KEYS.SAVED_LISTS);
  return result[KEYS.SAVED_LISTS] || {};
}

export async function saveList(key, users, meta) {
  const lists = await getSavedLists();
  lists[key] = { users, meta, savedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [KEYS.SAVED_LISTS]: lists });
}

export async function deleteSavedList(key) {
  const lists = await getSavedLists();
  delete lists[key];
  await chrome.storage.local.set({ [KEYS.SAVED_LISTS]: lists });
}

export async function getSettings() {
  const result = await chrome.storage.local.get(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[KEYS.SETTINGS] || {}) };
}

export async function updateSettings(updates) {
  const settings = await getSettings();
  Object.assign(settings, updates);
  await chrome.storage.local.set({ [KEYS.SETTINGS]: settings });
  return settings;
}

// ---- Follow Queue ----

export async function getFollowQueue() {
  const result = await chrome.storage.local.get(KEYS.FOLLOW_QUEUE);
  return result[KEYS.FOLLOW_QUEUE] || null;
}

export async function setFollowQueue(queue) {
  await chrome.storage.local.set({ [KEYS.FOLLOW_QUEUE]: queue });
}

export async function clearFollowQueue() {
  await chrome.storage.local.remove(KEYS.FOLLOW_QUEUE);
}
