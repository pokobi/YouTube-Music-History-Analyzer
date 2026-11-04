// 画面の状態管理・イベント処理・ファイルの読み込み

import { html, debounce, inputToDay, formatNumber, formatDay, formatDate, todayStamp } from './util.js';
import { icon } from './icons.js';
import { parseFile } from './parser.js';
import { emptyDataset, mergeEntries, buildBackup } from './dataset.js';
import { buildModel, defaultSettings, normalizeSettings, artistKeyOf } from './model.js';
import { computeStats, computeRanks, parsePeriod, encodePeriod, periodRange, previousRange, trackDetail, artistDetail } from './stats.js';
import { getValue, setValues, clearAll, readLegacyEntries } from './store.js';
import * as V from './views.js';

const state = {
    dataset: null,
    settings: defaultSettings(),
    imports: [],
    model: null,
    stats: null,
    prev: null,
    period: { type: 'all' },
    periodLabel: '',
    tab: 'overview',
    rankType: 'songs',
    search: '',
    rankLimit: 100,
    calYear: null,
    summaryYear: null,
    discoverType: 'artists',
    detail: null, // { type: 'song'|'artist', key, limit }
    busy: false,
    searchCache: { songs: new Map(), artists: new Map() },
    summaryCache: new Map(),
};

const $ = (id) => document.getElementById(id);
const els = {};

// --- 起動 ---

async function init() {
    for (const id of ['header-controls', 'tabs', 'main', 'detail', 'toasts', 'tooltip', 'drop-overlay', 'busy', 'file-input', 'theme-btn', 'to-top', 'artist-options', 'detail-content']) {
        els[id] = $(id);
    }
    applyTheme(readTheme());
    bindEvents();
    readHash();

    try {
        const [dataset, settings, imports, meta] = await Promise.all([
            getValue('dataset'), getValue('settings'), getValue('imports'), getValue('meta'),
        ]);
        state.settings = normalizeSettings(settings);
        state.imports = Array.isArray(imports) ? imports : [];
        state.dataset = dataset && dataset.times && dataset.times.length ? dataset : null;
        if (!meta || !meta.legacyChecked) await migrateLegacy();
    } catch (err) {
        console.error(err);
        toast(`保存データを開けませんでした: ${err.message}`, 'error');
    }
    rebuild();
    render();
}

/** 旧バージョンのデータを引き継ぐ（1 回だけ） */
async function migrateLegacy() {
    const entries = await readLegacyEntries();
    if (entries && entries.length) {
        const { dataset, added } = mergeEntries(state.dataset || emptyDataset(), entries);
        state.dataset = dataset;
        state.imports = [{ name: '以前のバージョンで保存したデータ', kind: 'legacy', importedAt: Date.now(), entries: entries.length, added }, ...state.imports];
        await setValues({ dataset, imports: state.imports, meta: { legacyChecked: true } });
        toast(`以前のバージョンのデータ ${formatNumber(added)}件を引き継ぎました。`);
    } else {
        await setValues({ meta: { legacyChecked: true } });
    }
}

// --- 状態の再計算 ---

function rebuild() {
    state.searchCache = { songs: new Map(), artists: new Map() };
    state.summaryCache = new Map();
    if (!state.dataset) {
        state.model = null;
        state.stats = null;
        return;
    }
    state.model = buildModel(state.dataset, state.settings);
    if (state.summaryYear == null || !state.model.years.includes(state.summaryYear)) state.summaryYear = state.model.years[0] ?? null;
    recompute();
}

function recompute() {
    const { model, period } = state;
    if (!model) return;
    const range = periodRange(period, model);
    state.range = range;
    state.stats = computeStats(model, range);
    const prev = previousRange(period, model);
    state.prev = prev && prev.end >= model.minDay ? computeRanks(model, prev) : null;
    if (state.prev && !state.prev.total) state.prev = null;
    state.periodLabel = periodLabel();
    state.rankLimit = 100;
}

function periodLabel() {
    const p = state.period;
    const r = state.range;
    switch (p.type) {
        case 'year': return `${p.year}年の集計`;
        case 'last': return `直近 ${p.days} 日（${formatDay(r.start)} 〜 ${formatDay(r.end)}）の集計`;
        case 'custom': return `${formatDay(r.start)} 〜 ${formatDay(r.end)} の集計`;
        default: return '全期間の集計';
    }
}

// --- URL（タブと期間を保持） ---

