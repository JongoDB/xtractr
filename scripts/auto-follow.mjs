#!/usr/bin/env node

/**
 * auto-follow.mjs
 *
 * Automates following X/Twitter profiles from a JSON file exported by xtractr.
 * Uses Playwright to drive your real Chrome browser with your existing session,
 * so no API keys or tokens are needed.
 *
 * Usage:
 *   node scripts/auto-follow.mjs <path-to-json> [--start N]
 *
 * Options:
 *   --start N   Skip the first N profiles (useful for resuming after rate limit)
 *
 * The JSON file should be an array of objects with a "username" field, which is
 * the default format exported by xtractr's filtered export.
 *
 * Example:
 *   node scripts/auto-follow.mjs ~/Downloads/my_following_filtered.json
 *   node scripts/auto-follow.mjs ~/Downloads/my_following_filtered.json --start 142
 */

import { chromium } from "playwright";
import { readFileSync, mkdtempSync, cpSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

// --- Configuration ---

const MIN_DELAY = 10_000; // 10 seconds between follows
const MAX_DELAY = 15_000; // 15 seconds between follows
const STARTUP_WAIT = 15_000; // Time to verify login before starting
const RATE_LIMIT_PAUSE = 15 * 60_000; // 15 minutes when rate-limited
const MAX_RATE_LIMIT_RETRIES = 3; // Give up on a profile after this many 429s in a row
const BATCH_SIZE = 100; // Pause for a breather every N follows
const BATCH_PAUSE = 2 * 60_000; // 2 minute pause between batches

// --- Helpers ---

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay() {
  return MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
}

function getChromeProfileDir() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === "darwin") {
    return `${home}/Library/Application Support/Google/Chrome`;
  } else if (platform === "win32") {
    return `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`;
  } else {
    return `${home}/.config/google-chrome`;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let inputFile = null;
  let startIndex = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1]) {
      startIndex = parseInt(args[i + 1], 10);
      i++;
    } else if (!inputFile) {
      inputFile = args[i];
    }
  }

  return { inputFile, startIndex };
}

// --- Main ---

const { inputFile, startIndex } = parseArgs();

if (!inputFile) {
  console.error("Usage: node scripts/auto-follow.mjs <path-to-json> [--start N]");
  console.error(
    "\nThe JSON file should be an array of objects with a 'username' field."
  );
  console.error("Example: node scripts/auto-follow.mjs ~/Downloads/filtered_users.json");
  console.error("         node scripts/auto-follow.mjs users.json --start 142");
  process.exit(1);
}

const filePath = resolve(inputFile);

if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

let profiles;
try {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  // Support both flat arrays of usernames and arrays of objects with a username field
  profiles = raw.map((item) =>
    typeof item === "string" ? item : item.username
  );
} catch (err) {
  console.error(`Failed to parse JSON: ${err.message}`);
  process.exit(1);
}

if (!profiles.length) {
  console.error("No profiles found in the JSON file.");
  process.exit(1);
}

console.log(`Loaded ${profiles.length} profiles to follow.`);
if (startIndex > 0) {
  console.log(`Resuming from profile #${startIndex + 1}.`);
}
console.log();

// Copy Chrome profile to a temp directory so Playwright doesn't conflict
// with a running Chrome instance.
const srcProfile = getChromeProfileDir();

if (!existsSync(srcProfile)) {
  console.error(`Chrome profile not found at: ${srcProfile}`);
  console.error(
    "Make sure Google Chrome is installed and you've signed in at least once."
  );
  process.exit(1);
}

const tmpProfile = mkdtempSync(`${tmpdir()}/xtractr-follow-`);

console.log("Copying Chrome profile to temp directory...");
cpSync(`${srcProfile}/Default`, `${tmpProfile}/Default`, { recursive: true });
if (existsSync(`${srcProfile}/Local State`)) {
  cpSync(`${srcProfile}/Local State`, `${tmpProfile}/Local State`);
}
console.log("Profile copied.\n");

console.log("Launching Chrome...\n");

