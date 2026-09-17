# Contributing

Thanks for helping. Most contributions are one of three kinds:

1. **A counter looks wrong** — the reason is inaccurate, or the matchup doesn't play out that way.
2. **The data is stale** — a new patch changed the game.
3. **The site itself** — a bug, a layout problem on your screen, or a feature.

You don't need to know JavaScript for the first two. Opening an [issue](../../issues/new/choose) is enough, and it helps just as much as a pull request.

## Before you start

You need [Node 18 or newer](https://nodejs.org). There is nothing to install: the tools use no dependencies.

```bash
git clone https://github.com/flexeykinDev/dota-counter-web.git
cd dota-counter-web
npm run serve     # or: python -m http.server 8000
npm run check     # validates all the data
```

Open `http://localhost:8000`. There is no build step, so an edit plus a refresh is the whole loop.

## Fixing a reason

Reasons are the one-line explanations on each counter card. They live in `js/data.js`.

1. Find the hero: `node tools/counterweb.mjs hero pudge`
2. Read the abilities involved, straight from the game files: `node tools/counterweb.mjs facts pudge weaver`
3. Edit the `desc` of that link in `js/data.js`.
4. Run `npm run check` and `node tools/counterweb.mjs lint`.

What makes a good reason:

- One line, under about 120 characters. It sits on a card, not in an essay.
- Name the actual abilities or items that decide the matchup.
- Say what happens, not how strong it is. "Rage makes him immune to Torrent" beats "Lifestealer is really good here".
- Don't claim a dispel, break or BKB interaction without checking `facts` first. Those are the details people get wrong most often.
- No em dashes, no exclamation marks, no filler.

## Changing which heroes counter which

Counters are not opinion here: they come from the matchup data in `js/matchups.js`, which is built from Divine and Immortal games. A hero gets up to 3 support and 3 core counters, each needing at least 200 games and a +1.5 edge.

So a pull request that swaps one counter for another will not pass `check --strict`. What you can do instead:

- **Refresh the data** if the meta moved. You need a free [STRATZ token](https://stratz.com/api):

  ```bash
  cp .env.example .env     # paste your token in
  npm run fetch            # about 3 minutes
  npm run check
  ```

  Your token only works from the IP that first used it, so run this on your own machine rather than in CI. If the picks changed, `check` says which counters need a reason. `node tools/counterweb.mjs plan --json <hero>` gives you a template, and `apply` writes it back:

  ```bash
  node tools/counterweb.mjs plan --json pudge > reasons.json
  # fill in the empty reasons
  node tools/counterweb.mjs apply reasons.json
  ```

- **Argue about the thresholds** in an issue or a [discussion](../../discussions). The +1.5 edge, the 200-game floor and the 3-per-type cap are judgement calls and can be changed.

## Silver bullet items

These are hand-picked, one per hero, with a short reason. Item names must match the game (short names like `BKB` and `Orchid` are allowed, see `ITEM_ALIASES` in `tools/counterweb.mjs`). Icons are inlined as base64 webp at 88x64. See [docs/ADDING_HEROES.md](docs/ADDING_HEROES.md) for how to add one.

## Adding a hero

New heroes need a portrait, a role, an item and matchup data. [docs/ADDING_HEROES.md](docs/ADDING_HEROES.md) walks through it.

## Site changes

- Plain HTML, CSS and JavaScript. No framework, no build step, and please keep it that way.
- Colors live as CSS variables on `:root` in `css/style.css`. Use them instead of new hex values.
- Anything a viewer typed or that comes from the data gets HTML-escaped before it goes in the page.
- Test at desktop width and at phone width. The panel becomes a bottom sheet under 720px.

## Pull requests

- Run `npm run check` before pushing. CI runs the same thing and will fail otherwise.
- One topic per pull request.
- Say how you verified a claim: the ability text, a replay, a match ID, your own games.
- Commit messages in plain language, present tense, no emoji.

## Reporting mistakes in the data

Please include the two heroes, which direction the counter goes, and why you think it's wrong. If you have numbers, from your own games or a site like Dotabuff, add them. Data beats opinion here, and that's the point of the project.
