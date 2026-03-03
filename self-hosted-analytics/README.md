# Self-hosted visit tracking

This is a minimal first-party tracker for a static GitHub Pages site.

- `track.php`: receives a tiny pixel request and stores one row per visit in SQLite.
- `stats.php`: returns JSON summary (total visits, last 24h, top paths/referrers/countries/timezones).

## 1) DNS and hosting

Use your own PHP host (for example your existing webhotel) on a subdomain such as `stats.tulent.no`.

DNS example:

- `stats.tulent.no` `A` -> your PHP host IP

## 2) Deploy files

Upload these two files to the web root for `stats.tulent.no`:

- `track.php`
- `stats.php`

They will create and use `visits.sqlite` in the same directory automatically.

## 3) Optional stats endpoint protection

`stats.php` supports an optional API key.

- Set environment variable: `VISIT_STATS_KEY=your-secret`
- Read stats with: `https://stats.tulent.no/stats.php?key=your-secret`

If `VISIT_STATS_KEY` is not set, `stats.php` is public.

## 4) What is collected

Per request:

- timestamp
- IP
- optional country header from proxy/CDN (`CF-IPCountry` / `GEOIP_COUNTRY_CODE`)
- path
- referrer
- browser language
- browser timezone
- user agent