const context = await chromium.launchPersistentContext(tmpProfile, {
  headless: false,
  channel: "chrome",
  viewport: { width: 1280, height: 900 },
  args: [
    "--profile-directory=Default",
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ],
  ignoreDefaultArgs: ["--enable-automation"],
});

const page = context.pages()[0] || (await context.newPage());

// Hide Playwright's webdriver flag
await page.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
});

// Listen for 429 responses to detect rate limiting
let rateLimited = false;
page.on("response", (response) => {
  if (response.status() === 429) {
    rateLimited = true;
  }
});

await page.goto("https://x.com");
console.log(
  `Waiting ${STARTUP_WAIT / 1000} seconds — verify you're logged in to X...\n`
);
await sleep(STARTUP_WAIT);

let followed = 0;
let skipped = 0;
let failed = 0;
let consecutiveFollows = 0;

for (let i = startIndex; i < profiles.length; i++) {
  const username = profiles[i];
  const progress = `[${i + 1}/${profiles.length}]`;

  try {
    // Reset rate limit flag before navigating
    rateLimited = false;

    await page.goto(`https://x.com/${username}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    await sleep(2000);

    // Check if we got rate-limited on page load
    if (rateLimited) {
      console.log(
        `${progress} ⏸️  Rate limited! Pausing for ${RATE_LIMIT_PAUSE / 60_000} minutes...`
      );
      await sleep(RATE_LIMIT_PAUSE);
      rateLimited = false;
      // Retry this profile
      i--;
      continue;
    }

    // X's follow button lives inside a placementTracking container
    const followBtn = page
      .locator('[data-testid="placementTracking"] >> [role="button"]')
      .first();

    const btnText = await followBtn
      .textContent({ timeout: 5000 })
      .catch(() => null);

    if (!btnText) {
      console.log(
        `${progress} ⚠️  ${username} — no follow button found, skipping`
      );
      skipped++;
      continue;
    }

    const trimmed = btnText.trim();

    if (trimmed === "Follow") {
      // Reset rate limit flag before clicking
      rateLimited = false;

      await followBtn.click();

      // Wait a moment for the API call to complete
      await sleep(1500);

      // Check if the follow action triggered a 429
      if (rateLimited) {
        console.log(
          `${progress} ⏸️  ${username} — rate limited on follow! Pausing for ${RATE_LIMIT_PAUSE / 60_000} minutes...`
        );
        console.log(
          `      Progress so far: ✅ ${followed} followed | ⏭️ ${skipped} skipped | ❌ ${failed} failed`
        );
        console.log(
          `      Resume later with: --start ${i}`
        );
        await sleep(RATE_LIMIT_PAUSE);
        rateLimited = false;
        consecutiveFollows = 0;
        // Retry this profile
        i--;
        continue;
      }

      // Verify the button changed to "Following"
      const newText = await followBtn
        .textContent({ timeout: 3000 })
        .catch(() => null);

      if (newText && newText.trim() !== "Follow") {
        followed++;
        consecutiveFollows++;
        console.log(`${progress} ✅ ${username} — followed`);
      } else {
        console.log(
          `${progress} ⚠️  ${username} — click didn't register, skipping`
        );
        skipped++;
        continue;
      }
    } else {
      console.log(
        `${progress} ⏭️  ${username} — button says "${trimmed}", skipping`
      );
      skipped++;
      continue;
    }
  } catch (err) {
    console.log(`${progress} ❌ ${username} — error: ${err.message}`);
    failed++;
  }

  // Batch pause: take a breather every BATCH_SIZE follows
  if (consecutiveFollows > 0 && consecutiveFollows % BATCH_SIZE === 0) {
    console.log(
      `\n⏸️  Batch pause after ${consecutiveFollows} follows. Waiting ${BATCH_PAUSE / 60_000} minutes...\n`
    );
    await sleep(BATCH_PAUSE);
  }

  const delay = randomDelay();
  await sleep(delay);
}

console.log(
  `\nDone! ✅ ${followed} followed | ⏭️ ${skipped} skipped | ❌ ${failed} failed`
);

await context.close();
