import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/server',timeout:30000,workers:1,reporter:'list',use:{headless:true,...(process.env.SERVER_TEST_BROWSER_PATH?{launchOptions:{executablePath:process.env.SERVER_TEST_BROWSER_PATH}}:{})}});
