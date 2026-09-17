#!/usr/bin/env node
// Pulls hero-vs-hero matchup stats and writes js/matchups.js.
//   public games: STRATZ, Divine/Immortal, last N full weeks of the current patch (needs STRATZ_TOKEN in .env)
//   pro games:    OpenDota explorer, whole current patch
// Usage: node tools/fetch-matchups.mjs [--weeks 8] [--bracket DIVINE_IMMORTAL] [--top 10]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const WEEKS = Number(opt("weeks", 8));
const BRACKET = opt("bracket", "DIVINE_IMMORTAL");
const TOP = Number(opt("top", 10));
const MIN_GAMES = Number(opt("min-games", 200));
const HEROES_PER_QUERY = 16;
const REQUEST_GAP_MS = 1100; // STRATZ allows ~149 requests a minute

function loadToken() {
  if (process.env.STRATZ_TOKEN) return process.env.STRATZ_TOKEN.trim();
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    const m = /^STRATZ_TOKEN=(.+)$/m.exec(readFileSync(envPath, "utf8"));
    if (m && m[1].trim()) return m[1].trim();
  }
  console.error("STRATZ_TOKEN is not set. Copy .env.example to .env and add your token from https://stratz.com/api");
  process.exit(1);
}
const TOKEN = loadToken();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequest = 0;

async function stratz(query, attempt = 1) {
  const wait = lastRequest + REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch("https://api.stratz.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, "User-Agent": "STRATZ_API" },
    body: JSON.stringify({ query }),
  });
  if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
    console.log(`  STRATZ ${res.status}, retrying in ${attempt * 5}s`);
    await sleep(attempt * 5000);
    return stratz(query, attempt + 1);
  }
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch {}
  if (!res.ok || body.errors) {
    // STRATZ ties a token to the IP that first used it, so the same token fails
    // from a CI runner, a VPN or another machine.
    const hint = res.status === 403
      ? ` (${text.trim() || "forbidden"}. A STRATZ token only works from one IP address, and the rate limit is 149 requests a minute)`
      : "";
    throw new Error(`STRATZ ${res.status}${hint}: ${JSON.stringify(body.errors || text).slice(0, 300)}`);
  }
  return body.data;
}

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt >= 4) throw new Error(`${url} -> ${res.status}`);
    await sleep(attempt * 4000);
  }
}

function loadGraph() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, "js", "data.js"), "utf8") + "\n;this.GRAPH = GRAPH;", ctx);
  return ctx.GRAPH;
}

// ---------- heroes and patch ----------
const graph = loadGraph();
const graphIds = new Set(graph.nodes.map((n) => n.id));

console.log("OpenDota: heroes and patches");
const odHeroes = Object.values(await getJson("https://api.opendota.com/api/constants/heroes"));
const patches = await getJson("https://api.opendota.com/api/constants/patch");
const patch = patches.at(-1);
const patchStart = Math.floor(new Date(patch.date).getTime() / 1000);

const NAME_FIX = {}; // OpenDota name -> data.js id, if they ever differ
const heroName = new Map();
for (const h of odHeroes) {
  const name = NAME_FIX[h.localized_name] || h.localized_name;
  heroName.set(h.id, name);
}
const unmapped = [...heroName.values()].filter((n) => !graphIds.has(n));
const missing = [...graphIds].filter((id) => ![...heroName.values()].includes(id));
if (unmapped.length || missing.length) {
  console.error("Hero names don't line up with js/data.js:", { unmapped, missing });
  process.exit(1);
}
const heroIds = [...heroName.keys()].sort((a, b) => a - b);

// ---------- weeks ----------
console.log(`STRATZ: weeks (${BRACKET})`);
const weekData = await stratz(`{ heroStats { winWeek(heroIds: [1], take: 30) { week } } }`);
const weeks = [...new Set(weekData.heroStats.winWeek.map((w) => w.week))]
  .filter((w) => w >= patchStart)
  .sort((a, b) => b - a)
  .slice(0, WEEKS);
if (!weeks.length) throw new Error("No full weeks found in the current patch");
const day = (s) => new Date(s * 1000).toISOString().slice(0, 10);
console.log(`  ${weeks.length} weeks: ${day(weeks.at(-1))} .. ${day(weeks[0] + 7 * 86400)}`);