function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const tab = params.get('tab');
    state.tab = V.TABS.some(([k]) => k === tab) ? tab : 'overview';
    state.period = parsePeriod(params.get('p'));
}

function writeHash() {
    const params = new URLSearchParams();
    if (state.tab !== 'overview') params.set('tab', state.tab);
    const p = encodePeriod(state.period);
    if (p !== 'all') params.set('p', p);
    const hash = params.toString();
    history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

// --- 描画 ---

function render() {
    const hasData = !!state.model;
    document.body.classList.toggle('has-data', hasData);
    renderHeader();
    if (!hasData) {
        els.tabs.innerHTML = '';
        els.main.innerHTML = String(V.welcomeView());
        return;
    }
    els.tabs.innerHTML = String(html`${V.TABS.map(([k, label]) => html`<button type="button" role="tab" data-action="tab" data-value="${k}" aria-selected="${k === state.tab}">${label}</button>`)}`);
    renderMain();
    writeHash();
}

function renderHeader() {
    if (!state.model || state.tab === 'summary') {
        els['header-controls'].innerHTML = '';
        return;
    }
    els['header-controls'].innerHTML = String(V.periodOptions(state));
}

function renderMain() {
    let view;
    switch (state.tab) {
        case 'ranking': view = V.rankingView(state); break;
        case 'trends': view = V.trendsView(state); break;
        case 'summary': view = V.summaryView(state, ...summaryStats()); break;
        case 'data': view = V.dataView(state); break;
        default: view = V.overviewView(state);
    }
    els.main.innerHTML = String(view);
}

function summaryStats() {
    const y = state.summaryYear;
    if (y == null) return [null, 0];
    if (!state.summaryCache.has(y)) {
        const s = computeStats(state.model, periodRange({ type: 'year', year: y }, state.model));
        const prev = computeRanks(state.model, periodRange({ type: 'year', year: y - 1 }, state.model));
        state.summaryCache.set(y, [s, prev.total]);
    }
    return state.summaryCache.get(y);
}

const updateRankingList = () => {
    const list = $('rank-list');
    if (list) list.innerHTML = String(V.rankingList(state));
};

// --- 詳細ダイアログ ---

function openDetail(type, key) {
    state.detail = { type, key, limit: 100 };
    renderDetail();
    if (!els.detail.open) {
        els.detail.showModal();
        // ダイアログの前面に出すため、通知とツールチップをダイアログ内へ移す
        els.detail.append(els.toasts, els.tooltip);
    }
    els.detail.querySelector('.detail__body')?.scrollTo(0, 0);
}

function renderDetail() {
    const d = state.detail;
    if (!d || !state.model) return;
    const { model, stats } = state;
    let content;
    if (d.type === 'song') {
        const ti = model.tracks.findIndex((t) => t.key === d.key);
        if (ti < 0) return closeDetail();
        const rank = stats.songs.find((x) => x.i === ti)?.rank;
        content = V.songDetailView(state, ti, trackDetail(model, ti, state.range), rank);
    } else {
        let ai = model.artists.findIndex((a) => a.key === d.key);
        if (ai < 0) {
            // まとめた結果キーが変わった場合はまとめ先を開く
            const ali = state.settings.aliases[d.key];
            ai = ali ? model.artists.findIndex((a) => a.key === ali) : -1;
            if (ai < 0) return closeDetail();
            d.key = model.artists[ai].key;
        }
        const rank = stats.artists.find((x) => x.i === ai)?.rank;
        content = V.artistDetailView(state, ai, artistDetail(model, ai, state.range), rank, stats.total);
        if (!els['artist-options'].childElementCount) els['artist-options'].innerHTML = String(V.artistOptions(state));
    }
    const box = els['detail-content'];
    const scroll = box.querySelector('.detail__body')?.scrollTop || 0;
    box.innerHTML = String(content);
    const body = box.querySelector('.detail__body');
    if (body) body.scrollTop = scroll;
}

function closeDetail() {
    state.detail = null;
    if (els.detail.open) els.detail.close();
}

// --- 設定の変更 ---

async function updateSettings(mutate, message) {
    const next = normalizeSettings(state.settings);
    mutate(next);
    state.settings = next;
    els['artist-options'].innerHTML = '';
    rebuild();
    render();
    if (state.detail) renderDetail();
    try {
        await setValues({ settings: next });
        if (message) toast(message);
    } catch (err) {
        toast(`設定を保存できませんでした: ${err.message}`, 'error');
    }
}

// --- ファイルの読み込み ---

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function getWorker() {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
            const p = pending.get(e.data.id);
            if (!p) return;
            pending.delete(e.data.id);
            if (e.data.ok) p.resolve(e.data.result);
            else p.reject(new Error(e.data.error));
        };
        worker.onerror = (e) => {
            e.preventDefault();
            workerBroken = true;
            worker = null;
            for (const p of pending.values()) p.reject(Object.assign(new Error('worker'), { workerFailed: true }));
            pending.clear();
        };
    } catch {
        workerBroken = true;
        worker = null;
    }
    return worker;
}

