(function () {
  'use strict';
  const E = window.RPEngine;

  let mode = 'hypertrophy';
  let selectedClientId = null;
  let selectedIndex = null;
  let uidCounter = 1;
  function uid() { return 'id' + (uidCounter++) + '_' + Math.random().toString(36).slice(2, 7); }

  // ---------- generic persistence ----------
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

  // ---------- clients ----------
  const CLIENTS_KEY = 'rpapp_clients_v1';
  function loadClients() { return load(CLIENTS_KEY); }
  function saveClients(list) { save(CLIENTS_KEY, list); }

  function storeKeyFor(m, clientId) {
    return m === 'hypertrophy' ? `rpapp_hyper_${clientId}_v1` : `rpapp_strength_${clientId}_v1`;
  }

  function getEntities() {
    if (!selectedClientId) return [];
    return load(storeKeyFor(mode, selectedClientId));
  }
  function setEntities(list) {
    if (!selectedClientId) return;
    save(storeKeyFor(mode, selectedClientId), list);
  }

  function clientSummary(clientId) {
    const hyper = load(storeKeyFor('hypertrophy', clientId));
    const strength = load(storeKeyFor('strength', clientId));
    const deloadFlag = hyper.some(e => e.weekInMeso === 1 && e.history.length && e.history[e.history.length - 1].decision.deloadNext)
      || strength.some(e => e.block === 'deload');
    return { hyperCount: hyper.length, strengthCount: strength.length, deloadFlag };
  }

  // ---------- draft (in-progress workout) helpers ----------
  function freshDraft(seedExerciseName) {
    return {
      warmup: [], // session-level warm-up checklist: [{ id, name, done }]
      exercises: seedExerciseName
        ? [{ id: uid(), name: seedExerciseName, isPrimary: true, sets: [], warmups: [] }]
        : [],
    };
  }
  function ensureDraft(ent) {
    if (!ent.draft) ent.draft = freshDraft();
    if (!ent.draft.warmup) ent.draft.warmup = []; // drafts saved before warm-ups existed
    return ent.draft;
  }
  function totalSetsInDraft(draft) {
    return draft.exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
  }
  function exLabel(e) { return e.supersetGroup ? `${e.name} (SS ${e.supersetGroup})` : e.name; }
  const SUPERSET_GROUPS = ['A', 'B', 'C', 'D', 'E'];
  const RESISTANCE_LABELS = { none: 'None', bands: 'Bands', chains: 'Chains', minibands: 'Mini bands' };
  function effectiveWeight(s) {
    const extra = (s.resistanceType && s.resistanceType !== 'none') ? (Number(s.resistanceKg) || 0) : 0;
    return (Number(s.weight) || 0) + extra;
  }
  function topSetOf(exercise) {
    if (!exercise || exercise.sets.length === 0) return null;
    return exercise.sets.reduce((top, s) => (effectiveWeight(s) > effectiveWeight(top) ? s : top), exercise.sets[0]);
  }

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const clientListEl = $('#client-list');
  const trackerArea = $('#tracker-area');
  const listEl = $('#entity-list');
  const dashEl = $('#dashboard');
  const modalRoot = $('#modal-root');
  const wordmarkTag = $('#mode-tag');
  const entityListTitle = $('#entity-list-title');

  document.getElementById('mode-hyper').addEventListener('click', () => switchMode('hypertrophy'));
  document.getElementById('mode-strength').addEventListener('click', () => switchMode('strength'));
  document.getElementById('add-btn').addEventListener('click', () => openAddModal());
  document.getElementById('add-client-btn').addEventListener('click', () => openAddClientModal());

  // ================= CLIENTS =================
  function renderClientList() {
    const clients = loadClients();
    clientListEl.innerHTML = '';
    if (clients.length === 0) {
      clientListEl.innerHTML = `<div class="empty-state">No clients yet. Add one to start tracking their programming.</div>`;
      return;
    }
    clients.forEach((c) => {
      const summary = clientSummary(c.id);
      const div = document.createElement('div');
      div.className = 'entity-item client-item' + (c.id === selectedClientId ? ' selected' : '');
      const metaText = `${summary.hyperCount} muscles · ${summary.strengthCount} lifts`;
      div.innerHTML = `
        <span class="name">${c.name}${summary.deloadFlag ? ' <span class="deload-flag" title="Recently deloaded — worth checking in">⚠ deload</span>' : ''}</span>
        <span class="meta">${metaText}</span>
        <button class="icon-btn del-client" data-id="${c.id}" title="Remove client">✕</button>
      `;
      div.addEventListener('click', () => selectClient(c.id));
      const delBtn = div.querySelector('.del-client');
      delBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (delBtn.dataset.armed === 'true') {
          const remaining = clients.filter(x => x.id !== c.id);
          saveClients(remaining);
          localStorage.removeItem(storeKeyFor('hypertrophy', c.id));
          localStorage.removeItem(storeKeyFor('strength', c.id));
          if (selectedClientId === c.id) { selectedClientId = null; trackerArea.style.display = 'none'; }
          renderClientList();
        } else {
          delBtn.dataset.armed = 'true';
          delBtn.textContent = 'Confirm ✕';
        }
      });
      clientListEl.appendChild(div);
    });
  }

  function selectClient(id) {
    selectedClientId = id;
    selectedIndex = null;
    trackerArea.style.display = 'block';
    const client = loadClients().find(c => c.id === id);
    entityListTitle.textContent = client ? `${client.name}'s entries` : 'Your entries';
    renderClientList();
    switchMode(mode);
  }

  function openAddClientModal() {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h3>New client</h3>
          <label>Name</label>
          <input type="text" id="c-name" placeholder="e.g. Sam Taylor">
          <div class="modal-actions">
            <button class="ghost" id="c-cancel">Cancel</button>
            <button class="primary" id="c-save">Add</button>
          </div>
        </div>
      </div>`;
    $('#c-cancel').addEventListener('click', closeModal);
    $('#c-save').addEventListener('click', () => {
      const name = $('#c-name').value.trim();
      if (!name) { $('#c-name').focus(); return; }
      const clients = loadClients();
      const client = { id: uid(), name };
      clients.push(client);
      saveClients(clients);
      closeModal();
      renderClientList();
      selectClient(client.id);
    });
  }

  // ================= MODE =================
  function switchMode(m) {
    mode = m;
    selectedIndex = null;
    document.body.dataset.mode = m;
    document.getElementById('mode-hyper').classList.toggle('active', m === 'hypertrophy');
    document.getElementById('mode-strength').classList.toggle('active', m === 'strength');
    wordmarkTag.textContent = m === 'hypertrophy' ? 'Hypertrophy' : 'Strength';
    document.getElementById('add-btn').textContent = m === 'hypertrophy' ? '+ Add muscle group' : '+ Add lift';
    renderList();
    renderDashboard();
  }

  // ---------- entity list (muscles / lifts for the selected client) ----------
  function renderList() {
    if (!selectedClientId) { listEl.innerHTML = ''; return; }
    const entities = getEntities();
    listEl.innerHTML = '';
    if (entities.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${mode === 'hypertrophy' ? 'No muscle groups yet.' : 'No lifts yet.'}</div>`;
      return;
    }
    entities.forEach((ent, i) => {
      const div = document.createElement('div');
      div.className = 'entity-item' + (i === selectedIndex ? ' selected' : '');
      const metaText = mode === 'hypertrophy'
        ? `target ${ent.currentSets}/wk · wk ${ent.weekInMeso}/${ent.mesoLength}`
        : `${ent.block} · wk ${ent.weekInBlock} · ${ent.lastWeight}kg`;
      div.innerHTML = `<span class="name">${ent.entityName}</span><span class="meta">${metaText}</span>`;
      div.addEventListener('click', () => { selectedIndex = i; renderList(); renderDashboard(); });
      listEl.appendChild(div);
    });
  }

  // ---------- add entity modal ----------
  function openAddModal() {
    if (!selectedClientId) return;
    const isHyper = mode === 'hypertrophy';
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h3>${isHyper ? 'New muscle group' : 'New lift'}</h3>
          <label>Name</label>
          <input type="text" id="f-name" placeholder="${isHyper ? 'e.g. Chest' : 'e.g. Back Squat'}">
          ${isHyper ? `
            <div class="field-row">
              <div><label>MEV (sets/wk)</label><input type="number" id="f-mev" value="8"></div>
              <div><label>MAV (sets/wk)</label><input type="number" id="f-mav" value="16"></div>
            </div>
            <div class="field-row">
              <div><label>MRV (sets/wk)</label><input type="number" id="f-mrv" value="22"></div>
              <div><label>Meso length (wks)</label><input type="number" id="f-meso" value="5"></div>
            </div>
            <p class="hint">Defaults are reasonable mid-experience starting points. Dial these in per client over time.</p>
          ` : `
            <div class="field-row">
              <div><label>Starting top-set weight (kg)</label><input type="number" id="f-weight" value="100"></div>
              <div><label>Est. current 1RM (kg)</label><input type="number" id="f-e1rm" value="120"></div>
            </div>
            <label>Starting block</label>
            <select id="f-block">
              <option value="accumulation">Accumulation</option>
              <option value="intensification">Intensification</option>
              <option value="peak">Peak</option>
              <option value="deload">Deload</option>
            </select>
            <p class="hint">Accumulation = higher volume, RIR 2-4. Intensification = heavier, RIR 1-2. Peak = near-max singles/doubles before a meet or test day.</p>
          `}
          <div class="modal-actions">
            <button class="ghost" id="f-cancel">Cancel</button>
            <button class="primary" id="f-save">Add</button>
          </div>
        </div>
      </div>`;
    $('#f-cancel').addEventListener('click', closeModal);
    $('#f-save').addEventListener('click', () => {
      const name = $('#f-name').value.trim();
      if (!name) { $('#f-name').focus(); return; }
      const entities = getEntities();
      if (isHyper) {
        const mev = Number($('#f-mev').value), mav = Number($('#f-mav').value),
              mrv = Number($('#f-mrv').value), mesoLength = Number($('#f-meso').value);
        const state = E.startHypertrophyMeso({ mev, mav, mrv, mesoLength });
        state.entityName = name;
        state.draft = freshDraft();
        entities.push(state);
      } else {
        const weight = Number($('#f-weight').value), e1rm = Number($('#f-e1rm').value),
              block = $('#f-block').value;
        const state = E.startStrengthBlock({ block, startingWeight: weight, e1rm });
        state.entityName = name;
        state.draft = freshDraft(name);
        entities.push(state);
      }
      setEntities(entities);
      selectedIndex = entities.length - 1;
      closeModal();
      renderList();
      renderDashboard();
    });
  }
  function closeModal() { modalRoot.innerHTML = ''; }

  // ---------- add exercise modal (used by both modes) ----------
  function openAddExerciseModal(onAdd) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal">
          <h3>Add exercise</h3>
          <label>Exercise name</label>
          <input type="text" id="ex-name" placeholder="e.g. Incline DB Press">
          <div class="modal-actions">
            <button class="ghost" id="ex-cancel">Cancel</button>
            <button class="primary" id="ex-save">Add</button>
          </div>
        </div>
      </div>`;
    $('#ex-cancel').addEventListener('click', closeModal);
    $('#ex-save').addEventListener('click', () => {
      const name = $('#ex-name').value.trim();
      if (!name) { $('#ex-name').focus(); return; }
      closeModal();
      onAdd(name);
    });
  }

  // ---------- dashboard ----------
  function renderDashboard() {
    if (!selectedClientId) { dashEl.innerHTML = ''; return; }
    const entities = getEntities();
    if (selectedIndex === null || !entities[selectedIndex]) {
      dashEl.innerHTML = `<div class="empty-state">Select ${mode === 'hypertrophy' ? 'a muscle group' : 'a lift'} on the left, or add a new one.</div>`;
      return;
    }
    const ent = entities[selectedIndex];
    ensureDraft(ent);
    mode === 'hypertrophy' ? renderHyperDashboard(ent) : renderStrengthDashboard(ent);
  }

  // ---------- warm-ups ----------
  const WARMUP_SUGGESTIONS = ['Foam roll', 'Light cardio (5 min)', 'Band pull-aparts', 'Hip mobility', 'Shoulder activation', 'Core bracing'];
  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function roundTo2p5(x) { return Math.round(x / 2.5) * 2.5; }

  // Ramp-up scheme as [fraction of working weight, reps]. Lifts need a longer ramp than accessories.
  function rampSets(target, m) {
    const scheme = m === 'strength' ? [[0.4, 5], [0.6, 3], [0.75, 2], [0.9, 1]] : [[0.5, 8], [0.75, 4]];
    const out = [];
    let prev = -1;
    scheme.forEach(([pct, reps]) => {
      const w = roundTo2p5(target * pct);
      if (w > 0 && w < target && w !== prev) { out.push({ id: uid(), weight: w, reps }); prev = w; }
    });
    return out;
  }
  // What weight to ramp towards: this exercise's heaviest working set, else (primary lift only) the prescribed weight.
  function rampTarget(ent, ex) {
    const top = topSetOf(ex);
    const fromSets = top ? effectiveWeight(top) : 0;
    if (fromSets > 0) return fromSets;
    return (mode === 'strength' && ex.isPrimary) ? (Number(ent.lastWeight) || 0) : 0;
  }

  function warmupSectionHTML(draft) {
    const items = draft.warmup || [];
    const doneCount = items.filter(i => i.done).length;
    const unused = WARMUP_SUGGESTIONS.filter(sug => !items.some(i => i.name === sug));
    return `<div class="warmup-section">
      <h2>Warm-up${items.length ? ` <span class="warmup-progress">${doneCount}/${items.length} done</span>` : ''}</h2>
      ${items.map(i => `
        <div class="warmup-item ${i.done ? 'done' : ''}">
          <input type="checkbox" class="warmup-check" data-wid="${i.id}" ${i.done ? 'checked' : ''}>
          <span class="warmup-name">${esc(i.name)}</span>
          <button class="icon-btn del-warmup-item" data-wid="${i.id}" title="Remove">✕</button>
        </div>`).join('')}
      <div class="warmup-add">
        <input type="text" id="warmup-new" placeholder="Add a warm-up item…">
        <button class="ghost" id="warmup-add-btn">Add</button>
      </div>
      ${unused.length ? `<div class="chips">${unused.map(sug => `<button class="chip" data-suggest="${esc(sug)}">+ ${esc(sug)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  function wireWarmupSection(ent, onChange) {
    const root = $('#warmup-section');
    if (!root) return;
    const add = (name) => {
      name = (name || '').trim();
      if (!name) return;
      ent.draft.warmup.push({ id: uid(), name, done: false });
      onChange();
    };
    root.querySelector('#warmup-add-btn').addEventListener('click', () => add(root.querySelector('#warmup-new').value));
    root.querySelector('#warmup-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') add(e.target.value); });
    root.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => add(c.dataset.suggest)));
    root.querySelectorAll('.warmup-check').forEach(cb => cb.addEventListener('change', () => {
      const item = ent.draft.warmup.find(i => i.id === cb.dataset.wid);
      item.done = cb.checked;
      persistDraftOnly(ent);
      cb.closest('.warmup-item').classList.toggle('done', cb.checked);
      const p = root.querySelector('.warmup-progress');
      if (p) p.textContent = `${ent.draft.warmup.filter(i => i.done).length}/${ent.draft.warmup.length} done`;
    }));
    root.querySelectorAll('.del-warmup-item').forEach(b => b.addEventListener('click', () => {
      ent.draft.warmup = ent.draft.warmup.filter(i => i.id !== b.dataset.wid);
      onChange();
    }));
  }

  // Warm-up sets live in ex.warmups, separate from ex.sets, so they never count toward
  // weekly volume or get picked as the "top set" that drives autoregulation.
  function warmupSetsHTML(ex) {
    const ws = ex.warmups || [];
    return `<div class="warmup-sets">
      <div class="warmup-head">
        <span class="warmup-title">Warm-up sets</span>
        <span class="warmup-actions">
          <button class="icon-btn auto-ramp" data-ex-id="${ex.id}" title="Generate a ramp-up towards your working weight">⚡ auto ramp</button>
          <button class="icon-btn add-warmup" data-ex-id="${ex.id}">+ add</button>
        </span>
      </div>
      <div class="ramp-msg" data-ex-id="${ex.id}"></div>
      ${ws.map((w, i) => `
        <div class="warmup-row" data-ex-id="${ex.id}" data-wid="${w.id}">
          <span class="set-num">W${i + 1}</span>
          <input type="number" data-wfield="weight" data-ex-id="${ex.id}" data-wid="${w.id}" value="${w.weight}" placeholder="kg">
          <span class="set-x">×</span>
          <input type="number" data-wfield="reps" data-ex-id="${ex.id}" data-wid="${w.id}" value="${w.reps}" placeholder="reps">
          <button class="icon-btn del-warmup" data-ex-id="${ex.id}" data-wid="${w.id}" title="Delete warm-up set">✕</button>
        </div>`).join('')}
    </div>`;
  }

  // ---------- shared: session builder markup ----------
  function sessionBuilderHTML(draft, opts) {
    const { primaryLocked } = opts || {};
    if (draft.exercises.length === 0) {
      return `<div class="empty-state" style="margin:14px 0;">No exercises logged for this session yet.</div>`;
    }
    const blockHTML = (ex, label) => `
      <div class="exercise-block" data-ex-id="${ex.id}">
        <div class="exercise-head">
          <span class="exercise-name">${label ? `<span class="ss-label">${label}</span> ` : ''}${ex.name}${ex.isPrimary ? ' <span class="primary-tag">primary</span>' : ''}</span>
          <span class="exercise-head-actions">
            <select class="superset-select" data-ex-id="${ex.id}" title="Group into a superset">
              <option value="">No superset</option>
              ${SUPERSET_GROUPS.map(g => `<option value="${g}" ${ex.supersetGroup === g ? 'selected' : ''}>Superset ${g}</option>`).join('')}
            </select>
            ${(!ex.isPrimary || !primaryLocked) ? `<button class="icon-btn del-exercise" data-ex-id="${ex.id}" title="Remove exercise">✕ remove</button>` : ''}
          </span>
        </div>
        ${warmupSetsHTML(ex)}
        <div class="set-rows" data-ex-id="${ex.id}">
          ${ex.sets.map((s, idx) => `
            <div class="set-row-wrap" data-ex-id="${ex.id}" data-set-id="${s.id}">
              <div class="set-row" data-ex-id="${ex.id}" data-set-id="${s.id}">
                <span class="set-num">#${idx + 1}${s.dropSet ? ' <span class="drop-tag">DS</span>' : ''}</span>
                <input type="number" class="set-weight" data-field="weight" data-ex-id="${ex.id}" data-set-id="${s.id}" value="${s.weight}" placeholder="kg">
                <span class="set-x">×</span>
                <input type="number" class="set-reps" data-field="reps" data-ex-id="${ex.id}" data-set-id="${s.id}" value="${s.reps}" placeholder="reps">
                <span class="set-at">@RIR</span>
                <input type="number" step="0.5" class="set-rir" data-field="rir" data-ex-id="${ex.id}" data-set-id="${s.id}" value="${s.rir}" placeholder="RIR">
                <button class="icon-btn del-set" data-ex-id="${ex.id}" data-set-id="${s.id}" title="Delete set">✕</button>
              </div>
              <div class="set-extra">
                <select class="set-resistance-type" data-field="resistanceType" data-ex-id="${ex.id}" data-set-id="${s.id}">
                  ${Object.entries(RESISTANCE_LABELS).map(([val, label]) =>
                    `<option value="${val}" ${s.resistanceType === val ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
                <input type="number" class="set-resistance-kg" data-field="resistanceKg" data-ex-id="${ex.id}" data-set-id="${s.id}" value="${s.resistanceKg || 0}" placeholder="+kg" title="Added tension at top of lift (kg)">
                <label class="dropset-label">
                  <input type="checkbox" data-field="dropSet" data-ex-id="${ex.id}" data-set-id="${s.id}" ${s.dropSet ? 'checked' : ''}>
                  Drop set
                </label>
              </div>
            </div>`).join('')}
        </div>
        <button class="ghost add-set" data-ex-id="${ex.id}">+ Add set</button>
      </div>
    `;

    // Group exercises that share a superset letter into one visual block, placed where the group first appears.
    const out = [];
    const done = new Set();
    draft.exercises.forEach((ex) => {
      if (done.has(ex.id)) return;
      if (!ex.supersetGroup) { out.push(blockHTML(ex, '')); done.add(ex.id); return; }
      const g = ex.supersetGroup;
      const members = draft.exercises.filter(e => e.supersetGroup === g);
      members.forEach(m => done.add(m.id));
      out.push(`<div class="superset-group">
        <div class="superset-label">Superset ${g}${members.length < 2 ? ' — assign another exercise to ' + g + ' to pair it' : ''}</div>
        ${members.map((m, i) => blockHTML(m, g + (i + 1))).join('')}
      </div>`);
    });
    return out.join('');
  }

  function wireSessionBuilder(ent, containerSel, onChange) {
    const container = $(containerSel);
    container.querySelectorAll('.del-exercise').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exId;
        ent.draft.exercises = ent.draft.exercises.filter(e => e.id !== exId);
        onChange();
      });
    });
    container.querySelectorAll('.add-warmup').forEach(btn => {
      btn.addEventListener('click', () => {
        const ex = ent.draft.exercises.find(e => e.id === btn.dataset.exId);
        ex.warmups = ex.warmups || [];
        const last = ex.warmups[ex.warmups.length - 1];
        ex.warmups.push({ id: uid(), weight: last ? last.weight : 0, reps: last ? last.reps : 5 });
        onChange();
      });
    });
    container.querySelectorAll('.del-warmup').forEach(btn => {
      btn.addEventListener('click', () => {
        const ex = ent.draft.exercises.find(e => e.id === btn.dataset.exId);
        ex.warmups = (ex.warmups || []).filter(w => w.id !== btn.dataset.wid);
        onChange();
      });
    });
    container.querySelectorAll('.auto-ramp').forEach(btn => {
      btn.addEventListener('click', () => {
        const ex = ent.draft.exercises.find(e => e.id === btn.dataset.exId);
        const target = rampTarget(ent, ex);
        if (!target) {
          const msg = container.querySelector(`.ramp-msg[data-ex-id="${ex.id}"]`);
          if (msg) msg.textContent = 'Enter a working-set weight first, then auto ramp can build up to it.';
          return;
        }
        ex.warmups = rampSets(target, mode); // replaces any existing warm-up sets for this exercise
        onChange();
      });
    });
    container.querySelectorAll('[data-wfield]').forEach(input => {
      input.addEventListener('input', () => {
        const ex = ent.draft.exercises.find(e => e.id === input.dataset.exId);
        const w = (ex.warmups || []).find(x => x.id === input.dataset.wid);
        w[input.dataset.wfield] = Number(input.value);
        persistDraftOnly(ent);
      });
    });
    container.querySelectorAll('.superset-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const ex = ent.draft.exercises.find(e => e.id === sel.dataset.exId);
        ex.supersetGroup = sel.value || null;
        onChange();
      });
    });
    container.querySelectorAll('.add-set').forEach(btn => {
      btn.addEventListener('click', () => {
        const ex = ent.draft.exercises.find(e => e.id === btn.dataset.exId);
        const last = ex.sets[ex.sets.length - 1];
        ex.sets.push({
          id: uid(),
          weight: last ? last.weight : 0,
          reps: last ? last.reps : 0,
          rir: last ? last.rir : 2,
          resistanceType: last ? last.resistanceType : 'none',
          resistanceKg: last ? last.resistanceKg : 0,
          dropSet: false, // never auto-carry drop-set status — each set should be marked deliberately
        });
        onChange();
      });
    });
    container.querySelectorAll('.del-set').forEach(btn => {
      btn.addEventListener('click', () => {
        const ex = ent.draft.exercises.find(e => e.id === btn.dataset.exId);
        ex.sets = ex.sets.filter(s => s.id !== btn.dataset.setId);
        onChange();
      });
    });
    container.querySelectorAll('[data-field]').forEach(field => {
      const isCheckbox = field.type === 'checkbox';
      const isSelect = field.tagName === 'SELECT';
      const eventName = (isCheckbox || isSelect) ? 'change' : 'input';
      field.addEventListener(eventName, () => {
        const ex = ent.draft.exercises.find(e => e.id === field.dataset.exId);
        const s = ex.sets.find(s => s.id === field.dataset.setId);
        if (isCheckbox) s[field.dataset.field] = field.checked;
        else if (isSelect) s[field.dataset.field] = field.value;
        else s[field.dataset.field] = Number(field.value);
        persistDraftOnly(ent);
        const counter = document.getElementById('sets-counter');
        if (counter) counter.textContent = totalSetsInDraft(ent.draft);
      });
    });
  }

  function persistDraftOnly(ent) {
    const entities = getEntities();
    entities[selectedIndex] = ent;
    setEntities(entities);
  }

  // ---------- hypertrophy dashboard ----------
  function renderHyperDashboard(ent) {
    const draft = ensureDraft(ent);
    const setsLogged = totalSetsInDraft(draft);
    dashEl.innerHTML = `
      <h2>${ent.entityName}</h2>
      <div class="stat-row">
        <div class="stat"><div class="label">Target this week</div><div class="value">${ent.currentSets}</div><div class="sub">MEV ${ent.mev} · MAV ${ent.mav} · MRV ${ent.mrv}</div></div>
        <div class="stat"><div class="label">Sets logged</div><div class="value" id="sets-counter">${setsLogged}</div><div class="sub">this session</div></div>
        <div class="stat"><div class="label">Meso progress</div><div class="value">${ent.weekInMeso}/${ent.mesoLength}</div><div class="sub">week in current block</div></div>
      </div>

      <div id="warmup-section" style="margin-top:22px;">${warmupSectionHTML(draft)}</div>

      <h2 style="margin-top:22px;">This week's workout</h2>
      <div id="session-builder">${sessionBuilderHTML(draft, {})}</div>
      <button class="ghost" id="add-exercise-btn" style="margin-top:8px;">+ Add exercise</button>

      <h2 style="margin-top:22px;">Finish the week</h2>
      <label>Pump this week</label>
      <select id="in-pump">
        <option value="0">None</option><option value="1">Low</option><option value="2" selected>Moderate</option><option value="3">High</option>
      </select>
      <label>Soreness going into this session</label>
      <select id="in-soreness">
        <option value="0">Never got sore</option><option value="1">Healed early</option><option value="2" selected>Healed right on time</option><option value="3">Still sore</option>
      </select>
      <label>Joint pain</label>
      <select id="in-joint">
        <option value="0" selected>None</option><option value="1">Some</option><option value="2">A lot</option>
      </select>
      <label>Performance vs last week</label>
      <select id="in-perf">
        <option value="-1">Worse (reps/weight down)</option><option value="0" selected>Same</option><option value="1">Better</option>
      </select>
      <button class="primary" id="log-week" style="margin-top:16px;">Log this week & get next week's target</button>
      ${renderHyperHistory(ent)}
    `;

    $('#add-exercise-btn').addEventListener('click', () => {
      openAddExerciseModal((name) => {
        ent.draft.exercises.push({ id: uid(), name, isPrimary: false, sets: [], warmups: [] });
        persistDraftOnly(ent);
        renderHyperDashboard(ent);
      });
    });

    wireSessionBuilder(ent, '#session-builder', () => {
      persistDraftOnly(ent);
      renderHyperDashboard(ent);
    });
    wireWarmupSection(ent, () => {
      persistDraftOnly(ent);
      renderHyperDashboard(ent);
    });

    $('#log-week').addEventListener('click', () => {
      const feedback = {
        pump: Number($('#in-pump').value),
        soreness: Number($('#in-soreness').value),
        jointPain: Number($('#in-joint').value),
        performance: Number($('#in-perf').value),
      };
      const entities = getEntities();
      const current = entities[selectedIndex];
      const actualSets = totalSetsInDraft(current.draft);
      const baseState = { ...current, currentSets: actualSets > 0 ? actualSets : current.currentSets };
      const updated = E.advanceHypertrophyWeek(baseState, feedback);
      updated.entityName = current.entityName;

      const hist = updated.history.slice();
      const lastIdx = hist.length - 1;
      hist[lastIdx] = { ...hist[lastIdx], setsActuallyDone: actualSets, exercises: current.draft.exercises, warmup: current.draft.warmup };
      updated.history = hist;
      updated.draft = freshDraft();
      updated.draft.warmup = (current.draft.warmup || []).map(w => ({ id: uid(), name: w.name, done: false })); // same routine next time

      entities[selectedIndex] = updated;
      setEntities(entities);
      renderList();
      renderClientList();
      renderDashboard();
      const lastDecision = hist[lastIdx].decision;
      showBanner(lastDecision.reason, lastDecision.deloadNext);
    });
  }

  function renderHyperHistory(ent) {
    if (!ent.history.length) return '<p class="hint">No weeks logged yet.</p>';
    const rows = ent.history.slice().reverse().map(h => `
      <tr>
        <td>Wk ${h.week}</td>
        <td>${h.setsActuallyDone != null ? h.setsActuallyDone : h.setsPlanned} sets</td>
        <td>${h.exercises && h.exercises.length ? h.exercises.map(exLabel).join(', ') : '—'}</td>
        <td>${['Worse','Same','Better'][h.feedback.performance + 1]}</td>
        <td>${h.decision.nextSets}${h.decision.deloadNext ? ' (deload)' : ''}</td>
      </tr>`).join('');
    return `<h2 style="margin-top:22px;">History</h2><table class="history">
      <thead><tr><th>Week</th><th>Sets done</th><th>Exercises</th><th>Perf</th><th>Next target</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  // ---------- strength dashboard ----------
  function renderStrengthDashboard(ent) {
    const draft = ensureDraft(ent);
    const primary = draft.exercises.find(e => e.isPrimary) || draft.exercises[0];
    const targetRIR = E.targetRIRFor(ent.block, ent.weekInBlock);
    const topSet = topSetOf(primary);

    dashEl.innerHTML = `
      <h2>${ent.entityName}</h2>
      <div class="stat-row">
        <div class="stat"><div class="label">Block</div><div class="value" style="font-size:20px;">${ent.block}</div><div class="sub">week ${ent.weekInBlock}</div></div>
        <div class="stat"><div class="label">Prescribed weight</div><div class="value">${ent.lastWeight}<span style="font-size:14px;">kg</span></div><div class="sub">target RIR ${targetRIR}</div></div>
        <div class="stat"><div class="label">Est. 1RM</div><div class="value">${Math.round(ent.e1rm)}<span style="font-size:14px;">kg</span></div></div>
      </div>

      <div id="warmup-section" style="margin-top:22px;">${warmupSectionHTML(draft)}</div>

      <h2 style="margin-top:22px;">Today's workout</h2>
      <p class="hint">The heaviest set on <strong>${primary ? primary.name : 'the primary lift'}</strong> drives next session's prescribed weight — bar weight plus any band/chain tension counts as the effective load. Accessory exercises are logged, not autoregulated.</p>
      <div id="session-builder">${sessionBuilderHTML(draft, { primaryLocked: true })}</div>
      <button class="ghost" id="add-exercise-btn" style="margin-top:8px;">+ Add exercise</button>

      <button class="primary" id="log-session" style="margin-top:16px;" ${!topSet ? 'disabled' : ''}>Log session & get next weight</button>
      ${!topSet ? '<p class="hint" style="color:var(--warn);">Add at least one set on the primary lift before logging.</p>' : ''}
      ${renderStrengthHistory(ent)}
    `;

    $('#add-exercise-btn').addEventListener('click', () => {
      openAddExerciseModal((name) => {
        ent.draft.exercises.push({ id: uid(), name, isPrimary: false, sets: [], warmups: [] });
        persistDraftOnly(ent);
        renderStrengthDashboard(ent);
      });
    });

    wireSessionBuilder(ent, '#session-builder', () => {
      persistDraftOnly(ent);
      renderStrengthDashboard(ent);
    });
    wireWarmupSection(ent, () => {
      persistDraftOnly(ent);
      renderStrengthDashboard(ent);
    });

    const logBtn = $('#log-session');
    if (logBtn) logBtn.addEventListener('click', () => {
      const entities = getEntities();
      const current = entities[selectedIndex];
      const currentPrimary = current.draft.exercises.find(e => e.isPrimary) || current.draft.exercises[0];
      const currentTopSet = topSetOf(currentPrimary);
      if (!currentTopSet) return;

      // Use effective load (bar weight + band/chain tension) so accommodating resistance
      // actually counts toward progression — a bar-weight-only view would understate the set.
      const session = { weight: effectiveWeight(currentTopSet), reps: currentTopSet.reps, actualRIR: currentTopSet.rir };
      const updated = E.advanceStrengthWeek(current, session);
      updated.entityName = current.entityName;

      const hist = updated.history.slice();
      const lastIdx = hist.length - 1;
      hist[lastIdx] = { ...hist[lastIdx], exercises: current.draft.exercises, warmup: current.draft.warmup };
      updated.history = hist;
      updated.draft = freshDraft(current.entityName);
      updated.draft.warmup = (current.draft.warmup || []).map(w => ({ id: uid(), name: w.name, done: false })); // same routine next time

      entities[selectedIndex] = updated;
      setEntities(entities);
      renderList();
      renderClientList();
      renderDashboard();
      const lastAdj = hist[lastIdx].adj;
      showBanner(lastAdj.note + (updated.justAdvancedBlock ? ` Block complete — moving into ${updated.block}.` : ''), false);
    });
  }

  function formatTopSetCell(h) {
    const primary = h.exercises && h.exercises.find(e => e.isPrimary);
    const top = primary ? topSetOf(primary) : null;
    const resistanceNote = top && top.resistanceType && top.resistanceType !== 'none'
      ? ` (${top.weight}kg +${top.resistanceKg || 0} ${RESISTANCE_LABELS[top.resistanceType].toLowerCase()})`
      : '';
    const dropTag = top && top.dropSet ? ' <span class="drop-tag">DS</span>' : '';
    return `${h.session.weight}kg${resistanceNote} x${h.session.reps} @${h.session.actualRIR}${dropTag}`;
  }

  function renderStrengthHistory(ent) {
    if (!ent.history.length) return '<p class="hint">No sessions logged yet.</p>';
    const rows = ent.history.slice().reverse().map(h => `
      <tr>
        <td>${h.block} wk${h.week}</td>
        <td>${formatTopSetCell(h)}</td>
        <td>${h.exercises && h.exercises.length > 1 ? h.exercises.slice(1).map(exLabel).join(', ') : '—'}</td>
        <td>e1RM ${Math.round(h.adj.e1rm)}</td>
        <td>${h.adj.nextWeight}kg</td>
      </tr>`).join('');
    return `<h2 style="margin-top:22px;">History</h2><table class="history">
      <thead><tr><th>Block/Wk</th><th>Top set (effective load)</th><th>Accessories</th><th>Est 1RM</th><th>Next</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  function showBanner(text, isDeload) {
    const existing = dashEl.querySelector('.decision-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'decision-banner' + (isDeload ? ' deload' : '');
    banner.textContent = text;
    dashEl.insertBefore(banner, dashEl.children[1] || null);
  }

  // ---------- init ----------
  renderClientList();
  trackerArea.style.display = 'none';
})();
