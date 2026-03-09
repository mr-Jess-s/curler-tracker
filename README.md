Curler Tracker v21

The app uses the documented Curling I/O competition and event endpoints.

Key logic:
- full scan on open
- follow a player by lineup match
- use event->stages->games->game_positions to bind the player's team to games
- use event->draws->draw_sheets to map game IDs to draw labels/times
- after a completed win, the app only treats the next game as confirmed when the same team_id is present in that future game's game_positions
