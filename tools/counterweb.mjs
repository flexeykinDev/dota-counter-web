#!/usr/bin/env node
// Command line tool for js/data.js: validate the graph, print stats, look up a hero,
// and rebuild counters from js/matchups.js.
// Usage: node tools/counterweb.mjs <check|stats|hero|plan|facts|apply|help> [args]

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = join(ROOT, "js", "data.js");
const MATCHUPS_PATH = join(ROOT, "js", "matchups.js");

const PORTRAIT_SIZE = [120, 68];
const ICON_SIZE = [88, 64];
const LINK_TYPES = ["support", "core"];
// A counter needs at least this edge (% points over the expected win rate) to be listed.
const MIN_ADV = 1.5;
const MAX_PER_TYPE = 3;
// Icons are drawn with object-fit cover, so a couple of pixels off is fine.
const SIZE_TOLERANCE = 4;
const sizeOff = (size, expected) =>
  Math.abs(size[0] - expected[0]) > SIZE_TOLERANCE || Math.abs(size[1] - expected[1]) > SIZE_TOLERANCE;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = paint(31), yellow = paint(33), green = paint(32), blue = paint(34), dim = paint(2), bold = paint(1);

function loadData(path = DATA_PATH) {
  const src = readFileSync(path, "utf8");
  const ctx = {};
  vm.createContext(ctx);
  // data.js declares top-level consts, which don't land on the context object on their own
  vm.runInContext(src + "\n;this.GRAPH = GRAPH; this.IMAGES = IMAGES;", ctx, { filename: "data.js" });
  if (existsSync(MATCHUPS_PATH)) {
    vm.runInContext(readFileSync(MATCHUPS_PATH, "utf8") + "\n;this.MATCHUPS = MATCHUPS;", ctx, { filename: "matchups.js" });
  }
  return { GRAPH: ctx.GRAPH, IMAGES: ctx.IMAGES, MATCHUPS: ctx.MATCHUPS || null, src, bytes: Buffer.byteLength(src) };
}

// The counters the matchup data picks for a hero: best edge first, up to 3 per type.
function selectCounters(MATCHUPS, hero) {
  const h = MATCHUPS.heroes[hero];
  const pick = (type) => (h?.counters[type] || []).filter((c) => c.adv >= MIN_ADV).slice(0, MAX_PER_TYPE);
  return { support: pick("support"), core: pick("core") };
}

const matchupRow = (MATCHUPS, hero, counter, type) =>
  MATCHUPS?.heroes[hero]?.counters[type]?.find((c) => c.hero === counter) || null;

const fmtGames = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

// data.js with one node and one link per line, so diffs stay readable
function writeData(src, GRAPH) {
  const imagesAt = src.indexOf("const IMAGES");
  if (imagesAt < 0) throw new Error("const IMAGES not found in data.js");
  const out = "const GRAPH = {\"nodes\": [\n" +
    GRAPH.nodes.map((n) => JSON.stringify(n)).join(",\n") +
    "\n], \"links\": [\n" +
    GRAPH.links.map((l) => JSON.stringify({ source: l.source, target: l.target, type: l.type, desc: l.desc })).join(",\n") +
    "\n]};\n" + src.slice(imagesAt);
  writeFileSync(DATA_PATH, out);
}

