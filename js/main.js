const app = document.getElementById("app");
const svg = d3.select("#graph");
const searchInput = document.getElementById("search");
const searchBox = searchInput.closest(".search");
const suggestEl = document.getElementById("suggest");
const detailEl = document.getElementById("detail");

let width = svg.node().clientWidth || window.innerWidth;
let height = svg.node().clientHeight || window.innerHeight;

const css = getComputedStyle(document.documentElement);
const COLORS = {
  support: css.getPropertyValue("--support").trim() || "#5aa9e6",
  core: css.getPropertyValue("--core").trim() || "#ef5b52",
};
const isMobile = () => window.matchMedia("(max-width: 720px)").matches;

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// ---------- arrow markers ----------
const defs = svg.append("defs");
const markerStates = { normal: 0.45, outgoing: 0.7, dim: 0.04, highlight: 1 };
Object.entries(COLORS).forEach(([type, color]) => {
  Object.entries(markerStates).forEach(([state, opacity]) => {
    defs.append("marker")
      .attr("id", `arrow-${type}-${state}`)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", state === "highlight" ? 5 : 6)
      .attr("markerHeight", state === "highlight" ? 5 : 6)
      .attr("orient", "auto-start-reverse")
      .append("path")
      .attr("d", "M0,0 L10,5 L0,10 z")
      .attr("fill", color)
      .attr("fill-opacity", opacity);
  });
});

const g = svg.append("g");

const zoom = d3.zoom()
  .scaleExtent([0.15, 4])
  .on("zoom", (event) => g.attr("transform", event.transform));
svg.call(zoom).on("dblclick.zoom", null);

// ---------- data ----------
GRAPH.nodes.forEach((n, i) => { n.__idx = i; });
const nodesById = new Map(GRAPH.nodes.map(n => [n.id, n]));
const linkId = (end) => end.id || end;

const MU = typeof MATCHUPS !== "undefined" ? MATCHUPS : null;
const matchup = (hero, counter, type) => MU?.heroes[hero]?.counters[type]?.find(c => c.hero === counter) || null;

// outgoing: links where this hero is the source, i.e. the heroes that counter it
// incoming: links where this hero is the target, i.e. the heroes it counters
const outgoing = new Map();
const incoming = new Map();
GRAPH.nodes.forEach(n => { outgoing.set(n.id, []); incoming.set(n.id, []); });
// Links are stored best first. The graph draws only the top support and top core
// counter per hero, the panel lists all of them.
const drawnKeys = new Set();
GRAPH.links.forEach(l => {
  outgoing.get(l.source).push(l);
  incoming.get(l.target).push(l);
  const key = l.source + "|" + l.type;
  l.drawn = !drawnKeys.has(key);
  drawnKeys.add(key);
});
const drawnLinks = GRAPH.links.filter(l => l.drawn);

const simulation = d3.forceSimulation(GRAPH.nodes)
  .force("link", d3.forceLink(drawnLinks).id(d => d.id).distance(95).strength(0.35))
  .force("charge", d3.forceManyBody().strength(-220))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collide", d3.forceCollide().radius(28));

// ---------- render ----------
const linkSel = g.append("g")
  .attr("class", "links")
  .selectAll("path")
  .data(drawnLinks)
  .join("path")
  .attr("class", d => "link " + d.type)
  .attr("marker-end", d => `url(#arrow-${d.type}-normal)`);

const nodeSel = g.append("g")
  .attr("class", "nodes")
  .selectAll("g")
  .data(GRAPH.nodes)
  .join("g")
  .attr("class", "node")
  .call(drag(simulation));

// bigger portrait = listed as a counter to more heroes
function nodeRadius(d){
  return 12 + Math.min(incoming.get(d.id).length, 12) * 0.8;
}

// nested group so hover/click scaling animates independently of the
// outer group's per-tick position transform
const nodeScale = nodeSel.append("g").attr("class", "node-scale");

nodeScale.append("circle")
  .attr("class", "pulse")
  .attr("r", d => nodeRadius(d));

// fallback circle, shown underneath the portrait (and if the image 404s)
nodeScale.append("circle")
  .attr("class", "bg")
  .attr("r", d => nodeRadius(d));

// per-node clip path so the portrait renders as a clean circle
nodeScale.append("clipPath")
  .attr("id", d => "clip-" + d.__idx)
  .append("circle")
  .attr("r", d => nodeRadius(d) - 1.5);

