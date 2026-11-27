/* Проверка ТЗ — фронтенд без сборки. Всё, что пришло от LLM или из файла, выводится только как текст (h()). */
'use strict';

// ------------------------------------------------------------------ утилиты
const $app = document.getElementById('app');
const SEV = {
  critical: { label: 'Критично', many: 'критичных', cls: 'critical' },
  major: { label: 'Существенно', many: 'существенных', cls: 'major' },
  minor: { label: 'Мелко', many: 'мелких', cls: 'minor' },
};
const SEV_ORDER = { critical: 0, major: 1, minor: 2 };
const STEPS = [
  { name: 'Чтение документа', stages: ['reading'] },
  { name: 'Нарезка на требования', stages: ['splitting'] },
  { name: 'Проверка каждого требования', stages: ['checking_requirements'] },
  { name: 'Проверка всего документа', stages: ['checking_set'] },
  { name: 'Сверка с кодом GitLab', stages: ['checking_gitlab'] },
  { name: 'Проверка цитат и отчёт', stages: ['verifying_quotes', 'summary'] },
];
const STAGE_ORDER = ['queued', 'reading', 'splitting', 'checking_requirements', 'checking_set', 'checking_gitlab', 'verifying_quotes', 'summary', 'done'];
const CRIT_SHORT = { iso29148: 'ISO 29148', ieee830: 'IEEE 830', checklist: 'чек-лист шаблона', fintech: 'финтех-правила' };
const WORK_TYPES = ['Новый функционал', 'Доработка', 'Интеграция', 'Исправление ошибки'];
const DRAFT_KEY = 'bcc-spec-upload-draft-v1';

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') throw new Error('html запрещён');
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, kids);
  return el;
}
function fill(el, ...kids) { el.replaceChildren(); return append(el, kids); }
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
const svg = (d, size = 24, sw = 2.4) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', sw);
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p);
  return s;
};
const ICON_UP = 'M12 19V5M5 12l7-7 7 7';
const ICON_RIGHT = 'M5 12h14M13 6l6 6-6 6';

async function api(path, opts = {}) {
  const init = { ...opts, headers: { ...(opts.headers || {}) } };
  if (opts.json !== undefined) { init.body = JSON.stringify(opts.json); init.headers['Content-Type'] = 'application/json'; delete init.json; }
  let r;
  try { r = await fetch(path, init); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw { code: 'network', message: 'Сервер недоступен', hint: 'Проверьте, что сервис запущен.' };
  }
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const d = typeof data === 'object' ? data : {};
    const msg = r.status === 413 ? 'Файл больше 20 МБ' : (d.message || (typeof d.detail === 'string' ? d.detail : '') || `Ошибка ${r.status}`);
    throw { status: r.status, code: d.code || String(r.status), message: msg, hint: d.hint || '' };
  }
  return data;
}

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const diff = Math.round((day - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (diff === 0) return `сегодня, ${time}`;
  if (diff === 1) return `вчера, ${time}`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + `, ${time}`;
}
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ'; }
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many;
}
function setTitle(t) { document.title = t ? `${t} — Проверка ТЗ` : 'Проверка ТЗ — Банк ЦентрКредит'; }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text); document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Скопировано'); }
}

// ------------------------------------------------------------------ состояние
const state = {
  meta: null,
  intake: { phase: 'empty', upload: null, error: null, file: null, abort: null,
    previous: null, draftNotice: '', form: { title: '', work_type: WORK_TYPES[0], project: '', ref: '', scopes: ['api', 'openapi', 'db'], criteria: null,
      no_cache: false, model: '' } },
  projects: [],
  branches: {},
  timers: new Set(),
};
function every(ms, fn) { const id = setInterval(fn, ms); state.timers.add(id); return id; }
function clearTimers() { state.timers.forEach(clearInterval); state.timers.clear(); }
function saveDraft() {
  const it = state.intake;
  if (it.phase !== 'parsed' || !it.upload) return;
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ upload_id: it.upload.upload_id, form: it.form })); } catch { /* storage может быть запрещён */ }
}
function clearDraft() { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage может быть запрещён */ } }
async function restoreDraft() {
  let draft;
  try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { clearDraft(); return; }
  if (!draft?.upload_id || state.intake.phase !== 'empty') return;
  try {
    state.intake.upload = await api(`api/documents/${encodeURIComponent(draft.upload_id)}`);
    state.intake.file = { name: state.intake.upload.file_name, size: state.intake.upload.size };
    state.intake.form = { ...state.intake.form, ...(draft.form || {}) };
    state.intake.phase = 'parsed';
  } catch {
    clearDraft(); state.intake.draftNotice = 'Черновик загрузки истёк. Загрузите файл заново.';
  }
}

async function loadMeta() {
  try {
    state.meta = await api('api/meta');
    const m = state.meta;
    const badge = document.getElementById('mode-badge');
    if (m.mode !== 'agent') {
      badge.hidden = false;
      badge.textContent = m.mode === 'broken' ? 'конвейер агента не загрузился' : 'демо-конвейер';
      badge.title = m.mode === 'broken'
        ? 'validator.pipeline найден, но падает при импорте — смотрите лог сервера'
        : 'Конвейер агента (validator.pipeline) ещё не подключён — результаты демонстрационные, без LLM';
    }
    if (!state.intake.form.criteria) state.intake.form.criteria = m.groups.map((g) => g.id);
    await restoreDraft();
  } catch (e) {
    state.meta = { groups: [], criteria: [], scopes: [], max_upload_mb: 20, mode: 'unknown' };
  }
}
async function loadProjects() {
  try { state.projects = await api('api/gitlab/projects'); } catch { state.projects = []; }
  return state.projects;
}

