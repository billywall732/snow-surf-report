# Snow and Surf Report

A morning snapshot of snow conditions at four ski resorts and surf conditions at four breaks, with a simple 1–5 "should I go?" rating for each.

**Live site:** https://billywall732.github.io/snow-surf-report/

![Screenshot of the Snow and Surf Report](docs/screenshot.png)
<!-- TODO: add a screenshot at docs/screenshot.png -->

- **Snow:** Mammoth Mountain, Big Bear / Snow Summit, Snowbird, Winter Park — new snow, base depth, a 4-day forecast and a 10-day snow-depth chart.
- **Surf:** El Porto, Redondo Beach, Malibu and Manasquan Inlet — waves, period, wind, water temperature, today's tide chart and the next high and low tides.

Plain HTML, CSS and JavaScript. No build step, no backend, no API keys, no dependencies.

## How it works

```
GitHub Action (every morning)          GitHub Pages
 └─ node scripts/fetch-report.mjs       └─ index.html
     ├─ calls the free public APIs          └─ fetch('data/report.json')
     ├─ computes the ratings                    └─ draws the cards and charts
     └─ writes data/report.json
```

1. **`.github/workflows/update-report.yml`** runs every day at 12:00 UTC (5 AM Pacific in summer, 4 AM in winter) and whenever you press **Run workflow** on the Actions tab.
2. It runs **`scripts/fetch-report.mjs`**, which reads the places in `config/locations.json`, fetches each data source, scores each place using `config/ratings.json`, and writes `data/report.json`.
3. If the report changed, the Action commits it, then publishes the site to GitHub Pages.
4. The page (`index.html` + `js/app.js`) loads `data/report.json` and draws everything in the browser.

**One broken source never breaks the page.** Every piece of data is stored as a block like:

```json
{ "status": "ok", "source": "noaa-ndbc", "fetchedAt": "2026-10-24T12:03:41Z", "data": { ... } }
{ "status": "unavailable", "source": "noaa-ndbc", "fetchedAt": "...", "reason": "HTTP 503 from www.ndbc.noaa.gov" }
```

If *every* source fails (for example the runner has no internet), the script keeps the previous report and the Action fails, so you get an email.

## Data sources

All free, no key required.

| Source | Used for |
|---|---|
| [Open-Meteo Forecast API](https://open-meteo.com/) | Mountain forecast (snowfall, temperature, wind), modelled snow depth, surf wind |
| [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api) | Modelled waves and sea temperature |
| [NOAA CO-OPS Tides & Currents](https://tidesandcurrents.noaa.gov/) | Tide predictions (Santa Monica 9410840, Manasquan Inlet 8532591) |
| [NOAA National Data Buoy Center](https://www.ndbc.noaa.gov/) | Measured waves and water temperature (buoys 46221, 46268, 44091) |
| [USDA NRCS SNOTEL (AWDB)](https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html) | Measured snow depth (stations 846:CA, 766:UT, 335:CO) |

Open-Meteo's free tier is for non-commercial use. Big Bear has no SNOTEL station within 250 km, so it shows Open-Meteo's *modelled* snow depth.

## Run it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
# 1. Fetch fresh data (takes a few seconds)
node scripts/fetch-report.mjs

# 2. Start a local web server
node scripts/serve.mjs

# 3. Open http://localhost:8000 in your browser. Ctrl+C stops the server.
```

You can't just double-click `index.html`: browsers block `fetch()` and JavaScript modules on `file://` pages, so the page has to be served over http.

## Changing places and ratings

- **Add or remove a place:** edit `config/locations.json`. Each resort needs coordinates, a time zone and (optionally) a SNOTEL station triplet. Each surf spot needs coordinates, the direction the beach faces (`beachFacingDeg`), a tide station ID and (optionally) a buoy ID.
- **Tune the ratings:** edit `config/ratings.json`. Every rating starts at 2 and gains or loses a point per rule; the reasons appear in `rating.factors` in the report.

## Project layout

```
index.html             the page
css/styles.css         styles (light + dark via CSS variables)
js/app.js              loads the report, builds tabs and cards
js/charts.js           inline-SVG charts and the rating bar
config/                places and rating thresholds
data/report.json       the latest report (written by the script)
scripts/fetch-report.mjs   builds the report
scripts/lib/           http helpers, time zones, ratings, one file per data source
scripts/serve.mjs      tiny local web server
.github/workflows/     the daily GitHub Action
```

## Planned

- A mountain-bike **trail conditions** tab (Laguna, Pasadena, Santa Monica, Simi Valley) based on recent rainfall — it becomes `sections.trails` in the report.
- An optional one-sentence **AI morning verdict** written by the Action via the Claude API, with the key stored as a GitHub Actions secret — it fills the `verdict` fields already in the report.

## License

[MIT](LICENSE)
