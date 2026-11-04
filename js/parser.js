// 読み込んだファイルを「再生記録の配列」に変換する。
// Worker とメインスレッドの両方から使うため、DOM には触れない。
//
// 再生記録（entry）の形: { t: ミリ秒時刻, v: 動画ID|null, title: string|null, artist: string|null, artistUrl: string|null }

export const BACKUP_FORMAT = 'ytm-history-analyzer';

const WATCHED_PATTERNS = [
    /^Watched\s+/,
    /\s*を視聴しました$/,
    /\s*を再生しました$/,
    /^Vous avez regardé\s+/,
    /^Has visto\s+/,
    /^Hai guardato\s+/,
    /^Assistiu a\s+/,
    /\s*angesehen$/,
];

export function stripWatched(title) {
    let t = String(title || '').trim();
    for (const re of WATCHED_PATTERNS) t = t.replace(re, '');
    return t.trim();
}

export function extractVideoId(url) {
    if (!url) return null;
    const m = /[?&]v=([\w-]{6,})/.exec(url);
    return m ? m[1] : null;
}

function isZip(bytes) {
    return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const decoder = new TextDecoder('utf-8');

/**
 * ファイル 1 つを解析する。
 * @returns {{ sources: Array<{name: string, kind: string, entries: object[], skipped: number, settings?: object}>, warnings: string[] }}
 */
export async function parseFile(name, buffer) {
    const bytes = new Uint8Array(buffer);
    const warnings = [];
    const sources = [];

    if (isZip(bytes)) {
        const { unzipSync } = await import('./vendor/fflate.js');
        const files = unzipSync(bytes, {
            filter: (f) => /(^|\/)watch-history\.(json|html)$/i.test(f.name),
        });
        const names = Object.keys(files);
        const jsonNames = names.filter((n) => /\.json$/i.test(n));
        if (jsonNames.length === 0) {
            if (names.length > 0) {
                throw new Error('ZIP 内の履歴が HTML 形式です。Google Takeout で履歴の形式を JSON にして書き出してください。');
            }
            throw new Error('ZIP 内に watch-history.json が見つかりません。');
        }
        for (const n of jsonNames) {
            const src = parseText(`${name} › ${n.split('/').pop()}`, decoder.decode(files[n]));
            sources.push(src);
        }
    } else {
        sources.push(parseText(name, decoder.decode(bytes)));
    }

    for (const s of sources) {
        if (s.entries.length === 0) warnings.push(`${s.name}: YouTube Music の再生記録が含まれていません。`);
    }
    return { sources, warnings };
}

export function parseText(name, text) {
    const body = text.replace(/^﻿/, '').trim();
    if (body.startsWith('<')) {
        throw new Error('HTML 形式のファイルです。Google Takeout で履歴の形式を JSON にして書き出してください。');
    }
    let json;
    try {
        json = JSON.parse(body);
    } catch {
        throw new Error('JSON として読み込めませんでした。ファイルが壊れていないか確認してください。');
    }

    if (json && !Array.isArray(json) && json.format === BACKUP_FORMAT) {
        return { name, kind: 'backup', ...parseBackup(json) };
    }
    if (!Array.isArray(json)) {
        throw new Error('対応していない形式です。watch-history.json を選択してください。');
    }
    const sample = json.find((x) => x && typeof x === 'object');
    if (!sample) return { name, kind: 'takeout', entries: [], skipped: 0 };
    if ('time' in sample || 'header' in sample) {
        return { name, kind: 'takeout', ...parseTakeout(json) };
    }
    if ('date' in sample && 'title' in sample) {
        return { name, kind: 'legacy-backup', ...parseLegacyBackup(json) };
    }
    throw new Error('対応していない形式です。watch-history.json を選択してください。');
}

/** Google Takeout の watch-history.json */
export function parseTakeout(items) {
    const entries = [];
    let skipped = 0;
    for (const it of items) {
        if (!it || typeof it.time !== 'string') { skipped++; continue; }
        const url = typeof it.titleUrl === 'string' ? it.titleUrl : '';
        const isMusic = it.header === 'YouTube Music' || url.includes('music.youtube.com');
        if (!isMusic) { skipped++; continue; }
        const t = Date.parse(it.time);
        if (Number.isNaN(t)) { skipped++; continue; }
        let title = stripWatched(it.title);
        if (!title || /^https?:\/\//.test(title)) title = null;
        const sub = Array.isArray(it.subtitles) ? it.subtitles[0] : null;
        entries.push({
            t,
            v: extractVideoId(url),
            title,
            artist: sub && sub.name ? String(sub.name) : null,
            artistUrl: sub && sub.url ? String(sub.url) : null,
        });
    }
    return { entries, skipped };
}

/** 旧バージョンが書き出したバックアップ（再生記録オブジェクトの配列） */
export function parseLegacyBackup(items) {
    const entries = [];
    let skipped = 0;
    for (const it of items) {
        const t = it && Date.parse(it.date);
        if (!it || Number.isNaN(t)) { skipped++; continue; }
        entries.push({
            t,
            v: extractVideoId(it.url),
            title: it.title && it.title !== 'Unknown Title' ? String(it.title) : null,
            artist: it.artist && it.artist !== 'Unknown Artist' ? String(it.artist) : null,
            artistUrl: it.artistUrl || null,
        });
    }
    return { entries, skipped };
}

/** 旧バージョンが IndexedDB に保存していた形式 {t, a, u, au, d} */
export function parseLegacyRecords(items) {
    const entries = [];
    for (const it of items || []) {
        if (!it || typeof it.d !== 'number') continue;
        entries.push({
            t: it.d,
            v: extractVideoId(it.u),
            title: it.t && it.t !== 'Unknown Title' ? String(it.t) : null,
            artist: it.a && it.a !== 'Unknown Artist' ? String(it.a) : null,
            artistUrl: it.au || null,
        });
    }
    return entries;
}

/** このツールのバックアップ形式 */
export function parseBackup(json) {
    const tracks = Array.isArray(json.tracks) ? json.tracks : [];
    const times = Array.isArray(json.times) ? json.times : [];
    const trackIdx = Array.isArray(json.trackIdx) ? json.trackIdx : [];
    const entries = [];
    let skipped = 0;
    for (let i = 0; i < times.length; i++) {
        const tr = tracks[trackIdx[i]];
        if (!tr || typeof times[i] !== 'number') { skipped++; continue; }
        entries.push({ t: times[i], v: tr[0] || null, title: tr[1] || null, artist: tr[2] || null, artistUrl: tr[3] || null });
    }
    return { entries, skipped, settings: json.settings || null };
}