// ------------------------------------------------------------------ роутер
const routes = [
  [/^#?\/?$/, () => viewIntake(), 'intake'],
  [/^#\/history$/, () => viewHistory(), 'history'],
  [/^#\/criteria$/, () => viewCriteria(), 'criteria'],
  [/^#\/gitlab$/, () => viewGitlab(), 'gitlab'],
  [/^#\/runs\/([\w-]+)$/, (m) => viewRun(m[1]), null], // проверка — не пункт меню, ничего не подсвечиваем
];
async function route() {
  clearTimers();
  const hash = location.hash || '#/';
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
      document.querySelectorAll('[data-nav]').forEach((a) => {
        if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
      setTitle('');
      $app.replaceChildren();
      await fn(m);
      return;
    }
  }
  // Неизвестный адрес: честный экран «не найдено», история браузера не переписывается.
  document.querySelectorAll('[data-nav]').forEach((a) => { a.classList.remove('on'); a.removeAttribute('aria-current'); });
  render(notFound('Раздел не найден', 'Такого адреса в сервисе нет. Проверьте ссылку или начните с главной.'));
}
function render(...nodes) { fill($app, nodes); }
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ================================================================== 1. Загрузка ТЗ
const fileInput = h('input', { type: 'file', accept: '.pdf,.docx,.md,.markdown,.txt', class: 'sr', tabindex: '-1', 'aria-hidden': 'true' });
document.body.appendChild(fileInput);
fileInput.addEventListener('change', () => { if (fileInput.files[0]) acceptFile(fileInput.files[0]); fileInput.value = ''; });
const pickFile = () => fileInput.click();
const formatText = () => (state.meta?.format_labels || ['PDF', 'DOCX', 'Markdown', 'TXT']).join(', ');

const ERR_TEXT = {
  format: { color: 'var(--crit)', code: 'ФАЙЛ · ФОРМАТ' },
  size: { color: 'var(--crit)', code: 'ФАЙЛ · РАЗМЕР' },
  scan: { color: 'var(--major)', code: 'PDF · НЕТ ТЕКСТА' },
  locked: { color: 'var(--major)', code: 'PDF · ЗАЩИТА' },
  broken: { color: 'var(--crit)', code: 'ФАЙЛ · ПОВРЕЖДЁН' },
  empty: { color: 'var(--major)', code: 'СОДЕРЖАНИЕ · ПУСТО' },
  network: { color: 'var(--crit)', code: 'СЕТЬ' },
};

async function acceptFile(file) {
  const it = state.intake;
  if (it.phase === 'parsed' && it.upload) it.previous = { phase: it.phase, upload: it.upload, file: it.file, form: structuredClone(it.form) };
  const maxMb = state.meta?.max_upload_mb || 20;
  it.file = { name: file.name, size: file.size };
  if (!/\.(pdf|docx|md|markdown|txt)$/i.test(file.name)) {
    it.phase = 'error'; it.error = { code: 'format', message: 'Этот формат агент не читает', hint: `Поддерживаются ${formatText()}.` };
    return viewIntake();
  }
  if (file.size > maxMb * 1048576) {
    it.phase = 'error'; it.error = { code: 'size', message: `Файл больше ${maxMb} МБ`, hint: 'Обычно размер дают картинки и сканы. Сохраните документ без изображений или разбейте на части.' };
    return viewIntake();
  }
  it.phase = 'reading'; it.error = null; it.upload = null;
  it.abort = new AbortController();
  viewIntake();
  const fd = new FormData(); fd.append('file', file);
  try {
    const up = await api('api/documents', { method: 'POST', body: fd, signal: it.abort.signal });
    it.upload = up; it.phase = 'parsed'; it.previous = null;
    it.form.title = up.preview.title || file.name.replace(/\.[^.]+$/, '');
    saveDraft();
  } catch (e) {
    if (e.name === 'AbortError') {
      if (it.previous) { Object.assign(it, it.previous); it.previous = null; }
      else it.phase = 'empty';
    }
    else { it.phase = 'error'; it.error = e; }
  }
  if ((location.hash || '#/').match(/^#?\/?$/)) viewIntake();
}

async function viewIntake() {
  setTitle('');
  const it = state.intake;
  if (it.phase === 'parsed') saveDraft();
  if (!state.projects.length) await loadProjects();
  const stepLabel = it.phase === 'parsed' ? 'Шаг 2 из 3 · настройки' : it.phase === 'error' ? 'Файл не принят' : 'Шаг 1 из 3 · документ';

  const left = h('div', { class: 'col-left intake-left' },
    h('span', { class: 'greenbar' }),
    h('span', { class: 'eyebrow' }, stepLabel),
    h('h1', { class: 'display' }, 'Проверка ТЗ до разработки'),
    h('p', { class: 'lead' }, 'Положите документ на лист. Агент прочитает его как придирчивый рецензент и оставит замечания на полях.'),
    it.draftNotice ? h('div', { class: 'note' }, it.draftNotice) : null,
    h('ol', { class: 'numlist' },
      [['01', 'Каждое требование — по ISO/IEC/IEEE 29148 и IEEE 830'], ['02', 'Противоречия и пропуски между разделами документа'], ['03', 'Расхождения с кодом проекта в GitLab']]
        .map(([n, t]) => h('li', null, h('span', { class: 'n' }, n), h('span', null, t)))),
  );

  const right = h('div', { class: 'col-right' });
  if (it.phase === 'empty' || it.phase === 'drag') right.append(dropSheet());
  if (it.phase === 'reading') right.append(readingSheet());
  if (it.phase === 'parsed') right.append(parsedSheet());
  if (it.phase === 'error') right.append(errorSheet());
  if (it.phase !== 'reading' && it.phase !== 'error') right.append(...settingsBlock());

  render(h('div', { class: 'wrap split' }, left, right));
}

function dropSheet() {
  const it = state.intake;
  const btn = h('button', { type: 'button', class: 'drop' + (it.phase === 'drag' ? ' is-drag' : ''), 'aria-label': 'Выбрать файл ТЗ', onclick: pickFile },
    h('span', { class: 'paper sheet', style: { display: 'block' } },
      h('span', { class: 'rules' }, h('span'), h('span'), h('span'), h('span')),
      h('span', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '14px', marginTop: '64px' } },
        h('span', { class: 'big' }, it.phase === 'drag' ? 'Отпускайте.' : ['Положите ТЗ', h('br'), 'на этот лист']),
        h('span', { class: 'muted' }, `Перетащите ${formatText()} до ${state.meta?.max_upload_mb || 20} МБ — или нажмите, чтобы выбрать файл`)),
      h('span', { class: 'rules', style: { marginTop: '64px' } }, h('span'), h('span'), h('span')),
      it.phase === 'drag' ? null : h('span', { class: 'arrow' }, svg(ICON_UP))));
  let depth = 0;
  btn.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; if (it.phase !== 'drag') { it.phase = 'drag'; btn.classList.add('is-drag'); btn.querySelector('.big').textContent = 'Отпускайте.'; } });
  btn.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  btn.addEventListener('dragleave', () => { depth--; if (depth <= 0) { depth = 0; it.phase = 'empty'; viewIntake(); } });
  btn.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; const f = e.dataTransfer.files[0]; if (f) acceptFile(f); else { it.phase = 'empty'; viewIntake(); } });
  return btn;
}

function readingSheet() {
  const it = state.intake;
  return h('div', { class: 'paper sheet' },
    h('span', { class: 'mono small muted' }, `${it.file.name} · ${fmtSize(it.file.size)}`),
    h('span', { class: 'h2', style: { fontSize: '40px' } }, 'Читаем документ…'),
    h('span', { class: 'bar indet' }, h('span')),
    h('button', { type: 'button', class: 'btn-ghost', style: { alignSelf: 'flex-start', marginTop: 'auto' }, onclick: () => it.abort && it.abort.abort() }, 'Отменить'));
}

function parsedSheet() {
  const it = state.intake;
  const p = it.upload.preview;
  return h('div', { class: 'paper sheet parsed' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } },
      h('span', { class: 'eyebrow' }, '✓ Документ прочитан'),
      h('button', { type: 'button', class: 'btn-link', onclick: pickFile }, 'Заменить файл')),
    h('span', { style: { fontSize: '34px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.08 } }, p.title),
    h('span', { class: 'mono small muted' }, `${it.upload.file_name} · ${fmtSize(it.upload.size)} · ${p.format.toUpperCase()}`),
    h('div', { class: 'metrics' },
      p.pages ? metric(p.pages, plural(p.pages, 'страница', 'страницы', 'страниц'))
        : metric(p.sections.length, plural(p.sections.length, 'раздел', 'раздела', 'разделов')),
      metric(p.req_markers_total, 'пунктов с номерами'),
      metric(p.tables, plural(p.tables, 'таблица', 'таблицы', 'таблиц'))),
    p.req_markers.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('span', { class: 'mono', style: { fontSize: '12px', color: 'var(--ink-3)' } }, 'Номера в документе'),
      h('div', { class: 'chips' }, p.req_markers.slice(0, 24).map((m) => h('span', { class: 'chip' }, m)))) : null,
    p.sections.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h('span', { class: 'mono', style: { fontSize: '12px', color: 'var(--ink-3)' } }, 'Разделы'),
      h('div', { class: 'small', style: { color: 'var(--ink-2)', lineHeight: 1.7 } }, p.sections.slice(0, 8).join(' · '))) : null,
    !p.looks_like_requirements
      ? h('div', { class: 'note' }, h('b', null, 'Похоже, это не ТЗ. '), 'Не нашлось ни номеров требований, ни формулировок «должен». Если это ТЗ в нестандартном шаблоне — запускайте, агент нарежет текст сам.')
      : p.req_markers_total ? null : h('div', { class: 'note' }, 'В документе нет номеров требований — агент присвоит свои и сохранит цитаты.'),
  );
}
const metric = (n, label) => h('div', null, h('b', null, String(n)), h('span', null, label));

function errorSheet() {
  const it = state.intake;
  const e = it.error || {};
  const meta = ERR_TEXT[e.code] || { color: 'var(--crit)', code: 'ОШИБКА' };
  return h('div', { class: 'paper errcard', style: { borderTop: `8px solid ${meta.color}` } },
    h('span', { class: 'code', style: { color: meta.color } }, meta.code),
    h('span', { class: 'h2', style: { fontSize: '40px' } }, e.message || 'Файл не принят'),
    e.hint ? h('span', { style: { fontSize: '17px', lineHeight: 1.55, color: 'var(--ink-2)' } }, e.hint) : null,
    it.file ? h('span', { class: 'file' }, `${it.file.name} · ${fmtSize(it.file.size)}`) : null,
    h('div', { class: 'row', style: { marginTop: 'auto' } },
      h('button', { type: 'button', class: 'btn', onclick: pickFile }, 'Выбрать другой файл'),
      h('button', { type: 'button', class: 'btn-ghost', onclick: () => {
        if (it.previous) { Object.assign(it, it.previous); it.previous = null; it.error = null; } else { it.phase = 'empty'; it.error = null; }
        viewIntake();
      } }, 'Отмена')),
    h('span', { class: 'small muted' }, `Поддерживаются: ${formatText()}. Пароли и ключи в сервис не вводятся.`));
}

function settingsBlock() {
  const it = state.intake;
  const f = it.form;
  const parsed = it.phase === 'parsed';
  const ready = state.projects.filter((p) => p.status !== 'error');
  if (f.project && !ready.some((p) => p.id === f.project)) f.project = '';

  if (!parsed) return [];
  const blocks = [];
  if (ready.length) {
    const projSel = h('select', { class: 'inline-select mono', id: 'sel-project', onchange: (e) => { f.project = e.target.value; f.ref = ''; viewIntake(); } },
      ready.map((p) => h('option', { value: p.id, selected: f.project === p.id }, p.path)),
      h('option', { value: '', selected: !f.project }, 'без сверки с кодом'));
    blocks.push(h('div', { class: 'sentence' },
      'Сверить с проектом ', h('label', null, h('span', { class: 'sr' }, 'Проект GitLab'), projSel),
      f.project ? [' ветка ', h('label', null, h('span', { class: 'sr' }, 'Ветка'), branchSelect(f))] : null));
  } else {
    blocks.push(h('span', { class: 'small muted' }, 'Без сверки с кодом. Чтобы сверять ТЗ с кодом, ', h('a', { href: '#/gitlab' }, 'подключите проект GitLab'), '.'));
  }
  const crit = f.criteria || [];
  blocks.push(h('span', { class: 'small' }, h('span', { class: 'muted' }, 'Критерии: '),
    crit.length ? crit.map((c) => CRIT_SHORT[c] || c).join(' · ') : h('span', { class: 'formerr' }, 'не выбраны')));

  {
    const more = h('details', { class: 'more' }, h('summary', null, 'Изменить название, тип работы, критерии'),
      h('div', { class: 'settings', style: { paddingTop: '12px' } },
        h('div', { class: 'grid2' },
          h('label', { class: 'field' }, 'Название проверки', h('input', { type: 'text', value: f.title, maxlength: '200', oninput: (e) => { f.title = e.target.value; saveDraft(); } })),
          h('label', { class: 'field' }, 'Тип работы', h('select', { onchange: (e) => { f.work_type = e.target.value; saveDraft(); } },
            WORK_TYPES.map((w) => h('option', { selected: w === f.work_type }, w))))),
        f.project ? h('fieldset', { style: { border: 0, padding: 0, margin: 0 } },
          h('legend', { class: 'small muted', style: { paddingBottom: '8px' } }, 'Что агент читает в коде (только чтение)'),
          h('div', { class: 'checks' }, (state.meta?.scopes || []).map((s) => checkRow(s.label, s.meta, f.scopes.includes(s.id), (on) => {
            f.scopes = on ? [...new Set([...f.scopes, s.id])] : f.scopes.filter((x) => x !== s.id);
            saveDraft();
          })))) : null,
        h('fieldset', { style: { border: 0, padding: 0, margin: 0 } },
          h('legend', { class: 'small muted', style: { paddingBottom: '8px' } }, 'Критерии'),
          h('div', { class: 'checks' }, (state.meta?.groups || []).map((g) => checkRow(g.label, g.source, (f.criteria || []).includes(g.id), (on) => {
            f.criteria = on ? [...new Set([...(f.criteria || []), g.id])] : (f.criteria || []).filter((x) => x !== g.id);
            viewIntake();
          })))),
        h('fieldset', { style: { border: 0, padding: 0, margin: 0 } },
          h('legend', { class: 'small muted', style: { paddingBottom: '8px' } }, 'Модель и кэш'),
          h('label', { class: 'field' }, 'Модель', h('select', { onchange: (e) => { f.model = e.target.value; saveDraft(); } },
            h('option', { value: '', selected: !f.model }, 'по умолчанию'),
            (state.meta?.allowed_models || []).map((model) => h('option', { value: model, selected: f.model === model }, model)))),
          checkRow('Проверить без кэша', 'Все обращения к модели будут выполнены заново', !!f.no_cache, (on) => { f.no_cache = on; saveDraft(); })),
      ));
    more.open = !!it.moreOpen;
    more.addEventListener('toggle', () => { it.moreOpen = more.open; });
    blocks.push(more);
  }

  const err = h('span', { class: 'formerr', role: 'alert' });
  const start = h('button', { type: 'button', class: 'btn-start', onclick: startRun },
    'Начать ревью', h('span', { class: 'arrow' }, svg(ICON_RIGHT, 26)));
  async function startRun() {
    if (!(f.criteria || []).length) { err.textContent = 'Выберите хотя бы один набор критериев.'; return; }
    if (f.project && !f.scopes.length) { err.textContent = 'Выберите, что сверять в коде, или уберите проект.'; return; }
    start.disabled = true; err.textContent = '';
    try {
      const r = await api('api/runs', { method: 'POST', json: {
        upload_id: it.upload.upload_id, title: f.title, work_type: f.work_type, criteria: f.criteria,
        gitlab_project_id: f.project || null, ref: f.project ? (f.ref || null) : null, scopes: f.project ? f.scopes : [],
        no_cache: !!f.no_cache, model: f.model || null } });
      clearDraft(); state.intake = { ...state.intake, phase: 'empty', upload: null, file: null, error: null };
      location.hash = `#/runs/${r.run_id}`;
    } catch (e) { err.textContent = e.message; start.disabled = false; }
  }
  blocks.push(start, err, h('span', { class: 'small muted' }, 'Доступ к коду только на чтение. Замечания без подтверждённой цитаты показываются отдельно и не влияют на вердикт.'));
  return blocks;
}

