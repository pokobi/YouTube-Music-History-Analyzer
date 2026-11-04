// グラフ（HTML/SVG の文字列を返す）。値の表示は data-tip でツールチップに出す。

import { html, raw, formatNumber, dayFromYmd, dayWeekday, dayParts, formatDay, WEEKDAYS, esc } from './util.js';

/**
 * 棒グラフ
 * @param {Array<{value:number, label?:string, tip:string}>} items
 */
export function barChart(items, { height = 180, ariaLabel = '' } = {}) {
    if (!items.length) return html`<p class="empty-note">データがありません</p>`;
    const max = Math.max(1, ...items.map((x) => x.value));
    const dense = items.length > 40;
    const bars = items.map((x) => {
        const h = x.value > 0 ? Math.max(1.5, (x.value / max) * 100) : 0;
        return raw(`<div class="bar" data-tip="${esc(x.tip)}" tabindex="-1"><span style="height:${h.toFixed(2)}%"></span></div>`);
    });
    const labels = items.map((x) => raw(`<span>${esc(x.label || '')}</span>`));
    return html`
        <div class="bar-chart ${dense ? 'is-dense' : ''}" style="--chart-h:${height}px" role="img" aria-label="${ariaLabel}">
            <div class="bar-chart__axis"><span>${formatNumber(max)}</span><span>0</span></div>
            <div class="bar-chart__plot">
                <div class="bar-chart__grid"></div>
                <div class="bar-chart__bars">${bars}</div>
                <div class="bar-chart__labels">${labels}</div>
            </div>
        </div>`;
}

/** 値の分布から 4 段階のしきい値を求める（0 は別扱い） */
function levelScale(values) {
    const nz = values.filter((v) => v > 0).sort((a, b) => a - b);
    if (!nz.length) return () => 0;
    const q = (p) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))];
    const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75);
    return (v) => (v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4);
}

function heatLegend() {
    return html`<div class="heat-legend" aria-hidden="true"><span>少</span>${[0, 1, 2, 3, 4].map((l) => raw(`<i class="lv${l}"></i>`))}<span>多</span></div>`;
}

/** 1 年分のカレンダー（月曜始まり） */
export function calendarHeatmap(daily, year) {
    const start = dayFromYmd(year, 0, 1);
    const end = dayFromYmd(year, 11, 31);
    const offset = (dayWeekday(start) + 6) % 7;
    const values = [];
    for (let d = start; d <= end; d++) values.push(daily.get(d) || 0);
    const level = levelScale(values);
    const cols = Math.ceil((offset + values.length) / 7);

    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(raw('<i class="cal-blank"></i>'));
    for (let d = start; d <= end; d++) {
        const v = daily.get(d) || 0;
        const wd = WEEKDAYS[dayWeekday(d)];
        cells.push(raw(`<i class="lv${level(v)}" data-action="open-day" data-value="${d}" data-tip="${formatDay(d)}（${wd}） ${formatNumber(v)}回"></i>`));
    }
    const months = [];
    for (let m = 0; m < 12; m++) {
        const col = Math.floor((offset + dayFromYmd(year, m, 1) - start) / 7);
        months.push(raw(`<span style="grid-column:${col + 1}">${m + 1}月</span>`));
    }
    return html`
        <div class="calendar-scroll">
            <div class="calendar" style="--cols:${cols}">
                <div class="calendar__months">${months}</div>
                <div class="calendar__days" aria-hidden="true"><span>月</span><span></span><span>水</span><span></span><span>金</span><span></span><span></span></div>
                <div class="calendar__grid" role="img" aria-label="${year}年の日別再生回数">${cells}</div>
            </div>
        </div>
        ${heatLegend()}`;
}

/** 曜日 × 時間帯 */
export function weekHourHeatmap(weekHour) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const all = weekHour.flat();
    const level = levelScale(all);
    const rows = order.map((wd) => {
        const cells = weekHour[wd].map((v, h) => raw(`<i class="lv${level(v)}" data-tip="${WEEKDAYS[wd]}曜 ${h}時台 ${formatNumber(v)}回"></i>`));
        return html`<span class="wh__label">${WEEKDAYS[wd]}</span>${cells}`;
    });
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push(raw(`<span>${h % 3 === 0 ? h : ''}</span>`));
    return html`
        <div class="wh" role="img" aria-label="曜日と時間帯ごとの再生回数">
            <span></span>${hours}
            ${rows}
        </div>
        ${heatLegend()}`;
}

/**
 * ドーナツグラフ + 凡例
 * @param {Array<{label:string, value:number, other?:boolean}>} items
 */
export function donutChart(items, total) {
    if (!total) return html`<p class="empty-note">データがありません</p>`;
    let acc = 0;
    let slot = 0;
    const segs = [];
    const legend = [];
    for (const it of items) {
        if (it.value <= 0) continue;
        const pct = (it.value / total) * 100;
        const cls = it.other ? 'series-other' : `series-${++slot}`;
        const gap = items.length > 1 ? Math.min(0.6, pct / 3) : 0;
        segs.push(raw(`<circle class="${cls}" r="15.9155" cx="18" cy="18" pathLength="100" stroke-dasharray="${Math.max(0, pct - gap).toFixed(3)} ${(100 - pct + gap).toFixed(3)}" stroke-dashoffset="${(25 - acc).toFixed(3)}" data-tip="${esc(it.label)} ${formatNumber(it.value)}回 (${pct.toFixed(1)}%)"></circle>`));
        legend.push(html`<li><i class="swatch ${cls}"></i><span class="legend__name">${it.label}</span><span class="legend__value">${pct.toFixed(1)}%</span></li>`);
        acc += pct;
    }
    return html`
        <div class="donut">
            <svg viewBox="0 0 36 36" role="img" aria-label="アーティスト別の再生割合">${segs}</svg>
            <ul class="legend">${legend}</ul>
        </div>`;
}

/** 月ごとの棒グラフ用にラベルを付ける */
export function monthItems(monthly, unit = '回') {
    const n = monthly.length;
    return monthly.map(({ month, value }) => {
        const y = Math.floor(month / 12), m = month % 12;
        let label = '';
        if (n <= 14) label = `${m + 1}月`;
        else if (n <= 36) label = m % 3 === 0 ? (m === 0 ? `${y}` : `${m + 1}月`) : '';
        else label = m === 0 ? `${y}` : '';
        return { value, label, tip: `${y}年${m + 1}月 ${formatNumber(value)}${unit}` };
    });
}

/** 日ごとの棒グラフ用 */
export function dayItems(daily, startDay, endDay) {
    const out = [];
    const n = endDay - startDay + 1;
    for (let d = startDay; d <= endDay; d++) {
        const { m, d: dd } = dayParts(d);
        const v = daily.get(d) || 0;
        const label = n <= 14 || dd === 1 || (n <= 62 && dd % 7 === 1) ? `${m + 1}/${dd}` : '';
        out.push({ value: v, label, tip: `${formatDay(d)}（${WEEKDAYS[dayWeekday(d)]}） ${formatNumber(v)}回` });
    }
    return out;
}
