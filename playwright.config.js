import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    headless: false, // Extensions require headed mode
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.resolve('.')}`,
            `--load-extension=${path.resolve('.')}`,
            '--no-sandbox',
          ],
        },
      },
    },
  ],
});
