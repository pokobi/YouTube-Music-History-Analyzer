// 画面の状態管理・イベント処理・ファイルの読み込み

import { html, debounce, inputToDay, formatNumber, formatDay, formatDate, todayStamp } from './util.js';
import { icon } from './icons.js';
import { parseFile } from './parser.js';
import { emptyDataset, mergeEntries, buildBackup } from './dataset.js';
import { buildModel, defaultSettings, normalizeSettings, artistKeyOf, resolveAlias, findMergeCandidates } from './model.js';
import { emptyMeta, normalizeMeta, needsFetch, needsImage, needsItunesArtist, RETRY_MS, JA_RE, ASCII_RE, ytVideos, ytOembed, itunesSearch, itunesArtistSearch, deezerArtistSearch, pickItunes, pickDeezerArtist, runPool, sleep } from './enrich.js';
import { computeStats, computeRanks, computeHighlights, parsePeriod, encodePeriod, periodRange, previousRange, trackDetail, artistDetail, dayDetail } from './stats.js';
import { getValue, setValues, clearAll, readLegacyEntries } from './store.js';
import * as V from './views.js';

const state = {
    dataset: null,
    settings: defaultSettings(),
    imports: [],
    channelImages: {},
    extMeta: emptyMeta(),
    enrich: null,
    model: null,
    stats: null,
    prev: null,
    range: { start: null, end: null },
    period: { type: 'all' },
    periodLabel: '',
    tab: 'overview',
    rankType: 'songs',
    rankSort: 'count',
    search: '',
    rankLimit: 100,
    calYear: null,
    summaryYear: null,
    discoverType: 'artists',
    cmpA: null,
    cmpB: null,
    cmpType: 'songs',
    detail: null, // { type: 'song'|'artist'|'day', key, limit }
    busy: false,
    apiBusy: false,
    persisted: null,
    searchCache: { songs: new Map(), artists: new Map() },
    timeRankCache: {},
    cache: new Map(),
};

const $ = (id) => document.getElementById(id);
const els = {};

// --- 起動 ---