// Reads width/height from a base64 WebP data URI (VP8, VP8L or VP8X chunk).
function webpSize(uri) {
  const m = /^data:image\/webp;base64,(.+)$/.exec(uri || "");
  if (!m) return null;
  const b = Buffer.from(m[1], "base64");
  if (b.length < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  return null;
}

function check({ GRAPH, IMAGES, MATCHUPS }) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);

  if (!GRAPH || !Array.isArray(GRAPH.nodes) || !Array.isArray(GRAPH.links)) {
    err("GRAPH must have nodes[] and links[]");
    return { errors, warnings };
  }
  if (!IMAGES || typeof IMAGES !== "object") err("IMAGES is missing");

  const ids = new Set();
  for (const [i, n] of GRAPH.nodes.entries()) {
    const where = n && n.id ? n.id : `nodes[${i}]`;
    if (!n || typeof n.id !== "string" || !n.id.trim()) { err(`${where}: missing id`); continue; }
    if (n.id !== n.id.trim()) err(`${where}: id has leading or trailing spaces`);
    if (ids.has(n.id)) err(`${where}: duplicate id`);
    ids.add(n.id);
    if (!n.role || !String(n.role).trim()) err(`${where}: missing role`);

    const item = n.item;
    if (!item) { err(`${where}: missing item`); continue; }
    if (!item.name || !String(item.name).trim()) err(`${where}: item has no name`);
    if (!item.desc || !String(item.desc).trim()) err(`${where}: item has no desc`);
    if (!Array.isArray(item.icons)) { err(`${where}: item.icons must be an array`); continue; }
    if (!item.icons.length) warn(`${where}: item "${item.name}" has no icons`);
    for (const icon of item.icons) {
      if (!icon.label) err(`${where}: an item icon has no label`);
      const size = webpSize(icon.url);
      if (!size) err(`${where}: icon "${icon.label}" is not a valid webp data URI`);
      else if (sizeOff(size, ICON_SIZE))
        warn(`${where}: icon "${icon.label}" is ${size.join("x")}, expected ${ICON_SIZE.join("x")}`);
    }
    for (const [field, value] of [["role", n.role], ["item.name", item.name], ["item.desc", item.desc]]) {
      if (/[<>]/.test(value || "")) err(`${where}: ${field} contains < or >, which breaks the info panel HTML`);
    }
  }

  for (const id of ids) {
    const size = webpSize(IMAGES?.[id]);
    if (!IMAGES?.[id]) err(`${id}: no portrait in IMAGES`);
    else if (!size) err(`${id}: portrait is not a valid webp data URI`);
    else if (sizeOff(size, PORTRAIT_SIZE))
      warn(`${id}: portrait is ${size.join("x")}, expected ${PORTRAIT_SIZE.join("x")}`);
  }
  for (const key of Object.keys(IMAGES || {})) {
    if (!ids.has(key)) warn(`IMAGES["${key}"] does not match any hero id`);
  }

  const seen = new Set();
  const counters = new Map([...ids].map((id) => [id, { support: [], core: [] }]));
  for (const [i, l] of GRAPH.links.entries()) {
    const where = `links[${i}] ${l.source} <- ${l.target}`;
    if (!ids.has(l.source)) err(`${where}: source "${l.source}" is not a hero id`);
    if (!ids.has(l.target)) err(`${where}: target "${l.target}" is not a hero id`);
    if (l.source === l.target) err(`${where}: a hero can't counter itself`);
    if (!LINK_TYPES.includes(l.type)) err(`${where}: type must be "support" or "core", got "${l.type}"`);
    if (!l.desc || !String(l.desc).trim()) err(`${where}: missing desc`);
    if (/[<>]/.test(l.desc || "")) err(`${where}: desc contains < or >, which breaks the info panel HTML`);
    const key = `${l.source}|${l.target}|${l.type}`;
    if (seen.has(key)) err(`${where}: duplicate link`);
    seen.add(key);
    if (counters.has(l.source) && LINK_TYPES.includes(l.type)) counters.get(l.source)[l.type].push(l.target);
  }

  // Every hero should list at least one support and one core counter.
  for (const [id, c] of counters) {
    for (const type of LINK_TYPES) {
      // with matchup data, an empty list is fine when no hero clears the bar
      const available = MATCHUPS ? selectCounters(MATCHUPS, id)[type].length : 1;
      if (c[type].length === 0 && available > 0) warn(`${id}: no ${type} counter`);
      if (c[type].length > MAX_PER_TYPE) err(`${id}: ${c[type].length} ${type} counters, max is ${MAX_PER_TYPE}`);
    }
  }

  // Counters should be backed by the matchup data, listed best first, in the role the hero is played.
  if (MATCHUPS) {
    for (const id of Object.keys(MATCHUPS.heroes)) if (!ids.has(id)) warn(`matchups.js has "${id}", which is not a hero id`);
    for (const [id, c] of counters) {
      if (!MATCHUPS.heroes[id]) { warn(`${id}: no matchup data`); continue; }
      for (const type of LINK_TYPES) {
        const ranked = MATCHUPS.heroes[id].counters[type] || [];
        let lastRank = -1;
        for (const target of c[type]) {
          const row = matchupRow(MATCHUPS, id, target, type);
          const role = MATCHUPS.heroes[target]?.role;
          if (role && role !== type) warn(`${id} <- ${target}: listed as a ${type} counter, but ${target} is played as ${role}`);
          else if (!row) warn(`${id} <- ${target}: not among the data's top ${type} counters`);
          else if (row.adv < MIN_ADV) warn(`${id} <- ${target}: edge is only +${row.adv}, needs +${MIN_ADV}`);
          const rank = ranked.indexOf(row);
          if (row && rank < lastRank) warn(`${id}: ${type} counters are not in the data's order (${target})`);
          if (row) lastRank = rank;
        }
      }
    }
  }

  return { errors, warnings };
}