function checkRow(label, sub, checked, onchange) {
  return h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }),
    h('span', { class: 't' }, label), h('span', { class: 's' }, sub));
}

function branchSelect(f) {
  const proj = state.projects.find((p) => p.id === f.project);
  const sel = h('select', { class: 'inline-select mono', onchange: (e) => { f.ref = e.target.value; saveDraft(); } });
  const setOptions = (names) => {
    fill(sel, ...names.map((n) => h('option', { value: n, selected: (f.ref || proj.default_branch) === n }, n)));
  };
  if (state.branches[f.project]) setOptions(state.branches[f.project]);
  else {
    setOptions([proj.default_branch]);
    api(`api/gitlab/projects/${f.project}/branches`).then((names) => { state.branches[f.project] = names; setOptions(names); }).catch(() => {});
  }
  return sel;
}

// ================================================================== 2. Ревью и результат
async function viewRun(id) {
  let run;
  try { run = await api(`api/runs/${id}`); }
  catch (e) { return render(notFound('Проверка не найдена', 'Проверка удалена или указана неверная ссылка.')); }
  if (run.status === 'done' || run.status === 'partial') return viewResult(run);
  drawReview(run);
  if (run.status === 'running' || run.status === 'queued') {
    every(800, async () => {
      try {
        const r = await api(`api/runs/${id}`);
        if (r.status === 'done' || r.status === 'partial') { clearTimers(); return viewResult(r); }
        drawReview(r);
        if (r.status !== 'running' && r.status !== 'queued') clearTimers();
      } catch { /* сеть моргнула — следующий опрос */ }
    });
  }
}

function stepStates(run) {
  const idx = STAGE_ORDER.indexOf(run.stage);
  return STEPS.map((st, i) => {
    const first = STAGE_ORDER.indexOf(st.stages[0]);
    const last = STAGE_ORDER.indexOf(st.stages[st.stages.length - 1]);
    let s = idx > last ? 'done' : idx >= first ? 'cur' : 'todo';
    const info = run.stage_info || {};
    const crit = (run.options?.criteria || []).map((c) => CRIT_SHORT[c] || c).join(' · ');
    const scopeLabels = Object.fromEntries((state.meta?.scopes || []).map((x) => [x.id, x.label]));
    const scopes = (run.gitlab?.scopes || []).map((x) => scopeLabels[x] || x).join(', ');
    let detail = ['текст, разделы и таблицы', 'присвоение ID и цитат', crit || 'критерии качества требований',
      'противоречия, пропуски, трассируемость', scopes, 'каждое замечание сверяется с текстом'][i];
    if (i === 1 && info.total && s === 'cur') detail = `${info.total} ${plural(info.total, 'требование', 'требования', 'требований')}`;
    if (i === 2 && s === 'cur' && info.total) detail = `требование ${info.done || 0} из ${info.total}`;
    if (i === 4) {
      if (!run.gitlab) { detail = 'проект не выбран — пропускаем'; if (s !== 'todo') s = 'skip'; }
      else detail = `${run.gitlab.path} @ ${run.gitlab.ref}${scopes ? ' · ' + scopes : ''}`;
      if (run.warnings.some((w) => w.stage === 'checking_gitlab')) { s = idx > last ? 'warn' : s; detail = 'нет доступа к проекту — продолжили без кода'; }
    }
    if (i === 5 && s === 'cur' && info.dropped) detail = `отброшено без цитаты: ${info.dropped}`;
    if ((run.status === 'error' || run.status === 'cancelled') && s === 'cur') { s = run.status === 'error' ? 'fail' : 'skip'; detail = run.status === 'error' ? 'остановлено с ошибкой' : 'остановлено пользователем'; }
    return { ...st, s, detail, n: i + 1 };
  });
}

function drawReview(run) {
  setTitle(run.title);
  const steps = stepStates(run);
  const found = run.stage_info?.findings_so_far ?? 0;
  const err = run.status === 'error';
  const cancelled = run.status === 'cancelled';
  const title = err ? 'Ревью прервано' : cancelled ? 'Отменено пользователем' : 'Идёт ревью';
  const text = err ? 'Конвейер не смог завершить проверку. Ниже — что случилось и что можно сделать.'
    : cancelled ? 'Проверку остановили. Можно запустить её заново с теми же настройками.'
      : 'Можно закрыть вкладку — проверка продолжится, отчёт появится в истории.';
  const mins = Math.max(0, Math.floor((Date.now() / 1000 - run.created_at) / 60));
  const timing = err || cancelled ? null
    : run.status === 'queued'
      ? (run.queue_position ? `В очереди: перед этой проверкой ${run.queue_position} ${plural(run.queue_position, 'другая', 'других', 'других')}. Одновременно идут ${run.queue_workers || 2} ${plural(run.queue_workers || 2, 'проверка', 'проверки', 'проверок')}.` : 'В очереди — начнётся, как только освободится место.')
      : `Идёт ${mins ? mins + ' мин' : 'меньше минуты'}. Документ на 5–15 требований агент проверяет обычно за 5–10 минут, большой — дольше.`;

  const left = h('div', { class: 'col-left', style: { gap: '24px' } },
    h('span', { class: 'greenbar' }),
    h('span', { class: 'eyebrow grey' }, [run.file_name, run.gitlab ? run.gitlab.path : null].filter(Boolean).join(' · ')),
    h('h1', { class: 'display' }, title),
    h('p', { class: 'lead' }, text),
    timing ? h('p', { class: 'small muted', role: 'status' }, timing) : null,
    h('div', { class: 'bignum' }, h('b', null, String(found)), h('span', { class: 'muted' }, 'замечаний уже на полях')),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': run.progress, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Прогресс проверки', style: { maxWidth: '480px' } },
      h('span', { style: { width: `${run.progress}%` } })),
    err || cancelled
      ? h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: () => retry(run.id) }, 'Запустить заново'),
        h('a', { class: 'btn-ghost', href: '#/' }, 'Новое ТЗ'))
      : h('button', { type: 'button', class: 'btn-ghost', style: { alignSelf: 'flex-start' }, onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Запрошена остановка…';
        try { const stopped = await api(`api/runs/${run.id}/cancel`, { method: 'POST' });
          if (stopped.cancel_outcome === 'completed_before_cancel') toast('Завершилось до отмены');
        } catch (x) { toast(x.message); }
      } }, 'Остановить ревью'));

  const alerts = [];
  if (run.stage_slow) alerts.push(h('div', { class: 'alert', role: 'status' },
    h('span', { class: 'code' }, 'МОДЕЛЬ · ДОЛГИЙ ОТВЕТ'), h('span', { class: 't' }, 'Модель отвечает дольше обычного'),
    h('p', null, 'Проверка продолжается. Можно оставить страницу открытой или вернуться к результату из истории.')));
  for (const w of run.warnings || []) {
    const isGit = w.stage === 'checking_gitlab' || (w.code || '').startsWith('gitlab');
    alerts.push(h('div', { class: 'alert', role: 'alert' },
      h('span', { class: 'code' }, isGit ? `GITLAB · ${w.code || ''}` : `ПРЕДУПРЕЖДЕНИЕ · ${w.code || ''}`),
      h('span', { class: 't' }, isGit ? `Нет доступа к ${run.gitlab ? run.gitlab.path : 'проекту'}` : (w.title || 'Конвейер сообщил о проблеме')),
      h('p', null, w.message || ''),
      isGit ? h('p', null, 'Проверка формулировок продолжается — не будет только сверки с кодом. ', h('a', { href: '#/gitlab' }, 'Обновить токен')) : null));
  }
  if (err) {
    const e = run.error || {};
    const is429 = e.code === 'quota_exhausted';
    const stepName = (STEPS.find((s) => s.stages.includes(e.stage)) || {}).name || 'одном из этапов';
    alerts.push(h('div', { class: 'alert err', role: 'alert' },
      h('span', { class: 'code' }, is429 ? 'МОДЕЛЬ · 429 · ЛИМИТ ЗАПРОСОВ' : `ОШИБКА · ${e.code || ''}`),
      h('span', { class: 't' }, is429 ? `Модель перестала отвечать: «${stepName}»` : `Сбой на этапе «${stepName}»`),
      h('p', null, e.message || ''),
      e.hint ? h('p', null, e.hint) : null,
      is429 ? h('p', null, 'Выберите другую модель в расширенных настройках новой проверки или повторите позже.') : null,
      e.technical_detail ? h('details', { class: 'more' }, h('summary', null, 'Технические детали'),
        h('pre', { class: 'small', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, e.technical_detail)) : null));
  }

  render(h('div', { class: 'wrap split' }, left,
    h('div', { class: 'col-right', style: { gap: '24px' } }, alerts,
      h('ol', { class: 'paper steps', 'aria-label': 'Этапы проверки' },
        steps.map((st) => h('li', { class: st.s === 'warn' ? 'cur' : st.s, 'aria-current': st.s === 'cur' ? 'step' : null },
          h('span', { class: 'dot' }, st.s === 'done' ? '✓' : st.s === 'fail' || st.s === 'warn' ? '!' : st.s === 'skip' ? '–' : st.s === 'cur' ? h('span', { class: 'spin', 'aria-hidden': 'true' }) : String(st.n)),
          h('span', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' } },
            h('span', { class: 'name' }, st.name), h('span', { class: 'detail' }, st.detail))))))));
}

