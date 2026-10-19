# Triangle Strategy save editor

A single-page web app that edits PC Triangle Strategy saves (`SaveData_N.sav`). Everything runs
in your browser. The save file is never uploaded, and there is nothing to install.

**Use it online: <https://shaneqi.github.io/triangle-strategy-save-editor/>**

> **Unofficial, experimental, use at your own risk.** This editor is not fully tested. Back up your
> saves before using it. See the [disclaimer](#disclaimer) below.

Feedback, bugs or feature requests: please [open an issue on GitHub](https://github.com/ShaneQi/triangle-strategy-save-editor/issues).

## What it shows and edits

The tabs follow the save file. Tabs 1–24 are the 24 parts of the game-state object, in the order they are
stored. Tabs F1 and F3–F6 are the rest of the game state, one per save function (F1 is the small header before the object, which is function 2), and S2 is the scene state saved after it. Each tab shows its position and
size, the values you can edit, and read-only raw data for anything whose meaning is not known yet; a
**Download JSON** button saves everything parsed for it. A ★ marks the tabs most worth editing: 24 Money,
4 Convictions, 17 Inventory, 18 Accessories, 23 Units and 22 Counters.

| Tab | Editable | Read-only |
|---|---|---|
| 1 Story chart, 2 Choices | story-chart node flags; dialogue choices | — |
| 4 Convictions | Utility / Morality / Liberty; a second conviction array | the rest of the part |
| 15 Place emblems | which emblem (controlling faction) each place's name banner shows | each variant's faction |
| 17 Inventory, 18 Accessories | notes as checkboxes (tick a missing note to add it, untick one to delete it; all 70 listed); item, material, medal and accessory counts; add any item or accessory the game defines (names shown in English) | a second, empty accessory map |
| 19 Battle orders, 20 Shop stock | order counts and flags; shop stock | other shop fields |
| 21 Seen list | — | notes, stories, tutorials and information opened in the menus; each character story by name with whether it was viewed |
| 22 Counters | achievement counters (e.g. #40 = total gold earned); character-story achievement tracker (flags 6/7/8, slot in advanced mode) | which Steam achievement each unit's tracker fires |
| 23 Units | level, EXP, HP, move, jump, STR/INT/DEF/MDF/DEX/AGI/LUK and battle attendance (battles fought, shown with the battles each of the unit's character stories needs) for all units (with character and class names) | speed, equipped accessories, full unit records |
| 24 Money | gold | leader name and other values |
| 3, 5–14, 16 | — | vote events, small unknown blocks, pickups, location, map actors (first 200), name flags, unit data |
| F1 Header | — | a version-like int, a byte, total play time |
| F3 Map & battle, F4 Camera, F5 World map | — | the current map's battle grid (terrain per tile), team relations, deployment slots, camera, world-map icons |
| S2 Scene state | — | the level's clock (time of day), weather/environment values, level actors with saved state |
| F6 Flags & variables | character-story unlock flags (73 stories); the 10 cats (talked to this playthrough / any playthrough); all 2,361 story/event flags as toggles | script variables (vote outcomes, story position, music…) |

Turning on **Advanced editing** (bottom bar) unlocks values whose meaning is not confirmed:
- the 2,361 story/event flags
- story-chart node flags and dialogue choices
- battle orders, shop stock and place emblems
- a second conviction array

## Use

1. Open the [hosted editor](https://shaneqi.github.io/triangle-strategy-save-editor/). To run it offline
   instead, download this repository (**Code → Download ZIP**, or `git clone`) and double-click
   `public/index.html`. No server is needed.
2. **Back up your save first.** Then choose or drop a `SaveData_N.sav` slot file. `SystemData.sav`
   holds game settings and isn't editable.
3. Change values, then click **Download edited save**.
4. Replace the original slot file with the downloaded one and load the slot in game.

Before offering the download, the editor re-opens the file it produced. It checks the SHA-1,
does a full parse, and confirms that every edited value reads back as entered.

## Caveats

- An edited save hasn't been tested in the game yet. Keep backups.
- Level and EXP are the safest unit edits. The game may recompute other stats from level and
  class when the save loads.
- Convictions are clamped by the game to 0–9999.
- Changing event flags, story-chart flags or choices can break story progression.
- Raising an achievement counter may unlock a Steam achievement.

## Disclaimer

- **Use at your own risk.**
  - This editor is experimental and has not been fully tested.
  - An edited save may not load. It can also break story progression or corrupt your progress.
  - **Always back up your save files before using it.**
- **No warranty.**
  - The software is provided "as is", without warranty of any kind, express or implied.
  - The author is not liable for any lost saves, progress or achievements, or for any other damage or loss from using it.
- **Research and personal use only.**
  - This project studies the game's save format for interoperability and personal, single-player use.
  - It is free and is not made or offered for any financial gain.
  - Don't sell it, or use it to sell edited saves, accounts or achievement services.
- **Not affiliated.**
  - This is an unofficial fan project. It is not affiliated with, endorsed by or sponsored by Square Enix, Artdink, Nintendo or Valve.
  - TRIANGLE STRATEGY and all related names, trademarks and game content belong to their respective owners.
  - The item, character, class, story and place names shown in the editor come from the game's data. They are there only to identify values in your own save.
- **No game files or keys included.**
  - The repository contains no game executables, asset packages or encryption keys.
  - You need your own legitimately obtained copy of the game.
- **Achievements and terms of service.**
  - Editing a save can affect Steam achievements and game progress.
  - Modifying saves or achievements may be against the terms of the game or platform. You are responsible for how you use this tool and for following those terms.
  - Don't use it to cheat in any competition or leaderboard, or to misrepresent achievements to others.
- **Privacy.**
  - Everything runs locally in your browser. No save data, telemetry or analytics leave your computer.
  - The bundled sample save is the author's own.
- **Removal requests.** If you hold rights to anything here and believe this project infringes them, please
  [open an issue](https://github.com/ShaneQi/triangle-strategy-save-editor/issues). The content will be reviewed and removed promptly.

## Hosting

This repository's copy is hosted on GitHub Pages at <https://shaneqi.github.io/triangle-strategy-save-editor/>.
`.github/workflows/pages.yml` publishes `public/` there on every push to `main`.

To host your own copy, upload the contents of `public/` to any static host, such as GitHub Pages,
Netlify, Cloudflare Pages or S3. It works from a sub-path and needs no server configuration.

## Files

| file | purpose |
|---|---|
| `public/` | the complete app (~120 KB, vanilla JS, no build step) |
| `public/index.html`, `app.js`, `style.css` | UI |
| `public/lib/core.js` | save codec (GVAS container, NWER cipher, SHA-1), edit keys and edit model; also usable from Node (`require`) |
| `public/lib/s1parse.js` | parser for the game-state section |
| `public/lib/bytes.js` | tiny Node-`Buffer` subset for browsers |
| `public/lib/catalog.js` | every ownable inventory id the game defines, with English names: 42 battle items, 31 materials, 2 medals and 49 accessories |
| `public/lib/gamedata.js` | character and class names, character stories with their unlock flags, story-chart titles and place names |
| `public/sample/sample.js` | a sample save (base64, ~1 MB), loaded only when you click "Load sample save" |
