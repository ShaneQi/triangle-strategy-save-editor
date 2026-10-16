# Triangle Strategy save editor

A single-page web app that edits PC Triangle Strategy saves (`SaveData_N.sav`). Everything runs
in your browser. The save file is never uploaded, and there is nothing to install.

## What it edits

- money
- convictions (Utility / Morality / Liberty)
- inventory counts, including adding a new item id
- accessory counts, including adding accessories you don't own yet
- per-unit level, EXP, HP, move, jump and the 7 stats

## Use

1. Download this repository: **Code → Download ZIP** on GitHub, or `git clone` it.
2. Open `public/index.html` in a browser by double-clicking it. No server is needed.
3. **Back up your save first.** Then choose or drop a `SaveData_N.sav` slot file. `SystemData.sav`
   holds game settings and isn't editable.
4. Change values, then click **Download edited save**.
5. Replace the original slot file with the downloaded one and load the slot in game.

Before offering the download, the editor re-opens the file it produced. It checks the SHA-1,
does a full parse, and confirms that every edited value reads back as entered.

## Caveats

- An edited save hasn't been tested in the game yet. Keep backups.
- Level and EXP are the safest unit edits. The game may recompute other stats from level and
  class when the save loads.
- Convictions are clamped by the game to 0–9999.
- The item id suggestions are not guaranteed complete (see `catalog.js` below).

## Hosting

To put it online instead, upload the contents of `public/` to any static host, such as GitHub
Pages, Netlify, Cloudflare Pages or S3. It works from a sub-path and needs no server configuration.

## Files

| file | purpose |
|---|---|
| `public/` | the complete app (~55 KB, vanilla JS, no build step) |
| `public/index.html`, `app.js`, `style.css` | UI |
| `public/lib/core.js` | save codec (GVAS container, NWER cipher, SHA-1) and edit model; also usable from Node (`require`) |
| `public/lib/s1parse.js` | parser for the game-state section |
| `public/lib/bytes.js` | tiny Node-`Buffer` subset for browsers |
| `public/lib/catalog.js` | known item and accessory ids for the add suggestions. It has 122 ids, collected from a save, the game exe and the unencrypted parts of the game pak |
