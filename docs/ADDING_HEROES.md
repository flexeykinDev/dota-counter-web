# Adding heroes, counters, and items

All graph data lives in one file: [`js/data.js`](../js/data.js). It defines two top-level constants:

- **`GRAPH`** — the hero nodes and the counter relationships between them
- **`IMAGES`** — a hero-name → portrait-image lookup, used to render each node's circular portrait

Everything else (`js/main.js`, `css/style.css`) reads from these two objects, so most changes only require editing `data.js`.

## 1. Adding a new hero

Add an entry to `GRAPH.nodes`:

```js
{
  "id": "Muerta",                    // must exactly match the "id" used everywhere else (links, IMAGES key)
  "role": "Midlane nuker",           // short label shown in the info panel
  "item": {
    "name": "Black King Bar",        // the "silver bullet" item recommended against this hero
    "desc": "BKB blocks her Dead Shot silence and lets you walk through the ult.",
    "icons": [
      { "label": "Black King Bar", "url": "data:image/webp;base64,..." }
    ]
  }
}
```

Then add a matching portrait to `IMAGES`:

```js
"Muerta": "data:image/webp;base64,..."
```

**Getting the base64 image data:** portraits and item icons are inlined as `data:image/webp;base64,...` URIs so the whole site works from a single set of static files with no image hosting. To generate one from a local image:

```bash
python -c "
import base64
with open('muerta_portrait.webp', 'rb') as f:
    print('data:image/webp;base64,' + base64.b64encode(f.read()).decode())
"
```

Keep portraits small (roughly the same file size as the existing ones, a few KB) — they're base64-encoded inline, so oversized images bloat `data.js` and slow down the initial page load. WebP at moderate quality (~70–80) keeps things compact.

## 2. Adding or editing a counter relationship

Add an entry to `GRAPH.links`:

```js
{ "source": "Muerta", "target": "Nyx Assassin", "type": "support", "desc": "Spiked Carapace reflects Dead Shot's projectile back at her." }
```

Field meaning — **this is the part that trips people up**:

- `source` is the hero being countered.
- `target` is the hero (or item/strategy) that counters them.
- `type` is `"support"` (blue link) or `"core"` (red link), describing what kind of pick the counter is.
- `desc` is the one-line explanation shown in the info panel.

So `{ "source": "Muerta", "target": "Nyx Assassin", "type": "support" }` reads as: *"Nyx Assassin is a support counter to Muerta."* It will show up in Muerta's info panel under "Support counter: Nyx Assassin", and Nyx Assassin's node will link back to Muerta.

A hero can have multiple incoming links (multiple heroes counter them) — just add one entry per relationship.

## 3. Editing an existing hero's recommended item

Find the hero's node in `GRAPH.nodes` and edit its `item.name` / `item.desc` / `item.icons`. Item icons follow the same `data:image/webp;base64,...` format as portraits (see above).

## 4. Validating your changes

`GRAPH.nodes[*].id` values are the only thing tying the data together — `GRAPH.links` and `IMAGES` both reference heroes by that exact string. After editing:

1. Open `index.html` locally (see [README](../README.md#running-locally)) and confirm the new/edited hero renders, has a portrait, and its info panel shows correctly on click.
2. Search for the hero by name to confirm the live filter finds it.
3. Double-check any hero you added counters is spelled identically to its `id` elsewhere in the file — a typo silently produces a dangling link with no target node.
