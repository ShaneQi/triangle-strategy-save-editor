# Triangle Strategy save editor (web)

A static, backend-free page that opens a PC `SaveData_N.sav`, shows the editable values and
produces a new save file. Everything runs in the browser; files are never uploaded.

It edits:
- money
- convictions (Utility / Morality / Liberty)
- inventory counts, including adding a new item id
- accessory counts, including adding accessories you don't own yet
- per-unit level, EXP, HP, move, jump and the 7 stats

Before offering the download it re-opens the produced file. It checks the SHA-1 and does a full
parse, and confirms that every edited value reads back as entered.

It has not been tested by loading an edited save in the game. Keep backups. The game may
recompute derived unit stats from level and class.

## Files

| file | purpose |
|---|---|
| `public/` | **the complete static site, ready to deploy as-is** (~55 KB, no build step) |
| `public/index.html`, `app.js`, `style.css` | UI (vanilla JS, no framework) |
| `public/lib/core.js` | save codec (GVAS container, NWER cipher, SHA-1) and edit model; also usable from Node (`require`) |
| `public/lib/s1parse.js` | parser for the game-state section |
| `public/lib/bytes.js` | tiny Node-`Buffer` subset for browsers |
| `public/lib/catalog.js` | known item and accessory ids for the add suggestions. It has 122 ids, collected from a save, the game exe and the unencrypted parts of the game pak, so it is not guaranteed complete |
| `serve.js` | tiny local static server for testing |
| `Dockerfile`, `nginx.conf`, `.dockerignore` | nginx image serving `public/` |

## Host statically

Upload the contents of `public/` to any static host, such as GitHub Pages, Netlify,
Cloudflare Pages, S3 or a plain web server folder. It works from a sub-path and needs no
server configuration.

You can also try opening it with no server at all by double-clicking `public/index.html`. The
page uses only classic scripts and no `fetch`, so it should work from `file://`, but that hasn't
been tested. For a local HTTP server:

```bash
node serve.js 8080
```

## Docker

```bash
docker build -t ts-save-editor .
```

```bash
docker run --rm -p 8080:80 ts-save-editor
```

Then open http://localhost:8080.
