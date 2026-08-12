/* Niche Intel — pure analysis + server-side renderer (no network, unit-testable) */

/* ---------- text helpers ---------- */
export const fmt = n => { n = +n || 0; const s = n < 0 ? '-' : ''; n = Math.abs(n);
  if (n >= 1e7) return s + (n / 1e7).toFixed(1) + 'Cr';
  if (n >= 1e5) return s + (n / 1e5).toFixed(1) + 'L';
  if (n >= 1e3) return s + (n / 1e3).toFixed(1) + 'K';
  return s + n; };
export const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const agoFrom = (iso, now) => { const d = (now - new Date(iso)) / 86400000;
  if (d < 1) return 'today'; if (d < 2) return 'yesterday';
  if (d < 30) return Math.round(d) + 'd ago'; if (d < 365) return Math.round(d / 30) + 'mo ago';
  return Math.round(d / 365) + 'y ago'; };
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------- lexicons ---------- */
const STOP = new Set('the a an and or of to for in on with your you my me is are be this that it at as by from we they he she his her their our will can how what why when who neet 2025 2026 2027 2028 ka ki ke ko hai ho na se me mein aur video sir vs'.split(' '));
const FOMO = ['cutoff', 'cut off', 'drop', 'dropper', 'last chance', 'only', 'must', 'fear', 'scared', 'panic', 'confused', 'tension', 'cooked', 'leak', 'cancel', 're-neet', 'reneet', 'urgent', 'hurry', 'late', 'waste', 'fail', 'lost', 'backlog', 'left', 'help', 'please', 'kaise', 'kya karu', 'decrease', 'increase', 'rank', 'marks', 'mbbs', 'government', 'seat', 'overage', 'miss'];
const PANIC = ['scared', 'fear', 'panic', 'tension', 'confused', 'cooked', 'depress', 'anxiety', 'crying', 'cry', 'lost', 'hopeless', 'give up', 'demotivat', 'stress', 'worried', 'worry', 'over for me', 'life over', 'ruined', 'rota'];

const tokenize = t => (t.toLowerCase().match(/[a-z0-9']{3,}/g) || []).filter(w => !STOP.has(w));
const hits = (t, list) => { const l = t.toLowerCase(); return list.filter(w => l.includes(w)); };

/* ---------- feature extractors ---------- */
export function titleStats(vids) {
  const n = vids.length || 1;
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}‼❓✨📈📉🙏🔥]/u;
  let emoji = 0, year = 0, num = 0, q = 0, caps = 0, len = 0;
  vids.forEach(v => { const t = v.title;
    if (emojiRe.test(t)) emoji++;
    if (/20(2[5-9]|3\d)/.test(t)) year++;
    if (/\d/.test(t)) num++;
    if (/\?|❓/.test(t)) q++;
    if (t.split(/\s+/).some(w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w))) caps++;
    len += t.length; });
  return { emoji: Math.round(emoji / n * 100), year: Math.round(year / n * 100), num: Math.round(num / n * 100),
    q: Math.round(q / n * 100), caps: Math.round(caps / n * 100), avgLen: Math.round(len / n) };
}
export function keywordFreq(vids) {
  const wv = {}, wc = {};
  vids.forEach(v => tokenize(v.title).forEach(w => { wv[w] = (wv[w] || 0) + (v.delta || v.views); wc[w] = (wc[w] || 0) + 1; }));
  return Object.entries(wc).filter(([w, c]) => c >= 2).map(([w, c]) => ({ w, c, score: wv[w] }))
    .sort((a, b) => b.score - a.score).slice(0, 18);
}
export function tagFreq(vids) {
  const f = {};
  vids.forEach(v => (v.tags || []).forEach(t => { const k = t.toLowerCase().trim(); if (k.length > 2) f[k] = (f[k] || 0) + 1; }));
  return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, c]) => ({ k, c }));
}
export function mineComments(comments) {
  const cm = comments.map(c => { const f = [...new Set(hits(c.text, FOMO))], p = [...new Set(hits(c.text, PANIC))], isQ = /\?/.test(c.text);
    return { ...c, fomo: f, panic: p, isQ, score: c.likes + f.length * 3 + p.length * 5 + (isQ ? 2 : 0) }; });
  const demand = [...cm].sort((a, b) => b.score - a.score).slice(0, 30);
  const df = {}; cm.forEach(c => c.fomo.forEach(f => df[f] = (df[f] || 0) + 1));
  const demandKw = Object.entries(df).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, c]) => ({ k, v: c }));
  return { cm, demand, demandKw, questions: cm.filter(c => c.isQ).length, panic: cm.filter(c => c.panic.length).length, total: cm.length };
}

