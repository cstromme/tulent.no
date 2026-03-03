# tulent.no

Ei heilt enkel nettside som svarar pa eitt sporsmal:

**Kor tulent e det i Alesund i dag?**

Sida brukar ein offentlig hamneplan for a finne kva cruiseskip som faktisk er venta i Alesund den aktuelle dagen, og hentar deretter publiserte passasjertal som estimat. Resultatet blir skrive til `public/status.json`, og frontenden viser berre dagens dom.

## Korleis dataflyten fungerer

1. **Alesund havn** er kjelda for kva skip som er venta den dagen.
2. **CruiseTimetables** blir brukt for dagsspesifikke passasjertal.
3. **CruiseDig** blir brukt som fallback dersom dagssida manglar eller eit skip ikkje blir matchet.
4. **data/ship-capacities.json** fungerer som lokal reservecache for skip som allereie er kjende.

### Viktig presisering

Passasjertala er **om lag-tal**, ikkje fasit. Dei er brukte som eit praktisk anslag for kor mykje cruisepress byen kjem til a kjenne den dagen.

## Struktur

- `public/index.html` - sjolve sida
- `public/styles.css` - minimal styling
- `public/app.js` - les `status.json` og renderer sida
- `public/status.json` - generert dagsdata
- `scripts/update-status.mjs` - hentar kjelder og bygg `status.json`
- `.github/workflows/refresh-and-deploy.yml` - køyrer oppdatering kvar dag og deployar til GitHub Pages

## Kjor lokalt

Installer avhengigheiter:

```bash
npm install
```

Generer dagens status:

```bash
npm run update
```

Test for ein bestemt dato:

```bash
npm run update -- --date=2026-04-01
```

Etter det kan du serve `public/` med kva som helst enkel statisk webserver.

## GitHub Pages + custom domain

Prosjektet er sett opp for GitHub Pages via Actions.

### Du treng berre a gjere dette:

1. Legg repoet pa GitHub.
2. Slå pa **GitHub Pages** for repoet og vel **GitHub Actions** som source.
3. Peik `tulent.no` til GitHub Pages i DNS.
4. Pass pa at `public/CNAME` inneheld domenet ditt.

Workflowen:

- køyrer kvar dag kl. 04:00 UTC
- hentar nye data
- byggjer ny `status.json`
- deployar `public/`

## Ting du kan justere lett

I `scripts/update-status.mjs` kan du enkelt endre:

- tersklar for kva som er `LITT TULENT`, `TULENT`, `STEJKE TULENT`
- formuleringane i `PHRASES`
- kjelder eller fallback-logikk

## Kjelder som scriptet brukar

- Alesund havn mooringplan: `https://alesund.havn.no/skipstrafikk/mooringplan-cruise/`
- CruiseTimetables Alesund: `https://www.cruisetimetables.com/alesund-norway-cruise-ship-schedule.html`
- CruiseDig Alesund arrivals: `https://cruisedig.com/ports/alesund-norway/arrivals`

## Security

- Løysinga er statisk på web: berre filer under `public/` blir publisert til GitHub Pages.
- Ingen backend-køyring i produksjon og ingen runtime-hemmeligheiter er nødvendig for nettsida.
- Data blir bygd i GitHub Actions via `scripts/update-status.mjs` og skrivne til `public/status.json`.

## Enkel besøksstatistikk (sjølvhosta)

For enkel, first-party sporing utan tredjeparts analytics:

- Frontenden sender no ein liten pixel-request til `https://stats.tulent.no/track.php` per sidevisning.
- Legg `self-hosted-analytics/track.php` og `self-hosted-analytics/stats.php` på ein eigen PHP-host (til dømes `stats.tulent.no`).
- Les summering som JSON frå `https://stats.tulent.no/stats.php`.
- Sjå `self-hosted-analytics/README.md` for oppsett.

## Vidare forbetring om du vil ha meir presisjon

Dersom du seinare far tilgang til eit meir presist API med faktiske passasjerdata per anlop, er det berre a bytte ut passasjeroppslaget i `update-status.mjs`. Frontenden treng ikkje endrast.
