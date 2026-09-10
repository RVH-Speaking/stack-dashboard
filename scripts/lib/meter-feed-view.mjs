import { meterFeedFromText } from './meter-feed-input.mjs';
/**
 * Reparse on every render so an old model cannot preserve a countdown.
 * `live=false` is the static-build route (render-cockpit.mjs -> scripts/build.mjs):
 * that HTML is written once and served unchanged for as long as it sits on disk, with
 * no script attached to re-evaluate it against the viewer's clock (F1). It must never
 * bake in a CURRENT label, a percentage or a relative countdown that reads correctly
 * only at build time and silently goes stale afterwards. `live=true` (the default,
 * used by the inert browser poller in meter-poll.mjs) re-renders on every tick against
 * the real clock, so a fresh CURRENT/percentage/countdown there stays accurate.
 */
export function renderMeter(text, { live = true, ...options } = {}) {
  const feed = meterFeedFromText(text, options);
  const rows = feed.lanes.map((lane) => {
    const freshness = live || lane.freshness !== 'CURRENT' ? lane.freshness : 'MOMENTOPNAME';
    const windows = lane.windows.map(w => {
      const percent = live && w.remaining_percent !== null ? `${w.remaining_percent}%` : 'ONBEKEND';
      const countdown = live && w.countdown_seconds !== null ? `<span data-meter-countdown>${w.countdown_seconds}s</span>` : 'ONBEKEND';
      return `<li>${w.model_alias} / ${w.window_alias} / ${w.quota_group}: ${percent}; reset over ${countdown}; abonnement ${w.subscription_renewal_at ?? 'ONBEKEND'}; credits ${w.credit_expires_at ?? 'ONBEKEND'}</li>`;
    }).join('');
    return `<tr data-meter-lane="${lane.alias}"><th scope="row">${lane.alias}</th><td>${freshness}</td><td>${lane.source_kind}</td><td>${lane.identity_binding_status}</td><td>${lane.quality} / ${lane.reason} / ${lane.limitation}</td><td>Bron: ${lane.last_success_at ?? 'ONBEKEND'}; poging: ${lane.attempted_at ?? 'ONBEKEND'}</td><td><ul>${windows || '<li>ONBEKEND</li>'}</ul></td></tr>`;
  });
  const notice = live ? 'Live actualisering niet geactiveerd.' : 'Momentopname bij het bouwen; geen live actualisering.';
  return `<div id="meter" role="region" aria-labelledby="meter-heading"><h3 id="meter-heading">METER</h3><p>Capaciteit per lane; gedeelde quota worden niet opgeteld. Publicatie: ${feed.published_at ?? 'ONBEKEND'}. ${notice}</p><table><thead><tr><th>Lane</th><th>Meting</th><th>Product</th><th>Binding</th><th>Bronstatus / fout / beperking</th><th>Bronmomenten</th><th>Vensters</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