async function init() {
    for (const id of ['header-controls', 'tabs', 'main', 'detail', 'detail-content', 'toasts', 'tooltip', 'drop-overlay', 'busy', 'file-input', 'theme-btn', 'to-top', 'artist-options', 'song-options', 'enrich-status']) {
        els[id] = $(id);
    }
    applyTheme(readTheme());
    bindEvents();
    readHash();

    try {
        const [dataset, settings, imports, meta, channelImages, extMeta] = await Promise.all([
            getValue('dataset'), getValue('settings'), getValue('imports'), getValue('meta'), getValue('channelImages'), getValue('extMeta'),
        ]);
        state.settings = normalizeSettings(settings);
        state.imports = Array.isArray(imports) ? imports : [];
        state.channelImages = channelImages && typeof channelImages === 'object' ? channelImages : {};
        state.extMeta = normalizeMeta(extMeta);
        state.dataset = dataset && dataset.times && dataset.times.length ? dataset : null;
        if (!meta || !meta.legacyChecked) await migrateLegacy();
    } catch (err) {
        console.error(err);
        toast(`保存データを開けませんでした: ${err.message}`, 'error');
    }
    await checkPersisted();
    rebuild();
    render();
    enrich();
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

// --- 保存データの保護 ---

async function checkPersisted() {
    try {
        state.persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
    } catch {
        state.persisted = null;
    }
}

async function requestPersist(silent = false) {
    if (!navigator.storage || !navigator.storage.persist) return;
    try {
        state.persisted = await navigator.storage.persist();
        if (!silent) {
            toast(state.persisted ? '保存データを保護しました。' : 'ブラウザに保護を許可されませんでした。このサイトをブックマークするなど、よく使うと許可されやすくなります。', state.persisted ? 'info' : 'error');
        }
    } catch {
        /* 対応していないブラウザ */
    }
}

// --- 状態の再計算 ---

function rebuild() {
    state.searchCache = { songs: new Map(), artists: new Map() };
    state.cache = new Map();
    els['artist-options'].innerHTML = '';
    els['song-options'].innerHTML = '';
    if (!state.dataset) {
        state.model = null;
        state.stats = null;
        return;
    }
    state.model = buildModel(state.dataset, state.settings, state.extMeta);
    const years = state.model.years;
    if (state.summaryYear == null || !years.includes(state.summaryYear)) state.summaryYear = years[0] ?? null;
    if (!state.cmpA || !state.cmpB) {
        state.cmpB = years.length ? { type: 'year', year: years[0] } : { type: 'all' };
        state.cmpA = years.length > 1 ? { type: 'year', year: years[1] } : { type: 'all' };
    }
    recompute();
}

function recompute() {
    const { model, period } = state;
    if (!model) return;
    const range = periodRange(period, model);
    state.range = range;
    state.stats = computeStats(model, range);
    state.timeRankCache = {};
    const prev = previousRange(period, model);
    state.prev = prev && prev.end >= model.minDay ? computeRanks(model, prev) : null;
    if (state.prev && !state.prev.total) state.prev = null;
    state.periodLabel = periodLabel();
    state.rankLimit = 100;
}

/** 期間ごとの集計をキャッシュして返す */
function cached(key, fn) {
    if (!state.cache.has(key)) state.cache.set(key, fn());
    return state.cache.get(key);
}

function statsFor(period) {
    return cached(`stats:${encodePeriod(period)}`, () => computeStats(state.model, periodRange(period, state.model)));
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
    if (params.get('a')) state.cmpA = parsePeriod(params.get('a'));
    if (params.get('b')) state.cmpB = parsePeriod(params.get('b'));
}

function writeHash() {
    const params = new URLSearchParams();
    if (state.tab !== 'overview') params.set('tab', state.tab);
    const p = encodePeriod(state.period);
    if (p !== 'all') params.set('p', p);
    if (state.tab === 'compare' && state.cmpA && state.cmpB) {
        params.set('a', encodePeriod(state.cmpA));
        params.set('b', encodePeriod(state.cmpB));
    }
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
    // 年間まとめと比較は、それぞれの画面で期間を選ぶ
    if (!state.model || state.tab === 'summary' || state.tab === 'compare') {
        els['header-controls'].innerHTML = '';
        return;
    }
    els['header-controls'].innerHTML = String(V.periodOptions(state));
}

function renderMain() {
    let view;
    switch (state.tab) {
        case 'ranking': view = V.rankingView(state); break;
        case 'trends': view = V.trendsView(state, cached(`hl:${encodePeriod(state.period)}`, () => computeHighlights(state.model, state.stats))); break;
        case 'compare': view = V.compareView(state, statsFor(state.cmpA), statsFor(state.cmpB)); break;
        case 'summary': view = V.summaryView(state, ...summaryStats()); break;
        case 'data': view = V.dataView(state); break;
        default: view = V.overviewView(state);
    }
    els.main.innerHTML = String(view);
}

function summaryStats() {
    const y = state.summaryYear;
    if (y == null) return [null, 0];
    const s = statsFor({ type: 'year', year: y });
    const prev = cached(`ranks:y${y - 1}`, () => computeRanks(state.model, periodRange({ type: 'year', year: y - 1 }, state.model)));
    return [s, prev.total];
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
        let ti = model.tracks.findIndex((t) => t.key === d.key);
        if (ti < 0) {
            // まとめた結果キーが変わった場合はまとめ先を開く
            const to = resolveAlias(state.settings.trackAliases, d.key);
            ti = model.tracks.findIndex((t) => t.key === to);
            if (ti < 0) return closeDetail();
            d.key = to;
        }
        const rank = stats.songs.find((x) => x.i === ti)?.rank;
        content = V.songDetailView(state, ti, trackDetail(model, ti, state.range), rank);
        if (!els['song-options'].childElementCount) els['song-options'].innerHTML = String(V.songOptions(state));
    } else if (d.type === 'artist') {
        let ai = model.artists.findIndex((a) => a.key === d.key);
        if (ai < 0) {
            const to = resolveAlias(state.settings.aliases, d.key);
            ai = model.artists.findIndex((a) => a.key === to);
            if (ai < 0) return closeDetail();
            d.key = to;
        }
        const rank = stats.artists.find((x) => x.i === ai)?.rank;
        content = V.artistDetailView(state, ai, artistDetail(model, ai, state.range), rank, stats.total);
        if (!els['artist-options'].childElementCount) els['artist-options'].innerHTML = String(V.artistOptions(state));
    } else {
        const day = Number(d.key);
        content = V.dayDetailView(state, day, dayDetail(model, day));
    }
    const box = els['detail-content'];
    const keepScroll = d.keepScroll;
    const scroll = box.querySelector('.detail__body')?.scrollTop || 0;
    box.innerHTML = String(content);
    const body = box.querySelector('.detail__body');
    if (body && keepScroll) body.scrollTop = scroll;
    d.keepScroll = false;
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
    rebuild();
    render();
    if (state.detail) { state.detail.keepScroll = true; renderDetail(); }
    try {
        await setValues({ settings: next });
        if (message) toast(message);
    } catch (err) {
        toast(`設定を保存できませんでした: ${err.message}`, 'error');
    }
}

