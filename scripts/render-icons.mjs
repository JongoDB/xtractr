/**
 * Render the logo SVG to PNG at Chrome extension icon sizes.
 * Run: node scripts/render-icons.mjs
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'logo-concepts', 'logo-final.svg');
const ICONS_DIR = path.join(ROOT, 'icons');

const svgContent = fs.readFileSync(SVG_PATH, 'utf8');
const sizes = [16, 48, 128];

async function main() {
  const browser = await chromium.launch();

  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
    });

    // Embed SVG in a minimal HTML page with no margin
    await page.setContent(`
      <html>
      <body style="margin:0; padding:0; overflow:hidden; background:transparent;">
        ${svgContent.replace(/width="128"/, `width="${size}"`).replace(/height="128"/, `height="${size}"`)}
      </body>
      </html>
    `);
    await page.waitForTimeout(200);

    await page.screenshot({
      path: path.join(ICONS_DIR, `icon${size}.png`),
      omitBackground: true,
    });

    console.log(`Rendered icon${size}.png`);
    await page.close();
  }

  // Preview with all sizes
  const previewPage = await browser.newPage({
    viewport: { width: 400, height: 200 },
  });
  await previewPage.setContent(`
    <html>
    <body style="margin:0; background:#0a0a0a; display:flex; align-items:center; justify-content:center; gap:32px; height:200px;">
      <div style="text-align:center; color:#888; font-family:sans-serif; font-size:11px;">
        <img src="file://${ICONS_DIR}/icon128.png" width="128" height="128" style="border-radius:8px;">
        <div style="margin-top:8px;">128px</div>
      </div>
      <div style="text-align:center; color:#888; font-family:sans-serif; font-size:11px;">
        <img src="file://${ICONS_DIR}/icon48.png" width="48" height="48">
        <div style="margin-top:8px;">48px</div>
      </div>
      <div style="text-align:center; color:#888; font-family:sans-serif; font-size:11px;">
        <img src="file://${ICONS_DIR}/icon16.png" width="16" height="16">
        <div style="margin-top:8px;">16px</div>
      </div>
    </body>
    </html>
  `);
  await previewPage.waitForTimeout(500);
  await previewPage.screenshot({
    path: path.join(ROOT, 'logo-concepts', 'icon-preview.png'),
  });
  console.log('Rendered icon-preview.png');

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
