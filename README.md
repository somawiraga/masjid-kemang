# Masjid Baitul Jihad Website

A static website (plain HTML, CSS and JavaScript, with no build step) for Masjid Baitul Jihad, Kemang, Bekasi. Pages: `index.html` and `tentang.html`.

Two parts of the site are dynamic. Both work the same way: a scheduled GitHub Action runs a Node script, the script writes a JSON file into `data/`, and the browser reads that file.

```
GitHub Action (cron) ──► scripts/*.mjs ──► data/*.json ──► committed to repo ──► js/*.js renders it
```

| Feature | Script | Workflow | Data file | Browser code |
|---|---|---|---|---|
| Prayer times | `scripts/fetch-jadwal.mjs` | `.github/workflows/update-jadwal.yml` | `data/jadwal-YYYY-MM.json` | `js/main.js` |
| YouTube videos | `scripts/fetch-youtube.mjs` | `.github/workflows/update-youtube.yml` | `data/youtube.json` | `js/youtube.js` |

The scripts need Node 18 or later because they use the built-in `fetch`. The workflows run Node 22. No API keys are required.

---

## 1. Prayer time data collection and workflow

### Source
The [MyQuran API](https://api.myquran.com), which serves data from Kemenag Bimas Islam. The city is Kota Bekasi (`CITY_ID = 1221`). The script requests one whole month per call:

```
https://api.myquran.com/v2/sholat/jadwal/1221/{year}/{month}
```

### Script: `scripts/fetch-jadwal.mjs`
```bash
node scripts/fetch-jadwal.mjs              # current month and next month (WIB)
node scripts/fetch-jadwal.mjs 2026 11      # one specific month
```

1. Works out "now" in WIB (UTC+7). With no arguments it fetches the current month and the next month.
2. Validates each response before saving it:
   - `status` must be `true` and the schedule must have at least 28 days.
   - Every date must look like `YYYY-MM-DD` and fall in the requested month.
   - Each of `imsak`, `subuh`, `terbit`, `dzuhur`, `ashar`, `maghrib` and `isya` must match `HH:MM`.
3. Writes `data/jadwal-YYYY-MM.json`:
   ```json
   {
     "source": "MyQuran API (data Kemenag Bimas Islam)",
     "city": "KOTA BEKASI",
     "days": [
       { "date": "2026-10-01", "imsak": "04:12", "subuh": "04:22", "terbit": "05:34",
         "dzuhur": "11:45", "ashar": "14:51", "maghrib": "17:50", "isya": "18:58" }
     ]
   }
   ```
4. If a month fails validation or the request fails, that month is not written and the script exits with code 1. A bad response never overwrites a good file.

### Workflow: `update-jadwal.yml`
| Trigger | When |
|---|---|
| Cron `0 17 25 * *` | 17:00 UTC on the 25th, which is 00:00 WIB on the 26th. Fetches this month and next month. |
| Cron `0 17 1 * *` | 17:00 UTC on the 1st. A safety net in case a month was missed. |
| `workflow_dispatch` | Manual run from the Actions tab. |

Steps: checkout, set up Node 22, run the script, then commit and push `data/` as `github-actions[bot]` only if something changed (`git diff --cached --quiet || git commit`).

Because next month is fetched on the 26th, the site always has the next month's file before it is needed.

### Adding a month by hand
Run `node scripts/fetch-jadwal.mjs 2026 12`, then commit the new file in `data/`.

---

## 2. Prayer time logic (`js/main.js`)

### Time zone
All logic uses **WIB (UTC+7)** regardless of the visitor's device time zone. `nowWIB()` takes `Date.now() + 7h` and reads the UTC fields of the result. A visitor abroad still sees Bekasi's day and Bekasi's prayer times.

### Loading the data
`load()` runs on page load and whenever the day changes:

1. Gets today's WIB date and tomorrow's date.
2. `getDay()` looks for today's row in `data/jadwal-YYYY-MM.json`. Each month file is fetched once and cached in memory (`monthCache`).
3. If the local file is missing, malformed or lacks that day, it falls back to a live call to the MyQuran API for that single day.
4. If both fail, the card shows an error state with a retry button. The retry clears the cache and calls `load()` again.
5. Tomorrow's times are loaded afterwards. They are only needed after Isya, so a failure there is not treated as an error.

A day counts as valid only if `subuh`, `terbit`, `dzuhur`, `ashar`, `maghrib` and `isya` all match `HH:MM`.

### Prayers shown
In order: Subuh, Syuruq (`terbit`, sunrise), Dzuhur, Ashar, Maghrib, Isya. `imsak` is stored in the data but not displayed.

### "Current" vs "Next"
A timer calls `render()` every second. Each prayer has a `hold` value, the number of minutes it stays highlighted as the **current** prayer after its start time:

| Prayer | Stays "Saat Ini" for |
|---|---|
| Subuh | 60 min |
| Syuruq | 60 min |
| Dzuhur | 60 min |
| Ashar | 60 min |
| Maghrib | 30 min |
| Isya | until 00:00 |

Each second:

- **`findCurrent()`** returns the prayer whose window `[start, start + hold)` contains the current time, if any. Its badge reads **Saat Ini**, and the countdown is hidden.
- **`findNext()`** returns the first prayer whose time is still ahead of now, with the seconds remaining. After Isya it uses **tomorrow's Subuh**, which is `86400 - now + subuhTomorrow` seconds away. If tomorrow's data failed to load, it uses today's Subuh time as an approximation.
- If there is a current prayer, it is highlighted. Otherwise the next prayer is highlighted with the badge **Berikutnya** and the countdown (hours, minutes, seconds) is shown.

The DOM is only updated when the highlighted prayer or its mode changes (`stateKey = mode:prayer`). The countdown digits update every second.

The compact "mini" prayer slots (`[data-mini]`) use the same state. The highlighted one gets a label such as `Dzuhur (Berikutnya)`.

### Day rollover
`render()` compares the stored date with the current WIB date. When midnight passes, it calls `load()` again, so the new day's times load without a page refresh.

---

## 3. YouTube data collection and workflow

### Source
The channel's public RSS feed. It needs no API key and no quota:

```
https://www.youtube.com/feeds/videos.xml?channel_id=UC_PHi3WOyvti2T6o6oI0MWw
```
The channel is [@Baitulj](https://www.youtube.com/@Baitulj). The feed lists the latest videos with title, publish date and view count.

### Slots
The site has two "Kajian Sunnah Ilmiah" cards, one per weekend day. They are stored under `slots` in `data/youtube.json`:

| Slot | Updated on |
|---|---|
| `sabtu` | The Saturday run |
| `ahad` | The Sunday run |

Each slot holds `id`, `title`, `url`, `thumbnail`, `published`, `views` and `fetchedAt`.

### Script: `scripts/fetch-youtube.mjs`
```bash
node scripts/fetch-youtube.mjs            # slot chosen from today's weekday (WIB)
node scripts/fetch-youtube.mjs sabtu      # force a slot (sabtu | ahad)
```

1. Downloads the feed and parses each `<entry>` with regular expressions. Entries missing an id, title or publish date are dropped. If no videos are found, the script fails.
2. Loads the existing `data/youtube.json`, if there is one.
3. Chooses what to do from today's weekday in WIB, or from the slot argument if given:
   - **Saturday (or `sabtu`)** puts the newest video in the `sabtu` slot.
   - **Sunday (or `ahad`)** puts the newest video in the `ahad` slot.
   - **Any other day** keeps the saved videos and only refreshes their `title` and `views` from the feed. An empty slot is filled with a recent video (`videos[0]` for `sabtu`, `videos[1]` for `ahad`).
4. Writes `data/youtube.json`.

The Saturday card therefore keeps showing Saturday's kajian until the next Saturday, and the same applies to Sunday. The weekday runs keep the view counts up to date.

### Workflow: `update-youtube.yml`
| Trigger | When |
|---|---|
| Cron `0 0 * * *` | Every day at 00:00 UTC, which is 07:00 WIB. |
| `workflow_dispatch` | Manual run. An optional `slot` input (`sabtu` or `ahad`) forces a slot. Leave it empty to follow today's weekday. |

Steps: checkout, set up Node 22, run the script, then commit and push `data/youtube.json` if it changed.

### Browser: `js/youtube.js`
1. Finds the cards `.kajian-card[data-slot]`. If there are none, the script stops.
2. Fetches `data/youtube.json` with `cache: 'no-cache'`.
3. For each card, takes `slots[card.dataset.slot]`. If the entry has `id`, `title`, `url` and `published`, it fills in the thumbnail, link, title, view count ("Ditonton N kali") and a relative time such as "3 hari lalu".
4. If the thumbnail fails to load, it falls back to `assets/images/kajian-sabtu.jpg`.
5. If the JSON cannot be loaded, the static fallback markup is kept. That markup links to the channel.

---

## Running locally
Serve the folder over HTTP, because `fetch` of the JSON files does not work from `file://`:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

To refresh data manually:

```bash
node scripts/fetch-jadwal.mjs
node scripts/fetch-youtube.mjs
```

## Project structure
```
index.html, tentang.html   pages
css/style.css              styles
js/main.js                 prayer times and countdown
js/youtube.js              kajian video cards
data/                      generated JSON (committed by the workflows)
scripts/                   Node data-fetching scripts
assets/                    images and icons
.github/workflows/         scheduled updates
```

## Troubleshooting
- **Prayer card shows an error:** check that `data/jadwal-YYYY-MM.json` exists for the current month. If it doesn't, run the fetch script or trigger **Update jadwal shalat** manually.
- **Workflow can't push:** under Settings → Actions → General, set Workflow permissions to "Read and write". The workflows request `contents: write`, but the repo setting can override it.
- **Scheduled workflows stop:** GitHub disables scheduled runs on repos with no activity for 60 days. Re-enable them in the Actions tab.
