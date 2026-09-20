const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Never send real notifications or load external data while testing.
  await page.route('https://**/*', route => route.abort());
  await page.addInitScript(() => {
    window.__CONSOLE_CONFIG__ = { callmebotPhone: '4912345678', callmebotApiKey: 'test-key' };
  });
});

async function openTerminal(page) {
  await page.getByRole('button', { name: 'Open terminal' }).click();
  return page.getByLabel('Enter command');
}

async function command(input, value) {
  await input.fill(value);
  await input.press('Enter');
}

test('ls, open and tab completion navigate through the terminal', async ({ page }) => {
  await page.goto('./');
  const input = await openTerminal(page);
  await expect(page.locator('#console-log')).toContainText('/\n├── index.html\n├── education.html');
  await expect(page.locator('#console-log')).toContainText("Type 'help' for commands.");
  await expect(page.locator('#console-log')).not.toContainText('↑/↓ for history');
  await command(input, 'ls');
  await expect(page.locator('#console-log')).toContainText('education.html');

  await input.fill('op');
  await input.press('Tab');
  await expect(input).toHaveValue('open');
  await input.fill('open /wri');
  await input.press('Tab');
  await expect(input).toHaveValue('open /writing.html');
  await input.press('Enter');
  await expect(page).toHaveURL(/writing\.html$/);
  await expect(page.locator('#console-panel')).toBeVisible();

  const nextInput = page.getByLabel('Enter command');
  await nextInput.fill('open wo');
  await nextInput.press('Tab');
  await expect(nextInput).toHaveValue('open work.html');
  await nextInput.press('Enter');
  await expect(page).toHaveURL(/work\.html$/);
  await expect(page.locator('#console-log')).toContainText('open work.html');
});

test('message wizard provides an optional reply address and can cancel', async ({ page }) => {
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
  await page.goto('./');
  const input = await openTerminal(page);
  await command(input, 'mail');
  await command(input, 'Ada');
  await command(input, 'ada@example.test');
  await command(input, 'Hello from the test suite.');
  await expect(page.locator('#console-log')).toContainText('sent message.');
  await expect(page.locator('#console-log')).not.toContainText('WhatsApp');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests.some(url => url.startsWith('https://api.callmebot.com/whatsapp.php?'))).toBeTruthy();
  expect(new URL(requests[0]).searchParams.get('text')).toContain('Reply to: ada@example.test');

  await command(input, 'mail');
  await command(input, 'cancel');
  await expect(page.locator('#console-log')).toContainText('Message cancelled.');
  expect(requests).toHaveLength(1);
});

test('console survives commands and normal links with identical size and history', async ({ page }) => {
  await page.goto('./');
  const input = await openTerminal(page);
  const size = await page.locator('#console-panel').boundingBox();
  await command(input, 'whoami');
  await command(input, 'open education.html');
  await expect(page).toHaveURL(/education\.html$/);
  await expect(page.locator('#console-panel')).toBeVisible();
  await expect(page.locator('#console-log')).toContainText('mathematician');
  expect(await page.locator('#console-panel').boundingBox()).toEqual(size);
  await input.fill('unfinished command');
  await page.getByRole('link', { name: /convergence explorer/i }).click();
  await expect(page).toHaveURL(/falk\.html$/);
  await expect(page.locator('#console-panel')).toBeVisible();
  expect(await page.locator('#console-panel').boundingBox()).toEqual(size);
  await expect(input).toHaveValue('unfinished command');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('open education.html');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('unfinished command');
  await page.getByRole('link', { name: /petersenmalte\.de/i }).first().click();
  await expect(page).toHaveURL(/index\.html$/);
  await expect(page.locator('#console-panel')).toBeVisible();
  expect(await page.locator('#console-panel').boundingBox()).toEqual(size);
  await page.goBack();
  await expect(page.locator('#console-panel')).toBeVisible();
  await expect(input).toHaveValue('unfinished command');
});

test('a saved closed terminal state restores its log without opening the panel', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('petersenmalte-console-navigation-state', JSON.stringify({
      open: false,
      log: '<div>Remembered terminal output</div>'
    }));
  });
  await page.goto('education.html');
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
    await page.goto(entry.pathname);
    const backLink = page.getByRole('link', { name: entry.name }).first();
    await expect(backLink).toHaveAttribute('href', 'index.html');
    await backLink.click();
    await expect(page).toHaveURL(/\/index\.html$/);
    await expect(page.getByRole('heading', { name: 'Malte Petersen' })).toBeVisible();
  });
}

