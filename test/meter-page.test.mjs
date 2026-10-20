import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { formatAmsterdamTime, renderMeter } from '../scripts/lib/meter-feed-view.mjs';
import { renderMeterPage } from '../scripts/lib/render-meter-page.mjs';
import { applyMeterFilters } from '../scripts/lib/meter-poll.mjs';
import { assertPublishFiles, PUBLISH_ALLOWLIST } from '../scripts/lib/publish-files.mjs';
const text = readFileSync('test/fixtures/meter-feed/current.json', 'utf8');
const now = new Date('2026-09-10T09:01:00.000Z');

test('standalone has accessible mobile shell, navigation, filters and explicit unknown history', () => {
  const html = renderMeterPage(text, { now });
  for (const expression of [/lang="nl"/, /name="viewport"/, /@media\(max-width:640px\)/,
    /:focus-visible/, /<main id="main">/, /<h1>/, /<label for="meter-family">/, /<label for="meter-status">/,
    /download="meter-feed.json"/, /href=".\/index.html"/, /<noscript>/, /Beslisregel:/,
    /Direct inzetbaar/, /Trend \/ delta/, /id="health-heading"/,
    /id="resets-heading"/]) assert.match(html, expression);
  assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 8);
  assert.doesNotMatch(html, /data-meter-countdown|value="50"|50%|42\.5%|LOCAL_HOST/);
  const staleStatic = renderMeterPage(text, { now: new Date('2026-09-10T09:06:00.000Z') });
  assert.doesNotMatch(staleStatic, /data-meter-countdown|value="50"|50%|data-status="VEROUDERD"/);
  assert.equal((staleStatic.match(/data-status="ONBEKEND"/g) ?? []).length, 8);
});

