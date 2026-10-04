// Saves the latest video of the @Baitulj YouTube channel to data/youtube.json
// using YouTube's public RSS feed (no API key needed).
//
// The site shows two cards, one per weekend day:
//   slots.sabtu  -> updated by the Saturday 07:00 WIB run
//   slots.ahad   -> updated by the Sunday 07:00 WIB run
// On other days the run only refreshes the title and view count of the videos already saved
// (and fills a slot if it is still empty).
//
// Usage:
//   node scripts/fetch-youtube.mjs            -> slot is picked from today's weekday in WIB;
//                                                on other days stats are refreshed
//   node scripts/fetch-youtube.mjs sabtu      -> force a slot (sabtu | ahad)
//
// Requires Node 18+ (built-in fetch).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHANNEL_ID = 'UC_PHi3WOyvti2T6o6oI0MWw'; // https://www.youtube.com/@Baitulj
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'youtube.json');
const SLOTS = ['sabtu', 'ahad'];

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

function parseFeed(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries.map((e) => {
    const pick = (re) => (e.match(re) || [])[1];
    const id = pick(/<yt:videoId>(.*?)<\/yt:videoId>/);
    return {
      id,
      title: decode(pick(/<title>([\s\S]*?)<\/title>/) || '').trim(),
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      published: pick(/<published>(.*?)<\/published>/),
      views: Number(pick(/<media:statistics views="(\d+)"/) || 0)
    };
  }).filter((v) => v.id && v.title && v.published);
}

function todaySlotWIB() {
  const day = new Date(Date.now() + 7 * 3600 * 1000).getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 6 ? 'sabtu' : day === 0 ? 'ahad' : null;
}

const res = await fetch(FEED);
if (!res.ok) throw new Error(`YouTube feed returned HTTP ${res.status}`);
const videos = parseFeed(await res.text());
if (!videos.length) throw new Error('No videos found in the feed');

let data = { channel: { name: 'Masjid Baitul Jihad', url: 'https://www.youtube.com/@Baitulj' }, slots: {} };
try {
  data = { ...data, ...JSON.parse(await readFile(OUT_FILE, 'utf8')) };
} catch { /* first run */ }

const forced = process.argv[2];
if (forced && !SLOTS.includes(forced)) throw new Error(`Unknown slot "${forced}" (use sabtu or ahad)`);
const target = forced || todaySlotWIB();
const fetchedAt = new Date().toISOString();

if (target) {
  data.slots[target] = { ...videos[0], fetchedAt };
  console.log(`Slot "${target}" -> ${videos[0].id} ${videos[0].title}`);
} else {
  // Not a weekend: keep the saved videos but refresh their stats; fill empty slots
  SLOTS.forEach((slot, i) => {
    const saved = data.slots[slot];
    const fresh = saved && videos.find((v) => v.id === saved.id);
    if (fresh) {
      data.slots[slot] = { ...saved, title: fresh.title, views: fresh.views, fetchedAt };
      console.log(`Slot "${slot}" refreshed -> ${saved.id} (${fresh.views} views)`);
    } else if (!saved && videos[i]) {
      data.slots[slot] = { ...videos[i], fetchedAt };
      console.log(`Slot "${slot}" (empty) -> ${videos[i].id} ${videos[i].title}`);
    }
  });
}

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(data, null, 2) + '\n');