// All source portraits share a fixed 120x68 aspect ratio. Rather than relying
// on preserveAspectRatio's coarse xMid centering, compute the cover geometry
// manually so a handful of heroes can get a small per-hero horizontal nudge
// (their face isn't quite centered in Valve's source crop).
const SOURCE_ASPECT = 120 / 68;
const PORTRAIT_SHIFT = {
  "Lina": 0.32,
  "Keeper of the Light": 0.32,
  "Pudge": 0.32,
  "Ember Spirit": 0.32,
  "Shadow Shaman": 0.32,
  "Lone Druid": -0.32,
  "Anti-Mage": -0.32,
  "Meepo": -0.32,
  "Brewmaster": -0.32,
  "Lifestealer": -0.32,
  "Grimstroke": -0.32,
  "Axe": -0.32,
  "Razor": -0.32,
  "Dragon Knight": -0.32,
  "Venomancer": -0.32,
  "Necrophos": -0.32,
  "Tidehunter": 0.18,
  "Techies": 0.18,
  "Kunkka": 0.18,
};

function portraitGeom(d){
  const r = nodeRadius(d) - 1.5;
  const diameter = r * 2;
  const renderW = diameter * SOURCE_ASPECT;
  const renderH = diameter;
  const maxShift = (renderW - diameter) / 2; // don't pan past the source's edges
  const shiftFrac = PORTRAIT_SHIFT[d.id] || 0;
  return {
    x: -renderW / 2 + shiftFrac * maxShift,
    y: -renderH / 2,
    width: renderW,
    height: renderH
  };
}

nodeScale.append("image")
  .attr("class", "portrait")
  .attr("href", d => IMAGES[d.id] || "")
  .each(function(d){
    const geom = portraitGeom(d);
    d3.select(this).attr("x", geom.x).attr("y", geom.y).attr("width", geom.width).attr("height", geom.height);
  })
  .attr("clip-path", d => `url(#clip-${d.__idx})`)
  .attr("preserveAspectRatio", "none")
  .on("error", function(){ d3.select(this).style("display", "none"); });

// ring drawn on top so selection/hover state is always visible over the portrait
nodeScale.append("circle")
  .attr("class", "ring")
  .attr("r", d => nodeRadius(d));

nodeScale.append("text")
  .attr("x", d => nodeRadius(d) + 4)
  .attr("y", 3)
  .text(d => d.id);

// Fixed target radii for hover/click, regardless of a node's base size,
// so even small nodes grow to a clearly visible, consistent size.
const HOVER_RADIUS = 26;
const ACTIVE_RADIUS = 34;
let hoveredId = null;
let activeId = null;
let filterActive = false; // true while a typed name is narrowing the graph

// The node's currently rendered radius, accounting for hover/click scale-up,
// so link endpoints and arrowheads track the visual size.
function effectiveRadius(d){
  if(d.id === activeId) return ACTIVE_RADIUS;
  if(d.id === hoveredId) return HOVER_RADIUS;
  return nodeRadius(d);
}

function renderLinks(){
  linkSel.attr("d", d => {
    // draw from the counter (target) to the countered hero (source), shortened
    // so the arrowhead lands just outside the node's rendered circle
    const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const r = effectiveRadius(d.source) + 2;
    const ex = d.source.x - (dx / dist) * r;
    const ey = d.source.y - (dy / dist) * r;
    return `M${d.target.x},${d.target.y} L${ex},${ey}`;
  });
}

function updateNodeScale(){
  nodeScale.style("transform", d => `scale(${effectiveRadius(d) / nodeRadius(d)})`);
  renderLinks();
}

simulation.on("tick", () => {
  renderLinks();
  nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
});

// ---------- interaction ----------
nodeSel.on("click", (event, d) => {
  event.stopPropagation();
  resetSearch();
  // on phones the bottom sheet can cover the tapped hero, so bring it into view
  selectNode(d.id, { pan: isMobile() });
});

nodeSel.on("mouseenter", (event, d) => {
  hoveredId = d.id;
  updateNodeScale();
  if(!activeId && !filterActive) previewNode(d.id);
});
nodeSel.on("mouseleave", (event, d) => {
  if(hoveredId === d.id) hoveredId = null;
  updateNodeScale();
  if(!activeId && !filterActive) clearSelection();
});