async function retry(id) {
  try { const r = await api(`api/runs/${id}/retry`, { method: 'POST' }); location.hash = `#/runs/${r.run_id}`; }
  catch (e) { toast(e.message); }
}

// ---------- результат
async function viewResult(run) {
  let res;
  try { res = await api(`api/runs/${run.id}/result`); }
  catch (e) { return render(notFound('Не удалось загрузить результат', e.message)); }
  setTitle(res.passport.document_title);
  const ui = { tab: 'doc', sev: 'all', crit: 'all', sel: null, showAllRequirements: !!res.partial };
  const findings = [...res.findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  findings.forEach((f, i) => { f._n = i + 1; });
  (res.unverified_findings || []).forEach((f, i) => { f._n = f.id || `U-${i + 1}`; });
  const byId = Object.fromEntries(findings.map((f) => [f.id, f]));
  const reqById = Object.fromEntries(res.requirements.map((r) => [r.id, r]));
  const marks = buildMarks(res.document.text || '', findings);
  const counts = { all: findings.length };
  for (const s of Object.keys(SEV)) counts[s] = findings.filter((f) => f.severity === s).length;
  // каждая находка показывается в одной вкладке: у требования — только «свои», связи между требованиями — в наборе
  const setFindings = findings.filter((f) => f.scope !== 'requirement' || !f.req_id);
  const reqFindings = (rid) => findings.filter((f) => f.req_id === rid && !setFindings.includes(f));
  const criteriaUsed = [...new Map(findings.map((f) => [f.criterion, f.criterion_label || f.criterion])).entries()];

  const root = h('div', { class: 'wrap stack' });
  const visible = () => findings.filter((f) => (ui.sev === 'all' || f.severity === ui.sev) && (ui.crit === 'all' || f.criterion === ui.crit));

  function draw(scrollTo) {
    const vis = visible();
    if (ui.sel && !vis.some((f) => f.id === ui.sel)) ui.sel = null;
    if (!ui.sel && vis.length && ui.tab === 'doc') ui.sel = vis[0].id;
    const oldDoc = root.querySelector('.doc');
    const keepScroll = oldDoc ? oldDoc.scrollTop : 0;
    fill(root,
      run.cancel_outcome === 'completed_before_cancel' ? h('div', { class: 'note green' }, 'Завершилось до отмены.') : null,
      res.partial ? h('div', { class: 'alert', role: 'status' },
        h('span', { class: 'code' }, `ПРОВЕРЕНО ${res.summary.requirements_checked ?? 0} ИЗ ${res.summary.requirements_total}`),
        h('span', { class: 't' }, 'Проверка не завершена'),
        h('p', null, `${(res.verdict.incomplete_reasons || ['прогон помечен как неполный']).join('; ')}. `,
          'Непроверенные требования отмечены во вкладке «Требования». Вывод о готовности к разработке делать нельзя.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => retry(run.id) }, 'Запустить проверку заново'))) : null,
      resultHead(res, run),
      tilesBar(),
      tabsBar(),
      h('section', { role: 'tabpanel', id: `panel-${ui.tab}`, 'aria-labelledby': `tab-${ui.tab}`, tabindex: '0' },
        ui.tab === 'doc' ? docTab(vis) : null,
        ui.tab === 'reqs' ? reqsTab() : null,
        ui.tab === 'set' ? setTab() : null,
        ui.tab === 'code' ? codeTab() : null,
        ui.tab === 'trace' ? traceTab() : null,
        ui.tab === 'questions' ? questionsTab() : null,
        ui.tab === 'unverified' ? unverifiedTab() : null,
        ui.tab === 'passport' ? passportTab() : null),
    );
    const newDoc = root.querySelector('.doc');
    if (newDoc && keepScroll) newDoc.scrollTop = keepScroll;
    if (scrollTo) requestAnimationFrame(() => scrollToMark(scrollTo));
  }

  function tilesBar() {
    const t = (id, num, label, color) => h('button', { type: 'button', class: 'tile', 'aria-pressed': String(ui.sev === id), onclick: () => { ui.sev = id; ui.sel = null; if (!['doc', 'reqs', 'set', 'questions'].includes(ui.tab)) ui.tab = 'doc'; draw(); } },
      h('b', { style: { color } }, res.partial ? '—' : String(num)), h('span', null, label));
    return h('div', { class: 'tiles', role: 'group', 'aria-label': 'Фильтр по серьёзности' },
      t('all', counts.all, 'все замечания', 'var(--ink)'),
      t('critical', counts.critical, SEV.critical.many, 'var(--crit)'),
      t('major', counts.major, SEV.major.many, 'var(--major)'),
      t('minor', counts.minor, SEV.minor.many, 'var(--minor)'));
  }

  function tabsBar() {
    const tabs = [['doc', 'Документ с пометками', null], ['reqs', 'Требования', res.requirements.length], ['set', 'Набор целиком', setFindings.length],
      ['code', 'ТЗ ↔ код', (res.code_checks || []).length || null], ['trace', 'Трассировка', (res.traceability_matrix || []).length || null],
      ['questions', 'Вопросы к автору', res.questions.length], ['unverified', 'Неподтверждённые выводы', (res.unverified_findings || []).length], ['passport', 'Паспорт', null]];
    const activate = (id) => { ui.tab = id; draw(); requestAnimationFrame(() => root.querySelector(`#tab-${CSS.escape(id)}`)?.focus()); };
    return h('div', null,
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Разделы отчёта' }, tabs.map(([id, label, cnt], index) => h('button', {
        type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'aria-selected': String(ui.tab === id),
        tabindex: ui.tab === id ? '0' : '-1', onclick: () => activate(id), onkeydown: (e) => {
          const current = tabs.findIndex((item) => item[0] === id);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : e.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length : e.key === 'ArrowRight' ? (current + 1) % tabs.length : -1;
          if (next >= 0) { e.preventDefault(); activate(tabs[next][0]); }
        } },
        label, cnt !== null && cnt !== undefined ? h('span', { class: 'cnt' }, String(cnt)) : null))),
      ['doc', 'reqs', 'set', 'questions'].includes(ui.tab) ? h('div', { class: 'filterbar', style: { paddingTop: '14px' } },
        h('span', { class: 'small muted' }, 'Фильтр применяется к: замечаниям на полях, набору, требованиям, вопросам'),
        criteriaUsed.length > 1 ?
        h('label', null, 'Критерий: ', h('select', { onchange: (e) => { ui.crit = e.target.value; ui.sel = null; draw(); } },
          h('option', { value: 'all' }, 'все критерии'),
          criteriaUsed.map(([code, label]) => h('option', { value: code, selected: ui.crit === code }, label)))) : null,
        ui.sev !== 'all' || ui.crit !== 'all' ? h('button', { type: 'button', class: 'btn-link', onclick: () => { ui.sev = 'all'; ui.crit = 'all'; draw(); } }, 'Сбросить фильтры') : null) : null);
  }

  function docTab(vis) {
    const visIds = new Set(vis.map((f) => f.id));
    const article = renderDoc(res.document.text || '', marks, visIds, ui.sel, byId, (fid) => { ui.sel = fid; draw(); scrollCard(fid); });
    const aside = h('aside', { class: 'margin', 'aria-label': 'Замечания на полях' },
      h('span', { class: 'margin-head' }, 'Замечания на полях'),
      vis.length ? vis.map((f) => f.id === ui.sel ? findingCard(f, { id: `card-${f.id}` })
        : h('button', { type: 'button', class: 'fnd', id: `card-${f.id}`, 'aria-pressed': 'false', onclick: () => { ui.sel = f.id; draw(f.id); } },
          h('span', { class: `num sev-${f.severity}` }, String(f._n)), h('span', { class: 'tt' }, f.title || f.defect)))
        : h('div', { class: 'empty' }, h('b', null, findings.length ? 'Под фильтр ничего не попало.' : res.partial ? 'Замечаний нет — но проверка не завершена.' : 'Поля чистые.'),
          h('span', { class: 'muted' }, findings.length ? 'Сбросьте фильтр по серьёзности или критерию.'
            : res.partial ? `Агент проверил ${res.summary.requirements_checked ?? 0} из ${res.summary.requirements_total} требований. Отсутствие замечаний не означает, что документ готов.`
              : `Все ${res.summary.requirements_total} требований однозначны, проверяемы и не противоречат друг другу.`)));
    return h('div', { class: 'doc-split' }, article, aside);
  }

  function findingCard(f, extra = {}) {
    const req = f.req_id ? reqById[f.req_id] : null;
    return h('div', { class: 'fcard', ...extra },
      h('span', { class: `num bg-${f.severity}` }, String(f._n)),
      h('div', { class: 'body' },
        h('span', { class: 'meta' }, h('span', { class: `sev sev-${f.severity}` }, SEV[f.severity].label),
          ' · ', shortLocation(f.location) || (req ? `${req.id} ${req.doc_id}` : 'набор требований')),
        h('span', { class: 'tt' }, f.title || f.defect),
        f.defect && f.title ? h('p', { class: 'tx' }, f.defect) : null,
        [f.quote, ...(f.quotes || [])].map((q) => h('p', { class: 'qq' }, String(q).replace(/\*\*|`/g, ''))),
        f.fix_kind === 'decision' ? h('p', { class: 'fix' }, h('b', null, 'Требует решения владельца. '), f.fix || '') : (f.fix ? h('p', { class: 'fix' }, f.fix) : null),
        f.question ? h('p', { class: 'q' }, h('b', null, 'Вопрос автору: '), f.question) : null,
        f.code_ref ? h('span', { class: 'small' }, 'Код: ', f.code_ref.url ? h('a', { href: f.code_ref.url, target: '_blank', rel: 'noopener' }, `${f.code_ref.path}${f.code_ref.line ? ':' + f.code_ref.line : ''}`) : f.code_ref.path) : null,
        h('span', { class: 'crit' }, [f.id, (f.criteria || [f.criterion]).map((code) => (state.meta?.criteria || []).find((c) => c.code === code)?.label || code).join(', '), f.source, f.quote_verified === false ? 'цитата не подтверждена' : null].filter(Boolean).join(' · ')),
        reviewerActions(f),
        ui.tab !== 'doc' ? h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn-link', onclick: () => { ui.tab = 'doc'; ui.sev = 'all'; ui.crit = 'all'; ui.sel = f.id; draw(f.id); } }, 'Показать в документе')) : null));
  }

  function reviewerActions(f) {
    const current = (res.reviewer_decisions || {})[f.id] || {};
    const comment = h('input', { type: 'text', value: current.comment || '', placeholder: 'Комментарий ревьюера', 'aria-label': `Комментарий к ${f.id}` });
    const labels = { confirmed: 'Подтвердить', rejected: 'Отклонить', duplicate: 'Дубль', fixed: 'Исправлено' };
    return h('div', { class: 'review-actions' },
      h('div', { class: 'row' }, Object.entries(labels).map(([decision, label]) => h('button', {
        type: 'button', class: current.decision === decision ? 'btn' : 'btn-ghost', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const answer = await api(`api/runs/${run.id}/findings/${f.id}/decision`, { method: 'POST', json: { decision, comment: comment.value } });
            res.reviewer_decisions ||= {}; res.reviewer_decisions[f.id] = answer.reviewer_decision; draw(); toast('Решение сохранено');
          } catch (x) { toast(x.message); e.target.disabled = false; }
        }
      }, label))), comment);
  }

  function scrollToMark(fid) {
    const m = root.querySelector(`mark[data-fid="${CSS.escape(fid)}"]`);
    const doc = root.querySelector('.doc');
    if (m && doc) {
      let y = 0; let el = m;
      while (el && el !== doc) { y += el.offsetTop; el = el.offsetParent; }
      if (el !== doc) y = m.getBoundingClientRect().top - doc.getBoundingClientRect().top + doc.scrollTop;
      doc.scrollTop = Math.max(0, y - doc.clientHeight / 3);
      if (narrow()) { doc.scrollIntoView({ block: 'start' }); return; }
    }
    scrollCard(fid);
  }
  function scrollCard(fid) {
    requestAnimationFrame(() => {
      const c = root.querySelector(`#card-${CSS.escape(fid)}`);
      if (!c) return;
      const r = c.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function reqsTab() {
    const open = new Set(ui.openReqs || []);
    const rows = [];
    const matching = visible();
    for (const r of res.requirements) {
      const fs = reqFindings(r.id).filter((f) => matching.includes(f));
      const linked = setFindings.filter((f) => f.req_id === r.id && matching.includes(f));
      const all = [...fs, ...linked];
      if (!ui.showAllRequirements && !all.length) continue;
      const worst = all.length ? all.reduce((a, b) => (SEV_ORDER[a.severity] <= SEV_ORDER[b.severity] ? a : b)).severity : null;
      const toggle = () => { open.has(r.id) ? open.delete(r.id) : open.add(r.id); ui.openReqs = [...open]; draw(); };
      const has = fs.length || linked.length;
      rows.push(h('tr', { class: has ? 'click' : null, onclick: has ? toggle : null },
        h('td', { class: 'id' }, has ? h('button', { type: 'button', class: 'btn-link', style: { minHeight: 0, color: 'var(--ink)' }, 'aria-expanded': String(open.has(r.id)), onclick: (e) => { e.stopPropagation(); toggle(); } }, (open.has(r.id) ? '− ' : '+ ') + r.id) : r.id),
        h('td', { class: 'id' }, r.doc_id || '—'),
        h('td', null, h('div', null, r.summary), h('div', { class: 'small muted' }, r.section || '')),
        h('td', null, h('div', { class: 'chips' }, fs.length ? Object.keys(SEV).map((s) => {
          const n = fs.filter((f) => f.severity === s).length; return n ? h('span', { class: `pill ${s}` }, `${n} ${SEV[s].many}`) : null;
        }) : (r.status === 'not_checked' || r.check_status === 'not_checked') ? h('span', { class: 'small muted' }, '—') : h('span', { class: 'pill ok' }, 'нарушений нет'),
        linked.length ? h('span', { class: 'pill grey' }, `+${linked.length} в наборе`) : null)),
        h('td', null, (r.status === 'not_checked' || r.check_status === 'not_checked') && !worst ? h('span', { class: 'pill grey' }, 'Не проверено')
          : worst ? h('span', { class: `sev-${worst}`, style: { fontWeight: 700, fontSize: '14px' } }, worst === 'critical' ? 'не готово' : 'с замечаниями')
            : h('span', { class: 'small muted' }, 'готово'))));
      if (open.has(r.id)) rows.push(h('tr', null, h('td', { colspan: '5', style: { paddingTop: 0 } },
        h('p', { class: 'small', style: { margin: '0 0 8px', color: 'var(--ink-2)' } }, h('b', null, 'Цитата: '), `«${r.quote}»`),
        fs.map((f) => findingCard(f)),
        linked.length ? h('div', { class: 'small', style: { padding: '12px 0' } }, h('span', { class: 'muted' }, 'Связано с другими требованиями (вкладка «Набор целиком»): '),
          linked.map((f, i) => [i ? ', ' : '', h('button', { type: 'button', class: 'btn-link', style: { minHeight: 0 }, onclick: (e) => { e.stopPropagation(); ui.tab = 'doc'; ui.sev = 'all'; ui.crit = 'all'; ui.sel = f.id; draw(f.id); } }, `${f.id} ${f.title}`)])) : null)));
    }
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Как агент нарезал документ: ID в отчёте, ID в документе и краткая формулировка. Если номера в документе не было — агент присвоил свой и сохранил цитату.'),
      h('label', { class: 'check', style: { maxWidth: '320px' } }, h('input', { type: 'checkbox', checked: ui.showAllRequirements, onchange: (e) => { ui.showAllRequirements = e.target.checked; draw(); } }),
        h('span', { class: 't' }, 'Показать все требования')),
      h('div', { class: 'tbox' }, h('table', { class: 'data', style: { minWidth: '820px' } },
        h('thead', null, h('tr', null, ['ID в отчёте', 'ID в документе', 'Формулировка', 'Замечания', 'Статус'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows))));
  }

  function setTab() {
    const vis = visible().filter((f) => setFindings.includes(f));
    if (res.set_check_status === 'not_checked') return h('div', { class: 'empty' }, h('b', null, 'Не проверено.'), h('span', { class: 'muted' }, 'Проверка набора не выполнялась.'));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '900px' } },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Замечания ко всему набору: противоречия между требованиями, пропуски, единицы измерения, термины, оформление документа (ISO/IEC/IEEE 29148, п. 5.2.6; IEEE 830, п. 4.3).'),
      vis.length ? vis.map((f) => findingCard(f)) : h('div', { class: 'empty' }, h('b', null, 'Нарушений в наборе нет.')));
  }

  function codeTab() {
    if (!res.passport.gitlab) {
      return h('div', { class: 'empty', style: { maxWidth: '640px' } }, h('b', null, 'Сверка с кодом не выполнялась.'),
        h('span', { class: 'muted' }, 'Проект GitLab не был выбран. Подключите проект и запустите проверку заново — агент сверит методы API, параметры и поля БД из ТЗ с кодом.'),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/gitlab' }, 'Подключить GitLab')));
    }
    const st = { match: ['совпадает', 'ok'], mismatch: ['расходится', 'major'], missing: ['не найдено', 'critical'] };
    const codeFindings = findings.filter((f) => f.scope === 'code');
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } },
      h('p', { class: 'muted', style: { margin: 0 } }, `Проект ${res.passport.gitlab.project}, ветка ${res.passport.gitlab.ref}. Агент читал код только на чтение.`),
      (res.code_checks || []).length ? h('div', { class: 'tbox' }, h('table', { class: 'data', style: { minWidth: '760px' } },
        h('thead', null, h('tr', null, ['Что в ТЗ', 'Тип', 'Статус', 'Где в коде', 'Комментарий'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, res.code_checks.map((c) => h('tr', null,
          h('td', { class: 'id' }, c.item),
          h('td', { class: 'small muted' }, { endpoint: 'метод API', db_field: 'поле БД', param: 'параметр', project: 'проект' }[c.kind] || c.kind),
          h('td', null, h('span', { class: `pill ${(st[c.status] || ['', 'grey'])[1]}` }, (st[c.status] || [c.status])[0])),
          h('td', { class: 'small' }, c.code_ref ? (c.code_ref.url ? h('a', { href: c.code_ref.url, target: '_blank', rel: 'noopener' }, `${c.code_ref.path}${c.code_ref.line ? ':' + c.code_ref.line : ''}`) : c.code_ref.path) : '—'),
          h('td', { class: 'small' }, c.note || '')))))) : h('div', { class: 'empty' }, h('b', null, 'Агент не нашёл в ТЗ элементов для сверки с кодом.')),
      codeFindings.length ? [h('h2', { class: 'h3' }, 'Замечания по сверке'), codeFindings.map((f) => findingCard(f))] : null);
  }

  function traceTab() {
    if (res.set_check_status === 'not_checked') return h('div', { class: 'empty' }, h('b', null, 'Не проверено.'), h('span', { class: 'muted' }, 'Трассировка и покрытие критериями приёмки не проверялись.'));
    const matrix = res.traceability_matrix || [];
    const value = (row, ...keys) => keys.map((key) => row?.[key]).find((item) => item !== undefined && item !== null) ?? '—';
    const list = (item) => Array.isArray(item) ? item.join(', ') : (item || '—');
    const missing = matrix.filter((row) => {
      const acceptance = value(row, 'acceptance_criteria', 'acceptance_ids', 'criteria', 'acceptance');
      return acceptance === '—' || (Array.isArray(acceptance) && !acceptance.length);
    });
    const matrixRows = matrix.map((row) => h('tr', null,
      h('td', null, list(value(row, 'goal', 'goal_id', 'objective'))),
      h('td', null, list(value(row, 'requirements', 'requirement_ids', 'requirement'))),
      h('td', null, list(value(row, 'acceptance_criteria', 'acceptance_ids', 'criteria', 'acceptance'))),
      h('td', null, list(value(row, 'api', 'api_ids', 'endpoints', 'api_refs'))),
      h('td', null, list(value(row, 'status', 'coverage_status')))));
    return h('div', { class: 'stack' },
      matrix.length ? h('div', { class: 'tbox' }, h('table', { class: 'data', style: { minWidth: '900px' } },
        h('thead', null, h('tr', null, ['Цель', 'Требования', 'Критерии приёмки', 'API', 'Статус'].map((title) => h('th', { scope: 'col' }, title)))),
        h('tbody', null, matrixRows))) : h('div', { class: 'empty' }, h('b', null, 'Матрица трассировки не сформирована.')),
      h('h2', { class: 'h3' }, 'Требования без критериев приёмки'),
      missing.length ? h('ul', null, missing.map((row) => h('li', null, list(value(row, 'requirements', 'requirement_ids', 'requirement'))))) : h('p', { class: 'muted' }, 'Таких требований нет.'),
      (res.test_cases || []).length ? [h('h2', { class: 'h3' }, 'Тест-кейсы'), h('ol', null, res.test_cases.map((item) => h('li', null, item.title || item.name || item.id || JSON.stringify(item))))] : null);
  }

  function unverifiedTab() {
    const items = res.unverified_findings || [];
    return h('div', { class: 'stack' },
      h('div', { class: 'note' }, h('b', null, 'Не влияют на вердикт. '), 'Цитаты этих выводов не удалось дословно подтвердить в документе.'),
      items.length ? items.map((finding) => findingCard(finding)) : h('div', { class: 'empty' }, h('b', null, 'Неподтверждённых выводов нет.')));
  }

  function questionsTab() {
    const visibleIds = new Set(visible().map((f) => f.id));
    const qs = (res.questions || []).filter((q) => (q.finding_ids || []).some((id) => visibleIds.has(id)));
    const title = res.passport.document_title;
    const letterText = () => [`Здравствуйте! Перед передачей ТЗ «${title}» в разработку прошу уточнить:`, '',
      ...qs.map((q, i) => `${i + 1}. ${q.text}`), '', 'Подробный отчёт с цитатами — во вложении.'].join('\n');
    if (!qs.length) return h('div', { class: 'empty' }, h('b', null, 'Вопросов к автору нет.'), h('span', { class: 'muted' }, 'Формулировки не оставляют места для догадок.'));
    return h('section', { class: 'letter', 'aria-labelledby': 'letter-h' },
      h('div', { class: 'l' },
        h('h2', { class: 'h2', id: 'letter-h' }, 'Письмо автору ТЗ'),
        h('p', { class: 'muted', style: { margin: 0 } }, 'Вопросы, без ответа на которые разработчик будет додумывать сам.'),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { type: 'button', class: 'btn', onclick: () => copyText(letterText()) }, 'Скопировать письмо'))),
      h('div', { class: 'paper' },
        h('span', null, `Здравствуйте! Перед передачей ТЗ «${title}» в разработку прошу уточнить:`),
        h('ol', null, qs.map((q) => h('li', null, q.text, ' ',
          h('span', { class: 'refs' }, (q.finding_ids || []).map((id) => byId[id] ? `${id}` : null).filter(Boolean).join(', '))))),
        h('span', { class: 'muted' }, 'Подробный отчёт с цитатами — во вложении.')));
  }

  function passportTab() {
    const p = res.passport;
    const cu = p.coverage_units || {};
    const coverage = (cu.covered ?? cu.covered_units) !== undefined
      ? `${cu.covered ?? cu.covered_units} из ${cu.total ?? cu.total_units} фрагментов`
      : (p.coverage_percent !== undefined && p.coverage_percent !== null ? `${p.coverage_percent}%` : '—');
    const rows = [['Документ', p.document_title], ['Файл', p.file_name], ['Дата прогона', p.date ? fmtDate(p.date) : '—'],
      ['Запрошенная модель', p.requested_model || p.model], ['Фактически использована', p.actual_model || p.model],
      ['Режим', p.mode || run.mode], ['Модели по шагам', Object.entries(p.models_by_step || {}).map(([step, model]) => `${step}: ${model}`).join('; ') || '—'],
      ['Переходы fallback', (p.model_trace || []).filter((x) => x.result === 'fallback' || x.result === 'skipped').map((x) => `${x.model}: ${x.reason}`).join('; ') || 'не было'],
      ['LLM-вызовы', String(p.llm_calls ?? '—')], ['Попадания в кэш', String(p.cache_hits ?? '—')],
      ['Длительность', p.duration_seconds == null ? '—' : `${p.duration_seconds} с`], ['Покрытие', coverage],
      ['Неподтверждённые', String((res.unverified_findings || []).length)],
      ['Версия агента', p.agent_version], ['Критерии', (p.criteria || []).map((c) => (state.meta?.groups || []).find((g) => g.id === c)?.label || c).join('; ')],
      ['Проект GitLab', p.gitlab ? `${p.gitlab.project} @ ${p.gitlab.ref}` : 'не подключался'],
      ['Отброшено находок без цитаты', String(p.dropped_findings ?? 0)], ['Тип работы', run.options?.work_type || '—']];
    const fixFirst = (res.verdict.fix_first || []).map((id) => byId[id]).filter(Boolean);
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '900px' } },
      h('div', { class: 'kv' }, rows.map(([k, v]) => [h('div', null, k), h('div', null, v || '—')])),
      fixFirst.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('h2', { class: 'h3' }, 'Исправить в первую очередь'),
        h('ol', { style: { margin: 0, paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '6px' } },
          fixFirst.map((f) => h('li', null, h('button', { type: 'button', class: 'btn-link', style: { minHeight: 0, fontSize: '16px', textAlign: 'left' }, onclick: () => { ui.tab = 'doc'; ui.sev = 'all'; ui.crit = 'all'; ui.sel = f.id; draw(f.id); } }, `${f.id} — ${f.title}`),
            f.fix ? h('div', { class: 'small muted' }, f.fix) : null)))) : null,
      (res.warnings || []).length ? h('div', { class: 'note' }, h('b', null, 'Предупреждения прогона: '), res.warnings.map((w) => w.message).join('; ')) : null,
      res.changes?.previous_run_id ? h('div', { class: 'note' }, h('b', null, 'Изменения: '),
        `исправлено — ${(res.changes.fixed || []).length}; новые — ${(res.changes.new || []).length}; остались — ${(res.changes.remaining || []).length}.`) : null,
      h('div', { class: 'row' }, h('a', { class: 'btn-ghost', href: `api/runs/${run.id}/report.md`, target: '_blank', rel: 'noopener' }, 'Открыть report.md')));
  }

  draw();
  render(root);
}

