// 外部サービスから、曲の原題・アーティスト名・アーティスト画像を取得する。
//
// 取得結果（meta）の形:
// {
//   tracks:  { [動画ID]: { t: YouTube の曲名|null, a: チャンネル名|null, src: 'yt'|'none', at,
//                          it: iTunes の日本語の曲名|''（変わらない）, itAt } },
//   artists: { [アーティストキー]: { img: Deezer の画像URL|'', imgAt,
//                                    it: { v: ITUNES_VERSION, id: iTunes のアーティストID|null,
//                                          ja: 日本語の曲名が多いアーティストか, name: 日本語の名前|null, at } } },
// }

import { normalizeText } from './util.js';

export const RETRY_MS = 30 * 24 * 60 * 60 * 1000; // 取れなかったものを再び問い合わせるまでの期間

export function emptyMeta() {
    return { tracks: {}, artists: {} };
}

export function normalizeMeta(m) {
    if (!m || typeof m !== 'object') return emptyMeta();
    return {
        tracks: m.tracks && typeof m.tracks === 'object' ? m.tracks : {},
        artists: m.artists && typeof m.artists === 'object' ? m.artists : {},
    };
}

/** 曲名をまだ取得していない（または取得に失敗して期間が過ぎた）か */
export function needsFetch(entry, now = Date.now()) {
    if (!entry || !entry.src) return true;
    if (entry.src === 'none') return now - (entry.at || 0) > RETRY_MS;
    return false;
}

/** アーティスト画像をまだ取得していないか */
export function needsImage(entry, now = Date.now()) {
    if (!entry || entry.img === undefined) return true;
    if (entry.img === '') return now - (entry.imgAt || 0) > RETRY_MS;
    return false;
}

// iTunes でのアーティストの照合方法の版。変えたら、古い版の結果は照合し直す
export const ITUNES_VERSION = 2;
// 曲の一覧のうち日本語の曲名がこの割合以上なら、日本のアーティストとして扱う
export const JA_SHARE = 0.25;

/** iTunes でのアーティストの照合をまだしていないか */
export function needsItunesArtist(entry, now = Date.now()) {
    if (!entry || !entry.it || entry.it.v !== ITUNES_VERSION) return true;
    if (!entry.it.id) return now - (entry.it.at || 0) > RETRY_MS;
    return false;
}

export const JA_RE = /[぀-ヿ㐀-鿿豈-﫿]/;
export const ASCII_RE = /^[ -~]+$/;

// --- 照合用 ---

