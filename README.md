# Snow and Surf Report

Hourly snow conditions at every US Ikon and Epic Pass mountain (76 of them) and surf conditions at 52 US surf spots, with a simple 1–5 "should I go?" rating for each.

**Live site:** https://billywall732.github.io/snow-surf-report/

![Screenshot of the Snow and Surf Report](docs/screenshot.png)
<!-- TODO: add a screenshot at docs/screenshot.png -->

- **Snow:** all US mountains on the 2026/27 Ikon Pass (41) and Epic Pass (35 entries for 37 resorts; Boston Mills/Brandywine and Jack Frost/Big Boulder are combined). Pin up to 4 favorites as a compact 2×2 grid of tiles at the top (saved in your browser), open the full list to search and filter it by pass and area, open any mountain for a detailed view (7-day forecast, snow-depth chart, why it got its rating), and see them all on a map.
- **Surf:** 52 well-known public breaks from Southern California to Maine, Hawaii and the Gulf. Same features as the Snow tab (pin 4, search and filter by area, map, detail view), plus a tide chart for your pinned beaches. Each beach's detail view has an hour-by-hour wave chart, its own tide chart, the nearest buoy's latest reading and a compass showing the swell and wind against the way the beach faces. Set your **level** and **board** to filter to beaches whose waves fit you, and see "For you" for today and the next two days in each detail view.
- **Profile (Rider Profile):** ski or snowboard, ski level (Beginner to Expert), what you're after (powder, groomers, parks, steeps), your pass, surf levels and boards, the coldest water you'll surf, and where you ride from (Use my location, rounded to about 7 miles, or a city) with how far you'll travel. It drives "Recommended for you" on Snow and Surf, "For you" in each detail view, and "near me" alerts. Snowboard-only riders never get skiers-only mountains (Alta, Deer Valley).
- **Notifications:** alert rules for snow coming to your mountains (pinned, chosen, or near me) and waves that fit your level and board, a "Today" list of what matches (plus everything you're watching), a badge on the tab, and optional device notifications when you open the app. (The site has no server, so it can only check when it is open.)
- **More:** light/dark mode, animations on/off, and **FAQs** on how to use the app.

Plain HTML, CSS and JavaScript. No build step, no backend, no API keys, no dependencies.

## How it works

```
GitHub Action (every hour)             GitHub Pages
 └─ node scripts/fetch-report.mjs       └─ index.html
     ├─ calls the free public APIs          └─ fetch('data/report.json')
     ├─ computes the ratings                    └─ draws the cards and charts
     └─ writes data/report.json
```

1. **`.github/workflows/update-report.yml`** runs every hour (at :17 past; GitHub may start scheduled runs a few minutes late), when you push code, and whenever you press **Run workflow** on the Actions tab.
2. It runs **`scripts/fetch-report.mjs`**, which reads the places in `config/locations.json`, fetches each data source, scores each place using `config/ratings.json`, and writes `data/report.json` (plus a tiny `data/version.json` with just the time).
3. It publishes the site to GitHub Pages with the fresh report. **Once a day** (the first run from 12:00 UTC) it also commits the report to the repo as a daily snapshot; committing every hour would grow the repo by ~12 MB a day.
4. In the morning (5–11 AM Pacific), it sends the email alerts; nobody gets more than one a day.
5. The page (`index.html` + `js/app.js`) loads `data/report.json` and draws everything in the browser. A page left open checks `data/version.json` every 15 minutes and offers to refresh when there's a newer report.

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

- **Terrain mix and parks:** `terrain` (% beginner / intermediate / advanced, plus expert where listed), `terrainParks`, `skiersOnly` and `acres` (skiable acres, so big resorts rank above small local hills in recommendations) on each resort in `config/locations.json`, collected once from Wikipedia infoboxes. Missing = unknown (no bonus or penalty).
- **Skill levels and boards:** `config/ratings.json` → `surf.skills` sets the wave sizes, wind limits and periods that fit each level and board. A beach can have a `minLevel` (and `minLevelNote`) in `config/locations.json` if it isn't for everyone, like Pipeline.

- **Add or remove a place:** edit `config/locations.json`. Each resort needs an id, name, state (`region`), area (West, Pacific NW, Rockies, Midwest or East), coordinates and a time zone. Leave out `snotel` and run `node scripts/find-snotel.mjs`: it picks the nearest active SNOTEL station within 30 km (or marks the resort as modelled). Check its choice. `snow.defaultPinned` sets the 4 mountains a first-time visitor sees.
- **Add a surf spot:** add an id, name, city, state (`region`), area, coordinates and time zone under `surf.spots`, then run `node scripts/find-surf-stations.mjs`. It fills in what's missing: the direction the beach faces (from the OpenStreetMap coastline, which always has the water on its right-hand side), the nearest NOAA tide station within 60 km, and the nearest buoy within 100 km that's currently reporting waves. Check its choices; anything you set by hand is left alone. `node scripts/find-surf-stations.mjs --check` compares hand-set facing directions with the coastline. `surf.defaultPinned` sets the 4 beaches a first-time visitor sees.
- **Tune the ratings:** edit `config/ratings.json`. Every rating starts at 2 and gains or loses a point per rule; the reasons appear in `rating.factors` in the report. `surf.profiles` gives each area its own idea of good wave size and period (Hawaii is bigger than the Gulf).

## Email alerts (Sign in with Google)

People sign in with Google on the Notifications tab. Their alert settings, Rider Profile and pins save to their account (Firebase), and each morning the GitHub Action emails a summary to anyone with email alerts on, only when something matches. Until the steps below are done, the app shows email alerts as "not switched on" and the Action skips the email step.

**1. Create a Firebase project** (free): go to https://console.firebase.google.com → **Add project** (Google Analytics can be off).

**2. Add a web app:** in the project, click the **</>** (Web) icon → give it a name → **Register app**. Copy `apiKey`, `authDomain`, `projectId` and `appId` into `js/firebase-config.js`. (These aren't secrets; every Firebase web app ships them.)

**3. Turn on Google sign-in:** **Build → Authentication → Get started → Sign-in method → Google → Enable**, pick a support email, **Save**. Then **Settings → Authorized domains → Add domain** → `billywall732.github.io`.

**4. Create the database:** **Build → Firestore Database → Create database** → production mode → a US location → **Create**. Open the **Rules** tab, replace everything with the contents of `firestore.rules` from this repo, and **Publish**. (The rules let each person read and change only their own record.)

**5. Let the Action read the database:** **Project settings (gear) → Service accounts → Generate new private key**. On GitHub: repo **Settings → Secrets and variables → Actions → New repository secret** named `FIREBASE_SERVICE_ACCOUNT`, and paste the whole downloaded JSON file. Then delete the file from your computer.

**6. A Gmail account to send from** (a new one just for this is best): turn on **2-Step Verification**, then create an **App Password** at https://myaccount.google.com/apppasswords. Add two more GitHub secrets: `GMAIL_USER` (the address) and `GMAIL_APP_PASSWORD` (the 16-character password). Gmail allows about 500 recipients a day.

**7. Try it:** commit and push, open the site, Notifications → **Sign in with Google**. Then on GitHub, **Actions → Update report → Run workflow**; the **Email alerts** step's log says how many emails went out.

To test the email script without sending anything: `node scripts/email/send-emails.mjs --dry-run sample-users.json` (a JSON list of users like the ones stored in Firestore).

## Project layout

```
index.html             the page
css/styles.css         styles (light + dark via CSS variables)
js/app.js              starts the page: header, tabs, theme switch, footer
js/places.js           shared by both tabs: pins, list, filters, detail view, map
js/snow.js             Snow tab: mountain cards, filters and detail content
js/surf.js             Surf tab: beach cards, tide card, hourly chart, compass, For you
js/skill.js            your surf level/board and the "does this fit me?" rules
js/rider.js            Profile tab: your Rider Profile and the Recommended for you cards
js/recommend.js        picks and "is this for you?" rules (shared with the email script)
js/cities.js           cities to choose "where you ride from"
js/alerts.js           Notifications tab: settings, Heads up list, chosen places, Notify me
js/alert-rules.js      which alerts match (shared with the email script)
js/fit.js              "does this surf fit you?" rules (shared with the email script)
js/account.js          Sign in with Google + saving settings to your account
js/firebase-config.js  Firebase web settings (fill in during email setup)
js/faq.js              FAQs page (plain text, easy to edit)
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
scripts/email/send-emails.mjs   the morning email alerts
firestore.rules        who can read/write saved settings (paste into Firebase)
scripts/serve.mjs      tiny local web server
.github/workflows/     the daily GitHub Action
```

## Planned

- A mountain-bike **trail conditions** tab (Laguna, Pasadena, Santa Monica, Simi Valley) based on recent rainfall — it becomes `sections.trails` in the report.
- An optional one-sentence **AI morning verdict** written by the Action via the Claude API, with the key stored as a GitHub Actions secret — it fills the `verdict` fields already in the report.

## License

[MIT](LICENSE)