const narrow = () => window.matchMedia('(max-width: 720px)').matches;
// «Часть A → Требования к изменениям → Функциональные требования → Ф-2» → «Функциональные требования → Ф-2»
function shortLocation(loc) {
  return loc ? String(loc).split(' → ').slice(-2).join(' → ') : '';
}

function resultHead(res, run) {
  const v = res.verdict;
  const crit = res.summary.by_severity?.critical || 0;
  const stamp = {
    not_ready: ['НА ДОРАБОТКУ', 'var(--crit)', `${crit} ${plural(crit, 'КРИТИЧНЫЙ ДЕФЕКТ', 'КРИТИЧНЫХ ДЕФЕКТА', 'КРИТИЧНЫХ ДЕФЕКТОВ')}`],
    ready_with_notes: ['С ЗАМЕЧАНИЯМИ', 'var(--major)', 'КРИТИЧНЫХ НЕТ'],
    ready: ['К РАЗРАБОТКЕ', 'var(--green-ink)', 'ЗАМЕЧАНИЙ НЕТ'],
  }[v.status] || ['НЕ ЗАВЕРШЕНО', 'var(--minor)', `ПРОВЕРЕНО ${res.summary.requirements_checked ?? 0} ИЗ ${res.summary.requirements_total}`];
  if (res.partial && v.status === 'not_ready') stamp[2] = 'ПРОВЕРКА НЕПОЛНАЯ';
  const gl = res.passport.gitlab;
  return h('div', { class: 'res-head' },
    h('div', { class: 'l' },
      h('span', { class: 'eyebrow grey' }, [res.passport.file_name, gl ? `${gl.project}@${gl.ref}` : null, fmtDate(res.passport.date || run.finished_at),
        res.partial ? `проверено ${res.summary.requirements_checked ?? 0} из ${res.summary.requirements_total} требований`
          : `${res.summary.requirements_total} ${plural(res.summary.requirements_total, 'требование', 'требования', 'требований')}`].filter(Boolean).join(' · ')),
      h('h1', { class: 'h1' }, res.passport.document_title),
      h('p', null, v.text || '')),
    h('div', { class: 'r' },
      h('div', { class: 'stamp', role: 'img', 'aria-label': `Вердикт: ${stamp[0]}`, style: { color: stamp[1] } }, h('b', null, stamp[0]), h('span', null, stamp[2])),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('a', { class: 'btn', href: `api/runs/${run.id}/report.md?download=1` }, 'Скачать отчёт .md'),
        h('a', { class: 'btn-ghost', href: '#/', style: { justifyContent: 'center', minHeight: '48px' } }, 'Новое ТЗ'))));
}