// ---------- matchups ----------
// pair key "a|b" = hero a's games against hero b
const pairs = new Map();
const addPair = (a, b, games, wins, synergy) => {
  const key = `${a}|${b}`;
  const p = pairs.get(key) || { games: 0, wins: 0, synergyWeighted: 0 };
  p.games += games;
  p.wins += wins;
  p.synergyWeighted += Number(synergy) * games;
  pairs.set(key, p);
};

const batches = [];
for (let i = 0; i < heroIds.length; i += HEROES_PER_QUERY) batches.push(heroIds.slice(i, i + HEROES_PER_QUERY));
const total = weeks.length * batches.length;
let done = 0;
for (const week of weeks) {
  for (const batch of batches) {
    const fields = batch.map((id) => `h${id}: heroVsHeroMatchup(heroId: ${id}, bracketBasicIds: [${BRACKET}], week: ${week}, take: 200) {
      advantage { heroId vs { heroId2 matchCount winCount synergy } }
      disadvantage { heroId vs { heroId2 matchCount winCount synergy } } }`).join("\n");
    const data = await stratz(`{ heroStats { ${fields} } }`);
    for (const id of batch) {
      const m = data.heroStats[`h${id}`];
      const seen = new Set();
      for (const side of [m?.advantage?.[0], m?.disadvantage?.[0]]) {
        for (const v of side?.vs || []) {
          if (seen.has(v.heroId2)) continue;
          seen.add(v.heroId2);
          addPair(id, v.heroId2, v.matchCount, v.winCount, v.synergy);
        }
      }
    }
    done++;
    if (done % 10 === 0 || done === total) console.log(`  matchups ${done}/${total}`);
  }
}

// ---------- positions ----------
console.log("STRATZ: positions");
const positions = new Map(heroIds.map((id) => [id, [0, 0, 0, 0, 0]]));
for (const week of weeks) {
  const data = await stratz(`{ heroStats { stats(bracketBasicIds: [${BRACKET}], groupByPosition: true, week: ${week}) { heroId position matchCount } } }`);
  for (const s of data.heroStats.stats) {
    const idx = Number(String(s.position).replace("POSITION_", "")) - 1;
    if (positions.has(s.heroId) && idx >= 0 && idx < 5) positions.get(s.heroId)[idx] += s.matchCount;
  }
}

// ---------- pro games ----------
console.log("OpenDota: pro matchups this patch");
const sql = `SELECT pm1.hero_id h, pm2.hero_id o, count(*) games,
  sum(CASE WHEN (pm1.player_slot < 128) = m.radiant_win THEN 1 ELSE 0 END) wins
  FROM matches m
  JOIN player_matches pm1 ON pm1.match_id = m.match_id
  JOIN player_matches pm2 ON pm2.match_id = m.match_id
  WHERE m.start_time >= ${patchStart} AND (pm1.player_slot < 128) <> (pm2.player_slot < 128)
  GROUP BY h, o`;
let pro = new Map();
try {
  const res = await getJson(`https://api.opendota.com/api/explorer?sql=${encodeURIComponent(sql)}`);
  pro = new Map(res.rows.map((r) => [`${r.h}|${r.o}`, { games: Number(r.games), wins: Number(r.wins) }]));
  console.log(`  ${res.rows.length} pro hero pairs`);
} catch (e) {
  console.log(`  skipped pro data: ${e.message}`);
}

// ---------- build ----------
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const heroes = {};
const raw = {};

