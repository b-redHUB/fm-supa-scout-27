# FM Supa Scout 27

Scouting tool for Football Manager 27. It reads every player straight from the running game's memory (read-only): the whole database, including regens and players your scouts haven't seen.

## Download and run

1. Download **`FM-Supa-Scout-<version>.exe`** from [Releases](../../releases).
2. Start FM27 and load your save.
3. Double-click the exe. It scans the game automatically; about 40,000 players take about 5 seconds.

Nothing to install, and no Python needed. Windows may warn about an unrecognised app because the exe isn't code-signed. Click "More info", then "Run anyway".

The app keeps its data (the learned memory layout and scan history) in `%APPDATA%\FM Supa Scout`.

## What you get

- CA/PA, all attributes (including goalkeeping), personality, hidden attributes, position ratings, feet, value, wage, contract, nationality and club.
- **Scout page:**
  - **Shortcuts** for common searches: wonderkids, future stars, hidden gems, free agents, contracts ending, release clause bargains, low wage, veterans, biggest risers and your shortlist.
  - **Filters** for gender, positions, age, CA/PA, value, estimated fee, release clause, wage, contract, loan status, height, nationality, club and foot, plus minimums for any attribute or personality trait. You can save searches, and the filter sections collapse.
  - **Table views:** overview, technical, mental, physical, goalkeeping, personality, hidden and contract. Click a header to sort, and use "Rate as" to rank everyone for a chosen role.
- **Discover page:** 18 ready-made outlier lists, each with its top 8 and a "See all in Scout" link. The lists are: undervalued, cheap wonderkids, ready now and cheap, running down their contract, best free agents, loan targets, stuck behind others, big potential at a small club, homegrown prospects, release clause steals, bargain wages, fastest risers, pace merchants, aerial threats, set-piece specialists, two-footed, big-game players and never injured. Every list has adjustable thresholds and can be hidden.
- **My club page**, with your club detected from the save (or pick any club, for example a rival):
  - **Overview:** squad summary (size, age, best-18 CA, wage bill), a depth chart on a pitch, and your weakest positions with upgrade targets.
  - **Tabs** for first team, loans in and out, contracts, and youth and reserves, all with sortable columns.
- **Player panel:** attribute radar, position pitch, best roles, transfer fee, personality, hidden attributes and "plays like" comparisons.
- **Transfer fees:**
  - FM's transfer value, release clauses (the club must accept a bid of that amount), asking prices for listed players and the fee paid at the player's last transfer.
  - **Estimated fee:** value times a contract-length markup (1.0× with a year left, up to 2.1× with five or more), capped at any release clause. Record agent quotes in the player panel and every estimate sharpens.
- **Copy for FM:** the copy button (or `C`, or double-clicking a row) copies the name so you can paste it into FM's search.
- **Shortlist** (`S`), **compare** up to four players (`X`), and **export** any list to CSV.
- **Progress tracking:** each scan is saved, so you can see how a player's CA has changed since the last game date you scanned.
- **Live status:** the app notices when FM is closed, when the game date moves on (it can rescan automatically), when you load a different save, and when the game is patched.
- **Six dark themes:** Floodlit, Midnight, Claret and blue, Away kit, Ultras and Teletext.

## Repository layout

```
electron/   desktop app shell (main.js) that most people run as the exe
server/     the scanner: local web server, memory reader, calibration, tests
  ui/       the web UI the server serves (bundled into the exe)
build.ps1   builds the exe
```

## Run from source

    cd server
    python server.py          # or double-click "FM Supa Scout.bat"

This opens http://127.0.0.1:8027 in your browser. You need Python 3.10+ and numpy. When run from source, the app keeps its data in `server/`.

To run the desktop window against the source code: `cd electron`, `npm install`, then `npx electron .`

## Build the exe

    .\build.ps1

This needs Python 3.10+ with `numpy` and `pyinstaller`, plus Node 18+. PyInstaller bundles `server/` (no Python needed on the target PC), Electron wraps it in an app window, and a single portable exe is written to `build/app/`.

## After an FM27 patch

Offsets live in `layout.json`. When `game_plugin.dll` changes, the next scan re-learns them automatically. Each field is found by a statistical signature. Attribute names are never re-learned: they follow FM's long-standing internal attribute order, and every scan checks they still line up (for example, strikers must out-finish centre-backs). If the scan reports "data looks wrong" right after a game update, use Settings, then Recalibrate.

By hand, from `server/`:

    python calibrate.py --check        # re-discover and show differences, don't save
    python calibrate.py                # re-discover and save
    python selftest_calibrate.py       # corrupts the offsets and checks they are recovered
    python fm27.py players.json && python test_fm27.py   # sanity checks on any save, plus known players

## Licence and disclaimer

MIT licensed: see [LICENSE](LICENSE). Bundled open-source components and their licences are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

FM Supa Scout is an unofficial fan-made tool. It is not affiliated with, endorsed by, or connected to Sports Interactive or SEGA, and "Football Manager" is a trademark of its owners. The repo and the app contain no game files, artwork or game data; player information is only read live from your own copy of the game. Reading game memory may be against the game's licence terms. Use at your own risk.

## Known gaps

- **Game date:** taken from the latest date FM has stamped on any player, so it can lag the real in-game date by a day or two.
- **Personality names:** the values are exact, but which name goes with which value was inferred from correlations.
- **Leagues:** not read yet. Use the club, or the club's country.
- **Loans and my-club detection** use offsets that `calibrate.py` doesn't re-learn yet (`loan`, `human` and `contract.TEAM` in layout.json). If a patch moves them, scouting keeps working, you'll see a warning, and you can pick your club by hand.
