import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./tests', testMatch:'*.spec.js', workers:1, fullyParallel:false,
  timeout:60000, expect:{timeout:10000}, retries:0,
  use:{baseURL:'http://127.0.0.1:3100',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  reporter:[['list'],['html',{open:'never'}]],
  webServer:{command:'node server/index.mjs',url:'http://127.0.0.1:3100/api/health',timeout:120000,reuseExistingServer:!process.env.CI,
    env:process.env.CI?{DATABASE_PUBLIC_URL:process.env.DATABASE_URL,DATABASE_URL:''}:undefined},
})
