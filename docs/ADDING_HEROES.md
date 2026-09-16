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

## 2. Counters

Counters are picked by the matchup data in `js/matchups.js`, not by hand. You write the reasons.

Each entry in `GRAPH.links` looks like this:

```js
{"source":"Muerta","target":"Nyx Assassin","type":"support","desc":"Vendetta bursts a fragile carry, and Spiked Carapace reflects her damage back."}
```

Field meaning — **this is the part that trips people up**:

- `source` is the hero being countered.
- `target` is the hero that counters them.
- `type` is `"support"` (blue link) or `"core"` (red link). It must match how the counter is actually played, which comes from the data.
- `desc` is the one-line reason shown on the counter card.

So the entry above reads as: *"Nyx Assassin is a support counter to Muerta."* Links are stored best first. The graph draws the first support and first core link for each hero, and the panel lists all of them (up to 3 of each).

To rebuild a hero's counters:

1. See what the data picks: `node tools/counterweb.mjs plan muerta`
2. Get a template with any existing reasons filled in: `node tools/counterweb.mjs plan --json muerta > reasons.json`
3. Read the abilities involved: `node tools/counterweb.mjs facts muerta "nyx assassin"`
4. Fill in every empty reason in `reasons.json`. Keep it to one line, name real abilities, and don't claim a dispel or BKB interaction without checking `facts`.
5. Write it in: `node tools/counterweb.mjs apply reasons.json`

`apply` refuses to write if a picked counter has no reason or the file names a counter the data didn't pick.

To refresh the numbers themselves, see "Refreshing the numbers" in the README.

## 3. Editing an existing hero's recommended item

Find the hero's node in `GRAPH.nodes` and edit its `item.name` / `item.desc` / `item.icons`. Item icons follow the same `data:image/webp;base64,...` format as portraits (see above).

## 4. Validating your changes

`GRAPH.nodes[*].id` values are the only thing tying the data together — `GRAPH.links` and `IMAGES` both reference heroes by that exact string. After editing:

1. Run the data checker (Node 18+, no install needed):

   ```bash
   node tools/counterweb.mjs check --strict
   ```

   It reports misspelled hero ids in links (which stop the whole graph from loading), missing portraits, broken or wrongly sized images, counters the matchup data doesn't back or lists in another role, and duplicate links. CI runs the same command on every pull request.

   A new hero also needs matchup data: run `node tools/fetch-matchups.mjs` once STRATZ has a few weeks of games for it.
2. Look the hero up in the terminal to read back what you wrote: `node tools/counterweb.mjs hero largo`.
3. Open `index.html` locally (see the README's developer section) and open `/#Largo` (spaces become underscores, e.g. `/#Crystal_Maiden`) to check the portrait, panel and item badge.
