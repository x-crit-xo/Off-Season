// Off Season leaderboard API: Cloudflare Pages Function + D1 database.
// Route: /api/scores   GET = top 50, POST = submit a score.
// Needs a D1 binding named DB (see README).

const FACTIONS = ["burton","capita","dwd","signal","nidecker","salomon","gnu","k2","nitro","yes","ride","dope"];
const MAX_SCORE = 450000;   // hard cap on any single score
const PER_SECOND = 300;     // most points that are plausible per second survived
const BLOCKED = [];         // lowercase words to refuse in names, e.g. ["word1", "word2"]

const json = (o, status = 200, h = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });

async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, "0")).join("").slice(0, 20);
}
const cleanName = n => String(n ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 12);
const blocked = n => { const t = n.toLowerCase().replace(/[^a-z0-9]/g, ""); return BLOCKED.some(w => w && t.includes(w)); };
const cacheKey = url => new Request(new URL("/api/scores", url).toString());

export async function onRequestGet({ env, request, waitUntil }) {
  const cache = caches.default, key = cacheKey(request.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  const { results } = await env.DB.prepare("SELECT id, name, faction, score FROM scores ORDER BY score DESC LIMIT 50").all();
  const res = json({ scores: results }, 200, { "cache-control": "public, max-age=30" });
  waitUntil(cache.put(key, res.clone()));
  return res;
}

export async function onRequestPost({ env, request, waitUntil }) {
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const uid = String(b.uid || ""), faction = String(b.faction || ""), score = Number(b.score), secs = Number(b.secs);
  if (!/^[A-Za-z0-9-]{16,64}$/.test(uid)) return json({ error: "bad id" }, 400);
  if (!FACTIONS.includes(faction)) return json({ error: "bad faction" }, 400);
  if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return json({ error: "bad score" }, 400);
  if (!Number.isFinite(secs) || secs < 1 || score > secs * PER_SECOND + 500) return json({ error: "score not plausible" }, 400);
  const name = cleanName(b.name) || "Anon";
  if (blocked(name)) return json({ error: "name not allowed" }, 400);

  const id = await sha(uid);
  const cur = await env.DB.prepare("SELECT score, name, faction FROM scores WHERE id = ?1").bind(id).first();
  // Nothing new to save: skip the write (keeps you far below the free write limit).
  if (cur && score <= cur.score && name === cur.name && faction === cur.faction) return json({ ok: true, best: cur.score });

  await env.DB.prepare(
    `INSERT INTO scores (id, name, faction, score, at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, faction = excluded.faction,
       at = CASE WHEN excluded.score > scores.score THEN excluded.at ELSE scores.at END,
       score = MAX(scores.score, excluded.score)`
  ).bind(id, name, faction, score, Date.now()).run();
  waitUntil(caches.default.delete(cacheKey(request.url)));
  return json({ ok: true, best: Math.max(score, cur ? cur.score : 0) });
}
