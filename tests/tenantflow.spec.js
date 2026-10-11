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

test('the shield icon on the index opens the project page in the same tab', async ({ page }) => {
  await page.goto('./');
  const link = page.locator('#tenantflow-link');
  await expect(link).toBeVisible();
  await expect(link).not.toHaveAttribute('target', /.+/);
  await link.hover();
  await expect(page.locator('#tenantflow-link__tooltip')).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/tenantflow\.html$/);
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the shield icon overlaps no other element at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');
    const box = await page.locator('#tenantflow-link').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    for (const selector of ['#two-clocks', '#ibex', 'h1', 'footer', '#console-tab']) {
      const other = await page.locator(selector).boundingBox();
      if (!other) continue;
      const overlaps = box.x < other.x + other.width && other.x < box.x + box.width &&
        box.y < other.y + other.height && other.y < box.y + box.height;
      expect(overlaps, `${selector} overlaps the icon`).toBe(false);
    }
  });
}