/* ---------- brief computation (with diff vs history) ---------- */
export function computeBrief(channelsData, history, opts = {}) {
  const now = opts.now || Date.now();
  const snaps = (history && history.snapshots) || {};
  const allNew = [], allMovers = [], perChannel = [], pooled = [];
  for (const cd of channelsData) {
    if (cd.error) { perChannel.push({ name: cd.name, error: cd.error }); continue; }
    const prevList = snaps[cd.channelId] || [];
    const prev = prevList[prevList.length - 1];
    const prevMap = {}; const seen = new Set();
    prevList.forEach(s => s.videos.forEach(x => { seen.add(x.id); }));
    if (prev) prev.videos.forEach(x => { prevMap[x.id] = x.views; });
    const vids = (cd.videos || []).map(x => ({ ...x, channel: cd.name, channelId: cd.channelId }));
    vids.forEach(x => {
      x.isNew = prev ? (!Object.prototype.hasOwnProperty.call(prevMap, x.id) && !seen.has(x.id))
                     : (now - new Date(x.published)) / 86400000 < 4;
      x.delta = prev && prevMap[x.id] != null ? x.views - prevMap[x.id] : (prev ? x.views : 0);
    });
    const news = vids.filter(x => x.isNew); allNew.push(...news);
    const movers = vids.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta); allMovers.push(...movers);
    pooled.push(...vids);
    // subs trend
    const subHist = [...prevList.map(s => s.subs), cd.subs].filter(v => v != null);
    perChannel.push({ name: cd.name, channelId: cd.channelId, subs: cd.subs, totalViews: cd.totalViews,
      newCount: news.length, topMover: movers[0] || null, subHist, deltaSubs: prev ? cd.subs - prev.subs : 0 });
  }
  allMovers.sort((a, b) => b.delta - a.delta);
  const firstRun = !Object.values(snaps).some(h => h.length >= 1);
  const winners = [...allNew, ...allMovers.slice(0, 20)];
  const uniqWin = Object.values(Object.fromEntries(winners.map(w => [w.id, w])));
  const basis = uniqWin.length ? uniqWin : pooled;
  const comments = mineComments((channelsData.flatMap(c => c.comments || [])));
  const tStats = titleStats(basis), kw = keywordFreq(basis), tags = tagFreq(basis);
  const verdict = synthVerdict(basis, kw, tags, tStats, comments);
  return { ts: now, firstRun, perChannel, allNew, allMovers, uniqWin, comments, tStats, kw, tags, verdict };
}

export function synthVerdict(win, kw, tags, ts, cm) {
  const topTopic = kw[0]?.w ? cap(kw.slice(0, 3).map(k => k.w).join(' / ')) : (tags[0]?.k || '—');
  const bestTitle = [...win].sort((a, b) => (b.delta || b.views) - (a.delta || a.views))[0];
  const parts = [];
  if (ts.year > 50) parts.push('a year (NEET 2027)');
  if (ts.emoji > 50) parts.push('emoji (‼️❓📉)');
  if (ts.caps > 40) parts.push('an ALL-CAPS word');
  if (ts.q > 30) parts.push('a question');
  const formula = parts.length ? `~${ts.avgLen} chars, usually with ${parts.join(', ')}.` : `~${ts.avgLen} chars, direct-statement style.`;
  const thumb = ts.emoji > 50
    ? 'Winners lean on high-emotion cues — expressive face + big bold text + a red/alarm accent (‼️/📉). Open the top movers to copy the exact layout.'
    : 'Clean face + short bold text. Open the top movers for the exact layout.';
  let emotion = 'curiosity / comparison';
  if (cm.total) { const pr = cm.panic / cm.total, qr = cm.questions / cm.total;
    if (pr > 0.25) emotion = 'anxiety & panic — fear of a bad cutoff / drop-year regret';
    else if (qr > 0.4) emotion = 'confusion & seeking guidance — "what should I do?"';
    else if (cm.demandKw[0]) emotion = 'focused on ' + cm.demandKw.slice(0, 3).map(k => k.k).join(', '); }
  const headline = bestTitle
    ? `The niche is riding "${cap(kw[0]?.w || tags[0]?.k || 'exam')}" — strongest post is "${bestTitle.title.slice(0, 70)}" (${fmt(bestTitle.delta || bestTitle.views)} ${bestTitle.delta ? 'new views' : 'views'}).`
    : 'Not enough movement — check back after more uploads.';
  return { topTopic, formula, thumb, emotion, headline, bestTitle };
}

