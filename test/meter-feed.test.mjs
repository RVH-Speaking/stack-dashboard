import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { METER_ALIASES, METER_FEED_SCHEMA, METER_STALE_MS, meterMeasurementIsStale,
  parseMeterFeed } from '../scripts/lib/meter-feed.mjs';
import { meterFeedFromText } from '../scripts/lib/meter-feed-input.mjs';
import { renderMeter } from '../scripts/lib/meter-feed-view.mjs';
import { meterSnapshot } from '../scripts/build.mjs';
import { auditSchema, validate } from '../scripts/lib/validate.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/meter-feed/current.json', import.meta.url)));
const now = new Date('2026-09-10T09:01:00.000Z');
const parse = (raw, options = {}) => parseMeterFeed(raw, { now, ...options });

test('closed schema mirrors browser contract and exact seven required aliases', () => {
  assert.deepEqual(METER_FEED_SCHEMA, JSON.parse(readFileSync('data/meter-feed.schema.json')));
  assert.deepEqual(auditSchema(METER_FEED_SCHEMA), []);
  assert.deepEqual(validate(METER_FEED_SCHEMA, fixture()), []);
  for (const alias of METER_ALIASES) {
    const raw = fixture(); delete raw.lanes[alias]; assert.equal(parse(raw).available, false);
  }
  const raw = fixture(); raw.lanes.EXTRA = raw.lanes.CPT1; assert.equal(parse(raw).available, false);
  assert.throws(() => { METER_FEED_SCHEMA.additionalProperties = true; });
});

test('processor is optional, closed and becomes stale after twenty minutes without claiming overload', () => {
  const current = parse(fixture());
  assert.deepEqual(current.processor, { ...fixture().processor, freshness: 'CURRENT' });
  const old = parse(fixture(), { now: new Date('2026-09-10T09:20:00.001Z') }).processor;
  assert.equal(old.freshness, 'VEROUDERD');
  assert.equal(old.cpu_busy_percent, 42.5);
  assert.equal(old.load_1m_per_capacity, 0.45);
  assert.equal(old.overload, 'UNKNOWN');
  assert.equal(old.status_reason, 'STALE');
  const roundtrip = parse({ ...fixture(), processor: old }, { now: new Date('2026-09-10T09:21:00.000Z') }).processor;
  assert.equal(roundtrip.freshness, 'VEROUDERD');
  assert.equal(roundtrip.cpu_busy_percent, 42.5);
  const absent = fixture(); delete absent.processor;
  assert.equal(parse(absent).processor.freshness, 'UNKNOWN');
  assert.equal(parse(absent).processor.cpu_busy_percent, null);
});

test('processor unsupported, invalid or private input stays empty without affecting seven-lane shape', () => {
  for (const mutate of [
    raw => { raw.processor.status_reason = 'UNSUPPORTED'; raw.processor.capacity_cores = null; },
    raw => { raw.processor.host_alias = 'UNKNOWN'; },
    raw => { raw.processor.observed_at = '2026-09-10T09:01:01.000Z'; },
  ]) {
    const raw = fixture(); mutate(raw); const parsed = parse(raw);
    assert.equal(parsed.lanes.length, 7);
    assert.equal(parsed.processor.freshness, 'UNKNOWN');
    assert.equal(parsed.processor.cpu_busy_percent, null);
  }
  for (const [key, value] of [['hostname', 'private-host'], ['pid', 123], ['path', '/private/source']]) {
    const raw = fixture(); raw.processor[key] = value;
    const rendered = renderMeter(JSON.stringify(raw), { now });
    assert.ok(!rendered.includes(String(value)));
    assert.equal((rendered.match(/data-meter-lane=/g) ?? []).length, 7);
  }
});

test('empty malformed stale sources always render exactly seven fixed aliases', () => {
  for (const text of [null, '', '{', '{}', JSON.stringify(fixture())]) {
    const html = renderMeter(text, { now: new Date('2026-09-11T09:00:00.000Z') });
    assert.equal((html.match(/data-meter-lane=/g) ?? []).length, 7);
    for (const alias of METER_ALIASES) assert.ok(html.includes(`data-meter-lane="${alias}"`));
    assert.ok(!html.includes('data-meter-countdown'));
  }
});

