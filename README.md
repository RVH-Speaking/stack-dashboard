# stack-dashboard

Externe, zelfverversende statuspagina over de stack. **Weergave van bestaande canon — nooit een
tweede waarheid.** De generator leest, aggregeert, saneert en rendert; hij schrijft nergens iets
terug.

Live: **https://rvh-speaking.github.io/stack-dashboard/**

Dat adres volgt de eigenaar van deze repository en staat hier alleen als leesbare tekst. De
workflows en scripts leiden het zelf af uit `GITHUB_REPOSITORY` (`scripts/lib/repo-identity.mjs`),
zodat een overdracht naar een organisatie de publicatieketen niet stil op een verdwenen adres laat
kijken. Wat er bij de overdracht wél verandert zijn drie plaatsen die als één geheel omslaan:
`HOSTING_OWNER_OF_RECORD` in `scripts/lib/org-migration.mjs`, `DASHBOARD_REPOSITORY` in het
launchd-plist van de feedgenerator, en de regel hierboven. De poort in `test/org-migration.test.mjs`
houdt die drie tegen elkaar en wijst daarnaast elke plaats aan die nog niet mee is — óók een
operationele verwijzing naar de vórige eigenaar die is blijven staan.

Deze stand hóórt bij de overdracht en loopt er niet op vooruit: zolang deze wijziging niet is
gemerged staat het dashboard nog onder het persoonlijke account. Wat er verder bij komt kijken —
wat met opzet níét meeverhuist, en hoe de lokaal geïnstalleerde feedgenerator wordt bijgetrokken —
staat in [`docs/ORG-CUTOVER.md`](docs/ORG-CUTOVER.md).

De afleiding kijkt bewust alleen naar `GITHUB_REPOSITORY` en naar een uitdrukkelijke
`DASHBOARD_REPOSITORY`, en niet naar de `origin` van je werkboom: die bewaart wat er bij het klonen
in stond, en GitHub blijft na een overdracht de oude naam doorverwijzen — een bestaande kloon zou
dus stilletjes het adres van een verdwenen host blijven opbouwen. Draai je een script als
`scripts/waarnemer.mjs` lokaal, zet dan zelf `DASHBOARD_REPOSITORY=owner/repo`; zonder dat stopt het
met een foutmelding in plaats van met een gok.

De publicatie bestaat uit vier vaste, scriptloze pagina's:

- `/` — rustige cockpit met echte ownerpoorten, bewijsbaar actief werk en incidentrollup;
- `/producten.html` — alle canonieke productfamilies en features, UNKNOWN waar bewijs ontbreekt;
- `/stack-ticker.html` — gevalideerde lifecycle-events met expliciete freshness;
- `/contentstroom.html` — de bestaande volledige technische doorstroom-drill-down.

Statuspercentages worden niet berekend zolang niet iedere canonieke feature een gevalideerde
bronkoppeling heeft. Een ontbrekende of oude bron blijft zichtbaar `UNKNOWN` of `STALE`.

## Wat er op staat

| Sectie | Bron |
| --- | --- |
| Open pull requests per repo | GitHub search API, org-breed |
| Gemerged (7 dagen) | GitHub search API |
| Tracker — laatste updates + beslispunten | `stack-control` → `AUDIT-INPUT/stack-open-beslispunten.md` |
| Besluitenregister | `stack-control` → `CONTROL/DECISIONS.md` |
| Vloot — laatste wijziging per track | `stack-control` → `CONTROL/TASK-QUEUE/` (commitdatum) |
| Journaal — laatste entries | `stack-control` → `CONTROL/FABLE-JOURNAAL.md` |
| CI-ampels | GitHub Actions API |
| Roadmap — 19 workstreams | `data/workstreams.json` (handmatig vastgelegd) |

De roadmapsectie vervangt de losse handmatige roadmap-refreshes.

