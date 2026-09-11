import { meterFeedFromText } from './meter-feed-input.mjs';

const UNKNOWN = 'ONBEKEND';
const label = value => value === 'UNKNOWN' || value == null ? UNKNOWN : value;
const time = value => value ? `<time datetime="${value}">${value.replace('T', ' ').replace('.000Z', ' UTC')}</time>` : UNKNOWN;
const detail = (name, value) => `<div><dt>${name}</dt><dd>${value}</dd></div>`;
const family = alias => alias.startsWith('CLAUDE') ? 'Claude' : alias.startsWith('CPT') ? 'Codex' : 'Gemini';
const modelFor = alias => alias.startsWith('CLAUDE') ? 'CLAUDE_ALL' : alias.startsWith('CPT') ? 'CODEX_ALL' : 'GEMINI_ALL';
const duration = seconds => `${Math.floor(seconds / 86400)}d ${Math.floor(seconds % 86400 / 3600)}u`;
const noDate = `${UNKNOWN} <span class="source-limit">· bron levert geen datum</span>`;

function errorCategory(lane) {
  if (lane.status === 'VEROUDERD') return 'VEROUDERD';
  if (ordinaryWindows(lane).some(window => window.remaining_percent === 0)) return 'QUOTA OP';
  if (lane.reason === 'NONE') return 'GEEN';
  if (/BINDING|ACCOUNT|AUTH/.test(lane.reason)) return 'LOGIN / ACCOUNT';
  if (/QUOTA|EXHAUST/.test(lane.reason)) return 'QUOTA OP';
  if (/SOURCE|PROVIDER|COLLECTOR/.test(lane.reason)) return 'PROVIDER';
  return UNKNOWN;
}

function ordinaryWindows(lane) {
  return lane.windows.filter(window => window.model_alias === modelFor(lane.alias));
}