svg.on("click", () => {
  resetSearch();
  clearSelection();
});

function previewNode(id){
  // "who counters me" edges get the bright animated treatment,
  // "who I counter" edges stay visible but quieter
  const outEdges = new Set(outgoing.get(id).filter(l => l.drawn));
  const inEdges = new Set(incoming.get(id).filter(l => l.drawn));

  const neighborIds = new Set([id]);
  outEdges.forEach(l => neighborIds.add(linkId(l.target)));
  inEdges.forEach(l => neighborIds.add(linkId(l.source)));

  nodeSel
    .classed("dim", d => !neighborIds.has(d.id))
    .classed("neighbor", d => neighborIds.has(d.id) && d.id !== id)
    .classed("active", d => d.id === id);

  linkSel
    .classed("highlight", l => outEdges.has(l))
    .classed("outgoing", l => inEdges.has(l))
    .classed("dim", l => !outEdges.has(l) && !inEdges.has(l))
    .attr("marker-end", l => {
      const state = outEdges.has(l) ? "highlight" : (inEdges.has(l) ? "outgoing" : "dim");
      return `url(#arrow-${l.type}-${state})`;
    });
  // raise lit links so they draw over the dimmed ones
  linkSel.filter(l => outEdges.has(l) || inEdges.has(l)).raise();
  updateNodeScale();
}

function selectNode(id, { pan = false } = {}){
  activeId = id;
  previewNode(id);
  nodeSel.classed("selected", d => d.id === id);
  nodeSel.filter(d => d.id === id).raise();
  showDetail(id);
  showItemBadge(id);
  setHash(id);
  if(pan) panZoomTo(nodesById.get(id));
}

// #Hero_Name in the URL links straight to a hero
function setHash(id){
  const hash = id ? "#" + encodeURIComponent(id.replace(/ /g, "_")) : "";
  if(location.hash !== hash) history.replaceState(null, "", location.pathname + location.search + hash);
}

function heroFromHash(){
  const raw = decodeURIComponent(location.hash.slice(1)).replace(/_/g, " ").toLowerCase();
  return raw ? GRAPH.nodes.find(n => n.id.toLowerCase() === raw) : null;
}

function clearSelection(){
  activeId = null;
  filterActive = false;
  nodeSel.classed("dim", false).classed("neighbor", false).classed("active", false).classed("selected", false);
  linkSel.classed("dim", false).classed("highlight", false).classed("outgoing", false);
  linkSel.attr("marker-end", d => `url(#arrow-${d.type}-normal)`);
  clearItemBadge();
  updateNodeScale();
  hideDetail();
  setHash(null);
}

function clearItemBadge(){
  nodeSel.selectAll(".item-badge").remove();
}

function showItemBadge(id){
  clearItemBadge();
  nodeSel.filter(d => d.id === id).each(function(d){
    const r = ACTIVE_RADIUS;
    const grp = d3.select(this).append("g").attr("class", "item-badge");
    const icons = d.item.icons;
    const by = r + 14;

    grp.append("text")
      .attr("y", icons.length ? by - 5 : by + 4)
      .attr("text-anchor", "middle")
      .attr("class", "item-label")
      .text(d.item.name);

    const size = 22, gap = 5;
    const totalW = icons.length * size + (icons.length - 1) * gap;
    icons.forEach((icon, i) => {
      const bx = -totalW / 2 + i * (size + gap) + size / 2;
      const badge = grp.append("g").attr("transform", `translate(${bx},${by})`);
      badge.append("rect")
        .attr("x", -size / 2).attr("y", 0)
        .attr("width", size).attr("height", size)
        .attr("rx", 4)
        .attr("class", "item-frame");
      badge.append("image")
        .attr("href", icon.url)
        .attr("x", -size / 2 + 1.5).attr("y", 1.5)
        .attr("width", size - 3).attr("height", size - 3)
        .attr("preserveAspectRatio", "xMidYMid slice")
        .on("error", function(){
          d3.select(this.parentNode).select("rect").attr("class", "item-frame item-frame-missing");
          d3.select(this).style("display", "none");
        });
      badge.append("title").text(icon.label);
    });
  });
}

