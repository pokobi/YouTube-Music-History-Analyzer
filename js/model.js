// 保存データと設定（除外・まとめ）から、集計しやすい形のモデルを作る。

import { dayNumber, dayWeekday, dayParts } from './util.js';

const TOPIC_RE = /\s+-\s+Topic$/i;

export function displayArtistName(name) {
    return name ? String(name).replace(TOPIC_RE, '').trim() : '';
}

/** アーティストの識別キー（「- Topic」の有無や全角半角・大文字小文字の違いは同一視） */
export function artistKeyOf(name) {
    const n = displayArtistName(name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    return n ? `a:${n}` : 'a:?';
}

export const UNKNOWN_ARTIST = '不明なアーティスト';
export const UNKNOWN_TITLE = 'タイトル不明';

export function defaultSettings() {
    return { excludedArtists: [], excludedTracks: [], aliases: {}, showThumbnails: true };
}

export function normalizeSettings(s) {
    const d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    return {
        excludedArtists: Array.isArray(s.excludedArtists) ? [...new Set(s.excludedArtists)] : d.excludedArtists,
        excludedTracks: Array.isArray(s.excludedTracks) ? [...new Set(s.excludedTracks)] : d.excludedTracks,
        aliases: s.aliases && typeof s.aliases === 'object' ? { ...s.aliases } : d.aliases,
        showThumbnails: s.showThumbnails !== false,
    };
}

/** まとめ設定をたどって最終的なアーティストキーを返す */
export function resolveAlias(aliases, key) {
    let k = key;
    for (let i = 0; i < 20 && aliases[k] && aliases[k] !== k; i++) k = aliases[k];
    return k;
}

export function buildModel(dataset, settings) {
    const { tracks: rawTracks, times, trackIdx } = dataset;
    const n = times.length;

    // --- アーティスト ---
    const artistIndex = new Map();
    const artists = [];
    const getArtist = (key) => {
        let ai = artistIndex.get(key);
        if (ai === undefined) {
            ai = artists.length;
            artists.push({ key, name: null, url: null, urlIsTopic: true, nameSeen: -Infinity, aliasNames: new Set() });
            artistIndex.set(key, ai);
        }
        return ai;
    };

    // --- 曲 ---
    const tracks = rawTracks.map((t) => {
        const ownKey = artistKeyOf(t.artist);
        const key = resolveAlias(settings.aliases, ownKey);
        const ai = getArtist(key);
        const a = artists[ai];
        const disp = displayArtistName(t.artist);
        if (disp) {
            a.aliasNames.add(disp);
            // まとめ先と同じキーの名前を優先して表示名にする
            const own = ownKey === key;
            const score = (own ? 1e15 : 0) + t.seen;
            if (score > a.nameSeen) { a.name = disp; a.nameSeen = score; }
        }
        if (t.artistUrl) {
            const isTopic = TOPIC_RE.test(t.artist || '');
            if (!a.url || (a.urlIsTopic && !isTopic)) { a.url = t.artistUrl; a.urlIsTopic = isTopic; }
        }
        return {
            key: t.key,
            v: t.v,
            title: t.title || UNKNOWN_TITLE,
            artistIdx: ai,
            ownArtistKey: ownKey,
            ownArtistName: disp || UNKNOWN_ARTIST,
        };
    });
    for (const a of artists) {
        if (!a.name) a.name = a.key === 'a:?' ? UNKNOWN_ARTIST : a.key.slice(2);
        a.aliasNames = [...a.aliasNames].filter((x) => x !== a.name);
    }

    // --- 除外 ---
    const exArtists = new Set(settings.excludedArtists);
    const exTracks = new Set(settings.excludedTracks);
    const artistExcluded = new Uint8Array(artists.length);
    artists.forEach((a, i) => { if (exArtists.has(a.key)) artistExcluded[i] = 1; });
    const trackExcluded = new Uint8Array(tracks.length);
    tracks.forEach((t, i) => { if (exTracks.has(t.key) || artistExcluded[t.artistIdx]) trackExcluded[i] = 1; });

    // --- 再生ごとの日付情報 ---
    const day = new Int32Array(n);
    const hour = new Uint8Array(n);
    const trackFirst = new Float64Array(tracks.length).fill(Infinity);
    const artistFirst = new Float64Array(artists.length).fill(Infinity);
    const yearsSet = new Set();
    let lastDayCache = -1, lastDayStart = 0, lastDayEnd = 0;
    for (let i = 0; i < n; i++) {
        const t = times[i];
        if (t >= lastDayStart && t < lastDayEnd) {
            day[i] = lastDayCache;
        } else {
            const d = dayNumber(t);
            day[i] = d;
            lastDayCache = d;
            const p = dayParts(d);
            lastDayStart = new Date(p.y, p.m, p.d).getTime();
            lastDayEnd = new Date(p.y, p.m, p.d + 1).getTime();
            yearsSet.add(p.y);
        }
        hour[i] = new Date(t).getHours();
        const ti = trackIdx[i];
        if (!trackExcluded[ti]) {
            if (t < trackFirst[ti]) trackFirst[ti] = t;
            const ai = tracks[ti].artistIdx;
            if (t < artistFirst[ai]) artistFirst[ai] = t;
        }
    }

    return {
        n,
        times,
        trackIdx,
        day,
        hour,
        tracks,
        artists,
        trackExcluded,
        artistExcluded,
        trackFirst,
        artistFirst,
        years: [...yearsSet].sort((a, b) => b - a),
        minDay: n ? day[0] : null,
        maxDay: n ? day[n - 1] : null,
        weekdayOf: dayWeekday,
    };
}