// ---------- пометки в тексте документа
function normIndex(text) {
  const TR = { '«': '"', '»': '"', '“': '"', '”': '"', '„': '"', 'ё': 'е', 'Ё': 'е', '–': '-', '—': '-', ' ': ' ', ' ': ' ' };
  const out = []; const idx = []; let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === '*' || c === '`') continue;
    c = TR[c] ?? c;
    if (/\s/.test(c)) { if (prevSpace) continue; c = ' '; prevSpace = true; } else prevSpace = false;
    out.push(c.toLowerCase()); idx.push(i);
  }
  return { s: out.join(''), idx };
}
function normQuote(q) {
  return normIndex(q).s.trim();
}
function locate(text, ni, quote) {
  if (!quote || !quote.trim()) return null;
  const p = text.indexOf(quote);
  if (p >= 0) return [p, p + quote.length];
  const nq = normQuote(quote);
  if (!nq) return null;
  const k = ni.s.indexOf(nq);
  if (k < 0) return null;
  return [ni.idx[k], ni.idx[k + nq.length - 1] + 1];
}
function buildMarks(text, findings) {
  const ni = normIndex(text);
  const marks = [];
  for (const f of findings) {
    [f.quote, ...(f.quotes || [])].forEach((q, qi) => {
      const r = locate(text, ni, q);
      if (r) marks.push({ start: r[0], end: r[1], fid: f.id, sev: f.severity, primary: qi === 0 });
    });
  }
  return marks;
}

