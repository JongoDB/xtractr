/**
 * Test helpers for xtractr Chrome extension tests.
 */

// Mock user data for seeding sessions
export const MOCK_USERS = Array.from({ length: 10 }, (_, i) => ({
  userId: `${1000 + i}`,
  username: `user${i}`,
  displayName: `User ${i}`,
  bio: i % 2 === 0 ? 'Software engineer working on cloud infrastructure' : 'Designer and UX researcher',
  followersCount: 100 + i * 50,
  followingCount: 200 + i * 10,
  verified: i < 3,
  joinDate: 'Mon Jan 01 00:00:00 +0000 2020',
  location: i % 3 === 0 ? 'San Francisco, CA' : '',
  profileUrl: `https://x.com/user${i}`,
  profileImageUrl: '',
}));

// A second set of users for comparison tests (some overlap with MOCK_USERS)
export const MOCK_FOLLOWERS = [
  ...MOCK_USERS.slice(0, 5), // user0-user4 are mutual
  ...Array.from({ length: 5 }, (_, i) => ({
    userId: `${2000 + i}`,
    username: `follower${i}`,
    displayName: `Follower ${i}`,
    bio: 'Follows you',
    followersCount: 50,
    followingCount: 100,
    verified: false,
    joinDate: 'Tue Jun 01 00:00:00 +0000 2021',
    location: '',
    profileUrl: `https://x.com/follower${i}`,
    profileImageUrl: '',
  })),
];

/**
 * Get the extension ID by finding the service worker target.
 */
export async function getExtensionId(context) {
  let swTarget = context.serviceWorkers().find(w =>
    w.url().includes('service-worker')
  );

  if (!swTarget) {
    // Wait for the service worker to register
    swTarget = await context.waitForEvent('serviceworker', {
      predicate: w => w.url().includes('service-worker'),
      timeout: 10000,
    });
  }

  const url = swTarget.url();
  const match = url.match(/chrome-extension:\/\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Seed chrome.storage.local with data via the service worker.
 */
export async function seedStorage(context, extensionId, data) {
  const sw = context.serviceWorkers().find(w =>
    w.url().includes(extensionId)
  );
  if (!sw) throw new Error('Service worker not found');

  await sw.evaluate((storageData) => {
    return chrome.storage.local.set(storageData);
  }, data);
}

/**
 * Read chrome.storage.local via the service worker.
 */
export async function readStorage(context, extensionId, keys) {
  const sw = context.serviceWorkers().find(w =>
    w.url().includes(extensionId)
  );
  if (!sw) throw new Error('Service worker not found');

  return sw.evaluate((k) => {
    return chrome.storage.local.get(k);
  }, keys);
}

/**
 * Clear chrome.storage.local via the service worker.
 */
export async function clearStorage(context, extensionId) {
  const sw = context.serviceWorkers().find(w =>
    w.url().includes(extensionId)
  );
  if (!sw) throw new Error('Service worker not found');

  await sw.evaluate(() => chrome.storage.local.clear());
}

/**
 * Build a mock session object.
 */
export function buildSession(username, type, users) {
  const userIds = {};
  for (const u of users) userIds[u.userId] = true;
  return {
    id: `test-${Date.now()}`,
    username,
    type,
    users,
    userIds,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
}
