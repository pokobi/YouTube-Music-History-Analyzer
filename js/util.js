// 共通ヘルパー（DOM に依存しない処理のみ）

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

class RawHtml {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
}

/** エスケープせずに埋め込む HTML 文字列 */
export function raw(s) {
    return new RawHtml(String(s ?? ''));
}

function toHtml(v) {
    if (v == null || v === false) return '';
    if (v instanceof RawHtml) return v.s;
    if (Array.isArray(v)) return v.map(toHtml).join('');
    return esc(v);
}

/** 埋め込む値を自動でエスケープするテンプレートタグ */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += toHtml(values[i]) + strings[i + 1];
    return new RawHtml(out);
}

// --- 日付（ローカル時刻基準の「日番号」を使い、夏時間などの影響を避ける） ---

const DAY_MS = 86400000;

/** ミリ秒時刻 → ローカル日付の通し番号 */
export function dayNumber(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** 日番号 → {y, m(0-11), d} */
export function dayParts(n) {
    const u = new Date(n * DAY_MS);
    return { y: u.getUTCFullYear(), m: u.getUTCMonth(), d: u.getUTCDate() };
}

/** 日番号 → ローカル 0:00 の Date */
export function dayToDate(n) {
    const { y, m, d } = dayParts(n);
    return new Date(y, m, d);
}

export function dayFromYmd(y, m, d) {
    return Math.floor(Date.UTC(y, m, d) / DAY_MS);
}

/** 日番号の曜日（0=日曜） */
export function dayWeekday(n) {
    return ((n % 7) + 7 + 4) % 7;
}

/** 日番号 → "YYYY-MM-DD"（input[type=date] 用） */
export function dayToInput(n) {
    const { y, m, d } = dayParts(n);
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → 日番号（不正なら null） */
export function inputToDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    return dayFromYmd(+m[1], +m[2] - 1, +m[3]);
}

/** 月番号（年*12+月）→ {y, m} */
export function monthParts(mi) {
    return { y: Math.floor(mi / 12), m: mi % 12 };
}

export function monthLabel(mi) {
    const { y, m } = monthParts(mi);
    return `${y}年${m + 1}月`;
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function formatDay(n) {
    if (n == null) return '-';
    const { y, m, d } = dayParts(n);
    return `${y}/${String(m + 1).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
}

export function formatDate(ms) {
    if (ms == null) return '-';
    return formatDay(dayNumber(ms));
}

export function formatDateTime(ms) {
    if (ms == null) return '-';
    const d = new Date(ms);
    return `${formatDate(ms)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatNumber(n) {
    return Number(n || 0).toLocaleString('ja-JP');
}

export function formatPercent(ratio, digits = 1) {
    if (!isFinite(ratio)) return '-';
    return `${(ratio * 100).toFixed(digits)}%`;
}

/** ローカル日付で今日の "YYYY-MM-DD" */
export function todayStamp() {
    return dayToInput(dayNumber(Date.now()));
}

/** 昇順配列から value 以上となる最初の位置 */
export function lowerBound(arr, value) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] < value) lo = mid + 1; else hi = mid;
    }
    return lo;
}

export function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
}

/** 検索用の正規化（全角半角・大文字小文字を同一視） */
export function normalizeText(s) {
    return String(s || '').normalize('NFKC').toLowerCase();
}