function renderDoc(text, marks, visIds, sel, byId, onPick) {
  const art = h('article', { class: 'paper doc', 'aria-label': 'Документ с пометками', tabindex: '0' });
  const active = marks.filter((m) => visIds.has(m.fid));
  const firstMark = new Set();
  // текст → строки с позициями
  const lines = []; let pos = 0;
  for (const raw of text.split('\n')) { lines.push({ start: pos, end: pos + raw.length, raw }); pos += raw.length + 1; }

  function segments(a, b) {
    const pts = new Set([a, b]);
    for (const m of active) { if (m.end > a && m.start < b) { pts.add(Math.max(a, m.start)); pts.add(Math.min(b, m.end)); } }
    const arr = [...pts].sort((x, y) => x - y); const out = [];
    for (let i = 0; i < arr.length - 1; i++) {
      const s = arr[i], e = arr[i + 1]; if (e <= s) continue;
      const cover = active.filter((m) => m.start < e && m.end > s)
        .sort((x, y) => (x.fid === sel ? -1 : y.fid === sel ? 1 : SEV_ORDER[x.sev] - SEV_ORDER[y.sev]));
      const piece = text.slice(s, e).replace(/\*\*|`/g, '');
      if (!piece) continue;
      if (!cover.length) { out.push(document.createTextNode(piece)); continue; }
      const m = cover[0];
      const f = byId[m.fid];
      const el = h('mark', { class: `${m.sev}${cover.some((c) => c.fid === sel) ? ' on' : ''}`, 'data-fid': cover.some((c) => c.fid === sel) ? sel : m.fid, title: f ? `${f._n}. ${f.title}` : '' }, piece);
      el.addEventListener('click', () => onPick(cover.some((c) => c.fid === sel) && cover.length > 1 ? cover.find((c) => c.fid !== sel).fid : m.fid));
      out.push(el);
      for (const c of cover) {
        if (c.primary && c.end === e && !firstMark.has(c.fid) && byId[c.fid]) {
          firstMark.add(c.fid);
          out.push(h('sup', { class: c.sev }, String(byId[c.fid]._n)));
        }
      }
    }
    return out;
  }

  let i = 0; let inCode = false;
  while (i < lines.length) {
    const ln = lines[i];
    const t = ln.raw.trim();
    if (t.startsWith('```')) { inCode = !inCode; i++; continue; }
    if (inCode) { art.append(h('p', { class: 'ln code' }, segments(ln.start, ln.end))); i++; continue; }
    if (!t) { art.append(h('div', { class: 'ln blank' })); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { art.append(h('hr', { style: { border: 0, borderTop: '1px solid var(--line-2)', margin: '12px 0' } })); i++; continue; }
    if (/^\s*\|/.test(ln.raw)) { // таблица
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i].raw)) { rows.push(lines[i]); i++; }
      const table = h('table');
      let headerDone = false;
      rows.forEach((r, ri) => {
        if (/^\s*\|[\s:|-]+\|?\s*$/.test(r.raw)) return;
        const isHead = !headerDone && rows[ri + 1] && /^\s*\|[\s:|-]+\|?\s*$/.test(rows[ri + 1].raw);
        headerDone = true;
        const tr = h('tr');
        const pipes = []; for (let k = 0; k < r.raw.length; k++) if (r.raw[k] === '|' && r.raw[k - 1] !== '\\') pipes.push(k);
        for (let k = 0; k < pipes.length - 1; k++) {
          const a = r.start + pipes[k] + 1, b = r.start + pipes[k + 1];
          tr.append(h(isHead ? 'th' : 'td', null, segments(a, b)));
        }
        table.append(tr);
      });
      art.append(h('div', { class: 'tbl' }, table));
      continue;
    }
    const hm = ln.raw.match(/^(\s*)(#{1,6})\s+/);
    if (hm) { art.append(h('p', { class: `ln hd l${hm[2].length}` }, segments(ln.start + hm[0].length, ln.end))); i++; continue; }
    const bm = ln.raw.match(/^(\s*)([*\-•]|\d+\.)\s+/);
    if (bm && !/^\d+\./.test(bm[2])) { art.append(h('p', { class: 'ln li' }, segments(ln.start + bm[0].length, ln.end))); i++; continue; }
    art.append(h('p', { class: 'ln' }, segments(ln.start, ln.end)));
    i++;
  }
  if (!text.trim()) art.append(h('p', { class: 'muted' }, 'Текст документа не передан конвейером.'));
  return art;
}

// ================================================================== 3. История
async function viewHistory() {
  setTitle('История');
  const root = h('div', { class: 'wrap stack' });
  render(root);
  async function draw() {
    let items;
    try { items = await api('api/runs'); } catch (e) { fill(root, notFound('Не удалось загрузить историю', e.message)); return; }
    const running = items.filter((r) => r.status === 'running' || r.status === 'queued').length;
    fill(root, 
      h('div', { class: 'res-head' },
        h('div', { class: 'l' }, h('span', { class: 'greenbar' }), h('h1', { class: 'h1' }, 'История проверок'),
          h('p', null, 'Все проверки ТЗ этого сервиса. Результаты сохраняются на диске и доступны после перезапуска сервера.')),
        h('div', { class: 'r' }, h('a', { class: 'btn', href: '#/' }, svg('M12 5v14M5 12h14', 20), 'Проверить ТЗ'))),
      items.length ? h('div', { class: 'paper tbox', style: { padding: '8px 32px' } }, h('table', { class: 'data', style: { minWidth: '960px' } },
        h('thead', null, h('tr', null, ['Документ', 'Проект GitLab', 'Дата', 'Вердикт', 'Дефекты', ''].map((t) => h('th', { scope: 'col' }, t || h('span', { class: 'sr' }, 'Действия'))))),
        h('tbody', null, items.map(historyRow))))
        : h('div', { class: 'paper card' }, h('b', { style: { fontSize: '24px' } }, 'Проверок пока нет.'),
          h('span', { class: 'muted' }, 'Загрузите первое ТЗ — агент найдёт двусмысленные, непроверяемые и противоречивые формулировки.'),
          h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/' }, 'Проверить ТЗ'))));
    return running;
  }
  await loadProjects();
  const running = await draw();
  every(2000, async () => { const n = await draw(); if (!n) clearTimers(); });
  if (!running) clearTimers();
}

function historyRow(r) {
  const go = `#/runs/${r.id}`;
  const verdict = {
    not_ready: h('span', { class: 'pill critical' }, 'Не готово'),
    ready_with_notes: h('span', { class: 'pill major' }, 'С замечаниями'),
    ready: h('span', { class: 'pill ok' }, 'Готово'),
    incomplete: h('span', { class: 'pill grey' }, 'Частичный отчёт'),
  }[r.verdict];
  const running = r.status === 'running' || r.status === 'queued';
  let state_;
  if (running) {
    const st = STEPS.findIndex((s) => s.stages.includes(r.stage));
    state_ = h('td', { colspan: '2' }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '360px' } },
      h('div', { class: 'row small', style: { justifyContent: 'space-between' } }, h('span', null, `Этап ${Math.max(1, st + 1)} из 6 · ${(STEPS[st] || STEPS[0]).name.toLowerCase()}`), h('span', { class: 'muted' }, `${r.progress}%`)),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': r.progress, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Прогресс' }, h('span', { style: { width: `${r.progress}%` } }))));
  } else if (r.status === 'error' || r.status === 'cancelled') {
    state_ = h('td', { colspan: '2' }, h('span', { class: 'pill grey' }, r.status === 'error' ? `Ошибка: ${r.error?.message || ''}`.slice(0, 80) : 'Остановлена'));
  } else if (r.status === 'partial') {
    state_ = [h('td', null, h('span', { class: 'pill grey' }, 'Частичный отчёт')),
      h('td', null, h('span', { class: 'muted' }, '— / — / —'))];
  } else {
    const b = r.by_severity || {};
    state_ = [h('td', null, verdict || '—'), h('td', null, h('div', { class: 'chips' },
      Object.keys(SEV).map((s) => h('span', { class: `pill ${s}` }, `${b[s] || 0} ${SEV[s].many}`))))];
  }
  return h('tr', null,
    h('td', null, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      h('a', { href: go, style: { fontWeight: 700, color: 'var(--ink)' } }, r.title),
      h('span', { class: 'small muted' }, [r.file_name, r.options?.work_type, r.mode === 'demo' ? 'демо' : null].filter(Boolean).join(' · ')))),
    h('td', { class: r.gitlab ? 'mono small' : 'small muted' }, r.gitlab ? `${r.gitlab.path} / ${r.gitlab.ref}` : 'без сверки с кодом'),
    h('td', { class: 'small', style: { whiteSpace: 'nowrap' } }, fmtDate(r.created_at)),
    state_,
    h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
      running ? h('button', { type: 'button', class: 'btn-ghost', onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = 'Запрошена остановка…';
        await api(`api/runs/${r.id}/cancel`, { method: 'POST' }).catch((x) => toast(x.message));
      } }, 'Остановить')
        : h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
          h('a', { class: 'btn-ghost', href: go }, 'Открыть'),
          r.status === 'partial' ? h('button', { type: 'button', class: 'btn-ghost', onclick: () => retry(r.id) }, 'Повторить') : null,
          h('button', { type: 'button', class: 'btn-ghost btn-danger', 'aria-label': `Удалить проверку ${r.title}`, onclick: async () => {
            if (!confirm(`Удалить проверку «${r.title}» из истории?`)) return;
            await api(`api/runs/${r.id}`, { method: 'DELETE' }).catch((e) => toast(e.message)); viewHistory();
          } }, 'Удалить'))));
}