// --- アーティスト画像（YouTube Data API） ---

async function fetchChannelImages({ quiet = false } = {}) {
    const key = state.settings.youtubeApiKey;
    if (!key || !state.model || state.apiBusy) return;
    // 再生の多いアーティストから順に取得する
    const totals = new Map();
    state.model.tracks.forEach((t, ti) => totals.set(t.artistIdx, (totals.get(t.artistIdx) || 0) + state.model.trackTotal[ti]));
    const ids = [...new Set(state.model.artists
        .map((a, ai) => ({ id: a.channelId, n: totals.get(ai) || 0 }))
        .filter((x) => x.id && !(x.id in state.channelImages))
        .sort((a, b) => b.n - a.n)
        .map((x) => x.id))];
    if (!ids.length) {
        if (!quiet) toast('新しく取得するアイコンはありません。');
        return;
    }
    state.apiBusy = true;
    if (state.tab === 'data') renderMain();
    let got = 0;
    try {
        for (let k = 0; k < ids.length; k += 50) {
            const batch = ids.slice(k, k + 50);
            const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&maxResults=50&fields=items(id,snippet/thumbnails)&id=${batch.join(',')}`;
            const res = await fetch(url, { headers: { 'X-Goog-Api-Key': key } });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || res.status;
                throw new Error(apiErrorText(reason, body?.error?.message));
            }
            const found = new Map((body.items || []).map((it) => {
                const th = it.snippet?.thumbnails || {};
                return [it.id, (th.medium || th.default || th.high || {}).url || ''];
            }));
            for (const id of batch) {
                state.channelImages[id] = found.get(id) || '';
                if (found.get(id)) got++;
            }
            await setValues({ channelImages: state.channelImages });
        }
        if (!quiet) toast(`${formatNumber(got)}件のアイコンを取得しました。`);
    } catch (err) {
        toast(`アイコンを取得できませんでした: ${err.message}`, 'error', 10000);
    } finally {
        state.apiBusy = false;
        render();
        if (state.detail) { state.detail.keepScroll = true; renderDetail(); }
    }
}

function apiErrorText(reason, message) {
    switch (reason) {
        case 'keyInvalid': case 'badRequest': case 'API_KEY_INVALID': return 'API キーが正しくありません。';
        case 'quotaExceeded': case 'dailyLimitExceeded': return '今日の利用上限に達しました。明日もう一度試してください。';
        case 'accessNotConfigured': case 'SERVICE_DISABLED': return 'YouTube Data API v3 が有効になっていません。';
        case 'forbidden': case 'PERMISSION_DENIED': return 'このページからの利用が許可されていません。キーの制限（ウェブサイト）を確認してください。';
        default: return message || String(reason);
    }
}

// --- 原題・アーティスト画像の取得（外部サービス） ---

let enrichRun = 0;
let enrichAgain = false;

function setEnrichStatus() {
    const el = els['enrich-status'];
    if (!el) return;
    const e = state.enrich;
    el.hidden = !e;
    if (e) el.textContent = `${e.label}を取得中 ${formatNumber(e.done)}/${formatNumber(e.total)}`;
}

function cancelEnrich() {
    enrichRun++;
    state.enrich = null;
    setEnrichStatus();
}

const saveMeta = () => setValues({ extMeta: state.extMeta }).catch((err) => console.error(err));

/** 入力中でなければ、取得した結果を画面に反映する */
function refreshFromMeta(force = false) {
    const active = document.activeElement;
    if (!force && active && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
    rebuild();
    render();
    if (state.detail) { state.detail.keepScroll = true; renderDetail(); }
}

async function enrich() {
    if (!state.settings.fetchMeta || !state.model) return;
    if (state.enrich) { enrichAgain = true; return; }
    const run = ++enrichRun;
    const stop = () => run !== enrichRun || !state.settings.fetchMeta || !state.dataset;
    try {
        await enrichTitles(stop);
        if (!stop()) await enrichArtists(stop);
        if (!stop()) await enrichItunes(stop);
    } catch (err) {
        console.error(err);
    } finally {
        if (run === enrichRun) {
            state.enrich = null;
            setEnrichStatus();
            if (state.tab === 'data') renderMain();
            if (enrichAgain) { enrichAgain = false; enrich(); }
        }
    }
}

async function enrichTitles(stop) {
    const { dataset } = state;
    const meta = state.extMeta;
    // 再生の多い曲から順に問い合わせる
    const counts = new Uint32Array(dataset.tracks.length);
    for (let i = 0; i < dataset.trackIdx.length; i++) counts[dataset.trackIdx[i]]++;
    const seen = new Set();
    const items = dataset.tracks
        .map((t, ri) => ({ v: t.v, title: t.title, artist: t.artist, n: counts[ri] }))
        .filter((x) => x.v && !seen.has(x.v) && seen.add(x.v) && needsFetch(meta.tracks[x.v]))
        .sort((a, b) => b.n - a.n);
    if (!items.length) return;

    state.enrich = { label: '曲名', done: 0, total: items.length };
    setEnrichStatus();
    const now = () => Date.now();
    let sinceSave = 0;
    const progress = (k = 1) => {
        state.enrich.done += k;
        setEnrichStatus();
        sinceSave += k;
        if (sinceSave >= 100) {
            sinceSave = 0;
            saveMeta();
            refreshFromMeta();
        }
    };
    let rest = items;

    // 1. API キーがあれば YouTube Data API で 50 件ずつ
    const key = state.settings.youtubeApiKey;
    if (key) {
        const missing = [];
        let k = 0;
        try {
            for (; k < rest.length && !stop(); k += 50) {
                const batch = rest.slice(k, k + 50);
                const res = await ytVideos(batch.map((x) => x.v), key);
                for (const x of batch) {
                    const r = res.get(x.v);
                    if (r && r.t) meta.tracks[x.v] = { ...(meta.tracks[x.v] || {}), t: r.t, a: r.a, src: 'yt', at: now() };
                    else missing.push(x);
                }
                progress(batch.length - batch.filter((x) => missing.includes(x)).length);
            }
        } catch (err) {
            toast(`YouTube Data API で曲名を取得できませんでした: ${apiErrorText(err.reason, err.message)} キーを使わない方法で続けます。`, 'error', 8000);
        }
        rest = [...missing, ...rest.slice(k)];
    }

    // 2. キー不要の oEmbed で 1 件ずつ
    const failed = [];
    let paused = false;
    await runPool(rest, 4, async (x) => {
        let r = null;
        try {
            r = await ytOembed(x.v);
        } catch (err) {
            if (err.rate) { paused = true; return; }
        }
        if (r && r.t) {
            meta.tracks[x.v] = { ...(meta.tracks[x.v] || {}), t: r.t, a: r.a, src: 'yt', at: now() };
            progress();
        } else {
            failed.push(x);
        }
    }, () => stop() || paused);
    if (paused || stop()) { saveMeta(); refreshFromMeta(); return; }

    for (const x of failed) meta.tracks[x.v] = { ...(meta.tracks[x.v] || {}), t: null, a: null, src: 'none', at: now() };
    saveMeta();
    refreshFromMeta();
}

/**
 * 英字だけの曲名を iTunes（日本のストア）で日本語表記にする。
 * アーティストごとに iTunes のアーティストを探し、曲の検索結果が同じアーティスト ID のときだけ採用する。
 * 最初の数曲で表記が変わらないアーティスト（洋楽など）は、それ以上問い合わせない。
 */
async function enrichItunes(stop) {
    refreshFromMeta(true);
    const model = state.model;
    const meta = state.extMeta;
    const PROBE = 3;
    const WAIT = 3100; // iTunes の回数制限（1 分あたり約 20 回）に合わせる

    // アーティストごとに、英字だけでまだ確認していない曲を集める
    const byArtist = new Map();
    model.tracks.forEach((t, ti) => {
        if (!t.v || !model.trackTotal[ti] || !ASCII_RE.test(t.title) || t.title === 'タイトル不明') return;
        const m = meta.tracks[t.v];
        if (m && m.it !== undefined && Date.now() - (m.itAt || 0) < RETRY_MS) return;
        let list = byArtist.get(t.artistIdx);
        if (!list) byArtist.set(t.artistIdx, (list = []));
        list.push(ti);
    });
    const artists = [...byArtist.entries()]
        .map(([ai, list]) => ({ a: model.artists[ai], list: list.sort((x, y) => model.trackTotal[y] - model.trackTotal[x]) }))
        .filter(({ a }) => a.key !== 'a:?' && !(meta.artists[a.key]?.it?.skip && Date.now() - meta.artists[a.key].it.at < RETRY_MS))
        .sort((x, y) => y.list.reduce((n, ti) => n + model.trackTotal[ti], 0) - x.list.reduce((n, ti) => n + model.trackTotal[ti], 0));
    if (!artists.length) return;

    state.enrich = { label: '日本語の曲名', done: 0, total: artists.reduce((n, x) => n + x.list.length, 0) };
    setEnrichStatus();
    let sinceRefresh = 0;
    const ask = async (fn) => {
        const r = await fn();
        await sleep(WAIT);
        return r;
    };

    try {
        for (const { a, list } of artists) {
            if (stop()) break;
            const entry = meta.artists[a.key] || (meta.artists[a.key] = {});
            // 1. アーティストを探す
            if (needsItunesArtist(entry)) {
                const found = await ask(() => itunesArtistSearch(a.name));
                const top = found[0];
                entry.it = top ? { id: top.artistId, cand: top.artistName, name: null, at: Date.now() } : { id: null, name: null, at: Date.now() };
            }
            if (!entry.it.id) {
                state.enrich.done += list.length;
                setEnrichStatus();
                continue;
            }
            // 2. 曲ごとに探し、同じアーティスト ID の曲だけを採用する
            let tried = 0, changed = 0;
            for (const ti of list) {
                if (stop()) break;
                const t = model.tracks[ti];
                const results = await ask(() => itunesSearch(`${t.title} ${a.name}`));
                const pick = pickItunes(results, { title: t.title, artistId: entry.it.id });
                const m = meta.tracks[t.v] || (meta.tracks[t.v] = {});
                m.it = pick ? pick.title : '';
                m.itAt = Date.now();
                if (pick) {
                    changed++;
                    // 曲が一致したので、アーティストの日本語の名前も確かめられた
                    if (JA_RE.test(pick.artist || '')) entry.it.name = pick.artist;
                    else if (JA_RE.test(entry.it.cand || '')) entry.it.name = entry.it.cand;
                }
                tried++;
                state.enrich.done++;
                setEnrichStatus();
                if (++sinceRefresh >= 10) { sinceRefresh = 0; saveMeta(); refreshFromMeta(); }
                if (tried >= PROBE && !changed) {
                    // 表記が変わらないアーティスト。残りは問い合わせない
                    entry.it.skip = true;
                    state.enrich.done += list.length - tried;
                    setEnrichStatus();
                    break;
                }
            }
        }
    } catch (err) {
        if (!err.rate) throw err;
        // 回数制限に達した。続きは次に開いたときに行う
    }
    saveMeta();
    refreshFromMeta();
}

async function enrichArtists(stop) {
    const model = state.model;
    const meta = state.extMeta;
    const totals = new Map();
    model.tracks.forEach((t, ti) => totals.set(t.artistIdx, (totals.get(t.artistIdx) || 0) + model.trackTotal[ti]));
    const items = model.artists
        .map((a, ai) => ({ a, n: totals.get(ai) || 0 }))
        .filter(({ a, n }) => n > 0 && a.key !== 'a:?' && needsImage(meta.artists[a.key]))
        .sort((x, y) => y.n - x.n)
        .map(({ a }) => a);
    if (!items.length) return;

    state.enrich = { label: 'アーティスト画像', done: 0, total: items.length };
    setEnrichStatus();
    let sinceSave = 0;
    await runPool(items, 2, async (a) => {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const data = await deezerArtistSearch(a.name);
                meta.artists[a.key] = { ...(meta.artists[a.key] || {}), img: pickDeezerArtist(data, [a.name, ...a.aliasNames]), imgAt: Date.now() };
                break;
            } catch (err) {
                if (!err.rate) break;
                await sleep(5000);
            }
        }
        state.enrich.done++;
        setEnrichStatus();
        if (++sinceSave >= 40) {
            sinceSave = 0;
            saveMeta();
            refreshFromMeta();
        }
        await sleep(250);
    }, stop);
    saveMeta();
    refreshFromMeta();
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
        ...a,
        excludedArtists: [...a.excludedArtists, ...b.excludedArtists],
        excludedTracks: [...a.excludedTracks, ...b.excludedTracks],
        aliases: { ...b.aliases, ...a.aliases },
        trackAliases: { ...b.trackAliases, ...a.trackAliases },
        ignoredSuggestions: [...a.ignoredSuggestions, ...b.ignoredSuggestions],
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
            rebuild();
            render();
            if (added) toast(`${formatNumber(added)}件の再生記録を追加しました${duplicates ? `（重複 ${formatNumber(duplicates)}件は除外）` : ''}。`);
            else toast('新しい再生記録はありませんでした（すべて保存済みのデータと重複）。');
            // 大きなデータを保存したので、ブラウザに消されないよう保護を求める
            if (!state.persisted) requestPersist(true).then(() => { if (state.tab === 'data') renderMain(); });
            if (state.settings.youtubeApiKey) fetchChannelImages({ quiet: true });
            enrich();
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
    const minutes = (ms) => (ms / 60000).toFixed(1);
    if (type === 'artists') {
        const songsPer = new Map();
        for (const x of stats.songs) {
            const ai = model.tracks[x.i].artistIdx;
            songsPer.set(ai, (songsPer.get(ai) || 0) + 1);
        }
        rows.push(['順位', 'アーティスト', '再生回数', '割合(%)', '推定再生時間(分)', '曲数', 'URL']);
        for (const x of stats.artists) {
            const a = model.artists[x.i];
            rows.push([x.rank, a.name, x.count, ((x.count / stats.total) * 100).toFixed(2), minutes(stats.artistMs[x.i]), songsPer.get(x.i) || 0, a.url || '']);
        }
    } else {
        rows.push(['順位', '曲名', 'アーティスト', '再生回数', '推定再生時間(分)', '初再生', 'URL']);
        for (const x of stats.songs) {
            const t = model.tracks[x.i];
            rows.push([x.rank, t.title, model.artists[t.artistIdx].name, x.count, minutes(stats.trackMs[x.i]), formatDate(isFinite(model.trackFirst[x.i]) ? model.trackFirst[x.i] : null), t.v ? `https://music.youtube.com/watch?v=${t.v}` : '']);
        }
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    download(`ytm-${type === 'artists' ? 'artists' : 'songs'}_${encodePeriod(state.period)}.csv`, csv, 'text/csv;charset=utf-8');
}

function exportBackup() {
    if (!state.dataset) return;
    // API キーはバックアップに含めない
    const { youtubeApiKey, ...settings } = state.settings;
    const json = JSON.stringify(buildBackup(state.dataset, settings));
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
    cancelEnrich();
    state.channelImages = {};
    state.extMeta = emptyMeta();
    state.settings = defaultSettings();
    state.period = { type: 'all' };
    state.cmpA = null;
    state.cmpB = null;
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

let tipTarget = null;

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
    tipTarget?.classList.remove('is-hover');
    target.classList.add('is-hover');
    tipTarget = target;
}

function hideTip() {
    els.tooltip.hidden = true;
    tipTarget?.classList.remove('is-hover');
    tipTarget = null;
}

const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: '端末の設定に合わせる', light: 'ライト', dark: 'ダーク' };