async function parseInBackground(name, buffer) {
    const w = getWorker();
    if (!w) return parseFile(name, buffer);
    try {
        return await new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, { resolve, reject });
            w.postMessage({ id, name, buffer });
        });
    } catch (err) {
        if (err.workerFailed) return parseFile(name, buffer);
        throw err;
    }
}

function mergeSettings(a, b) {
    return normalizeSettings({
        excludedArtists: [...a.excludedArtists, ...b.excludedArtists],
        excludedTracks: [...a.excludedTracks, ...b.excludedTracks],
        aliases: { ...b.aliases, ...a.aliases },
        showThumbnails: a.showThumbnails,
    });
}

async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || state.busy) return;
    setBusy('ファイルを読み込んでいます…');
    const problems = [];
    let dataset = state.dataset || emptyDataset();
    let settings = state.settings;
    const log = [];
    let added = 0, duplicates = 0, settingsChanged = false;

    try {
        for (const f of files) {
            setBusy(`${f.name} を解析しています…`);
            let result;
            try {
                result = await parseInBackground(f.name, await f.arrayBuffer());
            } catch (err) {
                problems.push(`${f.name}: ${err.message}`);
                continue;
            }
            problems.push(...result.warnings);
            for (const src of result.sources) {
                if (!src.entries.length) continue;
                const m = mergeEntries(dataset, src.entries);
                dataset = m.dataset;
                added += m.added;
                duplicates += m.duplicates;
                log.push({ name: src.name, kind: src.kind, importedAt: Date.now(), entries: src.entries.length, added: m.added });
                if (src.settings) {
                    settings = mergeSettings(settings, normalizeSettings(src.settings));
                    settingsChanged = true;
                }
            }
        }

        if (log.length) {
            state.imports = [...log, ...state.imports].slice(0, 200);
            state.dataset = dataset;
            state.settings = settings;
            setBusy('保存しています…');
            await setValues({ dataset, imports: state.imports, ...(settingsChanged ? { settings } : {}) });
            els['artist-options'].innerHTML = '';
            rebuild();
            render();
            if (added) toast(`${formatNumber(added)}件の再生記録を追加しました${duplicates ? `（重複 ${formatNumber(duplicates)}件は除外）` : ''}。`);
            else toast('新しい再生記録はありませんでした（すべて保存済みのデータと重複）。');
        }
    } catch (err) {
        console.error(err);
        problems.push(`保存に失敗しました: ${err.message}`);
    } finally {
        setBusy(null);
    }
    if (problems.length) toast(problems.join('\n'), 'error', 12000);
}

function setBusy(message) {
    state.busy = !!message;
    els.busy.hidden = !message;
    if (message) els.busy.querySelector('.busy__text').textContent = message;
}

// --- 書き出し ---

