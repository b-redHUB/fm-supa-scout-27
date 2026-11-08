# FM Supa Scout 27

Scouting tool for Football Manager 27. It reads every player straight from the running game's memory (read-only): the whole database, including regens and players your scouts haven't seen.

## Run it

Double-click `FM Supa Scout.bat`, or run `python server.py`. This opens http://127.0.0.1:8027. You need Python 3.10+ and numpy.

Load your save in FM27. The app scans automatically. About 40,000 players take about 5 seconds.

## What you get

- CA/PA, all attributes (including goalkeeping), personality, hidden attributes, position ratings, feet, value, wage, contract, nationality and club.
- **Shortcuts** for common searches: wonderkids, future stars, hidden gems, free agents, contracts ending, low wage, veterans, biggest risers and your shortlist.
- **Filters** for gender, positions, age, CA/PA, value, wage, contract, height, nationality, club and foot, plus minimums for any attribute or personality trait. You can save searches.
- **Table views:** overview, technical, mental, physical, goalkeeping, personality, hidden and contract. Click a header to sort by it, and use "Rate as" to rank everyone for a chosen role.
- **Player dossier** with an attribute radar, position pitch, best roles and players who play a similar way.
- **Copy for FM:** the copy button (or `C`, or double-clicking a row) copies the name so you can paste it into FM's search.
- **Shortlist** (`S`), **compare** up to four players (`X`) and **export** the current list to CSV.
- **Discover page:** ready-made outlier lists, each with its top 8 and a "See all in Scout" link. The lists are: undervalued, cheap wonderkids, ready now and cheap, running down their contract, best free agents, loan targets, stuck behind others, big potential at a small club, homegrown prospects, release clause steals, bargain wages, fastest risers, pace merchants, aerial threats, set-piece specialists, two-footed, big-game players and never injured. Every list has adjustable thresholds, which it remembers. Hide the lists you don't use. A bar at the top filters every list by gender, position and maximum fee, and can hide your own club.
- **My club page:** shows the club you manage, detected from your save. You can also pick any club, for example to look at a rival.
  - squad summary (size, age, best-18 CA, wage bill)
  - depth chart on a pitch and the three weakest positions, with upgrade targets aged 30 or under
  - first team, loaned in, out on loan (with loan end dates), contracts ending, prospects, reserves and youth, and affiliate/B-team players
- **Transfer fees:** every minimum fee release clause (the club must accept a bid of that amount) and the asking price for transfer-listed players. "Known price" shows whichever is cheaper. You can filter by either, and the "Release clause bargains" shortcut lists players with a clause of £30M or less and CA 140+. FM decides other fees only when you bid, so they can't be read.
- **Estimated fee:** the app shows what a player should cost. It uses, in order: an agent quote you recorded, the club's asking price, or FM's transfer value times a markup based on contract length (1.0× with a year left, up to 2.1× with five or more), scaled by your recorded agent quotes. Anything above a release clause is capped at the clause. To record a quote, ask an agent in FM and type the figure into the player panel. Every quote you add sharpens every estimate.
- **Loans everywhere:** a "loan" tag in the table, loan details in the player panel, and loan-status filters (on loan / owned elsewhere / not on loan). There's also an option to hide your own players while scouting.
- **Collapsible filter sections**, which remember whether they're open or closed.
- **Progress tracking:** each scan is saved in `history/`, so you can see how a player's CA has changed since the last game date you scanned.
- **Live status:** the app notices when FM is closed, when the game date moves on (it rescans automatically if you turn that on in Settings), when you load a different save (it always rescans) and when the game is patched.

## After an FM27 patch

Offsets live in `layout.json`. When `game_plugin.dll` changes, the next scan re-learns them automatically through `calibrate.py`. Each field is found by a statistical signature. Attribute names are never re-learned: they follow FM's long-standing internal attribute order, and every scan checks they still line up (for example, strikers must out-finish centre-backs). You can also run it by hand:

    python calibrate.py --check        # re-discover and show differences, don't save
    python calibrate.py                # re-discover and save
    python selftest_calibrate.py       # corrupts the offsets and checks they are recovered
    python fm27.py players.json && python test_fm27.py   # sanity checks on any save, plus known players

If the scan reports "data looks wrong" right after a game update, use Settings, then Recalibrate.

## Known gaps

- **Game date:** taken from the latest date FM has stamped on any player, so it can lag the real in-game date by a day or two.
- **Personality names:** the values are exact, but which name goes with which value was inferred from correlations.
- **Leagues:** not read yet. Use the club, or the club's country.
- **Loans and my-club detection** use offsets that `calibrate.py` doesn't re-learn yet (`loan`, `human` and `contract.TEAM` in layout.json). If a patch moves them, scouting keeps working, you'll see a warning, and you can pick your club by hand.

## Files

- `server.py`: local web server and API
- `fm27.py`: memory reader
- `calibrate.py`: patch auto-recovery
- `mem.py`: Windows process memory access
- `rtti.py`: finds C++ class vtables
- `index.html`, `app.css`, `app.js`, `discover.js`: the user interface
- `scout.js`: role ratings
