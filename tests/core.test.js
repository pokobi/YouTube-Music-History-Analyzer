import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../js/vendor/fflate.js';
import { parseFile, parseText } from '../js/parser.js';
import { emptyDataset, mergeEntries, buildBackup } from '../js/dataset.js';
import { buildModel, defaultSettings, artistKeyOf } from '../js/model.js';
import { computeStats, computeRanks, parsePeriod, encodePeriod, periodRange, previousRange, trackDetail, artistDetail } from '../js/stats.js';
import { dayNumber, dayFromYmd, dayWeekday, esc, html, raw } from '../js/util.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const play = (time, v, title, artist, header = 'YouTube Music') => ({
    header,
    title: `${title} を視聴しました`,
    titleUrl: `https://${header === 'YouTube' ? 'www' : 'music'}.youtube.com/watch?v=${v}`,
    subtitles: [{ name: artist, url: `https://www.youtube.com/channel/UC_${artist.replace(/\W/g, '')}` }],
    time,
    products: ['YouTube'],
});

const takeout = [
    play(at(2024, 1, 1), 'aaaaaaaaaaa', 'Song A', 'Artist X - Topic'),
    play(at(2024, 1, 2), 'aaaaaaaaaaa', 'Song A', 'Artist X'),
    play(at(2024, 1, 3), 'bbbbbbbbbbb', 'Song <B> & "quote"', 'Artist Y'),
    play(at(2024, 1, 5), 'aaaaaaaaaaa', 'Song A', 'Artist X'),
    play(at(2023, 12, 31), 'ccccccccccc', 'Song C', 'Artist Y'),
    play(at(2024, 1, 4), 'ddddddddddd', 'Some Video', 'Channel', 'YouTube'),
    { header: 'YouTube Music', title: 'Watched https://music.youtube.com/watch?v=eeeeeeeeeee', titleUrl: 'https://music.youtube.com/watch?v=eeeeeeeeeee', time: at(2024, 3, 1) },
];

function load() {
    const src = parseText('watch-history.json', JSON.stringify(takeout));
    const { dataset } = mergeEntries(emptyDataset(), src.entries);
    return { src, dataset, model: buildModel(dataset, defaultSettings()) };
}

test('Takeout の解析: Music 以外は除外し、タイトルを整える', () => {
    const { src } = load();
    assert.equal(src.kind, 'takeout');
    assert.equal(src.entries.length, 6);
    assert.equal(src.skipped, 1);
    assert.equal(src.entries[0].title, 'Song A');
    assert.equal(src.entries[0].v, 'aaaaaaaaaaa');
    assert.equal(src.entries[5].title, null);
});

test('HTML や不正な JSON はわかるエラーにする', () => {
    assert.throws(() => parseText('x.html', '<html></html>'), /HTML/);
    assert.throws(() => parseText('x.json', '{broken'), /JSON/);
    assert.throws(() => parseText('x.json', '{"a":1}'), /対応していない/);
});

test('ZIP から watch-history.json を取り出す', async () => {
    const zip = zipSync({ 'Takeout/YouTube と YouTube Music/履歴/watch-history.json': strToU8(JSON.stringify(takeout)) });
    const r = await parseFile('takeout.zip', zip.buffer);
    assert.equal(r.sources.length, 1);
    assert.equal(r.sources[0].entries.length, 6);
});

test('結合で重複を除き、時刻順に並べる', () => {
    const { src, dataset } = load();
    const again = mergeEntries(dataset, src.entries);
    assert.equal(again.added, 0);
    assert.equal(again.duplicates, 6);
    const t = dataset.times;
    for (let i = 1; i < t.length; i++) assert.ok(t[i - 1] <= t[i]);
});

test('バックアップを読み込み直せる', () => {
    const { dataset } = load();
    const settings = { ...defaultSettings(), excludedArtists: ['a:artist y'] };
    const src = parseText('backup.json', JSON.stringify(buildBackup(dataset, settings)));
    assert.equal(src.kind, 'backup');
    assert.equal(src.entries.length, 6);
    assert.deepEqual(src.settings.excludedArtists, ['a:artist y']);
    const merged = mergeEntries(dataset, src.entries);
    assert.equal(merged.added, 0);
});

test('旧バージョンのバックアップ形式を読み込める', () => {
    const legacy = [{ title: 'Song A', artist: 'Artist X', url: 'https://music.youtube.com/watch?v=aaaaaaaaaaa', artistUrl: null, date: at(2024, 1, 1) }];
    const src = parseText('old.json', JSON.stringify(legacy));
    assert.equal(src.kind, 'legacy-backup');
    assert.equal(src.entries[0].v, 'aaaaaaaaaaa');
});