// ---------- detail panel ----------
function avatar(id, cls = ""){
  const src = IMAGES[id];
  return src ? `<img class="avatar ${cls}" src="${src}" alt="">` : `<span class="avatar ${cls}"></span>`;
}

const fmtGames = (n) => n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const fmtPct = (n) => (Math.round(n * 10) / 10).toFixed(1);

function statsHtml(row){
  if(!row) return "";
  let html = `<div class="card-stats">
    <span class="stat-edge" title="Wins ${fmtPct(row.adv)} percentage points more often in this matchup than its usual win rate predicts">+${fmtPct(row.adv)}%</span>
    <span title="Win rate against this hero">${fmtPct(row.winRate)}% win</span>
    <span title="Divine and Immortal public games">${fmtGames(row.games)} games</span>`;
  if(row.pro && row.pro[0] >= 5){
    html += `<span class="stat-pro" title="Pro games this patch: wins-losses">pro ${row.pro[1]}-${row.pro[0] - row.pro[1]}</span>`;
  }
  return html + `</div>`;
}

function showDetail(id){
  const node = nodesById.get(id);
  const counteredBy = outgoing.get(id);
  const counters = incoming.get(id);
  const order = { support: 0, core: 1 };
  const m = MU?.heroes[id];

  let html = `<button class="detail-close" data-action="close" aria-label="Close">×</button>
    <header class="detail-head">
      ${avatar(id, "lg")}
      <div>
        <span class="chip">${escapeHtml(node.role)}</span><h2>${escapeHtml(node.id)}</h2>
        ${m ? `<div class="detail-meta">Pos ${m.position} · ${fmtPct(m.winRate)}% win · ${fmtGames(m.games)} games</div>` : ""}
      </div>
    </header>`;

  html += `<div class="section-title">Countered by <span class="n">${counteredBy.length}</span></div>`;
  if(counteredBy.length){
    // stable sort keeps the data's best-first order inside each type
    [...counteredBy].sort((a, b) => order[a.type] - order[b.type]).forEach(l => {
      const counter = linkId(l.target);
      html += `<button class="card ${l.type}" data-hero="${escapeHtml(counter)}">
        ${avatar(counter)}
        <div class="card-body">
          <div class="card-kicker">${l.type === "support" ? "Support counter" : "Core counter"}</div>
          <div class="card-name">${escapeHtml(counter)}</div>
          <p class="card-desc">${escapeHtml(l.desc)}</p>
          ${statsHtml(matchup(id, counter, l.type))}
        </div>
      </button>`;
    });
  } else {
    html += `<p class="muted">No counters listed yet.</p>`;
  }

  if(node.item){
    const icons = node.item.icons.map(ic =>
      `<img class="item-icon" src="${ic.url}" alt="${escapeHtml(ic.label)}" title="${escapeHtml(ic.label)}">`
    ).join("");
    html += `<div class="section-title">Silver bullet</div>
      <div class="card item">
        ${icons ? `<div class="item-icons">${icons}</div>` : ""}
        <div class="card-body">
          <div class="card-name">${escapeHtml(node.item.name)}</div>
          <p class="card-desc">${escapeHtml(node.item.desc)}</p>
        </div>
      </div>`;
  }

  html += `<div class="section-title">Counters <span class="n">${counters.length}</span></div>`;
  if(counters.length){
    html += `<div class="chips">` + counters.map(l => {
      const hero = linkId(l.source);
      return `<button class="hero-chip ${l.type}" data-hero="${escapeHtml(hero)}" title="${l.type === "support" ? "Support" : "Core"} counter to ${escapeHtml(hero)}">${avatar(hero, "sm")}${escapeHtml(hero)}<i></i></button>`;
    }).join("") + `</div>`;
  } else {
    html += `<p class="muted">Not listed as a counter to anyone.</p>`;
  }

  if(MU){
    const meta = MU.meta;
    html += `<p class="detail-source">Divine and Immortal public games, ${escapeHtml(meta.from)} to ${escapeHtml(meta.to)} (STRATZ). Pro games on patch ${escapeHtml(meta.patch)} (OpenDota).</p>`;
  }

  detailEl.innerHTML = html;
  detailEl.hidden = false;
  detailEl.scrollTop = 0;
  app.classList.add("has-detail");
}

function hideDetail(){
  detailEl.hidden = true;
  app.classList.remove("has-detail");
}

