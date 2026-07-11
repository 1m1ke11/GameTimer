# Installation Guide

How to run Game Timer on a new laptop from scratch using GitHub.

## What you need to install

### 1. Git

Download and install **Git**:

- Windows: https://git-scm.com/download/win
- macOS: https://git-scm.com/download/mac (or `xcode-select --install`)

Verify:

```bash
git --version
```

For a **public** GitHub repository, you do **not** need to log in to clone or pull.

### 2. Node.js

Download and install the **LTS** version:

- https://nodejs.org

Verify:

```bash
node --version
npm --version
```

Node.js 18 or newer is recommended.

## Get the project

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/GameTimer.git
cd GameTimer
```

Replace `YOUR_USERNAME` with the actual GitHub username or organization.

Install dependencies (only needed once, or after pulling updates that change dependencies):

```bash
npm install
```

## Start the server

```bash
npm start
```

The terminal will show URLs like:

```
On this computer:  http://localhost:3000
On phones (same Wi-Fi):
  http://192.168.1.42:3000
```

Open the Wi-Fi address on each phone. Every player picks a different color.

## Network and firewall

- The laptop and all phones must be on the **same Wi-Fi network**
- Phones must use Wi-Fi, not mobile data
- On Windows, allow **Node.js** through the firewall when prompted, or allow incoming connections on port **3000**

## After a server restart or crash

Game state is saved automatically in the `data/` folder (not in Git).

1. Run `npm start` again
2. Refresh each phone and rejoin your color

Timers, turn order, and turn counts are restored. Phone connections are lost when the server stops, so players need to reconnect.

## Updating to the latest version

If the project on GitHub was updated:

```bash
cd GameTimer
git pull
npm install
npm start
```

Run `npm install` again only if dependencies may have changed.

## First-time setup (developer machine only)

If the project is not on GitHub yet, on the computer where the code was written:

```bash
cd GameTimer
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/GameTimer.git
git push -u origin main
```

Then use `git clone` on any other laptop as described above.

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| Phones cannot connect | Same Wi-Fi, correct IP address, firewall allows port 3000 |
| `Port 3000 already in use` | Stop the old server process or close the other terminal running `npm start` |
| `git: command not found` | Install Git and restart the terminal |
| `npm: command not found` | Install Node.js and restart the terminal |