test('freshness is lane-local; publication cannot renew old or future measurements', () => {
  const raw = fixture(); raw.lanes.CLAUDE1.last_success_at = '2026-09-09T09:00:00.000Z';
  raw.lanes.CPT1.last_success_at = '2026-09-11T09:00:00.000Z';
  const result = parse(raw);
  assert.equal(result.lanes[0].freshness, 'VEROUDERD');
  assert.equal(result.lanes[1].freshness, 'CURRENT');
  assert.equal(result.lanes[4].freshness, 'ONBEKEND');
  assert.equal(parse(raw, { fallback: true }).lanes[1].freshness, 'VEROUDERD');
  assert.ok(parse(raw, { now: new Date('invalid') }).lanes.every(l => l.freshness === 'ONBEKEND'));
});

test('lane freshness uses one cadence-aware inclusive twelve-minute boundary', () => {
  assert.equal(METER_STALE_MS, 720000);
  assert.equal(meterMeasurementIsStale('2026-09-10T09:00:00.000Z', Date.parse('2026-09-10T09:11:59.999Z')), false);
  assert.equal(meterMeasurementIsStale('2026-09-10T09:00:00.000Z', Date.parse('2026-09-10T09:12:00.000Z')), true);
  const raw = fixture();
  raw.published_at = '2026-09-10T09:05:30.000Z';
  assert.equal(parse(raw, { now: new Date('2026-09-10T09:05:30.000Z') }).lanes[0].freshness, 'CURRENT');
  assert.equal(parse(raw, { now: new Date('2026-09-10T09:10:00.000Z') }).lanes[0].freshness, 'CURRENT');
  const stale = parse(raw, { now: new Date('2026-09-10T09:12:00.000Z') }).lanes[0];
  assert.equal(stale.freshness, 'VEROUDERD');
  assert.equal(stale.windows[0].remaining_percent, 50);
  assert.equal(stale.windows[0].countdown_seconds, null);
});

test('binding mismatch and shared pools never produce a sum; Gemini products remain separate', () => {
  const raw = fixture(); raw.lanes.CPT1.source_kind = 'CLAUDE_SUBSCRIPTION';
  raw.lanes.CLAUDE1.identity_binding_status = 'MISMATCH';
  let result = parse(raw);
  assert.equal(result.lanes[4].windows[0].remaining_percent, null);
  assert.equal(result.lanes[0].freshness, 'ONBEKEND');
  assert.equal(result.total, undefined);
  assert.equal(result.lanes[1].windows[0].remaining_percent, 50);
  for (const product of ['GEMINI_API_KEY', 'GEMINI_CODE_ASSIST', 'GEMINI_VERTEX']) {
    raw.lanes.GEMINI1.source_kind = product;
    for (const binding of ['UNKNOWN', 'MISMATCH', 'PROVEN']) {
      raw.lanes.GEMINI1.identity_binding_status = binding;
      const lane = parse(raw).lanes[6];
      assert.equal(lane.source_kind, product);
      assert.equal(lane.freshness, 'ONBEKEND');
    }
  }
});

test('countdown requires current binding and strictly valid future reset', () => {
  const raw = fixture(); assert.equal(parse(raw).lanes[0].windows[0]?.countdown_seconds ?? null, 3540);
  raw.lanes.CLAUDE1.windows[0].reset_at = '2026-09-10T09:01:00.000Z';
  const expired = parse(raw).lanes[0].windows[0];
  assert.equal(expired.remaining_percent, null);
  assert.equal(expired.countdown_seconds, null);
  for (const reset of [null, '2026-09-10T08:00:00.000Z', '2026-09-10T09:01:00.000Z', '2026-02-30T10:00:00.000Z', 'tomorrow']) {
    raw.lanes.CLAUDE1.windows[0].reset_at = reset;
    assert.equal(parse(raw).lanes[0].windows[0]?.countdown_seconds ?? null, null);
  }
  assert.ok(!renderMeter(JSON.stringify(fixture()), { now: new Date('2026-09-10T09:12:00.000Z') }).includes('data-meter-countdown'));
});