/** 名前の比較用（全角半角・大文字小文字・空白と記号の違いを無視） */
export function nameKey(s) {
    return normalizeText(s).replace(/\s+-\s+topic$/, '').replace(/[\s　・･.,'’"“”!！?？&＆\-‐_~〜:：;；/／()（）\[\]［］【】「」『』]/g, '');
}

const VERSION_RE = /(live|ver\.?|version|instrumental|inst\.?|karaoke|remix|mix\)|acoustic|piano|english|cover|from the first take|オルゴール|カラオケ|ライブ|弾き語り|バージョン)/i;

/** ライブ版・カバーなど、元の曲とは別の版を表す付記があるか */
export function isVariantTitle(title) {
    const m = String(title || '').match(/[(（\[［【].*?[)）\]］】]|\s[-–—]\s.*$/g);
    return !!m && m.some((part) => VERSION_RE.test(part));
}

/**
 * iTunes の検索結果から、採用してよい候補を選ぶ。
 * 誤変換を避けるため、アーティスト（ID または名前）が一致し、別の版の付記がないものだけを採用する。
 * @returns {{title, artist}|null} 採用する候補。表記が同じ、または候補がないときは null
 */
export function pickItunes(results, { title, artistId = null, artistNames = [] }) {
    const names = new Set(artistNames.map(nameKey).filter(Boolean));
    const t0 = nameKey(title);
    for (const r of results || []) {
        if (!r || !r.trackName || !r.artistName) continue;
        const sameArtist = artistId ? r.artistId === artistId : names.has(nameKey(r.artistName));
        if (!sameArtist) continue;
        // 別の版（ライブ・リミックスなど）かどうかが元の曲名と同じものだけ
        if (isVariantTitle(r.trackName) !== isVariantTitle(title)) continue;
        if (nameKey(r.trackName) === t0) return null; // すでに同じ表記
        return { title: r.trackName, artist: r.artistName };
    }
    return null;
}

/** 曲名の照合用（括弧の付記と「 - 」以降を除く） */
export function songKey(s) {
    return nameKey(String(s || '').replace(/[(（\[［【].*?[)）\]］】]/g, '').replace(/\s[-–—]\s.*$/, ''));
}

const MULTI_ARTIST_RE = /\s[&×x]\s|,|、|\bfeat\.?|\bwith\b/i;

/**
 * iTunes のアーティスト名での曲検索（attribute=artistTerm）の結果を、アーティスト ID ごとにまとめる。
 * @param names 利用者のデータでのアーティスト名（別の表記を含む）
 */
export function itunesArtistGroups(results, names = []) {
    const nameKeys = new Set(names.map(nameKey).filter(Boolean));
    const groups = new Map();
    for (const r of results || []) {
        if (!r || !r.artistId || !r.trackName || !r.artistName) continue;
        if (r.kind && r.kind !== 'song') continue;
        let g = groups.get(r.artistId);
        if (!g) groups.set(r.artistId, (g = { id: r.artistId, names: new Map(), keys: new Set(), tracks: 0, jaTracks: 0, nameMatch: false }));
        g.names.set(r.artistName, (g.names.get(r.artistName) || 0) + 1);
        g.keys.add(nameKey(r.trackName));
        g.keys.add(songKey(r.trackName));
        g.tracks++;
        if (JA_RE.test(r.trackName)) g.jaTracks++;
        if (nameKeys.has(nameKey(r.artistName))) g.nameMatch = true;
    }
    for (const g of groups.values()) g.keys.delete('');
    return groups;
}

/**
 * まとめたアーティストの情報。name は iTunes での名前（共演の表記を避けていちばん多いもの）、
 * ja は日本語の曲名が多いか、keys は曲名の照合用キーの一覧
 * @returns {{id, name, ja: boolean, keys: Set<string>}}
 */
export function summarizeItunesArtist(g) {
    const byCount = [...g.names.entries()].sort((x, y) => y[1] - x[1]);
    const solo = byCount.find(([n]) => !MULTI_ARTIST_RE.test(n)) || byCount[0];
    return { id: g.id, name: solo[0], ja: g.jaTracks >= g.tracks * JA_SHARE, keys: g.keys };
}

/**
 * iTunes のアーティスト名での曲検索の結果から、利用者のアーティストにあたるものを選ぶ。
 * 同じ名前の別のアーティストを避けるため、利用者の曲と同じ曲名が多いもの（なければ名前が同じもの）を選ぶ。
 * @param names  利用者のデータでのアーティスト名（別の表記を含む）
 * @param titles 利用者のデータでの、そのアーティストの曲名（別の表記を含む）
 * @returns 確かめられなければ null
 */
export function pickItunesArtist(results, { names = [], titles = [] }) {
    const groups = itunesArtistGroups(results, names);
    const uniq = [...new Set(titles.filter(Boolean))];
    let best = null;
    for (const g of groups.values()) {
        const overlap = uniq.filter((t) => g.keys.has(nameKey(t)) || g.keys.has(songKey(t))).length;
        // 同じ曲名が 2 曲以上、または利用者の曲の半分以上で一致すれば同じアーティストとみなす。名前の一致でもよい
        const confirmed = g.nameMatch || overlap >= 2 || (overlap >= 1 && overlap * 2 >= uniq.length);
        if (!confirmed) continue;
        // 一致した曲数 → 名前の一致 → 曲数 の順に優先する
        const rank = [overlap, g.nameMatch ? 1 : 0, g.tracks];
        const i = best ? rank.findIndex((v, k) => v !== best.rank[k]) : 0;
        if (!best || (i >= 0 && rank[i] > best.rank[i])) best = { g, rank };
    }
    return best ? summarizeItunesArtist(best.g) : null;
}

/**
 * 曲名で検索した結果から、候補のアーティスト（itunesArtistGroups）の曲を探す。
 * 曲の一覧で確かめられなかったアーティストを、曲で確かめるのに使う
 */
export function findItunesArtistByTrack(results, groups, title) {
    const hit = (results || []).find((r) => r && r.trackName && groups.has(r.artistId) && isVariantTitle(r.trackName) === isVariantTitle(title));
    return hit ? groups.get(hit.artistId) : null;
}

/** Deezer の検索結果から、名前が一致するアーティストの画像を選ぶ */
export function pickDeezerArtist(data, names) {
    const keys = new Set(names.map(nameKey).filter(Boolean));
    const hits = (data || []).filter((d) => d && keys.has(nameKey(d.name)) && d.picture_medium && !/\/images\/artist\/\//.test(d.picture_medium));
    hits.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
    return hits.length ? hits[0].picture_medium : '';
}

// --- 通信 ---

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    let body = null;
    try { body = await res.json(); } catch { /* 本文なし */ }
    return { ok: res.ok, status: res.status, body };
}

/** YouTube Data API で、動画 50 件ずつ原題とチャンネル名を取得する */
export async function ytVideos(ids, key) {
    const out = new Map();
    const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&maxResults=50&fields=items(id,snippet(title,channelTitle))&id=${ids.join(',')}`;
    const r = await fetchJson(url, { headers: { 'X-Goog-Api-Key': key } });
    if (!r.ok) {
        const reason = r.body?.error?.errors?.[0]?.reason || r.status;
        throw Object.assign(new Error(String(reason)), { reason });
    }
    for (const it of r.body?.items || []) out.set(it.id, { t: it.snippet?.title || null, a: it.snippet?.channelTitle || null });
    return out;
}

/** oEmbed（キー不要）で、動画 1 件の原題とチャンネル名を取得する */
export async function ytOembed(id) {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const r = await fetchJson(url);
    if (r.status === 429) throw Object.assign(new Error('rate'), { rate: true });
    if (!r.ok || !r.body) return null;
    return { t: r.body.title || null, a: r.body.author_name || null };
}

/**
 * iTunes Search API（日本のストア）。回数制限なら err.rate、一時的な失敗なら err.temp を付けて例外にする
 * （失敗を「該当なし」として記録しないため）
 */
async function itunesQuery(params) {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({ country: 'JP', lang: 'ja_jp', ...params })}`;
    let r;
    try {
        r = await fetchJson(url);
    } catch {
        throw Object.assign(new Error('network'), { temp: true });
    }
    if (r.status === 403 || r.status === 429) throw Object.assign(new Error('rate'), { rate: true });
    if (!r.ok || !r.body) throw Object.assign(new Error(`itunes ${r.status}`), { temp: true });
    return r.body.results || [];
}

/** 曲名とアーティスト名で曲を探す */
export function itunesSearch(term) {
    return itunesQuery({ term, entity: 'song', limit: '10' });
}

/** アーティスト名で、そのアーティストの曲の一覧を取得する（同じ名前の別のアーティストも含まれる） */
export function itunesArtistSongs(name) {
    return itunesQuery({ term: name, entity: 'song', attribute: 'artistTerm', limit: '200' });
}

let jsonpSeq = 0;

/** Deezer は CORS に対応していないため JSONP で呼ぶ */
export function deezerArtistSearch(name) {
    return new Promise((resolve, reject) => {
        const cb = `__dz${Date.now().toString(36)}${++jsonpSeq}`;
        const script = document.createElement('script');
        const timer = setTimeout(() => done(new Error('timeout')), 15000);
        function done(err, data) {
            clearTimeout(timer);
            delete window[cb];
            script.remove();
            if (err) reject(err); else resolve(data);
        }
        window[cb] = (data) => {
            if (data && data.error) {
                const e = new Error(data.error.message || 'deezer');
                if (data.error.code === 4) e.rate = true; // 回数制限
                done(e);
            } else {
                done(null, (data && data.data) || []);
            }
        };
        script.src = `https://api.deezer.com/search/artist?${new URLSearchParams({ q: name, limit: '10', output: 'jsonp', callback: cb })}`;
        script.referrerPolicy = 'no-referrer';
        script.onerror = () => done(new Error('network'));
        document.head.appendChild(script);
    });
}

/** 同時実行数を制限して順に処理する。stop() が true を返したら打ち切る */
export async function runPool(items, limit, worker, stop = () => false) {
    let i = 0;
    const next = async () => {
        while (i < items.length && !stop()) {
            const item = items[i++];
            await worker(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
}

export { sleep };