test('「- Topic」と公式チャンネルを同じアーティストとして数える', () => {
    const { model } = load();
    assert.equal(artistKeyOf('Artist X - Topic'), artistKeyOf('artist x'));
    const stats = computeStats(model, { start: null, end: null });
    const top = stats.artists[0];
    assert.equal(model.artists[top.i].name, 'Artist X');
    assert.equal(top.count, 3);
});

test('統計: 合計・日数・連続日数・月の 0 埋め', () => {
    const { model } = load();
    const s = computeStats(model, { start: null, end: null });
    assert.equal(s.total, 6);
    assert.equal(s.activeDays, 6);
    assert.equal(s.longest.length, 4); // 12/31〜1/3
    assert.deepEqual(s.monthly.map((m) => m.value), [1, 4, 0, 1]);
    assert.equal(s.songs[0].rank, 1);
});

test('同数は同順位になる', () => {
    const { model } = load();
    const s = computeStats(model, periodRange(parsePeriod('y2024'), model));
    const ranks = s.songs.map((x) => x.rank);
    assert.deepEqual(ranks, [1, 2, 2]);
});

test('除外とまとめが集計に反映される', () => {
    const { dataset } = load();
    const settings = { ...defaultSettings(), excludedArtists: ['a:artist y'] };
    const s = computeStats(buildModel(dataset, settings), { start: null, end: null });
    assert.equal(s.total, 4);
    const merged = buildModel(dataset, { ...defaultSettings(), aliases: { 'a:artist y': 'a:artist x' } });
    const s2 = computeStats(merged, { start: null, end: null });
    assert.equal(s2.artists.length, 2); // Artist X と 不明
    assert.equal(s2.artists[0].count, 5);
});

test('期間の変換と直前期間', () => {
    const { model } = load();
    for (const s of ['all', 'y2024', 'l30', 'c20240101-20240131']) assert.equal(encodePeriod(parsePeriod(s)), s);
    const r = periodRange(parsePeriod('y2024'), model);
    assert.equal(r.start, dayFromYmd(2024, 0, 1));
    assert.deepEqual(previousRange(parsePeriod('y2024'), model), periodRange(parsePeriod('y2023'), model));
    const ranks = computeRanks(model, previousRange(parsePeriod('y2024'), model));
    assert.equal(ranks.total, 1);
});

test('詳細: 曲とアーティスト', () => {
    const { model } = load();
    const all = { start: null, end: null };
    const ti = model.tracks.findIndex((t) => t.v === 'aaaaaaaaaaa');
    const d = trackDetail(model, ti, all);
    assert.equal(d.count, 3);
    assert.ok(d.plays[0] > d.plays[2]);
    const a = artistDetail(model, model.tracks[ti].artistIdx, all);
    assert.equal(a.topTracks[0].count, 3);
});

test('日付ヘルパーと HTML エスケープ', () => {
    assert.equal(dayWeekday(dayFromYmd(2024, 0, 1)), 1); // 月曜
    assert.equal(dayNumber(new Date(2024, 0, 1, 23, 59).getTime()), dayFromYmd(2024, 0, 1));
    assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
    assert.equal(String(html`<b>${'<i>'}</b>${raw('<br>')}`), '<b>&lt;i&gt;</b><br>');
});

// --- 推定再生時間・スキップ・曲のまとめ・ハマった曲 ---

import { findMergeCandidates, baseTitle, SKIP_MS } from '../js/model.js';
import { rankByTime, busiestWindow, dayDetail, computeHighlights } from '../js/stats.js';

function seqModel(settings = {}) {
    // 3 分ごとに A, A, B（B の直後 10 秒で C）…という並び
    const base = new Date(2024, 4, 1, 10).getTime();
    const items = [];
    const push = (ms, v, title, artist) => items.push(play(new Date(base + ms).toISOString(), v, title, artist));
    push(0, 'aaaaaaaaaaa', 'Song A', 'Artist X');
    push(180000, 'aaaaaaaaaaa', 'Song A', 'Artist X');
    push(360000, 'bbbbbbbbbbb', 'Song B', 'Artist X');
    push(370000, 'ccccccccccc', 'Song A (Official Music Video)', 'Artist X');
    push(550000, 'aaaaaaaaaaa', 'Song A', 'Artist X');
    const src = parseText('x.json', JSON.stringify(items));
    const { dataset } = mergeEntries(emptyDataset(), src.entries);
    return { dataset, model: buildModel(dataset, { ...defaultSettings(), ...settings }) };
}

