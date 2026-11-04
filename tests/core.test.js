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
