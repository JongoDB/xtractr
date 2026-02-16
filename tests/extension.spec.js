import { test, expect, chromium } from '@playwright/test';
import {
  MOCK_USERS, MOCK_FOLLOWERS,
  getExtensionId, seedStorage, readStorage, clearStorage, buildSession,
} from './helpers.js';

let context;
let extensionId;

test.beforeAll(async () => {
  const pathToExtension = process.cwd();
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
      '--no-sandbox',
    ],
  });
  extensionId = await getExtensionId(context);
  console.log('Extension ID:', extensionId);
});

test.afterAll(async () => {
  await context?.close();
});

test.beforeEach(async () => {
  await clearStorage(context, extensionId);
});

// ===========================================================================
// SAVE LIST
// ===========================================================================

test.describe('Save List', () => {
  test('saving a session persists it to savedLists storage', async () => {
    // Seed a session with mock users
    const session = buildSession('testuser', 'following', MOCK_USERS);
    await seedStorage(context, extensionId, { currentSession: session });

    // Open the popup
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');

    // Wait for session to load (active section visible)
    await expect(popup.locator('#active')).toBeVisible({ timeout: 5000 });
    await expect(popup.locator('#count')).toHaveText('10');
    await expect(popup.locator('#username')).toHaveText('@testuser');
    await expect(popup.locator('#listType')).toHaveText('following');

    // Click Save List
    await popup.click('#saveBtn');
    await popup.waitForTimeout(500);

    // Verify savedLists in storage
    const storage = await readStorage(context, extensionId, 'savedLists');
    const lists = storage.savedLists || {};
    const keys = Object.keys(lists);
    expect(keys.length).toBe(1);

    const savedList = lists[keys[0]];
    expect(savedList.users.length).toBe(10);
    expect(savedList.meta.username).toBe('testuser');
    expect(savedList.meta.type).toBe('following');
    expect(savedList.savedAt).toBeTruthy();

    await popup.close();
  });

  test('saving multiple sessions creates multiple saved lists', async () => {
    // Save first list
    const session1 = buildSession('alice', 'followers', MOCK_FOLLOWERS);
    await seedStorage(context, extensionId, { currentSession: session1 });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.locator('#active')).toBeVisible({ timeout: 5000 });
    await popup.click('#saveBtn');
    await popup.waitForTimeout(500);

    // Change session and save second list
    const session2 = buildSession('alice', 'following', MOCK_USERS);
    await seedStorage(context, extensionId, { currentSession: session2 });
    await popup.reload();
    await expect(popup.locator('#active')).toBeVisible({ timeout: 5000 });
    await popup.click('#saveBtn');
    await popup.waitForTimeout(500);

    // Verify both lists saved
    const storage = await readStorage(context, extensionId, 'savedLists');
    const keys = Object.keys(storage.savedLists || {});
    expect(keys.length).toBe(2);

    await popup.close();
  });
});

// ===========================================================================
// FOLLOW QUEUE
// ===========================================================================

