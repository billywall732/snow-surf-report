// USDA NRCS SNOTEL, via the AWDB REST API — observed snow depth. Free, no key.
// Docs: https://wcc.sc.egov.usda.gov/awdbRestApi/swagger-ui/index.html
//
// SNOTEL measures total depth (element "SNWD"), not new snow. We estimate new
// snow by adding up day-to-day increases. Settling makes this a bit low.
import { getJSON } from '../http.mjs';
import { addDays, todayIn } from '../time.mjs';

export async function snowDepth(resort) {
  const today = todayIn(resort.timezone);
  const params = new URLSearchParams({
    stationTriplets: resort.snotel.triplet,
    elements: 'SNWD',
    duration: 'DAILY',
    beginDate: addDays(today, -11),
    endDate: today,
  });
  const j = await getJSON(`https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?${params}`);
  const values = j[0]?.data?.[0]?.values ?? [];
  const series = values
    .filter((v) => v.value != null)
    .map((v) => ({ date: v.date.slice(0, 10), depth: Math.round(v.value) }));
  if (series.length < 2) throw new Error('Station returned no recent snow depth');

  // Sum of positive day-over-day changes over the last n days.
  const gain = (n) => {
    let total = 0;
    for (let i = Math.max(1, series.length - n); i < series.length; i++) {
      total += Math.max(0, series[i].depth - series[i - 1].depth);
    }
    return total;
  };

  return {
    depthNow: series.at(-1).depth,
    asOf: series.at(-1).date,
    newSnow: { h24: gain(1), h48: gain(2), d7: gain(7) },
    depthHistory: series.slice(-10),
  };
}
