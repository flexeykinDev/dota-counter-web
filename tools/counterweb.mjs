#!/usr/bin/env node
// Command line tool for js/data.js: validate the graph, print stats, look up a hero.
// Usage: node tools/counterweb.mjs <check|stats|hero|help> [args]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = join(ROOT, "js", "data.js");

const PORTRAIT_SIZE = [120, 68];
const ICON_SIZE = [88, 64];
const LINK_TYPES = ["support", "core"];
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
  return { GRAPH: ctx.GRAPH, IMAGES: ctx.IMAGES, bytes: Buffer.byteLength(src) };
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

function check({ GRAPH, IMAGES }) {
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
      if (c[type].length === 0) warn(`${id}: no ${type} counter`);
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

function hero(data, query) {
  const { GRAPH } = data;
  if (!query) { console.error("usage: counterweb hero <name>"); return 1; }
  const q = query.toLowerCase();
  const node = GRAPH.nodes.find((n) => n.id.toLowerCase() === q)
    || GRAPH.nodes.find((n) => n.id.toLowerCase().startsWith(q))
    || GRAPH.nodes.find((n) => n.id.toLowerCase().includes(q));
  if (!node) { console.error(red(`No hero matches "${query}"`)); return 1; }

  const countered = GRAPH.links.filter((l) => l.source === node.id);
  const counters = GRAPH.links.filter((l) => l.target === node.id).map((l) => l.source);

  console.log(`${bold(node.id)}  ${dim(node.role)}`);
  for (const l of countered) {
    const label = l.type === "support" ? blue("Support counter") : red("Core counter   ");
    console.log(`  ${label}  ${bold(l.target)}`);
    console.log(`                   ${dim(l.desc)}`);
  }
  console.log(`  ${yellow("Silver bullet  ")}  ${bold(node.item.name)}`);
  console.log(`                   ${dim(node.item.desc)}`);
  console.log(`  ${green("Counters       ")}  ${counters.join(", ") || dim("nobody")}`);
  return 0;
}

const HELP = `The Counter Web data tool

Usage: node tools/counterweb.mjs <command> [args]

Commands:
  check          validate js/data.js (exit code 1 on errors)
  check --strict also fail on warnings
  stats          hero, link and item counts
  hero <name>    print a hero's counters, e.g. "hero pudge"
  help           show this text
`;

function main(argv) {
  const [cmd = "help", ...rest] = argv;
  if (cmd === "help" || cmd === "--help" || cmd === "-h") { console.log(HELP); return 0; }

  let data;
  try {
    data = loadData();
  } catch (e) {
    console.error(red(`Could not load js/data.js: ${e.message}`));
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

  console.error(red(`Unknown command "${cmd}"\n`));
  console.log(HELP);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