function readTheme() {
    try {
        const v = localStorage.getItem('theme');
        return THEMES.includes(v) ? v : 'auto';
    } catch {
        return 'auto';
    }
}

function applyTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    els['theme-btn'].innerHTML = String(icon(theme === 'auto' ? 'auto' : theme === 'light' ? 'sun' : 'moon'));
    els['theme-btn'].setAttribute('aria-label', `テーマ: ${THEME_LABEL[theme]}（押すと切り替え）`);
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
        if (t) showTip(t); else if (tipTarget) hideTip();
    });
    document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('[data-tip]')) hideTip();
    });
    window.addEventListener('scroll', () => {
        hideTip();
        els['to-top'].classList.toggle('is-visible', window.scrollY > 600);
    }, { passive: true });

    // 画像が読めないときは代わりの表示にする
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (img.tagName !== 'IMG') return;
        const box = img.parentElement;
        if (box?.classList.contains('thumb')) {
            box.classList.add('thumb--empty');
            img.replaceWith(document.createRange().createContextualFragment(String(icon('music'))));
        } else if (box?.classList.contains('avatar')) {
            img.replaceWith(document.createTextNode(box.dataset.initial || '?'));
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
        case 'rank-sort':
            state.rankSort = value;
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
        case 'cmp-type':
            state.cmpType = value;
            renderMain();
            break;
        case 'open-song': openDetail('song', key); break;
        case 'open-artist': openDetail('artist', key); break;
        case 'open-day': if (value !== undefined && value !== '') openDetail('day', value); break;
        case 'close-detail': closeDetail(); break;
        case 'detail-more':
            state.detail.limit += 200;
            state.detail.keepScroll = true;
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
        case 'untrack-alias':
            updateSettings((s) => { delete s.trackAliases[key]; }, '曲のまとめを解除しました。');
            break;
        case 'merge-candidate': {
            const [main, ...rest] = value.split('\n');
            updateSettings((s) => { for (const k of rest) s.trackAliases[k] = main; }, `${rest.length + 1}件の曲を 1 つにまとめました。`);
            break;
        }
        case 'merge-all-candidates': {
            const groups = findMergeCandidates(state.model, state.settings.ignoredSuggestions)
                .map((c) => c.tracks.map((ti) => state.model.tracks[ti].key));
            if (!confirm(`${formatNumber(groups.length)}組の候補をすべてまとめます。よろしいですか？（あとから個別に解除できます）`)) break;
            updateSettings((s) => { for (const [main, ...rest] of groups) for (const k of rest) s.trackAliases[k] = main; }, `${formatNumber(groups.length)}組の曲をまとめました。`);
            break;
        }
        case 'ignore-candidate':
            updateSettings((s) => { s.ignoredSuggestions.push(key); });
            break;
        case 'reset-ignored':
            updateSettings((s) => { s.ignoredSuggestions = []; });
            break;
        case 'persist':
            requestPersist().then(() => renderMain());
            break;
        case 'fetch-images': fetchChannelImages(); break;
        case 'retry-meta':
            // 取れなかったものの記録を消して、もう一度問い合わせる
            for (const [k, v] of Object.entries(state.extMeta.tracks)) if (v.src === 'none') delete state.extMeta.tracks[k];
            for (const [k, v] of Object.entries(state.extMeta.artists)) if (!v.img) delete state.extMeta.artists[k];
            saveMeta().then(() => enrich());
            toast('取得できなかったものを、もう一度問い合わせます。');
            break;
        case 'clear-api-key':
            updateSettings((s) => { s.youtubeApiKey = ''; }, 'API キーを削除しました。');
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

function customFrom(a, b) {
    if (a == null || b == null) return null;
    return { type: 'custom', start: Math.min(a, b), end: Math.max(a, b) };
}

function defaultCustom() {
    const end = state.model.maxDay;
    return { type: 'custom', start: Math.max(state.model.minDay, end - 29), end };
}

function onChange(e) {
    const t = e.target;
    if (t.id === 'period-select') {
        state.period = t.value === 'custom' ? defaultCustom() : parsePeriod(t.value);
        recompute();
        render();
    } else if (t.id === 'period-start' || t.id === 'period-end') {
        const p = customFrom(inputToDay($('period-start').value), inputToDay($('period-end').value));
        if (!p) return;
        state.period = p;
        recompute();
        render();
    } else if (t.dataset.periodSelect) {
        const p = t.value === 'custom' ? defaultCustom() : parsePeriod(t.value);
        if (t.dataset.periodSelect === 'cmp-a') state.cmpA = p; else state.cmpB = p;
        render();
    } else if (t.dataset.periodStart || t.dataset.periodEnd) {
        const id = t.dataset.periodStart || t.dataset.periodEnd;
        const p = customFrom(
            inputToDay(document.querySelector(`[data-period-start="${id}"]`).value),
            inputToDay(document.querySelector(`[data-period-end="${id}"]`).value),
        );
        if (!p) return;
        if (id === 'cmp-a') state.cmpA = p; else state.cmpB = p;
        render();
    } else if (t.dataset.action === 'toggle-thumbs') {
        updateSettings((s) => { s.showThumbnails = t.checked; });
    } else if (t.dataset.action === 'toggle-meta') {
        if (!t.checked) cancelEnrich();
        updateSettings((s) => { s.fetchMeta = t.checked; }, t.checked ? '曲の原題とアーティスト画像の取得を有効にしました。' : '外部サービスへの問い合わせを止め、元の表記に戻しました。')
            .then(() => { if (t.checked) enrich(); });
    } else if (t.dataset.action === 'toggle-skips') {
        updateSettings((s) => { s.excludeSkips = t.checked; }, t.checked ? 'スキップした再生を集計から除外しました。' : 'スキップした再生も集計に含めました。');
    }
}

function onSubmit(e) {
    const form = e.target;
    const kind = form.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const data = new FormData(form);

    if (kind === 'api-key') {
        const key = String(data.get('key') || '').trim();
        updateSettings((s) => { s.youtubeApiKey = key; }, key ? 'API キーを保存しました。' : 'API キーを削除しました。')
            .then(() => { if (key) fetchChannelImages(); });
        return;
    }

    const name = String(data.get('target') || '').trim();
    const fromKey = form.dataset.key;
    if (kind === 'merge') {
        const target = state.model.artists.find((a) => a.name === name)
            || state.model.artists.find((a) => a.key === artistKeyOf(name));
        if (!target) { toast(`「${name}」というアーティストは見つかりません。候補から選んでください。`, 'error'); return; }
        if (target.key === fromKey) { toast('同じアーティストです。', 'error'); return; }
        state.detail.key = target.key;
        updateSettings((s) => { s.aliases[fromKey] = target.key; }, `「${target.name}」にまとめました。`);
    } else if (kind === 'merge-track') {
        const ti = state.model.tracks.findIndex((_, i) => V.songOptionLabel(state, i) === name);
        if (ti < 0) { toast(`「${name}」という曲は見つかりません。候補から選んでください。`, 'error'); return; }
        const target = state.model.tracks[ti];
        if (target.key === fromKey) { toast('同じ曲です。', 'error'); return; }
        state.detail.key = target.key;
        updateSettings((s) => {
            s.trackAliases[fromKey] = target.key;
            // まとめ元にまとめていた曲も、まとめ先へ向け直す
            for (const [k, v] of Object.entries(s.trackAliases)) if (v === fromKey) s.trackAliases[k] = target.key;
        }, `「${target.title}」にまとめました。`);
    }
}

init();
