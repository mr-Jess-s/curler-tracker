Curler Tracker v30

What changed
- Curling I/O remains the primary source.
- CurlingZone remains a valid secondary source.
- GitHub Pages deployment is supported through config.js.
- Live polling waits until 5 minutes before a scheduled start.
- After a posted live score change, the app waits 7 minutes, then checks every 2 minutes.
- Season roster affiliations are cached as one-or-more in-season team memberships.
- Season tournament history is cached with event dates and best-effort finish labels.
- When two same-quality candidates overlap, Curling I/O still wins.
- Game titles containing " v " are suppressed in the schedule display.

Front end
- index.html
- styles.css
- config.js
- app.js
- sw.js
- manifest.webmanifest

Backend
- curlingzone-proxy.mjs
- package.json

Important
The CurlingZone proxy is still heuristic because CurlingZone is HTML-first rather than a documented public JSON API.
That means Curling I/O still takes precedence everywhere in the app.
