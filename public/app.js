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
  function render() {
    $('#editor').hidden = false; $('#bar').hidden = false;
    renderOverview(); renderGeneral(); renderInventory(); renderOrdersShop(); renderUnits();
    renderStory(); renderProgress(); renderRaw(); updateBar();
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

  function renderGeneral() {
    $('#general-money').replaceChildren(field('Gold', numInput('money', summary.money, { min: 0 })));
    const cv = summary.convictions, b = save.s1.world.f3bb00.b;
    const C = [['utility', 'Utility'], ['morality', 'Morality'], ['liberty', 'Liberty']];
    $('#general-conv').replaceChildren(...C.map(([k, l]) => field(l, numInput('conviction.' + k, cv[k], { min: 0, max: 9999 }))));
    const idx = { liberty: 1, utility: 2, morality: 3 };
    $('#general-conv2').replaceChildren(...C.map(([k, l]) => field(l, numInput('bonusconv.' + k, b[idx[k]].v, { adv: true }))));
  }

  // -- inventory
  function itemRow(id, count, isNew) {
    const n = itemName(id);
    return row(id, n || id, n ? id : null, numInput('item.' + id, count, { min: 0, max: CAT.max[id] }), isNew ? el('span', { class: 'new' }, 'new') : null);
  }
  const tableFor = id => TSCore.groupForNewId(save.s1, id);
  function renderInventory() {
    const box = $('#inventory'); box.replaceChildren();
    const tables = { ...summary.inventory, accessories: summary.accessories };
    for (const [name, items] of Object.entries(tables)) {
      const ids = Object.keys(items);
      const extra = [...added].filter(id => tableFor(id) === name);
      if (!ids.length && !extra.length) continue;
      const rows = el('div', { class: 'rows' },
        ...ids.sort((a, b) => (itemName(a) || a).localeCompare(itemName(b) || b)).map(id => itemRow(id, items[id], false)),
        ...extra.map(id => itemRow(id, original.get('item.' + id), true)));
      box.append(el('div', { class: 'inv-table', dataset: { table: name } },
        el('h3', {}, `${INV_LABEL[name] || 'Accessories owned'} (${ids.length + extra.length})`), rows));
    }
    const owned = new Set(Object.values(tables).flatMap(t => Object.keys(t)));
    const suggest = TSCore.knownItemIds(save.s1).filter(id => /^(ITEM_|BATTLE_ACCESSARY_)/.test(id) && !owned.has(id) && !added.has(id) && tableFor(id));
    $('#known-ids').replaceChildren(...suggest.map(id => el('option', { value: id, label: itemName(id) ? `${itemName(id)} (${id})` : id })));
    applyInvFilter();
  }
  $('#inv-filter').addEventListener('input', applyInvFilter);
  function applyInvFilter() {
    filterRows($('#inventory'), $('#inv-filter').value);
    document.querySelectorAll('#inventory .inv-table').forEach(t => { t.hidden = !t.querySelector('.row:not([hidden])'); });
  }
  $('#add-btn').addEventListener('click', () => {
    const typed = $('#add-id').value.trim(), n = Number($('#add-count').value);
    const byName = Object.keys(CAT.names).find(k => CAT.names[k] && CAT.names[k].toLowerCase() === typed.toLowerCase());
    const id = byName || typed.toUpperCase();
    try {
      if (!/^(ITEM|BATTLE_ACCESSARY)_[A-Z0-9_]+$/.test(id)) throw new Error('Ids look like ITEM_BATTLE_HEAL_ALL or BATTLE_ACCESSARY_HP_RING.');
      if (!Number.isInteger(n) || n < 0) throw new Error('Count must be a whole number ≥ 0.');
      const owned = [...Object.values(summary.inventory), summary.accessories].some(t => id in t);
      if (owned || added.has(id)) throw new Error(`${id} is already in the inventory; edit its count instead.`);
      if (!tableFor(id)) throw new Error(`Don't know which inventory table ${id} belongs to.`);
      added.add(id); original.set('item.' + id, undefined); edits.set('item.' + id, n);
      $('#add-id').value = ''; showError('');
      renderInventory(); updateBar();
    } catch (e) { showError(e.message); }
  });

  function renderOrdersShop() {
    const w = save.s1.world;
    $('#orders').replaceChildren(...w.f39000.map(o => row(o.id, o.id.replace('BATTLE_ORDER_TEST_', '').replace(/_/g, ' '), o.id,
      el('span', { class: 'pair' }, numInput(`order.${o.id}.count`, o.v.v, { adv: true, min: 0 }), boolInput(`order.${o.id}.on`, o.f.v, { adv: true })))));
    $('#shop').replaceChildren(...w.f5caf0.map((s, i) => row(s.id, itemName(s.id) || s.id, `${s.id} · shop ${s.a}/${s.b}`, numInput(`shop.${i}`, s.c.v, { adv: true, min: 0 }))));
  }
  $('#shop-filter').addEventListener('input', () => filterRows($('#shop'), $('#shop-filter').value));

  // -- units
  function renderUnits() {
    const t = $('#units'); t.replaceChildren();
    t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Unit'), el('th', {}, 'Class'), ...UNIT_COLS.map(c => el('th', {}, c.toUpperCase())), el('th', {}, 'SPD'), el('th', {}, 'Accessories'))));
    const body = el('tbody');
    for (const u of summary.units) {
      const pid = u.id.replace('UNIT_MASTER_CH_', '');
      body.append(el('tr', {},
        el('td', { title: u.id }, `${unitName(u.id)} `, el('span', { class: 'iid' }, pid)),
        el('td', { title: u.class }, GD.jobs[u.class] || u.class.replace('BATTLE_JOB_CH_', '')),
        ...UNIT_COLS.map(c => el('td', {}, numInput(`unit.${pid}.${c}`, u[c], { min: 0 }))),
        el('td', {}, String(u.speed)),
        el('td', { class: 'small' }, u.equippedAccessories.map(a => itemName('BATTLE_' + a) || a).join(', '))));
    }
    t.append(body);
  }

  // -- story
  function renderStory() {
    const w = save.s1.world, flags = save.s1.flags;
    const flagVal = id => { const e = flags && flags.entries.find(x => x.id === id); return e ? e.v.v : undefined; };
    const seen = new Set(w.f3b880.filter(x => x.a === 2).map(x => x.id));
    const st = $('#stories'); st.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, 'Character'), el('th', {}, 'Story'), el('th', {}, 'Unlocked'), el('th', {}, 'Viewed'), el('th', {}, 'Unlock flag'))));
    const sb = el('tbody');
    for (const [id, unit, title, sub, flag] of GD.stories) {
      const v = flagVal(flag);
      sb.append(el('tr', { title: id }, el('td', {}, unitName(unit)), el('td', {}, `${title}${sub ? ' — ' + sub : ''}`),
        el('td', {}, v === undefined ? '—' : boolInput('flag.' + flag, v)), el('td', {}, seen.has(id) ? '✓' : ''), el('td', { class: 'iid' }, flag)));
    }
    st.append(sb);
    // character-story achievement tracker (FUN_140c68e10 map; see cli/charstory.js)
    const at = $('#charach');
    at.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, 'Unit'), el('th', {}, 'Stories unlocked'), el('th', {}, 'Flag 6'), el('th', {}, 'Flag 7'), el('th', {}, 'Flag 8'), el('th', {}, 'Slot'), el('th', {}, 'Achievement'))));
    const ab = el('tbody');
    for (const e of w.fc68e10.map) {
      const pid = e.id.replace('UNIT_MASTER_CH_', ''), [f6, f7, f8, slot] = e.b.map(x => x.v);
      const mine = GD.stories.filter(s => s[1] === e.id), unlocked = mine.filter(s => flagVal(s[4]) === 1).length;
      const status = el('td', { class: 'small' });
      const refresh = () => {
        const cur = k => { const key = `charach.${pid}.${k}`; return edits.has(key) ? edits.get(key) : original.get(key); };
        const s = cur('slot'), done = cur('f6') && cur('f7') && cur('f8');
        status.textContent = `ACHIEVEMENT_${String(80 + s).padStart(3, '0')} — ${done ? 'complete' : 'incomplete'}`;
      };
      const flagBox = (k, v) => { const i = boolInput(`charach.${pid}.${k}`, v); i.addEventListener('change', refresh); return i; };
      const slotIn = numInput(`charach.${pid}.slot`, slot, { adv: true, min: 0, max: 28 }); slotIn.addEventListener('input', refresh);
      ab.append(el('tr', { title: e.id }, el('td', {}, `${unitName(e.id)} `, el('span', { class: 'iid' }, pid)),
        el('td', {}, mine.length ? `${unlocked} / ${mine.length}` : '—'),
        el('td', {}, flagBox('f6', f6)), el('td', {}, flagBox('f7', f7)), el('td', {}, flagBox('f8', f8)), el('td', {}, slotIn), status));
      refresh();
    }
    at.append(ab);
    const ct = $('#chart'); ct.replaceChildren(el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Node'), el('th', {}, 'Title'), el('th', {}, 'f0'), el('th', {}, 'f1'), el('th', {}, 'f2'), el('th', {}, 'f3'))));
    const cb = el('tbody');
    for (const [node, fl] of Object.entries(w.storyChart)) {
      const g = GD.chart[node] || [];
      cb.append(el('tr', {}, el('td', {}, String(g[0] || '')), el('td', { class: 'iid' }, node), el('td', {}, [g[1], g[2]].filter(Boolean).join(' — ')),
        ...fl.map((f, i) => el('td', {}, boolInput(`story.${node}.${i}`, f.v, { adv: true })))));
    }
    ct.append(cb);
    $('#choices').replaceChildren(...Object.entries(w.selections).map(([id, f]) => row(id, id.replace('SELECT_PARAM_', ''), null, boolInput('choice.' + id, f.v, { adv: true }))));
  }
  $('#choice-filter').addEventListener('input', () => filterRows($('#choices'), $('#choice-filter').value));

  // -- progress
  function renderProgress() {
    const w = save.s1.world;
    $('#counters').replaceChildren(...w.fc68e10.set.slice().sort((a, b) => a.a - b.a).map(c =>
      row(String(c.a), `Counter ${c.a}${c.a === 40 ? ' (gold earned)' : ''}`, null, numInput('counter.' + c.a, c.v.v, { min: 0 }))));
    const flags = save.s1.flags;
    const box = $('#flags');
    if (!flags) { box.replaceChildren(el('p', { class: 'note' }, 'The event-flag table was not found in this save.')); }
    else {
      box.replaceChildren(...flags.entries.map(f => {
        const r = row(f.id, f.id, null, numInput('flag.' + f.id, f.v.v, { adv: true }));
        r.dataset.val = f.v.v; return r;
      }));
    }
    applyFlagFilter();
    $('#places').replaceChildren(...w.f5df20.map(p => row(p.id, GD.places[p.id] || p.id, GD.places[p.id] ? p.id : null, numInput('place.' + p.id, p.v.v, { adv: true }))));
    const seen = $('#seen'); seen.replaceChildren();
    const groups = {};
    for (const x of w.f3b880) (groups[x.a] = groups[x.a] || []).push(x.id);
    for (const [a, ids] of Object.entries(groups)) seen.append(el('details', {}, el('summary', {}, `${SEEN_CAT[a] || 'Category ' + a} (${ids.length})`), el('div', { class: 'idlist' }, ids.join('\n'))));
  }
  const applyFlagFilter = () => {
    const only = $('#flag-set-only').checked;
    filterRows($('#flags'), $('#flag-filter').value, only ? r => r.dataset.val !== '0' : null);
    const vis = document.querySelectorAll('#flags .row:not([hidden])').length;
    $('#flag-count').textContent = save && save.s1.flags ? `${vis} of ${save.s1.flags.entries.length} shown` : '';
  };
  $('#flag-filter').addEventListener('input', applyFlagFilter);
  $('#flag-set-only').addEventListener('change', applyFlagFilter);

  // -- raw (read-only)
  function renderRaw() {
    const w = save.s1.world;
    const blocks = {
      'Slot preview (s0)': () => ({ ...TSCore.preview(save.p, save.ss[0]), thumb: '(image)' }),
      'Header & play-time counter': () => save.s1.head,
      'Vote events (FUN_140d5f240)': () => w.f240,
      'Conviction block (FUN_140d3bb00)': () => w.f3bb00,
      'Location (FUN_140d5c5a0)': () => w.location,
      'Field pickups': () => w.pickups,
      'Map actors (first 200 of FUN_140d38d30)': () => w.rec60.slice(0, 200),
      'Unit attached data (FUN_140d5d170)': () => w.f5d170,
      'Misc small blocks': () => ({ f5bdc0: w.f5bdc0, f3c8f0: w.f3c8f0, f3c640: w.f3c640, f5e2e0: w.f5e2e0, f5b7d0: w.f5b7d0, flags4dc: w.flags4dc, f3b880_count: w.f3b880.length }),
      'Lifetime counters + unit flags (FUN_140c68e10)': () => w.fc68e10,
      'World tail': () => w.tail,
      ...Object.fromEntries(w.units.map((u, i) => [`Unit ${i} ${unitName(u.p.base.master)} (full record)`, () => u])),
    };
    const sel = $('#raw-block');
    sel.replaceChildren(...Object.keys(blocks).map(k => el('option', { value: k }, k)));
    const show = () => {
      const v = blocks[sel.value]();
      const text = JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : (x && x.buffer instanceof ArrayBuffer && x.length !== undefined && !Array.isArray(x) ? `<${x.length} bytes>` : x), 1);
      $('#raw').textContent = text.length > 300000 ? text.slice(0, 300000) + '\n… (truncated)' : text;
      $('#raw-size').textContent = `${(text.length / 1024).toFixed(1)} KB`;
    };
    sel.onchange = show; show();
  }

  // ---- tabs ---------------------------------------------------------------------------------------
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  }));

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