test('empty email submits once without CORS errors or provider names', async ({ page }) => {
  const requests = [];
  await page.route('https://api.callmebot.com/**', async route => {
    requests.push(route.request());
    // Deliberately omit Access-Control-Allow-Origin, like the real endpoint.
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'queued' });
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      window.lastResponseType = response.type;
      return response;
    };
  });
  await page.goto('./');
  const input = await openTerminal(page);
  await command(input, 'mail');
  await command(input, 'Ada');
  await expect(page.locator('#console-log')).toContainText('optional, for a reply');
  await command(input, '');
  await command(input, 'Hello & Grüße?');
  await expect(page.locator('#console-log')).toContainText('sent message.');
  expect(requests).toHaveLength(1);
  expect(await page.evaluate(() => window.lastResponseType)).toBe('opaque');
  expect(new URL(requests[0].url()).searchParams.get('text')).toBe('Website message from Ada\n\nHello & Grüße?');
  await expect(page.locator('#console-log')).not.toContainText('WhatsApp');
  await expect(page.locator('#console-log')).not.toContainText('Failed to fetch');
});

test('network failures do not pretend that a message was sent', async ({ page }) => {
  await page.goto('./');
  const input = await openTerminal(page);
  await command(input, 'mail');
  await command(input, 'Ada');
  await command(input, '');
  await command(input, 'Hello');
  await expect(page.locator('#console-log')).toContainText('Could not send message.');
  await expect(page.locator('#console-log')).not.toContainText('sent message.');
  await expect(page.locator('#console-log')).not.toContainText('WhatsApp');
});

test('clear restores the home view and retains command history and size', async ({ page }) => {
  await page.goto('./');
  const input = await openTerminal(page);
  const home = await page.locator('#console-log').innerText();
  const size = await page.locator('#console-panel').boundingBox();
  await command(input, 'whoami');
  await command(input, 'clear');
  expect(await page.locator('#console-log').innerText()).toBe(home);
  expect(await page.locator('#console-panel').boundingBox()).toEqual(size);
  await input.press('ArrowUp');
  await expect(input).toHaveValue('clear');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('whoami');
});

test('an unfinished message continues across a link and a reload', async ({ page }) => {
  await page.goto('education.html');
  const input = await openTerminal(page);
  await command(input, 'mail');
  await command(input, 'Ada');
  await input.fill('ada@');
  await page.getByRole('link', { name: /back/i }).click();
  await expect(input).toHaveValue('ada@');
  await page.reload();
  await expect(input).toHaveValue('ada@');
  await command(input, '');
  await expect(page.locator('#console-log')).toContainText('Your message (or cancel):');
  await command(input, 'cancel');
  await expect(page.locator('#console-log')).toContainText('Message cancelled.');
});

test('closed panel stays closed across normal links without losing its history', async ({ page }) => {
  await page.goto('education.html');
  const input = await openTerminal(page);
  await command(input, 'whoami');
  await page.getByRole('button', { name: 'Close terminal' }).click();
  await page.getByRole('link', { name: /back/i }).click();
  await expect(page.locator('#console-panel')).toBeHidden();
  await openTerminal(page);
  await expect(page.locator('#console-log')).toContainText('mathematician');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('whoami');
});

test('terminal fits a mobile viewport with the same dimensions on every page', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  await openTerminal(page);
  const size = await page.locator('#console-panel').boundingBox();
  expect(size.x).toBeGreaterThanOrEqual(0);
  expect(size.x + size.width).toBeLessThanOrEqual(320);
  expect(size.y + size.height).toBeLessThanOrEqual(568);
  for (const file of ['education.html', 'work.html', 'writing.html', 'falk.html', '404.html', 'index.html']) {
    await page.goto(file);
    await expect(page.locator('#console-panel')).toBeVisible();
    expect(await page.locator('#console-panel').boundingBox()).toEqual(size);
  }
});

test('invalid email can still be skipped and cancellation never sends', async ({ page }) => {
  const requests = [];
  page.on('request', request => {
    if (request.url().includes('api.callmebot.com')) requests.push(request);
  });
  await page.goto('./');
  const input = await openTerminal(page);
  await command(input, 'mail');
  await command(input, 'Ada');
  await command(input, 's');
  await expect(page.locator('#console-log')).toContainText('Please enter a valid email, or press Enter to skip:');
  await command(input, '');
  await expect(page.locator('#console-log')).toContainText('Your message (or cancel):');
  await command(input, 'cancel');
  await expect(page.locator('#console-log')).toContainText('Message cancelled.');
  expect(requests).toHaveLength(0);
});