test('スキップの判定と推定再生時間', () => {
    const { model } = seqModel();
    const b = model.tracks.findIndex((t) => t.v === 'bbbbbbbbbbb');
    const i = Array.from(model.trackIdx).indexOf(b);
    assert.equal(model.skip[i], 1);
    assert.equal(model.dur[i], 10000);
    assert.ok(10000 < SKIP_MS);
    const s = computeStats(model, { start: null, end: null });
    assert.equal(s.skips, 1);
    assert.equal(s.total, 5);
    const byTime = rankByTime(s, 'songs');
    assert.equal(model.tracks[byTime[0].i].v, 'aaaaaaaaaaa');
});

test('スキップを除外する設定', () => {
    const { model } = seqModel({ excludeSkips: true });
    const s = computeStats(model, { start: null, end: null });
    assert.equal(s.total, 4);
    assert.equal(s.skips, 1);
});

test('曲のまとめ候補と、まとめた結果', () => {
    assert.equal(baseTitle('Song A (Official Music Video)'), baseTitle('Song A'));
    assert.notEqual(baseTitle('Song A (Live at Budokan)'), baseTitle('Song A'));
    const { dataset, model } = seqModel();
    const cands = findMergeCandidates(model);
    assert.equal(cands.length, 1);
    assert.equal(model.tracks[cands[0].tracks[0]].v, 'aaaaaaaaaaa');
    assert.equal(findMergeCandidates(model, [cands[0].id]).length, 0);

    const merged = buildModel(dataset, { ...defaultSettings(), trackAliases: { 'v:ccccccccccc': 'v:aaaaaaaaaaa' } });
    const s = computeStats(merged, { start: null, end: null });
    assert.equal(s.songs[0].count, 4);
    assert.equal(merged.tracks[s.songs[0].i].title, 'Song A');
    assert.deepEqual(merged.tracks[s.songs[0].i].variants, ['Song A (Official Music Video)']);
});

test('集中して聴いた期間と 1 日の詳細', () => {
    assert.deepEqual(busiestWindow([1, 2, 40, 41, 42, 80], 30), { count: 3, start: 40, end: 42 });
    const { model } = seqModel();
    const d = dayDetail(model, dayFromYmd(2024, 4, 1));
    assert.equal(d.count, 5);
    assert.equal(model.artists[d.topArtists[0].i].name, 'Artist X');
    const s = computeStats(model, { start: null, end: null });
    const h = computeHighlights(model, s, { minPlays: 2 });
    assert.equal(h.bursts[0].count, 3);
});

// --- 原題・画像の取得（照合ルール） ---

import { nameKey, isVariantTitle, pickItunes, pickDeezerArtist, needsFetch, RETRY_MS } from '../js/enrich.js';

test('名前の照合キーと、別の版の判定', () => {
    assert.equal(nameKey('Kenshi Yonezu - Topic'), nameKey('kenshi yonezu'));
    assert.equal(nameKey('藤井 風'), nameKey('藤井風'));
    assert.ok(isVariantTitle('夜に駆ける (Piano Ver.)'));
    assert.ok(isVariantTitle('Into The Night (English Version)'));
    assert.ok(isVariantTitle('夜に駆ける - From THE FIRST TAKE'));
    assert.ok(!isVariantTitle('夜に駆ける'));
    assert.ok(!isVariantTitle('Lemon'));
});

test('iTunes の候補は、アーティストが一致し別の版でないものだけ採用する', () => {
    const results = [
        { trackName: '夜に駆ける (Piano Ver.)', artistName: 'Piano Echoes' },
        { trackName: '夜に駆ける - From THE FIRST TAKE', artistName: 'YOASOBI' },
        { trackName: '夜に駆ける', artistName: 'YOASOBI' },
    ];
    assert.deepEqual(pickItunes(results, { title: 'Yoru ni Kakeru', artistNames: ['YOASOBI'] }), { title: '夜に駆ける', artist: 'YOASOBI' });
    // アーティストが一致しなければ使わない
    assert.equal(pickItunes(results, { title: 'Yoru ni Kakeru', artistNames: ['Ayase'] }), null);
    // すでに同じ表記なら置き換えない
    assert.equal(pickItunes([{ trackName: 'Lemon', artistName: '米津玄師' }], { title: 'Lemon', artistNames: ['Kenshi Yonezu', '米津玄師'] }), null);
});

