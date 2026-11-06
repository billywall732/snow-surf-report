// The verdict for a rating: one word per band, the same in the emails and on the site
// (word for word, because both import this file).
//   4-5 GO · 3 WORTH A LOOK · 1-2 SKIP · a mountain you can't ride yet: NOT OPEN YET
// Pure rules (no page), so it runs in the browser and in the Node email script.

export const VERDICT = {
  go: { label: 'GO', color: '#0b7a5a' },
  maybe: { label: 'WORTH A LOOK', color: '#a35f00' },
  skip: { label: 'SKIP', color: '#5f6b78' },
  closed: { label: 'NOT OPEN YET', color: '#5f6b78' },
};

export function verdictOf(score, notYet = false) {
  if (notYet) return { key: 'closed', ...VERDICT.closed };
  if (score == null) return { key: 'skip', ...VERDICT.skip };
  const key = score >= 4 ? 'go' : score === 3 ? 'maybe' : 'skip';
  return { key, ...VERDICT[key] };
}

// A mountain you can't ride: before opening day, or a 0" base. (Beaches have no season.)
export function notRideable(item) {
  if (!item?.season) return false;
  if (item.season.status === 'closed') return true;
  return item.observed?.status === 'ok' && item.observed.data?.depthNow === 0;
}

export const verdictFor = (item) => verdictOf(item?.rating?.score, notRideable(item));

// "GO · 5/5", "SKIP · 1/5", "NOT OPEN YET"
export function verdictText(item) {
  const v = verdictFor(item);
  const s = item?.rating?.score;
  return v.key === 'closed' || s == null ? v.label : `${v.label} · ${s}/5`;
}
