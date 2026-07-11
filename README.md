# Game Timer

A local 4-player chess clock for phones on the same Wi-Fi network. No cloud, no accounts — just run a small Node.js server on your laptop and open the URL on each phone.

## Requirements

- Node.js 18 or newer
- All devices on the same Wi-Fi network
- Windows Firewall (or similar) must allow incoming connections on port 3000

## Quick start

```bash
npm install
npm start
```

The terminal prints URLs like:

```
On this computer:  http://localhost:3000
On phones (same Wi-Fi):
  http://192.168.1.42:3000
```

Open that address on each phone. Each player picks a different color (Red, Blue, Yellow, Green).

## How to play

1. Each person opens the URL on their phone and taps their color. **Red is the admin** and controls start, pause, and reset.
2. Tap **Start game** — Red's timer begins counting up.
3. When you finish your turn, tap **End my turn** — the next player's timer starts. Red can end any active player's turn.
4. Use **Pause** / **Resume** or **Reset** as needed — Red only.

Each player's time counts up while it is their turn. Everyone sees the same timers in real time.

## Backups

The server automatically saves game state to `data/game-state.json` after every change. Before each save, the previous state is copied into `data/backups/` (the 10 most recent backups are kept).

If the server crashes or restarts:

1. Run `npm start` again
2. Refresh each phone and rejoin your color

Timers, turn order, and turn counts are restored. Phones need to reconnect because the old connection is lost.

## Tips

- If phones cannot connect, check that they are on the same Wi-Fi (not mobile data).
- On Windows, allow Node.js through the firewall when prompted.
- Add the page to your phone's home screen for a more app-like experience.

## Project structure

```
server.js       — Express + Socket.io game state
public/
  index.html    — Mobile UI
  style.css     — Styles
  app.js        — Client logic
```
