const { test, expect } = require('@playwright/test');

async function openTerminal(page) {
  await page.getByRole('button', { name: 'Open terminal' }).click();
  return page.getByLabel('Enter command');
}

async function command(input, value) {
  await input.fill(value);
  await input.press('Enter');
}

test('ls, cat/open and tab completion navigate through the terminal', async ({ page }) => {
  await page.goto('/');
  const input = await openTerminal(page);
  await expect(page.locator('#console-log')).toContainText('/\n├── index.html\n├── education.html');
  await expect(page.locator('#console-log')).toContainText("Type 'help' for commands.");
  await expect(page.locator('#console-log')).not.toContainText('↑/↓ for history');
  await command(input, 'ls');
  await expect(page.locator('#console-log')).toContainText('education.html');

  await input.fill('op');
  await input.press('Tab');
  await expect(input).toHaveValue('open');
  await command(input, 'open writing.html');
  await expect(page).toHaveURL(/writing\.html$/);
  await expect(page.locator('#console-panel')).toBeVisible();

  const nextInput = page.getByLabel('Enter command');
  await command(nextInput, 'cat work.html');
  await expect(page).toHaveURL(/work\.html$/);
  await expect(page.locator('#console-log')).toContainText('cat work.html');
});

test('mail wizard sends only WhatsApp and can cancel', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => {
    window.__CONSOLE_CONFIG__ = {
      callmebotPhone: '4912345678',
      callmebotApiKey: 'test-key'
    };
  });
  await page.route('https://api.callmebot.com/**', async route => {
    requests.push(route.request().url());
    await route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto('/');
  const input = await openTerminal(page);
  await command(input, 'mail');
  await command(input, 'Ada');
  await command(input, 'ada@example.test');
  await command(input, 'Hello from the test suite.');
  await expect(page.locator('#console-log')).toContainText('WhatsApp: sent');
  await expect(page.locator('#console-log')).not.toContainText('Email:');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests.some(url => url.startsWith('https://api.callmebot.com/whatsapp.php?'))).toBeTruthy();

  await command(input, 'mail');
  await command(input, 'cancel');
  await expect(page.locator('#console-log')).toContainText('Mail cancelled.');
});

test('console log and open state survive console navigation only', async ({ page }) => {
  await page.goto('/');
  const input = await openTerminal(page);
  await command(input, 'whoami');
  await command(input, 'cat education.html');
  await expect(page).toHaveURL(/education\.html$/);
  await expect(page.locator('#console-panel')).toBeVisible();
  await expect(page.locator('#console-log')).toContainText('mathematician');
});

test('a saved closed terminal state restores its log without opening the panel', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem('petersenmalte-console-navigation-state', JSON.stringify({
      open: false,
      log: '<div>Remembered terminal output</div>'
    }));
  });
  await page.goto('/education.html');
  await expect(page.locator('#console-panel')).toBeHidden();
  await expect(page.locator('#console-log')).toContainText('Remembered terminal output');
});

for (const entry of [
  { pathname: 'education.html', name: /back/i },
  { pathname: 'work.html', name: /back/i },
  { pathname: 'writing.html', name: /back/i },
  { pathname: '404.html', name: /back to regularization/i },
  { pathname: 'falk.html', name: /petersenmalte\.de/i }
]) {
  test(`back link on ${entry.pathname} returns to index.html`, async ({ page }) => {
    await page.goto('/' + entry.pathname);
    const backLink = page.getByRole('link', { name: entry.name }).first();
    await expect(backLink).toHaveAttribute('href', 'index.html');
    await backLink.click();
    await expect(page).toHaveURL(/\/index\.html$/);
  });
}
