// 保存データと設定（除外・まとめ）から、集計しやすい形のモデルを作る。

import { dayNumber, dayWeekday, dayParts } from './util.js';

const TOPIC_RE = /\s+-\s+Topic$/i;

/** 次の再生までがこれより短い再生をスキップとみなす */
export const SKIP_MS = 30 * 1000;
/** 次の再生までの間隔がこれより長いときは、曲の長さが分からないものとして扱う */
const GAP_CAP_MS = 12 * 60 * 1000;
const DEFAULT_TRACK_MS = 3.5 * 60 * 1000;

export function displayArtistName(name) {
    return name ? String(name).replace(TOPIC_RE, '').trim() : '';
}

/** アーティストの識別キー（「- Topic」の有無や全角半角・大文字小文字の違いは同一視） */
export function artistKeyOf(name) {
    const n = displayArtistName(name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    return n ? `a:${n}` : 'a:?';
}

export function channelIdOf(url) {
    const m = /\/channel\/(UC[\w-]{10,})/.exec(url || '');
    return m ? m[1] : null;
}

export const UNKNOWN_ARTIST = '不明なアーティスト';
export const UNKNOWN_TITLE = 'タイトル不明';

export function defaultSettings() {
    return {
        excludedArtists: [],
        excludedTracks: [],
        aliases: {},
        trackAliases: {},
        ignoredSuggestions: [],
        showThumbnails: true,
        excludeSkips: false,
        youtubeApiKey: '',
    };
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {});
const arr = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string'))] : []);

export function normalizeSettings(s) {
    if (!s || typeof s !== 'object') return defaultSettings();
    return {
        excludedArtists: arr(s.excludedArtists),
        excludedTracks: arr(s.excludedTracks),
        aliases: obj(s.aliases),
        trackAliases: obj(s.trackAliases),
        ignoredSuggestions: arr(s.ignoredSuggestions),
        showThumbnails: s.showThumbnails !== false,
        excludeSkips: s.excludeSkips === true,
        youtubeApiKey: typeof s.youtubeApiKey === 'string' ? s.youtubeApiKey.trim() : '',
    };
}

/** まとめ設定をたどって最終的なキーを返す */
export function resolveAlias(aliases, key) {
    let k = key;
    for (let i = 0; i < 20 && aliases[k] && aliases[k] !== k; i++) k = aliases[k];
    return k;
}

function median(values) {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

export function buildModel(dataset, settings) {
    const { tracks: rawTracks, times } = dataset;
    const n = times.length;

    // --- アーティスト（元の曲ごとに名前と URL を集める） ---
    const artistIndex = new Map();
    const artists = [];
    const getArtist = (key) => {
        let ai = artistIndex.get(key);
        if (ai === undefined) {
            ai = artists.length;
            artists.push({ key, name: null, url: null, urlIsTopic: true, nameScore: -Infinity, aliasNames: new Set(), imageV: null });
            artistIndex.set(key, ai);
        }
        return ai;
    };
    const rawArtistIdx = rawTracks.map((t) => {
        const ownKey = artistKeyOf(t.artist);
        const ai = getArtist(resolveAlias(settings.aliases, ownKey));
        const a = artists[ai];
        const disp = displayArtistName(t.artist);
        if (disp) {
            a.aliasNames.add(disp);
            // まとめ先と同じキーの名前を優先して表示名にする
            const score = (ownKey === a.key ? 1e15 : 0) + t.seen;
            if (score > a.nameScore) { a.name = disp; a.nameScore = score; }
        }
        if (t.artistUrl) {
            const isTopic = TOPIC_RE.test(t.artist || '');
            if (!a.url || (a.urlIsTopic && !isTopic)) { a.url = t.artistUrl; a.urlIsTopic = isTopic; }
        }
        return ai;
    });
    for (const a of artists) {
        if (!a.name) a.name = a.key === 'a:?' ? UNKNOWN_ARTIST : a.key.slice(2);
        a.aliasNames = [...a.aliasNames].filter((x) => x !== a.name);
        a.channelId = channelIdOf(a.url);
    }

    // --- 曲（まとめ設定で複数の元の曲を 1 つにする） ---
    const trackIndex = new Map();
    const tracks = [];
    const rawToTrack = new Uint32Array(rawTracks.length);
    rawTracks.forEach((t, ri) => {
        const key = resolveAlias(settings.trackAliases, t.key);
        let ti = trackIndex.get(key);
        if (ti === undefined) {
            ti = tracks.length;
            tracks.push({ key, v: null, title: null, artistIdx: 0, ownArtistKey: null, ownArtistName: null, score: -Infinity, variants: [], rawCount: 0 });
            trackIndex.set(key, ti);
        }
        rawToTrack[ri] = ti;
        const tr = tracks[ti];
        tr.rawCount++;
        const score = (t.key === key ? 1e15 : 0) + t.seen;
        const title = t.title || UNKNOWN_TITLE;
        if (score > tr.score) {
            if (tr.title && tr.title !== title) tr.variants.push(tr.title);
            tr.score = score;
            tr.v = t.v;
            tr.title = title;
            tr.artistIdx = rawArtistIdx[ri];
            tr.ownArtistKey = artistKeyOf(t.artist);
            tr.ownArtistName = displayArtistName(t.artist) || UNKNOWN_ARTIST;
        } else if (title !== tr.title) {
            tr.variants.push(title);
        }
    });
    for (const tr of tracks) tr.variants = [...new Set(tr.variants)].filter((x) => x !== tr.title);

    const trackIdx = new Uint32Array(n);
    for (let i = 0; i < n; i++) trackIdx[i] = rawToTrack[dataset.trackIdx[i]];

    // --- 除外 ---
    const exArtists = new Set(settings.excludedArtists);
    const exTracks = new Set(settings.excludedTracks);
    const artistExcluded = new Uint8Array(artists.length);
    artists.forEach((a, i) => { if (exArtists.has(a.key)) artistExcluded[i] = 1; });
    const trackExcluded = new Uint8Array(tracks.length);
    tracks.forEach((t, i) => { if (exTracks.has(t.key) || artistExcluded[t.artistIdx]) trackExcluded[i] = 1; });

    // --- スキップと推定再生時間（次の再生までの間隔から推定） ---
    const skip = new Uint8Array(n);
    const gaps = new Float64Array(n);
    const knownGaps = new Map();
    for (let i = 0; i < n; i++) {
        const gap = i + 1 < n ? times[i + 1] - times[i] : Infinity;
        gaps[i] = gap;
        if (gap < SKIP_MS) skip[i] = 1;
        else if (gap <= GAP_CAP_MS) {
            const ti = trackIdx[i];
            let list = knownGaps.get(ti);
            if (!list) knownGaps.set(ti, (list = []));
            list.push(gap);
        }
    }
    const allKnown = [];
    for (const list of knownGaps.values()) for (let k = 0; k < list.length; k += 7) allKnown.push(list[k]);
    const globalMs = median(allKnown) ?? DEFAULT_TRACK_MS;
    const trackMs = new Float64Array(tracks.length).fill(globalMs);
    for (const [ti, list] of knownGaps) trackMs[ti] = median(list);
    const dur = new Float64Array(n);
    for (let i = 0; i < n; i++) dur[i] = skip[i] ? gaps[i] : Math.min(gaps[i], trackMs[trackIdx[i]]);

    const excludeSkips = settings.excludeSkips === true;
    // 集計に含めない再生（除外した曲・アーティスト、または除外設定時のスキップ）
    const off = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (trackExcluded[trackIdx[i]] || (excludeSkips && skip[i])) off[i] = 1;
    }

    // --- 再生ごとの日付情報と、初回・最後の再生 ---
    const day = new Int32Array(n);
    const hour = new Uint8Array(n);
    const trackFirst = new Float64Array(tracks.length).fill(Infinity);
    const trackLast = new Float64Array(tracks.length).fill(-Infinity);
    const artistFirst = new Float64Array(artists.length).fill(Infinity);
    const trackTotal = new Uint32Array(tracks.length);
    const yearsSet = new Set();
    let lastDay = -1, lastDayStart = 0, lastDayEnd = 0;
    for (let i = 0; i < n; i++) {
        const t = times[i];
        if (t >= lastDayStart && t < lastDayEnd) {
            day[i] = lastDay;
        } else {
            const d = dayNumber(t);
            day[i] = d;
            lastDay = d;
            const p = dayParts(d);
            lastDayStart = new Date(p.y, p.m, p.d).getTime();
            lastDayEnd = new Date(p.y, p.m, p.d + 1).getTime();
            yearsSet.add(p.y);
        }
        hour[i] = new Date(t).getHours();
        if (off[i]) continue;
        const ti = trackIdx[i];
        trackTotal[ti]++;
        if (t < trackFirst[ti]) trackFirst[ti] = t;
        trackLast[ti] = t;
        const ai = tracks[ti].artistIdx;
        if (t < artistFirst[ai]) artistFirst[ai] = t;
    }

    // アーティストの画像代わりに使う、全期間でいちばん聴いた曲
    const best = new Uint32Array(artists.length);
    tracks.forEach((t, ti) => {
        if (!t.v) return;
        if (trackTotal[ti] > best[t.artistIdx]) { best[t.artistIdx] = trackTotal[ti]; artists[t.artistIdx].imageV = t.v; }
    });

    return {
        n,
        times,
        trackIdx,
        day,
        hour,
        skip,
        dur,
        off,
        excludeSkips,
        tracks,
        artists,
        trackExcluded,
        artistExcluded,
        trackFirst,
        trackLast,
        artistFirst,
        trackTotal,
        years: [...yearsSet].sort((a, b) => b - a),
        minDay: n ? day[0] : null,
        maxDay: n ? day[n - 1] : null,
        weekdayOf: dayWeekday,
    };
}

// --- 曲のまとめ候補 ---

const VERSION_WORDS = /(official|music\s*video|lyric|lyrics|audio|visualizer|\bmv\b|\bpv\b|\bm\/v\b|video|公式|ミュージックビデオ|ミュージック・ビデオ|リリック|歌詞)/i;

/** 曲名から「(Official Video)」などの付記を除いた比較用の文字列 */
export function baseTitle(title) {
    let t = String(title || '').normalize('NFKC');
    t = t.replace(/[\[(（【「『]([^\])）】」』]*)[\])）】」』]/g, (m, inner) => (VERSION_WORDS.test(inner) ? ' ' : m));
    t = t.replace(/\s[-–—|/]\s*(official.*|.*music video.*|.*\bmv\b.*|.*\bpv\b.*)$/i, ' ');
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * 同じアーティストで、付記を除いた曲名が同じ曲のまとまりを探す。
 * @returns {Array<{id: string, tracks: number[]}>} tracks は全期間の再生が多い順
 */
export function findMergeCandidates(model, ignored = []) {
    const ignoredSet = new Set(ignored);
    const groups = new Map();
    model.tracks.forEach((t, ti) => {
        if (!model.trackTotal[ti] || t.title === UNKNOWN_TITLE) return;
        const base = baseTitle(t.title);
        if (!base) return;
        const id = `${t.artistIdx}\u0001${base}`;
        let g = groups.get(id);
        if (!g) groups.set(id, (g = []));
        g.push(ti);
    });
    const out = [];
    for (const [id, list] of groups) {
        if (list.length < 2) continue;
        const key = `${model.artists[model.tracks[list[0]].artistIdx].key}|${id.split('\u0001')[1]}`;
        if (ignoredSet.has(key)) continue;
        list.sort((a, b) => model.trackTotal[b] - model.trackTotal[a]);
        out.push({ id: key, tracks: list });
    }
    return out.sort((a, b) => model.trackTotal[b.tracks[0]] - model.trackTotal[a.tracks[0]]);
}
