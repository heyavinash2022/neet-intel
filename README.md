# NEET Niche Command Center — Autonomous Daily Brief

A free, self-running competitor-intelligence system for the NEET / medical-entrance YouTube niche. Every night at **10 PM IST**, GitHub runs it for you — no server, no laptop needed — and it:

- scans all your tracked competitor channels via the YouTube Data API,
- compares tonight to last night (new uploads, view velocity),
- mines top comments for demand, questions, and FOMO/panic language,
- writes a **live dashboard** you bookmark, keeps a **history** for trend charts,
- and **emails you** (via a GitHub issue) when a video spikes or subs move sharply.

You never touch it after setup. Open the dashboard when you want; paste the brief to Claude when you want a full content plan.

---

## What you need (both free)

1. A **GitHub account** — github.com
2. A **YouTube Data API v3 key** — see `SETUP-GUIDE.md` (the earlier doc) for the 5-minute steps. It's the same key type as your local tool.

---

## Setup — one time, ~10 minutes

### 1. Create the repository
- On GitHub, click **+ → New repository**. Name it e.g. `neet-intel`. Keep it **Public** (safe — your API key is never in the code, it goes in encrypted Secrets). Click **Create repository**.

### 2. Upload these files
- On the empty repo page, click **uploading an existing file**.
- Drag in **everything from this folder** (keep the folder structure: `.github/`, `config/`, `data/`, `docs/`, `scripts/`, `package.json`). GitHub preserves subfolders when you drag the whole set.
- Click **Commit changes**.

### 3. Add your YouTube key as a secret
- In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
- Name: **`YT_API_KEY`**  · Value: *(paste your YouTube API key)* · **Add secret**.

### 4. Turn on Actions and run it once
- Open the **Actions** tab. If prompted, click **"I understand my workflows, enable them."**
- Click **Daily NEET Niche Brief** → **Run workflow → Run workflow**.
- Wait ~1 minute. A green check means it worked. (This first run is your **baseline**.)

### 5. Turn on the live dashboard (GitHub Pages)
- **Settings → Pages**. Under **Source**, choose **Deploy from a branch**. Branch: **main**, folder: **/docs**. **Save**.
- After a minute your dashboard is live at:
  **`https://<your-username>.github.io/neet-intel/`**
- Bookmark it. It refreshes itself every night.

That's it. From tomorrow night on, it runs automatically at 10 PM IST and the dashboard updates with true day-over-day movement.

---

## Daily use

- **Just read the dashboard** whenever you like — it's always current as of the last nightly run.
- **Get alerts in your inbox:** when a competitor video jumps past the spike threshold, the workflow opens a GitHub issue titled "🚨 Niche alert" — GitHub emails you automatically. (Make sure GitHub notifications for your repo are on.)
- **Get a full content plan:** open `data/brief.md` in your repo (updated each night), copy it, and paste it to Claude with "turn this into tomorrow's video plan." It's formatted as a ready briefing.

---

## Customize (optional)

Edit these files right on GitHub (pencil icon → commit):

- **`config/channels.json`** — add/remove channels. Each entry: `{ "name": "...", "query": "search terms or @handle", "tracked": true }`. Set `"tracked": false` to pause one. For an exact lock, use `{ "name": "...", "id": "UCxxxx..." }` with the channel's real ID.
- **`config/config.json`**:
  - `recentPerChannel` — how many recent uploads to pull per channel (default 15).
  - `commentsFromTopMovers` / `commentsPerVideo` — how deep to mine comments.
  - `spikeThreshold` — new views in a day that triggers an alert (default 100000).
  - `subThreshold` — subscriber swing that triggers an alert (default 5000).
- **Change the time:** in `.github/workflows/daily.yml`, edit the `cron` line. It's in **UTC**; `30 16 * * *` = 10:00 PM IST. (IST = UTC + 5:30.)

---

## Notes & troubleshooting

- **Run failed with a key error** → check the `YT_API_KEY` secret is set exactly, and that "YouTube Data API v3" is enabled in your Google Cloud project.
- **Dashboard shows sample/placeholder** → you haven't run the workflow yet (Step 4), or Pages is still building (wait 1–2 min).
- **A channel resolves wrong** → put its exact channel ID in `channels.json` (`"id": "UC..."`).
- **Quota:** ~40–60 API units per nightly run out of 10,000/day — comfortably daily.
- **Privacy:** a public repo means the dashboard URL is public (it only shows public YouTube data + your analysis). Prefer private? Keep the repo private and read `data/brief.md` in the repo instead — GitHub Pages on private repos needs a paid plan.
- **Local tool still works** — the `niche-command-center.html` is great for on-demand deep dives; this repo is the autonomous layer. Use both.

---

*Built with Claude. Test the logic anytime with `npm run selftest` (uses sample data, no key needed).*