function stats(data) {
  const { GRAPH, IMAGES, bytes } = data;
  const countedBy = new Map(GRAPH.nodes.map((n) => [n.id, 0]));
  GRAPH.links.forEach((l) => countedBy.set(l.target, (countedBy.get(l.target) || 0) + 1));
  const byType = Object.fromEntries(LINK_TYPES.map((t) => [t, GRAPH.links.filter((l) => l.type === t).length]));
  const items = new Map();
  GRAPH.nodes.forEach((n) => {
    const name = n.item?.name;
    if (name) items.set(name, (items.get(name) || 0) + 1);
  });
  const top = [...countedBy].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topItems = [...items].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const never = [...countedBy].filter(([, n]) => n === 0).map(([id]) => id);

  console.log(bold("The Counter Web data"));
  console.log(`  heroes            ${GRAPH.nodes.length}`);
  console.log(`  counter links     ${GRAPH.links.length}  (${blue(byType.support + " support")}, ${red(byType.core + " core")})`);
  console.log(`  portraits         ${Object.keys(IMAGES).length}`);
  console.log(`  unique items      ${items.size}`);
  console.log(`  data.js size      ${(bytes / 1024).toFixed(0)} KB`);
  console.log(bold("\nCounters the most heroes"));
  top.forEach(([id, n]) => console.log(`  ${String(n).padStart(3)}  ${id}`));
  console.log(bold("\nMost recommended items"));
  topItems.forEach(([name, n]) => console.log(`  ${String(n).padStart(3)}  ${name}`));
  console.log(bold(`\nHeroes that counter nobody (${never.length})`));
  console.log(dim("  " + (never.join(", ") || "none")));
}

function findHero(GRAPH, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return null;
  return GRAPH.nodes.find((n) => n.id.toLowerCase() === q)
    || GRAPH.nodes.find((n) => n.id.toLowerCase().startsWith(q))
    || GRAPH.nodes.find((n) => n.id.toLowerCase().includes(q))
    || null;
}

function statLine(row) {
  if (!row) return dim("no matchup data");
  let s = `${green("+" + row.adv)} edge, ${row.winRate}% win, ${fmtGames(row.games)} games`;
  if (row.pro) s += dim(`, pro ${row.pro[1]}-${row.pro[0] - row.pro[1]}`);
  return s;
}

function hero(data, query) {
  const { GRAPH, MATCHUPS } = data;
  if (!query) { console.error("usage: counterweb hero <name>"); return 1; }
  const node = findHero(GRAPH, query);
  if (!node) { console.error(red(`No hero matches "${query}"`)); return 1; }

  const countered = GRAPH.links.filter((l) => l.source === node.id);
  const counters = GRAPH.links.filter((l) => l.target === node.id).map((l) => l.source);
  const m = MATCHUPS?.heroes[node.id];

  console.log(`${bold(node.id)}  ${dim(node.role)}${m ? dim(`  pos ${m.position}, ${m.winRate}% win, ${fmtGames(m.games)} games`) : ""}`);
  for (const l of countered) {
    const label = l.type === "support" ? blue("Support counter") : red("Core counter   ");
    console.log(`  ${label}  ${bold(l.target)}  ${statLine(matchupRow(MATCHUPS, node.id, l.target, l.type))}`);
    console.log(`                   ${dim(l.desc)}`);
  }
  console.log(`  ${yellow("Silver bullet  ")}  ${bold(node.item.name)}`);
  console.log(`                   ${dim(node.item.desc)}`);
  console.log(`  ${green("Counters       ")}  ${[...new Set(counters)].join(", ") || dim("nobody")}`);
  return 0;
}

