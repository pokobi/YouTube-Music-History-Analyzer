// 各画面の HTML を組み立てる。状態の変更はしない。

import { html, formatNumber, formatDay, formatDate, formatDateTime, formatPercent, monthLabel, WEEKDAYS, dayToInput, normalizeText } from './util.js';
import { icon } from './icons.js';
import { barChart, calendarHeatmap, weekHourHeatmap, donutChart, monthItems, dayItems } from './charts.js';
import { previousLabel, monthOfDay } from './stats.js';
import { resolveAlias } from './model.js';

export const TABS = [
    ['overview', '概要'],
    ['ranking', 'ランキング'],
    ['trends', '傾向'],
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

function avatar(name, size = '') {
    const ch = Array.from(name || '?')[0] || '?';
    return html`<span class="avatar ${size}" aria-hidden="true">${ch.toUpperCase()}</span>`;
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
    if (!label || !prev) return '';
    const r = cur / prev - 1;
    const sign = r > 0 ? '+' : '';
    const cls = r > 0 ? 'delta--up' : r < 0 ? 'delta--down' : '';
    return html`<span class="delta ${cls}">${label}比 ${sign}${(r * 100).toFixed(1)}%</span>`;
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

export function songRow(state, item, { max, prevMap, showChange = true, compact = false, search = '' } = {}) {
    const { model } = state;
    const t = model.tracks[item.i];
    const artist = model.artists[t.artistIdx];
    const pct = max ? (item.count / max) * 100 : 0;
    return html`
        <li>
            <button type="button" class="row ${compact ? 'row--compact' : ''}" data-action="open-song" data-key="${t.key}">
                <span class="row__rank ${item.rank <= 3 ? 'is-top' : ''}">${item.rank}</span>
                ${showChange ? html`<span class="row__change">${changeBadge(prevMap, item.i, item.rank)}</span>` : ''}
                ${thumb(state, t.v)}
                <span class="row__main">
                    <span class="row__title">${highlight(t.title, search)}</span>
                    <span class="row__subtitle">${highlight(artist.name, search)}</span>
                    ${compact ? '' : html`<span class="row__bar"><span style="width:${pct.toFixed(2)}%"></span></span>`}
                </span>
                <span class="row__count">${formatNumber(item.count)}<small>回</small></span>
            </button>
        </li>`;
}

export function artistRow(state, item, { max, prevMap, total, showChange = true, compact = false, search = '' } = {}) {
    const a = state.model.artists[item.i];
    const pct = max ? (item.count / max) * 100 : 0;
    return html`
        <li>
            <button type="button" class="row ${compact ? 'row--compact' : ''}" data-action="open-artist" data-key="${a.key}">
                <span class="row__rank ${item.rank <= 3 ? 'is-top' : ''}">${item.rank}</span>
                ${showChange ? html`<span class="row__change">${changeBadge(prevMap, item.i, item.rank)}</span>` : ''}
                ${avatar(a.name)}
                <span class="row__main">
                    <span class="row__title">${highlight(a.name, search)}</span>
                    ${total ? html`<span class="row__subtitle">${formatPercent(item.count / total)}</span>` : ''}
                    ${compact ? '' : html`<span class="row__bar"><span style="width:${pct.toFixed(2)}%"></span></span>`}
                </span>
                <span class="row__count">${formatNumber(item.count)}<small>回</small></span>
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
            <p>上の期間の選択を変えてください。</p>
        </div>`;
}

function activityChart(s, height = 200) {
    if (s.spanDays && s.spanDays <= 92) {
        return barChart(dayItems(s.daily, s.spanStart, s.spanEnd), { height, ariaLabel: '日別の再生回数' });
    }
    return barChart(monthItems(s.monthly), { height, ariaLabel: '月別の再生回数' });
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
            ${tile('再生した日', `${formatNumber(s.activeDays)}日`, `期間 ${formatNumber(s.spanDays)}日のうち ${formatPercent(s.activeDays / s.spanDays, 0)}`)}
            ${tile('1日あたり', `${(s.total / s.activeDays).toFixed(1)}回`, '再生した日の平均')}
            ${tile('最長連続', `${formatNumber(s.longest.length)}日`, s.longest.start != null ? `${formatDay(s.longest.start)} 〜 ${formatDay(s.longest.end)}` : '')}
            ${tile('曲', formatNumber(s.songs.length), isAll ? '' : `初めて聴いた曲 ${formatNumber(s.newTracks.length)}`)}
            ${tile('アーティスト', formatNumber(s.artists.length), isAll ? '' : `初めて聴いたアーティスト ${formatNumber(s.newArtists.length)}`)}
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
        ${calYears.length ? card('カレンダー', calendarHeatmap(s.daily, calYear), { actions: calNav, sub: '日ごとの再生回数' }) : ''}`;
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
    return html`
        <div class="toolbar">
            ${segmented('rank-type', state.rankType, [['songs', '曲'], ['artists', 'アーティスト']])}
            <label class="search">
                ${icon('search')}
                <input type="search" id="rank-search" placeholder="${isSongs ? '曲名・アーティスト名で検索' : 'アーティスト名で検索'}" value="${state.search}" autocomplete="off" aria-label="ランキングを検索">
            </label>
            <button type="button" class="btn btn--ghost" data-action="export-csv" data-value="${state.rankType}">${icon('download')}<span>CSV</span></button>
        </div>
        ${state.prev ? html`<p class="hint">順位の横の矢印は ${previousLabel(state.period)} との比較です。</p>` : ''}
        <div id="rank-list">${rankingList(state)}</div>`;
}

export function rankingList(state) {
    const s = state.stats;
    const isSongs = state.rankType === 'songs';
    const list = isSongs ? s.songs : s.artists;
    const q = normalizeText(state.search.trim());
    const filtered = q ? list.filter((x) => searchText(state, isSongs, x.i).includes(q)) : list;
    const shown = filtered.slice(0, state.rankLimit);
    const max = list[0] ? list[0].count : 0;
    const prevMap = state.prev ? (isSongs ? state.prev.songRank : state.prev.artistRank) : null;
    if (!filtered.length) return html`<p class="empty-note">「${state.search}」に一致する${isSongs ? '曲' : 'アーティスト'}はありません。</p>`;
    return html`
        <ol class="rows rows--ranking">
            ${shown.map((x) => (isSongs ? songRow(state, x, { max, prevMap, search: state.search.trim() }) : artistRow(state, x, { max, prevMap, total: s.total, search: state.search.trim() })))}
        </ol>
        <div class="list-foot">
            <span>${formatNumber(filtered.length)}件中 ${formatNumber(shown.length)}件を表示</span>
            ${shown.length < filtered.length ? html`<button type="button" class="btn" data-action="more">さらに表示</button>` : ''}
        </div>`;
}

function searchText(state, isSongs, i) {
    const cache = isSongs ? state.searchCache.songs : state.searchCache.artists;
    let v = cache.get(i);
    if (v === undefined) {
        const { model } = state;
        v = isSongs
            ? normalizeText(`${model.tracks[i].title}\n${model.artists[model.tracks[i].artistIdx].name}`)
            : normalizeText([model.artists[i].name, ...model.artists[i].aliasNames].join('\n'));
        cache.set(i, v);
    }
    return v;
}

// --- 傾向 ---

export function trendsView(state) {
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

    return html`
        <p class="period-line">${periodText(s)}</p>
        <div class="grid-2">
            ${card('時間帯', barChart(hourly, { height: 160, ariaLabel: '時間帯別の再生回数' }), { sub: '何時台に聴いたか' })}
            ${card('曜日', barChart(weekdayTotals, { height: 160, ariaLabel: '曜日別の再生回数' }))}
        </div>
        ${card('曜日 × 時間帯', weekHourHeatmap(s.weekHour))}
        <div class="grid-2">
            ${card('アーティストの割合', donutChart(shareItems, s.total), { sub: '上位 7 組とその他' })}
            ${yearly.length > 1 ? card('年ごとの再生回数', barChart(yearly, { height: 200, ariaLabel: '年別の再生回数' })) : card('再生回数の推移', activityChart(s))}
        </div>
        ${card('初めて聴いた数', discover.some((x) => x.value > 0) ? barChart(discover, { height: 180, ariaLabel: '月別の初めて聴いた数' }) : html`<p class="empty-note">この期間に初めて再生した${isArtist ? 'アーティスト' : '曲'}はありません。</p>`, {
            sub: 'その月に初めて再生した数（全期間の記録で判定）',
            actions: segmented('discover-type', state.discoverType, [['artists', 'アーティスト'], ['songs', '曲']]),
        })}`;
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
            ${prevTotal ? html`<p class="hero__sub">${deltaText(ys.total, prevTotal, `${year - 1}年`)}</p>` : ''}
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
                ${avatar(sa.name, 'avatar--xl')}
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

    return html`
        ${card('保存されているデータ', html`
            <dl class="facts">
                <div><dt>再生記録</dt><dd>${formatNumber(model.n)}件</dd></div>
                <div><dt>期間</dt><dd>${formatDay(model.minDay)} 〜 ${formatDay(model.maxDay)}</dd></div>
                <div><dt>曲</dt><dd>${formatNumber(model.tracks.length)}</dd></div>
                <div><dt>アーティスト</dt><dd>${formatNumber(model.artists.length)}</dd></div>
            </dl>
            <p class="note">${icon('lock')} データはこのブラウザの中だけに保存されます。別のブラウザやシークレットウィンドウとは共有されません。</p>
        `, { actions: html`<button type="button" class="btn btn--primary" data-action="add-files">${icon('plus')}<span>ファイルを追加</span></button>` })}

        ${card('読み込み履歴', imports.length ? html`
            <div class="table-wrap"><table class="table">
                <thead><tr><th>ファイル</th><th>読み込み日時</th><th class="num">記録</th><th class="num">追加</th></tr></thead>
                <tbody>${imports.map((x) => html`<tr><td class="ellipsis" title="${x.name}">${x.name}</td><td>${formatDateTime(x.importedAt)}</td><td class="num">${formatNumber(x.entries)}</td><td class="num">${formatNumber(x.added)}</td></tr>`)}</tbody>
            </table></div>
            <p class="note">新しいファイルは保存済みのデータに結合されます。同じ日時・同じ曲の記録は重複として除かれます。</p>` : html`<p class="empty-note">ありません</p>`)}

        <div class="grid-2">
            ${card('書き出し', html`
                <div class="stack">
                    <button type="button" class="btn" data-action="export-backup">${icon('download')}<span>バックアップ（JSON）</span></button>
                    <button type="button" class="btn" data-action="export-csv" data-value="songs">${icon('download')}<span>曲ランキング（CSV）</span></button>
                    <button type="button" class="btn" data-action="export-csv" data-value="artists">${icon('download')}<span>アーティストランキング（CSV）</span></button>
                </div>
                <p class="note">バックアップには再生記録と除外・まとめの設定が含まれます。ファイルを追加と同じ手順で読み込むと復元できます。CSV は選択中の期間の集計です。</p>
            `)}
            ${card('表示', html`
                <label class="switch">
                    <input type="checkbox" data-action="toggle-thumbs" ${settings.showThumbnails ? 'checked' : ''}>
                    <span>サムネイル画像を表示する</span>
                </label>
                <p class="note">サムネイルは YouTube の画像サーバー（i.ytimg.com）から読み込みます。オフにすると外部への通信はなくなります。</p>
            `)}
        </div>

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
                <li>記録されているのは再生を始めた日時だけです。聴いた長さは分からないため、集計はすべて再生回数で行います。</li>
                <li>曲名やアーティスト名は YouTube が書き出したとおりに表示します。</li>
            </ul>
        </section>`;
}

// --- 詳細 ---

export function songDetailView(state, ti, d, rank) {
    const { model, settings } = state;
    const t = model.tracks[ti];
    const a = model.artists[t.artistIdx];
    const excluded = settings.excludedTracks.includes(t.key);
    const artistExcluded = !!model.artistExcluded[t.artistIdx];
    const url = songUrl(t.v);
    let peak = null;
    for (const m of d.monthly) if (!peak || m.value > peak.value) peak = m;
    return html`
        <header class="detail__head">
            ${thumb(state, t.v, 'thumb--lg')}
            <div class="detail__titles">
                <p class="detail__kind">曲</p>
                <h2 class="detail__title">${t.title}</h2>
                <button type="button" class="link-btn" data-action="open-artist" data-key="${a.key}">${a.name}</button>
            </div>
            <button type="button" class="icon-btn" data-action="close-detail" aria-label="閉じる" autofocus>${icon('x')}</button>
        </header>
        <div class="detail__body">
            ${excluded || artistExcluded ? html`<p class="banner">${icon('eyeOff')} ${artistExcluded ? 'このアーティストは' : 'この曲は'}集計から除外されています。</p>` : ''}
            <p class="detail__period">${state.periodLabel}</p>
            <div class="tiles tiles--small">
                ${tile('再生回数', `${formatNumber(d.count)}回`)}
                ${tile('順位', rank ? `${rank}位` : '-')}
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
    const absorbed = Object.entries(settings.aliases).filter(([from, to]) => from !== a.key && resolveAlias(settings.aliases, to) === a.key).map(([from]) => from);
    let peak = null;
    for (const m of d.monthly) if (!peak || m.value > peak.value) peak = m;
    return html`
        <header class="detail__head">
            ${avatar(a.name, 'avatar--lg')}
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
                ${tile('曲', formatNumber(d.topTracks.length))}
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
            <p class="note">表記違いなどで分かれている同じアーティストを 1 つにします。データ管理画面から解除できます。</p>
            ${absorbed.length ? html`<p class="note">まとめているアーティスト: ${absorbed.length}件</p>` : ''}
        </div>
        <footer class="detail__foot">
            ${a.url ? html`<a class="btn" href="${a.url}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>チャンネルを開く</span></a>` : ''}
            <button type="button" class="btn" data-action="copy" data-text="${a.name}">${icon('copy')}<span>コピー</span></button>
            <button type="button" class="btn ${excluded ? '' : 'btn--ghost-danger'}" data-action="${excluded ? 'unexclude-artist' : 'exclude-artist'}" data-key="${a.key}">${icon(excluded ? 'eye' : 'eyeOff')}<span>${excluded ? '除外をやめる' : '集計から除外'}</span></button>
        </footer>`;
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
