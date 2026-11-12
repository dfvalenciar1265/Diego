import { defineConfig, devices } from '@playwright/test'
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://invalid')
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.port !== '54321') throw Error('E2E operación exige Supabase local 54321')
if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw Error('Faltan claves del stack LOCAL')
export default defineConfig({
 testDir:'./e2e-operation',fullyParallel:false,workers:1,retries:0,
 reporter:[['list']],use:{baseURL:'http://127.0.0.1:4100',trace:'off',screenshot:'off',video:'off'},
 projects:[{name:'operation-desktop',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'npx next dev --webpack -p 4100 -H 127.0.0.1',url:'http://127.0.0.1:4100/login',reuseExistingServer:false,timeout:120000,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:url.origin,NEXT_PUBLIC_APP_URL:'http://127.0.0.1:4100',GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:'',CRON_SECRET:'',GPT_API_KEY:''}},
})
