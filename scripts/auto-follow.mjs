#!/usr/bin/env node

/**
 * auto-follow.mjs
 *
 * Automates following X/Twitter profiles from a JSON file exported by xtractr.
 * Uses Playwright to drive your real Chrome browser with your existing session,
 * so no API keys or tokens are needed.
 *
 * Usage:
 *   node scripts/auto-follow.mjs <path-to-json>
 *
 * The JSON file should be an array of objects with a "username" field, which is
 * the default format exported by xtractr's filtered export.
 *
 * Example:
 *   node scripts/auto-follow.mjs ~/Downloads/my_following_filtered.json
 */

import { chromium } from "playwright";
import { readFileSync, mkdtempSync, cpSync, existsSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

// --- Configuration ---

const MIN_DELAY = 10_000; // 10 seconds between follows
const MAX_DELAY = 15_000; // 15 seconds between follows
const STARTUP_WAIT = 15_000; // Time to verify login before starting

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

// --- Main ---

const inputFile = process.argv[2];

if (!inputFile) {
  console.error("Usage: node scripts/auto-follow.mjs <path-to-json>");
  console.error(
    "\nThe JSON file should be an array of objects with a 'username' field."
  );
  console.error("Example: node scripts/auto-follow.mjs ~/Downloads/filtered_users.json");
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

console.log(`Loaded ${profiles.length} profiles to follow.\n`);

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

await page.goto("https://x.com");
console.log(
  `Waiting ${STARTUP_WAIT / 1000} seconds — verify you're logged in to X...\n`
);
await sleep(STARTUP_WAIT);

let followed = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < profiles.length; i++) {
  const username = profiles[i];
  const progress = `[${i + 1}/${profiles.length}]`;

  try {
    await page.goto(`https://x.com/${username}`, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });

    await sleep(2000);

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
      await followBtn.click();
      followed++;
      console.log(`${progress} ✅ ${username} — followed`);
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

  const delay = randomDelay();
  await sleep(delay);
}

console.log(
  `\nDone! ✅ ${followed} followed | ⏭️ ${skipped} skipped | ❌ ${failed} failed`
);

await context.close();
