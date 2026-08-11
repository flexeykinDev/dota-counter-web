
const width = window.innerWidth;
const height = window.innerHeight;

const svg = d3.select("svg");

const defs = svg.append("defs");
const markerStates = { normal: 0.55, dim: 0.05, highlight: 1 };
[["support","#4f8fc0"],["core","#d6635f"]].forEach(([type,color]) => {
  Object.entries(markerStates).forEach(([state, opacity]) => {
    defs.append("marker")
      .attr("id", `arrow-${type}-${state}`)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
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
svg.call(zoom);

// initial slight zoom-out since graph is dense
const initialTransform = d3.zoomIdentity.translate(width/2, height/2).scale(0.55).translate(-width/2, -height/2);
svg.call(zoom.transform, initialTransform);

GRAPH.nodes.forEach((n, i) => { n.__idx = i; });
const nodesById = new Map(GRAPH.nodes.map(n => [n.id, n]));

// build adjacency for highlight logic (both directions)
const outgoing = new Map(); // id -> [{target,type}]
const incoming = new Map(); // id -> [{source,type}]
GRAPH.nodes.forEach(n => { outgoing.set(n.id, []); incoming.set(n.id, []); });
GRAPH.links.forEach(l => {
  outgoing.get(l.source).push(l);
  incoming.get(l.target).push(l);
});

const simulation = d3.forceSimulation(GRAPH.nodes)
  .force("link", d3.forceLink(GRAPH.links).id(d => d.id).distance(95).strength(0.35))
  .force("charge", d3.forceManyBody().strength(-220))
  .force("center", d3.forceCenter(width/2, height/2))
  .force("collide", d3.forceCollide().radius(28));

const linkSel = g.append("g")
  .attr("class","links")
  .selectAll("path")
  .data(GRAPH.links)
  .join("path")
  .attr("class", d => "link " + d.type)
  .attr("marker-end", d => `url(#arrow-${d.type}-normal)`);

const nodeSel = g.append("g")
  .attr("class","nodes")
  .selectAll("g")
  .data(GRAPH.nodes)
  .join("g")
  .attr("class","node")
  .call(drag(simulation));

function nodeRadius(d){
  return 12 + Math.min(incoming.get(d.id).length, 6) * 1.6;
}

// nested group so hover/click scaling animates independently of the
// outer group's per-tick position transform
const nodeScale = nodeSel.append("g").attr("class", "node-scale");

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
  .attr("x", d => portraitGeom(d).x)
  .attr("y", d => portraitGeom(d).y)
  .attr("width", d => portraitGeom(d).width)
  .attr("height", d => portraitGeom(d).height)
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

nodeSel.on("click", (event, d) => {
  event.stopPropagation();
  filterActive = false;
  typeBuffer = "";
  hideTypeahead();
  searchInput.value = "";
  selectNode(d.id);
});

svg.on("click", () => {
  filterActive = false;
  typeBuffer = "";
  hideTypeahead();
  searchInput.value = "";
  clearSelection();
});

// Fixed target radii for hover/click, regardless of a node's base size —
// so even small nodes grow to a clearly visible, consistent size.
const HOVER_RADIUS = 26;
const ACTIVE_RADIUS = 34;
let hoveredId = null;

// The node's currently rendered radius, accounting for hover/click scale-up —
// used so link endpoints/arrowheads track the visual size, not just the base size.
function effectiveRadius(d){
  if(d.id === activeId) return ACTIVE_RADIUS;
  if(d.id === hoveredId) return HOVER_RADIUS;
  return nodeRadius(d);
}

function renderLinks(){
  linkSel.attr("d", d => {
    // draw from the counter (target) to the countered hero (source),
    // shortened so the arrowhead lands just outside the node's current
    // rendered circle (which may be hover/click-enlarged)
    const dx = d.source.x - d.target.x, dy = d.source.y - d.target.y;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    const r = effectiveRadius(d.source) + 2;
    const ex = d.source.x - (dx/dist) * r;
    const ey = d.source.y - (dy/dist) * r;
    return `M${d.target.x},${d.target.y} L${ex},${ey}`;
  });
}

function updateNodeScale(){
  nodeScale.style("transform", d => {
    const base = nodeRadius(d);
    const target = effectiveRadius(d);
    return `scale(${target / base})`;
  });
  renderLinks();
}

nodeSel.on("mouseenter", (event, d) => {
  hoveredId = d.id;
  updateNodeScale();
  if(!activeId && !filterActive) previewNode(d.id);
});
nodeSel.on("mouseleave", (event, d) => {
  if(hoveredId === d.id) hoveredId = null;
  updateNodeScale();
  if(!activeId && !filterActive) clearSelection(false);
});

simulation.on("tick", () => {
  renderLinks();
  nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
});

let activeId = null;
let filterActive = false; // true whenever a name filter (typed or via search box) is narrowing the graph

function neighborSet(id){
  const s = new Set([id]);
  outgoing.get(id).forEach(l => s.add(l.target.id || l.target));
  incoming.get(id).forEach(l => s.add(l.source.id || l.source));
  return s;
}

function previewNode(id){
  // outgoing (source === id): this hero IS the one being countered -> these are
  // "who counters me" edges, so they get the bright highlight treatment.
  const outEdges = outgoing.get(id);
  // incoming (target === id): this hero IS the counter -> these are "who I counter"
  // edges. Keep the neighbor node lit, but don't light the edge itself.
  const inEdges = incoming.get(id);

  const neighborIds = new Set([id]);
  outEdges.forEach(l => neighborIds.add(l.target.id || l.target));
  inEdges.forEach(l => neighborIds.add(l.source.id || l.source));

  nodeSel.classed("dim", d => !neighborIds.has(d.id));
  nodeSel.classed("neighbor", d => neighborIds.has(d.id) && d.id !== id);
  nodeSel.classed("active", d => d.id === id);

  linkSel.classed("highlight", l => outEdges.includes(l));
  linkSel.classed("dim", l => !outEdges.includes(l) && !inEdges.includes(l));
  linkSel.attr("marker-end", l => {
    const state = outEdges.includes(l) ? "highlight" : (inEdges.includes(l) ? "normal" : "dim");
    return `url(#arrow-${l.type}-${state})`;
  });
  updateNodeScale();
}

function selectNode(id){
  activeId = id;
  previewNode(id);
  showInfo(id);
  showItemBadge(id);
}

function clearSelection(hideInfo=true){
  activeId = null;
  filterActive = false;
  nodeSel.classed("dim", false).classed("neighbor", false).classed("active", false);
  linkSel.classed("dim", false).classed("highlight", false);
  linkSel.attr("marker-end", d => `url(#arrow-${d.type}-normal)`);
  clearItemBadge();
  updateNodeScale();
  if(hideInfo) document.getElementById("infobox").style.display = "none";
}

function clearItemBadge(){
  nodeSel.selectAll(".item-badge").remove();
}

function showItemBadge(id){
  clearItemBadge();
  const sel = nodeSel.filter(d => d.id === id);
  sel.each(function(d){
    const r = nodeRadius(d);
    const grp = d3.select(this).append("g").attr("class","item-badge");
    const icons = d.item.icons;

    if(icons.length){
      const size = 22, gap = 5;
      const totalW = icons.length * size + (icons.length - 1) * gap;
      const startX = -totalW / 2;
      const by = r + 12;

      grp.append("text")
        .attr("y", by - 6)
        .attr("text-anchor", "middle")
        .attr("class", "item-label")
        .text(d.item.name);

      icons.forEach((icon, i) => {
        const bx = startX + i * (size + gap) + size / 2;
        const badge = grp.append("g").attr("transform", `translate(${bx},${by})`);
        badge.append("rect")
          .attr("x", -size/2).attr("y", 0)
          .attr("width", size).attr("height", size)
          .attr("rx", 4)
          .attr("class", "item-frame");
        badge.append("image")
          .attr("href", icon.url)
          .attr("x", -size/2 + 1.5).attr("y", 1.5)
          .attr("width", size - 3).attr("height", size - 3)
          .attr("preserveAspectRatio", "xMidYMid slice")
          .on("error", function(){ d3.select(this.parentNode).select("rect").attr("class","item-frame item-frame-missing"); d3.select(this).style("display","none"); });
        badge.append("title").text(icon.label);
      });
    } else {
      grp.append("text")
        .attr("y", r + 16)
        .attr("text-anchor", "middle")
        .attr("class", "item-label")
        .text(d.item.name);
    }
  });
}

function showInfo(id){
  const node = nodesById.get(id);
  const out = outgoing.get(id);
  const supportLink = out.find(l => l.type === "support");
  const coreLink = out.find(l => l.type === "core");
  const beatenBy = incoming.get(id);

  let html = `<h2>${node.id}</h2>`;
  html += `<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">${node.role}</div>`;
  if(supportLink){
    html += `<div class="row"><b>Support counter:</b> ${supportLink.target.id||supportLink.target}<div class="desc">${supportLink.desc}</div></div>`;
  }
  if(coreLink){
    html += `<div class="row core"><b>Core counter:</b> ${coreLink.target.id||coreLink.target}<div class="desc">${coreLink.desc}</div></div>`;
  }
  if(node.item){
    const iconsHtml = node.item.icons.map(ic =>
      `<img src="${ic.url}" alt="${ic.label}" title="${ic.label}" class="item-thumb">`
    ).join("");
    html += `<div class="row item"><b>Silver bullet:</b> ${node.item.name}`;
    if(iconsHtml) html += `<div class="item-thumbs">${iconsHtml}</div>`;
    html += `<div class="desc">${node.item.desc}</div></div>`;
  }
  if(beatenBy.length){
    const names = beatenBy.map(l => (l.source.id||l.source)).join(", ");
    html += `<div class="row" style="margin-top:10px;"><b style="color:var(--gold);">Counters:</b> <span style="color:var(--text);">${names}</span></div>`;
  }
  const box = document.getElementById("infobox");
  box.innerHTML = html;
  box.style.display = "block";
}

function panZoomTo(node){
  svg.transition().duration(400).call(
    zoom.transform,
    d3.zoomIdentity.translate(width/2, height/2).scale(1.1).translate(-node.x, -node.y)
  );
}

function showTypeahead(prefix, count, singleName){
  const el = document.getElementById("typeahead");
  if(!prefix){ el.style.display = "none"; return; }
  el.style.display = "block";
  el.classList.toggle("no-match", count === 0);
  let countHTML;
  if(count === 0) countHTML = "no match";
  else if(count === 1) countHTML = singleName;
  else countHTML = count + " matches";
  el.innerHTML = `<b>${prefix}</b><span class="count">${countHTML}</span>`;
}

function hideTypeahead(){
  document.getElementById("typeahead").style.display = "none";
}

// Highlights every hero whose name starts with `prefix`, narrowing as more
// letters are typed. Once exactly one hero matches, fully select it.
function filterByPrefix(prefix){
  const q = prefix.trim().toLowerCase();
  if(!q){ clearSelection(); hideTypeahead(); return; }

  filterActive = true;
  const matches = GRAPH.nodes.filter(n => n.id.toLowerCase().startsWith(q));
  showTypeahead(prefix, matches.length, matches.length === 1 ? matches[0].id : null);

  if(matches.length === 0){
    activeId = null;
    nodeSel.classed("dim", true).classed("neighbor", false).classed("active", false);
    linkSel.classed("dim", true).classed("highlight", false);
    linkSel.attr("marker-end", d => `url(#arrow-${d.type}-dim)`);
    document.getElementById("infobox").style.display = "none";
    clearItemBadge();
    updateNodeScale();
    return;
  }

  if(matches.length === 1){
    selectNode(matches[0].id);
    panZoomTo(matches[0]);
    return;
  }

  // several heroes still match this prefix: highlight all of them, dim
  // everything else, but don't light edges or show the info panel yet
  activeId = null;
  const ids = new Set(matches.map(m => m.id));
  nodeSel.classed("dim", d => !ids.has(d.id));
  nodeSel.classed("neighbor", false);
  nodeSel.classed("active", d => ids.has(d.id));
  linkSel.classed("dim", true).classed("highlight", false);
  linkSel.attr("marker-end", d => `url(#arrow-${d.type}-dim)`);
  document.getElementById("infobox").style.display = "none";
  clearItemBadge();
  updateNodeScale();
}

document.getElementById("reset").addEventListener("click", () => {
  clearSelection();
  hideTypeahead();
  typeBuffer = "";
  svg.transition().duration(500).call(zoom.transform, initialTransform);
  document.getElementById("search").value = "";
});

const searchInput = document.getElementById("search");
searchInput.addEventListener("input", () => {
  typeBuffer = searchInput.value;
  filterByPrefix(typeBuffer);
});

// Type-anywhere quick-find: start typing a hero's name without needing to
// click the search box first. Narrows live; Escape clears it.
let typeBuffer = "";
let typeaheadTimer = null;

function resetTypeBuffer(){
  typeBuffer = "";
  clearTimeout(typeaheadTimer);
  hideTypeahead();
}

window.addEventListener("keydown", (event) => {
  const tag = (event.target.tagName || "").toLowerCase();
  if(tag === "input" || tag === "textarea") return; // the search box handles its own typing

  if(event.key === "Escape"){
    resetTypeBuffer();
    clearSelection();
    searchInput.value = "";
    return;
  }

  if(event.key === "Backspace"){
    typeBuffer = typeBuffer.slice(0, -1);
  } else if(event.key.length === 1 && /[a-zA-Z' -]/.test(event.key)){
    typeBuffer += event.key;
  } else {
    return; // ignore arrows, tab, etc.
  }

  clearTimeout(typeaheadTimer);
  typeaheadTimer = setTimeout(resetTypeBuffer, 2500);

  searchInput.value = typeBuffer;
  filterByPrefix(typeBuffer);
});

document.getElementById("count").textContent = GRAPH.nodes.length + " heroes · " + GRAPH.links.length + " counter relationships";
document.getElementById("sub").textContent = GRAPH.nodes.length + " heroes — every support counter, core counter & the pick they beat";

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
