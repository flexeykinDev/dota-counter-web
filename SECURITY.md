# Security

## What this project is

A static site: HTML, CSS and one JavaScript file that draws a graph, plus data files. There is no backend, no database, no login and no user data. Nothing you do on the page is stored or sent anywhere.

The page loads D3 from cdnjs and fonts from Google Fonts. Everything else, including hero portraits and item icons, ships inside the repo.

## Reporting a problem

Email booby1546@gmail.com. Please don't open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. Expect a reply within about a week.

Things worth reporting:

- A way to get HTML or JavaScript into the page through the data files or the URL (the panel escapes everything it inserts, so a hole there is a real bug).
- A dependency of the tools in `tools/` that pulls in something it shouldn't.
- A leaked API token in the repo history. `.env` is gitignored, but mistakes happen.

Things that aren't security problems here: a wrong counter, a stale patch, or the fact that the site is public.

## If you use the tools

`tools/fetch-matchups.mjs` reads a STRATZ token from `.env` or the `STRATZ_TOKEN` environment variable. Keep that file out of git, which `.gitignore` already handles. The token only reads public match data, but treat it like a password anyway.
