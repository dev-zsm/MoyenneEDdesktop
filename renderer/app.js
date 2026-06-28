const state = {
  token: null,
  account: null,
  notes: null,
  periods: [],
  currentPeriodId: null,
  detectedPeriodId: null,
  yearFinished: false,
  pendingLogin: null,
  fa: null,
  excluded: new Set(),
  expanded: new Set(),
  overrides: {},
  simulated: {},
  search: '',
  sort: 'default',
};

const views = {
  login: document.querySelector('[data-view="login"]'),
  qcm: document.querySelector('[data-view="qcm"]'),
  dashboard: document.querySelector('[data-view="dashboard"]'),
};

function showView(name) {
  for (const [k, el] of Object.entries(views)) {
    el.hidden = k !== name;
  }
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toFixed(digits).replace('.', ',');
}

function avgClass(v) {
  if (v === null || v === undefined) return 'empty';
  if (v >= 14) return 'good';
  if (v >= 10) return 'mid';
  return 'bad';
}

const SUBJECT_PALETTE = [
  '#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#dc2626',
  '#9333ea', '#db2777', '#0d9488', '#ea580c', '#4f46e5',
  '#65a30d', '#0284c7',
];
const subjectColorMap = {};
let subjectColorIdx = 0;
function subjectColor(code) {
  if (!subjectColorMap[code]) {
    subjectColorMap[code] = SUBJECT_PALETTE[subjectColorIdx % SUBJECT_PALETTE.length];
    subjectColorIdx += 1;
  }
  return subjectColorMap[code];
}