test('private fields, free error text, paths, emails and tokens cannot be exported', () => {
  const probes = ['probe@example.invalid', '/private/meter/source', 'token-example-private-value', 'provider failed for private project'];
  for (const value of probes) {
    for (const field of ['identity_binding_status', 'source_kind', 'last_success_at', 'reset_at', 'remaining_percent', 'quota_group', 'email', 'provider_error']) {
      const raw = fixture(); raw.lanes.CPT2[field] = value;
      const text = JSON.stringify(raw);
      assert.equal(meterFeedFromText(text, { now }).available, false);
      assert.ok(!JSON.stringify(meterFeedFromText(text, { now })).includes(value));
      assert.ok(!renderMeter(text, { now }).includes(value));
    }
  }
  for (const value of [-1, 101, 0.5, '50', Infinity]) {
    const raw = fixture(); raw.lanes.CPT1.windows[0].remaining_percent = value;
    assert.equal(parse(raw).available, false);
  }
  assert.equal(meterFeedFromText(' '.repeat(32769)).available, false);
});

test('v1, malformed, oversized and additional fields fail atomically to seven UNKNOWN lanes', () => {
  const v1 = fixture(); v1.version = 1;
  const bad = [null, '{', JSON.stringify(v1), ' '.repeat(32769)];
  for (const location of ['root', 'lane', 'window']) {
    const raw = fixture();
    const target = location === 'root' ? raw : location === 'lane' ? raw.lanes.CPT1 : raw.lanes.CPT1.windows[0];
    target.private_account = 'never-export-this'; bad.push(JSON.stringify(raw));
  }
  for (const text of bad) {
    const feed = meterFeedFromText(text, { now });
    assert.equal(feed.available, false); assert.equal(feed.lanes.length, 7);
    assert.ok(feed.lanes.every(l => l.quality === 'UNKNOWN' && l.windows.length === 0));
    assert.ok(!renderMeter(text, { now }).includes('never-export-this'));
  }
});

test('every lane/window field rejects arbitrary private text in the wire and HTML', () => {
  for (const location of ['lane', 'window']) {
    const template = location === 'lane' ? fixture().lanes.CPT1 : fixture().lanes.CPT1.windows[0];
    for (const key of Object.keys(template)) {
      const raw = fixture();
      const target = location === 'lane' ? raw.lanes.CPT1 : raw.lanes.CPT1.windows[0];
      target[key] = 'private-probe@example.invalid';
      const text = JSON.stringify(raw);
      assert.equal(meterFeedFromText(text, { now }).available, false, `${location}.${key}`);
      assert.ok(!renderMeter(text, { now }).includes('private-probe'));
    }
  }
});

test('multiple windows keep renewal, credit expiry and reset separate without invented dates', () => {
  const raw = fixture(); const w = raw.lanes.CPT1.windows[0];
  w.subscription_renewal_at = '2026-10-01T00:00:00.000Z';
  w.credit_expires_at = '2026-11-01T00:00:00.000Z';
  raw.lanes.CPT1.windows.push({ ...w, window_alias: 'WEEKLY', remaining_percent: 25, reset_at: null });
  const lane = parse(raw).lanes[4];
  assert.equal(lane.windows.length, 2);
  assert.equal(lane.windows[0].countdown_seconds, 3540);
  assert.equal(lane.windows[1].countdown_seconds, null);
  assert.equal(lane.windows[1].remaining_percent, 25);
  assert.equal(lane.windows[1].subscription_renewal_at, w.subscription_renewal_at);
  assert.equal(lane.windows[1].credit_expires_at, w.credit_expires_at);
  const html = renderMeter(JSON.stringify(raw), { now });
  assert.ok(html.includes('Gewone week')); assert.ok(html.includes(w.credit_expires_at));
});