**Wat je er níét op ziet: de tekst zelf.** De pagina toont de structuur van de canon — nummers,
ID's, datums, statussen, aantallen — en houdt kopregels, besluitregels en journaalkoppen in. Dat is
geen omissie maar het ontwerp: dit is een openbare pagina en de canon is intern. Per sectie
vrijgeven kan, met de hand, in `data/publish-text.json`; de reden en de voorwaarde staan in
`docs/SECURITY.md` §3. Repo- en tracknamen werken net zo: allowlist in `data/public-repos.json` en
`data/public-tracks.json`, de rest wordt geteld en niet benoemd.

## Draaien

```sh
node --test 'test/*.test.mjs'   # tests
node scripts/build.mjs          # bouwt de vier pagina's + public/status.json
node scripts/check-public.mjs   # controleert de exacte publicatie-allowlist
open public/index.html
```

Vereist Node ≥ 20 en een ingelogde `gh`. Zonder org-breed leesrecht vallen de PR-secties terug op
`SOURCE_UNAVAILABLE` — zichtbaar leeg, nooit stilletjes groen.

Er is bewust **één** weg naar `public/`. De vroegere `--fixture`-modus sloeg de publieke reducer
over en schreef een bestand rechtstreeks naar de publicatiemap — een tweede, ongecontroleerde
build. Die is weg; `data/fixture.json` dient nu alleen de tests.

## Publicatie

GitHub Pages, gebouwd door `.github/workflows/publish.yml`: bij elke push naar `main` en
handmatig via *Run workflow*. De pagina haalt zichzelf opnieuw op met
`<meta http-equiv="refresh">`; er draait geen client-side JavaScript.

**De kwartiercron staat ingesteld maar vuurt hier niet.** Gemeten op 2026-07-23: na de merge van
#3 zijn de slots van 15:45, 16:00 en 16:15 alle drie leeg voorbijgegaan — nul runs met
`event=schedule`. Geen quotakwestie (publieke repo, onbeperkte minuten) en geen uitgeschakelde
workflow (`state=active`). Wat de meting bewijst: déze workflow werd in dat tijdvak niet gestart.
De oorzaak is niet los aangetoond; GitHub documenteert zelf dat geplande runs vertraagd en bij
drukte gedropt worden, met het hele uur als expliciet genoemd druk moment — en `*/15` raakt dat
eenmaal per uur. De cron blijft
staan — hij kost hier geen Actions-minuten en levert winst zodra hij wél aanslaat — maar hij telt
niet als garantie. De trigger die je zelf in de hand hebt:

```
gh workflow run publish.yml
```

Vanuit een kloon van deze repository; `gh` leidt het doelrepository zelf uit de `origin`-remote af,
zodat dit commando ook na een overdracht naar een organisatie ongewijzigd klopt.

Dat commando garandeert een *aanvraag*, niet dat build en deploy slagen — controleer de run.

Alle publieke pagina's zeggen dit ook zelf: geen interval beloven, en melden dat een oude stempel
betekent dat er sindsdien niets is gepubliceerd. `data/verboden-beloftes.json` houdt de
formuleringen bij die dat zouden ondermijnen; `test/publiekepaginas.test.mjs` toetst ze op de
gewone pagina én op de foutpagina in de workflow.

Zodra de autopilot-runner op de mini draait — die heeft al een waakvlam — kan die dit commando elk
kwartier aanroepen en de uitkomst nakijken. Dat is de echte fallback: een externe scheduler die
`workflow_dispatch` aanroept en zo nodig opnieuw probeert. Een tweede *schedule*-workflow zou niets
oplossen, want die hangt aan dezelfde GitHub-scheduler.

`public/` staat in `.gitignore` — de gegenereerde output wordt nooit gecommit, alleen als
Pages-artefact gedeployed.

## Veiligheid

