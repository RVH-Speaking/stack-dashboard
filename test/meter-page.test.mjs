import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderMeter } from '../scripts/lib/meter-feed-view.mjs';
import { renderMeterPage } from '../scripts/lib/render-meter-page.mjs';
import { applyMeterFilters } from '../scripts/lib/meter-poll.mjs';
import { assertPublishFiles, PUBLISH_ALLOWLIST } from '../scripts/lib/publish-files.mjs';
const text = readFileSync('test/fixtures/meter-feed/current.json', 'utf8');
const now = new Date('2026-09-10T09:01:00.000Z');

test('standalone has accessible mobile shell, navigation, filters and explicit unknown history', () => {
  const html = renderMeterPage(text, { now });
  for (const expression of [/lang="nl"/, /name="viewport"/, /@media\(max-width:640px\)/,
    /:focus-visible/, /<main id="main">/, /<h1>/, /<label for="meter-family">/, /<label for="meter-status">/,
    /download="meter-feed.json"/, /href=".\/index.html"/, /ONVOLDOENDE METINGEN/, /<noscript>/,
    /id="health-heading"/, /id="subscriptions-heading"/, /id="resets-heading"/]) assert.match(html, expression);
  assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
  assert.doesNotMatch(html, /data-meter-countdown|value="50"|50%/);
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
  assert.match(rule('.metrics'), /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(rule('.metric'), /min-width:0/);
  assert.match(rule('.metric'), /overflow-wrap:anywhere/);
  assert.doesNotMatch(css, /overflow(?:-x)?\s*:\s*(?:hidden|clip)/);
});

test('live overview separates publication from source and exposes all windows without totals', () => {
  const raw = JSON.parse(text);
  raw.published_at = '2026-09-10T09:00:30.000Z';
  raw.lanes.CLAUDE1.windows.push({ ...raw.lanes.CLAUDE1.windows[0], model_alias: 'OPUS', window_alias: 'WEEKLY',
    reset_at: '2026-09-10T09:45:00.000Z', subscription_renewal_at: '2026-10-01T00:00:00.000Z', credit_expires_at: '2026-10-02T00:00:00.000Z' });
  const html = renderMeter(JSON.stringify(raw), { now, refreshStatus: 'active' });
  assert.match(html, /<dt>ACTUEEL<\/dt><dd>6<\/dd>/);
  assert.match(html, /<dt>ONBEKEND<\/dt><dd>1<\/dd>/);
  assert.match(html, /Laatste publicatie[\s\S]*?09:00:30/);
  assert.match(html, /Nieuwste bronmeting[\s\S]*?09:00:00/);
  assert.match(html, /Meetleeftijd<\/dt><dd>60s/);
  assert.match(html, /OPUS <span>WEEKLY/);
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
});

test('five-minute boundary and reset transition stop capacity and calendar until fresh evidence', () => {
  const stale = renderMeter(text, { now: new Date('2026-09-10T09:05:00.000Z') });
  assert.match(stale, /<dt>VEROUDERD<\/dt><dd>6<\/dd>/);
  assert.doesNotMatch(stale, /<meter |data-meter-countdown/);
  const raw = JSON.parse(text);
  for (const lane of Object.values(raw.lanes)) lane.windows[0].reset_at = '2026-09-10T09:01:00.000Z';
  const expired = renderMeter(JSON.stringify(raw), { now });
  assert.doesNotMatch(expired, /<meter |data-meter-countdown/);
  assert.match(expired, /<ol class="timeline"><li>ONBEKEND/);
  assert.match(renderMeter(text, { now }), /data-meter-countdown/);
});

test('filters intersect provider and status, retain all lanes and handle empty selection', () => {
  const cards = [...renderMeter(text, { now }).matchAll(/data-meter-lane="([^"]+)" data-family="([^"]+)" data-status="([^"]+)"/g)]
    .map(m => ({ dataset: { meterLane: m[1], family: m[2], status: m[3] }, hidden: false }));
  const controls = { 'meter-family': { value: 'Alles' }, 'meter-status': { value: 'Alles' }, 'meter-filter-empty': {} };
  const doc = { getElementById: id => controls[id], querySelectorAll: () => cards };
  for (const [family, expected] of [['Alles', 7], ['Claude', 4], ['Codex', 2], ['Gemini', 1]]) {
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
  assert.equal(cards.length, 7);
  assert.equal(controls['meter-status'].value, 'ACTUEEL');
});

test('offline build publishes standalone endpoint through existing allowlist and workflow', async () => {
  const root = mkdtempSync(join(tmpdir(), 'meter-page-build-'));
  try {
    for (const name of ['scripts', 'data', 'contracts', 'package.json']) cpSync(name, join(root, name), { recursive: true });
    mkdirSync(join(root, 'offline'));
    writeFileSync(join(root, 'offline/gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(root, 'fixture.json'), readFileSync('test/fixtures/raw-snapshot.json'));
    writeFileSync(join(root, 'meter.json'), text);
    const output = execFileSync(process.execPath, ['scripts/build.mjs', '--fixture', 'fixture.json', '--meter-feed', 'meter.json'], {
      cwd: root, encoding: 'utf8', env: { PATH: join(root, 'offline') }, timeout: 30000,
    });
    assert.ok(output);
    await assertPublishFiles(join(root, 'public'));
    const cockpit = readFileSync(join(root, 'public/index.html'), 'utf8');
    const page = readFileSync(join(root, 'public/meter.html'), 'utf8');
    assert.doesNotMatch(cockpit, /data-meter-lane|meter-poll/);
    assert.match(cockpit, /href=".\/meter.html"/);
    assert.equal((page.match(/data-meter-lane=/g) ?? []).length, 7);
    assert.match(page, /src=".\/meter-poll.mjs"/);
    assert.doesNotMatch(page, /data-meter-countdown|50%/);
    assert.ok(PUBLISH_ALLOWLIST.includes('meter.html'));
    const workflow = readFileSync('.github/workflows/publish.yml', 'utf8');
    assert.match(workflow, /test -f public\/meter.html/);
    assert.match(workflow, /test -f public\/meter-feed.json/);
    assert.match(workflow, /data-meter-lane\|meter-poll/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
