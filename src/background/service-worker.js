/**
 * Background service worker - message routing + coordination.
 * Receives data from content script, manages storage, handles exports.
 */

import * as store from './data-store.js';
import { deduplicateUsers } from './deduplicator.js';
import { exportCSV, exportJSON } from './exporter.js';
import { compareLists } from './comparator.js';
import { ensureSession, completeSession, getStatus } from './session-manager.js';

// Inline parser since service worker uses ES modules but parser is also
// used by interceptor context. We import the logic directly.
let _firstEntryDumped = false;

function parseGraphQLResponse(json) {
  const entries = extractEntries(json);
  if (!entries || !entries.length) {
    console.warn('[xtractr-bg] parseGraphQLResponse: no entries found');
    return { users: [], cursor: null };
  }

  console.log(`[xtractr-bg] Found ${entries.length} entries`);
  console.log('[xtractr-bg] Entry IDs:', entries.map(e => e.entryId).join(', '));

  const users = [];
  let cursor = null;

  for (const entry of entries) {
    const entryId = entry.entryId || '';

    if (entryId.startsWith('user-')) {
      // Individual user entry (old format)
      if (!_firstEntryDumped) {
        _firstEntryDumped = true;
        dumpEntryStructure(entry);
      }
      const user = extractUserFromEntry(entry);
      if (user) users.push(user);
    } else if (entryId.startsWith('cursor-bottom-') || entryId.startsWith('cursor-bottom|')) {
      cursor = extractCursorValue(entry);
    } else {
      // Check for module entry (TimelineTimelineModule) containing nested user items
      const items = entry?.content?.items;
      if (Array.isArray(items) && items.length > 0) {
        console.log(`[xtractr-bg] Module entry "${entryId}" has ${items.length} items`);
        // Dump the first module item's full structure
        if (!_firstEntryDumped) {
          _firstEntryDumped = true;
          try {
            const firstItem = items[0];
            console.log('[xtractr-bg] === FIRST MODULE ITEM DUMP ===');
            console.log('[xtractr-bg] item keys:', Object.keys(firstItem));
            console.log('[xtractr-bg] item.entryId:', firstItem.entryId);
            console.log('[xtractr-bg] item.item keys:', firstItem.item ? Object.keys(firstItem.item) : 'NO .item');
            const ic = firstItem.item?.itemContent || firstItem.itemContent;
            console.log('[xtractr-bg] itemContent keys:', ic ? Object.keys(ic) : 'NO itemContent');
            const ur = ic?.user_results;
            console.log('[xtractr-bg] user_results keys:', ur ? Object.keys(ur) : 'NO user_results');
            const res = ur?.result;
            if (res) {
              console.log('[xtractr-bg] result keys:', Object.keys(res));
              console.log('[xtractr-bg] result.__typename:', res.__typename);
              console.log('[xtractr-bg] result.rest_id:', res.rest_id);
              console.log('[xtractr-bg] result.legacy keys:', res.legacy ? Object.keys(res.legacy) : 'NO legacy');
              if (res.legacy) {
                console.log('[xtractr-bg] legacy.screen_name:', res.legacy.screen_name);
                console.log('[xtractr-bg] legacy.name:', res.legacy.name);
              }
              console.log('[xtractr-bg] result.core keys:', res.core ? Object.keys(res.core) : 'NO core');
            } else {
              console.log('[xtractr-bg] NO result in user_results');
            }
            // Also try the recursive finder on this item
            const foundViaRecursive = findUserResultRecursive(firstItem);
            console.log('[xtractr-bg] Recursive finder result keys:', foundViaRecursive ? Object.keys(foundViaRecursive) : 'NULL');
            if (foundViaRecursive) {
              console.log('[xtractr-bg] Recursive rest_id:', foundViaRecursive.rest_id);
              console.log('[xtractr-bg] Recursive legacy keys:', foundViaRecursive.legacy ? Object.keys(foundViaRecursive.legacy) : 'NO legacy');
              console.log('[xtractr-bg] Recursive core keys:', foundViaRecursive.core ? Object.keys(foundViaRecursive.core) : 'NO core');
            }
            console.log('[xtractr-bg] === END MODULE ITEM DUMP ===');
          } catch (e) {
            console.warn('[xtractr-bg] Module item dump error:', e.message);
          }
        }
        for (const item of items) {
          const user = extractUserFromEntry(item) || extractUserFromEntry(item?.item);
          if (user) users.push(user);
        }
      }
    }
  }

  console.log(`[xtractr-bg] Parsed ${users.length} users, cursor: ${cursor ? 'yes' : 'null'}`);
  if (users.length > 0) {
    console.log('[xtractr-bg] Sample user:', JSON.stringify(users[0]));
  }
  return { users, cursor };
}