// Shows the counters the data picks, next to what data.js has now.
// --json prints a reasons template for `apply`, with current reasons filled in.
function plan(data, names, asJson) {
  const { GRAPH, MATCHUPS } = data;
  if (!MATCHUPS) { console.error(red("js/matchups.js is missing. Run tools/fetch-matchups.mjs first.")); return 1; }
  const nodes = names.length ? names.map((n) => findHero(GRAPH, n)) : GRAPH.nodes;
  if (nodes.some((n) => !n)) { console.error(red(`Unknown hero in: ${names.join(", ")}`)); return 1; }

  const template = {};
  for (const node of nodes) {
    const picked = selectCounters(MATCHUPS, node.id);
    const current = GRAPH.links.filter((l) => l.source === node.id);
    template[node.id] = {};
    if (!asJson) console.log(`\n${bold(node.id)}  ${dim(MATCHUPS.heroes[node.id].role + ", pos " + MATCHUPS.heroes[node.id].position)}`);
    for (const type of LINK_TYPES) {
      for (const row of picked[type]) {
        const have = current.find((l) => l.target === row.hero);
        template[node.id][row.hero] = have ? have.desc : "";
        if (!asJson) {
          const label = type === "support" ? blue("support") : red("core   ");
          console.log(`  ${label} ${row.hero.padEnd(20)} ${statLine(row)} ${have ? dim("(has reason)") : yellow("(new)")}`);
        }
      }
    }
    if (!asJson) {
      for (const l of current.filter((l) => !(l.target in template[node.id]))) console.log(`  ${dim("drop    " + l.target)}`);
    }
  }
  if (asJson) console.log(JSON.stringify(template, null, 2));
  return 0;
}

// Ability text from OpenDota's game constants, cached by fetch-matchups.mjs in data-cache/.
function facts(data, names) {
  const need = ["heroes.json", "hero_abilities.json", "abilities.json"].map((f) => join(ROOT, "data-cache", f));
  if (need.some((f) => !existsSync(f))) { console.error(red("data-cache is missing. Run tools/fetch-matchups.mjs first.")); return 1; }
  const [heroes, heroAbilities, abilities] = need.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const byName = new Map(Object.values(heroes).map((h) => [h.localized_name.toLowerCase(), h]));
  for (const name of names) {
    const node = findHero(data.GRAPH, name);
    const h = node && byName.get(node.id.toLowerCase());
    if (!h) { console.log(red(`No ability data for "${name}"`)); continue; }
    console.log(`\n${bold(node.id)}  ${dim(h.attack_type + ", " + h.roles.join("/"))}`);
    for (const key of heroAbilities[h.name]?.abilities || []) {
      const a = abilities[key];
      if (!a || !a.dname || key === "generic_hidden") continue;
      const tags = [a.dmg_type && `${a.dmg_type} dmg`, a.bkbpierce === "Yes" && "pierces BKB", a.dispellable && `dispel: ${a.dispellable}`].filter(Boolean).join(", ");
      const desc = String(a.desc || "").replace(/\s+/g, " ").slice(0, 260);
      console.log(`  ${bold(a.dname)}${tags ? dim(" [" + tags + "]") : ""}: ${desc}`);
    }
  }
  return 0;
}