test('Deezer の候補は名前が一致し、画像があるものだけ使う', () => {
    const data = [
        { name: 'YOASOBI', picture_medium: 'https://cdn/images/artist/abc/250x250.jpg', nb_fan: 10 },
        { name: 'YOASOBI', picture_medium: 'https://cdn/images/artist//250x250.jpg', nb_fan: 99 },
        { name: 'Yoasobi Cover', picture_medium: 'https://cdn/images/artist/zzz/250x250.jpg', nb_fan: 999 },
    ];
    assert.equal(pickDeezerArtist(data, ['YOASOBI']), 'https://cdn/images/artist/abc/250x250.jpg');
    assert.equal(pickDeezerArtist(data, ['Ado']), '');
});

test('取得できなかったものは一定期間たってから再取得する', () => {
    const now = Date.now();
    assert.ok(needsFetch(undefined, now));
    assert.ok(!needsFetch({ t: 'x', src: 'yt', at: 0 }, now));
    assert.ok(!needsFetch({ t: null, src: 'none', at: now }, now));
    assert.ok(needsFetch({ t: null, src: 'none', at: now - RETRY_MS - 1 }, now));
});

test('取得した原題とアーティスト名がモデルに反映される', () => {
    const { dataset } = load();
    const meta = {
        tracks: {
            aaaaaaaaaaa: { t: 'ソングA', a: 'アーティストX - Topic', src: 'yt', at: 1 },
            bbbbbbbbbbb: { t: 'MV タイトル', a: 'Some Channel', src: 'yt', at: 1 },
        },
        artists: {},
    };
    const model = buildModel(dataset, defaultSettings(), meta);
    const a = model.tracks.find((t) => t.v === 'aaaaaaaaaaa');
    assert.equal(a.title, 'ソングA');
    assert.ok(a.variants.includes('Song A'));
    assert.equal(model.artists[a.artistIdx].name, 'アーティストX');
    assert.ok(model.artists[a.artistIdx].aliasNames.includes('Artist X'));
    // Topic 以外のチャンネル名ではアーティスト名を変えない
    const b = model.tracks.find((t) => t.v === 'bbbbbbbbbbb');
    assert.equal(model.artists[b.artistIdx].name, 'Artist Y');
    // 設定でオフにすると元の表記
    const off = buildModel(dataset, { ...defaultSettings(), fetchMeta: false }, meta);
    assert.equal(off.tracks.find((t) => t.v === 'aaaaaaaaaaa').title, 'Song A');
});

test('iTunes はアーティスト ID が一致する曲だけを採用し、曲名と名前の優先順位を守る', () => {
    const results = [
        { trackName: 'マリーゴールド (Instrumental)', artistName: 'あいみょん', artistId: 1 },
        { trackName: 'マリーゴールド', artistName: 'あいみょん', artistId: 1 },
    ];
    assert.deepEqual(pickItunes(results, { title: 'Marigold', artistId: 1 }), { title: 'マリーゴールド', artist: 'あいみょん' });
    assert.equal(pickItunes(results, { title: 'Marigold', artistId: 2 }), null);

    const { dataset } = load();
    const meta = {
        tracks: { aaaaaaaaaaa: { t: 'Song A (YT)', a: 'Artist X - Topic', src: 'yt', at: 1, it: 'ソングA', itAt: 1 } },
        artists: { 'a:artist x': { it: { id: 1, name: 'アーティストX', at: 1 } } },
    };
    const model = buildModel(dataset, defaultSettings(), meta);
    const a = model.tracks.find((t) => t.v === 'aaaaaaaaaaa');
    assert.equal(a.title, 'ソングA');
    assert.ok(a.variants.includes('Song A') && a.variants.includes('Song A (YT)'));
    assert.equal(model.artists[a.artistIdx].name, 'アーティストX');
});

test('別の版の曲名は、別の版の候補にだけ置き換える', () => {
    const results = [
        { trackName: 'きらり', artistName: '藤井 風', artistId: 5 },
        { trackName: 'きらり (Original Remix)', artistName: '藤井 風', artistId: 5 },
    ];
    assert.deepEqual(pickItunes(results, { title: 'Kirari (Original Remix)', artistId: 5 }), { title: 'きらり (Original Remix)', artist: '藤井 風' });
    assert.equal(pickItunes(results.slice(0, 1), { title: 'Kirari (Original Remix)', artistId: 5 }), null);
});
