import { renderMeter } from './meter-feed-view.mjs';

/** Standalone shell; filters remain mounted while the shared poller replaces its view. */
export function renderMeterPage(text = null, { now = new Date(), assetVersion = null } = {}) {
  if (assetVersion !== null && !/^[a-f0-9]{16}$/.test(assetVersion)) throw new Error('METER_ASSET_VERSION_INVALID');
  const assetQuery = assetVersion === null ? '' : `?v=${assetVersion}`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="content-security-policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"><title>METER — capaciteit &amp; resets</title><style>
:root{color-scheme:dark;--bg:#0b111b;--panel:#131e2d;--line:#34455c;--muted:#b3c2d6;--text:#edf3fc;--accent:#8ce2cd}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,sans-serif}
a{color:var(--accent);text-underline-offset:5px}
a:hover{color:white}
a:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #f8d57d;outline-offset:5px}
main,.topnav,footer{width:min(1440px,100% - 48px);margin:auto}
.topnav{display:flex;justify-content:space-between;gap:20px;padding:26px 0;border-bottom:1px solid var(--line)}
.brand{letter-spacing:.22em;font-weight:800;color:var(--text)}
.hero{padding:52px 0 28px;max-width:800px}
.eyebrow{font-size:.75rem;letter-spacing:.16em;color:var(--accent);font-weight:700;margin:0 0 8px}
h1{font-size:clamp(2.5rem,6vw,4.5rem);line-height:1.05;letter-spacing:-.05em;margin:12px 0 24px}
h2{font-size:1.45rem;letter-spacing:-.025em;margin:0 0 18px}
h3{font-size:1.45rem;margin:0}
h4{font-size:1rem;margin:0}
h4 span{display:block;color:var(--muted);font-size:.78rem;letter-spacing:.05em}
p{color:var(--muted)}
.hero p{font-size:1.1rem}
.filters{display:flex;flex-wrap:wrap;gap:20px;padding:20px 0 30px}
.filters label{display:grid;gap:6px;font-size:.85rem;color:var(--muted)}
select{min-width:180px;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:12px;font:inherit}
.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.metric{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 24px}
.metric dt{font-size:.75rem;letter-spacing:.1em;color:var(--muted)}
.metric dd{font-size:2.6rem;font-weight:700;margin:8px 0 0;line-height:1.1}
dl{margin:0}
dl>div{margin:10px 0}
dt{color:var(--muted);font-size:.8rem}
dd{margin:3px 0;overflow-wrap:anywhere}
.source-times{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:20px 0 30px}
.source-times dd{font-size:.87rem}
.section-head{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
.processor{margin:10px 0 42px;padding:28px;border:1px solid #416075;border-radius:18px;background:radial-gradient(circle at 85% 10%,#18394a 0,transparent 38%),linear-gradient(145deg,#17283a,var(--panel))}
.processor-grid{display:grid;grid-template-columns:1.15fr repeat(2,1fr);gap:18px;margin-top:22px}
.processor-grid>dl,.processor-primary{min-width:0;padding:18px;border:1px solid var(--line);border-radius:12px;background:#101a28}
.processor-primary strong{display:block;font-size:2.7rem;line-height:1.05}
.processor-primary span,.processor-primary small{display:block;color:var(--muted);font-size:.78rem;margin-top:7px}
.lane-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
article{background:linear-gradient(145deg,#182638,var(--panel));border:1px solid var(--line);border-radius:16px;padding:24px;min-width:0}
.lane-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.badge{font-size:.68rem;font-weight:800;letter-spacing:.07em;border:1px solid var(--line);padding:5px 9px;border-radius:30px;color:#d2dbea}
.actueel{color:#a3f2d8;border-color:#458b79}
.verouderd{color:#ffda93;border-color:#a37d3b}
.lane-quotas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:18px}
.quota-summary{padding:14px;border:1px solid var(--line);border-radius:10px;background:#101a28;min-width:0}
.shared-warning,.source-limit{font-size:.72rem;color:var(--muted)}
.reset-warning{color:#ffda93;font-weight:700}.model-quota{margin-top:10px}
.renewal{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
.renewal>div:last-child{grid-column:1/-1}
.capacity{display:flex;align-items:baseline;gap:12px}
.capacity strong{font-size:1.9rem}
.capacity span{color:var(--muted);font-size:.8rem}
meter{display:block;width:100%;height:16px;margin:10px 0 20px;accent-color:var(--accent)}
meter::-webkit-meter-bar{background:#27364b;border:0;border-radius:6px}
meter::-webkit-meter-optimum-value{background:var(--accent)}
meter::-moz-meter-bar{background:var(--accent)}
.quota-summary dl{display:grid;grid-template-columns:1fr;gap:4px}
.quota-summary dd,.renewal dd{font-size:.78rem}
summary{cursor:pointer;padding:12px 0;color:var(--muted);font-size:.85rem}
details dl{font-size:.85rem}
.lower-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:24px;margin:40px 0}
.lower-grid>section{padding:28px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}
.timeline{list-style:none;padding:0}
.timeline li{display:grid;gap:4px;padding:16px 0 16px 20px;border-left:2px solid #5a8d90;border-bottom:1px solid var(--line)}
.timeline time,.timeline span{font-size:.85rem;color:var(--muted)}
footer{padding:32px 0 40px;color:var(--muted);font-size:.85rem}
[hidden]{display:none!important}
.skip{position:absolute;left:12px;top:-100px}
.skip:focus{top:12px;background:var(--bg);padding:12px;z-index:2}
@media(max-width:1100px){.lane-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.source-times{grid-template-columns:repeat(2,minmax(0,1fr))}
.processor-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:640px){main,.topnav,footer{width:calc(100% - 32px)}
.hero{padding-top:32px}
.lane-grid,.lower-grid,.lane-quotas,.renewal{grid-template-columns:1fr}
.renewal>div:last-child{grid-column:auto}
.metric{min-width:0;padding:14px 10px;overflow-wrap:anywhere}
.metric dd{font-size:2rem}
.metric dt{font-size:.62rem}
.metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.source-times{grid-template-columns:1fr}
.processor{padding:20px}.processor-grid{grid-template-columns:1fr}
.section-head{display:block}
.filters label{flex:1;min-width:0}
select{min-width:0;width:100%}
.topnav{font-size:.8rem;flex-wrap:wrap}
.topnav>*{min-width:0;overflow-wrap:anywhere}
article{padding:20px}
.lower-grid>section{padding:22px}
}

</style><script type="module" src="./meter-poll.mjs${assetQuery}" data-meter-poll></script></head><body><a class="skip" href="#main">Naar inhoud</a><nav class="topnav" aria-label="Paginanavigatie"><a href="./index.html">← Cockpit</a><span class="brand">METER</span><a href="./meter-feed.json" download="meter-feed.json">Download feed ↓</a></nav><main id="main"><header class="hero"><p class="eyebrow">CAPACITEIT &amp; CONTROLE</p><h1>Ruimte voor<br>je volgende stap.</h1><p>Zeven lanes, hun beschikbare capaciteit en de eerstvolgende resets. Gebaseerd op bronmetingen, met zichtbare grenzen aan wat we weten.</p></header><div class="filters" role="group" aria-label="Lane-filters"><label for="meter-family">Provider<select id="meter-family"><option>Alles</option><option>Claude</option><option>Codex</option><option>Gemini</option></select></label><label for="meter-status">Status<select id="meter-status"><option>Alles</option><option>ACTUEEL</option><option>VEROUDERD</option><option>ONBEKEND</option></select></label></div><noscript><p>Automatische refresh vereist JavaScript. Capaciteit en countdowns blijven ONBEKEND.</p></noscript>${renderMeter(text, { now, live: false })}</main><footer>Alleen gesaneerde aliases · bronmeting en publicatie zijn afzonderlijke momenten · tijden in UTC</footer></body></html>`;
}
