Curler Tracker v26

What changed
- Curling I/O remains the primary source.
- CurlingZone support was added as a secondary source.
- Exact-name strict matching still applies first.
- When Curling I/O and CurlingZone both return candidates with the same name quality and score,
  Curling I/O wins.
- Game titles containing " v " are suppressed in the schedule display.

Files
- app.js -> updated browser app
- sw.js -> cache version bumped to v26
- curlingzone-proxy.mjs -> small Node adapter for CurlingZone HTML pages

How the proxy fits in
The app calls:
  ./api/curlingzone/search?player=PLAYER_NAME

The provided Node script serves that route locally on port 8787.
You can either:
1. run it behind the same origin with a reverse proxy, or
2. change APP.curlingZone.adapterUrl in app.js to wherever you host it.

Run locally
  node curlingzone-proxy.mjs

Then point app.js to:
  http://localhost:8787/api/curlingzone/search

Important
The CurlingZone adapter is heuristic because CurlingZone is HTML-first rather than a documented public JSON API.
That means Curling I/O still takes precedence everywhere in the app.


Fast exact-match memory (v27): once a player is matched at score 100, the app remembers the last exact event/team and refreshes that event directly on future checks before falling back to a full cross-source search.