detailEl.addEventListener("click", (event) => {
  const target = event.target.closest("[data-hero], [data-action]");
  if(!target) return;
  if(target.dataset.action === "close"){
    clearSelection();
    return;
  }
  resetSearch();
  selectNode(target.dataset.hero, { pan: true });
});

// ---------- camera ----------
// Visible graph area, minus the UI that sits on top of it.
function viewport(){
  if(isMobile()){
    const bottom = activeId ? height * 0.58 : 70;
    return { x: 0, y: 120, w: width, h: Math.max(160, height - 120 - bottom) };
  }
  const right = activeId ? 340 + 36 : 0;
  return { x: 0, y: 70, w: width - right, h: height - 70 - 70 };
}

function panZoomTo(node){
  const v = viewport();
  const scale = Math.max(d3.zoomTransform(svg.node()).k, 1.1);
  svg.transition().duration(450).call(
    zoom.transform,
    d3.zoomIdentity.translate(v.x + v.w / 2, v.y + v.h / 2).scale(scale).translate(-node.x, -node.y)
  );
}

function fitTransform(){
  const v = viewport();
  const [x0, x1] = d3.extent(GRAPH.nodes, d => d.x);
  const [y0, y1] = d3.extent(GRAPH.nodes, d => d.y);
  const pad = 60;
  const k = Math.max(0.15, Math.min(1.2, Math.min(v.w / (x1 - x0 + pad * 2), v.h / (y1 - y0 + pad * 2))));
  return d3.zoomIdentity
    .translate(v.x + v.w / 2, v.y + v.h / 2)
    .scale(k)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
}

function fitView(duration = 500){
  const t = fitTransform();
  if(duration) svg.transition().duration(duration).call(zoom.transform, t);
  else svg.call(zoom.transform, t);
}

// pre-settle the layout so the first frame can be framed properly;
// the simulation keeps running afterwards for the final settling
simulation.stop();
for(let i = 0; i < 140; i++) simulation.tick();
nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
renderLinks();
fitView(0);
simulation.restart();

function openFromHash(){
  const node = heroFromHash();
  if(node && node.id !== activeId){
    resetSearch();
    selectNode(node.id, { pan: true });
  }
}

document.getElementById("reset").addEventListener("click", () => {
  resetSearch();
  clearSelection();
  fitView();
});
document.getElementById("zoom-in").addEventListener("click", () => {
  svg.transition().duration(250).call(zoom.scaleBy, 1.35);
});
document.getElementById("zoom-out").addEventListener("click", () => {
  svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.35);
});

window.addEventListener("resize", () => {
  width = svg.node().clientWidth || window.innerWidth;
  height = svg.node().clientHeight || window.innerHeight;
  simulation.force("center", d3.forceCenter(width / 2, height / 2));
});

// ---------- search ----------
let suggestions = [];
let suggestIndex = 0;