for (const id of heroIds) {
  const name = heroName.get(id);
  const pos = positions.get(id);
  const posTotal = pos.reduce((a, b) => a + b, 0) || 1;
  const supportShare = (pos[3] + pos[4]) / posTotal;
  let games = 0, wins = 0;
  for (const other of heroIds) {
    const p = pairs.get(`${id}|${other}`);
    if (p) { games += p.games; wins += p.wins; }
  }

  // how well each opponent does against this hero
  const opponents = [];
  for (const other of heroIds) {
    if (other === id) continue;
    const p = pairs.get(`${id}|${other}`);
    if (!p || !p.games) continue;
    const q = pairs.get(`${other}|${id}`);
    // synergy is from this hero's side; average with the opponent's own view when present
    const own = -p.synergyWeighted / p.games;
    const adv = q && q.games ? (own + q.synergyWeighted / q.games) / 2 : own;
    const winRate = 100 * (1 - p.wins / p.games);
    // conservative score: advantage minus ~2 standard errors of a win rate over this many games
    const score = adv - 1.96 * 50 / Math.sqrt(p.games);
    const pr = pro.get(`${other}|${id}`);
    opponents.push({ id: other, adv, winRate, games: p.games, score, pro: pr ? [pr.games, pr.wins] : null });
  }
  raw[name] = { positions: pos, supportShare, opponents: opponents.map((o) => ({ ...o, hero: heroName.get(o.id) })) };

  heroes[name] = {
    role: supportShare >= 0.5 ? "support" : "core",
    position: pos.indexOf(Math.max(...pos)) + 1,
    supportShare: round(supportShare, 3),
    games: Math.round(games / 5), // every match counts once per enemy hero
    winRate: round(100 * wins / (games || 1)),
    counters: {},
  };
  heroes[name].__opponents = opponents;
}

for (const [name, h] of Object.entries(heroes)) {
  for (const type of ["support", "core"]) {
    h.counters[type] = h.__opponents
      .filter((o) => heroes[heroName.get(o.id)].role === type && o.games >= MIN_GAMES && o.adv > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP)
      .map((o) => {
        const row = { hero: heroName.get(o.id), adv: round(o.adv), winRate: round(o.winRate), games: o.games };
        if (o.pro) row.pro = o.pro;
        return row;
      });
  }
  delete h.__opponents;
}

const meta = {
  source: "STRATZ public matches, OpenDota pro matches",
  bracket: BRACKET,
  patch: patch.name,
  from: day(weeks.at(-1)),
  to: day(weeks[0] + 7 * 86400),
  weeks: weeks.length,
  minGames: MIN_GAMES,
  fetched: new Date().toISOString().slice(0, 10),
};

// Keep the old file when only the fetch date would change, so a scheduled run
// doesn't produce a diff with no new numbers in it.
function sameButForDate(oldSrc, newSrc) {
  const strip = (s) => s.replace(/"fetched":"[^"]*"/, "");
  return strip(oldSrc) === strip(newSrc);
}

mkdirSync(join(ROOT, "data-cache"), { recursive: true });
// ability text for `counterweb facts`
console.log("OpenDota: ability constants");
writeFileSync(join(ROOT, "data-cache", "heroes.json"), JSON.stringify(await getJson("https://api.opendota.com/api/constants/heroes")));
writeFileSync(join(ROOT, "data-cache", "hero_abilities.json"), JSON.stringify(await getJson("https://api.opendota.com/api/constants/hero_abilities")));
writeFileSync(join(ROOT, "data-cache", "abilities.json"), JSON.stringify(await getJson("https://api.opendota.com/api/constants/abilities")));
writeFileSync(join(ROOT, "data-cache", "items.json"), JSON.stringify(await getJson("https://api.opendota.com/api/constants/items")));
writeFileSync(join(ROOT, "data-cache", "matchups-raw.json"), JSON.stringify({ meta, raw }, null, 1));
const matchupsPath = join(ROOT, "js", "matchups.js");
const newSrc =
  `// Generated by tools/fetch-matchups.mjs. Don't edit by hand.\n` +
  `// adv: how many % points better the counter does in this matchup than expected. winRate: counter's win rate vs the hero.\n` +
  `// pro: [games, counter wins] in pro matches this patch.\n` +
  `const MATCHUPS = ${JSON.stringify({ meta, heroes })};\n`;
const oldSrc = existsSync(matchupsPath) ? readFileSync(matchupsPath, "utf8") : "";
if (oldSrc && sameButForDate(oldSrc, newSrc)) {
  console.log("Numbers are identical to the ones already in js/matchups.js, leaving it alone.");
} else {
  writeFileSync(matchupsPath, newSrc);
}
const size = Buffer.byteLength(readFileSync(join(ROOT, "js", "matchups.js")));
console.log(`Wrote js/matchups.js (${Math.round(size / 1024)} KB) and data-cache/matchups-raw.json`);