test('FABLE is a closed Claude-only weekly alias and remains historical across three rounds', () => {
  const at = new Date('2026-09-10T09:12:00.000Z');
  const raw = fixture();
  raw.lanes.CLAUDE1.windows.push({
    model_alias: 'FABLE', window_alias: 'WEEKLY', quota_group: 'LANE_LOCAL',
    remaining_percent: 37, reset_at: '2026-09-17T09:00:00.000Z',
    resets_remaining: null, subscription_renewal_at: null, credit_expires_at: null,
  });
  const current = parseMeterFeed(raw, { now });
  const currentFable = current.lanes[0].windows[1];
  assert.equal(currentFable.model_alias, 'FABLE');
  assert.equal(currentFable.window_alias, 'WEEKLY');
  assert.equal(currentFable.quota_group, 'LANE_LOCAL');
  assert.equal(currentFable.remaining_percent, 37);
  assert.ok(currentFable.countdown_seconds > 0);
  assert.doesNotMatch(renderMeter(JSON.stringify(raw), { now }), /FABLE|37%/);

  let text = JSON.stringify(raw);
  for (let round = 1; round <= 3; round++) {
    const wire = meterSnapshot(text, at);
    const fable = wire.lanes.CLAUDE1.windows[1];
    assert.equal(wire.lanes.CLAUDE1.quality, 'UNKNOWN', `round ${round}`);
    assert.equal(wire.lanes.CLAUDE1.reason, 'STALE', `round ${round}`);
    assert.equal(fable.model_alias, 'FABLE', `round ${round}`);
    assert.equal(fable.window_alias, 'WEEKLY', `round ${round}`);
    assert.equal(fable.quota_group, 'LANE_LOCAL', `round ${round}`);
    assert.equal(fable.remaining_percent, 37, `round ${round}`);
    assert.equal(fable.reset_at, '2026-09-17T09:00:00.000Z', `round ${round}`);
    assert.equal('countdown_seconds' in fable, false, `round ${round}`);
    text = JSON.stringify(wire);
    const parsed = meterFeedFromText(text, { now: at }).lanes[0].windows[1];
    assert.equal(parsed.remaining_percent, 37, `parsed round ${round}`);
    assert.equal(parsed.countdown_seconds, null, `parsed round ${round}`);
  }
});

test('reset credits and the neutral Spark alias survive current and stale validation without private limit ids', () => {
  const raw = fixture();
  for (const window of raw.lanes.CPT2.windows) window.resets_remaining = 0;
  raw.lanes.CPT1.windows[0].resets_remaining = 3;
  raw.lanes.CPT1.windows.push({ ...raw.lanes.CPT1.windows[0], model_alias: 'CODEX_SPARK',
    window_alias: 'WEEKLY', remaining_percent: 100, resets_remaining: 3 });
  const current = parse(raw);
  assert.equal(current.lanes[4].windows.find(w => w.model_alias === 'CODEX_SPARK').remaining_percent, 100);
  assert.equal(current.lanes[5].windows[0].resets_remaining, 0);
  const stale = parse(raw, { now: new Date('2026-09-10T09:12:00.000Z') });
  assert.equal(stale.lanes[4].windows[0].resets_remaining, 3);
  const html = renderMeter(JSON.stringify(raw), { now });
  assert.match(html, /CODEX_SPARK/);
  assert.match(html.match(/data-meter-lane="CPT2"[\s\S]*?<\/article>/)[0], /geen resetreserve/);
  assert.doesNotMatch(html, /codex_bengalfox|GPT-5\.3-Codex-Spark/);

  raw.lanes.CPT1.windows[1].model_alias = 'codex_bengalfox';
  assert.equal(parse(raw).available, false);
});

test('FABLE rejects non-Claude products, raw provider labels and arbitrary model text', () => {
  for (const alias of ['CPT1', 'GEMINI1']) {
    const raw = fixture(); raw.lanes[alias].windows[0].model_alias = 'FABLE';
    const parsed = parseMeterFeed(raw, { now });
    const lane = parsed.lanes[METER_ALIASES.indexOf(alias)];
    assert.equal(lane.reason, 'BINDING_MISMATCH');
    assert.equal(lane.windows[0].remaining_percent, null);
  }
  for (const unsafe of ['Current week (Fable)', 'private-provider/Fable', 'FABLE_OTHER']) {
    const raw = fixture(); raw.lanes.CLAUDE1.windows[0].model_alias = unsafe;
    const text = JSON.stringify(raw); const parsed = meterFeedFromText(text, { now });
    assert.equal(parsed.available, false);
    assert.doesNotMatch(JSON.stringify(parsed), /Current week|private-provider|FABLE_OTHER/);
    assert.doesNotMatch(renderMeter(text, { now }), /Current week|private-provider|FABLE_OTHER/);
  }
  const extra = fixture(); extra.lanes.CLAUDE1.windows[0].raw_provider_label = 'Current week (Fable)';
  assert.equal(parseMeterFeed(extra, { now }).available, false);
  assert.doesNotMatch(renderMeter(JSON.stringify(extra), { now }), /Current week \(Fable\)/);
});

