// 各画面の HTML を組み立てる。状態の変更はしない。

import { html, formatNumber, formatDay, formatDate, formatDateTime, formatPercent, formatDuration, monthLabel, WEEKDAYS, dayToInput, dayWeekday, dayParts, normalizeText } from './util.js';
import { icon } from './icons.js';
import { barChart, calendarHeatmap, weekHourHeatmap, donutChart, monthItems, dayItems } from './charts.js';
import { previousLabel, monthOfDay, rankByTime } from './stats.js';
import { resolveAlias, findMergeCandidates } from './model.js';

export const TABS = [
    ['overview', '概要'],
    ['ranking', 'ランキング'],
    ['trends', '傾向'],
    ['compare', '比較'],
    ['summary', '年間まとめ'],
    ['data', 'データ管理'],
];

// --- 共通部品 ---

function songUrl(v) {
    return v ? `https://music.youtube.com/watch?v=${encodeURIComponent(v)}` : null;
}

function thumb(state, v, size = '') {
    if (state.settings.showThumbnails && v) {
        return html`<span class="thumb ${size}"><img src="https://i.ytimg.com/vi/${v}/mqdefault.jpg" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
    }
    return html`<span class="thumb thumb--empty ${size}">${icon('music')}</span>`;
}

function initial(name) {
    return (Array.from(name || '?')[0] || '?').toUpperCase();
}

/** アーティストの画像（チャンネルのアイコン → いちばん聴いた曲のジャケット → 頭文字） */
export function avatar(state, a, size = '') {
    if (state.settings.showThumbnails) {
        const ch = a.channelId ? state.channelImages[a.channelId] : null;
        const src = ch || (a.imageV ? `https://i.ytimg.com/vi/${a.imageV}/mqdefault.jpg` : null);
        if (src) {
            return html`<span class="avatar ${size}" aria-hidden="true" data-initial="${initial(a.name)}"><img src="${src}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
        }
    }
    return html`<span class="avatar ${size}" aria-hidden="true">${initial(a.name)}</span>`;
}

function changeBadge(prevMap, i, rank) {
    if (!prevMap) return '';
    const prev = prevMap.get(i);
    if (prev == null) return html`<span class="change change--new" title="前の期間には再生なし">NEW</span>`;
    const diff = prev - rank;
    if (diff > 0) return html`<span class="change change--up" title="前の期間 ${prev}位">▲${diff}</span>`;
    if (diff < 0) return html`<span class="change change--down" title="前の期間 ${prev}位">▼${-diff}</span>`;
    return html`<span class="change change--same" title="前の期間 ${prev}位">—</span>`;
}

function deltaText(cur, prev, label) {
    if (!prev) return '';
    const r = cur / prev - 1;
    const sign = r > 0 ? '+' : '';
    const cls = r > 0 ? 'delta--up' : r < 0 ? 'delta--down' : '';
    return html`<span class="delta ${cls}">${label ? `${label}比 ` : ''}${sign}${(r * 100).toFixed(1)}%</span>`;
}

function tile(label, value, sub = '') {
    return html`
        <div class="tile">
            <p class="tile__label">${label}</p>
            <p class="tile__value">${value}</p>
            ${sub ? html`<p class="tile__sub">${sub}</p>` : ''}
        </div>`;
}

function card(title, body, { actions = '', cls = '', sub = '' } = {}) {
    return html`
        <section class="card ${cls}">
            <header class="card__head">
                <div><h2 class="card__title">${title}</h2>${sub ? html`<p class="card__sub">${sub}</p>` : ''}</div>
                ${actions ? html`<div class="card__actions">${actions}</div>` : ''}
            </header>
            ${body}
        </section>`;
}

function segmented(name, value, options) {
    return html`<div class="segmented" role="group">${options.map(([v, label]) => html`<button type="button" data-action="${name}" data-value="${v}" aria-pressed="${v === value}">${label}</button>`)}</div>`;
}

function countCell(item, byTime) {
    if (byTime) return html`<span class="row__count row__count--time">${formatDuration(item.ms)}<small>${formatNumber(item.count)}回</small></span>`;
    return html`<span class="row__count">${formatNumber(item.count)}<small>回</small></span>`;
}

export function songRow(state, item, { max, prevMap, showChange = true, compact = false, search = '', byTime = false, sub = '', count = true } = {}) {
    const { model } = state;
    const t = model.tracks[item.i];
    const artist = model.artists[t.artistIdx];
    const value = byTime ? item.ms : item.count;
    const pct = max ? (value / max) * 100 : 0;
    return html`
        <li>
            <button type="button" class="row ${compact ? 'row--compact' : ''}" data-action="open-song" data-key="${t.key}">
                ${item.rank != null ? html`<span class="row__rank ${item.rank <= 3 ? 'is-top' : ''}">${item.rank}</span>` : ''}
                ${showChange ? html`<span class="row__change">${changeBadge(prevMap, item.i, item.rank)}</span>` : ''}
                ${thumb(state, t.v)}
                <span class="row__main">
                    <span class="row__title">${highlight(t.title, search)}</span>
                    <span class="row__subtitle">${sub || highlight(artist.name, search)}</span>
                    ${compact ? '' : html`<span class="row__bar"><span style="width:${pct.toFixed(2)}%"></span></span>`}
                </span>
                ${count ? countCell(item, byTime) : ''}
            </button>
        </li>`;
}

export function artistRow(state, item, { max, prevMap, total, showChange = true, compact = false, search = '', byTime = false, sub = '' } = {}) {
    const a = state.model.artists[item.i];
    const value = byTime ? item.ms : item.count;
    const pct = max ? (value / max) * 100 : 0;
    const subText = sub || (total ? formatPercent(item.count / total) : '');
    return html`
        <li>
            <button type="button" class="row ${compact ? 'row--compact' : ''}" data-action="open-artist" data-key="${a.key}">
                ${item.rank != null ? html`<span class="row__rank ${item.rank <= 3 ? 'is-top' : ''}">${item.rank}</span>` : ''}
                ${showChange ? html`<span class="row__change">${changeBadge(prevMap, item.i, item.rank)}</span>` : ''}
                ${avatar(state, a)}
                <span class="row__main">
                    <span class="row__title">${highlight(a.name, search)}</span>
                    ${subText ? html`<span class="row__subtitle">${subText}</span>` : ''}
                    ${compact ? '' : html`<span class="row__bar"><span style="width:${pct.toFixed(2)}%"></span></span>`}
                </span>
                ${countCell(item, byTime)}
            </button>
        </li>`;
}

function highlight(text, term) {
    if (!term) return text;
    const src = String(text);
    const norm = normalizeText(src);
    const q = normalizeText(term);
    const idx = norm.indexOf(q);
    // 正規化で長さが変わる文字を含む場合は強調しない
    if (idx < 0 || norm.length !== src.length) return text;
    return html`${src.slice(0, idx)}<mark>${src.slice(idx, idx + q.length)}</mark>${src.slice(idx + q.length)}`;
}

function periodText(s) {
    if (s.spanStart == null) return '';
    return `${formatDay(s.spanStart)} 〜 ${formatDay(s.spanEnd)}（${formatNumber(s.spanDays)}日間）`;
}

function emptyPeriod() {
    return html`
        <div class="empty-state">
            ${icon('search', 'icon--lg')}
            <h2>この期間の再生記録はありません</h2>
            <p>期間の選択を変えてください。</p>
        </div>`;
}

function activityChart(s, height = 200) {
    if (s.spanDays && s.spanDays <= 92) {
        return barChart(dayItems(s.daily, s.spanStart, s.spanEnd), { height, ariaLabel: '日別の再生回数' });
    }
    return barChart(monthItems(s.monthly), { height, ariaLabel: '月別の再生回数' });
}

function skipText(state, s) {
    if (!s.skipBase) return '';
    const ratio = formatPercent(s.skips / s.skipBase);
    return state.settings.excludeSkips ? `${ratio}（集計から除外中）` : `全再生の ${ratio}`;
}

// --- 概要 ---

export function overviewView(state) {
    const s = state.stats;
    if (!s.total) return emptyPeriod();
    const prevLabel = state.prev ? previousLabel(state.period) : '';
    const isAll = state.period.type === 'all';
    const topSongs = s.songs.slice(0, 5);
    const topArtists = s.artists.slice(0, 5);

    const calYears = calendarYears(state);
    const calYear = calYears.includes(state.calYear) ? state.calYear : calYears[0];
    const yi = calYears.indexOf(calYear);
    const calNav = html`
        <div class="stepper">
            <button type="button" class="icon-btn" data-action="cal-year" data-value="${calYears[yi + 1] ?? ''}" ${yi + 1 >= calYears.length ? 'disabled' : ''} aria-label="前の年">${icon('chevronLeft')}</button>
            <span class="stepper__label">${calYear}年</span>
            <button type="button" class="icon-btn" data-action="cal-year" data-value="${calYears[yi - 1] ?? ''}" ${yi <= 0 ? 'disabled' : ''} aria-label="次の年">${icon('chevronRight')}</button>
        </div>`;

    return html`
        <p class="period-line">${periodText(s)}</p>
        <div class="tiles">
            ${tile('再生回数', formatNumber(s.total), deltaText(s.total, state.prev?.total, prevLabel))}
            ${tile('推定再生時間', formatDuration(s.totalMs), '次の再生までの間隔から推定')}
            ${tile('再生した日', `${formatNumber(s.activeDays)}日`, `期間 ${formatNumber(s.spanDays)}日のうち ${formatPercent(s.activeDays / s.spanDays, 0)}`)}
            ${tile('1日あたり', `${(s.total / s.activeDays).toFixed(1)}回`, `再生した日の平均 ・ ${formatDuration(s.totalMs / s.activeDays)}`)}
            ${tile('最長連続', `${formatNumber(s.longest.length)}日`, s.longest.start != null ? `${formatDay(s.longest.start)} 〜 ${formatDay(s.longest.end)}` : '')}
            ${tile('曲', formatNumber(s.songs.length), isAll ? '' : `初めて聴いた曲 ${formatNumber(s.newTracks.length)}`)}
            ${tile('アーティスト', formatNumber(s.artists.length), isAll ? '' : `初めて聴いたアーティスト ${formatNumber(s.newArtists.length)}`)}
            ${tile('スキップ', `${formatNumber(s.skips)}回`, skipText(state, s))}
        </div>
        <div class="grid-2">
            ${card('よく聴いた曲', html`<ol class="rows">${topSongs.map((x) => songRow(state, x, { compact: true, showChange: false }))}</ol>`, {
                actions: html`<button type="button" class="link-btn" data-action="goto-ranking" data-value="songs">すべて見る</button>`,
            })}
            ${card('よく聴いたアーティスト', html`<ol class="rows">${topArtists.map((x) => artistRow(state, x, { compact: true, showChange: false, total: s.total }))}</ol>`, {
                actions: html`<button type="button" class="link-btn" data-action="goto-ranking" data-value="artists">すべて見る</button>`,
            })}
        </div>
        ${card('再生回数の推移', activityChart(s), { sub: s.spanDays <= 92 ? '日別' : '月別' })}
        ${calYears.length ? card('カレンダー', calendarHeatmap(s.daily, calYear), { actions: calNav, sub: '日ごとの再生回数。日を押すとその日の再生を表示します' }) : ''}`;
}

/** 期間内に含まれる年（新しい順） */
export function calendarYears(state) {
    const s = state.stats;
    if (s.firstDay == null) return [];
    const a = Math.floor(monthOfDay(s.firstDay) / 12);
    const b = Math.floor(monthOfDay(s.lastDay) / 12);
    const out = [];
    for (let y = b; y >= a; y--) out.push(y);
    return out;
}

// --- ランキング ---

export function rankingView(state) {
    const s = state.stats;
    if (!s.total) return emptyPeriod();
    const isSongs = state.rankType === 'songs';
    const byTime = state.rankSort === 'time';
    return html`
        <div class="toolbar">
            ${segmented('rank-type', state.rankType, [['songs', '曲'], ['artists', 'アーティスト']])}
            ${segmented('rank-sort', state.rankSort, [['count', '回数順'], ['time', '時間順']])}
            <label class="search">
                ${icon('search')}
                <input type="search" id="rank-search" placeholder="${isSongs ? '曲名・アーティスト名で検索' : 'アーティスト名で検索'}" value="${state.search}" autocomplete="off" aria-label="ランキングを検索">
            </label>
            <button type="button" class="btn btn--ghost" data-action="export-csv" data-value="${state.rankType}">${icon('download')}<span>CSV</span></button>
        </div>
        ${byTime ? html`<p class="hint">推定再生時間の順です。時間は次の再生までの間隔から推定しています。</p>`
            : state.prev ? html`<p class="hint">順位の横の矢印は ${previousLabel(state.period)} との比較です。</p>` : ''}
        <div id="rank-list">${rankingList(state)}</div>`;
}

export function rankingList(state) {
    const s = state.stats;
    const isSongs = state.rankType === 'songs';
    const byTime = state.rankSort === 'time';
    const list = byTime ? timeRanking(state) : isSongs ? s.songs : s.artists;
    const q = normalizeText(state.search.trim());
    const filtered = q ? list.filter((x) => searchText(state, isSongs, x.i).includes(q)) : list;
    const shown = filtered.slice(0, state.rankLimit);
    const max = list[0] ? (byTime ? list[0].ms : list[0].count) : 0;
    const prevMap = state.prev && !byTime ? (isSongs ? state.prev.songRank : state.prev.artistRank) : null;
    if (!filtered.length) return html`<p class="empty-note">「${state.search}」に一致する${isSongs ? '曲' : 'アーティスト'}はありません。</p>`;
    const search = state.search.trim();
    return html`
        <ol class="rows rows--ranking">
            ${shown.map((x) => (isSongs
                ? songRow(state, x, { max, prevMap, search, byTime, showChange: !byTime })
                : artistRow(state, x, { max, prevMap, total: s.total, search, byTime, showChange: !byTime })))}
        </ol>
        <div class="list-foot">
            <span>${formatNumber(filtered.length)}件中 ${formatNumber(shown.length)}件を表示</span>
            ${shown.length < filtered.length ? html`<button type="button" class="btn" data-action="more">さらに表示</button>` : ''}
        </div>`;
}

function timeRanking(state) {
    const key = state.rankType;
    if (!state.timeRankCache[key]) state.timeRankCache[key] = rankByTime(state.stats, key);
    return state.timeRankCache[key];
}

function searchText(state, isSongs, i) {
    const cache = isSongs ? state.searchCache.songs : state.searchCache.artists;
    let v = cache.get(i);
    if (v === undefined) {
        const { model } = state;
        v = isSongs
            ? normalizeText([model.tracks[i].title, ...model.tracks[i].variants, model.artists[model.tracks[i].artistIdx].name].join('\n'))
            : normalizeText([model.artists[i].name, ...model.artists[i].aliasNames].join('\n'));
        cache.set(i, v);
    }
    return v;
}

// --- 傾向 ---

export function trendsView(state, highlights) {
    const s = state.stats;
    if (!s.total) return emptyPeriod();
    const { model } = state;
    const hourly = s.hourly.map((v, h) => ({ value: v, label: h % 3 === 0 ? `${h}` : '', tip: `${h}時台 ${formatNumber(v)}回` }));
    const weekdayTotals = [1, 2, 3, 4, 5, 6, 0].map((wd) => {
        const v = s.weekHour[wd].reduce((a, b) => a + b, 0);
        return { value: v, label: WEEKDAYS[wd], tip: `${WEEKDAYS[wd]}曜 ${formatNumber(v)}回` };
    });
    const yearly = s.yearly.map((y) => ({ value: y.value, label: `${y.year}`, tip: `${y.year}年 ${formatNumber(y.value)}回` }));
    const isArtist = state.discoverType === 'artists';
    const discover = monthItems(isArtist ? s.newArtistsMonthly : s.newTracksMonthly, isArtist ? '組' : '曲');

    const shareItems = s.artists.slice(0, 7).map((x) => ({ label: model.artists[x.i].name, value: x.count }));
    const rest = s.total - shareItems.reduce((a, b) => a + b.value, 0);
    if (rest > 0) shareItems.push({ label: 'その他', value: rest, other: true });

    const { bursts, dormant, dormantDays, window } = highlights;

    return html`
        <p class="period-line">${periodText(s)}</p>
        <div class="grid-2">
            ${card('時間帯', barChart(hourly, { height: 160, ariaLabel: '時間帯別の再生回数' }), { sub: '何時台に聴いたか' })}
            ${card('曜日', barChart(weekdayTotals, { height: 160, ariaLabel: '曜日別の再生回数' }))}
        </div>
        ${card('曜日 × 時間帯', weekHourHeatmap(s.weekHour))}
        <div class="grid-2">
            ${card('ハマった曲', bursts.length
                ? html`<ol class="rows">${bursts.map((x, k) => songRow(state, { i: x.i, count: x.count, rank: k + 1 }, { compact: true, showChange: false, sub: `${formatDay(x.start)} 〜 ${formatDay(x.end)}` }))}</ol>`
                : html`<p class="empty-note">ありません</p>`, { sub: `${window}日間に集中して聴いた回数が多い曲` })}
            ${card('最近聴いていない曲', dormant.length
                ? html`<ol class="rows">${dormant.map((x) => songRow(state, { i: x.i, count: x.count }, { compact: true, showChange: false, sub: `最後に聴いた日 ${formatDate(x.last)}` }))}</ol>`
                : html`<p class="empty-note">ありません</p>`, { sub: `この期間によく聴いたが、データの最終日までの ${dormantDays}日間は聴いていない曲` })}
        </div>
        <div class="grid-2">
            ${card('アーティストの割合', donutChart(shareItems, s.total), { sub: '上位 7 組とその他' })}
            ${yearly.length > 1 ? card('年ごとの再生回数', barChart(yearly, { height: 200, ariaLabel: '年別の再生回数' })) : card('再生回数の推移', activityChart(s))}
        </div>
        ${card('初めて聴いた数', discover.some((x) => x.value > 0) ? barChart(discover, { height: 180, ariaLabel: '月別の初めて聴いた数' }) : html`<p class="empty-note">この期間に初めて再生した${isArtist ? 'アーティスト' : '曲'}はありません。</p>`, {
            sub: 'その月に初めて再生した数（全期間の記録で判定）',
            actions: segmented('discover-type', state.discoverType, [['artists', 'アーティスト'], ['songs', '曲']]),
        })}`;
}

// --- 比較 ---

export function compareView(state, A, B) {
    const { model } = state;
    const head = html`
        <div class="compare-pickers">
            <div class="compare-picker"><span class="badge badge--a">A</span>${periodSelect(state, 'cmp-a', state.cmpA)}</div>
            <div class="compare-picker"><span class="badge badge--b">B</span>${periodSelect(state, 'cmp-b', state.cmpB)}</div>
        </div>`;
    if (!A.total && !B.total) return html`${head}${emptyPeriod()}`;

    const rows = [
        ['再生回数', A.total, B.total, formatNumber],
        ['推定再生時間', A.totalMs, B.totalMs, formatDuration],
        ['再生した日', A.activeDays, B.activeDays, (v) => `${formatNumber(v)}日`],
        ['1日あたり', A.activeDays ? A.total / A.activeDays : 0, B.activeDays ? B.total / B.activeDays : 0, (v) => `${v.toFixed(1)}回`],
        ['曲', A.songs.length, B.songs.length, formatNumber],
        ['アーティスト', A.artists.length, B.artists.length, formatNumber],
        ['最長連続', A.longest.length, B.longest.length, (v) => `${formatNumber(v)}日`],
    ];

    const isSongs = state.cmpType === 'songs';
    const allA = isSongs ? A.songs : A.artists;
    const allB = isSongs ? B.songs : B.artists;
    const listB = allB.slice(0, 30);
    const mapA = new Map(allA.map((x) => [x.i, x]));
    const mapB = new Map(allB.map((x) => [x.i, x]));
    const name = (i) => (isSongs ? model.tracks[i].title : model.artists[i].name);
    const sub = (i) => (isSongs ? model.artists[model.tracks[i].artistIdx].name : '');
    const action = isSongs ? 'open-song' : 'open-artist';
    const keyOf = (i) => (isSongs ? model.tracks[i].key : model.artists[i].key);

    // A では上位 30 に入っていたが、B では 30 位より下（または再生なし）になったもの
    const dropped = allA.slice(0, 30).filter((x) => { const b = mapB.get(x.i); return !b || b.rank > 30; }).slice(0, 10);
    const droppedNote = (x) => {
        const b = mapB.get(x.i);
        return `A ${x.rank}位 → B ${b ? `${b.rank}位（${formatNumber(b.count)}回）` : '再生なし'}`;
    };

    return html`
        ${head}
        <div class="period-line compare-lines">
            <span><span class="badge badge--a">A</span> ${periodText(A) || 'データなし'}${dataNote(model, A)}</span>
            <span><span class="badge badge--b">B</span> ${periodText(B) || 'データなし'}${dataNote(model, B)}</span>
        </div>
        ${card('数値', html`
            <div class="table-wrap"><table class="table table--compare">
                <thead><tr><th></th><th class="num">A</th><th class="num">B</th><th class="num">B − A</th></tr></thead>
                <tbody>${rows.map(([label, a, b, fmt]) => html`<tr><th scope="row">${label}</th><td class="num">${fmt(a)}</td><td class="num">${fmt(b)}</td><td class="num">${a ? deltaText(b, a, '') : '-'}</td></tr>`)}</tbody>
            </table></div>`)}
        ${card(`B の上位 ${listB.length}`, listB.length ? html`
            <div class="table-wrap"><table class="table table--rank">
                <thead><tr><th class="num">B</th><th>${isSongs ? '曲' : 'アーティスト'}</th><th class="num">B の回数</th><th class="num">A の順位</th><th class="num">A の回数</th></tr></thead>
                <tbody>${listB.map((x) => {
                    const a = mapA.get(x.i);
                    const diff = a ? a.rank - x.rank : null;
                    return html`<tr>
                        <td class="num">${x.rank}</td>
                        <td class="cell-name"><button type="button" class="link-btn link-btn--plain" data-action="${action}" data-key="${keyOf(x.i)}"><span>${name(x.i)}</span>${sub(x.i) ? html`<small>${sub(x.i)}</small>` : ''}</button></td>
                        <td class="num">${formatNumber(x.count)}</td>
                        <td class="num">${a ? html`${a.rank} ${diff > 0 ? html`<span class="change change--up">▲${diff}</span>` : diff < 0 ? html`<span class="change change--down">▼${-diff}</span>` : ''}` : html`<span class="change change--new">NEW</span>`}</td>
                        <td class="num">${a ? formatNumber(a.count) : '-'}</td>
                    </tr>`;
                })}</tbody>
            </table></div>` : html`<p class="empty-note">B の期間に再生記録はありません。</p>`, {
            actions: segmented('cmp-type', state.cmpType, [['songs', '曲'], ['artists', 'アーティスト']]),
        })}
        ${card('A では上位だった', dropped.length
            ? html`<ol class="rows">${dropped.map((x) => (isSongs
                ? songRow(state, { i: x.i, count: x.count }, { compact: true, showChange: false, sub: droppedNote(x) })
                : artistRow(state, { i: x.i, count: x.count }, { compact: true, showChange: false, sub: droppedNote(x) })))}</ol>`
            : html`<p class="empty-note">ありません</p>`, { sub: 'A の上位 30 に入っていて、B では 30 位より下になったもの（回数は A の期間）' })}`;
}

/** 期間の一部にしか記録がないときの注記 */
function dataNote(model, s) {
    if (s.spanStart == null) return '';
    if (s.spanEnd > model.maxDay) return ` ・ 記録は ${formatDay(model.maxDay)} まで`;
    if (s.spanStart < model.minDay) return ` ・ 記録は ${formatDay(model.minDay)} から`;
    return '';
}

function periodSelect(state, id, period) {
    const { model } = state;
    const cur = period.type === 'year' ? `y${period.year}` : period.type === 'last' ? `l${period.days}` : period.type;
    const opts = [['all', '全期間'], ['l30', '直近 30 日'], ['l90', '直近 90 日'], ['l365', '直近 1 年']];
    for (const y of model.years) opts.push([`y${y}`, `${y}年`]);
    opts.push(['custom', '期間を指定']);
    return html`
        <span class="period">
            <select data-period-select="${id}" aria-label="期間 ${id === 'cmp-a' ? 'A' : 'B'}">${opts.map(([v, l]) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`)}</select>
            ${period.type === 'custom' ? html`
                <span class="period-custom">
                    <input type="date" data-period-start="${id}" value="${dayToInput(period.start)}" min="${dayToInput(model.minDay)}" max="${dayToInput(model.maxDay)}" aria-label="開始日">
                    <span>〜</span>
                    <input type="date" data-period-end="${id}" value="${dayToInput(period.end)}" min="${dayToInput(model.minDay)}" max="${dayToInput(model.maxDay)}" aria-label="終了日">
                </span>` : ''}
        </span>`;
}

// --- 年間まとめ ---

export function summaryView(state, ys, prevTotal) {
    const { model } = state;
    const years = model.years;
    const year = state.summaryYear;
    const chips = html`<div class="chips" role="group" aria-label="年を選択">${years.map((y) => html`<button type="button" class="chip" data-action="summary-year" data-value="${y}" aria-pressed="${y === year}">${y}</button>`)}</div>`;
    if (!ys || !ys.total) return html`${chips}${emptyPeriod()}`;

    // 記録が年の途中から（または途中まで）しかない年
    const partial = ys.spanStart < model.minDay || ys.spanEnd > model.maxDay;
    const topSong = ys.songs[0];
    const topArtist = ys.artists[0];
    const st = model.tracks[topSong.i];
    const sa = model.artists[topArtist.i];
    let topMonth = ys.monthly[0];
    for (const m of ys.monthly) if (m.value > topMonth.value) topMonth = m;
    const wdTotals = ys.weekHour.map((r) => r.reduce((a, b) => a + b, 0));
    const topWd = wdTotals.indexOf(Math.max(...wdTotals));
    const topHour = ys.hourly.indexOf(Math.max(...ys.hourly));
    const newArtists = ys.newArtists
        .map((ai) => ({ i: ai, count: ys.artistCounts[ai] }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map((x, k) => ({ ...x, rank: k + 1 }));

    return html`
        ${chips}
        <section class="hero">
            <p class="hero__label">${year}年の再生回数</p>
            <p class="hero__value">${formatNumber(ys.total)}<small>回</small></p>
            <p class="hero__sub">推定 ${formatDuration(ys.totalMs)}${prevTotal ? html` ・ ${deltaText(ys.total, prevTotal, `${year - 1}年`)}` : ''}</p>
            ${partial ? html`<p class="hero__note">この年の記録は ${formatDay(Math.max(ys.spanStart, model.minDay))} 〜 ${formatDay(Math.min(ys.spanEnd, model.maxDay))} の分だけです</p>` : ''}
        </section>
        <div class="grid-2">
            <button type="button" class="feature" data-action="open-song" data-key="${st.key}">
                ${thumb(state, st.v, 'thumb--xl')}
                <span class="feature__body">
                    <span class="feature__label">いちばん聴いた曲</span>
                    <span class="feature__title">${st.title}</span>
                    <span class="feature__sub">${model.artists[st.artistIdx].name} ・ ${formatNumber(topSong.count)}回</span>
                </span>
            </button>
            <button type="button" class="feature" data-action="open-artist" data-key="${sa.key}">
                ${avatar(state, sa, 'avatar--xl')}
                <span class="feature__body">
                    <span class="feature__label">いちばん聴いたアーティスト</span>
                    <span class="feature__title">${sa.name}</span>
                    <span class="feature__sub">${formatNumber(topArtist.count)}回 ・ ${formatPercent(topArtist.count / ys.total)}</span>
                </span>
            </button>
        </div>
        <div class="tiles">
            ${tile('再生した日', `${formatNumber(ys.activeDays)}日`)}
            ${tile('最長連続', `${formatNumber(ys.longest.length)}日`)}
            ${tile('よく聴いた月', `${(topMonth.month % 12) + 1}月`, `${formatNumber(topMonth.value)}回`)}
            ${tile('よく聴いた曜日', `${WEEKDAYS[topWd]}曜`, `${formatNumber(wdTotals[topWd])}回`)}
            ${tile('よく聴いた時間帯', `${topHour}時台`, `${formatNumber(ys.hourly[topHour])}回`)}
            ${tile('新しいアーティスト', formatNumber(ys.newArtists.length), `新しい曲 ${formatNumber(ys.newTracks.length)}`)}
            ${tile('曲', formatNumber(ys.songs.length))}
            ${tile('アーティスト', formatNumber(ys.artists.length))}
        </div>
        <div class="grid-2">
            ${card('曲 TOP 10', html`<ol class="rows">${ys.songs.slice(0, 10).map((x) => songRow(state, x, { compact: true, showChange: false }))}</ol>`)}
            ${card('アーティスト TOP 10', html`<ol class="rows">${ys.artists.slice(0, 10).map((x) => artistRow(state, x, { compact: true, showChange: false, total: ys.total }))}</ol>`)}
        </div>
        <div class="grid-2">
            ${card('月ごとの再生回数', barChart(monthItems(ys.monthly), { height: 180, ariaLabel: '月別の再生回数' }))}
            ${card('この年に出会ったアーティスト', newArtists.length
                ? html`<ol class="rows">${newArtists.map((x) => artistRow(state, x, { compact: true, showChange: false }))}</ol>`
                : html`<p class="empty-note">ありません</p>`, { sub: 'この年に初めて再生し、よく聴いた順' })}
        </div>`;
}

// --- データ管理 ---

export function dataView(state) {
    const { model, settings, imports } = state;
    const exArtists = settings.excludedArtists.map((key) => {
        const a = model.artists.find((x) => x.key === key);
        return { key, name: a ? a.name : key.replace(/^a:/, '') };
    });
    const exTracks = settings.excludedTracks.map((key) => {
        const t = model.tracks.find((x) => x.key === key);
        return { key, name: t ? `${t.title} / ${model.artists[t.artistIdx].name}` : key };
    });
    const aliasEntries = Object.entries(settings.aliases).map(([from, to]) => {
        const target = model.artists.find((x) => x.key === resolveAlias(settings.aliases, to));
        const fromTrack = model.tracks.find((t) => t.ownArtistKey === from);
        return { from, fromName: fromTrack ? fromTrack.ownArtistName : from.replace(/^a:/, ''), toName: target ? target.name : to.replace(/^a:/, '') };
    });
    const rawTitle = new Map(state.dataset.tracks.map((t) => [t.key, t.title]));
    const trackAliasEntries = Object.entries(settings.trackAliases).map(([from, to]) => {
        const target = model.tracks.find((x) => x.key === resolveAlias(settings.trackAliases, to));
        return { from, fromName: rawTitle.get(from) || from, toName: target ? target.title : to };
    });
    const allCandidates = findMergeCandidates(model, settings.ignoredSuggestions);
    const candidates = allCandidates.slice(0, 30);
    const channelCount = new Set(model.artists.map((a) => a.channelId).filter(Boolean)).size;
    const fetched = Object.values(state.channelImages).filter(Boolean).length;

    return html`
        ${card('保存されているデータ', html`
            <dl class="facts">
                <div><dt>再生記録</dt><dd>${formatNumber(model.n)}件</dd></div>
                <div><dt>期間</dt><dd>${formatDay(model.minDay)} 〜 ${formatDay(model.maxDay)}</dd></div>
                <div><dt>曲</dt><dd>${formatNumber(model.tracks.length)}</dd></div>
                <div><dt>アーティスト</dt><dd>${formatNumber(model.artists.length)}</dd></div>
            </dl>
            <p class="note">${icon('lock')} データはこのブラウザの中だけに保存されます。別のブラウザやシークレットウィンドウとは共有されません。</p>
            <div class="status-row">
                ${state.persisted == null ? html`<span class="status">このブラウザは保存データの保護に対応していません。</span>`
                    : state.persisted ? html`<span class="status status--ok">${icon('check')} 保存データは保護されています（容量が足りなくなっても、ブラウザに自動で消されません）。</span>`
                    : html`<span class="status">${icon('alert')} 保存データは保護されていません。容量が足りなくなると、ブラウザに消されることがあります。</span>
                        <button type="button" class="btn btn--small" data-action="persist">保護を有効にする</button>`}
            </div>
        `, { actions: html`<button type="button" class="btn btn--primary" data-action="add-files">${icon('plus')}<span>ファイルを追加</span></button>` })}

        ${card('読み込み履歴', imports.length ? html`
            <div class="table-wrap"><table class="table">
                <thead><tr><th>ファイル</th><th>読み込み日時</th><th class="num">記録</th><th class="num">追加</th></tr></thead>
                <tbody>${imports.map((x) => html`<tr><td class="ellipsis" title="${x.name}">${x.name}</td><td>${formatDateTime(x.importedAt)}</td><td class="num">${formatNumber(x.entries)}</td><td class="num">${formatNumber(x.added)}</td></tr>`)}</tbody>
            </table></div>
            <p class="note">新しいファイルは保存済みのデータに結合されます。同じ日時・同じ曲の記録は重複として除かれます。</p>` : html`<p class="empty-note">ありません</p>`)}

        <div class="grid-2">
            ${card('再生の扱い', html`
                <label class="switch">
                    <input type="checkbox" data-action="toggle-skips" ${settings.excludeSkips ? 'checked' : ''}>
                    <span>スキップした再生を集計から除外する</span>
                </label>
                <p class="note">次の再生まで 30 秒未満だった再生をスキップとみなします。再生時間は、次の再生までの間隔（その曲のふだんの長さが上限）から推定しています。</p>
            `)}
            ${card('表示', html`
                <label class="switch">
                    <input type="checkbox" data-action="toggle-thumbs" ${settings.showThumbnails ? 'checked' : ''}>
                    <span>画像（ジャケット・アーティスト画像）を表示する</span>
                </label>
                <p class="note">画像は YouTube の画像サーバーから読み込みます。オフにすると外部への通信はなくなります。</p>
            `)}
        </div>

        ${card('アーティスト画像', html`
            <p class="lead">ふだんは、そのアーティストのいちばん聴いた曲のジャケットを表示します。YouTube Data API のキーを入れると、チャンネルのアイコンを取得して表示します。</p>
            <form class="key-form" data-form="api-key">
                <input type="password" name="key" placeholder="YouTube Data API キー" value="${settings.youtubeApiKey}" autocomplete="off" spellcheck="false" aria-label="YouTube Data API キー">
                <button type="submit" class="btn">保存</button>
                ${settings.youtubeApiKey ? html`<button type="button" class="btn btn--ghost" data-action="clear-api-key">削除</button>` : ''}
            </form>
            ${settings.youtubeApiKey ? html`
                <div class="status-row">
                    <span class="status">アイコン取得済み ${formatNumber(fetched)} / ${formatNumber(channelCount)} チャンネル</span>
                    <button type="button" class="btn btn--small" data-action="fetch-images" ${state.apiBusy ? 'disabled' : ''}>${state.apiBusy ? '取得中…' : '取得する'}</button>
                </div>` : ''}
            <details class="howto howto--plain">
                <summary>API キーの取得方法</summary>
                <ol>
                    <li><a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud コンソール ${icon('external')}</a> でプロジェクトを作成する。</li>
                    <li>「API とサービス」→「ライブラリ」で「YouTube Data API v3」を有効にする。</li>
                    <li>「認証情報」→「認証情報を作成」→「API キー」を選ぶ。</li>
                    <li>キーの制限で「ウェブサイト」を選び、このページのアドレス（例: <code>https://pokobi.github.io/*</code>）を登録する。API の制限は「YouTube Data API v3」だけにする。</li>
                    <li>作成したキーを上の欄に貼り付けて保存する。</li>
                </ol>
            </details>
            <p class="note">キーはこのブラウザにだけ保存され、バックアップには含まれません。取得したアイコンもこのブラウザに保存し、まだ取得していないチャンネルだけを取りに行きます。</p>
        `)}

        ${card('曲のまとめ', html`
            ${candidates.length ? html`
                <div class="cand-head">
                    <div>
                        <h3 class="sub-h">まとめ候補（${formatNumber(allCandidates.length)}件）</h3>
                        <p class="note">同じアーティストで、「(Official Video)」などの付記を除くと同じ曲名になるものです。いちばん再生の多い曲にまとめます。</p>
                    </div>
                    <button type="button" class="btn btn--small" data-action="merge-all-candidates">すべてまとめる</button>
                </div>
                <ul class="plain-list">
                    ${candidates.map((c) => html`<li>
                        <span class="cand">${c.tracks.map((ti, k) => html`<span class="cand__item ${k === 0 ? 'is-main' : ''}">${model.tracks[ti].title} <small>${formatNumber(model.trackTotal[ti])}回</small></span>`)}<small class="cand__artist">${model.artists[model.tracks[c.tracks[0]].artistIdx].name}</small></span>
                        <span class="btn-group">
                            <button type="button" class="btn btn--small" data-action="merge-candidate" data-value="${c.tracks.map((ti) => model.tracks[ti].key).join('\n')}">まとめる</button>
                            <button type="button" class="btn btn--small btn--ghost" data-action="ignore-candidate" data-key="${c.id}">無視</button>
                        </span>
                    </li>`)}
                </ul>` : ''}
            ${trackAliasEntries.length ? html`
                <h3 class="sub-h">まとめた曲</h3>
                <ul class="plain-list">
                    ${trackAliasEntries.map((x) => html`<li><span>${x.fromName} → ${x.toName}</span><button type="button" class="btn btn--small" data-action="untrack-alias" data-key="${x.from}">解除</button></li>`)}
                </ul>` : ''}
            ${!candidates.length && !trackAliasEntries.length ? html`<p class="empty-note">ありません。曲の詳細画面から、別の曲とまとめることもできます。</p>` : ''}
            ${settings.ignoredSuggestions.length ? html`<button type="button" class="link-btn" data-action="reset-ignored">無視した候補を元に戻す（${formatNumber(settings.ignoredSuggestions.length)}件）</button>` : ''}
        `, { sub: 'MV 版と音源版など、別々に記録された同じ曲を 1 つにします' })}

        <div class="grid-2">
            ${card('集計から除外', exArtists.length || exTracks.length ? html`
                <ul class="plain-list">
                    ${exArtists.map((x) => html`<li><span>${icon('user')} ${x.name}</span><button type="button" class="btn btn--small" data-action="unexclude-artist" data-key="${x.key}">戻す</button></li>`)}
                    ${exTracks.map((x) => html`<li><span>${icon('music')} ${x.name}</span><button type="button" class="btn btn--small" data-action="unexclude-track" data-key="${x.key}">戻す</button></li>`)}
                </ul>` : html`<p class="empty-note">ありません。曲やアーティストの詳細画面から除外できます。</p>`)}
            ${card('アーティストのまとめ', aliasEntries.length ? html`
                <ul class="plain-list">
                    ${aliasEntries.map((x) => html`<li><span>${x.fromName} → ${x.toName}</span><button type="button" class="btn btn--small" data-action="unalias" data-key="${x.from}">解除</button></li>`)}
                </ul>` : html`<p class="empty-note">ありません。アーティストの詳細画面から、別名のアーティストを 1 つにまとめられます。</p>`, { sub: '「- Topic」の付いたチャンネルは自動でまとめています' })}
        </div>

        ${card('書き出し', html`
            <div class="btn-row">
                <button type="button" class="btn" data-action="export-backup">${icon('download')}<span>バックアップ（JSON）</span></button>
                <button type="button" class="btn" data-action="export-csv" data-value="songs">${icon('download')}<span>曲ランキング（CSV）</span></button>
                <button type="button" class="btn" data-action="export-csv" data-value="artists">${icon('download')}<span>アーティストランキング（CSV）</span></button>
            </div>
            <p class="note">バックアップには再生記録と除外・まとめの設定が含まれます。ファイルを追加と同じ手順で読み込むと復元できます。CSV は選択中の期間の集計です。</p>
        `)}

        ${card('すべてのデータを削除', html`
            <p class="note">このブラウザに保存した再生記録と設定をすべて削除します。元に戻せません。</p>
            <button type="button" class="btn btn--danger" data-action="delete-all">${icon('trash')}<span>削除する</span></button>
        `, { cls: 'card--danger' })}`;
}

// --- 最初の画面 ---

export function welcomeView() {
    return html`
        <section class="welcome">
            <div class="welcome__intro">
                <h1>YouTube Music の再生履歴を集計</h1>
                <p>Google Takeout で書き出した再生履歴から、よく聴いた曲やアーティスト、聴く時間帯などを表示します。データはこのブラウザの中だけで処理・保存されます。</p>
            </div>
            <button type="button" class="dropzone" data-action="add-files">
                ${icon('upload', 'icon--xl')}
                <span class="dropzone__title">ファイルをドロップ、またはクリックして選択</span>
                <span class="dropzone__sub">watch-history.json ／ Takeout の ZIP ／ このツールのバックアップ。複数選択できます。</span>
            </button>
            <details class="howto" open>
                <summary>再生履歴の書き出し方（Google Takeout）</summary>
                <ol>
                    <li><a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer">Google Takeout ${icon('external')}</a> を開き、「選択をすべて解除」を押す。</li>
                    <li>「YouTube と YouTube Music」にチェックを入れる。</li>
                    <li>「YouTube のすべてのデータが含まれます」を押し、「履歴」だけを選んで OK を押す。</li>
                    <li>「複数の形式」を押し、履歴の形式を「JSON」にする。</li>
                    <li>「次のステップ」→「エクスポートを作成」を押す。</li>
                    <li>届いた ZIP をそのまま、または中の <code>watch-history.json</code> をここに読み込む。</li>
                </ol>
            </details>
            <ul class="notes">
                <li>記録されているのは再生を始めた日時だけです。再生時間は次の再生までの間隔から推定しています。</li>
                <li>曲名やアーティスト名は YouTube が書き出したとおりに表示します。</li>
            </ul>
        </section>`;
}

// --- 詳細 ---

function burstTile(b) {
    if (!b || b.count < 2) return tile('ハマった時期', '-');
    return tile('ハマった時期', `${formatDay(b.start)}〜`, `30日間で ${formatNumber(b.count)}回`);
}

function peakOf(monthly) {
    let peak = null;
    for (const m of monthly) if (!peak || m.value > peak.value) peak = m;
    return peak;
}

export function songDetailView(state, ti, d, rank) {
    const { model, settings } = state;
    const t = model.tracks[ti];
    const a = model.artists[t.artistIdx];
    const excluded = settings.excludedTracks.includes(t.key);
    const artistExcluded = !!model.artistExcluded[t.artistIdx];
    const url = songUrl(t.v);
    const peak = peakOf(d.monthly);
    const merged = Object.keys(settings.trackAliases).filter((k) => k !== t.key && resolveAlias(settings.trackAliases, k) === t.key);
    return html`
        <header class="detail__head">
            ${thumb(state, t.v, 'thumb--lg')}
            <div class="detail__titles">
                <p class="detail__kind">曲</p>
                <h2 class="detail__title">${t.title}</h2>
                <button type="button" class="link-btn" data-action="open-artist" data-key="${a.key}">${a.name}</button>
                ${t.variants.length ? html`<p class="detail__aka">別の表記: ${t.variants.join('、')}</p>` : ''}
            </div>
            <button type="button" class="icon-btn" data-action="close-detail" aria-label="閉じる" autofocus>${icon('x')}</button>
        </header>
        <div class="detail__body">
            ${excluded || artistExcluded ? html`<p class="banner">${icon('eyeOff')} ${artistExcluded ? 'このアーティストは' : 'この曲は'}集計から除外されています。</p>` : ''}
            <p class="detail__period">${state.periodLabel}</p>
            <div class="tiles tiles--small">
                ${tile('再生回数', `${formatNumber(d.count)}回`, d.skips ? `うちスキップ ${formatNumber(d.skips)}回` : '')}
                ${tile('順位', rank ? `${rank}位` : '-')}
                ${tile('推定再生時間', formatDuration(d.ms))}
                ${burstTile(d.burst)}
                ${tile('初再生', formatDate(d.first))}
                ${tile('最後の再生', formatDate(d.last))}
            </div>
            ${d.count ? html`
                <h3 class="detail__h">月ごとの再生回数 ${peak && peak.value ? html`<small>最多 ${monthLabel(peak.month)}（${formatNumber(peak.value)}回）</small>` : ''}</h3>
                ${barChart(monthItems(d.monthly), { height: 120, ariaLabel: '月別の再生回数' })}
                <h3 class="detail__h">再生した日時</h3>
                <ol class="history">${d.plays.slice(0, state.detail.limit).map((t0) => html`<li>${formatDateTime(t0)}</li>`)}</ol>
                ${d.plays.length > state.detail.limit ? html`<button type="button" class="btn btn--block" data-action="detail-more">さらに表示（残り ${formatNumber(d.plays.length - state.detail.limit)}件）</button>` : ''}
            ` : html`<p class="empty-note">この期間の再生はありません。</p>`}

            <h3 class="detail__h">別の曲とまとめる</h3>
            <form class="merge-form" data-form="merge-track" data-key="${t.key}">
                <input type="text" name="target" list="song-options" placeholder="まとめ先の曲（曲名 / アーティスト）" autocomplete="off" required aria-label="まとめ先の曲">
                <button type="submit" class="btn">${icon('merge')}<span>まとめる</span></button>
            </form>
            <p class="note">MV 版と音源版など、別々に記録された同じ曲を 1 つにします。データ管理画面から解除できます。${merged.length ? ` この曲には ${merged.length}件をまとめています。` : ''}</p>
        </div>
        <footer class="detail__foot">
            ${url ? html`<a class="btn" href="${url}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>YouTube Music で開く</span></a>` : ''}
            <button type="button" class="btn" data-action="copy" data-text="${t.title} - ${a.name}">${icon('copy')}<span>コピー</span></button>
            <button type="button" class="btn ${excluded ? '' : 'btn--ghost-danger'}" data-action="${excluded ? 'unexclude-track' : 'exclude-track'}" data-key="${t.key}">${icon(excluded ? 'eye' : 'eyeOff')}<span>${excluded ? '除外をやめる' : '集計から除外'}</span></button>
        </footer>`;
}

export function artistDetailView(state, ai, d, rank, total) {
    const { model, settings } = state;
    const a = model.artists[ai];
    const excluded = settings.excludedArtists.includes(a.key);
    const absorbed = Object.entries(settings.aliases).filter(([from, to]) => from !== a.key && resolveAlias(settings.aliases, to) === a.key);
    const peak = peakOf(d.monthly);
    return html`
        <header class="detail__head">
            ${avatar(state, a, 'avatar--lg')}
            <div class="detail__titles">
                <p class="detail__kind">アーティスト</p>
                <h2 class="detail__title">${a.name}</h2>
                ${a.aliasNames.length ? html`<p class="detail__aka">別名: ${a.aliasNames.join('、')}</p>` : ''}
            </div>
            <button type="button" class="icon-btn" data-action="close-detail" aria-label="閉じる" autofocus>${icon('x')}</button>
        </header>
        <div class="detail__body">
            ${excluded ? html`<p class="banner">${icon('eyeOff')} このアーティストは集計から除外されています。</p>` : ''}
            <p class="detail__period">${state.periodLabel}</p>
            <div class="tiles tiles--small">
                ${tile('再生回数', `${formatNumber(d.count)}回`, total && !excluded ? formatPercent(d.count / total) : '')}
                ${tile('順位', rank ? `${rank}位` : '-')}
                ${tile('推定再生時間', formatDuration(d.ms))}
                ${tile('曲', formatNumber(d.topTracks.length))}
                ${burstTile(d.burst)}
                ${tile('初再生', formatDate(d.first), `最後 ${formatDate(d.last)}`)}
            </div>
            ${d.count ? html`
                <h3 class="detail__h">月ごとの再生回数 ${peak && peak.value ? html`<small>最多 ${monthLabel(peak.month)}（${formatNumber(peak.value)}回）</small>` : ''}</h3>
                ${barChart(monthItems(d.monthly), { height: 120, ariaLabel: '月別の再生回数' })}
                <h3 class="detail__h">よく聴いた曲</h3>
                <ol class="rows">${d.topTracks.slice(0, 10).map((x, k) => songRow(state, { i: x.ti, count: x.count, rank: k + 1 }, { compact: true, showChange: false }))}</ol>
                <h3 class="detail__h">再生した日時</h3>
                <ol class="history">${d.plays.slice(0, state.detail.limit).map((p) => html`<li><span>${formatDateTime(p.t)}</span><span class="history__title">${model.tracks[p.ti].title}</span></li>`)}</ol>
                ${d.plays.length > state.detail.limit ? html`<button type="button" class="btn btn--block" data-action="detail-more">さらに表示（残り ${formatNumber(d.plays.length - state.detail.limit)}件）</button>` : ''}
            ` : html`<p class="empty-note">この期間の再生はありません。</p>`}

            <h3 class="detail__h">別のアーティストとまとめる</h3>
            <form class="merge-form" data-form="merge" data-key="${a.key}">
                <input type="text" name="target" list="artist-options" placeholder="まとめ先のアーティスト名" autocomplete="off" required aria-label="まとめ先のアーティスト名">
                <button type="submit" class="btn">${icon('merge')}<span>まとめる</span></button>
            </form>
            <p class="note">表記違いなどで分かれている同じアーティストを 1 つにします。データ管理画面から解除できます。${absorbed.length ? ` このアーティストには ${absorbed.length}件をまとめています。` : ''}</p>
        </div>
        <footer class="detail__foot">
            ${a.url ? html`<a class="btn" href="${a.url}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>チャンネルを開く</span></a>` : ''}
            <button type="button" class="btn" data-action="copy" data-text="${a.name}">${icon('copy')}<span>コピー</span></button>
            <button type="button" class="btn ${excluded ? '' : 'btn--ghost-danger'}" data-action="${excluded ? 'unexclude-artist' : 'exclude-artist'}" data-key="${a.key}">${icon(excluded ? 'eye' : 'eyeOff')}<span>${excluded ? '除外をやめる' : '集計から除外'}</span></button>
        </footer>`;
}

export function dayDetailView(state, day, d) {
    const { model } = state;
    const canPrev = day > model.minDay;
    const canNext = day < model.maxDay;
    const { d: dd } = dayParts(day);
    return html`
        <header class="detail__head">
            <span class="avatar avatar--lg day-badge" aria-hidden="true">${dd}</span>
            <div class="detail__titles">
                <p class="detail__kind">日</p>
                <h2 class="detail__title">${formatDay(day)}（${WEEKDAYS[dayWeekday(day)]}）</h2>
            </div>
            <div class="stepper">
                <button type="button" class="icon-btn" data-action="open-day" data-value="${day - 1}" ${canPrev ? '' : 'disabled'} aria-label="前の日">${icon('chevronLeft')}</button>
                <button type="button" class="icon-btn" data-action="open-day" data-value="${day + 1}" ${canNext ? '' : 'disabled'} aria-label="次の日">${icon('chevronRight')}</button>
            </div>
            <button type="button" class="icon-btn" data-action="close-detail" aria-label="閉じる" autofocus>${icon('x')}</button>
        </header>
        <div class="detail__body">
            <div class="tiles tiles--small">
                ${tile('再生回数', `${formatNumber(d.count)}回`)}
                ${tile('推定再生時間', formatDuration(d.ms))}
                ${tile('曲', formatNumber(new Set(d.plays.map((p) => p.ti)).size))}
                ${tile('アーティスト', formatNumber(d.topArtists.length))}
            </div>
            ${d.count ? html`
                <h3 class="detail__h">よく聴いたアーティスト</h3>
                <div class="chips">${d.topArtists.slice(0, 8).map((x) => html`<button type="button" class="chip" data-action="open-artist" data-key="${model.artists[x.i].key}">${model.artists[x.i].name} <small>${formatNumber(x.count)}</small></button>`)}</div>
                <h3 class="detail__h">再生した曲</h3>
                <ol class="rows">${d.plays.map((p) => songRow(state, { i: p.ti, count: 1 }, {
                    compact: true,
                    showChange: false,
                    count: false,
                    sub: `${formatDateTime(p.t).slice(11)} ・ ${model.artists[model.tracks[p.ti].artistIdx].name}${p.skip ? ' ・ スキップ' : ''}`,
                }))}</ol>
            ` : html`<p class="empty-note">この日の再生はありません。</p>`}
        </div>`;
}

export function periodOptions(state) {
    const { model, period } = state;
    const cur = period.type === 'year' ? `y${period.year}` : period.type === 'last' ? `l${period.days}` : period.type;
    const opts = [['all', '全期間'], ['l30', '直近 30 日'], ['l90', '直近 90 日'], ['l365', '直近 1 年']];
    for (const y of model.years) opts.push([`y${y}`, `${y}年`]);
    if (period.type === 'year' && !model.years.includes(period.year)) opts.push([`y${period.year}`, `${period.year}年`]);
    opts.push(['custom', '期間を指定']);
    return html`
        <label class="period">
            <span class="visually-hidden">集計期間</span>
            <select id="period-select">${opts.map(([v, l]) => html`<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`)}</select>
        </label>
        ${period.type === 'custom' ? html`
            <span class="period-custom">
                <input type="date" id="period-start" value="${dayToInput(period.start)}" min="${dayToInput(model.minDay)}" max="${dayToInput(model.maxDay)}" aria-label="開始日">
                <span>〜</span>
                <input type="date" id="period-end" value="${dayToInput(period.end)}" min="${dayToInput(model.minDay)}" max="${dayToInput(model.maxDay)}" aria-label="終了日">
            </span>` : ''}`;
}

export function artistOptions(state) {
    return html`${state.model.artists.map((a) => html`<option value="${a.name}"></option>`)}`;
}

export function songOptionLabel(state, ti) {
    const t = state.model.tracks[ti];
    return `${t.title} / ${state.model.artists[t.artistIdx].name}`;
}

export function songOptions(state) {
    const order = state.model.tracks.map((_, i) => i).sort((a, b) => state.model.trackTotal[b] - state.model.trackTotal[a]);
    return html`${order.map((ti) => html`<option value="${songOptionLabel(state, ti)}"></option>`)}`;
}
