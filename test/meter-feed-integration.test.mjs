import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { VORIGE_HOSTING_EIGENAARS } from '../scripts/lib/org-migration.mjs';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createMeterPoller, startMeterPolling } from '../scripts/lib/meter-poll.mjs';
import { renderCockpit } from '../scripts/lib/render-cockpit.mjs';
import { renderMeterPage } from '../scripts/lib/render-meter-page.mjs';
import { renderMeter } from '../scripts/lib/meter-feed-view.mjs';
import { CLIENT_POLL_FILES, PUBLISH_ALLOWLIST, METER_POLL_FILES } from '../scripts/lib/publish-files.mjs';
const text = readFileSync('test/fixtures/meter-feed/current.json', 'utf8');
const instant = '2026-09-10T09:01:00.000Z';
const response = (body) => new Response(body);

test('METER ignores repository and owner overrides while other feeds retain them (offline gh)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meter-binding-'));
  try {
    writeFileSync(join(dir, 'gh'), `#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.METER_TEST_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log(JSON.stringify({ encoding: 'base64', content: Buffer.from(process.env.METER_TEST_BODY).toString('base64') }));
`, { mode: 0o700 });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const valid = JSON.parse(text); valid.published_at = null;
    for (const body of [JSON.stringify(valid), '{', JSON.stringify({ ...valid, private_field: 'B2_PRIVATE_SENTINEL' })]) {
      const calls = join(dir, 'calls.jsonl');
      writeFileSync(calls, '');
      const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import { collectMeterFeedRaw, collectCodeTickerFeedRaw } from './scripts/lib/collect.mjs';
        import { meterFeedFromText } from './scripts/lib/meter-feed-input.mjs';
        let helperArgs;
        await collectMeterFeedRaw({ readContents: async (...args) => { helperArgs = args; return null; } });
        const raw = await collectMeterFeedRaw();
        const parsed = meterFeedFromText(JSON.stringify(raw));
        await collectCodeTickerFeedRaw();
        console.log(JSON.stringify({ raw, helperArgs, qualities: parsed.lanes.map(lane => lane.quality) }));
      `], { encoding: 'utf8', env: { ...process.env,
        PATH: dir, DASHBOARD_OWNER: 'b2-alternative-owner', OWNER: 'b2-hostile-owner',
        DASHBOARD_CONTROL_REPO: 'b2-alternative-repo', METER_TEST_CALLS: calls, METER_TEST_BODY: body,
      } });
      const result = JSON.parse(output);
      assert.deepEqual(result.helperArgs, ['stack-control', 'CONTROL/FEEDS/meter-feed.json', 'dashboard-feeds']);
      assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [
        ['api', `repos/${VORIGE_HOSTING_EIGENAARS[0]}/stack-control/contents/CONTROL/FEEDS/meter-feed.json?ref=dashboard-feeds`],
        ['api', 'repos/b2-alternative-owner/b2-alternative-repo/contents/CONTROL/FEEDS/code-ticker-feed.json?ref=dashboard-feeds'],
      ]);
      if (body === JSON.stringify(valid)) assert.deepEqual(result.raw, valid);
      else {
        assert.equal(result.raw, null);
        assert.deepEqual(result.qualities, Array(7).fill('UNKNOWN'));
        assert.ok(!output.includes('B2_PRIVATE_SENTINEL'));
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cockpit has only navigation; standalone static page fails closed', () => {
  const cockpit = renderCockpit({ generatedAt: instant, sources: [] }, { now: new Date(instant) });
  assert.match(cockpit, /href=".\/meter.html"/);
  assert.doesNotMatch(cockpit, /data-meter-lane|meter-poll/);
  const html = renderMeterPage(text, { now: new Date(instant) });
  assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
  assert.doesNotMatch(html, /data-meter-countdown|50%|data-status="ACTUEEL"/);
  assert.match(renderMeter(text, { now: new Date(instant) }), /data-meter-countdown/);
});

test('browser poll uses fixed endpoint, no credentials, no redirects and reages between polls', async () => {
  let html; let current = new Date(instant); let calls = 0;
  const poll = createMeterPoller({ origin: 'https://meter.invalid', now: () => current,
    render: value => { html = value; }, fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'https://meter.invalid/meter-feed.json');
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store'); return response(text);
    } });
  assert.equal(calls, 0); assert.equal(await poll.pollOnce(), true);
  assert.ok(html.includes('data-meter-countdown'));
  current = new Date('2026-09-10T09:06:00.000Z'); poll.tick();
  assert.ok(!html.includes('data-meter-countdown')); assert.ok(html.includes('VEROUDERD'));
  assert.match(html, /50%[\s\S]*?laatst gemeten/);
});

test('poll errors, malformed and oversized bodies degrade cached data and hide provider errors', async () => {
  for (const mode of ['throw', 'http', 'invalid', 'oversized']) {
    let html; let count = 0;
    const poll = createMeterPoller({ origin: 'https://meter.invalid', now: () => new Date(instant),
      render: value => { html = value; }, fetchImpl: async () => {
        if (count++ === 0) return response(text);
        if (mode === 'throw') throw new Error('private provider failure');
        if (mode === 'http') return new Response('', { status: 503 });
        return response(mode === 'invalid' ? '{' : 'x'.repeat(32769));
      } });
    assert.equal(await poll.pollOnce(), true); assert.equal(await poll.pollOnce(), false);
    assert.ok(html.includes('VEROUDERD')); assert.ok(!html.includes('data-meter-countdown'));
    assert.match(html, /50%[\s\S]*?laatst gemeten/);
    assert.ok(!html.includes('private provider failure'));
    assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
  }
});

test('timeout degrades immediately; concurrent polls are refused; invalid origins rejected', async () => {
  let expire; let finish; let html;
  const poll = createMeterPoller({ origin: 'https://meter.invalid', render: value => { html = value; },
    setTimer: fn => { expire = fn; }, clearTimer: () => {},
    fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const pending = poll.pollOnce(); assert.equal(await poll.pollOnce(), false);
  expire(); assert.ok(html.includes('ONBEKEND')); finish(response(text));
  assert.equal(await pending, false);
  for (const origin of ['https://meter.invalid/path', 'https://a:b@meter.invalid', 'file:///tmp', 'https://meter.invalid?token=x']) {
    assert.throws(() => createMeterPoller({ origin }));
  }
});

test('browser import graph is local and executable without Node globals; publication includes the full METER graph', () => {
  const expected = ['meter-poll.mjs', 'meter-feed-input.mjs', 'meter-feed-view.mjs', 'meter-feed.mjs', 'validate.mjs'];
  const visited = new Set();
  function visit(name) {
    if (visited.has(name)) return; visited.add(name);
    const source = readFileSync(`scripts/lib/${name}`, 'utf8');
    assert.ok(!source.includes('node:'));
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('./')); visit(match[1].slice(2));
    }
  }
  visit('meter-poll.mjs'); assert.deepEqual([...visited].sort(), expected.sort());
  assert.ok(!CLIENT_POLL_FILES.includes('meter-poll.mjs'));
  assert.ok(PUBLISH_ALLOWLIST.includes('meter-feed.json'));
  assert.deepEqual([...METER_POLL_FILES].sort(), [...visited].sort());
  const script = `globalThis.process = undefined; globalThis.document = undefined; globalThis.fetch = () => { throw Error('unexpected network'); }; await import('./scripts/lib/meter-poll.mjs'); console.log('browser import inert: PASS');`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim(), 'browser import inert: PASS');
});


test('Pages subpath, empty/private feeds, stale and recovery replace exactly seven lanes atomically', async () => {
  let html; let body = text; let clock = new Date(instant);
  const poll = createMeterPoller({ origin: 'https://pages.invalid',
    pageUrl: 'https://pages.invalid/stack-dashboard/index.html?v=123', now: () => clock,
    render: value => { html = value; }, fetchImpl: async url => {
      assert.equal(url, 'https://pages.invalid/stack-dashboard/meter-feed.json');
      return response(body);
    } });
  for (const bad of ['', '{}', '{', JSON.stringify({ ...JSON.parse(text), email: 'private@example.invalid' })]) {
    body = bad; assert.equal(await poll.pollOnce(), false);
    assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
    assert.ok(!html.includes('data-meter-countdown'));
    assert.ok(!html.includes('private@'));
  }
  body = text; assert.equal(await poll.pollOnce(), true);
  assert.ok(html.includes('data-meter-countdown'));
  clock = new Date('2026-09-10T09:06:00.000Z'); poll.tick();
  assert.ok(!html.includes('data-meter-countdown'));
  const fresh = JSON.parse(text);
  for (const lane of Object.values(fresh.lanes)) { lane.last_success_at = clock.toISOString(); lane.attempted_at = clock.toISOString(); }
  fresh.lanes.GEMINI1.identity_binding_status = 'UNKNOWN';
  body = JSON.stringify(fresh); assert.equal(await poll.pollOnce(), true);
  assert.ok(html.includes('data-meter-countdown'));
  const gemini = html.match(/<article data-meter-lane="GEMINI1"[\s\S]*?<\/article>/)[0];
  assert.ok(gemini.includes('ONBEKEND')); assert.ok(!gemini.includes('data-meter-countdown'));
  assert.ok(!/<td>\d+%<\/td>/.test(gemini));
});

test('actual browser scheduler ticks during outages and retries with recovery backoff', async () => {
  let html; let current = new Date(instant); let fail = false; let calls = 0;
  const timers = new Map(); let id = 0;
  const setTimer = (fn, ms) => { timers.set(++id, { fn, ms }); return id; };
  const clearTimer = key => timers.delete(key);
  const run = async ms => {
    const entry = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(entry, `missing timer ${ms}`); timers.delete(entry[0]); await entry[1].fn();
  };
  const stop = startMeterPolling({ document: { getElementById: () => ({ set outerHTML(value) { html = value; } }) },
    location: { origin: 'https://pages.invalid', href: 'https://pages.invalid/project/' },
    now: () => current, setTimer, clearTimer, fetchImpl: async () => {
      calls++; if (fail) throw Error('private failure'); return response(text);
    } });
  assert.equal(calls, 0); await run(0); assert.ok(html.includes('data-meter-countdown'));
  fail = true; await run(5000); assert.ok(!html.includes('data-meter-countdown'));
  await run(10000); assert.ok([...timers.values()].some(t => t.ms === 20000));
  fail = false; await run(20000); assert.ok(html.includes('data-meter-countdown'));
  current = new Date('2026-09-10T09:06:00.000Z'); await run(1000);
  assert.ok(!html.includes('data-meter-countdown'));
  assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
  stop(); assert.equal(timers.size, 0);
});


test('partial streamed snapshot never replaces a subset of the seven lanes', async () => {
  let stream; let html; let renders = 0;
  const poll = createMeterPoller({ origin: 'https://pages.invalid', now: () => new Date(instant),
    render: value => { html = value; renders++; },
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) { stream = controller; } })),
  });
  poll.tick(); const initial = html; const pending = poll.pollOnce();
  await Promise.resolve();
  const bytes = new TextEncoder().encode(text); const split = Math.floor(bytes.length / 2);
  stream.enqueue(bytes.slice(0, split));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(renders, 1); assert.equal(html, initial);
  stream.enqueue(bytes.slice(split)); stream.close();
  assert.equal(await pending, true); assert.equal(renders, 2);
  assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
  assert.ok(html.includes('data-meter-countdown'));
});

test('Contents reader reuses fixed stack-control dashboard-feeds helper and closes all read failures', async () => {
  const { collectMeterFeedRaw } = await import('../scripts/lib/collect.mjs');
  const valid = JSON.parse(text); valid.published_at = null;
  const body = JSON.stringify(valid);
  const readContents = async (...args) => {
    assert.deepEqual(args, ['stack-control', 'CONTROL/FEEDS/meter-feed.json', 'dashboard-feeds']);
    return { text: body, size: Buffer.byteLength(body), tooLarge: false };
  };
  assert.deepEqual(await collectMeterFeedRaw({ readContents }), valid);
  for (const result of [null, {}, { text: null }, { text: body, tooLarge: true },
    { text: body, size: 32769 }, { text: body, size: -1 }, { text: 'x'.repeat(32769) },
    { text: '{' }, { text: JSON.stringify({ ...valid, version: 1 }) },
    { text: JSON.stringify({ ...valid, email: 'private@example.invalid' }) }]) {
    assert.equal(await collectMeterFeedRaw({ readContents: async () => result }), null);
  }
  assert.equal(await collectMeterFeedRaw({ readContents: async () => { throw Error('private-error'); } }), null);
});


test('METER source is private, frozen and contains only the four fixed route fields', async () => {
  const module = await import('../scripts/lib/collect.mjs');
  assert.ok(!Object.hasOwn(module, 'METER_SOURCE'));
  const source = readFileSync('scripts/lib/collect.mjs', 'utf8');
  const declaration = source.match(/^const METER_SOURCE = Object\.freeze\(\{[^}]+\}\);/m);
  assert.ok(declaration, 'one private frozen source declaration is required');
  const mapping = runInNewContext(`${declaration[0]}; METER_SOURCE`);
  assert.deepEqual(JSON.parse(JSON.stringify(mapping)), {
    owner: VORIGE_HOSTING_EIGENAARS[0], repo: 'stack-control',
    ref: 'dashboard-feeds', path: 'CONTROL/FEEDS/meter-feed.json',
  });
  assert.ok(Object.isFrozen(mapping));
  for (const key of Object.keys(mapping)) {
    assert.throws(() => { mapping[key] = 'hostile'; }, TypeError);
  }
});
