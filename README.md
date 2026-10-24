# Snow and Surf Report

A morning snapshot of snow conditions at every US Ikon and Epic Pass mountain (76 of them) and surf conditions at 52 US surf spots, with a simple 1–5 "should I go?" rating for each.

**Live site:** https://billywall732.github.io/snow-surf-report/

![Screenshot of the Snow and Surf Report](docs/screenshot.png)
<!-- TODO: add a screenshot at docs/screenshot.png -->

- **Snow:** all US mountains on the 2026/27 Ikon Pass (41) and Epic Pass (35 entries for 37 resorts; Boston Mills/Brandywine and Jack Frost/Big Boulder are combined). Pin up to 4 favorites to the top (saved in your browser), search and filter the full list by pass and area, open any mountain for a detailed view (7-day forecast, snow-depth chart, why it got its rating), and see them all on a map.
- **Surf:** 52 well-known public breaks from Southern California to Maine, Hawaii and the Gulf. Same features as the Snow tab (pin 4, search and filter by area, map, detail view), plus a tide chart for your pinned beaches. Each beach's detail view has an hour-by-hour wave chart, its own tide chart, the nearest buoy's latest reading and a compass showing the swell and wind against the way the beach faces.

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
| [NOAA CO-OPS Tides & Currents](https://tidesandcurrents.noaa.gov/) | Tide predictions (nearest station per beach in `config/locations.json`) |
| [NOAA National Data Buoy Center](https://www.ndbc.noaa.gov/) | Measured waves and water temperature (nearest reporting buoy per beach) |
| [OpenStreetMap](https://www.openstreetmap.org/) (Nominatim, Overpass) | Beach coordinates and the direction each beach faces, worked out once by `scripts/find-surf-stations.mjs` |
| [USDA NRCS SNOTEL (AWDB)](https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html) | Measured snow depth at western resorts (station per resort in `config/locations.json`) |
| [us-atlas](https://github.com/topojson/us-atlas) (US Census Bureau boundaries) | The US outline on the map, saved once into `js/us-map-data.js` |

Open-Meteo's free tier is for non-commercial use. SNOTEL only covers the western US and Alaska, so East Coast and Midwest mountains (and a few western ones with no station within 30 km, like Big Bear) show Open-Meteo's *modelled* snow depth, labelled as such. Resort coordinates come from Wikidata/Wikipedia (see `coordSource` in the config).

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

- **Add or remove a place:** edit `config/locations.json`. Each resort needs an id, name, state (`region`), area (West, Pacific NW, Rockies, Midwest or East), coordinates and a time zone. Leave out `snotel` and run `node scripts/find-snotel.mjs`: it picks the nearest active SNOTEL station within 30 km (or marks the resort as modelled). Check its choice. `snow.defaultPinned` sets the 4 mountains a first-time visitor sees.
- **Add a surf spot:** add an id, name, city, state (`region`), area, coordinates and time zone under `surf.spots`, then run `node scripts/find-surf-stations.mjs`. It fills in what's missing: the direction the beach faces (from the OpenStreetMap coastline, which always has the water on its right-hand side), the nearest NOAA tide station within 60 km, and the nearest buoy within 100 km that's currently reporting waves. Check its choices; anything you set by hand is left alone. `node scripts/find-surf-stations.mjs --check` compares hand-set facing directions with the coastline. `surf.defaultPinned` sets the 4 beaches a first-time visitor sees.
- **Tune the ratings:** edit `config/ratings.json`. Every rating starts at 2 and gains or loses a point per rule; the reasons appear in `rating.factors` in the report. `surf.profiles` gives each area its own idea of good wave size and period (Hawaii is bigger than the Gulf).

## Project layout

```
index.html             the page
css/styles.css         styles (light + dark via CSS variables)
js/app.js              starts the page: header, tabs, theme switch, footer
js/places.js           shared by both tabs: pins, list, filters, detail view, map
js/snow.js             Snow tab: mountain cards, filters and detail content
js/surf.js             Surf tab: beach cards, tide card, hourly chart, compass
js/ui.js               shared helpers (building elements, formatting)
js/charts.js           inline-SVG charts and the rating bar
js/map.js              the US map and its projection math
js/us-map-data.js      US outline (generated once from us-atlas)
js/background.js       animated snow / water backgrounds
config/                places and rating thresholds
data/report.json       the latest report (written by the script)
scripts/fetch-report.mjs   builds the report
scripts/lib/           http helpers, time zones, ratings, one file per data source
scripts/find-snotel.mjs  picks SNOTEL stations for new resorts
scripts/find-surf-stations.mjs  facing, tide station and buoy for new beaches
scripts/serve.mjs      tiny local web server
.github/workflows/     the daily GitHub Action
```

## Planned

- A mountain-bike **trail conditions** tab (Laguna, Pasadena, Santa Monica, Simi Valley) based on recent rainfall — it becomes `sections.trails` in the report.
- An optional one-sentence **AI morning verdict** written by the Action via the Claude API, with the key stored as a GitHub Actions secret — it fills the `verdict` fields already in the report.

## License

[MIT](LICENSE)