// Dump full structure of first entry so we can see where Twitter puts user fields
function dumpEntryStructure(entry) {
  try {
    console.log('[xtractr-bg] === FIRST ENTRY STRUCTURE DUMP ===');
    console.log('[xtractr-bg] entry keys:', Object.keys(entry));
    const content = entry.content;
    if (content) {
      console.log('[xtractr-bg] entry.content keys:', Object.keys(content));
      const ic = content.itemContent;
      if (ic) {
        console.log('[xtractr-bg] entry.content.itemContent keys:', Object.keys(ic));
        const ur = ic.user_results;
        if (ur) {
          console.log('[xtractr-bg] user_results keys:', Object.keys(ur));
          const result = ur.result;
          if (result) {
            console.log('[xtractr-bg] user_results.result keys:', Object.keys(result));
            console.log('[xtractr-bg] result.__typename:', result.__typename);
            console.log('[xtractr-bg] result.rest_id:', result.rest_id);
            // Check legacy
            if (result.legacy) {
              console.log('[xtractr-bg] result.legacy keys:', Object.keys(result.legacy));
              console.log('[xtractr-bg] result.legacy.screen_name:', result.legacy.screen_name);
              console.log('[xtractr-bg] result.legacy.name:', result.legacy.name);
            } else {
              console.log('[xtractr-bg] result.legacy: MISSING');
            }
            // Check core
            if (result.core) {
              console.log('[xtractr-bg] result.core keys:', Object.keys(result.core));
              const coreUR = result.core.user_results || result.core.user_result;
              if (coreUR) {
                console.log('[xtractr-bg] core.user_result(s) keys:', Object.keys(coreUR));
                const coreResult = coreUR.result;
                if (coreResult) {
                  console.log('[xtractr-bg] core...result keys:', Object.keys(coreResult));
                  if (coreResult.legacy) {
                    console.log('[xtractr-bg] core...result.legacy keys:', Object.keys(coreResult.legacy));
                    console.log('[xtractr-bg] core...legacy.screen_name:', coreResult.legacy.screen_name);
                    console.log('[xtractr-bg] core...legacy.name:', coreResult.legacy.name);
                  }
                }
              }
            }
            // Check direct fields
            console.log('[xtractr-bg] result.screen_name:', result.screen_name);
            console.log('[xtractr-bg] result.name:', result.name);
            // Also try to find screen_name anywhere
            const snPath = findFieldPath(result, 'screen_name', '', 0);
            console.log('[xtractr-bg] screen_name found at:', snPath || 'NOT FOUND');
            const namePath = findFieldPath(result, 'name', '', 0);
            console.log('[xtractr-bg] name found at:', namePath || 'NOT FOUND');
            const locPath = findFieldPath(result, 'location', '', 0);
            console.log('[xtractr-bg] location found at:', locPath || 'NOT FOUND');
          }
        }
      }
    }
    console.log('[xtractr-bg] === END DUMP ===');
  } catch (e) {
    console.warn('[xtractr-bg] Dump error:', e.message);
  }
}

