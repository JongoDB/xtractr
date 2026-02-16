/**
 * Generate Chrome Web Store promotional tiles.
 * - Small promo tile: 440x280
 * - Marquee promo tile: 1400x560
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = '/home/kasm-user/Downloads/store-screenshots';

const iconPath = path.resolve(__dirname, '..', 'icons', 'icon128.png');
const iconBase64 = fs.readFileSync(iconPath).toString('base64');
const iconDataUri = `data:image/png;base64,${iconBase64}`;

function tileHTML(width, height) {
  const isMarquee = width > 1000;
  const logoSize = isMarquee ? 80 : 56;
  const titleSize = isMarquee ? 64 : 40;
  const taglineSize = isMarquee ? 24 : 16;
  const featureSize = isMarquee ? 18 : 13;
  const chipPad = isMarquee ? '8px 18px' : '5px 12px';
  const chipSize = isMarquee ? 15 : 12;
  const gap = isMarquee ? 20 : 12;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${width}px;
    height: ${height}px;
    background: linear-gradient(135deg, #0a1628 0%, #15202b 40%, #1a2d42 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #e7e9ea;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    position: relative;
  }

  /* Subtle grid pattern */
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(29,155,240,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(29,155,240,0.03) 1px, transparent 1px);
    background-size: ${isMarquee ? 40 : 30}px ${isMarquee ? 40 : 30}px;
  }

  /* Accent glow */
  body::after {
    content: '';
    position: absolute;
    width: ${isMarquee ? 500 : 300}px;
    height: ${isMarquee ? 500 : 300}px;
    background: radial-gradient(circle, rgba(29,155,240,0.12) 0%, transparent 70%);
    top: 50%;
    left: ${isMarquee ? '30%' : '50%'};
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: ${isMarquee ? 'row' : 'column'};
    align-items: center;
    ${isMarquee ? 'gap: 60px;' : 'gap: ' + gap + 'px;'}
    text-align: ${isMarquee ? 'left' : 'center'};
    padding: ${isMarquee ? '0 80px' : '0 24px'};
  }

  .brand {
    display: flex;
    flex-direction: column;
    align-items: ${isMarquee ? 'flex-start' : 'center'};
    ${isMarquee ? 'flex: 1;' : ''}
  }

  .logo-row {
    display: flex;
    align-items: center;
    gap: ${isMarquee ? 20 : 12}px;
    margin-bottom: ${isMarquee ? 16 : 8}px;
  }

  .logo-img {
    width: ${logoSize}px;
    height: ${logoSize}px;
    border-radius: ${isMarquee ? 16 : 12}px;
  }

  .title {
    font-size: ${titleSize}px;
    font-weight: 800;
    letter-spacing: -1.5px;
    line-height: 1;
  }

  .tagline {
    font-size: ${taglineSize}px;
    color: #8899a6;
    line-height: 1.4;
    max-width: ${isMarquee ? 500 : 360}px;
    margin-top: ${isMarquee ? 8 : 4}px;
  }

  .features {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: ${isMarquee ? 20 : 10}px;
    ${isMarquee ? '' : 'justify-content: center;'}
  }

  .chip {
    padding: ${chipPad};
    border-radius: 9999px;
    border: 1px solid rgba(29,155,240,0.4);
    background: rgba(29,155,240,0.1);
    color: #1d9bf0;
    font-size: ${chipSize}px;
    font-weight: 600;
    white-space: nowrap;
  }

  ${isMarquee ? `
  .preview {
    flex-shrink: 0;
    width: 320px;
    background: #192734;
    border-radius: 16px;
    border: 1px solid #38444d;
    padding: 20px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
  }

  .preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid #38444d;
  }

  .preview-logo { font-size: 16px; font-weight: 800; }
  .preview-ver { font-size: 10px; color: #8899a6; }

  .preview-session {
    text-align: center;
    margin-bottom: 14px;
  }

  .preview-meta {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .preview-user { font-weight: 600; font-size: 14px; }
  .preview-badge {
    background: #1d9bf0;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 9999px;
    text-transform: uppercase;
  }

  .preview-count {
    font-size: 32px;
    font-weight: 800;
    line-height: 1;
  }

  .preview-label {
    font-size: 11px;
    color: #8899a6;
    margin-top: 2px;
  }

  .preview-btns {
    display: flex;
    gap: 6px;
  }

  .preview-btn {
    flex: 1;
    padding: 8px;
    border-radius: 9999px;
    border: 1px solid #38444d;
    background: transparent;
    color: #e7e9ea;
    font-size: 12px;
    font-weight: 600;
    text-align: center;
  }

  .preview-btn.primary {
    background: #1d9bf0;
    border-color: #1d9bf0;
    color: #fff;
  }
  ` : ''}
</style>
</head>
<body>
  <div class="content">
    <div class="brand">
      <div class="logo-row">
        <img class="logo-img" src="${iconDataUri}" alt="xtractr">
        <span class="title">xtractr</span>
      </div>
      <div class="tagline">Export, filter, and analyze your X/Twitter followers and following lists</div>
      <div class="features">
        <span class="chip">Bulk Export</span>
        <span class="chip">Smart Filters</span>
        <span class="chip">CSV / JSON</span>
        <span class="chip">List Compare</span>
        <span class="chip">Follow Queue</span>
      </div>
    </div>
    ${isMarquee ? `
    <div class="preview">
      <div class="preview-header">
        <span class="preview-logo">xtractr</span>
        <span class="preview-ver">v1.0</span>
      </div>
      <div class="preview-session">
        <div class="preview-meta">
          <span class="preview-user">@elonmusk</span>
          <span class="preview-badge">Following</span>
        </div>
        <div class="preview-count">1,247</div>
        <div class="preview-label">users captured</div>
      </div>
      <div class="preview-btns">
        <div class="preview-btn primary">Fetch All</div>
        <div class="preview-btn">CSV</div>
        <div class="preview-btn">JSON</div>
      </div>
    </div>
    ` : ''}
  </div>
</body>
</html>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });

  // Small promo tile: 440x280
  const smallPage = await browser.newPage({ viewport: { width: 440, height: 280 } });
  await smallPage.setContent(tileHTML(440, 280));
  await smallPage.waitForTimeout(500);
  await smallPage.screenshot({ path: path.join(OUT, 'small-promo-440x280.png'), type: 'png' });
  console.log('Captured: small-promo-440x280.png');
  await smallPage.close();

  // Marquee promo tile: 1400x560
  const marqueePage = await browser.newPage({ viewport: { width: 1400, height: 560 } });
  await marqueePage.setContent(tileHTML(1400, 560));
  await marqueePage.waitForTimeout(500);
  await marqueePage.screenshot({ path: path.join(OUT, 'marquee-promo-1400x560.png'), type: 'png' });
  console.log('Captured: marquee-promo-1400x560.png');
  await marqueePage.close();

  await browser.close();
  console.log(`\nDone! Promo tiles saved to ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