De repo is **openbaar** op expliciet besluit van Richard (afwijking van de standaardregel
"nieuwe repo's privé", hardop benoemd). De verdediging is daarom in de eerste plaats *niet
meenemen* — vrije tekst en niet-vrijgegeven namen komen de publieke DTO niet in. Daaronder zit een
fail-closed **sanitize-gate** als vangnet, plus `gitleaks` op de output vóór elke publicatie.

De volgorde is opzettelijk: de gate herkent patronen, geen bedrijfsinhoud. Een dubbele review
bewees dat met een besluitregel over een klantovername die elke patroongate passeerde
(`docs/SECURITY.md` §3). Latere rondes vonden dezelfde probe terug via de roadmap, via een
foutmelding en via een workstreamnummer — vier keer hetzelfde patroon, elke keer een ander veld
dat tekst dóórgaf in plaats van afleidde.

Lees `docs/SECURITY.md` vóór je een collector toevoegt. Token-setup: `docs/TOKEN-SETUP.md`
(machine-recht — Richard voert dat zelf uit).

## Herkomst

Basis overgenomen uit het lokale Codex-artefact `stack-dashboard`
(`~/Documents/Stack-radar/stack-dashboard`, juli 2026), na inventarisatie:

- **Hergebruikt:** het snapshot-contract (`contracts/dashboard-snapshot.schema.json`) en de
  security-doctrine — met name het vertrouwensmodel waarin een mislukte ophaal `SOURCE_UNAVAILABLE`
  wordt in plaats van een gecachte groene stand. Dat idee is de kern die het waard was te bewaren.
- **Niet hergebruikt:** de code ernaast. Die was fixture-only (geen enkele `gh`-aanroep), zonder
  CI, zonder publicatiepad en zonder sanitize-gate. Als basis voor een openbare pagina was er meer
  te repareren dan te bewaren.

Het lokale artefact blijft staan als archief; er is geen parallel systeem — dit is de opvolger.

## Achtergrond

WS13 stond op 21-07-2026 op "geen dashboard". Richard heeft dat op 23-07-2026 herroepen; dit is de
uitvoering daarvan. Vastgelegd als DEC in `stack-control`.

METER heeft een afzonderlijk gesloten contract in `data/meter-feed.schema.json`.
`node scripts/build.mjs --meter-feed <lokaal-bestand>` consumeert uitsluitend dit
expliciete bestand; ontbrekende of ongeldige input toont altijd de zeven vaste
aliases CLAUDE1–CLAUDE4, CPT1, CPT2 en GEMINI1 als ONBEKEND. Geen ruwe feed,
bronpad, accountinformatie of providerfout wordt geëxporteerd.

Elke lane heeft een eigen `last_success_at`; na vijf minuten is de meting
VEROUDERD. Tijdstempels zijn canonieke UTC ISO-strings met milliseconden.
`published_at` is alleen publicatieleeftijd. Alleen CURRENT met PROVEN binding,
passend product en een geldige toekomstige reset krijgt een countdown. De
collector moet binding onafhankelijk bewijzen: een enum is geen authenticatie.
Gemini API-key, Code Assist en Vertex zijn afzonderlijke `source_kind`-waarden;
onbewezen binding blijft ONBEKEND. Percentages worden nooit opgeteld, ook niet
bij dezelfde gesloten `quota_group` (LANE_LOCAL, SHARED_1–SHARED_7 of UNKNOWN).

Hergebruik onderzocht: bestaande runtime-feed input/view/poll en validator;
METER gebruikt dezelfde validator en cockpit/sanitizepoort. Een eigen contract
is nodig omdat runtime vrije tekst en andere identiteiten toestaat. Geen nieuwe
afhankelijkheden of externe zoekactie: deze order is uitsluitend lokaal.