// ================================================================== 4. Критерии
async function viewCriteria() {
  setTitle('Критерии');
  const m = state.meta || await api('api/meta');
  render(h('div', { class: 'wrap stack' },
    h('div', { class: 'res-head' }, h('div', { class: 'l' }, h('span', { class: 'greenbar' }), h('h1', { class: 'h1' }, 'Критерии проверки'),
      h('p', null, 'По каждому критерию агент задаёт проверочный вопрос. Замечания без подтверждённой цитаты показываются отдельно и не влияют на вердикт.'))),
    h('div', { class: 'kv', style: { maxWidth: '900px' } },
      h('div', null, h('span', { class: 'pill critical' }, 'Критично')), h('div', null, 'Требование нельзя однозначно реализовать или протестировать.'),
      h('div', null, h('span', { class: 'pill major' }, 'Существенно')), h('div', null, 'Высокий риск неверной реализации.'),
      h('div', null, h('span', { class: 'pill minor' }, 'Мелко')), h('div', null, 'Стиль, оформление, термины.')),
    m.groups.map((g) => h('section', { class: 'crit-group' },
      h('h2', { class: 'h3' }, g.label), h('span', { class: 'mono small muted' }, g.source),
      h('div', null, m.criteria.filter((c) => c.group === g.id).map((c) => h('div', { class: 'crit-row' },
        h('div', null, h('div', { style: { fontWeight: 600 } }, c.label), h('div', { class: 'code' }, `${c.code} · ${c.clause || ''} · ${c.scope === 'set' ? 'набор' : 'требование'}`)),
        h('div', { style: { color: 'var(--ink-2)' } }, c.question))))))));
}

// ================================================================== 5. GitLab
async function viewGitlab() {
  setTitle('Проекты GitLab');
  const ui = state.glui || (state.glui = { search: {}, results: {}, err: '' });
  const root = h('div', { class: 'wrap stack' });
  render(root);
  let conns = [];
  async function load() {
    try { [conns] = await Promise.all([api('api/gitlab/connections'), loadProjects()]); } catch (e) { ui.err = e.message; }
  }
  async function draw() {
    const scopes = state.meta?.scopes || [];
    const urlIn = h('input', { type: 'url', value: 'https://gitlab.com', required: true, autocomplete: 'off', placeholder: 'https://gitlab.example.kz' });
    const tokIn = h('input', { type: 'password', required: true, autocomplete: 'off', placeholder: 'glpat-…', spellcheck: 'false' });
    const ferr = h('span', { class: 'formerr', role: 'alert' }, ui.err || '');
    const sub = h('button', { type: 'submit', class: 'btn' }, 'Подключить');
    const form = h('form', { class: 'paper card', onsubmit: async (e) => {
      e.preventDefault(); sub.disabled = true; ferr.textContent = '';
      try { await api('api/gitlab/connections', { method: 'POST', json: { url: urlIn.value, token: tokIn.value } }); tokIn.value = ''; ui.err = ''; toast('GitLab подключён'); await load(); draw(); }
      catch (x) { ferr.textContent = x.message; sub.disabled = false; }
    } },
    h('h2', { class: 'h3' }, 'Подключение'),
    h('label', { class: 'field' }, 'Адрес GitLab', urlIn),
    h('label', { class: 'field' }, 'Токен доступа', tokIn),
    h('div', { class: 'note' }, 'Только права ', h('b', { class: 'mono' }, 'read_api'), ' и ', h('b', { class: 'mono' }, 'read_repository'),
      '. Токен с правами на запись сервис отклонит. Токен хранится только в памяти сервера и никогда не отправляется в браузер.'),
    sub, ferr);

    const connCards = conns.map((c) => {
      const sIn = h('input', { type: 'search', placeholder: 'Найти проект', value: ui.search[c.id] || '', 'aria-label': 'Поиск проекта' });
      const list = h('div', { class: 'plist' });
      const showProjects = (items) => fill(list, ...(items.length ? items.map((p) => {
        const added = state.projects.some((x) => x.connection_id === c.id && x.gitlab_id === p.gitlab_id);
        return h('div', { class: 'it' }, h('span', null, h('span', { class: 'mono small' }, p.path), h('div', { class: 'small muted' }, p.default_branch || 'пустой репозиторий')),
          added ? h('span', { class: 'pill ok' }, 'подключён') : h('button', { type: 'button', class: 'btn-ghost', onclick: async (e) => {
            e.target.disabled = true;
            try { await api('api/gitlab/projects', { method: 'POST', json: { connection_id: c.id, gitlab_id: p.gitlab_id } }); await load(); draw(); }
            catch (x) { toast(x.message); e.target.disabled = false; }
          } }, 'Подключить'));
      }) : [h('div', { class: 'small muted', style: { padding: '12px 0' } }, 'Проектов не найдено.')]));
      const search = async () => {
        ui.search[c.id] = sIn.value; fill(list, h('div', { class: 'small muted', style: { padding: '12px 0' } }, h('span', { class: 'spin' }), ' Загружаем проекты…'));
        try { ui.results[c.id] = await api(`api/gitlab/connections/${c.id}/projects?search=${encodeURIComponent(sIn.value)}`); showProjects(ui.results[c.id]); }
        catch (x) { fill(list, h('div', { class: 'formerr', style: { padding: '12px 0' } }, x.message)); }
      };
      sIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
      if (ui.results[c.id]) showProjects(ui.results[c.id]); else search();
      return h('div', { class: 'paper card' },
        h('div', { class: 'proj-head' }, h('span', null, h('b', null, c.url), h('div', { class: 'small muted' }, `пользователь ${c.username}`)),
          h('button', { type: 'button', class: 'btn-ghost btn-danger', onclick: async () => {
            if (!confirm(`Отключить ${c.url}? Подключённые через него проекты тоже будут убраны.`)) return;
            await api(`api/gitlab/connections/${c.id}`, { method: 'DELETE' }); await load(); draw();
          } }, 'Отключить')),
        c.scopes ? h('div', { class: 'chips' }, c.scopes.map((s) => h('span', { class: 'chip' }, s))) : h('span', { class: 'small muted' }, 'Права токена GitLab не сообщил (токен группы или старая версия).'),
        h('div', { class: 'row' }, h('label', { class: 'field', style: { flex: 1 } }, h('span', { class: 'sr' }, 'Поиск'), sIn), h('button', { type: 'button', class: 'btn-ghost', onclick: search }, 'Найти')),
        list);
    });

    const projCards = () => state.projects.map((p) => h('div', { class: 'paper proj' },
      h('div', { class: 'proj-head' },
        h('span', null, h('a', { href: p.web_url, target: '_blank', rel: 'noopener', class: 'mono', style: { fontSize: '17px', fontWeight: 500, color: 'var(--ink)' } }, p.path),
          h('div', { class: 'small muted' }, `ветка по умолчанию ${p.default_branch}${p.synced_at ? ' · синхронизирован ' + fmtDate(p.synced_at) : ''}`)),
        h('span', { class: `status ${p.status}` }, p.status === 'ready' ? 'готов' : p.status === 'indexing' ? 'индексация…' : 'ошибка')),
      p.error ? h('span', { class: 'formerr' }, p.error) : null,
      p.status === 'ready' ? h('div', null, h('div', { class: 'small muted', style: { paddingBottom: '8px' } }, `Какие пути читает агент (из ${p.total_files} файлов репозитория):`),
        h('div', { class: 'cats' }, scopes.map((s) => h('div', { class: 'cat' },
          h('span', { class: 'small' }, s.label), h('b', null, String(p.counts[s.id] || 0)),
          h('div', { class: 'paths' }, (p.samples[s.id] || []).map((x) => h('div', null, x)), (p.counts[s.id] || 0) > (p.samples[s.id] || []).length ? h('div', null, '…') : null))))) : null,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn-ghost', disabled: p.status === 'indexing', onclick: async () => { await api(`api/gitlab/projects/${p.id}/sync`, { method: 'POST' }).catch((x) => toast(x.message)); await load(); draw(); } }, 'Синхронизировать'),
        h('button', { type: 'button', class: 'btn-ghost btn-danger', onclick: async () => { await api(`api/gitlab/projects/${p.id}`, { method: 'DELETE' }); await load(); draw(); } }, 'Убрать'))));

    const mainEl = h('div', { class: 'main' });
    fill(root,
      h('div', { class: 'res-head' }, h('div', { class: 'l' }, h('span', { class: 'greenbar' }), h('h1', { class: 'h1' }, 'Проекты GitLab'),
        h('p', null, 'Агент сверяет ТЗ с кодом: методы REST-контроллеров и DTO, OpenAPI, схему БД и миграции, README. Только чтение — агент не меняет код и не создаёт merge request.'))),
      h('div', { class: 'gl-grid' },
        h('div', { class: 'side' }, form, connCards),
        mainEl));
    // опрос индексации перерисовывает только список проектов — форма с токеном не трогается
    const projectsPanel = () => [h('h2', { class: 'h3' }, `Подключённые проекты · ${state.projects.length}`),
      state.projects.length ? projCards() : h('div', { class: 'paper card' }, h('b', null, 'Пока ни одного проекта.'),
        h('span', { class: 'muted' }, conns.length ? 'Выберите проект в списке слева.' : 'Подключите GitLab слева, затем выберите проект.'))];
    fill(mainEl, projectsPanel());
    if (state.projects.some((p) => p.status === 'indexing')) {
      clearTimers();
      every(1500, async () => {
        await loadProjects();
        fill(mainEl, projectsPanel());
        if (!state.projects.some((p) => p.status === 'indexing')) clearTimers();
      });
    }
  }
  await load();
  draw();
}

function notFound(title, text) {
  setTitle(title);
  return h('div', { class: 'wrap stack' }, h('div', { class: 'paper card', style: { maxWidth: '720px' } },
    h('b', { style: { fontSize: '28px' } }, title), h('span', { class: 'muted' }, text),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/' }, 'Проверить ТЗ'), h('a', { class: 'btn-ghost', href: '#/history' }, 'История'))));
}

// ------------------------------------------------------------------ старт
loadMeta().then(route);