// Recursively find where a field name exists in an object, return the path
function findFieldPath(obj, fieldName, path, depth) {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 3); i++) {
      const found = findFieldPath(obj[i], fieldName, `${path}[${i}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === fieldName && value !== undefined && value !== null && value !== '') {
      return `${path}.${key} = ${JSON.stringify(value).slice(0, 80)}`;
    }
    if (typeof value === 'object' && value !== null) {
      const found = findFieldPath(value, fieldName, `${path}.${key}`, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractEntries(json) {
  try {
    const timeline = json?.data?.user?.result?.timeline?.timeline || json?.data?.user?.result?.timeline;
    if (timeline?.instructions) {
      for (const instruction of timeline.instructions) {
        if (instruction.entries?.length > 0) {
          console.log(`[xtractr-bg] Found entries via known path, count: ${instruction.entries.length}`);
          return instruction.entries;
        }
        if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
          console.log(`[xtractr-bg] Found entries via TimelineAddEntries, count: ${instruction.entries.length}`);
          return instruction.entries;
        }
      }
      console.warn('[xtractr-bg] Instructions found but no entries. Types:',
        timeline.instructions.map(i => i.type));
    } else {
      console.warn('[xtractr-bg] No timeline.instructions found. Top keys:', Object.keys(json || {}));
      if (json?.data) console.warn('[xtractr-bg] data keys:', Object.keys(json.data));
    }
  } catch (e) {
    console.warn('[xtractr-bg] extractEntries error:', e.message);
  }
  console.log('[xtractr-bg] Falling back to recursive entry search...');
  const found = findEntriesRecursive(json);
  if (found) {
    console.log(`[xtractr-bg] Recursive search found ${found.length} entries`);
  } else {
    console.warn('[xtractr-bg] Recursive search found nothing');
  }
  return found;
}

function findEntriesRecursive(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.some(item => item && typeof item === 'object' && 'entryId' in item)) return obj;
  }
  for (const value of Object.values(obj)) {
    const found = findEntriesRecursive(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractUserFromEntry(entry) {
  const userResult = findUserResult(entry);
  if (!userResult) return null;

  const restId = userResult.rest_id || userResult.id;
  if (!restId) return null;

  // Collect ALL objects that might contain user fields.
  // Twitter restructures frequently - fields could be in legacy, core, or directly on the result.
  const sources = collectDataSources(userResult);

  // Search all sources for each field we need
  const findField = (name) => {
    for (const src of sources) {
      if (src[name] !== undefined && src[name] !== null && src[name] !== '') {
        return src[name];
      }
    }
    return undefined;
  };

  const username = findField('screen_name') || '';
  const displayName = findField('name') || '';
  const bio = findField('description') || findField('profile_bio') || '';
  const followersCount = findField('followers_count') ?? findField('normal_followers_count') ?? 0;
  const followingCount = findField('friends_count') ?? 0;
  const verified = userResult.is_blue_verified || findField('verified') || false;
  const joinDate = findField('created_at') || '';
  // location can be a string OR an object {location: "..."} in newer API
  let locationRaw = findField('location') || '';
  const location = (typeof locationRaw === 'object' && locationRaw !== null) ? (locationRaw.location || '') : locationRaw;
  const profileImageUrl = findField('profile_image_url_https') || '';
  // avatar field in newer API
  const avatarUrl = profileImageUrl || (userResult.avatar?.image_url) || '';

  return {
    userId: restId,
    username,
    displayName,
    bio: bio.replace(/\n/g, ' '),
    followersCount: typeof followersCount === 'number' ? followersCount : 0,
    followingCount: typeof followingCount === 'number' ? followingCount : 0,
    verified,
    joinDate,
    location,
    profileUrl: username ? `https://x.com/${username}` : '',
    profileImageUrl: avatarUrl,
  };
}

// Collect all objects within a userResult that might contain user profile fields.
// Twitter's API structure changes frequently - we search multiple known locations.
function collectDataSources(userResult) {
  const sources = [];

  // Direct on userResult
  sources.push(userResult);

  // core as flat object (current format: core has screen_name, name, created_at directly)
  if (userResult.core && typeof userResult.core === 'object') {
    sources.push(userResult.core);
  }

  // userResult.legacy
  if (userResult.legacy && typeof userResult.legacy === 'object') {
    sources.push(userResult.legacy);
  }

  // Older core paths: core.user_results.result / core.user_result.result
  const corePaths = [
    userResult.core?.user_results?.result,
    userResult.core?.user_result?.result,
  ];

  for (const coreResult of corePaths) {
    if (coreResult && typeof coreResult === 'object') {
      sources.push(coreResult);
      if (coreResult.legacy && typeof coreResult.legacy === 'object') {
        sources.push(coreResult.legacy);
      }
    }
  }

  return sources;
}

function findUserResult(entry) {
  try {
    const result = entry?.content?.itemContent?.user_results?.result ||
      entry?.content?.entryContent?.user_results?.result ||
      entry?.item?.itemContent?.user_results?.result ||
      entry?.itemContent?.user_results?.result;  // module item (no content/item wrapper)
    if (result) {
      if (result.__typename === 'UserUnavailable') return null;
      return result;
    }
  } catch { /* fallback */ }
  return findUserResultRecursive(entry);
}