test.describe('Follow Queue', () => {
  test('queue page shows empty state when no queue exists', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#queueActive')).not.toBeVisible();

    await page.close();
  });

  test('queue page renders users when queue is seeded', async () => {
    // Seed a follow queue
    const queue = {
      users: MOCK_USERS.slice(0, 3),
      currentIndex: 0,
      followed: [],
      skipped: [],
      createdAt: new Date().toISOString(),
      source: 'test',
    };
    await seedStorage(context, extensionId, { followQueue: queue });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#queueActive')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#emptyState')).not.toBeVisible();

    // First user should be displayed
    await expect(page.locator('#displayName')).toHaveText('User 0');
    await expect(page.locator('#handle')).toHaveText('@user0');
    await expect(page.locator('#progressText')).toHaveText('0 / 3');
    await expect(page.locator('#remainingCount')).toHaveText('3');

    await page.close();
  });

  test('skip button advances to next user', async () => {
    const queue = {
      users: MOCK_USERS.slice(0, 3),
      currentIndex: 0,
      followed: [],
      skipped: [],
      createdAt: new Date().toISOString(),
      source: 'test',
    };
    await seedStorage(context, extensionId, { followQueue: queue });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#queueActive')).toBeVisible({ timeout: 5000 });

    // Skip first user
    await page.click('#skipBtn');
    await page.waitForTimeout(300);

    // Should now show second user
    await expect(page.locator('#displayName')).toHaveText('User 1');
    await expect(page.locator('#handle')).toHaveText('@user1');
    await expect(page.locator('#progressText')).toHaveText('1 / 3');
    await expect(page.locator('#skippedCount')).toHaveText('1');
    await expect(page.locator('#remainingCount')).toHaveText('2');

    await page.close();
  });

  test('follow button opens profile and advances', async () => {
    const queue = {
      users: MOCK_USERS.slice(0, 2),
      currentIndex: 0,
      followed: [],
      skipped: [],
      createdAt: new Date().toISOString(),
      source: 'test',
    };
    await seedStorage(context, extensionId, { followQueue: queue });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#queueActive')).toBeVisible({ timeout: 5000 });

    // Click follow - should open a new tab and advance
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      page.click('#followBtn'),
    ]);

    // New tab should open to user's profile
    expect(newPage.url()).toContain('x.com/user0');
    await newPage.close();

    // Queue should have advanced
    await expect(page.locator('#displayName')).toHaveText('User 1');
    await expect(page.locator('#followedCount')).toHaveText('1');

    await page.close();
  });

  test('shows done state after processing all users', async () => {
    const queue = {
      users: MOCK_USERS.slice(0, 2),
      currentIndex: 0,
      followed: [],
      skipped: [],
      createdAt: new Date().toISOString(),
      source: 'test',
    };
    await seedStorage(context, extensionId, { followQueue: queue });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#queueActive')).toBeVisible({ timeout: 5000 });

    // Skip both users
    await page.click('#skipBtn');
    await page.waitForTimeout(300);
    await page.click('#skipBtn');
    await page.waitForTimeout(300);

    // Should show done state
    await expect(page.locator('#doneState')).toBeVisible();
    await expect(page.locator('#doneSummary')).toContainText('Followed 0');
    await expect(page.locator('#doneSummary')).toContainText('skipped 2');

    await page.close();
  });

  test('clear queue returns to empty state', async () => {
    const queue = {
      users: MOCK_USERS.slice(0, 2),
      currentIndex: 2, // already done
      followed: ['1000'],
      skipped: ['1001'],
      createdAt: new Date().toISOString(),
      source: 'test',
    };
    await seedStorage(context, extensionId, { followQueue: queue });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#doneState')).toBeVisible({ timeout: 5000 });

    await page.click('#clearQueueBtn');
    await page.waitForTimeout(300);

    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#queueActive')).not.toBeVisible();

    await page.close();
  });
});

// ===========================================================================
// COMPARE LISTS
// ===========================================================================

