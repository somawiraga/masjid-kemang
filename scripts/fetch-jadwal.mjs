// Downloads the monthly prayer schedule for Kota Bekasi from the MyQuran API
// and stores it as data/jadwal-YYYY-MM.json, which the website reads.
//
// Usage:
//   node scripts/fetch-jadwal.mjs              -> current month and next month (WIB)
//   node scripts/fetch-jadwal.mjs 2026 11      -> a specific month
//
// Requires Node 18+ (built-in fetch).

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CITY_ID = 1221; // KOTA BEKASI
const API = 'https://api.myquran.com/v2/sholat/jadwal';
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FIELDS = ['imsak', 'subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
const TIME_RE = /^\d{2}:\d{2}$/;

function monthsToFetch() {
  const [y, m] = process.argv.slice(2).map(Number);
  if (y && m) return [{ year: y, month: m }];
  // "Now" in WIB (UTC+7)
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return [{ year, month }, next];
}

function validate(json, year, month) {
  const list = json?.data?.jadwal;
  if (json?.status !== true || !Array.isArray(list) || list.length < 28) {
    throw new Error('Unexpected response shape');
  }
  for (const day of list) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) throw new Error(`Bad date: ${day.date}`);
    for (const f of FIELDS) {
      if (!TIME_RE.test(day[f] ?? '')) throw new Error(`Bad ${f} on ${day.date}: ${day[f]}`);
    }
  }
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  if (!list.every((d) => d.date.startsWith(prefix))) throw new Error('Dates do not match requested month');
  return list;
}

async function fetchMonth({ year, month }) {
  const mm = String(month).padStart(2, '0');
  const res = await fetch(`${API}/${CITY_ID}/${year}/${mm}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const list = validate(json, year, month);

  const days = list.map((d) => {
    const row = { date: d.date };
    for (const f of FIELDS) row[f] = d[f];
    return row;
  });
  const file = path.join(OUT_DIR, `jadwal-${year}-${mm}.json`);
  await writeFile(
    file,
    JSON.stringify({ source: 'MyQuran API (data Kemenag Bimas Islam)', city: json.data.lokasi, days }, null, 2) + '\n'
  );
  console.log(`Saved ${days.length} days -> ${path.relative(process.cwd(), file)}`);
}

await mkdir(OUT_DIR, { recursive: true });
let failed = false;
for (const target of monthsToFetch()) {
  try {
    await fetchMonth(target);
  } catch (err) {
    failed = true;
    console.error(`Failed ${target.year}-${target.month}: ${err.message}`);
  }
}
if (failed) process.exit(1);
