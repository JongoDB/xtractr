/**
 * Parses Twitter/X GraphQL responses to extract user data.
 *
 * Twitter's GraphQL responses nest user data in:
 * data.user.result.timeline.timeline.instructions[].entries[]
 *
 * Each user entry has entryId starting with "user-" and contains
 * user_results.result with profile fields in legacy and/or core.
 *
 * Cursor entries have entryId starting with "cursor-bottom-".
 */

/**
 * Extract user entries and cursor from a GraphQL response.
 * @param {object} json - Parsed JSON response
 * @returns {{ users: object[], cursor: string|null }}
 */
export function parseGraphQLResponse(json) {
  const entries = extractEntries(json);

  const users = [];
  let cursor = null;

  for (const entry of (entries || [])) {
    const entryId = entry.entryId || '';

    if (entryId.startsWith('user-')) {
      // Individual user entry (old format)
      const user = extractUserFromEntry(entry);
      if (user) users.push(user);
    } else if (entryId.startsWith('cursor-bottom-') || entryId.startsWith('cursor-bottom|')) {
      cursor = extractCursorValue(entry);
    } else {
      // Module entry (TimelineTimelineModule) containing nested user items
      const items = entry?.content?.items;
      if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          const user = extractUserFromEntry(item) || extractUserFromEntry(item?.item);
          if (user) users.push(user);
        }
      }
    }
  }

  // Process TimelineAddToModule and TimelineReplaceEntry instructions
  // (used in module-based pagination, e.g. followers endpoint).
  try {
    const timeline =
      json?.data?.user?.result?.timeline?.timeline ||
      json?.data?.user?.result?.timeline;

    if (timeline?.instructions) {
      for (const instruction of timeline.instructions) {
        if (instruction.type === 'TimelineAddToModule' && Array.isArray(instruction.moduleItems)) {
          for (const item of instruction.moduleItems) {
            const user = extractUserFromEntry(item) || extractUserFromEntry(item?.item);
            if (user) users.push(user);
          }
        }
        // Cursor updates in module-based pagination arrive via TimelineReplaceEntry
        if (!cursor && instruction.type === 'TimelineReplaceEntry' && instruction.entry) {
          const eid = instruction.entry.entryId || '';
          if (eid.startsWith('cursor-bottom-') || eid.startsWith('cursor-bottom|')) {
            cursor = extractCursorValue(instruction.entry);
          }
        }
        // Fallback cursor extraction from any instruction's entries
        if (!cursor && Array.isArray(instruction.entries)) {
          for (const entry of instruction.entries) {
            const eid = entry.entryId || '';
            if (eid.startsWith('cursor-bottom-') || eid.startsWith('cursor-bottom|')) {
              cursor = extractCursorValue(entry);
            }
          }
        }
      }
    }
  } catch { /* fall through */ }

  return { users, cursor };
}

/**
 * Navigate the response JSON to find the entries array.
 * Tries the known path first, then falls back to recursive search.
 */
function extractEntries(json) {
  try {
    const timeline =
      json?.data?.user?.result?.timeline?.timeline ||
      json?.data?.user?.result?.timeline;

    if (timeline?.instructions) {
      for (const instruction of timeline.instructions) {
        if (instruction.entries && instruction.entries.length > 0) {
          return instruction.entries;
        }
        if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
          return instruction.entries;
        }
      }
    }
  } catch { /* fall through to recursive search */ }

  return findEntriesRecursive(json);
}

function findEntriesRecursive(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    const hasEntryIds = obj.some(
      item => item && typeof item === 'object' && 'entryId' in item
    );
    if (hasEntryIds) return obj;
  }

  for (const value of Object.values(obj)) {
    const found = findEntriesRecursive(value, depth + 1);
    if (found) return found;
  }

  return null;
}

/**
 * Extract a normalized user object from a timeline entry.
 */
function extractUserFromEntry(entry) {
  const userResult = findUserResult(entry);
  if (!userResult) return null;

  const restId = userResult.rest_id || userResult.id;
  if (!restId) return null;

  // Collect ALL objects that might contain user fields.
  const sources = collectDataSources(userResult);

  const findField = (name) => {
    for (const src of sources) {
      if (src[name] !== undefined && src[name] !== null && src[name] !== '') {
        return src[name];
      }
    }
    return undefined;
  };

  const username = findField('screen_name') || '';
  const bio = findField('description') || findField('profile_bio') || '';
  // location can be a string OR an object {location: "..."} in newer API
  let locationRaw = findField('location') || '';
  const location = (typeof locationRaw === 'object' && locationRaw !== null) ? (locationRaw.location || '') : locationRaw;
  const profileImageUrl = findField('profile_image_url_https') || (userResult.avatar?.image_url) || '';

  return {
    userId: restId,
    username,
    displayName: findField('name') || '',
    bio: bio.replace(/\n/g, ' '),
    followersCount: findField('followers_count') ?? findField('normal_followers_count') ?? 0,
    followingCount: findField('friends_count') ?? 0,
    verified: userResult.is_blue_verified || findField('verified') || false,
    joinDate: findField('created_at') || '',
    location,
    profileUrl: username ? `https://x.com/${username}` : '',
    profileImageUrl,
  };
}

/**
 * Find the user_results.result object within an entry.
 */
function findUserResult(entry) {
  try {
    const result =
      entry?.content?.itemContent?.user_results?.result ||
      entry?.content?.entryContent?.user_results?.result ||
      entry?.item?.itemContent?.user_results?.result ||
      entry?.itemContent?.user_results?.result;  // module item (no content/item wrapper)

    if (result) {
      if (result.__typename === 'UserUnavailable') return null;
      return result;
    }
  } catch { /* fall through */ }

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

  if (obj.rest_id && (obj.legacy || obj.core)) {
    return obj;
  }

  for (const value of Object.values(obj)) {
    const found = findUserResultRecursive(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Collect all objects within a userResult that might contain user profile fields.
 * Twitter's API structure changes frequently - we search multiple known locations.
 */
function collectDataSources(userResult) {
  const sources = [];

  sources.push(userResult);

  // core as flat object (current format: core has screen_name, name, created_at directly)
  if (userResult.core && typeof userResult.core === 'object') {
    sources.push(userResult.core);
  }

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

/**
 * Extract cursor value from a cursor entry.
 */
function extractCursorValue(entry) {
  try {
    return (
      entry?.content?.value ||
      entry?.content?.itemContent?.value ||
      entry?.content?.entryContent?.value ||
      null
    );
  } catch {
    return null;
  }
}