test.describe('Compare Lists', () => {
  test('options page shows empty state with no saved lists', async () => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('#savedLists')).toContainText('No saved lists yet');
    await expect(page.locator('#compareSection')).not.toBeVisible();

    await page.close();
  });

  test('options page shows saved lists and compare controls', async () => {
    // Seed two saved lists
    const savedLists = {
      'alice_followers_1': {
        users: MOCK_FOLLOWERS,
        meta: { username: 'alice', type: 'followers', count: MOCK_FOLLOWERS.length },
        savedAt: new Date().toISOString(),
      },
      'alice_following_1': {
        users: MOCK_USERS,
        meta: { username: 'alice', type: 'following', count: MOCK_USERS.length },
        savedAt: new Date().toISOString(),
      },
    };
    await seedStorage(context, extensionId, { savedLists });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Saved lists should be displayed
    await expect(page.locator('.list-card')).toHaveCount(2);

    // Compare section should be visible with dropdowns
    await expect(page.locator('#compareSection')).toBeVisible();
    await expect(page.locator('#followersList option')).toHaveCount(2);
    await expect(page.locator('#followingList option')).toHaveCount(2);

    // Dropdowns should pre-select correct types
    const followersVal = await page.locator('#followersList').inputValue();
    expect(followersVal).toBe('alice_followers_1');
    const followingVal = await page.locator('#followingList').inputValue();
    expect(followingVal).toBe('alice_following_1');

    await page.close();
  });

  test('compare produces correct results', async () => {
    // MOCK_FOLLOWERS: user0-user4 (mutual) + follower0-follower4 (only followers)
    // MOCK_USERS: user0-user9 (user5-user9 only following, not followers)
    const savedLists = {
      'alice_followers_1': {
        users: MOCK_FOLLOWERS,
        meta: { username: 'alice', type: 'followers', count: MOCK_FOLLOWERS.length },
        savedAt: new Date().toISOString(),
      },
      'alice_following_1': {
        users: MOCK_USERS,
        meta: { username: 'alice', type: 'following', count: MOCK_USERS.length },
        savedAt: new Date().toISOString(),
      },
    };
    await seedStorage(context, extensionId, { savedLists });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    // Set dropdowns and click compare
    await page.selectOption('#followersList', 'alice_followers_1');
    await page.selectOption('#followingList', 'alice_following_1');
    await page.click('#compareBtn');
    await page.waitForTimeout(500);

    // Results section should appear
    await expect(page.locator('#resultsSection')).toBeVisible();

    // Verify stats
    const statsText = await page.locator('#stats').textContent();
    expect(statsText).toContain('10'); // totalFollowers
    expect(statsText).toContain('10'); // totalFollowing
    expect(statsText).toContain('5');  // mutuals

    // Default tab is "Don't Follow Back" - users in following but not in followers
    // user5-user9 are following-only = 5 users
    const userItems = page.locator('#userList .user-item');
    await expect(userItems).toHaveCount(5);

    // Switch to Mutuals tab
    await page.click('[data-tab="mutuals"]');
    await page.waitForTimeout(200);
    const mutualItems = page.locator('#userList .user-item');
    await expect(mutualItems).toHaveCount(5);

    // Switch to "You Don't Follow Back" tab
    await page.click('[data-tab="notFollowedBack"]');
    await page.waitForTimeout(200);
    const notFollowedItems = page.locator('#userList .user-item');
    await expect(notFollowedItems).toHaveCount(5); // follower0-follower4

    await page.close();
  });

  test('search filters comparison results', async () => {
    const savedLists = {
      'alice_followers_1': {
        users: MOCK_FOLLOWERS,
        meta: { username: 'alice', type: 'followers', count: MOCK_FOLLOWERS.length },
        savedAt: new Date().toISOString(),
      },
      'alice_following_1': {
        users: MOCK_USERS,
        meta: { username: 'alice', type: 'following', count: MOCK_USERS.length },
        savedAt: new Date().toISOString(),
      },
    };
    await seedStorage(context, extensionId, { savedLists });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    await page.selectOption('#followersList', 'alice_followers_1');
    await page.selectOption('#followingList', 'alice_following_1');
    await page.click('#compareBtn');
    await page.waitForTimeout(500);

    // Search for a specific user
    await page.fill('#searchInput', 'user5');
    await page.waitForTimeout(200);

    const filtered = page.locator('#userList .user-item');
    await expect(filtered).toHaveCount(1);

    await page.close();
  });

  test('delete a saved list removes it', async () => {
    const savedLists = {
      'test_list_1': {
        users: MOCK_USERS.slice(0, 3),
        meta: { username: 'bob', type: 'followers', count: 3 },
        savedAt: new Date().toISOString(),
      },
    };
    await seedStorage(context, extensionId, { savedLists });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('.list-card')).toHaveCount(1);

    // Click delete
    await page.click('.list-card .danger');
    await page.waitForTimeout(500);

    // Should show empty state
    await expect(page.locator('#savedLists')).toContainText('No saved lists yet');

    // Verify storage is empty
    const storage = await readStorage(context, extensionId, 'savedLists');
    expect(Object.keys(storage.savedLists || {}).length).toBe(0);

    await page.close();
  });
});
