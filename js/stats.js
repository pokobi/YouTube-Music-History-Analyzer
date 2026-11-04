// 期間を指定して統計を計算する。

import { lowerBound, dayParts, dayWeekday, dayNumber, dayFromYmd } from './util.js';

// --- 期間 ---
// 文字列表現: all / y2024 / l30 / c20240101-20240331

export function parsePeriod(str) {
    const s = String(str || 'all');
    let m;
    if ((m = /^y(\d{4})$/.exec(s))) return { type: 'year', year: +m[1] };
    if ((m = /^l(\d{1,4})$/.exec(s))) return { type: 'last', days: Math.max(1, +m[1]) };
    if ((m = /^c(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})$/.exec(s))) {
        const a = dayFromYmd(+m[1], +m[2] - 1, +m[3]);
        const b = dayFromYmd(+m[4], +m[5] - 1, +m[6]);
        return { type: 'custom', start: Math.min(a, b), end: Math.max(a, b) };
    }
    return { type: 'all' };
}

function ymd(n) {
    const { y, m, d } = dayParts(n);
    return `${y}${String(m + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

export function encodePeriod(p) {
    switch (p.type) {
        case 'year': return `y${p.year}`;
        case 'last': return `l${p.days}`;
        case 'custom': return `c${ymd(p.start)}-${ymd(p.end)}`;
        default: return 'all';
    }
}

/** 期間 → {start, end}（日番号、両端を含む。null は制限なし） */
export function periodRange(p, model) {
    switch (p.type) {
        case 'year': return { start: dayFromYmd(p.year, 0, 1), end: dayFromYmd(p.year, 11, 31) };
        case 'last': {
            const end = model.maxDay ?? dayNumber(Date.now());
            return { start: end - p.days + 1, end };
        }
        case 'custom': return { start: p.start, end: p.end };
        default: return { start: null, end: null };
    }
}

/** 比較対象となる直前の期間 */
export function previousRange(p, model) {
    if (p.type === 'all') return null;
    if (p.type === 'year') return periodRange({ type: 'year', year: p.year - 1 }, model);
    const r = periodRange(p, model);
    const len = r.end - r.start + 1;
    return { start: r.start - len, end: r.start - 1 };
}

export function previousLabel(p) {
    if (p.type === 'year') return `${p.year - 1}年`;
    if (p.type === 'all') return '';
    return '直前の同じ長さの期間';
}

function bounds(model, range) {
    const lo = range.start == null ? 0 : lowerBound(model.day, range.start);
    const hi = range.end == null ? model.n : lowerBound(model.day, range.end + 1);
    return { lo, hi };
}

export function monthOfDay(d) {
    const { y, m } = dayParts(d);
    return y * 12 + m;
}

/** 月ごとの値を、開始月〜終了月まで 0 埋めした配列にする */
function fillMonths(map, startDay, endDay) {
    const out = [];
    if (startDay == null || endDay == null) return out;
    const a = monthOfDay(startDay), b = monthOfDay(endDay);
    for (let mi = a; mi <= b; mi++) out.push({ month: mi, value: map.get(mi) || 0 });
    return out;
}

function monthlyFromDaily(daily) {
    const map = new Map();
    for (const [d, c] of daily) {
        const mi = monthOfDay(d);
        map.set(mi, (map.get(mi) || 0) + c);
    }
    return map;
}

/** 回数の多い順に並べ、同数は同順位（1, 2, 2, 4…）にする */
function rankList(counts, tieBreak) {
    const list = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0) list.push({ i, count: counts[i] });
    list.sort((a, b) => b.count - a.count || tieBreak(a.i, b.i));
    let rank = 0, prev = -1;
    list.forEach((x, idx) => {
        if (x.count !== prev) { rank = idx + 1; prev = x.count; }
        x.rank = rank;
    });
    return list;
}

function countRange(model, range) {
    const { lo, hi } = bounds(model, range);
    const trackCounts = new Uint32Array(model.tracks.length);
    const artistCounts = new Uint32Array(model.artists.length);
    let total = 0;
    for (let i = lo; i < hi; i++) {
        if (model.off[i]) continue;
        const ti = model.trackIdx[i];
        total++;
        trackCounts[ti]++;
        artistCounts[model.tracks[ti].artistIdx]++;
    }
    return { lo, hi, total, trackCounts, artistCounts };
}

/** 比較用：順位だけを求める */
export function computeRanks(model, range) {
    const { total, trackCounts, artistCounts } = countRange(model, range);
    const byFirst = (arr) => (a, b) => arr[a] - arr[b];
    const songs = rankList(trackCounts, byFirst(model.trackFirst));
    const artists = rankList(artistCounts, byFirst(model.artistFirst));
    return {
        total,
        trackCounts,
        artistCounts,
        songRank: new Map(songs.map((x) => [x.i, x.rank])),
        artistRank: new Map(artists.map((x) => [x.i, x.rank])),
    };
}

export function computeStats(model, range) {
    const { lo, hi, total, trackCounts, artistCounts } = countRange(model, range);
    const hourly = new Array(24).fill(0);
    const weekHour = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const daily = new Map();
    const trackMs = new Float64Array(model.tracks.length);
    const artistMs = new Float64Array(model.artists.length);
    let totalMs = 0;
    let skips = 0;
    let skipBase = 0;

    for (let i = lo; i < hi; i++) {
        const ti = model.trackIdx[i];
        if (!model.trackExcluded[ti]) {
            skipBase++;
            if (model.skip[i]) skips++;
        }
        if (model.off[i]) continue;
        const d = model.day[i];
        const h = model.hour[i];
        hourly[h]++;
        weekHour[dayWeekday(d)][h]++;
        daily.set(d, (daily.get(d) || 0) + 1);
        const ms = model.dur[i];
        totalMs += ms;
        trackMs[ti] += ms;
        artistMs[model.tracks[ti].artistIdx] += ms;
    }

    const byFirst = (arr) => (a, b) => arr[a] - arr[b];
    const songs = rankList(trackCounts, byFirst(model.trackFirst));
    const artists = rankList(artistCounts, byFirst(model.artistFirst));

    const days = [...daily.keys()].sort((a, b) => a - b);
    const firstDay = days.length ? days[0] : null;
    const lastDay = days.length ? days[days.length - 1] : null;
    const spanStart = range.start ?? firstDay;
    const spanEnd = range.end ?? lastDay;
    const spanDays = spanStart != null && spanEnd != null ? spanEnd - spanStart + 1 : 0;

    // 連続して再生した日数
    let longest = { length: 0, start: null, end: null };
    let runStart = null;
    for (let k = 0; k < days.length; k++) {
        if (k === 0 || days[k] !== days[k - 1] + 1) runStart = days[k];
        const len = days[k] - runStart + 1;
        if (len > longest.length) longest = { length: len, start: runStart, end: days[k] };
    }

    const monthlyMap = monthlyFromDaily(daily);
    const monthly = fillMonths(monthlyMap, spanStart, spanEnd);

    const yearlyMap = new Map();
    for (const { month, value } of monthly) {
        const y = Math.floor(month / 12);
        yearlyMap.set(y, (yearlyMap.get(y) || 0) + value);
    }
    const yearly = [...yearlyMap.entries()].map(([year, value]) => ({ year, value }));

    // 期間内に初めて再生した曲・アーティスト
    const inSpan = (t) => {
        if (!isFinite(t)) return null;
        const d = dayNumber(t);
        if (spanStart != null && d < spanStart) return null;
        if (spanEnd != null && d > spanEnd) return null;
        return d;
    };
    const newTracksByMonth = new Map();
    const newArtistsByMonth = new Map();
    const newTracks = [];
    const newArtists = [];
    model.trackFirst.forEach((t, ti) => {
        const d = inSpan(t);
        if (d == null) return;
        const mi = monthOfDay(d);
        newTracksByMonth.set(mi, (newTracksByMonth.get(mi) || 0) + 1);
        newTracks.push(ti);
    });
    model.artistFirst.forEach((t, ai) => {
        const d = inSpan(t);
        if (d == null) return;
        const mi = monthOfDay(d);
        newArtistsByMonth.set(mi, (newArtistsByMonth.get(mi) || 0) + 1);
        newArtists.push(ai);
    });

    return {
        range,
        lo,
        hi,
        total,
        totalMs,
        skips,
        skipBase,
        activeDays: daily.size,
        spanStart,
        spanEnd,
        spanDays,
        firstDay,
        lastDay,
        longest,
        songs,
        artists,
        trackCounts,
        artistCounts,
        trackMs,
        artistMs,
        hourly,
        weekHour,
        daily,
        monthly,
        yearly,
        newTracks,
        newArtists,
        newTracksMonthly: fillMonths(newTracksByMonth, spanStart, spanEnd),
        newArtistsMonthly: fillMonths(newArtistsByMonth, spanStart, spanEnd),
    };
}

/** 推定再生時間の順位（回数の順位と同じ形） */
export function rankByTime(stats, type) {
    const ms = type === 'artists' ? stats.artistMs : stats.trackMs;
    const counts = type === 'artists' ? stats.artistCounts : stats.trackCounts;
    const list = [];
    for (let i = 0; i < ms.length; i++) if (counts[i] > 0) list.push({ i, count: counts[i], ms: ms[i] });
    list.sort((a, b) => b.ms - a.ms || b.count - a.count);
    list.forEach((x, k) => { x.rank = k + 1; });
    return list;
}

/** 日番号の昇順配列の中で、window 日間に最も多く含まれる区間 */
export function busiestWindow(days, window = 30) {
    let best = { count: 0, start: null, end: null };
    let j = 0;
    for (let k = 0; k < days.length; k++) {
        while (days[k] - days[j] >= window) j++;
        const c = k - j + 1;
        if (c > best.count) best = { count: c, start: days[j], end: days[k] };
    }
    return best;
}

/** 曲 1 つの詳細（除外中の曲でも数える） */
export function trackDetail(model, ti, range) {
    const { lo, hi } = bounds(model, range);
    const plays = [];
    const days = [];
    const monthMap = new Map();
    let ms = 0, skips = 0;
    for (let i = lo; i < hi; i++) {
        if (model.trackIdx[i] !== ti) continue;
        if (model.excludeSkips && model.skip[i]) continue;
        plays.push(model.times[i]);
        days.push(model.day[i]);
        ms += model.dur[i];
        if (model.skip[i]) skips++;
        const mi = monthOfDay(model.day[i]);
        monthMap.set(mi, (monthMap.get(mi) || 0) + 1);
    }
    const startDay = range.start ?? (days.length ? days[0] : null);
    const endDay = range.end ?? (days.length ? days[days.length - 1] : null);
    plays.reverse();
    return {
        count: plays.length,
        ms,
        skips,
        first: plays.length ? plays[plays.length - 1] : null,
        last: plays.length ? plays[0] : null,
        burst: busiestWindow(days),
        monthly: fillMonths(monthMap, startDay, endDay),
        plays,
    };
}

/** アーティスト 1 人の詳細（アーティストを除外中でも数える） */
export function artistDetail(model, ai, range) {
    const { lo, hi } = bounds(model, range);
    const plays = [];
    const days = [];
    const monthMap = new Map();
    const perTrack = new Map();
    let ms = 0;
    const artistOff = !!model.artistExcluded[ai];
    for (let i = lo; i < hi; i++) {
        const ti = model.trackIdx[i];
        if (model.tracks[ti].artistIdx !== ai) continue;
        if (model.excludeSkips && model.skip[i]) continue;
        if (model.off[i] && !artistOff) continue;
        plays.push({ t: model.times[i], ti });
        days.push(model.day[i]);
        ms += model.dur[i];
        perTrack.set(ti, (perTrack.get(ti) || 0) + 1);
        const mi = monthOfDay(model.day[i]);
        monthMap.set(mi, (monthMap.get(mi) || 0) + 1);
    }
    const startDay = range.start ?? (days.length ? days[0] : null);
    const endDay = range.end ?? (days.length ? days[days.length - 1] : null);
    plays.reverse();
    const topTracks = [...perTrack.entries()]
        .map(([ti, count]) => ({ ti, count }))
        .sort((a, b) => b.count - a.count || model.trackFirst[a.ti] - model.trackFirst[b.ti]);
    return {
        count: plays.length,
        ms,
        first: plays.length ? plays[plays.length - 1].t : null,
        last: plays.length ? plays[0].t : null,
        burst: busiestWindow(days),
        monthly: fillMonths(monthMap, startDay, endDay),
        topTracks,
        plays,
    };
}

/** 1 日分の再生 */
export function dayDetail(model, d) {
    const lo = lowerBound(model.day, d);
    const hi = lowerBound(model.day, d + 1);
    const plays = [];
    const perArtist = new Map();
    let ms = 0;
    for (let i = lo; i < hi; i++) {
        if (model.off[i]) continue;
        const ti = model.trackIdx[i];
        plays.push({ t: model.times[i], ti, skip: !!model.skip[i] });
        ms += model.dur[i];
        const ai = model.tracks[ti].artistIdx;
        perArtist.set(ai, (perArtist.get(ai) || 0) + 1);
    }
    const topArtists = [...perArtist.entries()].map(([i, count]) => ({ i, count })).sort((a, b) => b.count - a.count);
    return { count: plays.length, ms, plays, topArtists };
}

/**
 * ハマった曲（一定の日数に集中して再生した曲）と、最近聴かなくなった曲
 * dormantDays: データの最終日からこの日数より前が最後の再生なら「聴かなくなった」とみなす
 */
export function computeHighlights(model, stats, { window = 30, dormantDays = 90, minPlays = 5 } = {}) {
    const perTrack = new Map();
    for (let i = stats.lo; i < stats.hi; i++) {
        if (model.off[i]) continue;
        const ti = model.trackIdx[i];
        if (stats.trackCounts[ti] < minPlays) continue;
        let list = perTrack.get(ti);
        if (!list) perTrack.set(ti, (list = []));
        list.push(model.day[i]);
    }
    const bursts = [];
    for (const [ti, days] of perTrack) {
        const b = busiestWindow(days, window);
        bursts.push({ i: ti, count: b.count, start: b.start, end: b.end, total: days.length });
    }
    bursts.sort((a, b) => b.count - a.count || b.total - a.total);

    const cutoff = model.maxDay - dormantDays;
    const dormant = stats.songs
        .filter((x) => x.count >= minPlays && isFinite(model.trackLast[x.i]) && dayNumber(model.trackLast[x.i]) < cutoff)
        .slice(0, 10)
        .map((x) => ({ ...x, last: model.trackLast[x.i] }));

    return { bursts: bursts.slice(0, 10), dormant, dormantDays, window };
}