test('shared pot conflicts suppress every participant, including mismatched source and age', () => {
  for (const field of ['remaining_percent', 'reset_at', 'subscription_renewal_at', 'credit_expires_at', 'source_kind', 'last_success_at']) {
    const raw = fixture();
    for (const alias of ['CLAUDE1', 'CLAUDE2']) raw.lanes[alias].windows[0].quota_group = 'SHARED_1';
    assert.equal(parse(raw).lanes[0].windows[0].remaining_percent, 50);
    if (field === 'source_kind') raw.lanes.CLAUDE2[field] = 'CODEX_SUBSCRIPTION';
    else if (field === 'last_success_at') raw.lanes.CLAUDE2[field] = '2026-09-10T08:59:00.000Z';
    else raw.lanes.CLAUDE2.windows[0][field] = field === 'remaining_percent' ? 49 : '2026-09-11T00:00:00.000Z';
    for (const lane of parse(raw).lanes.slice(0, 2)) {
      assert.equal(lane.quality, 'UNKNOWN', field);
      assert.equal(lane.windows[0].remaining_percent, null);
      assert.equal(lane.windows[0].countdown_seconds, null);
    }
    assert.equal(parse(raw).lanes[2].quality, 'VERIFIED');
  }
});

test('publication and latest failed attempt cannot promote an old successful measurement', () => {
  const raw = fixture(); const lane = raw.lanes.CPT1;
  raw.published_at = now.toISOString(); lane.attempted_at = now.toISOString();
  lane.last_success_at = '2026-09-10T08:00:00.000Z';
  const stale = parse(raw).lanes[4];
  assert.equal(stale.quality, 'UNKNOWN'); assert.equal(stale.reason, 'STALE');
  assert.equal(stale.windows[0].remaining_percent, 50);
  assert.equal(stale.windows[0].reset_at, '2026-09-10T10:00:00.000Z');
  assert.equal(stale.windows[0].countdown_seconds, null);
  lane.last_success_at = '2026-09-10T09:00:00.000Z'; lane.quality = 'ERROR'; lane.reason = 'SOURCE_ERROR';
  const failed = parse(raw).lanes[4];
  assert.equal(failed.quality, 'UNKNOWN'); assert.equal(failed.reason, 'SOURCE_ERROR');
  assert.equal(failed.windows[0].countdown_seconds, null);
});

test('stale proven observations remain historical while unknown and errors stay closed', () => {
  const raw = fixture();
  const stale = parse(raw, { now: new Date('2026-09-10T09:12:00.000Z') }).lanes[0];
  assert.equal(stale.freshness, 'VEROUDERD');
  assert.equal(stale.windows[0].remaining_percent, 50);
  assert.equal(stale.windows[0].reset_at, '2026-09-10T10:00:00.000Z');
  assert.equal(stale.windows[0].countdown_seconds, null);

  for (const alias of ['CPT1', 'GEMINI1']) {
    const changed = fixture();
    if (alias === 'CPT1') Object.assign(changed.lanes[alias], { quality: 'ERROR', reason: 'SOURCE_ERROR' });
    const lane = parse(changed).lanes[METER_ALIASES.indexOf(alias)];
    assert.equal(lane.freshness, 'ONBEKEND');
    assert.ok(lane.windows.every(window => window.remaining_percent === null && window.reset_at === null));
  }
});

test('published stale UNKNOWN-quality observations survive three build/parser rounds with processor', () => {
  const at = new Date('2026-09-10T09:10:00.000Z');
  let text = readFileSync(new URL('./fixtures/meter-feed/stale-published.json', import.meta.url), 'utf8');
  for (let round = 1; round <= 3; round++) {
    const parsed = meterFeedFromText(text, { now: at });
    assert.equal(parsed.available, true, `round ${round}`);
    assert.equal(parsed.processor.host_alias, 'LOCAL_HOST', `round ${round}`);
    assert.equal(parsed.processor.cpu_busy_percent, 42.5, `round ${round}`);
    for (const lane of parsed.lanes.slice(0, 6)) {
      assert.equal(lane.identity_binding_status, 'PROVEN', `${lane.alias} round ${round}`);
      assert.equal(lane.quality, 'UNKNOWN', `${lane.alias} round ${round}`);
      assert.equal(lane.reason, 'STALE', `${lane.alias} round ${round}`);
      assert.equal(lane.freshness, 'VEROUDERD', `${lane.alias} round ${round}`);
      assert.equal(lane.windows[0].remaining_percent, 50, `${lane.alias} round ${round}`);
      assert.equal(lane.windows[0].reset_at, '2026-09-10T10:00:00.000Z', `${lane.alias} round ${round}`);
      assert.equal(lane.windows[0].countdown_seconds, null, `${lane.alias} round ${round}`);
    }
    assert.equal(parsed.lanes[6].windows[0].remaining_percent, null);
    const html = renderMeter(text, { now: at, refreshStatus: 'active' });
    assert.match(html, /data-processor-status="CURRENT"/);
    assert.equal((html.match(/50%/g) ?? []).length, 12);
    assert.equal((html.match(/laatst gemeten/g) ?? []).length >= 6, true);
    assert.doesNotMatch(html, /data-meter-countdown/);
    text = JSON.stringify(meterSnapshot(text, at));
  }
});