test('mobile layout permits shrinking without clipping navigation, filters or metrics', () => {
  const html = renderMeterPage(text, { now });
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const mobile = css.split('@media(max-width:640px){')[1];
  const rule = selector => mobile.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]+)\\}`))[1];
  assert.match(rule('.topnav'), /flex-wrap:wrap/);
  assert.match(rule('.topnav>*'), /min-width:0/);
  assert.match(rule('.topnav>*'), /overflow-wrap:anywhere/);
  assert.match(rule('.filters label'), /min-width:0/);
  assert.match(rule('select'), /min-width:0;width:100%/);
  assert.match(rule('.metrics'), /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(rule('.metric'), /min-width:0/);
  assert.match(rule('.metric'), /overflow-wrap:anywhere/);
  assert.doesNotMatch(css, /overflow(?:-x)?\s*:\s*(?:hidden|clip)/);
});

test('live overview separates publication, source, session and ordinary weekly capacity', () => {
  const raw = JSON.parse(text);
  raw.published_at = '2026-09-10T09:00:30.000Z';
  raw.lanes.CLAUDE1.windows[0].subscription_renewal_at = '2026-10-01T00:00:00.000Z';
  raw.lanes.CLAUDE1.windows[0].credit_expires_at = '2026-10-02T00:00:00.000Z';
  raw.lanes.CLAUDE1.windows.push({ ...raw.lanes.CLAUDE1.windows[0], model_alias: 'CLAUDE_ALL', window_alias: 'WEEKLY',
    reset_at: '2026-09-10T09:45:00.000Z', subscription_renewal_at: '2026-10-01T00:00:00.000Z', credit_expires_at: '2026-10-02T00:00:00.000Z' });
  const html = renderMeter(JSON.stringify(raw), { now, refreshStatus: 'active' });
  assert.match(html, /<dt>BESCHIKBAAR<\/dt><dd>1<\/dd>/);
  assert.match(html, /<dt>ONBEKEND<\/dt><dd>7<\/dd>/);
  assert.match(html, /Laatste publicatie[\s\S]*?10-09-2026 11:00:30/);
  assert.match(html, /Nieuwste bronmeting[\s\S]*?10-09-2026 11:00:00/);
  assert.match(html, /Meetleeftijd<\/dt><dd>60s/);
  assert.match(html, /Huidige sessie/);
  assert.match(html, /Gewone week/);
  assert.match(html, /50% beschikbaar/);
  assert.match(html, /2026-10-01T00:00:00.000Z/);
  assert.match(html, /2026-10-02T00:00:00.000Z/);
  assert.match(html, /<meter min="0" max="100" value="50"/);
  const calendar = html.match(/<ol class="timeline">([\s\S]*?)<\/ol>/)[1];
  const dates = [...calendar.matchAll(/datetime="([^"]+)"/g)].map(m => m[1]);
  assert.equal(dates.length, 7);
  assert.deepEqual(dates, [...dates].sort());
  const gemini = html.match(/<article data-meter-lane="GEMINI1"[\s\S]*?<\/article>/)[0];
  assert.match(gemini, /ONBEKEND/);
  assert.doesNotMatch(gemini, /<meter |data-meter-countdown/);
  assert.match(html, /data-processor-status="CURRENT"/);
  assert.match(html, /42.5%/);
  assert.match(html, /LOCAL_HOST/);
});

test('PROCESSOR stale retains measured capacity but suppresses current overload; UNKNOWN stays empty', () => {
  let html = renderMeter(text, { now: new Date('2026-09-10T09:20:00.001Z') });
  let panel = html.match(/<section class="processor"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /data-processor-status="VEROUDERD"/);
  assert.match(panel, /57.5% beschikbaar[\s\S]*?laatst gemeten/);
  assert.match(panel, /Status<\/dt><dd>ONBEKEND/);
  assert.doesNotMatch(panel, /OVERLOADED/);

  const raw = JSON.parse(text); delete raw.processor;
  html = renderMeter(JSON.stringify(raw), { now });
  panel = html.match(/<section class="processor"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /data-processor-status="UNKNOWN"/);
  assert.doesNotMatch(panel, /42.5%|LOCAL_HOST/);
  assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 8);
});

test('twelve-minute boundary labels historical capacity and reset while stopping countdown and calendar', () => {
  const before = renderMeter(text, { now: new Date('2026-09-10T09:11:59.999Z') });
  assert.match(before, /data-status="ACTUEEL"/);
  assert.match(before, /data-meter-countdown/);
  const stale = renderMeter(text, { now: new Date('2026-09-10T09:12:00.000Z') });
  assert.match(stale, /<dt>VEROUDERD<\/dt><dd>6<\/dd>/);
  assert.match(stale, /50%[\s\S]*?laatst gemeten · <time datetime="2026-09-10T09:00:00.000Z"/);
  assert.match(stale, /Reset volgens laatste meting/);
  assert.doesNotMatch(stale, /data-meter-countdown/);
  assert.match(stale, /<ol class="timeline"><li>ONBEKEND/);
  const raw = JSON.parse(text);
  for (const lane of Object.values(raw.lanes)) lane.windows[0].reset_at = '2026-09-10T09:01:00.000Z';
  const expired = renderMeter(JSON.stringify(raw), { now });
  assert.doesNotMatch(expired, /<meter |data-meter-countdown/);
  assert.match(expired, /<ol class="timeline"><li>ONBEKEND/);
  assert.match(renderMeter(text, { now }), /data-meter-countdown/);
});

test('stale reset transition keeps only an explicitly historical source value', () => {
  const raw = JSON.parse(text);
  raw.lanes.CLAUDE1.windows[0].reset_at = '2026-09-10T09:01:00.000Z';
  const html = renderMeter(JSON.stringify(raw), { now: new Date('2026-09-10T09:12:00.000Z') });
  const claude = html.match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(claude, /50%/);
  assert.match(claude, /laatst gemeten/);
  assert.match(claude, /Reset volgens laatste meting[\s\S]*?10-09-2026 11:01:00[\s\S]*?Amsterdam/);
  assert.match(claude, /Resterende tijd<\/dt><dd>ONBEKEND/);
  assert.doesNotMatch(claude, /data-meter-countdown|data-status="ACTUEEL"/);
});

test('compact lane cards expose only session and ordinary week, never FABLE or invented history', () => {
  const raw = JSON.parse(text);
  raw.lanes.CLAUDE1.windows[0].subscription_renewal_at = '2026-10-01T00:00:00.000Z';
  raw.lanes.CLAUDE1.windows[0].credit_expires_at = '2026-10-02T00:00:00.000Z';
  raw.lanes.CLAUDE1.windows.push({ ...raw.lanes.CLAUDE1.windows[0], model_alias: 'CLAUDE_ALL',
    window_alias: 'WEEKLY', remaining_percent: 80, reset_at: '2026-09-17T10:00:00.000Z',
    subscription_renewal_at: '2026-10-01T00:00:00.000Z', credit_expires_at: '2026-10-02T00:00:00.000Z' });
  raw.lanes.CLAUDE1.windows.push({ ...raw.lanes.CLAUDE1.windows[0], model_alias: 'FABLE',
    window_alias: 'WEEKLY', remaining_percent: 37, reset_at: '2026-09-18T10:00:00.000Z' });
  const current = renderMeter(JSON.stringify(raw), { now, refreshStatus: 'active' });
  const lane = current.match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /aria-label="CLAUDE1 Huidige sessie"/);
  assert.match(lane, /50% beschikbaar/);
  assert.match(lane, /aria-label="CLAUDE1 Gewone week"/);
  assert.match(lane, /80% beschikbaar/);
  assert.match(lane, /01-10-2026 02:00:00[\s\S]*?Amsterdam/);
  assert.match(lane, /02-10-2026 02:00:00[\s\S]*?Amsterdam/);
  assert.match(lane, /aria-label="CLAUDE1 Huidige sessie: 50 procent beschikbaar"/);
  assert.doesNotMatch(current, /FABLE|37%/);
  assert.match(current, /Direct inzetbaar<\/dt><dd>CLAUDE1/);
  assert.doesNotMatch(current, /Beste volgende lane/);
  assert.match(current, /Trend \/ delta<\/dt><dd>ONBEKEND · minimaal twee bewezen metingen nodig/);
  assert.match(current, /API-kosten \/ credits<\/dt><dd>ONBEKEND · bron levert geen kostengegevens/);

  const stale = renderMeter(JSON.stringify(raw), { now: new Date('2026-09-10T09:12:00.000Z') });
  const oldLane = stale.match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(oldLane, /80% beschikbaar[\s\S]*?laatst gemeten/);
  assert.match(oldLane, /Abonnementsverlenging \(laatst gemeten\)/);
  assert.match(oldLane, /Reset volgens laatste meting/);
  assert.doesNotMatch(stale, /data-meter-countdown|FABLE|37%/);
  assert.match(stale, /<ol class="timeline"><li>ONBEKEND/);

  const gemini = current.match(/<article data-meter-lane="GEMINI1"[\s\S]*?<\/article>/)[0];
  assert.match(gemini, /Foutcategorie<\/dt><dd>ACCOUNTBINDING ONBEWEZEN/);
  assert.doesNotMatch(gemini, /LOGIN/);
  assert.doesNotMatch(gemini, /<meter |% beschikbaar/);
  raw.lanes.CLAUDE2.windows[0].remaining_percent = 0;
  const exhausted = renderMeter(JSON.stringify(raw), { now }).match(/<article data-meter-lane="CLAUDE2"[\s\S]*?<\/article>/)[0];
  assert.match(exhausted, /0% beschikbaar/);
  assert.match(exhausted, /Foutcategorie<\/dt><dd>QUOTA OP/);
  raw.lanes.CLAUDE1.windows[1].subscription_renewal_at = '2026-10-03T00:00:00.000Z';
  const divergent = renderMeter(JSON.stringify(raw), { now }).match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(divergent, /Abonnementsverlenging<\/dt><dd>ONBEKEND[\s\S]*?bron levert geen datum/);
  assert.doesNotMatch(divergent, /01-10-2026 02:00:00|03-10-2026 02:00:00/);
  assert.equal((current.match(/data-meter-lane=/g) ?? []).length, 8);
});

test('fresh source proof exposes successful measurement, attempt and a usable decision separately', () => {
  const raw = JSON.parse(text);
  raw.lanes.CLAUDE1.windows.push({ ...raw.lanes.CLAUDE1.windows[0], window_alias: 'WEEKLY',
    reset_at: '2026-09-17T10:00:00.000Z' });
  const html = renderMeter(JSON.stringify(raw), { now, refreshStatus: 'active' });
  const lane = html.match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /data-availability="BESCHIKBAAR"/);
  assert.match(lane, /<strong>Inzetbaar<\/strong>/);
  assert.match(lane, /Accountbinding<\/dt><dd>PROVEN/);
  assert.match(lane, /Bronkwaliteit<\/dt><dd>ACTUEEL/);
  assert.match(lane, /Laatste succesvolle bronmeting[\s\S]*?10-09-2026 11:00:00/);
  assert.match(lane, /Laatste meetpoging[\s\S]*?10-09-2026 11:00:00/);
  assert.match(lane, /Taakuitvoering bewezen<\/dt><dd>ONBEKEND/);
});

test('failed attempt keeps an older success visible but never presents its quota as current', () => {
  const raw = JSON.parse(text);
  Object.assign(raw.lanes.CLAUDE1, {
    quality: 'ERROR', reason: 'SOURCE_ERROR', attempted_at: '2026-09-10T09:04:00.000Z',
  });
  const html = renderMeter(JSON.stringify(raw), { now: new Date('2026-09-10T09:05:00.000Z') });
  const lane = html.match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /data-availability="ONBEKEND"/);
  assert.match(lane, /Bronkwaliteit<\/dt><dd>FOUT/);
  assert.match(lane, /Laatste succesvolle bronmeting[\s\S]*?10-09-2026 11:00:00/);
  assert.match(lane, /Laatste meetpoging[\s\S]*?10-09-2026 11:04:00/);
  assert.doesNotMatch(lane, /50% beschikbaar|<meter /);
});

test('missing account binding remains unknown even when quota-shaped values are present', () => {
  const raw = JSON.parse(text);
  Object.assign(raw.lanes.CLAUDE1, {
    identity_binding_status: 'UNKNOWN', quality: 'UNKNOWN', reason: 'BINDING_UNPROVEN',
    limitation: 'BINDING_UNPROVEN',
  });
  const lane = renderMeter(JSON.stringify(raw), { now })
    .match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /data-availability="ONBEKEND"/);
  assert.match(lane, /Accountbinding<\/dt><dd>ONBEKEND/);
  assert.match(lane, /Accountbinding is niet bewezen/);
  assert.doesNotMatch(lane, /50% beschikbaar|<meter /);
});

test('zero ordinary week defeats a free short window and separate Spark quota', () => {
  const raw = JSON.parse(text);
  const base = raw.lanes.CPT1.windows[0];
  base.remaining_percent = 80;
  raw.lanes.CPT1.windows.push({ ...base, model_alias: 'CODEX_ALL', window_alias: 'WEEKLY',
    remaining_percent: 0, reset_at: '2026-09-17T10:00:00.000Z' });
  raw.lanes.CPT1.windows.push({ ...base, model_alias: 'CODEX_SPARK', window_alias: 'FIVE_HOUR',
    remaining_percent: 100 });
  raw.lanes.CPT1.windows.push({ ...base, model_alias: 'CODEX_SPARK', window_alias: 'WEEKLY',
    remaining_percent: 100, reset_at: '2026-09-17T10:00:00.000Z' });
  const html = renderMeter(JSON.stringify(raw), { now });
  const lane = html.match(/<article data-meter-lane="CPT1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /data-availability="UITGEPUT"/);
  assert.match(lane, /<strong>Niet inzetbaar<\/strong>/);
  assert.match(lane, /Gewone week[\s\S]*?0% beschikbaar/);
  assert.match(lane, /Aparte modelquota: CODEX_SPARK/);
  assert.match(lane, /verandert de algemene inzetbaarheid hierboven niet/);
  assert.doesNotMatch(html, /Direct inzetbaar<\/dt><dd>[^<]*CPT1/);
});

test('proven zero week stays exhausted when the general short window is absent', () => {
  const raw = JSON.parse(text);
  const base = raw.lanes.CPT1.windows[0];
  raw.lanes.CPT1.windows = [
    { ...base, model_alias: 'CODEX_ALL', window_alias: 'WEEKLY', remaining_percent: 0,
      reset_at: '2026-09-17T10:00:00.000Z' },
    { ...base, model_alias: 'CODEX_SPARK', window_alias: 'FIVE_HOUR', remaining_percent: 100 },
    { ...base, model_alias: 'CODEX_SPARK', window_alias: 'WEEKLY', remaining_percent: 100,
      reset_at: '2026-09-17T10:00:00.000Z' },
  ];
  const html = renderMeter(JSON.stringify(raw), { now });
  const lane = html.match(/<article data-meter-lane="CPT1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /data-availability="UITGEPUT"/);
  assert.match(lane, /Gewone week[\s\S]*?0% beschikbaar/);
  assert.match(lane, /Huidige sessie[\s\S]*?ONBEKEND/);
  assert.match(lane, /Aparte modelquota: CODEX_SPARK/);
});

test('missing reset date stays explicit without erasing a fresh measured percentage', () => {
  const raw = JSON.parse(text);
  raw.lanes.CLAUDE1.windows[0].reset_at = null;
  raw.lanes.CLAUDE1.windows.push({ ...raw.lanes.CLAUDE1.windows[0], window_alias: 'WEEKLY',
    reset_at: '2026-09-17T10:00:00.000Z' });
  const lane = renderMeter(JSON.stringify(raw), { now })
    .match(/<article data-meter-lane="CLAUDE1"[\s\S]*?<\/article>/)[0];
  assert.match(lane, /data-availability="BESCHIKBAAR"/);
  assert.match(lane, /50% beschikbaar/);
  assert.match(lane, /Reset<\/dt><dd>ONBEKEND/);
  assert.match(lane, /Resterende tijd<\/dt><dd>ONBEKEND/);
});

test('Amsterdam formatting converts each UTC instant once across date and DST boundaries', () => {
  assert.equal(formatAmsterdamTime('2026-01-31T23:30:00.000Z'), '01-02-2026 00:30:00 CET');
  assert.equal(formatAmsterdamTime('2026-06-30T22:30:00.000Z'), '01-07-2026 00:30:00 CEST');
  assert.equal(formatAmsterdamTime('2026-10-25T00:30:00.000Z'), '25-10-2026 02:30:00 CEST');
  assert.equal(formatAmsterdamTime('2026-10-25T01:30:00.000Z'), '25-10-2026 02:30:00 CET');
  assert.equal(formatAmsterdamTime('not-a-date'), 'ONBEKEND');
});

test('missing or invalid feed fields fail closed to eight unknown lanes', () => {
  for (const raw of [{ version: 2 }, { ...JSON.parse(text), published_at: 'invalid' }]) {
    const html = renderMeter(JSON.stringify(raw), { now });
    assert.match(html, /<dt>ONBEKEND<\/dt><dd>8<\/dd>/);
    assert.equal((html.match(/data-availability="ONBEKEND"/g) ?? []).length, 8);
    assert.doesNotMatch(html, /<meter |data-meter-countdown/);
  }
});

test('Codex reset reserve is compact, truthful for zero, and unknown when the provider omits it', () => {
  const raw = JSON.parse(text);
  raw.lanes.CPT1.windows[0].resets_remaining = 3;
  raw.lanes.CPT2.windows[0].resets_remaining = 0;
  const html = renderMeter(JSON.stringify(raw), { now });
  const cpt1 = html.match(/<article data-meter-lane="CPT1"[\s\S]*?<\/article>/)[0];
  const cpt2 = html.match(/<article data-meter-lane="CPT2"[\s\S]*?<\/article>/)[0];
  assert.match(cpt1, /Resetreserve<\/dt><dd>3 beschikbaar/);
  assert.match(cpt2, /Resetreserve<\/dt><dd><span class="reset-warning">geen resetreserve/);
  assert.doesNotMatch(cpt2, /GEBLOKKEERD|ACCOUNTBINDING ONBEWEZEN|QUOTA OP/);
  raw.lanes.CPT2.windows[0].resets_remaining = null;
  const unknown = renderMeter(JSON.stringify(raw), { now })
    .match(/<article data-meter-lane="CPT2"[\s\S]*?<\/article>/)[0];
  assert.match(unknown, /Resetreserve<\/dt><dd>ONBEKEND/);
});

test('filters intersect provider and status, retain all lanes and handle empty selection', () => {
  const cards = [...renderMeter(text, { now }).matchAll(/data-meter-lane="([^"]+)" data-family="([^"]+)" data-status="([^"]+)"/g)]
    .map(m => ({ dataset: { meterLane: m[1], family: m[2], status: m[3] }, hidden: false }));
  const controls = { 'meter-family': { value: 'Alles' }, 'meter-status': { value: 'Alles' }, 'meter-filter-empty': {} };
  const doc = { getElementById: id => controls[id], querySelectorAll: () => cards };
  for (const [family, expected] of [['Alles', 8], ['Claude', 4], ['Codex', 3], ['Gemini', 1]]) {
    controls['meter-family'].value = family; applyMeterFilters(doc);
    assert.equal(cards.filter(c => !c.hidden).length, expected);
  }
  controls['meter-status'].value = 'ACTUEEL'; applyMeterFilters(doc);
  assert.equal(cards.filter(c => !c.hidden).length, 0);
  assert.equal(controls['meter-filter-empty'].hidden, false);
  controls['meter-family'].value = 'Alles'; applyMeterFilters(doc);
  assert.equal(cards.filter(c => !c.hidden).length, 6);
  cards[0].dataset.status = 'VEROUDERD'; applyMeterFilters(doc);
  assert.equal(cards.filter(c => !c.hidden).length, 5);
  assert.equal(cards.length, 8);
  assert.equal(controls['meter-status'].value, 'ACTUEEL');
});

test('offline build publishes standalone endpoint through existing allowlist and workflow', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meter-page-build-'));
  try {
    for (const name of ['scripts', 'data', 'contracts', 'package.json']) cpSync(name, join(root, name), { recursive: true });
    mkdirSync(join(root, 'offline'));
    writeFileSync(join(root, 'offline/gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const buildFixture = JSON.parse(readFileSync('test/fixtures/raw-snapshot.json'));
    buildFixture.generatedAt = '2026-09-10T09:10:00.000Z';
    writeFileSync(join(root, 'fixture.json'), JSON.stringify(buildFixture));
    writeFileSync(join(root, 'meter.json'), readFileSync('test/fixtures/meter-feed/stale-published.json'));
    const output = execFileSync(process.execPath, ['scripts/build.mjs', '--fixture', 'fixture.json', '--meter-feed', 'meter.json'], {
      cwd: root, encoding: 'utf8', env: { PATH: join(root, 'offline') }, timeout: 30000,
    });
    assert.ok(output);
    await assertPublishFiles(join(root, 'public'));
    const cockpit = readFileSync(join(root, 'public/index.html'), 'utf8');
    const page = readFileSync(join(root, 'public/meter.html'), 'utf8');
    assert.doesNotMatch(cockpit, /data-meter-lane|meter-poll/);
    assert.match(cockpit, /href=".\/meter.html"/);
    assert.equal((page.match(/data-meter-lane=/g) ?? []).length, 8);
    const assetVersion = page.match(/src="\.\/meter-poll\.mjs\?v=([a-f0-9]{16})"/)?.[1];
    assert.ok(assetVersion);
    assert.match(page, /script-src 'self'/);
    assert.doesNotMatch(page, /https?:\/\//);
    for (const name of ['meter-poll.mjs', 'meter-feed-input.mjs', 'meter-feed-view.mjs', 'meter-feed.mjs']) {
      const module = readFileSync(join(root, 'public', name), 'utf8');
      for (const match of module.matchAll(/from ['"](\.\/[^'"]+\.mjs\?v=([a-f0-9]{16}))['"]/g)) {
        assert.equal(match[2], assetVersion, `${name}: ${match[1]}`);
      }
      assert.doesNotMatch(module, /from ['"]\.\/[^'"]+\.mjs['"]/, `${name} has an unversioned import`);
      assert.doesNotMatch(module, /from ['"]https?:\/\//);
    }
    assert.match(readFileSync(join(root, 'public/meter-poll.mjs'), 'utf8'),
      new RegExp(`meter-feed-input\\.mjs\\?v=${assetVersion}`));
    assert.match(readFileSync(join(root, 'public/meter-poll.mjs'), 'utf8'),
      new RegExp(`meter-feed-view\\.mjs\\?v=${assetVersion}`));
    assert.match(readFileSync(join(root, 'public/meter-feed-input.mjs'), 'utf8'),
      new RegExp(`meter-feed\\.mjs\\?v=${assetVersion}`));
    assert.equal((readFileSync(join(root, 'public/meter-poll.mjs'), 'utf8').match(/meter-feed\.json/g) ?? []).length, 1);
    const publicFeedText = readFileSync(join(root, 'public/meter-feed.json'), 'utf8');
    const publicFeed = JSON.parse(publicFeedText);
    for (const alias of ['CLAUDE1', 'CLAUDE2', 'CLAUDE3', 'CLAUDE4', 'CPT1', 'CPT2']) {
      assert.equal(publicFeed.lanes[alias].quality, 'UNKNOWN');
      assert.equal(publicFeed.lanes[alias].reason, 'STALE');
      assert.equal(publicFeed.lanes[alias].windows[0].remaining_percent, 50);
    }
    assert.equal(publicFeed.processor.host_alias, 'LOCAL_HOST');
    const live = renderMeter(publicFeedText, { now: new Date(buildFixture.generatedAt), refreshStatus: 'active' });
    assert.match(live, /data-processor-status="VEROUDERD"/);
    assert.match(live, /LOCAL_HOST/);
    assert.match(live, /42\.5%/);
    assert.match(live, /50%[\s\S]*?laatst gemeten/);
    assert.doesNotMatch(live, /data-meter-countdown/);
    assert.doesNotMatch(page, /data-meter-countdown|50%/);
    assert.ok(PUBLISH_ALLOWLIST.includes('meter.html'));
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
    assert.match(workflow, /test -f public\/meter.html/);
    assert.match(workflow, /test -f public\/meter-feed.json/);
    assert.match(workflow, /data-meter-lane\|meter-poll/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
