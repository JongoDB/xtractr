/**
 * List comparison logic - find mutual follows, non-followers, etc.
 */

/**
 * Compare followers and following lists.
 * @param {object[]} followers - Users who follow the target
 * @param {object[]} following - Users the target follows
 * @returns {{ mutuals, notFollowingBack, notFollowedBack }}
 */
export function compareLists(followers, following) {
  const followerIds = new Set(followers.map(u => u.userId));
  const followingIds = new Set(following.map(u => u.userId));

  const followerMap = Object.fromEntries(followers.map(u => [u.userId, u]));
  const followingMap = Object.fromEntries(following.map(u => [u.userId, u]));

  // Mutuals: in both lists
  const mutuals = following.filter(u => followerIds.has(u.userId));

  // Not following back: you follow them, but they don't follow you
  const notFollowingBack = following.filter(u => !followerIds.has(u.userId));

  // Not followed back: they follow you, but you don't follow them
  const notFollowedBack = followers.filter(u => !followingIds.has(u.userId));

  return {
    mutuals,
    notFollowingBack,
    notFollowedBack,
    stats: {
      totalFollowers: followers.length,
      totalFollowing: following.length,
      mutualCount: mutuals.length,
      notFollowingBackCount: notFollowingBack.length,
      notFollowedBackCount: notFollowedBack.length,
    },
  };
}