De standaard Pages-build schrijft één gesloten `meter-feed.json` met alle zeven
lanes en neemt de volledige browser-importboom op in de publicatie-allowlist.
De cockpit start `meter-poll.mjs`: same-origin, relatief aan de pagina (ook onder
`/stack-dashboard/`), zonder credentials of redirects. Polls zijn serieel, starten
om de vijf seconden en vertragen bij fouten tot maximaal zestig seconden. Een
afhankelijke tick elke seconde verwijdert verouderde countdowns, ook bij uitval.
Na een geldige nieuwe respons herstelt de weergave vanzelf. De volledige cockpit
herlaadt iedere 900 seconden, zodat polls en backoff niet elke tien seconden
worden afgebroken; overige statische panelen volgen die herlaadcadans. Zonder JavaScript
blijft de veilige statische momentopname zichtbaar.

Atomisch contract: een producer levert het volledige bestaande v1-feedobject
als één lokaal bestand via `--meter-feed`; de build leest het één keer en
reconstrueert uitsluitend de gesloten publieke velden. Ruwe input en afgeleide
countdowns worden nooit gekopieerd. De bestaande workflow uploadt en deployt de
volledige gecontroleerde publicatiemap als één Pages-artefact. Geen losse PUTs per
lane, geen tweede host of scheduler. De browser vervangt alle zeven rijen uit één
volledige respons. CDN-vertraging kan een oude snapshot opleveren; publicatietijd
vernieuwt daarom nooit een bronmeting.

De workflow heeft nog geen aangewezen producerbestand: de standaardfeed blijft
ONBEKEND. Deze lokale integratie voegt geen collector/providercall toe en bewijst
geen live deploy of verse quotadata. Publicatie/activatie en producerbinding blijven
aparte gates na CODEX1-review.

`renderMeter` onderscheidt `live` (default true, gebruikt door `meter-poll.mjs`
bij elke tick tegen de echte klok) van `live: false`, de vorm die
`render-cockpit.mjs` gebruikt voor de statische build. Een statisch artefact
wordt één keer geschreven en zonder script opnieuw tegen de klok van de kijker
geëvalueerd; het toont daarom nooit een CURRENT-label, percentage of relatieve
countdown, ook niet vlak na de build (F1,
`AUTOCODING_METER_EXACT_HEAD_REVIEW_CODEX1_V1_RECEIPT.md`). CURRENT wordt in de
statische route expliciet als MOMENTOPNAME getoond; percentage en countdown
vallen terug op ONBEKEND. VEROUDERD/ONBEKEND blijven ongewijzigd in beide
routes, dat zijn al fail-closed claims.

### Zelfstandige METER

`meter.html` is de aparte capaciteitspagina; de cockpit verwijst er alleen naar.
De bestaande Pages-build publiceert de pagina, dezelfde gesaneerde v2
`meter-feed.json` en de bestaande browsermodules in één artefact. Er is geen
nieuwe collector of hostingroute. De download bevat uitsluitend de gesloten DTO.

De zeven lane-kaarten zijn filterbaar op provider en status. Filters verbergen
kaarten visueel; de feed, globale tellers en resetkalender behouden alle lanes.
Resetkalender, abonnementen/credits en brongezondheid gebruiken uitsluitend
geverifieerde velden. Zonder historie staat er `ONVOLDOENDE METINGEN`; ontbrekende
waarden blijven `ONBEKEND`. Gemini blijft onbekend zolang de binding onbewezen is.
Alle datums tonen UTC; publicatie en bronmeting zijn afzonderlijk zichtbaar.

De statische pagina toont nooit actuele percentages of countdowns. In de browser
wordt dezelfde parser bij iedere seconde opnieuw toegepast, met een same-origin
poll iedere vijf seconden, timeout van acht seconden en begrensde retry-backoff.
Op vijf minuten bronleeftijd of bij polluitval verdwijnen capaciteit en countdowns;
verse geldige invoer herstelt zonder reload. Zonder JavaScript blijven waarden
onbekend. Provider- en statusfilters behouden hun selectie tijdens verversen.
