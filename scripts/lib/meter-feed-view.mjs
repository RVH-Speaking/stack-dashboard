import { meterFeedFromText } from './meter-feed-input.mjs';
import { meterMeasurementIsStale } from './meter-feed.mjs';

const UNKNOWN = 'ONBEKEND';
const label = value => value === 'UNKNOWN' || value == null ? UNKNOWN : value;
const AMSTERDAM_ZONE = 'Europe/Amsterdam';
const amsterdamFormatter = new Intl.DateTimeFormat('nl-NL', {
  timeZone: AMSTERDAM_ZONE, day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const amsterdamZoneFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: AMSTERDAM_ZONE, timeZoneName: 'short',
});
export function formatAmsterdamTime(value) {
  if (!value) return UNKNOWN;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return UNKNOWN;
  const parts = Object.fromEntries(amsterdamFormatter.formatToParts(instant)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const zone = amsterdamZoneFormatter.formatToParts(instant)
    .find(part => part.type === 'timeZoneName')?.value ?? AMSTERDAM_ZONE;
  return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${zone}`;
}
const time = value => value
  ? `<time datetime="${value}">${formatAmsterdamTime(value)} <span class="zone">Amsterdam</span></time>` : UNKNOWN;
const detail = (name, value) => `<div><dt>${name}</dt><dd>${value}</dd></div>`;
const family = alias => alias.startsWith('CLAUDE') ? 'Claude' : alias.startsWith('CPT') ? 'Codex' : 'Gemini';
const modelFor = alias => alias.startsWith('CLAUDE') ? 'CLAUDE_ALL' : alias.startsWith('CPT') ? 'CODEX_ALL' : 'GEMINI_ALL';
const duration = seconds => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return [days ? `${days}d` : '', hours ? `${hours}u` : '', `${minutes}m`].filter(Boolean).join(' ');
};
const noDate = `${UNKNOWN} <span class="source-limit">· bron levert geen datum</span>`;

function errorCategory(lane) {
  if (lane.status === 'VEROUDERD') return 'VEROUDERD';
  if (ordinaryWindows(lane).some(window => window.remaining_percent === 0)) return 'QUOTA OP';
  if (lane.reason === 'NONE') return 'GEEN';
  if (lane.reason === 'BINDING_UNPROVEN') return 'ACCOUNTBINDING ONBEWEZEN';
  if (lane.reason === 'BINDING_MISMATCH') return 'ACCOUNTBINDING ONBEKEND';
  if (/QUOTA|EXHAUST/.test(lane.reason)) return 'QUOTA OP';
  if (/SOURCE|PROVIDER|COLLECTOR/.test(lane.reason)) return 'PROVIDER';
  return UNKNOWN;
}

function ordinaryWindows(lane) {
  return lane.windows.filter(window => window.model_alias === modelFor(lane.alias));
}

function sourceQuality(lane) {
  if (lane.status === 'ACTUEEL') return 'ACTUEEL';
  if (lane.status === 'VEROUDERD') return 'VEROUDERD';
  if (['SOURCE_ERROR', 'INVALID_FEED', 'INVALID_TIME', 'SHARED_POT_CONFLICT'].includes(lane.reason)) return 'FOUT';
  return UNKNOWN;
}

function availability(lane) {
  const windows = ordinaryWindows(lane);
  if (lane.status === 'VEROUDERD') return {
    state: 'VEROUDERD', title: 'Niet bevestigd', reason: 'Laatste quota is verouderd; actuele inzet is niet bevestigd.',
  };
  if (lane.status !== 'ACTUEEL' || lane.identity_binding_status !== 'PROVEN'
      || lane.quality !== 'VERIFIED') return {
    state: 'ONBEKEND', title: 'Niet bevestigd', reason: lane.identity_binding_status !== 'PROVEN'
      ? 'Accountbinding is niet bewezen.' : 'Een actuele providerquotameting ontbreekt.',
  };
  const expected = ['FIVE_HOUR', 'WEEKLY'].map(windowAlias =>
    windows.find(window => window.window_alias === windowAlias));
  if (expected.some(window => window?.remaining_percent === 0)) return {
    state: 'UITGEPUT', title: 'Niet inzetbaar', reason: 'Minstens één gemeten algemene limiet is op.',
  };
  if (expected.some(window => window?.remaining_percent == null)) return {
    state: 'ONBEKEND', title: 'Niet bevestigd', reason: 'Niet elk algemeen limietvenster heeft een bewezen bronwaarde.',
  };
  return {
    state: 'BESCHIKBAAR', title: 'Inzetbaar', reason: 'Alle gemeten algemene limieten hebben ruimte.',
  };
}

function unanimousDate(windows, field) {
  if (!windows.length || windows.some(window => window[field] == null)) return null;
  const values = new Set(windows.map(window => window[field]));
  return values.size === 1 ? windows[0][field] : null;
}

function quotaSummary(lane, windowAlias, title, modelAlias = modelFor(lane.alias)) {
  const window = lane.windows.find(item => item.model_alias === modelAlias && item.window_alias === windowAlias);
  const value = window?.remaining_percent;
  const available = value == null ? UNKNOWN : `${value}% beschikbaar`;
  const moment = value == null ? 'geen bewezen bronwaarde' : lane.status === 'VEROUDERD'
    ? `laatst gemeten · ${time(lane.last_success_at)}` : lane.status === 'ACTUEEL' ? 'actuele bronmeting' : 'geen bewezen meting';
  const resetLabel = lane.status === 'VEROUDERD' ? 'Reset volgens laatste meting' : 'Reset';
  const countdown = lane.status === 'ACTUEEL' && window?.countdown_seconds != null
    ? `<span data-meter-countdown>${duration(window.countdown_seconds)}</span>` : UNKNOWN;
  return `<section class="quota-summary" aria-label="${lane.alias} ${title}">
    <h4>${title}</h4><div class="capacity"><strong>${available}</strong><span>${moment}</span></div>
    ${value == null ? '' : `<meter min="0" max="100" value="${value}" aria-label="${lane.alias} ${title}: ${value} procent beschikbaar">${value}% beschikbaar</meter>`}
    <dl>${detail(resetLabel, window ? time(window.reset_at) : UNKNOWN)}${detail('Resterende tijd', countdown)}</dl></section>`;
}

/** Always reparse the closed v2 DTO. Static HTML never claims current capacity. */
export function renderMeter(text, { live = true, now = new Date(), fallback = false, refreshStatus } = {}) {
  const feed = meterFeedFromText(text, { now, fallback });
  const processor = live ? feed.processor : {
    ...feed.processor, host_alias: 'UNKNOWN', host_kind: 'UNKNOWN', observed_at: null,
    published_at: null, freshness: 'UNKNOWN', capacity_cores: null, cpu_busy_percent: null,
    busy_sample_seconds: null, load_1m_per_capacity: null, queue_pressure: 'UNKNOWN',
    overload: 'UNKNOWN', memory_pressure: 'UNKNOWN', measurement_mode: 'UNKNOWN', status_reason: 'INVALID_FEED',
  };
  const processorKnown = processor.freshness !== 'UNKNOWN';
  const processorMoment = processor.freshness === 'VEROUDERD'
    ? `laatst gemeten · ${time(processor.observed_at)}` : processor.freshness === 'CURRENT'
      ? 'actuele bronmeting' : 'geen bewezen meting';
  const cpuAvailable = processor.cpu_busy_percent == null ? null
    : Math.round((100 - processor.cpu_busy_percent) * 100) / 100;
  const processorValue = (value, suffix = '') => value == null ? UNKNOWN
    : `<strong>${value}${suffix}</strong><span>${processorMoment}</span>`;
  const processorPanel = `<section class="processor" aria-labelledby="processor-heading" data-processor-status="${processor.freshness}">
    <div class="section-head"><div><p class="eyebrow">PROCESSOR</p><h2 id="processor-heading">Rekenruimte van de host</h2></div><span class="badge ${processor.freshness === 'CURRENT' ? 'actueel' : processor.freshness.toLowerCase()}">${processor.freshness}</span></div>
    <div class="processor-grid"><div class="processor-primary"><p class="eyebrow">CPU BESCHIKBAAR</p>${processorValue(cpuAvailable, '% beschikbaar')}<small>${processor.cpu_busy_percent == null ? UNKNOWN : `${processor.cpu_busy_percent}% belasting`} · ${processor.busy_sample_seconds == null ? UNKNOWN : `${processor.busy_sample_seconds}s bemonsterd`}</small></div>
      <dl>${detail('CPU-belasting', processor.cpu_busy_percent == null ? UNKNOWN : `${processor.cpu_busy_percent}%`)}${detail('Capaciteit', processor.capacity_cores == null ? UNKNOWN : `${processor.capacity_cores} cores`)}${detail('Load / capaciteit', processor.load_1m_per_capacity == null ? UNKNOWN : String(processor.load_1m_per_capacity))}</dl>
      <dl>${detail('Wachtrij', label(processor.queue_pressure))}${detail('Status', processorKnown ? label(processor.overload) : UNKNOWN)}${detail('Meettijd', time(processor.observed_at))}</dl></div>
    <details><summary>PROCESSOR-bron &amp; betrouwbaarheid</summary><dl>${detail('Hostalias', label(processor.host_alias))}${detail('Hosttype', label(processor.host_kind))}${detail('Publicatie', time(processor.published_at))}${detail('Versheid', label(processor.freshness))}${detail('Meetmodus', label(processor.measurement_mode))}${detail('Geheugendruk', label(processor.memory_pressure))}${detail('Statusreden', label(processor.status_reason))}</dl></details></section>`;

  const lanes = feed.lanes.map(lane => {
    const boundary = lane.freshness === 'CURRENT'
      && meterMeasurementIsStale(lane.last_success_at, now.getTime());
    const status = !live ? UNKNOWN : boundary ? 'VEROUDERD' : lane.freshness === 'CURRENT' ? 'ACTUEEL' : lane.freshness;
    return { ...lane, status, windows: lane.windows.map(window => status === 'ACTUEEL' ? window
      : status === 'VEROUDERD' ? { ...window, countdown_seconds: null }
        : { ...window, remaining_percent: null, countdown_seconds: null, reset_at: null,
          resets_remaining: null, subscription_renewal_at: null, credit_expires_at: null }) };
  });
  const decisions = new Map(lanes.map(lane => [lane.alias, availability(lane)]));
  const counts = ['BESCHIKBAAR', 'UITGEPUT', 'VEROUDERD', 'ONBEKEND'].map(status =>
    `<div class="metric ${status.toLowerCase()}"><dt>${status}</dt><dd>${lanes.filter(lane => decisions.get(lane.alias).state === status).length}</dd></div>`).join('');
  const newest = lanes.map(lane => lane.last_success_at).filter(Boolean).sort().at(-1);
  const age = live && newest ? `${Math.max(0, Math.floor((now - new Date(newest)) / 1000))}s` : UNKNOWN;
  const refresh = !live ? 'Wacht op browsermeting' : refreshStatus === 'waiting' ? 'Eerste meting ophalen'
    : fallback ? 'Poll mislukt · automatisch herstel actief' : refreshStatus === 'active' ? 'Actief · iedere 5 seconden' : 'Live actualisering niet geactiveerd.';
  const ready = lanes.filter(lane => decisions.get(lane.alias).state === 'BESCHIKBAAR')
    .map(lane => lane.alias);
  const directCapacity = ready.length ? ready.join(', ') : 'GEEN';
  const cards = lanes.map(lane => {
    const decision = decisions.get(lane.alias);
    const ordinary = ordinaryWindows(lane);
    const renewal = unanimousDate(ordinary, 'subscription_renewal_at');
    const expiry = unanimousDate(ordinary, 'credit_expires_at');
    const resetCounts = new Set(ordinary.map(window => window.resets_remaining).filter(value => value !== null));
    const resetReserve = resetCounts.size === 1 ? [...resetCounts][0] : null;
    const resetReserveText = resetReserve === null ? UNKNOWN : resetReserve === 0
      ? '<span class="reset-warning">geen resetreserve</span>' : `${resetReserve} beschikbaar`;
    const spark = lane.windows.some(window => window.model_alias === 'CODEX_SPARK')
      ? `<section class="model-quota" aria-label="${lane.alias} aparte Spark-quota"><h4>Aparte modelquota: CODEX_SPARK</h4><p>Deze quota verandert de algemene inzetbaarheid hierboven niet.</p><div class="lane-quotas">${quotaSummary(lane, 'FIVE_HOUR', 'Spark sessie', 'CODEX_SPARK')}${quotaSummary(lane, 'WEEKLY', 'Spark week', 'CODEX_SPARK')}</div></section>` : '';
    return `<article data-meter-lane="${lane.alias}" data-family="${family(lane.alias)}" data-status="${lane.status}" data-availability="${decision.state}" aria-labelledby="lane-${lane.alias}">
      <header class="lane-head"><div><p class="eyebrow">${family(lane.alias)}</p><h3 id="lane-${lane.alias}">${lane.alias}</h3></div><span class="badge ${lane.status.toLowerCase()}">${lane.status}</span></header>
      <div class="decision ${decision.state.toLowerCase()}"><strong>${decision.title}</strong><span>${decision.reason}</span></div>
      <div class="lane-quotas">${quotaSummary(lane, 'FIVE_HOUR', 'Huidige sessie')}${quotaSummary(lane, 'WEEKLY', 'Gewone week')}</div>${spark}
      <dl class="source-proof">${detail('Accountbinding', label(lane.identity_binding_status))}${detail('Bronkwaliteit', sourceQuality(lane))}${detail('Laatste succesvolle bronmeting', time(lane.last_success_at))}${detail('Laatste meetpoging', time(lane.attempted_at))}${detail('Taakuitvoering bewezen', `${UNKNOWN} · niet aanwezig in deze feed`)}</dl>
      <p class="shared-warning">Vensters en modelquota worden nooit bij elkaar opgeteld.</p><dl class="renewal">${detail('Resetreserve', resetReserveText)}${detail(lane.status === 'VEROUDERD' ? 'Abonnementsverlenging (laatst gemeten)' : 'Abonnementsverlenging', renewal ? time(renewal) : noDate)}${detail(lane.status === 'VEROUDERD' ? 'Creditverval (laatst gemeten)' : 'Creditverval', expiry ? time(expiry) : noDate)}${detail('API-kosten / credits', `${UNKNOWN} · bron levert geen kostengegevens`)}</dl>
      <details><summary>Bron, fout &amp; betrouwbaarheid</summary><dl>${detail('Foutcategorie', errorCategory(lane))}${detail('Brontype', label(lane.source_kind))}${detail('Bronkwaliteit', label(lane.quality))}${detail('Binding', label(lane.identity_binding_status))}${detail('Laatste succes', time(lane.last_success_at))}${detail('Laatste poging', time(lane.attempted_at))}${detail('Actuele fout', label(lane.reason))}${detail('Beperking', label(lane.limitation))}</dl></details></article>`;
  }).join('');
  const resets = lanes.flatMap(lane => ordinaryWindows(lane)
    .filter(window => lane.status === 'ACTUEEL' && window.reset_at && window.countdown_seconds != null)
    .map(window => ({ ...window, alias: lane.alias })))
    .sort((a, b) => a.reset_at.localeCompare(b.reset_at) || a.alias.localeCompare(b.alias));
  const calendar = resets.map(window => `<li>${time(window.reset_at)}<strong>${window.alias}</strong><span>${window.window_alias} · <span data-meter-countdown>${duration(window.countdown_seconds)}</span></span></li>`).join('');
  return `<div id="meter"><section aria-labelledby="overview-heading"><h2 id="overview-heading">In één oogopslag</h2><p class="legend"><strong>Beslisregel:</strong> een account is pas inzetbaar als binding en bronmeting actueel zijn en geen gemeten algemene limiet op nul staat. Aparte modelquota tellen niet als algemene capaciteit.</p><dl class="metrics">${counts}</dl><dl class="source-times">${detail('Direct inzetbaar', directCapacity)}${detail('Laatste publicatie', time(feed.published_at))}${detail('Nieuwste bronmeting', time(newest))}${detail('Meetleeftijd', age)}${detail('Automatische refresh', refresh)}${detail('Trend / delta', `${UNKNOWN} · minimaal twee bewezen metingen nodig`)}${detail('Historie / export', '<a href="./meter-feed.json" download>Gesaneerde feed downloaden</a>')}</dl></section>
    ${processorPanel}<section aria-labelledby="lanes-heading"><div class="section-head"><h2 id="lanes-heading">Je zeven lanes</h2><p>Sessie en gewone week · % beschikbaar</p></div><div class="lane-grid">${cards}</div><p id="meter-filter-empty" hidden>Geen lanes voor deze selectie.</p></section>
    <div class="lower-grid"><section aria-labelledby="resets-heading"><p class="eyebrow">VOORUITKIJKEN</p><h2 id="resets-heading">Resetkalender</h2><p>Alleen actuele, toekomstige resets · Europe/Amsterdam</p><ol class="timeline">${calendar || `<li>${UNKNOWN}</li>`}</ol></section><section aria-labelledby="health-heading"><p class="eyebrow">BETROUWBAARHEID</p><h2 id="health-heading">Metergezondheid</h2><dl>${detail('Feed', feed.available ? 'GELDIG' : UNKNOWN)}${detail('Verbinding', !live || refreshStatus === 'waiting' ? UNKNOWN : fallback ? 'VEROUDERD' : refreshStatus === 'active' ? 'BEREIKBAAR' : UNKNOWN)}${detail('Bronnen actueel', String(lanes.filter(lane => lane.status === 'ACTUEEL').length))}</dl><p>Na twaalf minuten blijven bewezen percentages en resetdatums zichtbaar als laatst gemeten. De countdown stopt totdat een nieuwe bronmeting slaagt. Een verstreken reset bewijst nooit nieuwe ruimte zonder een nieuwe providerwaarneming.</p></section></div></div>`;
}
