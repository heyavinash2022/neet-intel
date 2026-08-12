/* Niche Intel — orchestrator. Fetches YouTube data for tracked channels, runs the engine,
   writes the dashboard, updates history, emits alerts + brief. Node 20+ (global fetch). */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBrief, updateHistory, detectAlerts, renderDashboard, renderBriefText } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELFTEST = process.argv.includes('--selftest');
const KEY = process.env.YT_API_KEY;

const readJSON = async (p, d) => { try { return JSON.parse(await readFile(join(ROOT, p), 'utf8')); } catch { return d; } };
const writeOut = async (p, s) => { const fp = join(ROOT, p); await mkdir(dirname(fp), { recursive: true }); await writeFile(fp, s); };

/* ---------- YouTube API ---------- */
const YT = 'https://www.googleapis.com/youtube/v3/';
async function yt(ep, params) {
  const u = new URL(YT + ep);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  u.searchParams.set('key', KEY);
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(`${ep}: ${j.error?.message || r.status}`);
  return j;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function resolveId(entry, idMap) {
  if (entry.id) return entry.id;
  const ck = entry.handle || entry.name || entry.query;
  if (idMap[ck]) return idMap[ck];
  let id = null;
  if (entry.handle) { try { const j = await yt('channels', { part: 'id', forHandle: entry.handle }); id = j.items?.[0]?.id; } catch {} }
  if (!id) { const j = await yt('search', { part: 'snippet', type: 'channel', q: entry.query || entry.name || entry.handle, maxResults: 1 }); id = j.items?.[0]?.snippet?.channelId || j.items?.[0]?.id?.channelId; }
  if (!id) throw new Error('channel not found: ' + (entry.name || entry.query));
  idMap[ck] = id;
  return id;
}
async function videoDetails(ids) {
  const out = [];
  for (const c of chunk(ids, 50)) {
    const j = await yt('videos', { part: 'snippet,statistics', id: c.join(',') });
    (j.items || []).forEach(x => out.push({ id: x.id, title: x.snippet.title, tags: x.snippet.tags || [], published: x.snippet.publishedAt,
      thumb: (x.snippet.thumbnails.medium || x.snippet.thumbnails.default || {}).url || '',
      views: +(x.statistics.viewCount || 0), likes: +(x.statistics.likeCount || 0), comments: +(x.statistics.commentCount || 0) }));
  }
  return out;
}
async function fetchComments(vid, max) {
  if (max <= 0) return [];
  try { const j = await yt('commentThreads', { part: 'snippet', videoId: vid, order: 'relevance', maxResults: Math.min(max, 100), textFormat: 'plainText' });
    return (j.items || []).map(it => { const s = it.snippet.topLevelComment.snippet; return { text: s.textDisplay, likes: +(s.likeCount || 0), author: s.authorDisplayName }; });
  } catch { return []; }
}

async function scanChannel(entry, idMap, cfg) {
  const cid = await resolveId(entry, idMap);
  const cj = await yt('channels', { part: 'snippet,statistics,contentDetails', id: cid });
  const ch = cj.items?.[0];
  if (!ch) throw new Error('not found');
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  const pj = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: cfg.recentPerChannel });
  const ids = (pj.items || []).map(x => x.contentDetails.videoId);
  const videos = (await videoDetails(ids)).sort((a, b) => new Date(b.published) - new Date(a.published));
  return { channelId: cid, name: ch.snippet.title, subs: +(ch.statistics.subscriberCount || 0),
    totalViews: +(ch.statistics.viewCount || 0), videoCount: +(ch.statistics.videoCount || 0), videos };
}

/* ---------- main ---------- */
async function main() {
  const cfg = await readJSON('config/config.json', { recentPerChannel: 15, commentsFromTopMovers: 6, commentsPerVideo: 25, spikeThreshold: 100000, subThreshold: 5000 });
  const now = Date.now();

  let channelsData, history = await readJSON('data/history.json', { snapshots: {} });

  if (SELFTEST) {
    console.log('SELFTEST: using fixtures (no network).');
    channelsData = JSON.parse(await readFile(join(ROOT, 'scripts/fixtures.json'), 'utf8'));
  } else {
    if (!KEY) { console.error('ERROR: YT_API_KEY env var not set.'); process.exit(1); }
    const cfgCh = await readJSON('config/channels.json', []);
    const idMap = await readJSON('data/idmap.json', {});
    channelsData = [];
    for (const entry of cfgCh) {
      if (entry.tracked === false) continue;
      try {
        process.stdout.write(`Scanning ${entry.name}… `);
        const cd = await scanChannel(entry, idMap, cfg);
        channelsData.push(cd);
        console.log(`ok (${cd.videos.length} videos, ${cd.subs} subs)`);
      } catch (e) { console.log('FAILED: ' + e.message); channelsData.push({ name: entry.name, error: e.message }); }
    }
    // comments from top movers across the niche (cheap): compute a provisional brief to pick movers
    const prov = computeBrief(channelsData, history, { now });
    const movers = (prov.firstRun ? prov.uniqWin.sort((a, b) => b.views - a.views) : prov.allMovers).slice(0, cfg.commentsFromTopMovers);
    const byChannel = {};
    for (const m of movers) {
      const cs = await fetchComments(m.id, cfg.commentsPerVideo);
      const owner = channelsData.find(c => c.channelId === m.channelId);
      if (owner) { owner.comments = owner.comments || []; cs.forEach(c => owner.comments.push({ ...c, video: m.title, videoId: m.id })); }
    }
    await writeOut('data/idmap.json', JSON.stringify(idMap, null, 2));
  }

  const brief = computeBrief(channelsData, history, { now });
  brief.alerts = detectAlerts(brief, cfg);

  const newHistory = updateHistory(history, channelsData, now, cfg.keepSnapshots || 30);
  await writeOut('data/history.json', JSON.stringify(newHistory, null, 2));
  await writeOut('docs/index.html', renderDashboard(brief, newHistory, {}));
  await writeOut('data/brief.md', renderBriefText(brief, now));
  await writeOut('data/alerts.json', JSON.stringify(brief.alerts, null, 2));

  console.log(`\nDone. ${brief.allNew.length} new uploads, ${brief.allMovers.length} movers, ${brief.comments.total} comments, ${brief.alerts.length} alerts.`);
  console.log('Dashboard → docs/index.html');
}
main().catch(e => { console.error(e); process.exit(1); });
