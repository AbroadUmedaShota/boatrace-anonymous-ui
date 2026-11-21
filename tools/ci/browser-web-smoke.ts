import assert from 'node:assert/strict';
import type { LivePrediction, PredictionJob } from '@boatrace/contracts';
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
  assert.deepEqual(await probabilityRows(page), expectedRows);
  const placements = panel.getByRole('table', {name: '艇ごとの着順確率'});
  assert.equal(await placements.getByRole('row').count(), 7);
  assert.match(await placements.getByRole('row', {name: /6号艇/}).innerText(), /16\.67%/);
  assert.ok(await panel.getByText('当日の出走表による基礎予想').isVisible());
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.ok(fits, 'The prediction result fits the viewport without page-level horizontal overflow');
}

function probabilityRows(page: Page) {
  return page.locator('#forecast-result .probability-scroll tbody tr').evaluateAll(
    items => items.map(item => Array.from((item as HTMLTableRowElement).cells, cell => cell.textContent)),
  );
}

function resultRows(result: LivePrediction) {
  return result.combinations.map((combination, index) => [
    combination, String(result.probabilities?.[index] ?? '未取得'), String(result.odds?.[index] ?? '未取得'),
  ]);
}

async function openHistoryJob(page: Page, predictionsPath: string, expected: PredictionJob) {
  const link = page.locator('.prediction-history-list a').and(
    page.locator(`a[href="#forecast?job=${expected.id}"]`),
  );
  await link.waitFor({state: 'visible'});
  assert.equal(await link.count(), 1);
  const [response] = await Promise.all([
    getResponse(page, predictionsPath + '/' + expected.id),
    link.click(),
  ]);
  assert.equal(response.status(), 200);
  assert.deepEqual((await response.json()).job, expected);
  assert.equal(await page.locator('#forecast-job code').textContent(), expected.id);
}

type StagedCase = { viewport: (typeof viewports)[number]; oddsAvailable: boolean };