// Prefix of the full name first, then prefix of any word ("spirit"), then anywhere.
function findHeroes(query){
  const q = query.trim().toLowerCase();
  if(!q) return [];
  const scored = [];
  for(const n of GRAPH.nodes){
    const name = n.id.toLowerCase();
    let score = -1;
    if(name.startsWith(q)) score = 0;
    else if(name.split(/[\s-]+/).some(w => w.startsWith(q))) score = 1;
    else if(name.includes(q)) score = 2;
    if(score >= 0) scored.push({ node: n, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.node.id.localeCompare(b.node.id)).map(s => s.node);
}

function highlightMatch(name, query){
  const i = name.toLowerCase().indexOf(query.trim().toLowerCase());
  if(i < 0 || !query.trim()) return escapeHtml(name);
  const end = i + query.trim().length;
  return escapeHtml(name.slice(0, i)) + "<mark>" + escapeHtml(name.slice(i, end)) + "</mark>" + escapeHtml(name.slice(end));
}

function renderSuggestions(query){
  const q = query.trim();
  searchBox.classList.toggle("no-match", !!q && suggestions.length === 0);
  if(!q){ closeSuggestions(); return; }

  if(!suggestions.length){
    suggestEl.innerHTML = `<li class="s-empty">No hero matches "${escapeHtml(q)}"</li>`;
  } else {
    suggestEl.innerHTML = suggestions.slice(0, 8).map((n, i) => `
      <li role="option" id="opt-${i}" data-hero="${escapeHtml(n.id)}" aria-selected="${i === suggestIndex}">
        ${avatar(n.id)}
        <span class="s-name">${highlightMatch(n.id, q)}</span>
        <span class="s-role">${escapeHtml(n.role)}</span>
      </li>`).join("");
  }
  suggestEl.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
  searchInput.setAttribute("aria-activedescendant", suggestions.length ? `opt-${suggestIndex}` : "");
}

function closeSuggestions(){
  suggestEl.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
  searchInput.removeAttribute("aria-activedescendant");
}

function resetSearch(){
  searchInput.value = "";
  suggestions = [];
  searchBox.classList.remove("no-match");
  closeSuggestions();
}

// Lights every matching hero, narrowing as more letters are typed.
// Once exactly one hero matches, select it.
function filterGraph(query){
  suggestions = findHeroes(query);
  suggestIndex = 0;
  renderSuggestions(query);

  if(!query.trim()){ clearSelection(); return; }

  if(suggestions.length === 1){
    closeSuggestions();
    selectNode(suggestions[0].id, { pan: true });
    return;
  }

  activeId = null;
  filterActive = true;
  const ids = new Set(suggestions.map(m => m.id));
  nodeSel
    .classed("dim", d => !ids.has(d.id))
    .classed("neighbor", false)
    .classed("selected", false)
    .classed("active", d => ids.has(d.id));
  linkSel.classed("dim", true).classed("highlight", false).classed("outgoing", false);
  linkSel.attr("marker-end", d => `url(#arrow-${d.type}-dim)`);
  clearItemBadge();
  hideDetail();
  setHash(null);
  updateNodeScale();
}

function pickSuggestion(index){
  const node = suggestions[index];
  if(!node) return;
  searchInput.value = node.id;
  closeSuggestions();
  searchInput.blur();
  selectNode(node.id, { pan: true });
}

searchInput.addEventListener("input", () => filterGraph(searchInput.value));
searchInput.addEventListener("focus", () => { if(searchInput.value.trim() && !activeId) renderSuggestions(searchInput.value); });
searchInput.addEventListener("blur", () => setTimeout(closeSuggestions, 120));

searchInput.addEventListener("keydown", (event) => {
  const visible = Math.min(suggestions.length, 8);
  if(event.key === "ArrowDown" || event.key === "ArrowUp"){
    if(!visible) return;
    event.preventDefault();
    suggestIndex = (suggestIndex + (event.key === "ArrowDown" ? 1 : -1) + visible) % visible;
    renderSuggestions(searchInput.value);
  } else if(event.key === "Enter"){
    event.preventDefault();
    pickSuggestion(suggestIndex);
  } else if(event.key === "Escape"){
    event.preventDefault();
    resetSearch();
    clearSelection();
    searchInput.blur();
  }
});

// mousedown so the pick lands before the input's blur closes the list
suggestEl.addEventListener("mousedown", (event) => {
  const li = event.target.closest("li[data-hero]");
  if(!li) return;
  event.preventDefault();
  pickSuggestion(suggestions.findIndex(n => n.id === li.dataset.hero));
});

// Type anywhere: the first letter moves focus into the search box and starts a new query.
window.addEventListener("keydown", (event) => {
  if(event.target === searchInput) return;
  if(event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = (event.target.tagName || "").toLowerCase();
  if(tag === "input" || tag === "textarea") return;

  if(event.key === "Escape"){
    resetSearch();
    clearSelection();
    return;
  }
  if(event.key === "/"){
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }
  if(event.key.length === 1 && /[a-zA-Z']/.test(event.key)){
    // moving focus during keydown lets the browser type the key into the input itself
    searchInput.value = "";
    searchInput.focus();
  }
});

// ---------- labels ----------
const heroCount = GRAPH.nodes.length;
const linkCount = GRAPH.links.length;
document.getElementById("count").textContent = `${heroCount} heroes · ${linkCount} counters`;
document.getElementById("sub").textContent = `${heroCount} heroes · ${linkCount} counter-picks · silver bullet items`;

openFromHash();
window.addEventListener("hashchange", openFromHash);

function drag(sim){
  function dragstarted(event, d){
    if(!event.active) sim.alphaTarget(0.15).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d){
    d.fx = event.x; d.fy = event.y;
  }
  function dragended(event, d){
    if(!event.active) sim.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
  return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}
