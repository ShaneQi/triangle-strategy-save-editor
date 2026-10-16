// Triangle Strategy save editor UI. All work happens client side via TSCore (lib/core.js).
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
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

  const INV_LABEL = { battleItems: 'Battle items', materials: 'Upgrade materials', medals: 'Class medals', keyItems: 'Key items & notes', table2: 'Other' };
  const UNIT_COLS = ['level', 'exp', 'hp', 'move', 'jump', 'str', 'int', 'def', 'mdf', 'dex', 'agi', 'luk'];

  // ---- file loading --------------------------------------------------------------------------
  const drop = $('#drop'), input = $('#file');
  input.addEventListener('change', () => input.files[0] && load(input.files[0]));
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

  // ---- rendering --------------------------------------------------------------------------------
  function numInput(key, value, opts = {}) {
    if (!original.has(key)) original.set(key, value);
    const i = el('input', { type: 'number', class: 'num', step: '1', dataset: { key } });
    if (opts.min !== undefined) i.min = opts.min;
    if (opts.max !== undefined) i.max = opts.max;
    i.value = edits.has(key) ? edits.get(key) : value;
    if (edits.has(key)) i.classList.add('changed');
    i.addEventListener('input', () => onEdit(i));
    return i;
  }

  function onEdit(i) {
    const key = i.dataset.key, v = i.value.trim() === '' ? NaN : Number(i.value);
    const orig = original.get(key);
    if (Number.isInteger(v) && v !== orig) edits.set(key, v); else if (v === orig) edits.delete(key);
    i.classList.toggle('changed', edits.has(key));
    updateBar();
  }

  function render() {
    $('#editor').hidden = false; $('#bar').hidden = false;
    renderOverview(); renderGeneral(); renderInventory(); renderUnits(); updateBar();
  }

  function renderOverview() {
    const pv = TSCore.preview(save.p, save.ss[0]);
    const h = Math.floor(pv.playSeconds / 3600), m = Math.floor(pv.playSeconds / 60) % 60;
    const meta = $('#meta'); meta.replaceChildren();
    const add = (k, v) => meta.append(el('dt', {}, k), el('dd', {}, v));
    add('File', fileName);
    add('Leader', pv.leader);
    add('Chapter', `${pv.title}`);
    add('Saved', pv.savedAt.toLocaleString());
    add('Play time', `${h}h ${String(m).padStart(2, '0')}m`);
    add('Format', `NWER v0x${save.version.toString(16)}, SHA-1 OK, ${summary.units.length} units`);
    // thumbnail: BGRA -> RGBA
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

  function field(label, inputNode) { return el('label', { class: 'field' }, el('span', {}, label), inputNode); }

  function renderGeneral() {
    $('#general-money').replaceChildren(field('Gold', numInput('money', summary.money, { min: 0 })));
    const cv = summary.convictions;
    $('#general-conv').replaceChildren(
      field('Utility', numInput('conviction.utility', cv.utility, { min: 0, max: 9999 })),
      field('Morality', numInput('conviction.morality', cv.morality, { min: 0, max: 9999 })),
      field('Liberty', numInput('conviction.liberty', cv.liberty, { min: 0, max: 9999 })),
    );
  }

  function itemRow(id, count, isNew) {
    return el('div', { class: 'row', dataset: { id } },
      el('label', {}, id, isNew ? el('span', { class: 'new' }, 'new') : null),
      numInput('item.' + id, count, { min: 0 }));
  }

  function renderInventory() {
    const box = $('#inventory'); box.replaceChildren();
    const tables = { ...summary.inventory, accessories: summary.accessories };
    for (const [name, items] of Object.entries(tables)) {
      const ids = Object.keys(items);
      const extra = [...added].filter(id => tableFor(id) === name);
      if (!ids.length && !extra.length) continue;
      const rows = el('div', { class: 'rows' },
        ...ids.sort().map(id => itemRow(id, items[id], false)),
        ...extra.map(id => itemRow(id, original.get('item.' + id), true)));
      box.append(el('div', { class: 'inv-table', dataset: { table: name } },
        el('h3', {}, `${INV_LABEL[name] || 'Accessories owned'} (${ids.length + extra.length})`), rows));
    }
    const owned = new Set(Object.values(tables).flatMap(t => Object.keys(t)));
    $('#known-ids').replaceChildren(...TSCore.knownItemIds(save.s1).filter(id => !owned.has(id) && !added.has(id)).map(id => el('option', { value: id })));
    applyFilter();
  }

  // which inventory group a new id goes into (same rule core.applyEdit uses)
  const tableFor = id => TSCore.groupForNewId(save.s1, id);

  $('#inv-filter').addEventListener('input', applyFilter);
  function applyFilter() {
    const q = $('#inv-filter').value.trim().toUpperCase();
    document.querySelectorAll('#inventory .row').forEach(r => { r.hidden = q && !r.dataset.id.includes(q); });
    document.querySelectorAll('#inventory .inv-table').forEach(t => { t.hidden = !t.querySelector('.row:not([hidden])'); });
  }

  $('#add-btn').addEventListener('click', () => {
    const id = $('#add-id').value.trim().toUpperCase(), n = Number($('#add-count').value);
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

  function renderUnits() {
    const t = $('#units'); t.replaceChildren();
    t.append(el('thead', {}, el('tr', {}, el('th', {}, 'Unit'), el('th', {}, 'Class'), ...UNIT_COLS.map(c => el('th', {}, c.toUpperCase())), el('th', {}, 'SPD'))));
    const body = el('tbody');
    for (const u of summary.units) {
      const pid = u.id.replace('UNIT_MASTER_CH_', '');
      body.append(el('tr', {},
        el('td', {}, pid), el('td', { title: u.class }, u.class.replace('BATTLE_JOB_CH_', '')),
        ...UNIT_COLS.map(c => el('td', {}, numInput(`unit.${pid}.${c}`, u[c], { min: 0 }))),
        el('td', {}, String(u.speed))));
    }
    t.append(body);
  }

  // ---- tabs ---------------------------------------------------------------------------------------
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.panel').forEach(p => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  }));

  // ---- footer: reset / download ---------------------------------------------------------------------
  function updateBar() {
    const n = edits.size;
    $('#changes').textContent = n ? `${n} change${n > 1 ? 's' : ''}` : 'No changes';
    $('#download').disabled = !n;
  }
  $('#reset').addEventListener('click', () => { edits.clear(); added.clear(); original.clear(); showError(''); render(); });

  $('#download').addEventListener('click', () => {
    showError('');
    try {
      // apply in-place edits before additions so recorded offsets stay valid until the size changes
      const list = [...edits].sort(([a], [b]) => (isAdd(a) - isAdd(b)));
      const bytes = TSCore.buildEdited(save, list);   // re-opens and verifies the result
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      const a = el('a', { href: url, download: fileName });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { showError(`Could not build the save: ${e.message}`); console.error(e); }
  });
  const isAdd = key => (key.startsWith('item.') && added.has(key.slice(5))) ? 1 : 0;
})();
