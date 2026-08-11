import { chromium } from 'playwright';

const DIR = 'C:/Users/kisla/AppData/Local/Temp/claude/d--Projects-News/12c7709c-9a5e-4acf-b874-2134c7efe40e/scratchpad';
const URL = process.env.TARGET_URL || 'http://127.0.0.1:4173';
const TAG = process.env.SHOT_TAG || 'trend';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [], failed = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', (r) => failed.push(`${r.url().slice(0, 70)} :: ${r.failure()?.errorText}`));

const api = [];
page.on('response', (r) => {
    const u = r.url();
    if (/\/(trends|movers|alert-analysis|articles|stats)/.test(u)) {
        api.push(`${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}`);
    }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('main', { timeout: 45000 });
await page.waitForTimeout(4500);

const board = page.locator('text=/Escalation Board/i').first();
await board.scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${DIR}/${TAG}_escalation.png` });

const boardText = await page.locator('section', { has: page.locator('text=/Escalation Board/i') }).first().innerText().catch(() => '');
const sparkCount = await page.locator('svg[aria-label="Risk trend"]').count();
const noHistory = await page.locator('text=/No history/i').count();
const building = await page.locator('text=/Building baseline/i').count();

// Exercise the window switcher
let switched = 'not-run';
const btn24 = page.locator('button', { hasText: /^24h$/ }).first();
if (await btn24.count()) {
    await btn24.click();
    await page.waitForTimeout(2500);
    switched = (await page.locator('text=/Escalating/i').count()) > 0 ? '24h switch OK' : '24h switch produced no section';
}

console.log('=== API CALLS ===');
console.log([...new Set(api)].join('\n') || '(none)');
console.log('\n=== ESCALATION BOARD TEXT ===');
console.log(boardText.split('\n').filter(Boolean).slice(0, 22).join('\n'));
console.log('\nsparklines rendered:', sparkCount, '| "No history" placeholders:', noHistory, '| "Building baseline":', building);
console.log('window switch:', switched);
console.log('\nJS ERRORS:', errors.length ? errors.slice(0, 6).join(' | ') : '(none)');
console.log('FAILED REQUESTS:', failed.length ? failed.slice(0, 6).join(' | ') : '(none)');

await browser.close();
