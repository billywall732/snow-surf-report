// The FAQs page (from More → FAQs): how to use the app, and common questions.
// Each answer is a list of paragraphs. Edit freely: it's just text.
import { h } from './ui.js';

const FAQ = [
  ['Getting started', [
    ['What is this?', [
      'Up-to-date snow conditions at every US Ikon and Epic Pass mountain and surf at 52 US beaches, with a simple 1–5 “should I go?” rating for each.',
      'It updates every hour (GitHub sometimes runs a few minutes late). The time of the latest update is at the top of the page, and if you leave the app open, a “New conditions available” bar offers to refresh when there’s a newer report.',
      'Ratings and “fits you” look at the morning session (7 AM) for today and the next two days. Email alerts go out once a day, in the morning.',
    ]],
    ['How do I get around?', [
      'Use the bar at the bottom: Snow and Surf for conditions, Notifications for alerts, Profile for how you ride, and More for light/dark mode, animations and these FAQs.',
    ]],
    ['What’s the “Start Shredding” screen?', [
      'The welcome screen you see when you first open the site: it loads today’s report and shows the best snow and surf of the day. It appears once per visit (not on every reload), and links straight to a mountain or beach skip it.',
      'To see it again, tap More → Replay intro.',
    ]],
    ['What is the Rider Profile?', [
      'Tell the app whether you ski or snowboard, your level (Beginner to Expert), what you’re after (powder, groomers, terrain parks, steeps), your pass, how you surf, the coldest water you’ll surf and where you’re coming from.',
      'It powers “Recommended for you” at the top of the Snow and Surf tabs, the “For you” notes in each detail view, and “near me” alerts. Snowboarders never get skiers-only mountains (like Alta and Deer Valley) in their picks or alerts.',
    ]],
    ['How are “Recommended for you” picks chosen?', [
      'Each place starts from today’s 1–5 rating. Mountains get extra points for size (skiable acres, so a big resort like Mammoth beats a small local hill), for terrain that matches your level (from Wikipedia’s trail mix), for what you’re after (fresh and incoming snow, calm dry days, terrain parks, lots of black runs) and, a little, for being closer.',
      'Great places just past your travel distance (up to 1.5 times as far) are listed under “Worth a longer trip”, so they’re never silently hidden.',
      'Beaches get extra points when the waves fit your level and board today, and for being closer. Places on another pass, farther than you’ll travel, closed to snowboards (if you only snowboard) or in water colder than you like are left out.',
    ]],
    ['How do I keep my favorite spots at the top?', [
      'Tap the ☆ next to any mountain or beach in the list to pin it. You can pin up to 4 on each tab; they show as cards under “My mountains” or “My beaches”.',
      'If all 4 are taken, you’ll be asked which one to replace. Your pins are saved on this device.',
    ]],
    ['How do I see more detail about a place?', [
      'Tap its name in the list, its card’s Details link, or its icon on the map. The detail view shows why it got its rating, the forecast, charts and where the data comes from.',
      'Close it with ✕, the Back button, or by tapping outside it.',
    ]],
    ['How do I use the map?', [
      'Tap an icon to open that place. Zoom with the + and − buttons, by pinching, or with a double-click (Ctrl + scroll on a computer). Once zoomed in, drag to move around; ⟲ resets the view.',
      'Pinned places are larger and outlined; the one you have open is orange. On the Snow map, teal means Ikon and violet means Epic.',
    ]],
  ]],
  ['Ratings', [
    ['How are the ratings worked out?', [
      'Every place starts at 2 and gains or loses points by simple rules, shown under “Why this rating” in each detail view.',
      'Snow: fresh snow in the last 48 hours, base depth, and snow forecast in the next 3 days. A closed resort is capped at 1.',
      'Surf: wave size, wave period (longer is better), and wind (light or offshore is best). Each region has its own idea of “good”: a good day in Hawaii is much bigger than a good day on the Gulf.',
    ]],
    ['Are the ratings advice?', [
      'No. They’re simple rules, not a forecast from a person. Always check the resort or the beach, and surf within your ability.',
    ]],
  ]],
  ['Snow', [
    ['Why does a mountain say “modelled” snow?', [
      'Measured snow depth comes from USDA SNOTEL weather stations, which only exist in the western US and Alaska. For mountains without a station nearby, the app shows Open-Meteo’s computer-modelled estimate instead.',
    ]],
    ['Why don’t the numbers match the resort’s snow report?', [
      'The stations aren’t on the ski runs, and new snow is estimated from day-to-day changes in depth, which settling makes a little low. Treat the numbers as a guide.',
    ]],
    ['Is a resort open?', [
      'There’s no free live source for this. Opening dates come from a settings file and may be missing (“Season dates TBD”), so check the resort’s website.',
    ]],
    ['How is “What to wear” worked out?', [
      'From how cold it feels (temperature with wind chill) between 9 AM and 4 PM, from Open-Meteo. Colder means warmer base and mid layers; snow adds waterproof gear and a low-light goggle lens, and strong wind adds face cover.',
      'It’s for the mountain’s listed location. The summit is usually colder: about 3–5°F less for every 1,000 ft you climb.',
    ]],
  ]],
  ['Surf', [
    ['What do my level and board do?', [
      'Tap one or more levels (Beginner, Intermediate, Advanced, Pro for 15+ ft waves) and boards on the Surf tab or in your Rider Profile; they stay in sync. The list then shows only beaches whose waves fit you today, a “✓ Fits you” tag marks them, and each beach’s detail view shows “For you” for today and the next two days.',
      'With several picked, a day fits if it suits at least one of your levels with at least one of your boards. Tap a chip again to un-pick it, or Clear to start over.',
      'A day fits when the wave height suits both your level and your board, the period is long enough for your board, and the wind isn’t too strong for your level (offshore wind is fine).',
      'Some beaches, like Pipeline, are marked for advanced surfers only, whatever the waves are doing.',
    ]],
    ['What do “period” and “offshore” mean?', [
      'Period is the time between waves, in seconds. Longer periods (12 s+) usually mean more powerful, better-shaped waves; short periods (under 8 s) are often weak and choppy.',
      'Offshore wind blows from the land out to sea and cleans up the waves; onshore wind blows in from the sea and makes them messy.',
    ]],
    ['How is the wetsuit chosen? What’s the UV index?', [
      'From the water temperature (the buoy’s reading, or the model’s if there’s no buoy) and a common wetsuit chart: boardshorts at 75°F+, a spring suit around 65–69°F, a 3/2 full suit in the low 60s, a 4/3 in the mid 50s, and hoods, booties and gloves below that. If the air is under 55°F or the wind is 15 mph or more, it suggests one step warmer.',
      'The UV index is today’s peak sun strength (usually around midday): 0–2 low, 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme. Water reflects sunlight, so use water-resistant sunscreen and a rash guard when it’s high.',
    ]],
    ['Where do the tides come from?', [
      'NOAA tide predictions for the nearest tide station to each beach. The “Today’s tide” card shows the stations your pinned beaches use, and the water in the background rises and falls with it.',
    ]],
  ]],
  ['Notifications', [
    ['How do alerts work?', [
      'On the Notifications tab, choose snow alerts (how many inches, for which mountains) and surf alerts (waves that fit your level and board, at which beaches). With “… I choose”, tap Choose to pick from a list you can search and filter by area, pass, chosen/pinned/near you, and sort A–Z or closest first. “Near me” covers every place within your travel distance from your Rider Profile.',
      'Anything that matches is listed there, and the Notifications tab shows a red badge with the count.',
    ]],
    ['Can I get alerts by email?', [
      'Yes. On the Notifications tab, tap Sign in with Google. Each morning (around 5 AM Pacific) you’ll get one email listing what matches, only on days something does.',
      'Your settings (alerts, Rider Profile, pinned spots) save to your account automatically, so you can change them in the app on any device. To stop emails, turn off “Email me a morning summary” or use the link at the bottom of any email.',
    ]],
    ['Can I get alerts on my phone when the app is closed?', [
      'By email, yes (above). The app can also show a notification on this device for anything new each time you open it. Turn on “Notify me on this device” and allow notifications; you’ll get one right away so you know it works.',
      'On iPhone, notifications only work in the Home Screen app: in Safari tap Share → Add to Home Screen, open Snow and Surf from your Home Screen, and turn it on there.',
    ]],
    ['I chose mountains but they aren’t in “Heads up now”', [
      '“Heads up now” only lists places that match today (for example, 4" or more of snow coming). Open “Watching” just below it to see every mountain and beach your alerts cover, with how each looks today.',
    ]],
  ]],
  ['Data and privacy', [
    ['Where does the data come from?', [
      'Open-Meteo (mountain and surf forecasts), NOAA (tides and wave buoys), and USDA SNOTEL (measured snow depth). All free, public sources; the list with fetch times is at the bottom of each page.',
    ]],
    ['What do you store about me?', [
      'If you don’t sign in: nothing on a server. Your pins, filters, Rider Profile, alert settings, light/dark choice and animation setting are saved only in this browser.',
      'If you sign in with Google: your name, email address, alert settings, Rider Profile (including your home area, rounded to about 7 miles) and pinned spots are saved in your account (in Google’s Firebase), so we can email your alerts. Only you can see or change them. We never get access to your Gmail. Use “Delete my saved data” on the Notifications tab to remove everything.',
    ]],
    ['The page looks broken or old after an update', [
      'Close the tab and open the site again. The site updates every hour, and your browser may briefly hold on to the previous version.',
    ]],
  ]],
];

export function renderFaq() {
  const panel = document.getElementById('panel-faq');
  panel.replaceChildren(
    h('div', { class: 'section-head' },
      h('h2', {}, 'FAQs'),
      h('p', { class: 'fine' }, 'How to use the app, and answers to common questions.')),
    // ("..." spreads the list: the browser's replaceChildren() takes separate items, not a list)
    ...FAQ.map(([group, items]) => h('section', { class: 'faq-group' },
      h('h3', {}, group),
      items.map(([q, paragraphs]) => h('details', { class: 'faq' },
        h('summary', {}, q),
        paragraphs.map((p) => h('p', {}, p)))))),
  );
}