function findUserResultRecursive(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findUserResultRecursive(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  // Accept user result if it has rest_id and either legacy or core with user data
  if (obj.rest_id && (obj.legacy || obj.core)) return obj;
  for (const value of Object.values(obj)) {
    const found = findUserResultRecursive(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractCursorValue(entry) {
  try {
    return entry?.content?.value || entry?.content?.itemContent?.value || entry?.content?.entryContent?.value || null;
  } catch { return null; }
}

// ---- Stemming ----

// Lightweight English stemmer - strips common suffixes to normalize words.
// Handles: -ing, -tion, -sion, -ment, -ness, -ity, -ous, -ive, -able, -ible,
//          -er, -or, -ist, -ed, -ly, -al, -ful, -less, -es, -s
function stem(word) {
  if (word.length < 4) return word;
  // Order matters: strip longer suffixes first
  const suffixes = [
    'ization', 'isation', 'ational', 'fulness', 'iveness', 'ousness',
    'ation', 'tion', 'sion', 'ment', 'ness', 'ance', 'ence', 'able',
    'ible', 'ling', 'ally', 'ical', 'ious', 'eous', 'ous',
    'ing', 'ive', 'ist', 'ity', 'ful', 'ess',
    'ed', 'er', 'or', 'ly', 'al', 'es',
    's',
  ];
  for (const suffix of suffixes) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

// Tokenize text into lowercase stemmed words
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9#+.\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);
}

function stemmedTokens(text) {
  return tokenize(text).map(stem);
}

// ---- Scoring Engine ----

// Score a single user against a set of keywords.
// Returns { score, matches } where score is 0-100 and matches lists which keywords hit.
function scoreUser(user, keywords) {
  if (!keywords || keywords.length === 0) return { score: 100, matches: [] };

  const bioText = user.bio || '';
  const nameText = user.displayName || '';
  const handleText = user.username || '';
  const fullText = `${bioText} ${nameText} ${handleText}`.toLowerCase();

  // Pre-compute stemmed token sets for each field (bio weighted heavier)
  const bioTokens = stemmedTokens(bioText);
  const nameTokens = stemmedTokens(nameText);
  const handleTokens = stemmedTokens(handleText);
  const allStemmed = [...bioTokens, ...nameTokens, ...handleTokens];

  let totalScore = 0;
  const matches = [];

  for (const keyword of keywords) {
    const kw = keyword.toLowerCase().trim();
    if (!kw) continue;

    let kwScore = 0;
    let matchType = null;

    // 1. Exact substring match in full text (strongest signal)
    if (fullText.includes(kw)) {
      // Bio match is worth more than name/handle
      if (bioText.toLowerCase().includes(kw)) {
        kwScore = 3;
        matchType = 'bio-exact';
      } else if (nameText.toLowerCase().includes(kw)) {
        kwScore = 2.5;
        matchType = 'name-exact';
      } else {
        kwScore = 2;
        matchType = 'handle-exact';
      }
    } else {
      // 2. Stemmed match - "engineering" matches "engineer"
      const kwStemmed = stem(kw);
      const kwTokens = kw.includes(' ') ? kw.split(/\s+/).map(stem) : [kwStemmed];

      // For multi-word keywords, check if all stemmed parts appear
      const allPartsFound = kwTokens.every(part =>
        allStemmed.some(token => token === part || token.startsWith(part) || part.startsWith(token))
      );

      if (allPartsFound) {
        if (bioTokens.some(t => kwTokens.some(p => t === p || t.startsWith(p) || p.startsWith(t)))) {
          kwScore = 2;
          matchType = 'bio-stem';
        } else {
          kwScore = 1.5;
          matchType = 'name-stem';
        }
      } else {
        // 3. Fuzzy: check if any token is close to the keyword (edit distance or prefix)
        const fuzzyMatch = allStemmed.some(token => {
          if (token.length < 3 || kwStemmed.length < 3) return false;
          // Prefix match (one starts with the other, min 3 chars overlap)
          if (token.startsWith(kwStemmed.slice(0, 3)) || kwStemmed.startsWith(token.slice(0, 3))) {
            const overlap = commonPrefixLen(token, kwStemmed);
            return overlap >= Math.min(token.length, kwStemmed.length) * 0.6;
          }
          return false;
        });

        if (fuzzyMatch) {
          kwScore = 0.75;
          matchType = 'fuzzy';
        }
      }
    }

    if (kwScore > 0) {
      totalScore += kwScore;
      matches.push({ keyword: kw, type: matchType, weight: kwScore });
    }
  }

  // Normalize: max possible = 3 * number of keywords. Scale to 0-100.
  const maxPossible = keywords.length * 3;
  const normalized = Math.round((totalScore / maxPossible) * 100);

  return { score: Math.min(100, normalized), matches };
}

function commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// ---- Filtering ----

// Apply filters and return scored, sorted results.
// Returns array of { ...user, _score, _matches } sorted by score descending.
function applyFilters(users, filters) {
  if (!filters) return users.map(u => ({ ...u, _score: 100, _matches: [] }));

  const threshold = filters.minScore ?? 1; // minimum score to include (default: any match)

  const scored = [];

  for (const user of users) {
    // Hard filters first (cheap, eliminates early)
    if (filters.minFollowers != null && user.followersCount < filters.minFollowers) continue;
    if (filters.maxFollowers != null && user.followersCount > filters.maxFollowers) continue;
    if (filters.verifiedOnly && !user.verified) continue;
    if (filters.hasBio && (!user.bio || user.bio.trim() === '')) continue;

    // Keyword scoring
    const { score, matches } = scoreUser(user, filters.keywords);

    // If keywords were provided, require minimum score
    if (filters.keywords && filters.keywords.length > 0 && score < threshold) continue;

    scored.push({ ...user, _score: score, _matches: matches });
  }

  // Sort by score descending, then by follower count as tiebreaker
  scored.sort((a, b) => b._score - a._score || b.followersCount - a.followersCount);

  return scored;
}

// ---- Badge update ----

function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
}

// ---- Message handling ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[xtractr-bg] Message handler error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'XPRTR_DATA_CAPTURED': {
      const { listType, data, url } = message.payload;
      console.log(`[xtractr-bg] DATA_CAPTURED: ${listType}, url: ${url?.slice(0, 80)}, data keys:`, Object.keys(data || {}));

      // Parse the GraphQL response - extract users AND cursor
      const { users: rawUsers, cursor } = parseGraphQLResponse(data);
      console.log(`[xtractr-bg] Parsed: ${rawUsers.length} users, cursor: ${cursor ? cursor.slice(0, 20) + '...' : 'null'}`);
      if (!rawUsers.length) {
        // Return the actual session count, not 0
        const existingSession = await store.getSession();
        return { count: existingSession?.users?.length || 0, added: 0, cursor };
      }

      const users = deduplicateUsers(rawUsers);

      // Detect username from URL
      const urlMatch = url?.match(/\/(x|twitter)\.com\/([^/]+)\//);
      const username = urlMatch ? urlMatch[2] : 'unknown';
      console.log(`[xtractr-bg] Username: ${username}, deduped: ${users.length}`);

      // Ensure session exists
      await ensureSession(username, listType);

      // Add users to session
      const result = await store.addUsersToSession(users);
      if (result) {
        updateBadge(result.count);
        broadcastUpdate(result.count);
      }

      // Return cursor so the content script can paginate
      return { count: result?.count || 0, added: result?.added || 0, cursor };
    }

    case 'XPRTR_PAGE_CHANGED': {
      const { username, type } = message.payload;
      const session = await ensureSession(username, type);
      const count = session.users?.length || 0;
      updateBadge(count);
      return { count };
    }

    case 'XPRTR_GET_SESSION': {
      const session = await store.getSession();
      return session ? {
        active: true,
        username: session.username,
        type: session.type,
        count: session.users.length,
        startedAt: session.startedAt,
      } : { active: false };
    }

    case 'XPRTR_GET_STATUS': {
      return getStatus();
    }

    case 'XPRTR_EXPORT_CSV': {
      const session = await store.getSession();
      if (!session || !session.users.length) return { error: 'No data to export' };
      await exportCSV(session.users, session.username, session.type);
      return { ok: true };
    }

    case 'XPRTR_EXPORT_JSON': {
      const session = await store.getSession();
      if (!session || !session.users.length) return { error: 'No data to export' };
      await exportJSON(session.users, session.username, session.type);
      return { ok: true };
    }

    case 'XPRTR_CLEAR_SESSION': {
      await completeSession();
      updateBadge(0);
      return { ok: true };
    }

    case 'XPRTR_GET_HISTORY': {
      return { history: await store.getHistory() };
    }

    case 'XPRTR_GET_SAVED_LISTS': {
      return { lists: await store.getSavedLists() };
    }

    case 'XPRTR_SAVE_LIST': {
      const session = await store.getSession();
      if (!session) return { error: 'No active session' };
      const key = `${session.username}_${session.type}_${session.id}`;
      await store.saveList(key, session.users, {
        username: session.username,
        type: session.type,
        count: session.users.length,
      });
      return { ok: true, key };
    }

    case 'XPRTR_DELETE_SAVED_LIST': {
      await store.deleteSavedList(message.payload.key);
      return { ok: true };
    }

    case 'XPRTR_COMPARE_LISTS': {
      const { followersKey, followingKey } = message.payload;
      const lists = await store.getSavedLists();
      const followers = lists[followersKey]?.users || [];
      const following = lists[followingKey]?.users || [];
      return compareLists(followers, following);
    }

    case 'XPRTR_SEARCH_USERS': {
      const session = await store.getSession();
      if (!session) return { users: [] };
      const query = (message.payload.query || '').toLowerCase();
      const filtered = session.users.filter(u =>
        u.username.toLowerCase().includes(query) ||
        u.displayName.toLowerCase().includes(query) ||
        (u.bio && u.bio.toLowerCase().includes(query))
      );
      return { users: filtered, total: session.users.length };
    }

    case 'XPRTR_FILTER_USERS': {
      const session = await store.getSession();
      if (!session) return { users: [], total: 0, scores: {} };
      const filtered = applyFilters(session.users, message.payload);
      // Build a score distribution summary for the UI
      const scoreBuckets = { high: 0, medium: 0, low: 0 };
      for (const u of filtered) {
        if (u._score >= 50) scoreBuckets.high++;
        else if (u._score >= 20) scoreBuckets.medium++;
        else scoreBuckets.low++;
      }
      return {
        users: filtered,
        total: session.users.length,
        scoreBuckets,
        topMatches: filtered.slice(0, 5).map(u => ({
          username: u.username,
          displayName: u.displayName,
          score: u._score,
          matchCount: u._matches?.length || 0,
          topKeywords: (u._matches || []).slice(0, 3).map(m => m.keyword),
        })),
      };
    }

    case 'XPRTR_EXPORT_FILTERED_CSV': {
      const session = await store.getSession();
      if (!session) return { error: 'No data' };
      const users = applyFilters(session.users, message.payload);
      if (!users.length) return { error: 'No users match filters' };
      await exportCSV(users, session.username, `${session.type}_filtered`);
      return { ok: true };
    }

    case 'XPRTR_EXPORT_FILTERED_JSON': {
      const session = await store.getSession();
      if (!session) return { error: 'No data' };
      const users = applyFilters(session.users, message.payload);
      if (!users.length) return { error: 'No users match filters' };
      await exportJSON(users, session.username, `${session.type}_filtered`);
      return { ok: true };
    }

    case 'XPRTR_SET_FOLLOW_QUEUE': {
      const queue = {
        users: message.payload.users,
        currentIndex: 0,
        followed: [],
        skipped: [],
        createdAt: new Date().toISOString(),
        source: message.payload.source || '',
      };
      await store.setFollowQueue(queue);
      return { ok: true, total: queue.users.length };
    }

    case 'XPRTR_GET_FOLLOW_QUEUE': {
      const queue = await store.getFollowQueue();
      return { queue };
    }

    case 'XPRTR_UPDATE_FOLLOW_QUEUE': {
      const queue = await store.getFollowQueue();
      if (!queue) return { error: 'No queue' };
      const { action, userId } = message.payload;
      if (action === 'follow') {
        queue.followed.push(userId);
      } else if (action === 'skip') {
        queue.skipped.push(userId);
      }
      queue.currentIndex = Math.min(queue.currentIndex + 1, queue.users.length);
      await store.setFollowQueue(queue);
      return { queue };
    }

    case 'XPRTR_GET_SETTINGS': {
      return { settings: await store.getSettings() };
    }

    case 'XPRTR_UPDATE_SETTINGS': {
      const settings = await store.updateSettings(message.payload);
      return { settings };
    }

    case 'XPRTR_AUTOSCROLL_STATUS': {
      // Just log/track autoscroll status from content script
      return { ok: true };
    }

    case 'XPRTR_START_AUTOSCROLL':
    case 'XPRTR_STOP_AUTOSCROLL': {
      // Forward to active tab's content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        return new Promise(resolve => {
          chrome.tabs.sendMessage(tab.id, message, resolve);
        });
      }
      return { error: 'No active tab' };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

function broadcastUpdate(count) {
  chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'XPRTR_SESSION_UPDATE',
        payload: { count },
      }).catch(() => { /* tab may not have content script */ });
    }
  });
}

// Clear badge on startup
updateBadge(0);