async function run(staged?: StagedCase) {
  const {origin, token, jobId, exhibitionId, target, result, completePrice, close, outboundCalls} = await startAnonymousWebSmoke(!!staged);
  let browser;
  try {
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const rejected = await fetch(origin + '/api/prediction-jobs');
    assert.equal(rejected.status, 401);

    const requestsBlocked: string[] = [];
    const predictionsPath = '/api/prediction-jobs';
    const racePath = `${predictionsPath}/races/${target.date}/${target.venueCode}/${target.raceNumber}`;
    const detailPath = `${predictionsPath}/${jobId}`;
    const expectedRows = resultRows(result);
    assert.equal(expectedRows.length, 120);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'],
      proxy: {server: 'http://127.0.0.1:9', bypass: '127.0.0.1'},
    });
    for (const {name, width, height} of staged ? [staged.viewport] : viewports) {
      const context = await browser.newContext({
        viewport: {width, height}, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block',
      });
      try {
        let allowedPricePosts = 0;
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          const explicitPrice = allowedPricePosts === 1 && request.method()==='POST' && url.pathname===predictionsPath;
          if (url.origin !== origin || request.method() !== 'GET' && !explicitPrice) {
            requestsBlocked.push(request.method() + ' ' + url.pathname);
            await route.abort();
          } else {
            if(explicitPrice)allowedPricePosts--;
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
        let raceButton;
        if(width<400){
          await page.getByText('保存済み開催一覧',{exact:true}).click();
          await page.getByText('桐生 · 12レース',{exact:true}).click();
          await page.getByRole('row',{name:/2R.*中止/}).waitFor();
          raceButton=page.getByRole('button',{name:'桐生 1Rを選ぶ',exact:true});
        }else{
          await page.locator(`[data-forecast-venue="${target.venueCode}"]`).click();
          raceButton=page.locator(`[data-forecast-race="${target.raceNumber}"]`);
        }
        const [race] = await Promise.all([getResponse(page,racePath),raceButton.click()]);
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
        const [exhibitionDetail] = await Promise.all([
          getResponse(page, predictionsPath + '/' + exhibitionId),
          page.goto(origin + '/#forecast?job=' + exhibitionId),
        ]);
        assert.equal(exhibitionDetail.status(), 200);
        const exhibition = (await exhibitionDetail.json()).job as PredictionJob;
        const comparisons = page.locator('#forecast-result section').filter({has:page.getByRole('heading',{name:'基礎予想との比較'})});
        await comparisons.getByText(/比較元は/).waitFor();
        assert.match(await comparisons.getByRole('row',{name:/6号艇/}).innerText(), /-1ポイント/);
        await page.getByRole('heading',{name:'オッズと買い目を別に依頼'}).waitFor();
        const outcome=page.getByRole('region',{name:'確定結果との照合'});
        await outcome.getByText('1-2-3 · 4,321円').waitFor();
        assert.match(await outcome.innerText(), /展示後予想での順位\s+1位（1.83%）/);
        if(staged){
          assert.equal(exhibition.state, 'COMPLETED');
          assert.equal(exhibition.request.exhibitionOnly, true);
          assert.ok(exhibition.result);
          assert.equal(exhibition.result.odds, null);
          const exhibitionRows = resultRows(exhibition.result);
          assert.equal(exhibitionRows.length, 120);
          assert.deepEqual(await probabilityRows(page), exhibitionRows);
          const price=page.getByRole('button',{name:'オッズを取得して買い目を確認'});
          await price.waitFor();
          await price.click({trial:true});
          const budget=page.getByRole('textbox',{name:'予算（円・任意）',exact:true});
          await budget.fill('1');
          await price.click();
          await page.getByRole('alert').filter({hasText:'正の100円単位'}).waitFor();
          assert.equal(await page.locator('#forecast-job code').textContent(),exhibitionId);
          assert.equal(await page.locator('.probability-scroll tbody tr').count(),120);
          await budget.fill('');
          allowedPricePosts=1;
          const [accepted]=await Promise.all([
            page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===predictionsPath),
            price.click(),
          ]);
          assert.equal(accepted.status(),200);
          const {job}=await accepted.json();
          assert.notEqual(job.id, exhibitionId);
          assert.equal(job.request.oddsFromJobId, exhibitionId);
          assert.equal(allowedPricePosts,0);
          const available=staged.oddsAvailable;
          const priced=await completePrice(job,available);
          assert.equal(priced.state,available?'COMPLETED':'HELD');
          if (available) {
            assert.ok(priced.result);
            assert.deepEqual(priced.result.combinations, exhibition.result.combinations);
            assert.deepEqual(priced.result.probabilities, exhibition.result.probabilities);
            assert.deepEqual(priced.result.odds, Array.from({length: 120}, () => '10'));
            await page.getByText('保存した展示予想にオッズを反映', {exact: true}).waitFor();
            assert.deepEqual(await probabilityRows(page), resultRows(priced.result));
          } else {
            await page.getByText(/掲載されたオッズの更新時刻が予想に使える/).first().waitFor();
            assert.equal(await page.locator('#forecast-result').count(), 0);
          }

          await page.getByRole('button', {name: '元の展示予想を開く'}).click();
          await page.getByText('展示反映後の予想', {exact: true}).waitFor();
          assert.deepEqual(await probabilityRows(page), exhibitionRows);

          await page.close();
          const reopenedPage = await context.newPage();
          reopenedPage.setDefaultTimeout(15_000);
          await reopenedPage.goto(origin, {waitUntil: 'domcontentloaded'});
          await reopenedPage.locator('#viewer-token').fill(token);
          await reopenedPage.locator('.connection-panel form button[type=submit]').click();
          const readHistory = async () => {
            const [response] = await Promise.all([
              getResponse(reopenedPage, predictionsPath),
              reopenedPage.locator('#nav-predictions').click(),
            ]);
            assert.equal(response.status(), 200);
            const {items} = await response.json() as {items: PredictionJob[]};
            assert.equal(items.filter(item => item.id === exhibitionId && item.request.exhibitionOnly).length, 1);
            assert.equal(items.filter(item => item.id === job.id && item.request.oddsFromJobId === exhibitionId).length, 1);
          };
          await readHistory();
          await openHistoryJob(reopenedPage, predictionsPath, exhibition);
          const panel = reopenedPage.locator('#forecast-result');
          const exhibitionStage = panel.getByText('展示反映後の予想', {exact: true});
          const priceStage = panel.getByText('保存した展示予想にオッズを反映', {exact: true});
          await exhibitionStage.waitFor();
          assert.equal(await priceStage.count(), 0);
          assert.deepEqual(await probabilityRows(reopenedPage), exhibitionRows);

          await readHistory();
          await openHistoryJob(reopenedPage, predictionsPath, priced);
          if (available && priced.result) {
            await priceStage.waitFor();
            assert.equal(await exhibitionStage.count(), 0);
            assert.deepEqual(await probabilityRows(reopenedPage), resultRows(priced.result));
            assert.ok(await reopenedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
          } else {
            await reopenedPage.locator('#forecast-job [data-job-state="HELD"]').waitFor();
            await reopenedPage.getByRole('button', {name: '元の展示予想を開く'}).waitFor();
            assert.equal(await panel.count(), 0);
          }
          console.log(`${name}: pricing ${priced.state} and the unchanged exhibition reopened separately from history`);
        }
        console.log(`${name}: race selection, all 120 result rows, and reopening the same job from history passed`);
      } finally {
        await context.close();
      }
    }
    assert.deepEqual(requestsBlocked, [], 'Browser issued only same-origin reads and the explicitly requested price job');
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

if(process.argv.includes('--staged')){
  for (const viewport of viewports) await run({viewport, oddsAvailable: true});
  await run({viewport: viewports[1], oddsAvailable: false});
}else await run();
