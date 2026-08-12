# Adding heroes, counters, and items

All graph data lives in one file: [`js/data.js`](../js/data.js). It defines two top-level constants:

- **`GRAPH`** — the hero nodes and the counter relationships between them
- **`IMAGES`** — a hero-name → portrait-image lookup, used to render each node's circular portrait

Everything else (`js/main.js`, `css/style.css`) reads from these two objects, so most changes only require editing `data.js`.

## 1. Adding a new hero

Add an entry to `GRAPH.nodes`:

```js
{
  "id": "Largo",                     // must exactly match the "id" used everywhere else (links, IMAGES key)
  "role": "Utility support",         // short label shown in the info panel
  "item": {
    "name": "Diffusal Blade / Disperser",  // the "silver bullet" item recommended against this hero
    "desc": "Burns through his fragile mana pool so Verdant Drums and Croak of Genius run dry.",
    "icons": [
      { "label": "Diffusal Blade", "url": "data:image/webp;base64,..." }
    ]
  }
}
```

Then add a matching portrait to `IMAGES`:

```js
"Largo": "data:image/webp;base64,..."
```

(This is the actual entry used for Largo, added when he shipped in patch 7.40 — a real worked example, not a hypothetical.)

**Getting the base64 image data:** portraits and item icons are inlined as `data:image/webp;base64,...` URIs so the whole site works from a single set of static files with no image hosting. Valve's official CDN has both, at predictable URLs (swap in the hero/item's internal name, lowercase with underscores):

- Hero portrait: `https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/<hero>.png`
- Item icon: `https://cdn.steamstatic.com/apps/dota2/images/dota_react/items/<item>.png`

Fetch, resize, and re-encode as webp:

```bash
python -c "
from PIL import Image
import io, base64, urllib.request

data = urllib.request.urlopen('https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/largo.png').read()
im = Image.open(io.BytesIO(data)).convert('RGB').resize((120, 68), Image.LANCZOS)  # portraits: 120x68 — item icons: 88x64
buf = io.BytesIO()
im.save(buf, format='WEBP', quality=80)
print('data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode())
"
```

**Portraits must be exactly 120×68px and item icons exactly 88×64px** — the rendering code (`js/main.js`) hardcodes that aspect ratio to crop portraits into circles without distortion. Keep the resulting files small (a couple KB, matching the existing entries) — they're base64-encoded inline, so oversized images bloat `data.js` and slow down the initial page load.

Before reusing an item icon, check whether it's already in the file (search `data.js` for the item's label) — several heroes share the same "silver bullet" item, and reusing an existing icon avoids adding a duplicate image blob.

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