/* ---------- alerts ---------- */
export function detectAlerts(brief, cfg = {}) {
  const spike = cfg.spikeThreshold ?? 100000;   // absolute new views since last run
  const out = [];
  brief.allMovers.forEach(m => { if (m.delta >= spike) out.push({ type: 'spike', title: m.title, channel: m.channel, delta: m.delta, views: m.views, id: m.id }); });
  brief.perChannel.forEach(c => { if (c.deltaSubs && Math.abs(c.deltaSubs) >= (cfg.subThreshold ?? 5000))
    out.push({ type: 'subs', channel: c.name, deltaSubs: c.deltaSubs }); });
  return out;
}

/* ---------- history update ---------- */
export function updateHistory(history, channelsData, now, keep = 30) {
  const h = history && history.snapshots ? history : { snapshots: {} };
  for (const cd of channelsData) {
    if (cd.error) continue;
    h.snapshots[cd.channelId] = h.snapshots[cd.channelId] || [];
    h.snapshots[cd.channelId].push({ ts: now, subs: cd.subs, totalViews: cd.totalViews,
      videos: (cd.videos || []).map(x => ({ id: x.id, title: x.title, views: x.views, published: x.published })) });
    if (h.snapshots[cd.channelId].length > keep) h.snapshots[cd.channelId] = h.snapshots[cd.channelId].slice(-keep);
  }
  return h;
}

/* ---------- sparkline ---------- */
function sparkline(vals, w = 90, h = 22) {
  if (!vals || vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals), rng = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - (v - min) / rng * h).toFixed(1)}`).join(' ');
  const up = vals[vals.length - 1] >= vals[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--good)' : 'var(--crit)'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

/* ---------- markdown brief (for issue / email) ---------- */
export function renderBriefText(brief, now = Date.now()) {
  const V = brief.verdict;
  const L = [];
  L.push(`# NEET Niche Brief — ${new Date(now).toISOString().slice(0, 10)}`);
  L.push(`\n**Verdict:** ${V.headline}`);
  L.push(`- **Topic:** ${V.topTopic}`);
  L.push(`- **Title formula:** ${V.formula}`);
  L.push(`- **Student emotion:** ${V.emotion}`);
  L.push(`\n## Biggest movers`);
  brief.allMovers.slice(0, 8).forEach((m, i) => L.push(`${i + 1}. **${m.title}** — ${m.channel} — ${fmt(m.views)} views${m.delta > 0 ? ` (+${fmt(m.delta)})` : ''}`));
  L.push(`\n## New uploads (${brief.allNew.length})`);
  brief.allNew.slice(0, 10).forEach(m => L.push(`- ${m.title} — ${m.channel} (${fmt(m.views)} views)`));
  L.push(`\n## Audience demand`);
  L.push(`${brief.comments.total} comments · ${brief.comments.questions} questions · ${brief.comments.panic} panic signals.`);
  L.push(`Themes: ${brief.comments.demandKw.map(d => d.k).join(', ')}`);
  return L.join('\n');
}