// Replaces heroes' counters with the data's picks, using reasons from a JSON file:
// { "Hero": { "Counter": "one-line reason", ... }, ... }
function apply(data, file) {
  const { GRAPH, MATCHUPS, src } = data;
  if (!MATCHUPS) { console.error(red("js/matchups.js is missing.")); return 1; }
  if (!file || !existsSync(file)) { console.error(red("usage: counterweb apply <reasons.json>")); return 1; }
  const reasons = JSON.parse(readFileSync(file, "utf8"));
  const problems = [];
  const replaced = new Map();

  for (const [heroId, byCounter] of Object.entries(reasons)) {
    if (!GRAPH.nodes.some((n) => n.id === heroId)) { problems.push(`${heroId}: not a hero id`); continue; }
    const picked = selectCounters(MATCHUPS, heroId);
    const links = [];
    for (const type of LINK_TYPES) {
      for (const row of picked[type]) {
        const desc = String(byCounter[row.hero] || "").trim();
        if (!desc) problems.push(`${heroId} <- ${row.hero}: no reason`);
        else if (/[<>]/.test(desc)) problems.push(`${heroId} <- ${row.hero}: reason contains < or >`);
        links.push({ source: heroId, target: row.hero, type, desc });
      }
    }
    for (const counter of Object.keys(byCounter)) {
      if (!links.some((l) => l.target === counter)) problems.push(`${heroId} <- ${counter}: not one of the picked counters`);
    }
    replaced.set(heroId, links);
  }

  if (problems.length) {
    problems.forEach((p) => console.log(`${red("error")} ${p}`));
    console.log(red(`Nothing written: ${problems.length} problems`));
    return 1;
  }

  // hero order follows nodes; heroes not in the file keep their current links
  const out = [];
  for (const node of GRAPH.nodes) {
    out.push(...(replaced.get(node.id) || GRAPH.links.filter((l) => l.source === node.id)));
  }
  GRAPH.links = out;
  writeData(src, GRAPH);
  const count = [...replaced.values()].reduce((a, l) => a + l.length, 0);
  console.log(green(`Updated ${replaced.size} heroes, ${count} counters. data.js now has ${out.length} links.`));
  return 0;
}

const HELP = `The Counter Web data tool

Usage: node tools/counterweb.mjs <command> [args]

Commands:
  check              validate js/data.js against itself and js/matchups.js (exit 1 on errors)
  check --strict     also fail on warnings
  stats              hero, link and item counts
  hero <name>        print a hero's counters with matchup numbers, e.g. "hero pudge"
  plan [names...]    counters the matchup data picks, next to the current ones
  plan --json [...]  reasons template for apply, current reasons filled in
  facts <names...>   ability text from the cached game constants
  apply <file.json>  write the picked counters with reasons from the file into data.js
  help               show this text

Counters need a +${MIN_ADV} edge, up to ${MAX_PER_TYPE} support and ${MAX_PER_TYPE} core per hero.
`;

function main(argv) {
  const [cmd = "help", ...rest] = argv;
  if (cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(HELP); return 0; }

  let data;
  try {
    data = loadData();
  } catch (e) {
    console.error(red(`Could not load data: ${e.message}`));
    return 1;
  }

  if (cmd === "check") {
    const strict = rest.includes("--strict");
    const { errors, warnings } = check(data);
    warnings.forEach((w) => console.log(`${yellow("warn")}  ${w}`));
    errors.forEach((e) => console.log(`${red("error")} ${e}`));
    const summary = `${data.GRAPH.nodes.length} heroes, ${data.GRAPH.links.length} links: ${errors.length} errors, ${warnings.length} warnings`;
    const failed = errors.length > 0 || (strict && warnings.length > 0);
    console.log(failed ? red(summary) : green(summary));
    return failed ? 1 : 0;
  }
  if (cmd === "stats") { stats(data); return 0; }
  if (cmd === "hero") return hero(data, rest.join(" "));
  if (cmd === "plan") {
    const asJson = rest.includes("--json");
    return plan(data, rest.filter((a) => a !== "--json"), asJson);
  }
  if (cmd === "facts") return facts(data, rest);
  if (cmd === "apply") return apply(data, rest[0]);

  console.error(red(`Unknown command "${cmd}"\n`));
  console.log(HELP);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
