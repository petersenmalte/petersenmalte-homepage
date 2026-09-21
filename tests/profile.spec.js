const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
});

test('moon reveals the calculated illuminated percentage on hover and focus', async ({ page }) => {
  await page.goto('./');
  const moon = page.locator('.moon-phase');
  const tooltip = page.getByRole('tooltip');
  await expect(moon).toHaveAttribute('aria-label', /\d+% illuminated/);
  await expect(tooltip).toBeHidden();
  await moon.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText(await moon.getAttribute('aria-label'));
  const box = await tooltip.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.mouse.move(0, 0);
  await moon.focus();
  await expect(tooltip).toBeVisible();
});

test('moon links to the SunMoonEarth application in the same tab', async ({ page }) => {
  await page.goto('./');
  const moon = page.getByRole('link', { name: /open SunMoonEarth/ });
  await expect(moon).toHaveAttribute('href', 'https://lunarcompass.app/');
  // Same tab: no target, and nothing that would open a new window.
  await expect(moon).not.toHaveAttribute('target', /.+/);
  // Reachable and activatable from the keyboard without a tabindex of its own.
  await expect(moon).not.toHaveAttribute('tabindex', /.+/);
  await moon.focus();
  await expect(moon).toBeFocused();
  await expect(page.getByRole('tooltip')).toBeVisible();
  // The homepage itself must not pull in any of the application's code.
  const html = await page.content();
  expect(html).not.toContain('three');
  expect(html).not.toContain('astronomy-engine');
});

test('education includes both thesis titles and serves the original PDF', async ({ page, request }) => {
  await page.goto('education.html');
  await expect(page.locator('main')).toContainText('Postprocessing of mixed elastic eigenvalues');
  await expect(page.locator('main')).toContainText('Fraktionierte Fourier-Basen und Fourier-Reihen');
  const open = page.getByRole('link', { name: 'open thesis (PDF)' });
  await expect(open).toHaveAttribute('target', '_blank');
  const response = await request.get(await open.getAttribute('href'));
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toBe('application/pdf');
  const { createHash } = require('node:crypto');
  expect(createHash('sha256').update(await response.body()).digest('hex'))
    .toBe('663038fbb366c4297e6f2378db5cbb8983f5be7a1629500c2305d05de1f471c5');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'download thesis' }).click();
  expect((await download).suggestedFilename()).toBe('master-thesis-petersen-2022.pdf');
});

test('removed cat command is absent from help and cannot navigate', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Open terminal' }).click();
  const input = page.getByLabel('Enter command');
  await input.fill('help');
  await input.press('Enter');
  await expect(page.locator('#console-log')).not.toContainText('cat <page>');
  await input.fill('cat education.html');
  await input.press('Enter');
  await expect(page.locator('#console-log')).toContainText('Command not found: cat education.html');
  await expect(page).not.toHaveURL(/education\.html$/);
});

test('renamed open command is absent from help and cannot navigate', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Open terminal' }).click();
  const input = page.getByLabel('Enter command');
  await input.fill('help');
  await input.press('Enter');
  await expect(page.locator('#console-log')).not.toContainText('open <page>');
  await input.fill('open education');
  await input.press('Enter');
  await expect(page.locator('#console-log')).toContainText('Command not found: open education');
  await expect(page).not.toHaveURL(/education\.html$/);
});
