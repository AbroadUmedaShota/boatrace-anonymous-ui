import assert from 'node:assert/strict';
import { chromium, type Page, type Response } from 'playwright';
import { startAnonymousWebSmoke } from './anonymous-web-smoke';

const viewports = [
  { name: 'PC', width: 1440, height: 1000 },
  { name: 'スマートフォン', width: 390, height: 844 },
];

function getResponse(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(response => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === path);
}

async function checkResult(page: Page, jobId: string, expectedRows: string[][]) {
  const panel = page.locator('#forecast-result');
  await panel.waitFor({state: 'visible'});
  assert.equal(await page.locator('#forecast-job code').textContent(), jobId);
  const params = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
  assert.equal(params.get('job'), jobId);
  const rows = await panel.locator('.probability-scroll tbody tr').evaluateAll(
    items => items.map(item => Array.from((item as HTMLTableRowElement).cells, cell => cell.textContent)),
  );
  assert.deepEqual(rows, expectedRows);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.ok(fits, 'The prediction result fits the viewport without page-level horizontal overflow');
}

async function run() {
  const {origin, token, jobId, target, result, close, outboundCalls} = await startAnonymousWebSmoke();
  let browser;
  try {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const rejected = await fetch(origin + '/api/prediction-jobs');
    assert.equal(rejected.status, 401);

    const requestsBlocked: string[] = [];
    const predictionsPath = '/api/prediction-jobs';
    const racePath = `${predictionsPath}/races/${target.date}/${target.venueCode}/${target.raceNumber}`;
    const detailPath = `${predictionsPath}/${jobId}`;
    const expectedRows = result.combinations.map((combination, index) => [
      combination, String(result.probabilities?.[index] ?? '未取得'), String(result.odds?.[index] ?? '未取得'),
    ]);
    assert.equal(expectedRows.length, 120);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
      proxy: {server: 'http://127.0.0.1:9', bypass: '127.0.0.1'},
    });
    for (const {name, width, height} of viewports) {
      const context = await browser.newContext({
        viewport: {width, height}, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block',
      });
      try {
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin || request.method() !== 'GET') {
            requestsBlocked.push(request.method() + ' ' + url.pathname);
            await route.abort();
          } else {
            await route.continue();
          }
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        await page.goto(origin, {waitUntil: 'domcontentloaded'});
        const viewerToken = page.locator('#viewer-token');
        await viewerToken.waitFor();
        await viewerToken.fill(token);
        await page.locator('.connection-panel form button[type=submit]').click();

        await page.locator('#forecast-date').fill(target.date);
        await page.locator(`[data-forecast-venue="${target.venueCode}"]`).click();
        const [race] = await Promise.all([
          getResponse(page, racePath),
          page.locator(`[data-forecast-race="${target.raceNumber}"]`).click(),
        ]);
        assert.equal(race.status(), 200);
        const scope = await race.json();
        assert.ok(scope.items.some((item: {id: string}) => item.id === jobId));

        const mode = page.locator(`[data-race-mode-status="${target.mode}"]`);
        const [detail] = await Promise.all([
          getResponse(page, detailPath),
          mode.getByRole('button', {name: /開く/}).click(),
        ]);
        assert.equal(detail.status(), 200);
        assert.deepEqual((await detail.json()).job.result, result);
        await checkResult(page, jobId, expectedRows);

        const [history] = await Promise.all([
          getResponse(page, predictionsPath),
          page.locator('#nav-predictions').click(),
        ]);
        assert.equal(history.status(), 200);
        const savedLink = page.locator(`.prediction-history-list a[href="#forecast?job=${jobId}"]`);
        await savedLink.waitFor({state: 'visible'});
        assert.equal(await savedLink.count(), 1);
        const [reopened] = await Promise.all([
          getResponse(page, detailPath),
          savedLink.click(),
        ]);
        assert.equal(reopened.status(), 200);
        assert.deepEqual((await reopened.json()).job.result, result);
        await checkResult(page, jobId, expectedRows);
        await page.goBack({waitUntil: 'domcontentloaded'});
        await savedLink.waitFor({state: 'visible'});
        console.log(`${name}: race selection, all 120 result rows, and reopening the same job from history passed`);
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(requestsBlocked, [], 'Browser issued only same-origin GETs');
    assert.equal(outboundCalls(), 0, 'Worker made no outbound requests');
  } catch (error) {
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    throw new Error(details.replaceAll(token, '[REDACTED]'));
  } finally {
    try {
      await browser?.close();
    } finally {
      await close();
    }
  }
}

await run();
