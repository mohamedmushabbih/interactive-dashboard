const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test',
  timeout: 30000,
  webServer: {
    command: 'node server.js',
    port: 3000,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 900 }
  },
});
