// Small wrappers around Node's built-in fetch().
// - Every request gets a User-Agent (api.weather.gov requires one; it's polite everywhere).
// - Requests time out after 20 seconds instead of hanging the whole run.
// - Server errors (5xx) and network errors get one retry after a short pause.

const USER_AGENT = 'snow-surf-report/1.0 (personal hobby project; https://github.com/)';

async function request(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return res;
      if (res.status < 500 || attempt === 2) {
        throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      }
    } catch (err) {
      if (attempt === 2) throw err;
    }
    await new Promise((r) => setTimeout(r, 2000));
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