function initials(prenom, nom) {
  const a = (prenom || '').trim()[0] || '';
  const b = (nom || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}

function avgHtml(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${fmt(value)}<span class="unit">/20</span>`;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 2500);
}

function setLoading(btn, loading) {
  const spin = btn.querySelector('.spinner');
  const label = btn.querySelector('.btn-label');
  if (spin) spin.hidden = !loading;
  if (label) label.style.opacity = loading ? 0.5 : 1;
  btn.disabled = loading;
}

function showError(el, msg) {
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.hidden = false;
}

const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginSubmit = document.getElementById('login-submit');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(loginError, null);
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('login-remember').checked;
  if (!username || !password) return;

  state.pendingLogin = { username, password, remember };
  setLoading(loginSubmit, true);
  try {
    const fa = state.fa ? [state.fa] : null;
    const res = await window.ed.login(username, password, fa);
    await handleLoginResult(res);
  } catch (err) {
    showError(loginError, err.message || 'Erreur réseau');
  } finally {
    setLoading(loginSubmit, false);
  }
});

async function handleLoginResult(res) {
  if (res.ok) {
    state.token = res.token;
    state.account = res.account;
    if (state.pendingLogin?.remember) {
      await window.store.save({
        username: state.pendingLogin.username,
        password: state.pendingLogin.password,
        token: state.token,
        account: state.account,
        fa: state.fa || null,
      });
    }
    await loadDashboard();
    return;
  }
  if (res.needQcm) {
    await startQcm(res.token);
    return;
  }
  showError(loginError, res.error || 'Connexion impossible');
}

let qcmState = null;
const qcmSubmit = document.getElementById('qcm-submit');
const qcmError = document.getElementById('qcm-error');

async function startQcm(token) {
  showError(qcmError, null);
  document.getElementById('qcm-question').textContent = 'Chargement…';
  document.getElementById('qcm-options').innerHTML = '';
  showView('qcm');

  const q = await window.ed.qcmGet(token);
  if (!q.ok) {
    showError(qcmError, q.error || 'QCM indisponible');
    return;
  }
  qcmState = { token: q.token, choice: null };
  document.getElementById('qcm-question').textContent = q.question;

  const list = document.getElementById('qcm-options');
  list.innerHTML = '';
  q.propositions.forEach((p, i) => {
    const opt = document.createElement('label');
    opt.className = 'qcm-option';
    opt.innerHTML = `
      <input type="radio" name="qcm" value="${i}" />
      <span></span>
    `;
    opt.querySelector('span').textContent = p.text;
    opt.querySelector('input').addEventListener('change', () => {
      document
        .querySelectorAll('.qcm-option')
        .forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      qcmState.choice = p.raw;
      qcmSubmit.disabled = false;
    });
    list.appendChild(opt);
  });
  qcmSubmit.disabled = true;
}

qcmSubmit.addEventListener('click', async () => {
  if (!qcmState?.choice) return;
  setLoading(qcmSubmit, true);
  showError(qcmError, null);
  try {
    const res = await window.ed.qcmAnswer(qcmState.token, qcmState.choice);
    if (!res.ok) {
      showError(qcmError, res.error || 'Mauvaise réponse');
      return;
    }
    state.fa = res.fa;
    const { username, password } = state.pendingLogin;
    const loginRes = await window.ed.login(username, password, [res.fa]);
    if (loginRes.ok) {
      state.token = loginRes.token;
      state.account = loginRes.account;
      if (state.pendingLogin?.remember) {
        await window.store.save({
          username,
          password,
          token: state.token,
          account: state.account,
          fa: res.fa,
        });
      }
      await loadDashboard();
    } else {
      showError(qcmError, loginRes.error || 'Reconnexion échouée');
    }
  } finally {
    setLoading(qcmSubmit, false);
  }
});

async function loadDashboard() {
  showView('dashboard');
  if (state.account) {
    document.getElementById('user-name').textContent =
      `${state.account.prenom || ''} ${state.account.nom || ''}`.trim();
    document.getElementById('user-avatar').textContent = initials(
      state.account.prenom,
      state.account.nom
    );
  }
  await refreshNotes();
}

function showSkeleton() {
  document.getElementById('subjects').innerHTML = Array.from(
    { length: 6 },
    () => '<div class="skeleton sk-row"></div>'
  ).join('');
}

async function refreshNotes(isRetry = false) {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.disabled = true;
  if (state.periods.length === 0) showSkeleton();
  try {
    const res = await window.ed.fetchNotes(state.token, state.account.id);
    if (!res.ok) {
      const tokenExpired =
        res.expired || (res.error && /token/i.test(res.error));
      if (tokenExpired && !isRetry) {
        const reconnected = await silentRelogin();
        if (reconnected) {
          await refreshNotes(true);
          return;
        }
        toast('Session expirée, reconnecte-toi');
        return;
      }
      toast(res.error || 'Notes indisponibles');
      return;
    }
    state.token = res.token || state.token;
    state.notes = res.data;
    await persistToken();
    await recompute();
    if (!state.currentPeriodId && state.periods.length) {
      state.currentPeriodId = state.detectedPeriodId || state.periods[0].id;
    }
    renderPeriods();
    renderCurrentPeriod();
    if (isRetry) toast('Session renouvelée');
    else toast('Notes mises à jour');
  } finally {
    refreshBtn.disabled = false;
  }
}

async function recompute() {
  if (!state.notes) return;
  const computed = await window.ed.computePeriods(
    state.notes,
    [...state.excluded],
    state.overrides,
    state.simulated
  );
  state.periods = computed.periods;
  state.detectedPeriodId = computed.currentPeriodId || null;
  state.yearFinished = !!computed.yearFinished;
}

async function toggleSubject(code) {
  if (state.excluded.has(code)) state.excluded.delete(code);
  else state.excluded.add(code);
  await persistPrefs();
  await recompute();
  renderPeriods();
  renderCurrentPeriod();
}

async function setMarkOverride(markId, patch) {
  const cur = state.overrides[markId] || {};
  const next = { ...cur, ...patch };
  for (const k of Object.keys(next)) {
    if (next[k] === undefined || next[k] === null || next[k] === '') {
      delete next[k];
    }
  }
  if (Object.keys(next).length === 0) delete state.overrides[markId];
  else state.overrides[markId] = next;

  await persistPrefs();
  await recompute();
  renderPeriods();
  renderCurrentPeriod();
}

async function resetMarkOverride(markId) {
  delete state.overrides[markId];
  await persistPrefs();
  await recompute();
  renderPeriods();
  renderCurrentPeriod();
}

async function addSimulatedMark(subjectCode, value, coef) {
  const pid = state.currentPeriodId;
  if (!pid) return;
  if (!state.simulated[pid]) state.simulated[pid] = [];
  state.simulated[pid].push({
    id: 'sim_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    subjectCode,
    value: String(value),
    coef: String(coef || 1),
    title: 'Note simulée',
  });
  await persistPrefs();
  await recompute();
  renderPeriods();
  renderCurrentPeriod();
}

async function removeSimulatedMark(markId) {
  const pid = state.currentPeriodId;
  if (!pid || !state.simulated[pid]) return;
  state.simulated[pid] = state.simulated[pid].filter((m) => m.id !== markId);
  if (state.simulated[pid].length === 0) delete state.simulated[pid];
  await persistPrefs();
  await recompute();
  renderPeriods();
  renderCurrentPeriod();
}

async function persistPrefs() {
  const saved = (await window.store.load()) || {};
  saved.excluded = [...state.excluded];
  saved.overrides = state.overrides;
  saved.simulated = state.simulated;
  await window.store.save(saved);
}

async function silentRelogin() {
  const saved = await window.store.load();
  if (!saved?.username || !saved?.password) return false;
  const fa = state.fa ? [state.fa] : saved.fa ? [saved.fa] : null;
  try {
    const res = await window.ed.login(saved.username, saved.password, fa);
    if (res.ok) {
      state.token = res.token;
      state.account = res.account;
      await persistToken();
      return true;
    }
  } catch {}
  return false;
}

async function persistToken() {
  const saved = (await window.store.load()) || {};
  saved.token = state.token;
  saved.account = state.account;
  if (state.fa) saved.fa = state.fa;
  await window.store.save(saved);
}

function renderPeriods() {
  const nav = document.getElementById('periods-nav');
  nav.innerHTML = '';
  if (state.periods.length === 0) {
    nav.innerHTML = '<div class="empty">Aucune période</div>';
    return;
  }
  for (const p of state.periods) {
    const btn = document.createElement('button');
    btn.className = 'period-tab';
    if (p.id === state.currentPeriodId) btn.classList.add('active');
    const isCurrent =
      !state.yearFinished && p.id === state.detectedPeriodId && !p.annuel;
    btn.innerHTML = `
      <span class="period-tab-label">
        <span class="period-tab-name"></span>
        ${isCurrent ? '<span class="period-badge">en cours</span>' : ''}
      </span>
      <span class="period-tab-meta"></span>
    `;
    btn.querySelector('.period-tab-name').textContent = p.name;
    btn.querySelector('.period-tab-meta').textContent =
      p.moyenneGenerale !== null ? fmt(p.moyenneGenerale, 2) : '—';
    btn.addEventListener('click', () => {
      state.currentPeriodId = p.id;
      renderPeriods();
      renderCurrentPeriod();
    });
    nav.appendChild(btn);
  }
}

function renderCurrentPeriod() {
  const period = state.periods.find((p) => p.id === state.currentPeriodId);
  const statMm = document.getElementById('stat-mm');
  const statPond = document.getElementById('stat-pond');
  const statCount = document.getElementById('stat-count');
  const subjectsEl = document.getElementById('subjects');

  if (!period) {
    statMm.textContent = '—';
    statPond.textContent = '—';
    statCount.textContent = '—';
    subjectsEl.innerHTML =
      '<div class="empty">Sélectionnez une période</div>';
    return;
  }

  statMm.innerHTML = avgHtml(period.moyenneGenerale);

  statPond.innerHTML = avgHtml(period.moyenneClasse);
  const subEl = document.getElementById('stat-pond-sub');
  if (
    period.moyenneGenerale !== null &&
    period.moyenneClasse !== null
  ) {
    const diff = period.moyenneGenerale - period.moyenneClasse;
    const sign = diff >= 0 ? '+' : '−';
    const word = diff >= 0 ? 'au-dessus' : 'en-dessous';
    subEl.textContent = `${sign}${fmt(Math.abs(diff))} pt ${word} de la classe`;
  } else {
    subEl.textContent = 'moyenne générale de ta classe';
  }

  const counted = period.subjects.filter(
    (s) => !s.excluded && s.average !== null
  ).length;
  statCount.textContent = String(counted);

  renderChart(period);

  subjectsEl.innerHTML = '';
  if (period.subjects.length === 0) {
    subjectsEl.innerHTML =
      '<div class="empty"><strong>Aucune matière</strong>Cette période ne contient pas encore de notes.</div>';
    return;
  }

  const list = sortAndFilterSubjects(period.subjects);
  if (list.length === 0) {
    subjectsEl.innerHTML =
      '<div class="empty"><strong>Aucun résultat</strong>Aucune matière ne correspond à ta recherche.</div>';
    return;
  }
  for (const s of list) {
    subjectsEl.appendChild(renderSubjectCard(s));
  }
}

function sortAndFilterSubjects(subjects) {
  const q = state.search.trim().toLowerCase();
  let list = subjects.filter((s) =>
    q === '' ? true : s.name.toLowerCase().includes(q)
  );

  const num = (v) => (v === null || v === undefined ? -Infinity : v);
  switch (state.sort) {
    case 'name':
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      break;
    case 'avg-desc':
      list = [...list].sort((a, b) => num(b.average) - num(a.average));
      break;
    case 'avg-asc':
      list = [...list].sort((a, b) => num(a.average) - num(b.average));
      break;
    case 'diff-desc':
      list = [...list].sort((a, b) => {
        const da =
          a.average !== null && a.classAverage !== null
            ? a.average - a.classAverage
            : -Infinity;
        const db =
          b.average !== null && b.classAverage !== null
            ? b.average - b.classAverage
            : -Infinity;
        return db - da;
      });
      break;
    default:
      break;
  }
  return list;
}

function renderChart(period) {
  const card = document.getElementById('chart-card');
  const body = document.getElementById('chart-body');
  const legend = document.getElementById('chart-legend');
  const pts = (period.history || []).filter((p) => p.value != null);

  if (pts.length < 2) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const meVals = pts.map((p) => p.value);
  const clsVals = pts.map((p) => p.classValue).filter((v) => v != null);
  legend.innerHTML =
    `<span class="chart-key chart-key-me">● toi</span>` +
    (clsVals.length ? `<span class="chart-key chart-key-cls">● classe</span>` : '');

  const H = 240;
  const W = Math.max(360, Math.round(body.clientWidth || 760));
  const padL = 38;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const allVals = meVals.concat(clsVals);
  const dataMin = Math.min(...allVals);
  const dataMax = Math.max(...allVals);

  function niceStep(range) {
    const candidates = [0.5, 1, 2, 2.5, 5];
    for (const c of candidates) {
      if (range / c <= 5) return c;
    }
    return 5;
  }
  const rawRange = Math.max(1, dataMax - dataMin);
  const step = niceStep(rawRange + 1);
  let minV = Math.max(0, Math.floor(dataMin / step) * step - step);
  let maxV = Math.min(20, Math.ceil(dataMax / step) * step + step);
  if (maxV - minV < step * 2) maxV = Math.min(20, minV + step * 2);

  const x = (i) => padL + (innerW * i) / (pts.length - 1);
  const y = (v) => padT + innerH - (innerH * (v - minV)) / (maxV - minV);

  const gridLines = [];
  for (let v = minV; v <= maxV + 0.001; v += step) {
    const yy = y(v);
    const label = step >= 1 ? fmt(v, 0) : fmt(v, 1);
    gridLines.push(
      `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W - padR}" y2="${yy.toFixed(1)}" class="chart-grid" />` +
        `<text x="${padL - 7}" y="${(yy + 3).toFixed(1)}" class="chart-axis" text-anchor="end">${label}</text>`
    );
  }

  const mePathPts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const meLine = 'M' + mePathPts.join(' L');
  const meArea =
    `M${x(0).toFixed(1)},${y(minV).toFixed(1)} L` +
    mePathPts.join(' L') +
    ` L${x(pts.length - 1).toFixed(1)},${y(minV).toFixed(1)} Z`;

  let clsLine = '';
  if (clsVals.length === pts.length) {
    const clsPathPts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.classValue).toFixed(1)}`);
    clsLine = `<path d="M${clsPathPts.join(' L')}" class="chart-line-cls" />`;
  }

  body.innerHTML = `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="chart-svg" preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="rgba(37,99,235,0.20)" />
            <stop offset="1" stop-color="rgba(37,99,235,0)" />
          </linearGradient>
        </defs>
        ${gridLines.join('')}
        <path d="${meArea}" fill="url(#chartFill)" />
        ${clsLine}
        <path d="${meLine}" class="chart-line" vector-effect="non-scaling-stroke" />
        <line class="chart-cursor" id="chart-cursor" y1="${padT}" y2="${padT + innerH}" style="display:none" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="chart-hl" id="chart-hl" style="display:none"></div>
      <div class="chart-tip" id="chart-tip" style="display:none"></div>
    </div>
  `;

  const wrap = body.querySelector('.chart-wrap');
  const svg = body.querySelector('.chart-svg');
  const cursor = body.querySelector('#chart-cursor');
  const hl = body.querySelector('#chart-hl');
  const tip = body.querySelector('#chart-tip');

  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const mxPx = evt.clientX - rect.left;
    const sxScale = rect.width / W;
    const syScale = rect.height / H;
    const mxView = mxPx / sxScale;
    let idx = Math.round(((mxView - padL) / innerW) * (pts.length - 1));
    idx = Math.max(0, Math.min(pts.length - 1, idx));
    const p = pts[idx];
    const pvx = x(idx);
    const pvy = y(p.value);

    cursor.setAttribute('x1', pvx);
    cursor.setAttribute('x2', pvx);
    cursor.style.display = '';

    const pxReal = pvx * sxScale;
    const pyReal = pvy * syScale;
    hl.style.display = '';
    hl.style.left = pxReal + 'px';
    hl.style.top = pyReal + 'px';
    const dateStr = new Date(p.t).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    });
    tip.innerHTML =
      `<div class="tip-date">${dateStr}</div>` +
      `<div class="tip-row"><span class="tip-dot tip-dot-me"></span>toi <strong>${fmt(p.value)}</strong></div>` +
      (p.classValue != null
        ? `<div class="tip-row"><span class="tip-dot tip-dot-cls"></span>classe <strong>${fmt(p.classValue)}</strong></div>`
        : '');
    tip.style.display = '';
    const tipW = tip.offsetWidth || 130;
    let left = pxReal + 14;
    if (left + tipW > rect.width) left = pxReal - tipW - 14;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, pyReal - 12) + 'px';
  }

  function onLeave() {
    cursor.style.display = 'none';
    hl.style.display = 'none';
    tip.style.display = 'none';
  }

  wrap.addEventListener('mousemove', onMove);
  wrap.addEventListener('mouseleave', onLeave);
}

function renderSubjectCard(s) {
  const v = s.average;
  const isOpen = state.expanded.has(s.code);
  const isExcluded = s.excluded;

  const card = document.createElement('div');
  card.className = 'subject-card' + (isExcluded ? ' is-excluded' : '');
  card.style.setProperty('--subject-color', subjectColor(s.code));

  const head = document.createElement('div');
  head.className = 'subject';

  const chevron = isOpen ? '▾' : '▸';
  head.innerHTML = `
    <label class="subject-toggle" title="Compter cette matière">
      <input type="checkbox" ${isExcluded ? '' : 'checked'} />
    </label>
    <div class="subject-name">
      <span class="subject-title"></span>
      <span class="subject-meta"></span>
    </div>
    <div class="subject-coef"></div>
    <div class="subject-class">
      <span class="subject-class-label">Classe</span>
      <span></span>
    </div>
    <div class="subject-avg ${avgClass(v)}"></div>
    <span class="subject-chevron">${chevron}</span>
  `;

  head.querySelector('.subject-title').textContent = s.name.toLowerCase();
  head.querySelector('.subject-meta').textContent =
    s.noteCount > 0
      ? `${s.noteCount} note${s.noteCount > 1 ? 's' : ''}`
      : 'pas de note';
  head.querySelector('.subject-coef').textContent = `coef ${fmt(
    s.coef,
    s.coef % 1 === 0 ? 0 : 1
  )}`;
  head.querySelector('.subject-class span:last-child').textContent = fmt(
    s.classAverage
  );
  const avgEl = head.querySelector('.subject-avg');
  if (v === null || v === undefined) avgEl.textContent = '—';
  else avgEl.innerHTML = `${fmt(v)}<span class="unit">/20</span>`;

  const checkbox = head.querySelector('.subject-toggle input');
  head.querySelector('.subject-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
  });
  checkbox.addEventListener('change', () => toggleSubject(s.code));

  head.addEventListener('click', () => {
    if (state.expanded.has(s.code)) state.expanded.delete(s.code);
    else state.expanded.add(s.code);
    renderCurrentPeriod();
  });

  card.appendChild(head);

  if (isOpen) {
    const details = document.createElement('div');
    details.className = 'subject-details';
    if (!s.marks || s.marks.length === 0) {
      const none = document.createElement('div');
      none.className = 'mark-empty';
      none.textContent = 'Aucune note';
      details.appendChild(none);
    } else {
      for (const m of s.marks) {
        details.appendChild(renderMarkRow(m));
      }
    }
    const addBar = document.createElement('div');
    addBar.className = 'sim-add-bar';
    addBar.innerHTML =
      '<button class="sim-add-btn">+ Ajouter une note simulée</button>';
    addBar.querySelector('.sim-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (addBar.querySelector('.sim-form')) {
        addBar.querySelector('.sim-form').remove();
        return;
      }
      addBar.appendChild(buildSimForm(s.code));
    });
    details.appendChild(addBar);
    card.appendChild(details);
  }

  return card;
}

function buildSimForm(subjectCode) {
  const form = document.createElement('div');
  form.className = 'sim-form mark-editor';
  form.innerHTML = `
    <label class="me-field">
      <span>Note /20</span>
      <input type="number" class="sim-value" step="0.25" min="0" max="20" placeholder="ex. 15" />
    </label>
    <label class="me-field">
      <span>Coefficient</span>
      <input type="number" class="sim-coef" step="0.5" min="0" value="1" />
    </label>
    <div class="me-actions">
      <button class="btn btn-primary sim-save">Simuler</button>
    </div>
  `;
  const valInput = form.querySelector('.sim-value');
  const save = () => {
    const v = valInput.value.trim();
    const c = form.querySelector('.sim-coef').value.trim();
    if (v === '' || isNaN(parseFloat(v.replace(',', '.')))) {
      valInput.focus();
      return;
    }
    addSimulatedMark(subjectCode, v, c || '1');
  };
  form.querySelector('.sim-save').addEventListener('click', (e) => {
    e.stopPropagation();
    save();
  });
  valInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
  });
  form.addEventListener('click', (e) => e.stopPropagation());
  setTimeout(() => valInput.focus(), 0);
  return form;
}

function renderMarkRow(m) {
  const wrap = document.createElement('div');
  wrap.className = 'mark-wrap';

  const row = document.createElement('div');
  row.className =
    'mark' +
    (m.isEffective ? '' : ' mark-ineffective') +
    (m.overridden ? ' mark-overridden' : '') +
    (m.simulated ? ' mark-simulated' : '');

  const on = m.valueOn && m.valueOn !== 20 ? `/${fmt(m.valueOn, 0)}` : '';

  if (m.simulated) {
    row.innerHTML = `
      <span class="mark-title"></span>
      <span class="mark-coef"></span>
      <span class="mark-class"><span class="sim-badge">simulée</span></span>
      <span class="mark-value"></span>
      <span class="mark-actions">
        <button class="mark-btn mark-remove" title="Supprimer">✕</button>
      </span>
    `;
    row.querySelector('.mark-title').textContent = m.title || 'Note simulée';
    row.querySelector('.mark-coef').textContent =
      'coef ' + fmt(m.coefficient, m.coefficient % 1 === 0 ? 0 : 1);
    row.querySelector('.mark-value').textContent = `${m.valueStr || fmt(m.value)}${on}`;
    row.querySelector('.mark-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSimulatedMark(m.id);
    });
    wrap.appendChild(row);
    return wrap;
  }

  row.innerHTML = `
    <span class="mark-title"></span>
    <span class="mark-coef"></span>
    <span class="mark-class"></span>
    <span class="mark-value"></span>
    <span class="mark-actions">
      <button class="mark-btn mark-edit" title="Modifier">✎</button>
      <button class="mark-btn mark-toggle" title="${m.disabled ? 'Réactiver' : 'Ne pas compter'}">${m.disabled ? '○' : '◉'}</button>
    </span>
  `;

  const titlePrefix = m.overridden ? '• ' : '';
  row.querySelector('.mark-title').textContent =
    titlePrefix + (m.title || 'Évaluation');
  row.querySelector('.mark-coef').textContent =
    'coef ' + fmt(m.coefficient, m.coefficient % 1 === 0 ? 0 : 1);
  row.querySelector('.mark-class').textContent =
    m.classValue !== null && !isNaN(m.classValue)
      ? 'classe ' + fmt(m.classValue)
      : '';
  row.querySelector('.mark-value').textContent = m.isEffective
    ? `${m.valueStr || fmt(m.value)}${on}`
    : m.valueStr || '—';

  row.querySelector('.mark-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    setMarkOverride(m.id, { disabled: m.disabled ? undefined : true });
  });

  row.querySelector('.mark-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    const existing = wrap.querySelector('.mark-editor');
    if (existing) {
      existing.remove();
      return;
    }
    wrap.appendChild(buildMarkEditor(m));
  });

  wrap.appendChild(row);
  return wrap;
}

function buildMarkEditor(m) {
  const ov = state.overrides[m.id] || {};
  const editor = document.createElement('div');
  editor.className = 'mark-editor';
  editor.innerHTML = `
    <label class="me-field">
      <span>Note /20</span>
      <input type="number" class="me-value" step="0.25" min="0" max="20"
        placeholder="${fmt(m.value)}" value="${ov.value ?? ''}" />
    </label>
    <label class="me-field">
      <span>Coefficient</span>
      <input type="number" class="me-coef" step="0.5" min="0"
        placeholder="${fmt(m.coefficient, m.coefficient % 1 === 0 ? 0 : 1)}" value="${ov.coef ?? ''}" />
    </label>
    <div class="me-actions">
      <button class="btn btn-ghost me-reset">Réinitialiser</button>
      <button class="btn btn-primary me-save">Enregistrer</button>
    </div>
  `;

  editor.querySelector('.me-save').addEventListener('click', (e) => {
    e.stopPropagation();
    const val = editor.querySelector('.me-value').value.trim();
    const coef = editor.querySelector('.me-coef').value.trim();
    setMarkOverride(m.id, {
      value: val === '' ? undefined : val,
      coef: coef === '' ? undefined : coef,
    });
  });

  editor.querySelector('.me-reset').addEventListener('click', (e) => {
    e.stopPropagation();
    resetMarkOverride(m.id);
  });

  editor.addEventListener('click', (e) => e.stopPropagation());
  return editor;
}

document.getElementById('refresh-btn').addEventListener('click', refreshNotes);

document.getElementById('subject-search').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderOnlySubjects();
});
document.getElementById('subject-sort').addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderOnlySubjects();
});

function renderOnlySubjects() {
  const period = state.periods.find((p) => p.id === state.currentPeriodId);
  const subjectsEl = document.getElementById('subjects');
  if (!period) return;
  subjectsEl.innerHTML = '';
  const list = sortAndFilterSubjects(period.subjects);
  if (list.length === 0) {
    subjectsEl.innerHTML =
      '<div class="empty"><strong>Aucun résultat</strong>Aucune matière ne correspond à ta recherche.</div>';
    return;
  }
  for (const s of list) subjectsEl.appendChild(renderSubjectCard(s));
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const period = state.periods.find((p) => p.id === state.currentPeriodId);
    if (period && !document.getElementById('chart-card').hidden) {
      renderChart(period);
    }
  }, 120);
});

const aboutOverlay = document.getElementById('about-overlay');
function openAbout() {
  aboutOverlay.hidden = false;
}
function closeAbout() {
  aboutOverlay.hidden = true;
}
document.getElementById('about-btn').addEventListener('click', openAbout);
document.getElementById('about-close').addEventListener('click', closeAbout);
aboutOverlay.addEventListener('click', (e) => {
  if (e.target === aboutOverlay) closeAbout();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !aboutOverlay.hidden) closeAbout();
});
document.getElementById('about-author').addEventListener('click', (e) => {
  e.preventDefault();
  window.app.openExternal('https://github.com/dev-zsm');
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.store.clear();
  state.token = null;
  state.account = null;
  state.notes = null;
  state.periods = [];
  state.currentPeriodId = null;
  state.pendingLogin = null;
  state.fa = null;
  state.excluded = new Set();
  state.overrides = {};
  state.simulated = {};
  document.getElementById('login-form').reset();
  showView('login');
});

(async function bootstrap() {
  try {
    const v = await window.app.version();
    if (v) document.getElementById('about-version').textContent = 'version ' + v;
  } catch {}

  const saved = await window.store.load();
  if (saved?.fa) state.fa = saved.fa;
  if (Array.isArray(saved?.excluded)) state.excluded = new Set(saved.excluded);
  if (saved?.overrides && typeof saved.overrides === 'object') {
    state.overrides = saved.overrides;
  }
  if (saved?.simulated && typeof saved.simulated === 'object') {
    state.simulated = saved.simulated;
  }
  if (saved?.token && saved?.account) {
    state.token = saved.token;
    state.account = saved.account;
    state.pendingLogin = {
      username: saved.username,
      password: saved.password,
      remember: true,
    };
    await loadDashboard();
    return;
  }
  showView('login');
})();
