const { test, expect } = require('@playwright/test');

// The deck and game under projects/tenantflow/ are a build copied from the tenantflow repository
// (web/publish-homepage.sh there); these tests check that the copy is complete and wired to this site.
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
});

test('the terminal reaches the tenantflow project page', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Open terminal' }).click();
  const input = page.getByLabel('Enter command');
  await input.fill('cd tenantflow');
  await input.press('Enter');
  await expect(page).toHaveURL(/tenantflow\.html$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('TenantFlow');
});

test('the project page links to the deck and the game, and both load all local files', async ({ page }) => {
  const missing = [];
  page.on('response', response => {
    if (response.url().startsWith('http://127.0.0.1') && response.status() >= 400) missing.push(response.url());
  });
  page.on('pageerror', error => missing.push(String(error)));

  await page.goto('tenantflow.html');
  await page.locator('#tenantflow-deck').click();
  await expect(page).toHaveURL(/projects\/tenantflow\/index\.html(#.*)?$/);
  await expect(page.locator('.reveal .slides section').first()).toBeVisible();

  await page.goto('tenantflow.html');
  await page.locator('#tenantflow-game').click();
  await expect(page).toHaveURL(/projects\/tenantflow\/game\/index\.html$/);
  await expect(page.locator('body')).toContainText('Leak the Vault');

  expect(missing).toEqual([]);
});

test('the game links back to slides that exist in the published deck', async ({ page, request }) => {
  await page.goto('projects/tenantflow/game/index.html');
  const hrefs = await page.locator('a[href*="index.html"]').evaluateAll(links =>
    links.map(a => a.href).filter(h => h.startsWith('http://127.0.0.1')));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect((await request.get(href.split('#')[0])).status(), href).toBe(200);
  }
});

test('the published build records the tenantflow revision it came from', async ({ request }) => {
  const response = await request.get('projects/tenantflow/REVISION');
  expect(response.status()).toBe(200);
  expect((await response.text()).trim()).toMatch(/^[0-9a-f]{7,40}$/);
});