function quotaSummary(lane, windowAlias, title) {
  const window = ordinaryWindows(lane).find(item => item.window_alias === windowAlias);
  const value = window?.remaining_percent;
  const available = value == null ? UNKNOWN : `${value}% beschikbaar`;
  const moment = value == null ? 'geen bewezen bronwaarde' : lane.status === 'VEROUDERD'
    ? `laatst gemeten · ${time(lane.last_success_at)}` : lane.status === 'ACTUEEL' ? 'actuele bronmeting' : 'geen bewezen meting';
  const resetLabel = lane.status === 'VEROUDERD' ? 'Reset volgens laatste meting (UTC)' : 'Reset (UTC)';
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
    const boundary = lane.freshness === 'CURRENT' && now - new Date(lane.last_success_at) >= 300000;
    const status = !live ? UNKNOWN : boundary ? 'VEROUDERD' : lane.freshness === 'CURRENT' ? 'ACTUEEL' : lane.freshness;
    return { ...lane, status, windows: lane.windows.map(window => status === 'ACTUEEL' ? window
      : status === 'VEROUDERD' ? { ...window, countdown_seconds: null }
        : { ...window, remaining_percent: null, countdown_seconds: null, reset_at: null,
          subscription_renewal_at: null, credit_expires_at: null }) };
  });
  const counts = ['ACTUEEL', 'VEROUDERD', UNKNOWN].map(status =>
    `<div class="metric"><dt>${status}</dt><dd>${lanes.filter(lane => lane.status === status).length}</dd></div>`).join('');
  const newest = lanes.map(lane => lane.last_success_at).filter(Boolean).sort().at(-1);
  const age = live && newest ? `${Math.max(0, Math.floor((now - new Date(newest)) / 1000))}s` : UNKNOWN;
  const refresh = !live ? 'Wacht op browsermeting' : refreshStatus === 'waiting' ? 'Eerste meting ophalen'
    : fallback ? 'Poll mislukt · automatisch herstel actief' : refreshStatus === 'active' ? 'Actief · iedere 5 seconden' : 'Live actualisering niet geactiveerd.';
  const eligible = lanes.flatMap(lane => {
    const session = ordinaryWindows(lane).find(window => window.window_alias === 'FIVE_HOUR');
    return lane.status === 'ACTUEEL' && session?.quota_group === 'LANE_LOCAL' && session.remaining_percent != null
      ? [{ alias: lane.alias, value: session.remaining_percent }] : [];
  }).sort((a, b) => b.value - a.value || a.alias.localeCompare(b.alias));
  const bestLane = eligible.length ? `${eligible[0].alias} · ${eligible[0].value}% beschikbaar` : UNKNOWN;
  const cards = lanes.map(lane => {
    const ordinary = ordinaryWindows(lane);
    const renewal = ordinary.find(window => window.subscription_renewal_at)?.subscription_renewal_at ?? null;
    const expiry = ordinary.find(window => window.credit_expires_at)?.credit_expires_at ?? null;
    return `<article data-meter-lane="${lane.alias}" data-family="${family(lane.alias)}" data-status="${lane.status}" aria-labelledby="lane-${lane.alias}">
      <header class="lane-head"><div><p class="eyebrow">${family(lane.alias)}</p><h3 id="lane-${lane.alias}">${lane.alias}</h3></div><span class="badge ${lane.status.toLowerCase()}">${lane.status}</span></header>
      <div class="lane-quotas">${quotaSummary(lane, 'FIVE_HOUR', 'Huidige sessie')}${quotaSummary(lane, 'WEEKLY', 'Gewone week')}</div>
      <p class="shared-warning">Gedeelde quota worden niet opgeteld.</p><dl class="renewal">${detail(lane.status === 'VEROUDERD' ? 'Abonnementsverlenging (laatst gemeten)' : 'Abonnementsverlenging', renewal ? time(renewal) : noDate)}${detail(lane.status === 'VEROUDERD' ? 'Creditverval (laatst gemeten)' : 'Creditverval', expiry ? time(expiry) : noDate)}${detail('API-kosten / credits', `${UNKNOWN} · bron levert geen kostengegevens`)}</dl>
      <details><summary>Bron, fout &amp; betrouwbaarheid</summary><dl>${detail('Foutcategorie', errorCategory(lane))}${detail('Brontype', label(lane.source_kind))}${detail('Bronkwaliteit', label(lane.quality))}${detail('Binding', label(lane.identity_binding_status))}${detail('Laatste succes', time(lane.last_success_at))}${detail('Laatste poging', time(lane.attempted_at))}${detail('Actuele fout', label(lane.reason))}${detail('Beperking', label(lane.limitation))}</dl></details></article>`;
  }).join('');
  const resets = lanes.flatMap(lane => ordinaryWindows(lane)
    .filter(window => lane.status === 'ACTUEEL' && window.reset_at && window.countdown_seconds != null)
    .map(window => ({ ...window, alias: lane.alias })))
    .sort((a, b) => a.reset_at.localeCompare(b.reset_at) || a.alias.localeCompare(b.alias));
  const calendar = resets.map(window => `<li><time datetime="${window.reset_at}">${window.reset_at.replace('T', ' ').replace('.000Z', ' UTC')}</time><strong>${window.alias}</strong><span>${window.window_alias} · <span data-meter-countdown>${duration(window.countdown_seconds)}</span></span></li>`).join('');
  return `<div id="meter"><section aria-labelledby="overview-heading"><h2 id="overview-heading">In één oogopslag</h2><p class="legend"><strong>Legenda:</strong> 100% = volledig beschikbaar · 0% = op / verbruikt.</p><dl class="metrics">${counts}</dl><dl class="source-times">${detail('Laatste publicatie', time(feed.published_at))}${detail('Nieuwste bronmeting', time(newest))}${detail('Meetleeftijd', age)}${detail('Automatische refresh', refresh)}${detail('Beste volgende lane', bestLane)}${detail('Trend / delta', `${UNKNOWN} · minimaal twee bewezen metingen nodig`)}${detail('Historie / export', '<a href="./meter-feed.json" download>Gesaneerde feed downloaden</a>')}</dl></section>
    ${processorPanel}<section aria-labelledby="lanes-heading"><div class="section-head"><h2 id="lanes-heading">Je zeven lanes</h2><p>Sessie en gewone week · % beschikbaar</p></div><div class="lane-grid">${cards}</div><p id="meter-filter-empty" hidden>Geen lanes voor deze selectie.</p></section>
    <div class="lower-grid"><section aria-labelledby="resets-heading"><p class="eyebrow">VOORUITKIJKEN</p><h2 id="resets-heading">Resetkalender</h2><p>Alleen actuele, toekomstige resets · UTC</p><ol class="timeline">${calendar || `<li>${UNKNOWN}</li>`}</ol></section><section aria-labelledby="health-heading"><p class="eyebrow">BETROUWBAARHEID</p><h2 id="health-heading">Metergezondheid</h2><dl>${detail('Feed', feed.available ? 'GELDIG' : UNKNOWN)}${detail('Verbinding', !live || refreshStatus === 'waiting' ? UNKNOWN : fallback ? 'VEROUDERD' : refreshStatus === 'active' ? 'BEREIKBAAR' : UNKNOWN)}${detail('Bronnen actueel', String(lanes.filter(lane => lane.status === 'ACTUEEL').length))}</dl><p>Na vijf minuten blijven bewezen percentages en resetdatums zichtbaar als laatst gemeten. De countdown stopt totdat een nieuwe bronmeting slaagt.</p></section></div></div>`;
}