function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function csvCell(v) {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(type) {
    const { model, stats } = state;
    if (!stats) return;
    const rows = [];
    if (type === 'artists') {
        const songsPer = new Map();
        for (const x of stats.songs) {
            const ai = model.tracks[x.i].artistIdx;
            songsPer.set(ai, (songsPer.get(ai) || 0) + 1);
        }
        rows.push(['順位', 'アーティスト', '再生回数', '割合(%)', '曲数', 'URL']);
        for (const x of stats.artists) {
            const a = model.artists[x.i];
            rows.push([x.rank, a.name, x.count, ((x.count / stats.total) * 100).toFixed(2), songsPer.get(x.i) || 0, a.url || '']);
        }
    } else {
        rows.push(['順位', '曲名', 'アーティスト', '再生回数', '初再生', 'URL']);
        for (const x of stats.songs) {
            const t = model.tracks[x.i];
            rows.push([x.rank, t.title, model.artists[t.artistIdx].name, x.count, formatDate(isFinite(model.trackFirst[x.i]) ? model.trackFirst[x.i] : null), t.v ? `https://music.youtube.com/watch?v=${t.v}` : '']);
        }
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    download(`ytm-${type === 'artists' ? 'artists' : 'songs'}_${encodePeriod(state.period)}.csv`, csv, 'text/csv;charset=utf-8');
}

function exportBackup() {
    if (!state.dataset) return;
    const json = JSON.stringify(buildBackup(state.dataset, state.settings));
    download(`ytm-history-backup_${todayStamp()}.json`, json, 'application/json');
}

async function deleteAll() {
    if (!confirm('このブラウザに保存した再生記録と設定をすべて削除します。元に戻せません。よろしいですか？')) return;
    try {
        await clearAll();
        await setValues({ meta: { legacyChecked: true } });
    } catch (err) {
        toast(`削除できませんでした: ${err.message}`, 'error');
        return;
    }
    state.dataset = null;
    state.imports = [];
    state.settings = defaultSettings();
    state.period = { type: 'all' };
    state.tab = 'overview';
    closeDetail();
    rebuild();
    render();
    history.replaceState(null, '', location.pathname + location.search);
    toast('すべてのデータを削除しました。');
}

// --- トースト・ツールチップ・テーマ ---

function toast(message, kind = 'info', ms = 4000) {
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = String(html`${icon(kind === 'error' ? 'alert' : 'check')}<p>${message}</p><button type="button" class="icon-btn" aria-label="閉じる">${icon('x')}</button>`);
    el.querySelector('button').addEventListener('click', () => el.remove());
    els.toasts.appendChild(el);
    setTimeout(() => el.remove(), ms);
}

function showTip(target) {
    const tip = target.getAttribute('data-tip');
    if (!tip) return;
    const t = els.tooltip;
    t.textContent = tip;
    t.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    let y = r.top - th - 8;
    if (y < 8) y = r.bottom + 8;
    t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    target.classList.add('is-hover');
    showTip.current?.classList.remove('is-hover');
    showTip.current = target;
}

function hideTip() {
    els.tooltip.hidden = true;
    showTip.current?.classList.remove('is-hover');
    showTip.current = null;
}

const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '端末の設定に合わせる', light: 'ライト', dark: 'ダーク' };

function readTheme() {
    try { return THEMES.includes(localStorage.getItem('theme')) ? localStorage.getItem('theme') : 'auto'; } catch { return 'auto'; }
}

function applyTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    els['theme-btn'].innerHTML = String(icon(theme === 'auto' ? 'auto' : theme === 'light' ? 'sun' : 'moon'));
    els['theme-btn'].setAttribute('aria-label', `テーマ: ${THEME_LABEL[theme]}（クリックで切り替え）`);
    els['theme-btn'].title = `テーマ: ${THEME_LABEL[theme]}`;
    els['theme-btn'].dataset.theme = theme;
}

// --- イベント ---

function bindEvents() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', (e) => {
        if (e.target.id === 'rank-search') {
            state.search = e.target.value;
            state.rankLimit = 100;
            debouncedSearch();
        }
    });

    document.addEventListener('pointerover', (e) => {
        const t = e.target.closest('[data-tip]');
        if (t) showTip(t); else if (showTip.current) hideTip();
    });
    document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('[data-tip]')) hideTip();
    });
    window.addEventListener('scroll', () => {
        hideTip();
        els['to-top'].classList.toggle('is-visible', window.scrollY > 600);
    }, { passive: true });

    // 画像が読めないときは代わりのアイコンにする
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (img.tagName === 'IMG' && img.parentElement?.classList.contains('thumb')) {
            img.parentElement.classList.add('thumb--empty');
            img.replaceWith(document.createRange().createContextualFragment(String(icon('music'))));
        }
    }, true);

    els['file-input'].addEventListener('change', (e) => {
        importFiles(e.target.files);
        e.target.value = '';
    });

    // ドラッグ＆ドロップ（ページ全体で受け付ける）
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth++;
        els['drop-overlay'].hidden = false;
    });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        depth = Math.max(0, depth - 1);
        if (!depth) els['drop-overlay'].hidden = true;
    });
    window.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth = 0;
        els['drop-overlay'].hidden = true;
        importFiles(e.dataTransfer.files);
    });

    els.detail.addEventListener('click', (e) => {
        if (e.target === els.detail) closeDetail(); // 背景のクリック
    });
    els.detail.addEventListener('close', () => {
        state.detail = null;
        hideTip();
        document.body.append(els.toasts, els.tooltip);
    });

    window.addEventListener('hashchange', () => {
        readHash();
        if (state.model) recompute();
        render();
    });
}

