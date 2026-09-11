import { meterFeedFromText } from './meter-feed-input.mjs';

const unknown = 'ONBEKEND';
const label = value => value === 'UNKNOWN' || value == null ? unknown : value;
const time = value => value ? `<time datetime="${value}">${value.replace('T', ' ').replace('.000Z', ' UTC')}</time>` : unknown;
const detail = (name, value) => `<div><dt>${name}</dt><dd>${value}</dd></div>`;
const family = alias => alias.startsWith('CLAUDE') ? 'Claude' : alias.startsWith('CPT') ? 'Codex' : 'Gemini';
const duration = seconds => `${Math.floor(seconds / 3600)}u ${Math.floor(seconds % 3600 / 60)}m ${seconds % 60}s`;

/** Always reparse the closed v2 DTO. Static HTML never claims current capacity. */
export function renderMeter(text, { live = true, now = new Date(), fallback = false, refreshStatus } = {}) {
  const feed = meterFeedFromText(text, { now, fallback });
  const lanes = feed.lanes.map(lane => {
    const boundary = lane.freshness === 'CURRENT' && now - new Date(lane.last_success_at) >= 300000;
    const status = !live ? unknown : boundary ? 'VEROUDERD'
      : lane.freshness === 'CURRENT' ? 'ACTUEEL' : lane.freshness;
    return { ...lane, status, windows: lane.windows.map(w => status === 'ACTUEEL' ? w
      : status === 'VEROUDERD' ? { ...w, countdown_seconds: null }
        : { ...w, remaining_percent: null, countdown_seconds: null, reset_at: null,
          subscription_renewal_at: null, credit_expires_at: null }) };
  });
  const counts = ['ACTUEEL', 'VEROUDERD', unknown].map(status =>
    `<div class="metric"><dt>${status}</dt><dd>${lanes.filter(l => l.status === status).length}</dd></div>`).join('');
  const newest = lanes.map(l => l.last_success_at).filter(Boolean).sort().at(-1);
  const age = live && newest ? `${Math.max(0, Math.floor((now - new Date(newest)) / 1000))}s` : unknown;
  const refresh = !live ? 'Wacht op browsermeting' : refreshStatus === 'waiting' ? 'Eerste meting ophalen'
    : fallback ? 'Poll mislukt · automatisch herstel actief' : refreshStatus === 'active' ? 'Actief · iedere 5 seconden' : 'Live actualisering niet geactiveerd.';
  const cards = lanes.map(lane => `<article data-meter-lane="${lane.alias}" data-family="${family(lane.alias)}" data-status="${lane.status}" aria-labelledby="lane-${lane.alias}">
    <header class="lane-head"><div><p class="eyebrow">${family(lane.alias)}</p><h3 id="lane-${lane.alias}">${lane.alias}</h3></div><span class="badge ${lane.status.toLowerCase()}">${lane.status}</span></header>
    <ul class="windows">${lane.windows.map(w => `<li><h4>${w.model_alias} <span>${w.window_alias}</span></h4><p class="quota">${w.quota_group} · gedeelde quota worden niet opgeteld</p>
      <div class="capacity"><strong>${w.remaining_percent === null ? unknown : `${w.remaining_percent}%`}</strong><span>${lane.status === 'VEROUDERD' && w.remaining_percent !== null ? `laatst gemeten · ${time(lane.last_success_at)}` : 'resterend'}</span></div>
      ${w.remaining_percent === null ? '' : `<meter min="0" max="100" value="${w.remaining_percent}" aria-label="${lane.alias} ${w.model_alias} ${w.window_alias} ${lane.status === 'VEROUDERD' ? 'laatst gemeten' : 'resterend'}">${w.remaining_percent}%</meter>`}
      <dl>${detail(lane.status === 'VEROUDERD' ? 'Reset volgens laatste meting (UTC)' : 'Reset (UTC)', time(w.reset_at))}${detail('Reset over', w.countdown_seconds === null ? unknown : `<span data-meter-countdown>${duration(w.countdown_seconds)}</span>`)}${detail(lane.status === 'VEROUDERD' ? 'Abonnementsverlenging volgens laatste meting' : 'Abonnementsverlenging', time(w.subscription_renewal_at))}${detail(lane.status === 'VEROUDERD' ? 'Creditverval volgens laatste meting' : 'Creditverval', time(w.credit_expires_at))}</dl></li>`).join('') || `<li>${unknown}</li>`}</ul>
    <details><summary>Bron &amp; betrouwbaarheid</summary><dl>${detail('Brontype', label(lane.source_kind))}${detail('Bronkwaliteit', label(lane.quality))}${detail('Binding', label(lane.identity_binding_status))}${detail('Laatste succes', time(lane.last_success_at))}${detail('Laatste poging', time(lane.attempted_at))}${detail('Actuele fout', label(lane.reason))}${detail('Beperking', label(lane.limitation))}</dl></details>
  </article>`).join('');
  const resets = lanes.flatMap(l => l.windows.filter(w => w.reset_at && w.countdown_seconds !== null).map(w => ({ ...w, alias: l.alias })))
    .sort((a, b) => a.reset_at.localeCompare(b.reset_at) || a.alias.localeCompare(b.alias));
  const calendar = resets.map(w => `<li><time datetime="${w.reset_at}">${w.reset_at.replace('T', ' ').replace('.000Z', ' UTC')}</time><strong>${w.alias}</strong><span>${w.model_alias} · ${w.window_alias}</span></li>`).join('');
  const subscriptions = lanes.map(l => `<li><strong>${l.alias}</strong><dl>${l.windows.map(w => detail(`${w.model_alias} / ${w.window_alias} · ${l.status === 'VEROUDERD' ? 'verlenging volgens laatste meting' : 'verlenging'}`, time(w.subscription_renewal_at)) + detail(l.status === 'VEROUDERD' ? 'Creditverval volgens laatste meting' : 'Creditverval', time(w.credit_expires_at))).join('') || detail('Abonnement / credits', unknown)}</dl></li>`).join('');
  return `<div id="meter"><section aria-labelledby="overview-heading"><h2 id="overview-heading">In één oogopslag</h2><dl class="metrics">${counts}</dl><dl class="source-times">${detail('Laatste publicatie', time(feed.published_at))}${detail('Nieuwste bronmeting', time(newest))}${detail('Meetleeftijd', age)}${detail('Automatische refresh', refresh)}</dl></section>
    <section aria-labelledby="lanes-heading"><div class="section-head"><h2 id="lanes-heading">Je zeven lanes</h2><p>Capaciteit per venster</p></div><div class="lane-grid">${cards}</div><p id="meter-filter-empty" hidden>Geen lanes voor deze selectie.</p></section>
    <div class="lower-grid"><section aria-labelledby="resets-heading"><p class="eyebrow">VOORUITKIJKEN</p><h2 id="resets-heading">Resetkalender</h2><p>Alle lanes · eerstvolgende resets · UTC</p><ol class="timeline">${calendar || `<li>${unknown}</li>`}</ol></section>
    <section aria-labelledby="health-heading"><p class="eyebrow">BETROUWBAARHEID</p><h2 id="health-heading">Metergezondheid</h2><dl>${detail('Feed', feed.available ? 'GELDIG' : unknown)}${detail('Verbinding', !live || refreshStatus === 'waiting' ? unknown : fallback ? 'VEROUDERD' : refreshStatus === 'active' ? 'BEREIKBAAR' : unknown)}${detail('Bronnen actueel', String(lanes.filter(l => l.status === 'ACTUEEL').length))}</dl><p>Na vijf minuten worden bewezen capaciteitswaarden als laatst gemeten getoond en stoppen countdowns. Een nieuwe publicatie maakt een oude bronmeting niet actueel.</p><h3>Trends</h3><p>ONVOLDOENDE METINGEN</p></section></div>
    <section aria-labelledby="subscriptions-heading"><h2 id="subscriptions-heading">Abonnementen &amp; credits</h2><p>Alle lanes · alleen aantoonbare datums</p><ul class="subscription-grid">${subscriptions}</ul></section></div>`;
}
