// Triangle Strategy save editor UI. All work happens client side via TSCore (lib/core.js).
// Edits are tracked as { key -> value } using core's edit keys (see resolveKey in core.js).
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === 'class') n.className = v; else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const c of kids) if (c != null) n.append(c);
    return n;
  };

  let save = null, fileName = 'SaveData.sav', summary = null;
  const original = new Map();   // key -> original value (undefined for newly added items)
  const edits = new Map();      // key -> new value
  const added = new Set();      // item ids added by the user

  const CAT = window.TSCatalog || { names: {}, max: {} };
  const GD = window.TSGameData || { units: {}, jobs: {}, stories: [], chart: {}, places: {} };
  const itemName = id => CAT.names[id] || null;
  const unitName = id => GD.units[id] || id.replace('UNIT_MASTER_CH_', '');
  const INV_LABEL = { battleItems: 'Battle items', materials: 'Upgrade materials', medals: 'Class medals', keyItems: 'Key items & notes', table2: 'Other' };
  const UNIT_COLS = ['level', 'exp', 'hp', 'move', 'jump', 'str', 'int', 'def', 'mdf', 'dex', 'agi', 'luk'];
  const SEEN_CAT = { 1: 'Notes', 2: 'Character stories', 3: 'Tutorials', 4: 'Information' };
  // Achievement counter ids (world part 22) are EAchievementType values, in the enum's declaration order
  // (exe reflection strings at 0x143d3d6d0…; FUN_140c55f30 indexes the achievement table with them).
  const UNITS30 = ['SERENOA', 'ROLAND', 'BENEDICT', 'FREDERICA', 'GEELA', 'ANNA', 'HUGHETTE', 'ERADOR', 'RUDOLPH', 'CORENTIN', 'JULIO', 'MILO',
    'CORDELIA', 'TRAVIS', 'TRISH', 'AVLORA', 'HOSSABARA', 'NARVE', 'MEDINA', 'JENS', 'MAXWELL', 'ARCHIBALD', 'FLANAGAN', 'EZANA', 'LIONEL',
    'GROMA', 'PICCOLETTA', 'DECIMAL', 'QUAHAUG', 'GIOVANNA'];
  const ACHIEVEMENT_TYPE = [
    'ACQUIRED_ALL', 'PARTY_MEMBER_ALL', 'FAITH_MORAL_MAX', 'FAITH_BENEFIT_MAX', 'FAITH_FREEDOM_MAX', 'FAITH_ALL_MAX', 'VOTE_PERSUASION',
    'VOTE_UNANIMOUS', 'VOTE_FINAL', 'NOT_BURN_VILLAGE', 'REVEAL_ROLAND', 'RECEIVE_ROYAL_RING', 'FOUND_ROCK_SALT', 'ACCUSATION_ILLEGAL',
    'BENEDICT_ROOT_CLEAR', 'ROLAND_ROOT_CLEAR', 'FREDERICA_ROOT_CLEAR', 'SERENOA_ROOT_CLEAR', 'BATTLE_WIN_FIRST', 'BATTLE_WIN_COUNT',
    'BATTLE_ATTACK_WEAK', 'BATTLE_ATTACK_PURSUIT', 'BATTLE_BACK_ATTACK', 'BATTLE_LAND_FIRE', 'BATTLE_LAND_FREEZE', 'BATTLE_LAND_PUDDLE',
    'BATTLE_UNIT_ELECTRIC_CHOCK', 'BATTLE_UNIT_CRUSH', 'BATTLE_UNIT_FALL_DAMAGE', 'BATTLE_ATTACK_COUNTER', 'BATTLE_HEAL', 'BATTLE_ATTACK_BUFF',
    'BATTLE_ATTACK_DEBUFF', 'BATTLE_USE_ITEM', 'BATTLE_DEFEAT_5UNIT', 'BATTLE_VICTORY_UNIT_HALF', 'BATTLE_DAMAGE_MINECART',
    'BATTLE_ACQUIRED_DROP_ITEM', 'BATTLE_USE_TRUMP', 'BATTLE_EXPLOIT', 'MONEY_ACQUIRED', 'QUEST_CLEAR_FINAL', 'QUEST_CLEAR_ALL', 'TALK_CAT_ALL',
    'TRUMP_ALL_KP_MAX', 'STORY_CHART_COMPLETE', 'NOTE_COMPLETE', 'INFORMATION_COMPLETE', 'WEAPON_ABILITY_COMPLETE',
    ...UNITS30.map(u => 'MASTER_' + u), ...UNITS30.slice(1).map(u => 'CHAR_STORY_' + u), 'ERROR_ACHIEVEMENT'];
  const achievementLabel = id => {
    const t = ACHIEVEMENT_TYPE[id];
    if (!t) return `Counter ${id}`;
    const words = t.toLowerCase().replace(/_/g, ' ');
    return words[0].toUpperCase() + words.slice(1);
  };
  const ICON_TYPE = {
    MAIN_STORY: 'Story scene', MAIN_BATTLE: 'Battle', MAIN_RESEARCH: 'Exploration', OPTIONAL_RESEARCH: 'Optional exploration',
    MAIN_VOTE: 'Vote', MAIN_VOTE_CRITICAL: 'Vote', SUB_STORY: 'Side story', SUB_JO: 'Recruitment story',
    SUB_HA: 'Character story, part 1', SUB_KYU: 'Character story, part 2',
  };
  const CHAPTER_KEYS = Object.keys(GD.chapters || {}).sort((a, b) => b.length - a.length);
  const chapterOf = ev => { const k = CHAPTER_KEYS.find(k => ev === k || ev.startsWith(k + '_')); return k ? GD.chapters[k] : null; };
  // Readable meaning of an event flag, or null. WI_END_<event> = world-map event finished in this playthrough,
  // WI_END_<event>_EX = finished in any playthrough (kept in New Game+; inferred from save data).
  function flagMeaning(id) {
    let m = id.match(/^WI_END_(.+?)(_EX)?$/);
    if (m) {
      const ev = m[1], ic = (GD.icons || {})[ev], when = m[2] ? 'done in any playthrough' : 'done this playthrough';
      const story = GD.stories.find(s => s[4] && s[4].replace(/^WI_END_|_EX$/g, '') === ev);
      const what = story ? `${story[2]}${story[3] ? ': ' + story[3] : ''}` : chapterOf(ev);
      if (!ic) return /^MS/.test(ev) ? [what, 'no world-map icon (likely unused)', when].filter(Boolean).join(' · ') : null;
      return [what, ICON_TYPE[ic[0]] || ic[0], ic[1], when].filter(Boolean).join(' · ');
    }
    m = id.match(/^CHAPTER_(START|END)_(.+)$/);
    if (m) {
      const c = Object.values(GD.chart).find(c => c[3] === id || c[4] === id);
      const name = c ? [c[1], c[2]].filter(Boolean).join(' – ') : chapterOf(m[2]);
      return name ? `${name} · chapter ${m[1] === 'START' ? 'started' : 'finished'}` : null;
    }
    return null;
  }

  // ---- file loading --------------------------------------------------------------------------
  const drop = $('#drop'), input = $('#file');
  input.addEventListener('change', () => input.files[0] && load(input.files[0]));
  // sample save: sample/sample.js (~1 MB) is injected only on click; a <script> tag works from file:// where fetch doesn't
  const sampleBtn = $('#sample-btn');
  sampleBtn.addEventListener('click', () => {
    const go = () => {
      const bin = atob(window.TSSample.b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      load(new File([u], window.TSSample.name));
    };
    if (window.TSSample) return go();
    sampleBtn.disabled = true; sampleBtn.textContent = 'Loading sample…';
    const s = document.createElement('script');
    s.src = 'sample/sample.js';
    s.onload = () => { sampleBtn.disabled = false; sampleBtn.textContent = 'Load sample save'; go(); };
    s.onerror = () => { sampleBtn.disabled = false; sampleBtn.textContent = 'Load sample save'; showError('Could not load sample/sample.js.'); };
    document.head.append(s);
  });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });

  function showError(msg) { const b = $('#error'); b.textContent = msg; b.hidden = !msg; }

  async function load(file) {
    showError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const s = TSCore.open(bytes);
      if (!s.ok) throw new Error('The file decrypts but its SHA-1 check fails. It may be corrupted.');
      if (s.kind !== 1) throw new Error('This is SystemData.sav (game settings). Open a SaveData_N.sav slot file instead.');
      save = s; fileName = file.name; summary = TSCore.summarize(s.p, s.ss, s.s1);
      original.clear(); edits.clear(); added.clear();
      render();
    } catch (e) {
      save = null; $('#editor').hidden = true; $('#bar').hidden = true;
      showError(`Could not open ${file.name}: ${e.message}`);
      console.error(e);
    }
  }

  // ---- inputs ---------------------------------------------------------------------------------------
  const advanced = () => $('#advanced').checked;
  function track(key, value) { if (!original.has(key)) original.set(key, value); }
  function numInput(key, value, opts = {}) {
    track(key, value);
    const i = el('input', { type: 'number', class: 'num', step: '1', min: opts.min, max: opts.max, dataset: { key } });
    if (opts.adv) { i.dataset.adv = '1'; i.disabled = !advanced(); }
    i.value = edits.has(key) ? edits.get(key) : value;
    i.classList.toggle('changed', edits.has(key));
    i.addEventListener('input', () => setEdit(key, i.value.trim() === '' ? NaN : Number(i.value), i));
    return i;
  }
  function boolInput(key, value, opts = {}) {
    track(key, value ? 1 : 0);
    const i = el('input', { type: 'checkbox', dataset: { key } });
    if (opts.adv) { i.dataset.adv = '1'; i.disabled = !advanced(); }
    i.checked = edits.has(key) ? !!edits.get(key) : !!value;
    i.classList.toggle('changed', edits.has(key));
    i.addEventListener('change', () => setEdit(key, i.checked ? 1 : 0, i));
    return i;
  }
  function setEdit(key, v, node) {
    const orig = original.get(key);
    if (Number.isInteger(v) && v !== orig) edits.set(key, v); else if (v === orig) edits.delete(key);
    if (node) node.classList.toggle('changed', edits.has(key));
    // A flag can have two checkboxes (a story's or cat's flag is also in the event-flag list): keep them in step.
    document.querySelectorAll(`input[type=checkbox][data-key="${CSS.escape(key)}"]`).forEach(i => {
      i.checked = !!v; i.classList.toggle('changed', edits.has(key));
    });
    if (key.startsWith('flag.EV_CAT_TALK_')) catCount();
    updateBar();
  }
  $('#advanced').addEventListener('change', () => {
    document.querySelectorAll('[data-adv]').forEach(i => { i.disabled = !advanced(); });
  });

  function field(label, inputNode) { return el('label', { class: 'field' }, el('span', {}, label), inputNode); }
  const row = (id, label, sub, input, extra) => el('div', { class: 'row', dataset: { search: `${id} ${label || ''} ${sub || ''}`.toUpperCase() } },
    el('label', { title: id }, label ? el('span', { class: 'iname' }, label) : null, sub ? el('span', { class: 'iid' }, sub) : null, extra || null), input);
  const filterRows = (box, q, pred) => {
    q = q.trim().toUpperCase();
    box.querySelectorAll('.row').forEach(r => { r.hidden = (q && !r.dataset.search.includes(q)) || (pred && !pred(r)); });
  };

  // ---- rendering ----------------------------------------------------------------------------------------
  // The tabs follow the world object (s1, FUN_140d3b260): one tab per part, in save order. Each tab holds
  // everything the editor knows about that part: inputs where its meaning is known, raw JSON for the rest.
  const hex = n => '0x' + n.toString(16).toUpperCase();
  // byte arrays: short ones (e.g. the per-unit vote bytes in part 3) as numbers, big ones (thumbnail, raw ability data) as a size
  const jsonText = v => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString()
    : (x && x.buffer instanceof ArrayBuffer && x.length !== undefined && !Array.isArray(x) ? (x.length <= 64 ? `[${Array.from(x).join(', ')}]` : `<${x.length} bytes>`) : x), 1);
  // the whole part for download: nothing cut, every byte array in full as hex
  const fullJson = v => JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString()
    : (x && x.buffer instanceof ArrayBuffer && x.length !== undefined && !Array.isArray(x) ? Array.from(x, b => b.toString(16).padStart(2, '0')).join('') : x), 1);
  function downloadText(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  // read-only JSON view; filled on first open so large parts don't slow down loading
  function rawView(get, opts = {}) {
    const pre = el('pre', { class: 'raw' }), size = el('span', { class: 'hint' });
    const d = el('details', {}, el('summary', {}, opts.label || 'Raw data (read-only)', ' ', size), pre);
    d.addEventListener('toggle', () => {
      if (!d.open || pre.textContent) return;
      const text = jsonText(get());
      pre.textContent = text.length > 300000 ? text.slice(0, 300000) + '\n… (truncated)' : text;
      size.textContent = `${(text.length / 1024).toFixed(1)} KB`;
    });
    if (opts.open) d.open = true;
    return d;
  }
  const note = (...kids) => el('p', { class: 'note' }, ...kids);
  const card = (title, ...kids) => el('div', { class: 'card' }, title ? el('h2', {}, ...[].concat(title)) : null, ...kids);
  const advTag = () => el('span', { class: 'tag' }, 'advanced');
  const rowsBox = id => el('div', { id, class: 'rows' });
  function filterBox(placeholder, target) {
    const i = el('input', { type: 'search', placeholder });
    i.addEventListener('input', () => filterRows(target, i.value));
    return i;
  }

  // n, parser mark (where the part starts), serializer, tab label, renderer(panel, w)
  // tabs most worth editing: the meaning is known and the edit is practical (★ in the tab bar)
  const KEY_PARTS = {
    4: 'convictions', 17: 'notes, items, materials and medals (and adding new ones)', 18: 'accessories (and adding new ones)',
    22: 'achievement counters and the character-story achievement re-send (verified in game)', 23: 'unit level, EXP and stats', 24: 'gold',
  };
  const PARTS = [
    [1, 'storyChart', 'FUN_140d5e9a0', 'Story chart', partStoryChart],
    [2, 'selections', 'FUN_140d5e370', 'Choices', partChoices],
    [3, 'f240', 'FUN_140d5f240', 'Votes', (p, w) => p.append(card(null, note('Vote events: names, records, strings and two 128-bool arrays. Meanings not mapped yet.'), rawView(() => w.f240, { open: true })))],
    [4, 'f3bb00', 'FUN_140d3bb00', 'Convictions', partConvictions],
    [5, 'f5bdc0', 'FUN_140d5bdc0', 'Block 5', (p, w) => p.append(card(null, note('A present flag plus a list of {int, int, int}. Meaning unknown.'), rawView(() => w.f5bdc0, { open: true })))],
    [6, 'f3c8f0', 'FUN_140d3c8f0', 'Block 6', (p, w) => p.append(card(null, note('int32, int32 list, int32, name. Meaning unknown.'), rawView(() => w.f3c8f0, { open: true })))],
    [7, 'f3c640', 'FUN_140d3c640', 'Block 7', (p, w) => p.append(card(null, note('Two int32. Meaning unknown.'), rawView(() => w.f3c640, { open: true })))],
    [8, 'f5e2e0', 'FUN_140d5e2e0', 'Block 8', (p, w) => p.append(card(null, note('Eight bools. Meaning unknown.'), rawView(() => w.f5e2e0, { open: true })))],
    [9, 'pickups', 'FUN_140d26550', 'Pickups', (p, w) => p.append(card(null, note(`Field items already picked up (${w.pickups.length}).`), rawView(() => w.pickups, { open: true })))],
    [10, 'location', 'FUN_140d5c5a0', 'Location', (p, w) => p.append(card(null, note('Current map name, position and related values.'), rawView(() => w.location, { open: true })))],
    [11, 'rec60', 'FUN_140d38d30', 'Map actors', (p, w) => p.append(card(null,
      note(`${w.rec60.length} map actor/NPC state records. Only the first 200 are shown here; Download JSON (above) has all of them.`), rawView(() => w.rec60.slice(0, 200), { open: true })))],
    [12, 'f5b7d0', 'FUN_140d5b7d0', 'Block 12', (p, w) => p.append(card(null, note('u8 and int32. The game writes the int from a global on save and ignores it on load.'), rawView(() => w.f5b7d0, { open: true })))],
    [13, 'flags4dc', '(inline)', 'Block 13', (p, w) => p.append(card(null, note('Four bools written by the world object itself. Meaning unknown.'), rawView(() => w.flags4dc, { open: true })))],
    [14, 'f3a4e0', 'FUN_140d3a4e0', 'Name flags', (p, w) => p.append(card(null, note(`Name → bool set (${w.f3a4e0.length}; BATTLE_MAPCFG_* and others).`), rawView(() => w.f3a4e0, { open: true })))],
    [15, 'f5df20', 'FUN_140d5df20', 'Place emblems', partPlaces],
    [16, 'f5d170', 'FUN_140d5d170', 'Unit data', (p, w) => p.append(card(null, note('Per-unit name → int maps. Meaning unknown.'), rawView(() => w.f5d170, { open: true })))],
    [17, 'f5bd60', 'FUN_140d5bd60', 'Inventory', partInventory],
    [18, 'f39570', 'FUN_140d39570', 'Accessories', partAccessories],
    [19, 'f39000', 'FUN_140d39000', 'Battle orders', partOrders],
    [20, 'f5caf0', 'FUN_140d5caf0', 'Shop stock', partShop],
    [21, 'f3b880', 'FUN_140d3b880', 'Seen list', partSeen],
    [22, 'fc68e10', 'FUN_140c68e10', 'Counters', partCounters],
    [23, 'units', 'FUN_140decb40', 'Units', partUnits],
    [24, 'worldTail', '(inline)', 'Money', partTail],
  ];
  let currentTab = 'part1';

  // s1 functions 3-5 (n, serializer, tab label, next mark, renderer); 6 is the flag manager tab
  const FUNCS = [
    [3, 'FUN_140d39a50', 'Map & battle', 'fn4', fnMap],
    [4, 'FUN_140d5c7e0', 'Camera', 'fn5', fnCamera],
    [5, 'FUN_140d5ce30 (FUN_14114f070)', 'World map', 'fn6', fnWorldMap],
  ];
  function fnStarts() { const at = {}; for (const [l, o] of save.s1.marks) if (!(l in at)) at[l] = o; return at; }
  function fnData(n) {
    const t = save.s1.tail, f = save.s1.flags;
    if (n === 1) return save.s1.head;
    if (n === 6) return { sysGlobals: t ? t.sysGlobals : null, flags: f };
    if (!t) return null;
    if (n === 4) return t.fn4;
    if (n === 5) return t.fn5 || null;
    const { fn4, fn5, sysGlobals, ...fn3 } = t;
    return fn3;
  }
  // "Part 1 of 24: … · FUN_… · s1+0x… · N bytes [Download JSON]"
  function metaLine(title, fn, s1Offset, len, file, get, area = 's1') {
    const dl = el('button', { type: 'button', class: 'ghost small', title: 'Everything the parser read for this, as JSON (byte arrays as hex)' }, 'Download JSON');
    dl.addEventListener('click', () => downloadText(`${fileName.replace(/\.sav$/i, '')}-${file}.json`, fullJson(get())));
    return el('p', { class: 'part-meta' }, el('strong', {}, title), ` · ${fn}`,
      s1Offset != null ? ` · ${area}+${hex(s1Offset)} · ${len.toLocaleString()} bytes ` : ' ', dl);
  }
  const f32 = i => new Float32Array(Int32Array.of(i).buffer)[0];
  const num = x => (Number.isInteger(x) ? String(x) : String(+x.toFixed(4)));
  const kv = pairs => el('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  const simpleTable = (head, rows) => el('div', { class: 'scroll' }, el('table', {},
    el('thead', {}, el('tr', {}, ...head.map(h => el('th', {}, h)))), el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', {}, c)))))));

  // -- s1 function 3: map / battle state (FUN_140d39a50)
  function fnMap(p, t) {
    const m = t.map, sc = m.scene;
    if (sc) {
      const panelRec = sc.panels[0], g = panelRec && panelRec.grids[0];
      const kids = [note('The map the save was made on and its battle panel grid (one panel record and one grid in the sample). Each tile has a terrain name and a value of 1–3 that is probably its height (inferred).'),
        kv([['Map', m.name], ['Panel record', panelRec ? panelRec.names.join(', ') : '—'], ['Grid', g ? `${g.w} × ${g.h} (${g.cells.length} tiles)` : '—']])];
      if (g) {
        const terr = {};
        for (const c of g.cells) terr[c.name] = (terr[c.name] || 0) + 1;
        kids.push(simpleTable(['Terrain', 'Tiles'], Object.entries(terr).map(([k, v]) => [k.replace('TEXT_COMMON_PANEL_NAME_', '').toLowerCase(), String(v)])));
        if (g.cells.length === g.w * g.h) {
          kids.push(el('div', { class: 'mapgrid', style: `grid-template-columns: repeat(${g.w}, 1fr)`, role: 'img', 'aria-label': `Panel grid, ${g.w} by ${g.h}, coloured by terrain` },
            ...g.cells.map((c, i) => el('span', { class: 'tile ' + (/STONE/.test(c.name) ? 'stone' : 'soil'), dataset: { h: Math.min(c.b0, 3) },
              title: `#${i} (${i % g.w}, ${Math.floor(i / g.w)}) · ${c.name.replace('TEXT_COMMON_PANEL_NAME_', '').toLowerCase()} · ${c.b0}` }))));
          kids.push(el('p', { class: 'hint' }, 'Tiles in stored order, row by row. Darker = higher value (1–3). Hover a tile for its index, terrain and value.'));
        }
      }
      p.append(card('Map & panel grid', ...kids));
    } else p.append(card('Map', kv([['Map', m.name], ['Panel scene', 'none']])));
    const teamName = v => ({ 0: 'same', 1: 'ally', 2: 'enemy' })[v] || String(v);
    if (t.objs.length) p.append(card('Teams', note('One record per team. Each holds a byte per team; the pattern (0 on the diagonal) reads as a relationship table: 0 = same team, 1 = allied, 2 = hostile (inferred). Unit lists are empty outside battle.'),
      simpleTable(['Team', ...t.objs.map((_, i) => `→ ${i}`), 'Units'], t.objs.map(o => [String(o.b), ...o.bytes.map(b => `${b} (${teamName(b)})`), String(o.units.length)]))));
    if (t.d3a770) {
      const d = t.d3a770, names = l => l.length ? l.map(x => unitName(x.n || x)).join(', ') : '—';
      p.append(card('Deployment (probably)', note('Grid slots with x/y and the unit placed there, then unit lists and a number per unit. Looks like the battle-preparation lineup; the lists\' and numbers\' meanings are unknown.'),
        simpleTable(['x', 'y', 'b', 'Unit', 'Flag'], d.a.map(s => [String(s.i), String(s.j), String(s.b), s.n === 'None' ? '—' : unitName(s.n), s.f ? '✓' : ''])),
        kv([['List 1', d.b.map(x => unitName(x.n) + (x.f ? ' ✓' : '')).join(', ') || '—'], ['List 2', names(d.c)], ['List 3', names(d.d)], ['List 4', names(d.e)]]),
        simpleTable(['Unit', 'Value (float)'], d.f.map(x => [unitName(x.n), num(f32(x.v))]))));
    }
    p.append(card('Everything else', note(`Battle actors: ${m.actorsA.length} + ${m.actorsB.length} (none outside battle). The remaining ints, maps and lists are below; their meanings are unknown.`),
      rawView(() => fnData(3), { label: 'Whole function (read-only)' })));
  }

  // -- s1 function 4: camera and player (FUN_140d5c7e0)
  function fnCamera(p, t) {
    const f = t.fn4, x = f.xformE0;
    p.append(card('Camera', note('Five camera values. In the sample they equal the script variable STAND_BY_MODE_CAMERA_PARAMS (function 6), so this is the encampment camera.'),
      f.cam ? el('p', {}, f.cam.map(num).join(', ')) : el('p', {}, 'none')),
    card('Player and transform', kv([
      ['Player actor', f.hasPlayer ? `${f.player}` : 'none'],
      ['Transform position', x.t.map(num).join(', ')], ['Rotation (quaternion)', x.q.map(num).join(', ')], ['Scale', x.s.map(num).join(', ')],
      ['Name', f.n164], ['Object FUN_140f95270', f.f95270 ? `${f.f95270.length} entries` : 'not in this save'],
    ]), note('Meaning of the transform is unknown (probably the player\'s or the camera target\'s last position).'), rawView(() => fnData(4), { label: 'Whole function (read-only)' })));
  }

  // -- s1 function 5: world-map state (FUN_14114f070)
  const iconLabel = id => {
    const ev = id.replace(/^WORLD_ICON_/, '');
    const story = GD.stories.find(s => s[4] && s[4].replace(/^WI_END_|_EX$/g, '') === ev);
    if (story) return `${story[2]}${story[3] ? ': ' + story[3] : ''}`;
    const ic = (GD.icons || {})[ev];
    return [chapterOf(ev), ic && (ICON_TYPE[ic[0]] || ic[0]), ic && ic[1]].filter(Boolean).join(' · ') || null;
  };
  function fnWorldMap(p, t) {
    const f = t.fn5;
    if (!f) { p.append(card(null, note('Not in this save (the game writes it only when the world map exists).'))); return; }
    const same = JSON.stringify([...f.icons].sort()) === JSON.stringify([...f.icons2].sort());
    p.append(card('World map', kv([['Values', `${f.a}, ${f.b} (probably current and previous location)`], ['Vector', f.v.map(num).join(', ')],
      ['Bytes / int', `${f.b1fc}, ${f.b20c} / ${f.i200}`], ['Transforms', `${f.list.length} entries`], ['Second icon set', same ? 'same as the first' : `${f.icons2.length} names`]])),
    card(`World-map icons (${f.icons.length})`, note('World-map icons held by the world-map scene. Not unlock state: all character-story icons are listed regardless of progress.'),
      el('div', { class: 'rows' }, ...f.icons.map(id => row(id, iconLabel(id) || id, iconLabel(id) ? id : null, el('span')))),
      rawView(() => fnData(5), { label: 'Whole function (read-only)' })));
  }

  // -- s2: GameState save data (time of day, environment, level actors)
  function renderS2(p, s2) {
    if (!s2) return;
    if (s2.error || !s2.clock) {
      p.append(card(null, note(s2.error ? `Not fully understood for this save: ${s2.error}. Download JSON has what was read.` : 'Only the flag is present (no GameState data in this save).')));
      return;
    }
    const hhmm = x => `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor(x / 60) % 60).padStart(2, '0')}`;
    const c = s2.clock.f;
    p.append(card('Scene state', note('Written by the level\'s GameState after s1: a few flags, a clock, the environment/weather component, and level actors whose state the game keeps. Read-only; most meanings are inferred.'),
      kv([['Flag / bools', `${s2.flag} / ${s2.bools.map(b => (b ? '1' : '0')).join(', ')}`],
        ['Clock', `${hhmm(c[0])} and ${hhmm(c[4])} (seconds of the day: ${num(c[0])}, ${num(c[4])}); rate ${num(c[10])}`],
        ['Environment', `${s2.env.i430.map(num).join(', ')} · ${num(s2.env.f448)}, ${num(s2.env.f44c)} · optional block ${s2.env.hasExtra ? 'present' : 'absent'}`],
        ['Component +0x2A8', `${s2.c2a8.i.join(', ')} · ${s2.c2a8.b.join(', ')} · lists empty`]])),
    card(`Level actors (${s2.actors.length})`, note('Actors in the current level whose state is saved (rain, smoke, post-processing, visibility…), with their tags.'),
      simpleTable(['Actor', 'Tags', 'Values'], s2.actors.map(a => [a.name, a.tags.join(', ') || '—', [...a.i, a.n, ...a.j].join(', ')]))),
    card('Everything', rawView(() => s2, { label: 'Whole s2 (read-only)' })));
  }

  // -- s1 function 6 extras: script variables before the flag table, fields after it
  function renderFn6Extras(t) {
    const flags = save.s1.flags;
    if (t) {
      const box = rowsBox('sysvars');
      box.append(...t.sysGlobals.map(g => row(g.name, g.name, null, el('span', { class: 'val' }, typeof g.v === 'string' ? `"${g.v}"` : String(g.v)))));
      $('#fn6-vars').replaceChildren(card(['Script variables ', el('span', { class: 'tag' }, 'read-only')],
        note('The game\'s ELuaSysGlobal variables, written just before the flag table: battle bookkeeping, vote outcomes per chapter, story position (SCENARIO_ANCHOR), the level and weather before a quest, music. Names come from the game; values are ints or strings.'),
        filterBox('Filter variables…', box), box));
    } else $('#fn6-vars').replaceChildren();
    $('#fn6-after').replaceChildren(flags ? card('After the flag table', kv([
      ['String', flags.nextStr === undefined ? '—' : `"${flags.nextStr}"`],
      ['String list', flags.after ? (flags.after.strings.length ? flags.after.strings.join(', ') : 'empty') : 'not parsed'],
      ['Int', flags.after ? String(flags.after.i7340) : 'not parsed'],
      ['String map', flags.after ? (flags.after.map.length ? flags.after.map.map(e => `${e.k} = ${e.v}`).join(', ') : 'empty') : 'not parsed']])) : '');
  }

  // start offset and size of each part, from the parser's marks (units are one mark per unit)
  function partRanges() {
    const m = save.s1.marks, at = {}, out = {};
    for (const [label, o] of m) if (!(label in at)) at[label] = o;
    const order = PARTS.map(p => p[1]).concat('stop');
    for (let i = 0; i < PARTS.length; i++) out[order[i]] = [at[order[i]], at[order[i + 1]] - at[order[i]]];
    return out;
  }

  function render() {
    $('#editor').hidden = false; $('#bar').hidden = false;
    renderOverview();
    const w = save.s1.world, ranges = partRanges(), s1off = save.ss[1].off;
    const nav = $('#tabs'), panels = $('#panels');
    nav.replaceChildren(); panels.replaceChildren();
    // s1 function 1, the header (FUN_140d5cea0); function 2 is the world object (tabs 1-24)
    {
      const h = save.s1.head, worldAt = fnStarts().FUN_140d3b260;
      nav.append(el('button', { role: 'tab', dataset: { tab: 'fn1' }, class: 'fn-tab' }, 'F1 Header'));
      const cs = Number(h.playCs.v), s = Math.floor(cs / 100), pv = TSCore.preview(save.p, save.ss[0]);
      const hms = x => `${Math.floor(x / 3600)}h ${String(Math.floor(x / 60) % 60).padStart(2, '0')}m ${String(x % 60).padStart(2, '0')}s`;
      panels.append(el('div', { class: 'panel', dataset: { panel: 'fn1' } },
        metaLine('s1 function 1 of 6: Header', 'FUN_140d5cea0', 0, worldAt - s1off, 's1-function1-header', () => fnData(1)),
        card(['Header ', el('span', { class: 'tag' }, 'read-only')],
          note('The first thing in the game state, before the world object (function 2, tabs 1–24).'),
          kv([['Int', `${h.ver} (0x${h.ver.toString(16)})`], ['Byte', String(h.b)],
            ['Play time', `${hms(s)} (${cs.toLocaleString()} hundredths of a second)`],
            ['Slot preview play time', `${hms(pv.playSeconds)}${pv.playSeconds === s ? ' (matches)' : ''}`]]))));
    }
    for (const [n, mark, fn, label, renderPart] of PARTS) {
      const key = KEY_PARTS[n];
      nav.append(el('button', { role: 'tab', dataset: { tab: 'part' + n }, class: key ? 'key' : null, title: key ? `Most worth editing: ${key}` : null },
        key ? el('span', { class: 'star', 'aria-hidden': 'true' }, '★ ') : null, `${n} ${label}`));
      const [o, len] = ranges[mark];
      const panel = el('div', { class: 'panel', dataset: { panel: 'part' + n } },
        metaLine(`Part ${n} of 24: ${label}`, fn, o - s1off, len,
          `part${String(n).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, () => (mark === 'worldTail' ? w.tail : w[mark])));
      renderPart(panel, w);
      panels.append(panel);
    }
    // s1 functions 3-6, after the world object (function 2). Function 6's panel is the static one in index.html.
    const t = save.s1.tail, fat = fnStarts();
    for (const [n, fn, label, next, renderFn] of FUNCS) {
      nav.append(el('button', { role: 'tab', dataset: { tab: 'fn' + n }, class: 'fn-tab' }, `F${n} ${label}`));
      const panel = el('div', { class: 'panel', dataset: { panel: 'fn' + n } },
        metaLine(`s1 function ${n} of 6: ${label}`, fn, t ? fat['fn' + n] - s1off : null, t ? fat[next] - fat['fn' + n] : null,
          `s1-function${n}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, () => fnData(n)));
      if (t) renderFn(panel, t);
      else panel.append(card(null, note(`Not parsed for this save: ${save.s1.tailError || 'unknown reason'}. The event flag table was found by searching for it instead.`)));
      panels.append(panel);
    }
    nav.append(el('button', { role: 'tab', dataset: { tab: 'flags' }, class: 'fn-tab' }, 'F6 Flags & variables'));
    $('#fn6-meta').replaceChildren(...metaLine('s1 function 6 of 6: Flags & variables', 'FUN_140ef66e0 (FUN_140ef6310)',
      t ? fat.fn6 - s1off : null, t ? fat.end - fat.fn6 : null, 's1-function6-flags-and-variables', () => fnData(6)).childNodes);
    renderFlags();
    renderFn6Extras(t);
    // s2: the GameState's save data (after all of s1)
    nav.append(el('button', { role: 'tab', dataset: { tab: 's2' }, class: 'fn-tab' }, 'S2 Scene state'));
    const s2panel = el('div', { class: 'panel', dataset: { panel: 's2' } },
      metaLine('s2: scene state', 'GameState vtable+0x6C8 (FUN_140e0fbe0)', 0, save.ss[2].len, 's2-scene-state', () => save.s2, 's2'));
    renderS2(s2panel, save.s2);
    $('#panels').append(s2panel);
    nav.querySelectorAll('button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
    showTab(currentTab);
    updateBar();
  }
  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  }

  function renderOverview() {
    const pv = TSCore.preview(save.p, save.ss[0]);
    const h = Math.floor(pv.playSeconds / 3600), m = Math.floor(pv.playSeconds / 60) % 60;
    const meta = $('#meta'); meta.replaceChildren();
    const add = (k, v) => meta.append(el('dt', {}, k), el('dd', {}, v));
    add('File', fileName);
    add('Leader', pv.leader);
    add('Chapter', pv.title);
    add('Saved', pv.savedAt.toLocaleString());
    add('Play time', `${h}h ${String(m).padStart(2, '0')}m`);
    add('Format', `NWER v0x${save.version.toString(16)}, SHA-1 OK, ${summary.units.length} units, ${save.s1.flags ? save.s1.flags.entries.length : 0} event flags`);
    const c = $('#thumb'), W = pv.thumbW, H = pv.thumbH;
    if (pv.thumb.len === W * H * 4) {
      c.width = W; c.height = H;
      const img = new ImageData(W, H), src = save.p;
      for (let i = 0, o = pv.thumb.off; i < W * H * 4; i += 4, o += 4) {
        img.data[i] = src[o + 2]; img.data[i + 1] = src[o + 1]; img.data[i + 2] = src[o]; img.data[i + 3] = 255;
      }
      c.getContext('2d').putImageData(img, 0, 0);
    }
  }

  // -- part 1: story chart
  function partStoryChart(p, w) {
    const ct = el('table');
    ct.append(el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Node'), el('th', {}, 'Title'), el('th', {}, 'f0'), el('th', {}, 'f1'), el('th', {}, 'f2'), el('th', {}, 'f3'))));
    const cb = el('tbody');
    for (const [node, fl] of Object.entries(w.storyChart)) {
      const g = GD.chart[node] || [];
      cb.append(el('tr', {}, el('td', {}, String(g[0] || '')), el('td', { class: 'iid' }, node), el('td', {}, [g[1], g[2]].filter(Boolean).join(' — ')),
        ...fl.map((f, i) => el('td', {}, boolInput(`story.${node}.${i}`, f.v, { adv: true })))));
    }
    ct.append(cb);
    p.append(card(['Story chart ', advTag()], note('Four flags per chart node as stored by the game (meanings unconfirmed). Chapter progress itself is driven by the CHAPTER_START/END flags on the Event flags tab.'),
      el('div', { class: 'scroll' }, ct)));
  }

  // -- part 2: choices
  function partChoices(p, w) {
    const box = rowsBox('choices');
    box.append(...Object.entries(w.selections).map(([id, f]) => row(id, id.replace('SELECT_PARAM_', ''), null, boolInput('choice.' + id, f.v, { adv: true }))));
    p.append(card(['Dialogue choices ', advTag()], note('One flag per decision option the game tracks.'), filterBox('Filter choices…', box), box));
  }

  // -- part 4: convictions
  function partConvictions(p, w) {
    const cv = summary.convictions, b = w.f3bb00.b;
    const C = [['utility', 'Utility'], ['morality', 'Morality'], ['liberty', 'Liberty']], idx = { liberty: 1, utility: 2, morality: 3 };
    p.append(card('Convictions', note('The game clamps each conviction to 0–9999.'),
      el('div', { class: 'grid' }, ...C.map(([k, l]) => field(l, numInput('conviction.' + k, cv[k], { min: 0, max: 9999 })))),
      el('h3', { class: 'adv-title' }, 'Second conviction array ', advTag()),
      note('A second int[4] stored right after the convictions (meaning unknown; 50 for Utility in the sample save).'),
      el('div', { class: 'grid' }, ...C.map(([k, l]) => field(l, numInput('bonusconv.' + k, b[idx[k]].v, { adv: true })))),
      rawView(() => w.f3bb00, { label: 'Whole part, incl. the sets after the arrays (read-only)' })));
  }

  // -- part 15: place emblems. Each place set has up to 3 name variants that differ only in the emblem
  // (GOP_PlaceNameSet / GOP_PlaceName.eEmblemType); the save stores which variant is shown.
  function partPlaces(p, w) {
    const emblemName = code => (GD.emblems || {})[code] || code || '?';
    const box = rowsBox('places');
    box.append(...w.f5df20.map(x => {
      const variants = (GD.placeEmblems || {})[x.id] || [];
      const cur = el('span', { class: 'new' });
      const input = numInput('place.' + x.id, x.v.v, { adv: true, min: 0, max: variants.length ? variants.length - 1 : undefined });
      const show = () => { const v = Number(input.value); cur.textContent = `→ ${variants[v] !== undefined ? emblemName(variants[v]) : 'unknown variant'}`; };
      input.addEventListener('input', show); show();
      const sub = `${x.id} · ${variants.map((c, i) => `${i} ${emblemName(c)}`).join(', ') || 'variants unknown'}`;
      return row(x.id, GD.places[x.id] || x.id, sub, input, cur);
    }));
    p.append(card(['Place emblems ', advTag()],
      note('Which name banner each place shows. A place has up to three variants that differ only in the emblem, i.e. which faction controls it; the value is the variant index. In the sample only the Grand Norzelian Mines show a non-default emblem (Aesfrost).'),
      filterBox('Filter places…', box), box));
  }

  // -- parts 17 and 18: inventory and accessories (adding an id puts it in the right table of either part)
  function itemRow(id, count, isNew) {
    const n = itemName(id);
    return row(id, n || id, n ? id : null, numInput('item.' + id, count, { min: 0, max: CAT.max[id] }), isNew ? el('span', { class: 'new' }, 'new') : null);
  }
  const tableFor = id => TSCore.groupForNewId(save.s1, id);
  function itemTables(box, tables) {
    box.replaceChildren();
    for (const [name, items] of Object.entries(tables)) {
      const ids = Object.keys(items);
      const extra = [...added].filter(id => tableFor(id) === name);
      if (!ids.length && !extra.length) continue;
      box.append(el('div', { class: 'inv-table', dataset: { table: name } },
        el('h3', {}, `${INV_LABEL[name] || 'Accessories owned'} (${ids.length + extra.length})`),
        el('div', { class: 'rows' },
          ...ids.sort((a, b) => (itemName(a) || a).localeCompare(itemName(b) || b)).map(id => itemRow(id, items[id], false)),
          ...extra.map(id => itemRow(id, original.get('item.' + id), true)))));
    }
  }
  function itemToolbar(box, prefix, what) {
    const filter = el('input', { type: 'search', placeholder: `Filter ${what}…` });
    const applyFilter = () => {
      filterRows(box, filter.value);
      box.querySelectorAll('.inv-table').forEach(t => { t.hidden = !t.querySelector('.row:not([hidden])'); });
    };
    filter.addEventListener('input', applyFilter);
    const listId = 'known-' + prefix;
    const owned = new Set([...Object.values(summary.inventory), summary.accessories].flatMap(t => Object.keys(t)));
    const suggest = TSCore.knownItemIds(save.s1).filter(id => id.startsWith(prefix) && !owned.has(id) && !added.has(id) && tableFor(id));
    const list = el('datalist', { id: listId }, ...suggest.map(id => el('option', { value: id, label: itemName(id) ? `${itemName(id)} (${id})` : id })));
    const addId = el('input', { list: listId, placeholder: `${what[0].toUpperCase() + what.slice(1, -1)} to add (name or id)`, size: '34' });
    const addCount = el('input', { type: 'number', min: '0', value: '1', class: 'num' });
    const addBtn = el('button', { type: 'button' }, 'Add');
    addBtn.addEventListener('click', () => {
      const typed = addId.value.trim(), n = Number(addCount.value);
      const byName = Object.keys(CAT.names).find(k => k.startsWith(prefix) && CAT.names[k] && CAT.names[k].toLowerCase() === typed.toLowerCase());
      const id = byName || typed.toUpperCase();
      try {
        if (!id.startsWith(prefix) || !/^[A-Z0-9_]+$/.test(id)) throw new Error(`Ids here look like ${prefix === 'ITEM_' ? 'ITEM_BATTLE_HEAL_ALL' : 'BATTLE_ACCESSARY_HP_RING'}.`);
        if (!Number.isInteger(n) || n < 0) throw new Error('Count must be a whole number ≥ 0.');
        const isOwned = [...Object.values(summary.inventory), summary.accessories].some(t => id in t);
        if (isOwned || added.has(id)) throw new Error(`${id} is already owned; edit its count instead.`);
        if (!tableFor(id)) throw new Error(`Don't know which table ${id} belongs to.`);
        added.add(id); original.set('item.' + id, undefined); edits.set('item.' + id, n);
        showError(''); render(); updateBar();
      } catch (e) { showError(e.message); }
    });
    return el('div', { class: 'toolbar' }, filter, el('span', { class: 'spacer' }), addId, list, addCount, addBtn);
  }
  // -- part 17, table 0: notes. The game stores an owned note as an entry with count 1 (FUN_140d0ca50 clamps
  // the count to 0..1 and deletes the entry at 0), so each note is a checkbox (edit key note.<ID>).
  function notesCard(w) {
    const catalog = (CAT.groups && CAT.groups.notes) || [], known = new Set(catalog.map(x => x[0]));
    const inSave = new Set(w.f5bd60[0].filter(x => x.v.v > 0).map(x => x.id));
    const ids = [...catalog.map(x => x[0]), ...w.f5bd60[0].map(x => x.id).filter(id => !known.has(id))];
    const cur = id => { const k = 'note.' + id; return edits.has(k) ? edits.get(k) : original.get(k); };
    const status = el('span', { class: 'hint' });
    const refresh = () => { status.textContent = `${catalog.filter(([id]) => cur(id)).length} of ${catalog.length} owned`; };
    const box = rowsBox('notes');
    box.append(...ids.map(id => {
      const had = inSave.has(id), i = boolInput('note.' + id, had ? 1 : 0), tag = el('span', { class: 'new' });
      i.setAttribute('aria-label', `Note: ${itemName(id) || id}`);
      const show = () => { tag.textContent = i.checked === had ? (had ? '' : 'missing') : (had ? 'will be deleted' : 'will be added'); };
      i.addEventListener('change', () => { show(); refresh(); });
      show();
      const r = row(id, itemName(id) || id, itemName(id) ? id : null, i, tag);
      r.dataset.had = had ? '1' : '0';
      return r;
    }));
    refresh();
    const q = el('input', { type: 'search', placeholder: 'Filter notes…' }), onlyMissing = el('input', { type: 'checkbox' });
    const applyFilter = () => filterRows(box, q.value, onlyMissing.checked ? r => r.dataset.had === '0' : null);
    q.addEventListener('input', applyFilter); onlyMissing.addEventListener('change', applyFilter);
    return card(['Notes ', status],
      note(`Every note in the game (${catalog.length}, GOP_Note). A note is either in the save or not: untick one to delete it, tick a missing one to add it. Changes are applied when you download. Steam ACHIEVEMENT_047 needs every note, but the game checks only at the moment it adds a note itself, so leave one missing note to pick up in game (not yet tested in game).`),
      el('div', { class: 'toolbar' }, q, el('label', { class: 'chk' }, onlyMissing, ' only notes missing from this save')), box);
  }
  function partInventory(p, w) {
    const box = el('div');
    const { keyItems, ...others } = summary.inventory;   // table 0 (notes) has its own card
    itemTables(box, others);
    p.append(notesCard(w), card('Items, materials and medals', note('The other four tables: battle items, an unused table, upgrade materials, class medals.'),
      itemToolbar(box, 'ITEM_', 'items'), box));
  }
  function partAccessories(p, w) {
    const box = el('div');
    itemTables(box, { accessories: summary.accessories });
    p.append(card('Accessories', itemToolbar(box, 'BATTLE_ACCESSARY_', 'accessories'), box,
      rawView(() => w.f39570[1], { label: `Second map (${w.f39570[1].length} entries; meaning unknown, read-only)` })));
  }

  // -- part 19: battle orders
  function partOrders(p, w) {
    const box = rowsBox('orders');
    box.append(...w.f39000.map(o => row(o.id, o.id.replace('BATTLE_ORDER_TEST_', '').replace(/_/g, ' '), o.id,
      el('span', { class: 'pair' }, numInput(`order.${o.id}.count`, o.v.v, { adv: true, min: 0 }), boolInput(`order.${o.id}.on`, o.f.v, { adv: true })))));
    p.append(card(['Battle orders ', advTag()], note('Count and the second flag as stored by the game (meaning of the flag unconfirmed).'), box));
  }

  // -- part 20: shop stock
  function partShop(p, w) {
    const box = rowsBox('shop');
    box.append(...w.f5caf0.map((s, i) => row(s.id, itemName(s.id) || s.id, `${s.id} · shop ${s.a}/${s.b}`, numInput(`shop.${i}`, s.c.v, { adv: true, min: 0 }))));
    p.append(card(['Shop stock ', advTag()], note('Remaining stock per shop entry.'), filterBox('Filter…', box), box,
      rawView(() => w.f5caf0, { label: 'All fields (read-only)' })));
  }

  // -- part 21: seen list
  function partSeen(p, w) {
    const groups = {};
    for (const x of w.f3b880) (groups[x.a] = groups[x.a] || []).push(x.id);
    // Character stories (category 2) by name: every story in the game's table, ticked if this list holds it
    const seen = new Set(groups[2] || []), st = el('table');
    st.append(el('thead', {}, el('tr', {}, el('th', {}, 'Character'), el('th', {}, 'Story'), el('th', {}, 'Viewed'))));
    const sb = el('tbody');
    for (const [id, unit, title, sub] of GD.stories)
      sb.append(el('tr', { title: id }, el('td', {}, unitName(unit)), el('td', {}, `${title}${sub ? ' — ' + sub : ''}`), el('td', {}, seen.has(id) ? '✓' : '')));
    st.append(sb);
    p.append(card('Seen notes, tutorials & information', note('What was opened in the menus. Read-only. Character stories have their own card below.'),
      ...Object.entries(groups).filter(([a]) => a !== '2').map(([a, ids]) => el('details', {}, el('summary', {}, `${SEEN_CAT[a] || 'Category ' + a} (${ids.length})`), el('div', { class: 'idlist' }, ids.join('\n'))))),
      card('Character stories viewed', note(`${GD.stories.filter(s => seen.has(s[0])).length} of ${GD.stories.length} opened in the Character Stories menu. Read-only. Their unlock flags are in tab F6.`),
        el('div', { class: 'scroll' }, st)));
  }

  // -- part 22: achievement counters and the character-story achievement tracker
  function partCounters(p, w) {
    const counters = rowsBox('counters');
    counters.append(...w.fc68e10.set.slice().sort((a, b) => a.a - b.a).map(c =>
      row(String(c.a), achievementLabel(c.a), `#${c.a} · ${ACHIEVEMENT_TYPE[c.a] || 'unknown type'}`, numInput('counter.' + c.a, c.v.v, { min: 0 }))));
    const at = el('table');
    at.append(el('thead', {}, el('tr', {}, el('th', {}, 'Unit'), el('th', {}, 'Flag 6'), el('th', {}, 'Flag 7'), el('th', {}, 'Flag 8'), el('th', {}, 'Slot'), el('th', {}, 'Achievement'))));
    const ab = el('tbody');
    for (const e of w.fc68e10.map) {
      const pid = e.id.replace('UNIT_MASTER_CH_', ''), [f6, f7, f8, slot] = e.b.map(x => x.v);
      const status = el('td', { class: 'small' });
      const refresh = () => {
        const cur = k => { const key = `charach.${pid}.${k}`; return edits.has(key) ? edits.get(key) : original.get(key); };
        const s = cur('slot'), done = cur('f6') && cur('f7') && cur('f8');
        status.textContent = `ACHIEVEMENT_${String(80 + s).padStart(3, '0')} — ${done ? 'complete' : 'incomplete'}`;
      };
      const flagBox = (k, v) => { const i = boolInput(`charach.${pid}.${k}`, v); i.addEventListener('change', refresh); return i; };
      const slotIn = numInput(`charach.${pid}.slot`, slot, { adv: true, min: 0, max: 28 }); slotIn.addEventListener('input', refresh);
      ab.append(el('tr', { title: e.id }, el('td', {}, `${unitName(e.id)} `, el('span', { class: 'iid' }, pid)),
        el('td', {}, flagBox('f6', f6)), el('td', {}, flagBox('f7', f7)), el('td', {}, flagBox('f8', f8)), el('td', {}, slotIn), status));
      refresh();
    }
    at.append(ab);
    p.append(
      card('Achievement counters', note('Progress toward each Steam achievement, by the game\'s achievement type (the id is the type\'s number in its EAchievementType enum). Only types that have been touched are stored. The game caps each value at that achievement\'s target (e.g. 100 battle wins), so a value at its target usually means the achievement is unlocked; one-off achievements store 1. Raising one can unlock the achievement the next time the game updates that type.'), counters),
      card('Character-story achievements',
        note('Per-unit tracker the game keeps for the character-story achievements. It sets flags 6, 7 and 8 when that unit\'s world-map story events of those types finish. At the moment the last of the three becomes 1, it unlocks Steam ',
          el('code', {}, 'ACHIEVEMENT_(080 + slot)'), '. Ticking all three in the save does not fire it, because the game must set the last flag itself. To re-send a missing achievement (verified in game), take a unit with exactly one flag still off and set its slot (advanced) to the target. Then play that unit\'s story from the world map. The Character Stories re-watch menu does not count. Steam only receives achievements that aren\'t unlocked yet.'),
        el('div', { class: 'scroll' }, at)));
  }

  // -- part 23: units
  // Attendance input plus the battles each of the unit's character stories needs (game data), ticked once reached
  function attendanceCell(u, pid) {
    const inp = numInput(`unit.${pid}.attendance`, u.attendance, { min: 0 }), need = (GD.attendance || {})[u.id] || [];
    if (!need.length) return el('td', {}, inp);
    const story = id => { const s = GD.stories.find(x => x[0] === id); return s ? `${s[2]}${s[3] ? ' — ' + s[3] : ''}` : id; };
    const hint = el('span', { class: 'iid', title: need.map(([n, id]) => `${story(id)}: ${n} battles`).join('\n') });
    const refresh = () => { const v = +inp.value || 0; hint.textContent = ' stories at ' + need.map(([n]) => n + (v >= n ? ' ✓' : '')).join(' / '); };
    inp.addEventListener('input', refresh); refresh();
    return el('td', {}, inp, hint);
  }
  function partUnits(p, w) {
    const t = el('table');
    t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Unit'), el('th', {}, 'Class'), ...UNIT_COLS.map(c => el('th', {}, c.toUpperCase())), el('th', {}, 'SPD'),
      el('th', { title: 'Battles the unit has fought' }, 'Attendance'), el('th', {}, 'Accessories'))));
    const body = el('tbody');
    for (const u of summary.units) {
      const pid = u.id.replace('UNIT_MASTER_CH_', '');
      body.append(el('tr', {},
        el('td', { title: u.id }, `${unitName(u.id)} `, el('span', { class: 'iid' }, pid)),
        el('td', { title: u.class }, GD.jobs[u.class] || u.class.replace('BATTLE_JOB_CH_', '')),
        ...UNIT_COLS.map(c => el('td', {}, numInput(`unit.${pid}.${c}`, u[c], { min: 0 }))),
        el('td', {}, String(u.speed)),
        attendanceCell(u, pid),
        el('td', { class: 'small' }, u.equippedAccessories.map(a => itemName('BATTLE_' + a) || a).join(', '))));
    }
    t.append(body);
    const sel = el('select', {}, ...w.units.map((u, i) => el('option', { value: i }, `Unit ${i}: ${unitName(u.p.base.master)}`)));
    const pre = el('pre', { class: 'raw' });
    const show = () => { pre.textContent = jsonText(w.units[+sel.value]); };
    sel.addEventListener('change', show); show();
    p.append(
      card('Units', note('Level and EXP are the safest edits. The game may recompute other stats from level and class when the save loads. Attendance is how many battles the unit has fought; it carries over to New Game+, and each of its character stories appears only once attendance reaches the requirement for that story. Beside it are those requirements from the game data (✓ = reached; hover for the story names); a story also needs its chapter reached. Editing attendance has not been tested in game.'), el('div', { class: 'scroll wide' }, t)),
      card('Full unit record (read-only)', el('div', { class: 'toolbar' }, sel), pre));
  }

  // -- part 24: world tail (money)
  function partTail(p, w) {
    p.append(card('Money', el('div', { class: 'grid' }, field('Gold', numInput('money', summary.money, { min: 0 }))),
      rawView(() => w.tail, { label: 'Whole part: leader name, money and the values after it (read-only)' })));
  }

  // -- event flags tab (the flag table after the world object): character-story unlock flags, cats, every flag
  function renderFlags() {
    const flags = save.s1.flags;
    const flagVal = id => { const e = flags && flags.entries.find(x => x.id === id); return e ? e.v.v : undefined; };
    const st = $('#stories'); st.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, 'Character'), el('th', {}, 'Story'), el('th', {}, 'Unlocked'), el('th', {}, 'Unlock flag'))));
    const sb = el('tbody');
    for (const [id, unit, title, sub, flag] of GD.stories) {
      const v = flagVal(flag);
      sb.append(el('tr', { title: id }, el('td', {}, unitName(unit)), el('td', {}, `${title}${sub ? ' — ' + sub : ''}`),
        el('td', {}, v === undefined ? '—' : boolInput('flag.' + flag, v)), el('td', { class: 'iid' }, flag)));
    }
    st.append(sb);
    // Cats: one EV_CAT_TALK_<level> pair each (this run, _EX any run). Feline Fanatic needs every cat with
    // either flag set (FUN_140c5b9b0). The level names a map; its place name comes from PLACENAMESET_<level>.
    const cats = flags ? flags.entries.filter(f => /^EV_CAT_TALK_/.test(f.id) && !f.id.endsWith('_EX')).map(f => f.id.slice(12)) : [];
    const ct = $('#cats'); ct.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, 'Where'), el('th', {}, 'Map'),
      el('th', {}, 'This playthrough'), el('th', {}, 'Any playthrough'))));
    const cb = el('tbody');
    for (const lv of cats) {
      const L = lv.toUpperCase(), place = GD.places['PLACENAMESET_' + L] || GD.places['PLACENAMESET_' + L.replace(/\d+$/, '')];
      cb.append(el('tr', {}, el('td', {}, place ? place.replace(' - –', ' –') : lv), el('td', { class: 'iid' }, lv),
        el('td', {}, boolInput('flag.EV_CAT_TALK_' + lv, flagVal('EV_CAT_TALK_' + lv))),
        el('td', {}, boolInput('flag.EV_CAT_TALK_' + lv + '_EX', flagVal('EV_CAT_TALK_' + lv + '_EX')))));
    }
    ct.append(cb);
    catCount();
    const box = $('#flags');
    if (!flags) { box.replaceChildren(el('p', { class: 'note' }, 'The event-flag table was not found in this save.')); }
    else {
      box.replaceChildren(...flags.entries.map(f => {
        const meaning = flagMeaning(f.id);
        // The game writes flags as bools (value != 0); keep a number box for anything else so it stays visible.
        const v = f.v.v, input = v === 0 || v === 1 ? boolInput('flag.' + f.id, v, { adv: true }) : numInput('flag.' + f.id, v, { adv: true });
        const r = row(f.id, meaning || f.id, meaning ? f.id : null, input);
        r.dataset.val = f.v.v; return r;
      }));
    }
    applyFlagFilter();
  }
  function catCount() {
    const rows = [...document.querySelectorAll('#cats tbody tr')], on = r => [...r.querySelectorAll('input')].map(i => i.checked);
    const any = rows.filter(r => on(r).some(Boolean)).length, now = rows.filter(r => on(r)[0]).length;
    $('#cat-count').textContent = rows.length
      ? `${any} of ${rows.length} talked to in some playthrough (Feline Fanatic needs all ${rows.length}); ${now} in this one.`
      : 'This save has no cat flags.';
  }
  const applyFlagFilter = () => {
    const only = $('#flag-set-only').checked;
    filterRows($('#flags'), $('#flag-filter').value, only ? r => r.dataset.val !== '0' : null);
    const vis = document.querySelectorAll('#flags .row:not([hidden])').length;
    $('#flag-count').textContent = save && save.s1.flags ? `${vis} of ${save.s1.flags.entries.length} shown` : '';
  };
  $('#flag-filter').addEventListener('input', applyFlagFilter);
  $('#flag-set-only').addEventListener('change', applyFlagFilter);

  // ---- footer: reset / download -------------------------------------------------------------------
  function updateBar() {
    const n = edits.size;
    $('#changes').textContent = n ? `${n} change${n > 1 ? 's' : ''}` : 'No changes';
    $('#download').disabled = !n;
  }
  $('#reset').addEventListener('click', () => { edits.clear(); added.clear(); original.clear(); showError(''); render(); });
  $('#download').addEventListener('click', () => {
    showError('');
    try {
      // in-place edits first, additions last (each addition shifts later offsets; core reparses after it)
      const isAdd = key => (key.startsWith('item.') && added.has(key.slice(5))) ? 1 : 0;
      const list = [...edits].sort(([a], [b]) => isAdd(a) - isAdd(b));
      const bytes = TSCore.buildEdited(save, list);   // re-opens and verifies the result
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const a = el('a', { href: url, download: fileName });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { showError(`Could not build the save: ${e.message}`); console.error(e); }
  });
})();