test('stale roundtrip proof rejects source errors, binding failures and malformed observations', () => {
  const at = new Date('2026-09-10T09:10:00.000Z');
  const base = JSON.parse(readFileSync(new URL('./fixtures/meter-feed/stale-published.json', import.meta.url)));
  for (const mutate of [
    lane => { lane.reason = 'SOURCE_ERROR'; },
    lane => { lane.identity_binding_status = 'MISMATCH'; },
    lane => { lane.identity_binding_status = 'UNKNOWN'; },
    lane => { lane.source_kind = 'UNKNOWN'; },
    lane => { lane.limitation = 'UNKNOWN'; },
    lane => { lane.attempted_at = null; },
    lane => { lane.last_success_at = '2026-09-10T09:07:00.000Z'; },
  ]) {
    const raw = structuredClone(base); mutate(raw.lanes.CLAUDE1);
    const lane = parseMeterFeed(raw, { now: at }).lanes[0];
    assert.equal(lane.windows[0].remaining_percent, null);
    assert.equal(lane.windows[0].reset_at, null);
    assert.equal(lane.freshness, 'ONBEKEND');
  }
  for (const value of [-1, 101, 0.5, '50']) {
    const raw = structuredClone(base); raw.lanes.CLAUDE1.windows[0].remaining_percent = value;
    assert.equal(parseMeterFeed(raw, { now: at }).available, false);
  }
});

test('unproven Gemini never yields quota even when input asserts generic PROVEN', () => {
  for (const product of ['GEMINI_API_KEY', 'GEMINI_CODE_ASSIST', 'GEMINI_VERTEX']) {
    const raw = fixture(); Object.assign(raw.lanes.GEMINI1, { source_kind: product,
      identity_binding_status: 'PROVEN', quality: 'VERIFIED', reason: 'NONE', limitation: 'NONE' });
    Object.assign(raw.lanes.GEMINI1.windows[0], { remaining_percent: 90, reset_at: '2026-09-10T10:00:00.000Z' });
    const lane = parse(raw).lanes[6];
    assert.equal(lane.reason, 'BINDING_UNPROVEN'); assert.equal(lane.quality, 'UNKNOWN');
    assert.equal(lane.windows[0].remaining_percent, null); assert.equal(lane.windows[0].reset_at, null);
  }
});

test('invalid dates, duplicate windows and incorrect model bindings are closed', () => {
  for (const field of ['last_success_at', 'attempted_at']) {
    const raw = fixture(); raw.lanes.CPT1[field] = '2026-02-30T00:00:00.000Z';
    assert.equal(parse(raw).available, false);
  }
  const duplicate = fixture(); duplicate.lanes.CPT1.windows.push(duplicate.lanes.CPT1.windows[0]);
  assert.equal(parse(duplicate).available, false);
  const wrong = fixture(); wrong.lanes.CPT1.windows[0].model_alias = 'SONNET';
  assert.equal(parse(wrong).lanes[4].reason, 'BINDING_MISMATCH');
  assert.equal(parse(wrong).lanes[4].windows[0].remaining_percent, null);
});

test('expired reset suppresses old quota; stale source errors keep their original cause', () => {
  const raw = fixture(); raw.lanes.CPT1.windows[0].reset_at = '2026-09-10T09:00:30.000Z';
  assert.equal(parse(raw).lanes[4].windows[0].remaining_percent, null);
  Object.assign(raw.lanes.CPT1, { quality: 'ERROR', reason: 'SOURCE_ERROR', last_success_at: '2026-09-09T09:00:00.000Z' });
  assert.equal(parse(raw).lanes[4].reason, 'SOURCE_ERROR');
});
