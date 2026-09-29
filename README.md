# galo-multiplayer
Multiplayer version of the galo game. Can scale to N players each one with his own symbol. Grid grows as players increase.

Serverless, same stack as [forca-multiplayer](https://github.com/6135/forca-multiplayer): React on GitHub
Pages, all state exchanged over a public MQTT broker, every payload AES-GCM sealed with a key derived from
the room key. No backend, no database.

## Rules

- One player hosts a room with a name and a key. Others join with the same pair, or pick it from the open list.
- 2 to 12 players. The host draws a frozen random order at the start. The seat gives the symbol:
  `X O △ □ ★ ◆ ♣ ♥ ☀ ♠ ☾ ✚`.
- The grid is `(players + 1)²`: 2 players play 3×3, 3 players 4×4, 12 players 13×13.
- The host sets how many marks in a row win (3 to 6, never more than the grid side). Default 3.
- Turns follow the order. Each round the next seat opens. A win scores 1 point. A full grid is a draw.
- A player on turn who drops gets 15 s to come back, then the turn passes.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run broker     # optional local broker on ws://127.0.0.1:1884
npm test
npm run typecheck
npm run build
npm run e2e        # three browsers, two rounds, one local broker (set CHROMIUM_PATH if needed)
npm run sniff -- "<room name>" "<room key>" [broker url]
```

Push to `main` builds and publishes `dist` to the `gh-pages` branch (`.github/workflows/main.yml`).

## Where it differs from forca

The transport (`src/net/`) is the forca code with the protocol `galo/v1`. The roles differ, because galo has
no secret word:

| Item | Decision |
|------|----------|
| Authority | The host owns the room **and** the board. There is no round master. |
| Topics | `room`, `roster`, `round` (retained, host only), `move` (players), `join`, `presence/<clientId>`. |
| A move | The player on turn publishes `move {roundId, playerId, cell, expected}`. The host checks it with the pure `roundReducer` and publishes the new `round`. `expected` is the move count the player saw, so a double click or a stale request is refused. |
| Forged moves | The host maps each client identifier to a player identifier from `join`, and refuses a `move` or a `presence` whose publisher does not match. Any player still holds the room key, so this stops mistakes and casual forgery, not a determined player. |
| Late join | Refused after the start, because the order and the grid are frozen. A known player can reload and rejoin. |
