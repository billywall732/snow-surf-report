// Small wrappers around Node's built-in fetch().
// - Every request gets a User-Agent (api.weather.gov requires one; it's polite everywhere).
// - Requests time out after 20 seconds instead of hanging the whole run.
// - Network hiccups and server errors (5xx) are retried twice, after 2 s and then 5 s.
//   (A morning run once lost three resorts in a row to a brief "fetch failed".)
// - Other errors, like 404 Not Found, fail straight away: retrying won't fix them.

const USER_AGENT = 'snow-surf-report/1.0 (personal hobby project; https://github.com/)';
const RETRY_WAITS = [2000, 5000]; // pause before the 2nd and 3rd tries

async function request(url) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      // Network error or timeout: worth another try
      if (attempt >= RETRY_WAITS.length) throw err;
      await new Promise((r) => setTimeout(r, RETRY_WAITS[attempt]));
      continue;
    }
    if (res.ok) return res;
    const error = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    if (res.status < 500 || attempt >= RETRY_WAITS.length) throw error; // not retryable, or out of tries
    await new Promise((r) => setTimeout(r, RETRY_WAITS[attempt]));
  }
}

export async function getJSON(url) {
  return (await request(url)).json();
}

export async function getText(url) {
  return (await request(url)).text();
}

// Runs one data-source call and wraps the result in the standard block:
//   { status: "ok", source, fetchedAt, ...extra, data }
//   { status: "unavailable", source, fetchedAt, ...extra, reason }
// Errors are caught here, so one broken source never stops the others.
export async function wrap(source, extra, fn) {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await fn();
    return { status: 'ok', source, fetchedAt, ...extra, data };
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'Timed out after 20 s' : err.message;
    return { status: 'unavailable', source, fetchedAt, ...extra, reason };
  }
}
