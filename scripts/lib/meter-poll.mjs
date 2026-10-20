/** Same-origin Pages consumer; all eight lanes are replaced from one response. */
import { meterFeedFromText, METER_MAX_BYTES } from './meter-feed-input.mjs';
import { renderMeter } from './meter-feed-view.mjs';

export function createMeterPoller({ origin, pageUrl = `${origin}/`, fetchImpl, render, now = () => new Date(),
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const url = new URL(origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) throw new Error('METER_ORIGIN_INVALID');
  const page = new URL(pageUrl);
  if (page.origin !== origin || page.username || page.password) throw new Error('METER_ORIGIN_INVALID');
  const endpoint = new URL('./meter-feed.json', page).href;
  let text = null;
  let fallback = false;
  let busy = false;
  const tick = () => render(renderMeter(text, { now: now(), fallback,
    refreshStatus: text === null && !fallback ? 'waiting' : 'active' }));
  async function pollOnce() {
    if (busy) return false;
    busy = true;
    const controller = new AbortController();
    const timer = setTimer(() => { fallback = true; tick(); controller.abort(); }, 8000);
    try {
      const response = await fetchImpl(endpoint, {
        signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
      if (!response.ok || !response.body?.getReader) throw new Error('METER_RESPONSE_INVALID');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let body = '';
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > METER_MAX_BYTES) { controller.abort(); throw new Error('METER_TOO_LARGE'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      if (controller.signal.aborted || !meterFeedFromText(body, { now: now() }).available) throw new Error('METER_INVALID');
      text = body;
      fallback = false;
      tick();
      return true;
    } catch {
      fallback = true;
      tick();
      return false;
    } finally { clearTimer(timer); busy = false; }
  }
  // startMeterPolling drives freshness separately from serial requests.
  return Object.freeze({ tick, pollOnce });
}

/** Filters change visibility only; the complete eight-lane response stays in memory/DOM. */
export function applyMeterFilters(doc) {
  const family = doc.getElementById('meter-family')?.value ?? 'Alles';
  const status = doc.getElementById('meter-status')?.value ?? 'Alles';
  let visible = 0;
  for (const card of doc.querySelectorAll?.('[data-meter-lane]') ?? []) {
    card.hidden = !((family === 'Alles' || card.dataset.family === family)
      && (status === 'Alles' || card.dataset.status === status));
    if (!card.hidden) visible++;
  }
  const empty = doc.getElementById('meter-filter-empty');
  if (empty) empty.hidden = visible !== 0;
}

/** Scheduler is injectable for offline browser tests; retries are serial and bounded. */
export function startMeterPolling({ document: doc, location, fetchImpl,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => new Date() }) {
  let stopped = false;
  let pollTimer; let tickTimer; let delay = 5000;
  const poller = createMeterPoller({ origin: location.origin, pageUrl: location.href,
    fetchImpl, now, setTimer, clearTimer,
    render: html => {
      const target = doc.getElementById('meter');
      if (!target) return;
      const opened = [...(target.querySelectorAll?.('details[open]') ?? [])]
        .map(node => node.closest('[data-meter-lane]').dataset.meterLane);
      const focusedLane = doc.activeElement?.closest?.('[data-meter-lane]')?.dataset.meterLane;
      target.outerHTML = html;
      for (const alias of opened) {
        const details = doc.querySelector?.(`[data-meter-lane="${alias}"] details`);
        if (details) details.open = true;
      }
      applyMeterFilters(doc);
      if (focusedLane) doc.querySelector?.(`[data-meter-lane="${focusedLane}"] summary`)?.focus({ preventScroll: true });
    },
  });
  const tick = () => {
    if (stopped) return;
    poller.tick(); tickTimer = setTimer(tick, 1000);
  };
  const poll = async () => {
    if (stopped) return;
    const ok = await poller.pollOnce();
    delay = ok ? 5000 : Math.min(60000, delay * 2);
    if (!stopped) pollTimer = setTimer(poll, delay);
  };
  const onFilter = event => {
    if (['meter-family', 'meter-status'].includes(event.target?.id)) applyMeterFilters(doc);
  };
  doc.addEventListener?.('change', onFilter);
  tick(); pollTimer = setTimer(poll, 0);
  return () => { doc.removeEventListener?.('change', onFilter); stopped = true; clearTimer(tickTimer); clearTimer(pollTimer); };
}

if (typeof document !== 'undefined' && document.querySelector('script[data-meter-poll]')) {
  startMeterPolling({ document, location: window.location, fetchImpl: window.fetch.bind(window) });
}
