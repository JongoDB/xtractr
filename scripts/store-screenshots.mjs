/**
 * Capture 1280x800 screenshots for Chrome Web Store listing.
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = '/home/kasm-user/Downloads/store-screenshots';

const MOCK_USERS = Array.from({ length: 10 }, (_, i) => ({
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

const MOCK_FOLLOWERS = [
  ...MOCK_USERS.slice(0, 5),
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

async function getExtensionId(context) {
  let sw = context.serviceWorkers().find(w => w.url().includes('service-worker'));
  if (!sw) {
    sw = await context.waitForEvent('serviceworker', {
      predicate: w => w.url().includes('service-worker'),
      timeout: 10000,
    });
  }
  const match = sw.url().match(/chrome-extension:\/\/([^/]+)/);
  return match?.[1];
}

async function seedStorage(context, extensionId, data) {
  const sw = context.serviceWorkers().find(w => w.url().includes(extensionId));
  await sw.evaluate((d) => chrome.storage.local.set(d), data);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-sandbox',
      '--window-size=1280,800',
    ],
  });

  const extensionId = await getExtensionId(context);
  console.log('Extension ID:', extensionId);

  // --- Screenshot 1: Popup ---
  const session = {
    id: `ss-${Date.now()}`,
    username: 'elonmusk',
    type: 'following',
    users: MOCK_USERS,
    userIds: Object.fromEntries(MOCK_USERS.map(u => [u.userId, true])),
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
  await seedStorage(context, extensionId, { currentSession: session });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await popup.waitForLoadState('domcontentloaded');
  await popup.locator('#active').waitFor({ state: 'visible', timeout: 5000 });
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(OUT, '1-popup.png'), type: 'png' });
  console.log('Captured: 1-popup.png');

  // Expand filter panel and activate some presets
  await popup.click('#filterToggle');
  await popup.locator('#filterPanel').waitFor({ state: 'visible', timeout: 3000 });
  await popup.click('.chip[data-preset="Tech"]');
  await popup.click('.chip[data-preset="Security"]');
  await popup.waitForTimeout(500);
  await popup.screenshot({ path: path.join(OUT, '4-popup-filters.png'), type: 'png' });
  console.log('Captured: 4-popup-filters.png');
  await popup.close();

  // --- Screenshot 2: Follow Queue ---
  await seedStorage(context, extensionId, {
    followQueue: {
      users: MOCK_USERS.slice(0, 5).map((u, i) => ({
        ...u,
        _score: [82, 65, 47, 31, 15][i],
        _matches: [
          { keyword: 'engineer', type: 'bio-exact', weight: 3 },
          { keyword: 'cloud', type: 'bio-exact', weight: 3 },
        ],
      })),
      currentIndex: 0,
      followed: [],
      skipped: [],
      createdAt: new Date().toISOString(),
      source: 'filter',
    },
  });

  const queue = await context.newPage();
  await queue.setViewportSize({ width: 1280, height: 800 });
  await queue.goto(`chrome-extension://${extensionId}/src/queue/queue.html`);
  await queue.waitForLoadState('domcontentloaded');
  await queue.locator('#queueActive').waitFor({ state: 'visible', timeout: 5000 });
  await queue.waitForTimeout(300);
  await queue.screenshot({ path: path.join(OUT, '2-queue.png'), type: 'png' });
  console.log('Captured: 2-queue.png');
  await queue.close();

  // --- Screenshot 3: Compare Results ---
  const savedLists = {
    'elonmusk_followers_1': {
      users: MOCK_FOLLOWERS,
      meta: { username: 'elonmusk', type: 'followers', count: MOCK_FOLLOWERS.length },
      savedAt: new Date().toISOString(),
    },
    'elonmusk_following_1': {
      users: MOCK_USERS,
      meta: { username: 'elonmusk', type: 'following', count: MOCK_USERS.length },
      savedAt: new Date().toISOString(),
    },
  };
  await seedStorage(context, extensionId, { savedLists });

  const options = await context.newPage();
  await options.setViewportSize({ width: 1280, height: 800 });
  await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
  await options.waitForLoadState('domcontentloaded');
  await options.locator('#compareSection').waitFor({ state: 'visible', timeout: 5000 });
  await options.selectOption('#followersList', 'elonmusk_followers_1');
  await options.selectOption('#followingList', 'elonmusk_following_1');
  await options.click('#compareBtn');
  await options.waitForTimeout(500);
  await options.locator('#resultsSection').waitFor({ state: 'visible', timeout: 5000 });
  await options.waitForTimeout(300);
  await options.screenshot({ path: path.join(OUT, '3-compare.png'), type: 'png' });
  console.log('Captured: 3-compare.png');
  await options.close();

  await context.close();
  console.log(`\nDone! Screenshots saved to ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
