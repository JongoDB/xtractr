/**
 * Deduplication logic for user entries by rest_id (userId).
 * This is used as an extra safety layer - data-store also deduplicates.
 */

/**
 * Deduplicate an array of user objects by userId.
 * @param {object[]} users - Array of normalized user objects
 * @returns {object[]} Deduplicated array (preserves first occurrence)
 */
export function deduplicateUsers(users) {
  const seen = new Set();
  const result = [];

  for (const user of users) {
    if (user.userId && !seen.has(user.userId)) {
      seen.add(user.userId);
      result.push(user);
    }
  }

  return result;
}

/**
 * Merge new users into existing array, returning only the truly new ones.
 * @param {object[]} existing - Already collected users
 * @param {object[]} incoming - New batch of users
 * @returns {object[]} Only the users not already in existing
 */
export function findNewUsers(existing, incoming) {
  const existingIds = new Set(existing.map(u => u.userId));
  return incoming.filter(u => u.userId && !existingIds.has(u.userId));
}
