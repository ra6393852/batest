import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/desktop',testIgnore:process.env.LICENSE_E2E_INFO?[]:['**/license.spec.ts'], timeout: 60000, workers: 1, reporter: 'list', use: { trace: 'retain-on-failure' } });
