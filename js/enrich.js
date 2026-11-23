// 外部サービスから、曲の原題・アーティスト名・アーティスト画像を取得する。
//
// 取得結果（meta）の形:
// {
//   tracks:  { [動画ID]: { t: YouTube の曲名|null, a: チャンネル名|null, src: 'yt'|'none', at,
//                          it: iTunes の日本語の曲名|''（変わらない）, itAt } },
//   artists: { [アーティストキー]: { img: Deezer の画像URL|''（確かめられない・写真なし）, imgAt, imgV: IMAGE_VERSION,
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

// iTunes でのアーティストの照合方法の版。変えたら、古い版の結果は照合し直す
export const ITUNES_VERSION = 2;
// アーティスト画像の照合方法の版（1: 名前だけ、2: よく聴いた曲で本人を確かめる）。古い版の画像は使わない
export const IMAGE_VERSION = 2;

/** 今の方式で取得したアーティスト画像（なければ null）。'' は「確かめられなかった」 */
export function artistImageOf(entry) {
    return entry && entry.imgV === IMAGE_VERSION ? entry.img : null;
}

/** アーティスト画像をまだ取得していないか */
export function needsImage(entry, now = Date.now()) {
    if (!entry || entry.imgV !== IMAGE_VERSION || entry.img === undefined) return true;
    if (entry.img === '') {
        if (now - (entry.imgAt || 0) > RETRY_MS) return true;
        // iTunes で日本語の名前や曲名が分かったのが画像を探したあとなら、もう一度探す
        const it = entry.it;
        return !!(it && it.v === ITUNES_VERSION && it.id && it.at > (entry.imgAt || 0));
    }
    return false;
}
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
 * まとめたアーティストの情報。name は iTunes での単独の名前（いちばん多いもの。共演の表記「A & B」などしかなければ null）、
 * ja は日本語の曲名が多いか、keys は曲名の照合用キーの一覧
 * @returns {{id, name, ja: boolean, keys: Set<string>}}
 */
export function summarizeItunesArtist(g) {
    const byCount = [...g.names.entries()].sort((x, y) => y[1] - x[1]);
    const solo = byCount.find(([n]) => !MULTI_ARTIST_RE.test(n));
    return { id: g.id, name: solo ? solo[0] : null, ja: g.jaTracks >= g.tracks * JA_SHARE, keys: g.keys };
}

/**
 * iTunes のアーティスト名での曲検索の結果から、利用者のアーティストにあたるものを選ぶ。
 * 同じ名前の別のアーティストを避けるため、利用者の曲と同じ曲名が多いもの（なければ名前が同じもの）を選ぶ。
 * @param names  利用者のデータでのアーティスト名（別の表記を含む）
 * @param titles 利用者のデータでの、そのアーティストの曲。1 曲ごとに曲名か、曲名と別の表記の配列
 * @returns 確かめられなければ null
 */
export function pickItunesArtist(results, { names = [], titles = [] }) {
    const groups = itunesArtistGroups(results, names);
    const tracks = titles.map((t) => (Array.isArray(t) ? t : [t]).filter(Boolean)).filter((t) => t.length);
    let best = null;
    for (const g of groups.values()) {
        const overlap = tracks.filter((list) => list.some((t) => g.keys.has(nameKey(t)) || g.keys.has(songKey(t)))).length;
        // 同じ曲名が 2 曲以上、または利用者の曲の半分以上で一致すれば同じアーティストとみなす。名前の一致でもよい
        const confirmed = g.nameMatch || overlap >= 2 || (overlap >= 1 && overlap * 2 >= tracks.length);
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

// カラオケ・カバー・オルゴールなど、本人以外が出している版の付記
const COPY_RE = /原曲|originally performed|performed by|cover|カバー|karaoke|カラオケ|オルゴール|orgel|music ?box|[+-]\s?\d+\s?key|歌ってみた|tribute/i;

/**
 * Deezer の曲検索（「曲名 アーティスト名」）の結果から、本人の曲の候補を集める。
 * @param titles 利用者のデータでのその曲の表記（日本語・英語など）
 * @param names  利用者のデータでのアーティスト名（別の表記を含む）
 * @returns {Map<id, {picture, titleMatch, nameMatch}>} Deezer のアーティスト ID ごと
 */
export function deezerTrackCandidates(results, { titles = [], names = [] }) {
    const titleKeys = new Set(titles.map(nameKey).filter(Boolean));
    const nameKeys = new Set(names.map(nameKey).filter(Boolean));
    const out = new Map();
    for (const r of results || []) {
        const a = r && r.artist;
        if (!a || !a.id || !r.title || COPY_RE.test(r.title)) continue;
        const c = out.get(a.id) || { picture: '', titleMatch: false, nameMatch: false };
        if (!c.picture && a.picture_medium && !/\/images\/artist\/\//.test(a.picture_medium)) c.picture = a.picture_medium;
        if (titleKeys.has(nameKey(r.title))) c.titleMatch = true;
        if (nameKeys.has(nameKey(a.name))) c.nameMatch = true;
        out.set(a.id, c);
    }
    return out;
}

/**
 * よく聴いた曲（1〜2 曲）の検索結果から、アーティスト本人を確かめて画像を選ぶ。
 * 同じ名前の別のアーティストを避けるため、次のどちらかで確かめられた場合だけ採用する。
 *   1. ある曲で、曲名もアーティスト名も一致する
 *   2. 2 曲の検索の両方に同じアーティストが出て、名前か、どちらかの曲名が一致する（表記違いの名前など）
 * @param searches [{ results, titles }] 曲ごとの検索結果と、その曲の表記
 * @returns {{confirmed: boolean, img: string}} 確かめられなければ confirmed: false
 */
export function pickDeezerByTracks(searches, names) {
    const lists = searches.map((s) => deezerTrackCandidates(s.results, { titles: s.titles, names }));
    for (const list of lists) {
        for (const c of list.values()) if (c.titleMatch && c.nameMatch) return { confirmed: true, img: c.picture };
    }
    if (lists.length >= 2) {
        for (const [id, c] of lists[0]) {
            const others = lists.slice(1).map((l) => l.get(id));
            if (others.some((o) => !o)) continue;
            const all = [c, ...others];
            if (all.some((x) => x.nameMatch) || all.some((x) => x.titleMatch)) {
                return { confirmed: true, img: all.map((x) => x.picture).find(Boolean) || '' };
            }
        }
    }
    return { confirmed: false, img: '' };
}

/** 検索に使う表記を選ぶ（Deezer は英語・ローマ字の表記でよく見つかるため、英字だけの表記を優先する） */
export function searchTermOf(list) {
    const xs = list.filter(Boolean);
    return xs.find((x) => ASCII_RE.test(x)) || xs[0] || '';
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

/** Deezer で曲を検索する（「曲名 アーティスト名」）。CORS に対応していないため JSONP で呼ぶ */
export function deezerTrackSearch(q) {
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
        script.src = `https://api.deezer.com/search?${new URLSearchParams({ q, limit: '25', output: 'jsonp', callback: cb })}`;
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