const debouncedSearch = debounce(updateRankingList, 120);

function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'FORM') return;
    const { action, value, key } = el.dataset;
    switch (action) {
        case 'tab':
            state.tab = value;
            render();
            window.scrollTo({ top: 0 });
            break;
        case 'goto-ranking':
            state.tab = 'ranking';
            state.rankType = value;
            state.search = '';
            render();
            window.scrollTo({ top: 0 });
            break;
        case 'rank-type':
            state.rankType = value;
            state.rankLimit = 100;
            renderMain();
            break;
        case 'more':
            state.rankLimit += 100;
            updateRankingList();
            break;
        case 'cal-year':
            if (value) { state.calYear = +value; renderMain(); }
            break;
        case 'summary-year':
            state.summaryYear = +value;
            renderMain();
            break;
        case 'discover-type':
            state.discoverType = value;
            renderMain();
            break;
        case 'open-song': openDetail('song', key); break;
        case 'open-artist': openDetail('artist', key); break;
        case 'close-detail': closeDetail(); break;
        case 'detail-more':
            state.detail.limit += 200;
            renderDetail();
            break;
        case 'copy':
            navigator.clipboard?.writeText(el.dataset.text).then(
                () => toast('コピーしました。'),
                () => toast('コピーできませんでした。', 'error'),
            );
            break;
        case 'exclude-track':
            updateSettings((s) => { s.excludedTracks.push(key); }, '曲を集計から除外しました。');
            break;
        case 'unexclude-track':
            updateSettings((s) => { s.excludedTracks = s.excludedTracks.filter((k) => k !== key); }, '除外をやめました。');
            break;
        case 'exclude-artist':
            updateSettings((s) => { s.excludedArtists.push(key); }, 'アーティストを集計から除外しました。');
            break;
        case 'unexclude-artist':
            updateSettings((s) => { s.excludedArtists = s.excludedArtists.filter((k) => k !== key); }, '除外をやめました。');
            break;
        case 'unalias':
            updateSettings((s) => { delete s.aliases[key]; }, 'まとめを解除しました。');
            break;
        case 'add-files': els['file-input'].click(); break;
        case 'export-backup': exportBackup(); break;
        case 'export-csv': exportCsv(value); break;
        case 'delete-all': deleteAll(); break;
        case 'theme': {
            const next = THEMES[(THEMES.indexOf(el.dataset.theme) + 1) % THEMES.length];
            try { localStorage.setItem('theme', next); } catch { /* 保存できなくても切り替えは行う */ }
            applyTheme(next);
            break;
        }
        case 'to-top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    }
}

function onChange(e) {
    const t = e.target;
    if (t.id === 'period-select') {
        const v = t.value;
        if (v === 'custom') {
            const end = state.model.maxDay;
            state.period = { type: 'custom', start: Math.max(state.model.minDay, end - 29), end };
        } else {
            state.period = parsePeriod(v);
        }
        recompute();
        render();
    } else if (t.id === 'period-start' || t.id === 'period-end') {
        const a = inputToDay($('period-start').value);
        const b = inputToDay($('period-end').value);
        if (a == null || b == null) return;
        state.period = { type: 'custom', start: Math.min(a, b), end: Math.max(a, b) };
        recompute();
        render();
    } else if (t.dataset.action === 'toggle-thumbs') {
        updateSettings((s) => { s.showThumbnails = t.checked; });
    }
}

function onSubmit(e) {
    const form = e.target;
    if (form.dataset.form !== 'merge') return;
    e.preventDefault();
    const name = new FormData(form).get('target').trim();
    const fromKey = form.dataset.key;
    const target = state.model.artists.find((a) => a.name === name)
        || state.model.artists.find((a) => a.key === artistKeyOf(name));
    if (!target) { toast(`「${name}」というアーティストは見つかりません。候補から選んでください。`, 'error'); return; }
    if (target.key === fromKey) { toast('同じアーティストです。', 'error'); return; }
    state.detail.key = target.key;
    updateSettings((s) => { s.aliases[fromKey] = target.key; }, `「${target.name}」にまとめました。`);
}

init();
