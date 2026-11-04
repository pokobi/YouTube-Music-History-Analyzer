// 保存用データセット（全再生記録を 1 つにまとめたもの）の結合とバックアップ。
//
// dataset = {
//   version: 1,
//   tracks: [{ key, v, title, artist, artistUrl, seen }],  // 曲ごとの情報（seen = その情報を得た再生の時刻）
//   times: Float64Array,     // 再生時刻（昇順）
//   trackIdx: Uint32Array,   // 各再生の曲番号
// }

import { BACKUP_FORMAT } from './parser.js';

export function emptyDataset() {
    return { version: 1, tracks: [], times: new Float64Array(0), trackIdx: new Uint32Array(0) };
}

export function trackKeyOf(entry) {
    return entry.v ? `v:${entry.v}` : `t:${entry.title || ''}\u0001${entry.artist || ''}`;
}

/**
 * 再生記録を結合する。同じ時刻・同じ曲の記録は重複として除く。
 * @returns {{ dataset: object, added: number, duplicates: number }}
 */
export function mergeEntries(dataset, entries) {
    const tracks = dataset.tracks.map((t) => ({ ...t }));
    const keyToIdx = new Map(tracks.map((t, i) => [t.key, i]));
    const n0 = dataset.times.length;
    const seen = new Set();
    for (let i = 0; i < n0; i++) seen.add(`${dataset.times[i]}|${dataset.trackIdx[i]}`);

    const newTimes = [];
    const newIdx = [];
    let duplicates = 0;

    for (const e of entries) {
        const key = trackKeyOf(e);
        let ti = keyToIdx.get(key);
        if (ti === undefined) {
            ti = tracks.length;
            tracks.push({ key, v: e.v || null, title: e.title, artist: e.artist, artistUrl: e.artistUrl, seen: e.t });
            keyToIdx.set(key, ti);
        } else {
            const tr = tracks[ti];
            // より新しい再生の情報で曲名などを更新する（空の値では上書きしない）
            if (e.t >= tr.seen) {
                if (e.title) tr.title = e.title;
                if (e.artist) tr.artist = e.artist;
                if (e.artistUrl) tr.artistUrl = e.artistUrl;
                tr.seen = e.t;
            } else {
                if (!tr.title && e.title) tr.title = e.title;
                if (!tr.artist && e.artist) tr.artist = e.artist;
                if (!tr.artistUrl && e.artistUrl) tr.artistUrl = e.artistUrl;
            }
        }
        const pk = `${e.t}|${ti}`;
        if (seen.has(pk)) { duplicates++; continue; }
        seen.add(pk);
        newTimes.push(e.t);
        newIdx.push(ti);
    }

    const total = n0 + newTimes.length;
    const order = new Uint32Array(total);
    for (let i = 0; i < total; i++) order[i] = i;
    const timeAt = (i) => (i < n0 ? dataset.times[i] : newTimes[i - n0]);
    order.sort((a, b) => timeAt(a) - timeAt(b));

    const times = new Float64Array(total);
    const trackIdx = new Uint32Array(total);
    for (let i = 0; i < total; i++) {
        const o = order[i];
        times[i] = timeAt(o);
        trackIdx[i] = o < n0 ? dataset.trackIdx[o] : newIdx[o - n0];
    }

    return { dataset: { version: 1, tracks, times, trackIdx }, added: newTimes.length, duplicates };
}

export function buildBackup(dataset, settings) {
    return {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        tracks: dataset.tracks.map((t) => [t.v, t.title, t.artist, t.artistUrl]),
        times: Array.from(dataset.times),
        trackIdx: Array.from(dataset.trackIdx),
        settings,
    };
}