/* ---------- full HTML dashboard ---------- */
export function renderDashboard(brief, history, meta = {}) {
  const now = brief.ts;
  const V = brief.verdict;
  const ago = iso => agoFrom(iso, now);
  const vcard = x => { const b = x.isNew ? '<span class="badge new">New</span>' : (x.delta > 0 ? `<span class="badge up">▲ ${fmt(x.delta)}</span>` : '');
    return `<div class="vcard"><div class="tw">${x.thumb ? `<img src="${x.thumb}" loading="lazy">` : ''}${b}<span class="ch">${esc(x.channel || '')}</span></div>
      <div class="body"><div class="t" title="${esc(x.title)}">${esc(x.title)}</div>
      <div class="st"><span><b>${fmt(x.views)}</b> views</span>${x.delta > 0 ? `<span class="delta">+${fmt(x.delta)}</span>` : ''}<span>${ago(x.published)}</span></div></div></div>`; };
  const bar = (k, pct, val) => `<div class="barr"><span class="k" title="${esc(k)}">${esc(k)}</span><span class="tr"><span class="fl" style="width:${Math.max(2, pct)}%"></span></span><span class="v">${val}</span></div>`;
  const maxK = Math.max(1, ...brief.kw.map(k => k.score)), maxT = Math.max(1, ...brief.tags.map(t => t.c));
  const C = brief.comments; const maxD = Math.max(1, ...C.demandKw.map(d => d.v));
  const alerts = brief.alerts || [];

  const channelRows = brief.perChannel.filter(c => !c.error).sort((a, b) => b.subs - a.subs).map(c => `
    <tr><td>${esc(c.name)}</td><td class="num">${fmt(c.subs)}</td>
    <td class="num ${c.deltaSubs > 0 ? 'up' : c.deltaSubs < 0 ? 'dn' : ''}">${c.deltaSubs ? (c.deltaSubs > 0 ? '+' : '') + fmt(c.deltaSubs) : '—'}</td>
    <td class="num">${c.newCount}</td><td>${sparkline(c.subHist)}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NEET Niche Command Center</title>
<style>
:root{--plane:#0d0d0d;--surface:#1a1a19;--surface-2:#232322;--surface-3:#2b2b29;--ink:#fff;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--border:rgba(255,255,255,.10);--blue:#3987e5;--orange:#d95926;--violet:#9085e9;--good:#0ca30c;--crit:#d03b3b;--warn:#fab219;--accent:#3987e5}
:root[data-theme=light]{--plane:#f4f4f1;--surface:#fff;--surface-2:#f3f2ee;--surface-3:#e9e8e2;--ink:#0b0b0b;--ink-2:#52514e;--muted:#7c7a74;--grid:#e1e0d9;--border:rgba(11,11,11,.12);--blue:#2a78d6;--orange:#eb6834;--violet:#4a3aa7;--good:#0a7a0a;--crit:#c0392b;--warn:#c98500;--accent:#2a78d6}
*{box-sizing:border-box}body{margin:0;background:var(--plane);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1160px;margin:0 auto;padding:22px 20px 80px}
.bar{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px}
.logo{display:flex;align-items:center;gap:12px}.mk{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,var(--blue),var(--violet));display:grid;place-items:center;color:#fff;font-weight:800}
h1{font-size:18px;margin:0}.tag{font-size:11.5px;color:var(--muted)}
.btn{background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:9px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
.verdict{background:linear-gradient(135deg,color-mix(in srgb,var(--violet) 16%,var(--surface)),var(--surface));border:1px solid var(--border);border-radius:16px;padding:22px;margin-bottom:16px}
.verdict .lab{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);font-weight:700}
.verdict h3{font-size:18px;margin:8px 0 4px}
.vgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}@media(max-width:760px){.vgrid{grid-template-columns:repeat(2,1fr)}}
.vg{background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:13px}.vg .h{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.vg .b{font-size:13px;margin-top:6px;font-weight:600;line-height:1.4}.vg .s{font-size:12px;color:var(--ink-2);margin-top:4px}
.sec{margin-bottom:22px}.sech{display:flex;align-items:center;gap:10px;margin:0 0 12px}.sech h2{font-size:15px;margin:0}.sech .n{font-size:12px;color:var(--muted)}
.vgridw{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:13px}
.vcard{background:var(--surface-2);border:1px solid var(--border);border-radius:11px;overflow:hidden;display:flex;flex-direction:column}
.vcard .tw{position:relative;aspect-ratio:16/9;background:var(--surface-3)}.vcard img{width:100%;height:100%;object-fit:cover;display:block}
.badge{position:absolute;top:7px;left:7px;font-size:10px;font-weight:800;padding:2px 7px;border-radius:6px;text-transform:uppercase}.badge.new{background:var(--good);color:#fff}.badge.up{background:var(--orange);color:#fff}
.vcard .ch{position:absolute;bottom:7px;left:7px;font-size:10.5px;background:rgba(0,0,0,.72);color:#fff;padding:2px 7px;border-radius:5px;max-width:88%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vcard .body{padding:10px 11px;display:flex;flex-direction:column;gap:6px;flex:1}.vcard .t{font-size:12.6px;font-weight:600;line-height:1.34;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.vcard .st{display:flex;gap:9px;font-size:11px;color:var(--muted);margin-top:auto;flex-wrap:wrap}.vcard .st b{color:var(--ink)}.delta{color:var(--good);font-weight:700}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:16px}
.bars{display:flex;flex-direction:column;gap:8px}.barr{display:grid;grid-template-columns:minmax(80px,150px) 1fr 42px;gap:10px;align-items:center}.barr .k{font-size:12px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.barr .tr{height:14px;background:var(--surface-3);border-radius:5px;overflow:hidden}.barr .fl{height:100%;border-radius:5px;background:var(--blue)}.barr .v{font-size:11.5px;text-align:right;font-variant-numeric:tabular-nums}
.chips{display:flex;flex-wrap:wrap;gap:7px}.kchip{background:var(--surface-2);border:1px solid var(--border);border-radius:999px;padding:4px 11px;font-size:12px;color:var(--ink-2)}.kchip.hot{border-color:var(--orange);color:var(--ink)}
.istats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}.istat{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:11px}.istat .n{font-size:19px;font-weight:650}.istat .d{font-size:11px;color:var(--muted);margin-top:2px}
.cmt{background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:11px 12px;margin-bottom:9px}.cmt .top{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--muted);margin-bottom:4px}.cmt .txt{font-size:12.7px;line-height:1.5}.cmt .src{font-size:10.5px;color:var(--muted);margin-top:5px;font-style:italic}.cmt.demand{border-left:3px solid var(--warn)}.cmt.panic{border-left:3px solid var(--crit)}
.flagrow{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.flag{font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;text-transform:uppercase}.flag.q{background:color-mix(in srgb,var(--blue) 18%,transparent);color:var(--blue)}.flag.f{background:color-mix(in srgb,var(--warn) 20%,transparent);color:var(--warn)}.flag.p{background:color-mix(in srgb,var(--crit) 18%,transparent);color:var(--crit)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--grid)}th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase}td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.up{color:var(--good)}.dn{color:var(--crit)}
.alert{background:color-mix(in srgb,var(--crit) 12%,transparent);border:1px solid color-mix(in srgb,var(--crit) 40%,transparent);border-radius:10px;padding:12px 14px;font-size:13px;margin-bottom:14px}
.empty{color:var(--muted);font-size:13.5px;text-align:center;padding:30px 10px}
.foot{color:var(--muted);font-size:11.5px;text-align:center;margin-top:26px;line-height:1.7}
.tcol{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:700px){.tcol{grid-template-columns:1fr}.vgrid{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="wrap">
<div class="bar"><div class="logo"><div class="mk">◆</div><div><h1>NEET Niche Command Center</h1><div class="tag">Auto-updated ${new Date(now).toUTCString()} · ${brief.perChannel.length} channels</div></div></div>
<button class="btn" onclick="const r=document.documentElement;r.dataset.theme=r.dataset.theme==='light'?'dark':'light'">◐ Theme</button></div>

${alerts.length ? `<div class="alert">🚨 <b>${alerts.length} alert${alerts.length > 1 ? 's' : ''}:</b> ${alerts.map(a => a.type === 'spike' ? `"${esc(a.title)}" (${esc(a.channel)}) jumped +${fmt(a.delta)} views` : `${esc(a.channel)} subs changed ${a.deltaSubs > 0 ? '+' : ''}${fmt(a.deltaSubs)}`).join(' · ')}</div>` : ''}

<div class="verdict"><div class="lab">◆ Verdict — what's working</div><h3>${esc(V.headline)}</h3>
<div class="vgrid">
<div class="vg"><div class="h">🎯 Topic</div><div class="b">${esc(V.topTopic)}</div><div class="s">Highest-pull theme.</div></div>
<div class="vg"><div class="h">✍️ Title formula</div><div class="b">${esc(V.formula)}</div></div>
<div class="vg"><div class="h">🖼️ Thumbnail</div><div class="b" style="font-size:12px">${esc(V.thumb)}</div></div>
<div class="vg"><div class="h">❤️‍🔥 Student emotion</div><div class="b">${esc(V.emotion)}</div></div>
</div></div>

${brief.firstRun ? `<div class="alert" style="background:color-mix(in srgb,var(--warn) 12%,transparent);border-color:color-mix(in srgb,var(--warn) 40%,transparent)">First run — this is your <b>baseline</b>. Tomorrow's run shows true day-over-day movement.</div>` : ''}

<div class="sec"><div class="sech"><h2>🆕 New uploads</h2><span class="n">${brief.allNew.length} since last run</span></div>
${brief.allNew.length ? `<div class="vgridw">${[...brief.allNew].sort((a, b) => new Date(b.published) - new Date(a.published)).map(vcard).join('')}</div>` : '<div class="empty">Nothing new since last run.</div>'}</div>

<div class="sec"><div class="sech"><h2>🔥 Biggest movers</h2><span class="n">${brief.firstRun ? 'top by views (baseline)' : 'by view velocity'}</span></div>
<div class="vgridw">${brief.allMovers.slice(0, 12).map(vcard).join('') || '<div class="empty">No movement yet.</div>'}</div></div>

<div class="sec"><div class="sech"><h2>📈 Trending topics & title angles</h2></div>
<div class="istats">
<div class="istat"><div class="n">${brief.tStats.year}%</div><div class="d">titles use a year</div></div>
<div class="istat"><div class="n">${brief.tStats.emoji}%</div><div class="d">use emoji</div></div>
<div class="istat"><div class="n">${brief.tStats.caps}%</div><div class="d">ALL-CAPS word</div></div>
<div class="istat"><div class="n">${brief.tStats.q}%</div><div class="d">ask a question</div></div>
<div class="istat"><div class="n">${brief.tStats.avgLen}</div><div class="d">avg title chars</div></div></div>
<div class="tcol"><div><h2 style="font-size:13px;margin:0 0 10px">Top title words (by views)</h2><div class="bars">${brief.kw.map(k => bar(k.w, k.score / maxK * 100, fmt(k.score))).join('') || '<div class="empty">—</div>'}</div></div>
<div><h2 style="font-size:13px;margin:0 0 10px">Recurring tags/keywords</h2><div class="chips">${brief.tags.map(t => `<span class="kchip ${t.c >= 3 ? 'hot' : ''}">${esc(t.k)} <b>${t.c}</b></span>`).join('') || '<div class="empty">Tags hidden.</div>'}</div></div></div></div>

<div class="sec"><div class="sech"><h2>💬 Comment demand & FOMO</h2><span class="n">${C.total} comments</span></div>
${C.total ? `<div class="istats"><div class="istat"><div class="n">${C.questions}</div><div class="d">direct questions</div></div><div class="istat"><div class="n">${C.panic}</div><div class="d">panic signals</div></div><div class="istat"><div class="n">${C.demandKw.length}</div><div class="d">demand themes</div></div></div>
<h2 style="font-size:13px;margin:0 0 10px">What they keep bringing up</h2><div class="bars" style="margin-bottom:16px">${C.demandKw.map(d => bar(d.k, d.v / maxD * 100, d.v)).join('') || '<div class="empty">—</div>'}</div>
<h2 style="font-size:13px;margin:0 0 10px">Top demand & FOMO comments</h2>${C.demand.slice(0, 15).map(c => { const cls = c.panic.length ? 'panic' : (c.fomo.length || c.isQ ? 'demand' : ''); const fl = [c.isQ ? '<span class="flag q">question</span>' : '', c.fomo.length ? `<span class="flag f">FOMO: ${c.fomo.slice(0, 3).map(esc).join(', ')}</span>` : '', c.panic.length ? '<span class="flag p">panic</span>' : ''].join(''); return `<div class="cmt ${cls}"><div class="top"><span>👍 ${c.likes}</span><span>${esc(c.author || '')}</span></div><div class="txt">${esc(c.text).slice(0, 320)}</div><div class="src">on: ${esc(c.video)}</div>${fl ? `<div class="flagrow">${fl}</div>` : ''}</div>`; }).join('')}` : '<div class="empty">No comments mined.</div>'}</div>

<div class="sec"><div class="sech"><h2>📊 Channel trends</h2><span class="n">subscribers over your run history</span></div>
<div class="panel" style="padding:6px 14px"><table><thead><tr><th>Channel</th><th class="num">Subs</th><th class="num">Δ since last</th><th class="num">New</th><th>Trend</th></tr></thead><tbody>${channelRows || '<tr><td class="empty" colspan="5">No data.</td></tr>'}</tbody></table></div></div>

<div class="foot">Auto-generated daily by GitHub Actions · data via YouTube Data API v3 · built with Claude.<br>Paste the brief into Claude for a full content plan.</div>
</div></body></html>`;
}
