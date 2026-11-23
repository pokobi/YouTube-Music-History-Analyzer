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

import { nameKey, isVariantTitle, pickItunes, pickDeezerByTracks, searchTermOf, needsFetch, needsImage, artistImageOf, IMAGE_VERSION, RETRY_MS } from '../js/enrich.js';

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

// Deezer の曲検索の結果（実際の応答を縮めたもの）
const dz = (title, id, name, pic = `https://cdn/images/artist/${id}/250x250.jpg`) => ({ title, artist: { id, name, picture_medium: pic } });

test('Deezer は、曲名とアーティスト名が一致する本人の曲の写真を使う', () => {
    const results = [
        dz('Shape of You (Galantis Remix)', 1, 'Ed Sheeran'),
        dz('Shape of You', 2, 'Ed Sheeran Tribute Band'),
        dz('Shape of You', 1, 'Ed Sheeran'),
    ];
    assert.deepEqual(pickDeezerByTracks([{ results, titles: ['Shape of You'] }], ['Ed Sheeran']), { confirmed: true, img: 'https://cdn/images/artist/1/250x250.jpg', id: 1 });
    // 同じ名前でも、その曲を出していなければ使わない
    assert.equal(pickDeezerByTracks([{ results: [dz('Other Song', 9, 'Ed Sheeran')], titles: ['Shape of You'] }], ['Ed Sheeran']).confirmed, false);
});

test('Deezer は、カラオケやカバーの曲を本人の曲とみなさない', () => {
    const results = [
        dz('キュートなカノジョ (原曲歌手: syudou)', 5, '歌っちゃ王'),
        dz('Overdose (Cover) [オリジナル歌手：なとり]', 6, 'MF Mobile Melody Creators'),
    ];
    const pick = pickDeezerByTracks([
        { results, titles: ['キュートなカノジョ'] },
        { results, titles: ['Overdose'] },
    ], ['syudou', '歌っちゃ王']);
    assert.equal(pick.confirmed, false);
});

test('Deezer で名前の表記が違うアーティストは、2 曲で同じアーティストが出れば使う', () => {
    // natori（Deezer では「なとり」）: 2 曲とも曲名が一致
    const a = [dz('Overdose', 10, 'なとり'), dz('Overdose', 11, 'Raon')];
    const b = [dz('Sleepwalk', 10, 'なとり'), dz('SLEEPWALK', 12, 'ヒトリエ')];
    assert.deepEqual(pickDeezerByTracks([{ results: a, titles: ['Overdose'] }, { results: b, titles: ['Sleepwalk'] }], ['natori']), { confirmed: true, img: 'https://cdn/images/artist/10/250x250.jpg', id: 10 });
    // 1 曲だけでは使わない
    assert.equal(pickDeezerByTracks([{ results: a, titles: ['Overdose'] }], ['natori']).confirmed, false);
    // Ado: 曲名は英訳（Show → 唱）だが、名前が一致する同じアーティストが 2 曲で出る
    const c = [dz('唱', 20, 'Ado')];
    const d = [dz('うっせぇわ', 20, 'Ado'), dz('うっせぇわ', 21, 'Amelia Khor')];
    assert.equal(pickDeezerByTracks([{ results: c, titles: ['Show'] }, { results: d, titles: ['Usseewa'] }], ['Ado']).img, 'https://cdn/images/artist/20/250x250.jpg');
    // 名前も曲名も一致しなければ、2 曲で出ても使わない
    assert.equal(pickDeezerByTracks([{ results: c, titles: ['Show'] }, { results: d, titles: ['Usseewa'] }], ['Someone']).confirmed, false);
});

test('Deezer で本人を確かめられても写真がなければ空にする', () => {
    const results = [dz('Song', 30, 'Minor Artist', 'https://cdn/images/artist//250x250.jpg')];
    assert.deepEqual(pickDeezerByTracks([{ results, titles: ['Song'] }], ['Minor Artist']), { confirmed: true, img: '', id: 30 });
    // 画像のハッシュが空文字列の MD5 のものも、写真なしの仮の画像
    const blank = 'https://cdn-images.dzcdn.net/images/artist/d41d8cd98f00b204e9800998ecf8427e/250x250-000000-80-0-0.jpg';
    const kai = [dz('マジカホリック', 106837152, 'カイ', blank)];
    assert.deepEqual(pickDeezerByTracks([{ results: kai, titles: ['マジカホリック'] }], ['Kai', 'カイ']), { confirmed: true, img: '', id: 106837152 });
    // 以前の版で記録した仮の画像は使わず、取り直す
    const now = Date.now();
    const stored = { img: blank, imgAt: now, imgV: IMAGE_VERSION, dzId: 106837152 };
    assert.equal(artistImageOf(stored), '');
    assert.ok(needsImage(stored, now));
});

test('検索には英字だけの表記を優先して使う', () => {
    assert.equal(searchTermOf(['唱', 'Show']), 'Show');
    assert.equal(searchTermOf(['なとり', 'natori']), 'natori');
    assert.equal(searchTermOf(['夜に駆ける']), '夜に駆ける');
});

test('古い方式の画像は使わず、取り直す', () => {
    const now = Date.now();
    const old = { img: 'https://cdn/x.jpg', imgAt: now };
    assert.equal(artistImageOf(old), null);
    assert.ok(needsImage(old, now));
    const cur = { img: 'https://cdn/x.jpg', imgAt: now, imgV: IMAGE_VERSION, dzId: 5 };
    assert.equal(artistImageOf(cur), 'https://cdn/x.jpg');
    assert.ok(!needsImage(cur, now));
    // Deezer のアーティスト ID を記録していない画像は取り直す（Wikidata の照合に使う）
    assert.ok(needsImage({ ...cur, dzId: undefined }, now));
    // 確かめられなかったものは、iTunes で名前が分かったあとに 1 回だけ探し直す
    const none = { img: '', imgAt: now - 10, imgV: IMAGE_VERSION, it: { v: 2, id: 1, at: now } };
    assert.ok(needsImage(none, now));
    assert.ok(!needsImage({ ...none, imgAt: now + 1 }, now));
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
        artists: { 'a:artist x': { it: { v: 2, id: 1, ja: true, name: 'アーティストX', at: 1 } } },
    };
    const model = buildModel(dataset, defaultSettings(), meta);
    const a = model.tracks.find((t) => t.v === 'aaaaaaaaaaa');
    assert.equal(a.title, 'ソングA');
    assert.ok(a.variants.includes('Song A') && a.variants.includes('Song A (YT)'));
    assert.equal(model.artists[a.artistIdx].name, 'アーティストX');
    // 古い方式で保存した名前（共演曲の名義が入っていることがある）は使わない
    meta.artists['a:artist x'].it = { id: 1, name: 'Artist X × ゲスト', at: 1 };
    const old = buildModel(dataset, defaultSettings(), meta);
    assert.equal(old.artists[old.tracks.find((t) => t.v === 'aaaaaaaaaaa').artistIdx].name, 'Artist X');
});

test('別の版の曲名は、別の版の候補にだけ置き換える', () => {
    const results = [
        { trackName: 'きらり', artistName: '藤井 風', artistId: 5 },
        { trackName: 'きらり (Original Remix)', artistName: '藤井 風', artistId: 5 },
    ];
    assert.deepEqual(pickItunes(results, { title: 'Kirari (Original Remix)', artistId: 5 }), { title: 'きらり (Original Remix)', artist: '藤井 風' });
    assert.equal(pickItunes(results.slice(0, 1), { title: 'Kirari (Original Remix)', artistId: 5 }), null);
});

import { pickItunesArtist, itunesArtistGroups, findItunesArtistByTrack, needsItunesArtist, ITUNES_VERSION } from '../js/enrich.js';

// iTunes の「アーティスト名での曲検索」の結果（実際の応答を縮めたもの）
const song = (artistId, artistName, trackName) => ({ kind: 'song', artistId, artistName, trackName });
const natoriResults = [
    song(10, 'なとり', 'Overdose'), song(10, 'なとり', '金木犀'), song(10, 'なとり', 'セレナーデ'), song(10, 'なとり', 'Sleepwalk'),
    song(10, 'なとり & imase', 'メロドラマ'),
    song(11, '名取さな', 'アマカミサマ'), song(11, '名取さな', 'さなのおうた。'),
    song(12, 'Natori', 'Something'),
];

test('iTunes のアーティストは、利用者の曲と同じ曲名が多いものを選び、日本語の名前を使う', () => {
    const pick = pickItunesArtist(natoriResults, { names: ['natori'], titles: ['Overdose'] });
    assert.equal(pick.id, 10);
    assert.equal(pick.name, 'なとり'); // 共演の表記ではなく単独の名前
    assert.ok(pick.ja);
    assert.ok(pick.keys.has(nameKey('Overdose')));
    // 曲名が一致しなくても、名前が同じアーティストがあればそれを選ぶ
    assert.equal(pickItunesArtist(natoriResults, { names: ['Natori'], titles: ['Unknown Song'] }).id, 12);
    // 名前も曲名も一致しなければ選ばない
    assert.equal(pickItunesArtist(natoriResults, { names: ['nator1'], titles: ['Unknown Song'] }), null);
});

test('曲の一覧で 1 曲しか一致しないときは、利用者の曲の半分以上で一致する場合だけ選ぶ', () => {
    assert.equal(pickItunesArtist(natoriResults, { names: ['x'], titles: ['Overdose', 'A', 'B', 'C'] }), null);
    assert.equal(pickItunesArtist(natoriResults, { names: ['x'], titles: ['Overdose', 'A'] }).id, 10);
    assert.equal(pickItunesArtist(natoriResults, { names: ['x'], titles: ['Overdose', 'Sleepwalk', 'A', 'B', 'C'] }).id, 10);
});

test('日本語の曲名が少ないアーティスト（洋楽）は日本のアーティストとして扱わない', () => {
    const results = [
        song(20, 'エド・シーラン', 'Shape of You'), song(20, 'エド・シーラン', 'Perfect'),
        song(20, 'エド・シーラン', 'Photograph'), song(20, 'エド・シーラン & ジャスティン・ビーバー', 'I Don\'t Care'),
    ];
    const pick = pickItunesArtist(results, { names: ['Ed Sheeran'], titles: ['Shape of You', 'Perfect'] });
    assert.equal(pick.id, 20);
    assert.ok(!pick.ja);
});

test('曲の一覧で確かめられないアーティストは、曲の検索結果で確かめる', () => {
    const groups = itunesArtistGroups([song(30, 'あいみょん', '君はロックを聴かない'), song(31, 'aimyon tribute', 'x')], ['aimyon']);
    assert.equal(pickItunesArtist([song(30, 'あいみょん', '君はロックを聴かない')], { names: ['aimyon'], titles: ['Marigold'] }), null);
    const found = [song(99, '別のアーティスト', 'マリーゴールド'), song(30, 'あいみょん', 'マリーゴールド')];
    assert.equal(findItunesArtistByTrack(found, groups, 'Marigold').id, 30);
    // 別の版しか見つからなければ確かめられない
    assert.equal(findItunesArtistByTrack([song(30, 'あいみょん', 'マリーゴールド (Instrumental)')], groups, 'Marigold'), null);
});

test('古い方式で照合したアーティストは照合し直す', () => {
    const now = Date.now();
    assert.ok(needsItunesArtist({ it: { id: 1, name: null, at: now, skip: true } }, now));
    assert.ok(!needsItunesArtist({ it: { v: ITUNES_VERSION, id: 1, ja: true, name: null, at: now } }, now));
    assert.ok(!needsItunesArtist({ it: { v: ITUNES_VERSION, id: null, at: now } }, now));
    assert.ok(needsItunesArtist({ it: { v: ITUNES_VERSION, id: null, at: now - RETRY_MS - 1 } }, now));
});

test('同じ曲の別の表記は 1 曲として数え、日本語と英語の両方で一致を探す', () => {
    // 金木犀（書き出し時は Kinmokusei）と Overdose の 2 曲が一致する
    assert.equal(pickItunesArtist(natoriResults, { names: ['x'], titles: [['金木犀', 'Kinmokusei'], ['Overdose'], ['A'], ['B']] }).id, 10);
    // 1 曲の別の表記が両方一致しても 1 曲と数える
    assert.equal(pickItunesArtist(natoriResults, { names: ['x'], titles: [['Overdose', 'Overdose (Live)'], ['A'], ['B']] }), null);
});

test('共演の名義しかないアーティストの名前は使わない', () => {
    const pick = pickItunesArtist([song(40, 'syudou × 八木勇征', '美談'), song(40, 'syudou & SHIMA', 'ハナタバ')], { names: ['syudou'], titles: ['美談', 'ハナタバ'] });
    assert.equal(pick.id, 40);
    assert.equal(pick.name, null);
    // 単独の名前があればそれを使う（いちばん多い名前が共演でも）
    const solo = pickItunesArtist([song(41, 'Ado & 初音ミク', 'a'), song(41, 'Ado & 初音ミク', 'b'), song(41, 'Ado', 'c')], { names: ['Ado'], titles: ['a'] });
    assert.equal(solo.name, 'Ado');
});

import { SPOTIFY_VERSION, spotifyKeyOf, needsSpotify, spotifyImageOf, spotifyIdQuery, parseSpotifyIds, parseSpotifyOembed, pickSpotify } from '../js/enrich.js';

const SP_MGA = '4QvgGvpgzgyUOo8Yp8LDm9';
const SP_OTHER = '0000000000000000000001';

test('Spotify の ID を調べるキーは、照合済みの Apple と Deezer のアーティスト ID から作る', () => {
    const now = Date.now();
    assert.equal(spotifyKeyOf(undefined), '');
    assert.equal(spotifyKeyOf({ img: '', imgV: IMAGE_VERSION }), '');
    assert.equal(spotifyKeyOf({ it: { v: ITUNES_VERSION, id: 962221033 }, imgV: IMAGE_VERSION, dzId: 8152202 }), '962221033/8152202');
    // 古い版の照合結果は使わない
    assert.equal(spotifyKeyOf({ it: { v: ITUNES_VERSION - 1, id: 1 }, imgV: IMAGE_VERSION, dzId: 2 }), '/2');
    assert.equal(spotifyKeyOf({ it: { v: ITUNES_VERSION, id: 1 }, imgV: IMAGE_VERSION - 1, dzId: 2 }), '1/');

    const entry = { it: { v: ITUNES_VERSION, id: 1 }, imgV: IMAGE_VERSION, dzId: 2 };
    assert.ok(needsSpotify(entry, now));
    assert.ok(!needsSpotify({}, now));
    const sp = { v: SPOTIFY_VERSION, key: '1/2', id: SP_MGA, img: 'https://image-cdn-ak.spotifycdn.com/image/ab67616100005174c0a723402eb1cfbf2e10ce5c', at: now };
    assert.ok(!needsSpotify({ ...entry, sp }, now));
    // ID が変わったら調べ直し、画像は使わない
    const moved = { ...entry, dzId: 3, sp };
    assert.ok(needsSpotify(moved, now));
    assert.equal(spotifyImageOf(moved), null);
    // 30 日たったら、または取得方法の版が変わったら調べ直す
    assert.ok(needsSpotify({ ...entry, sp: { ...sp, at: now - RETRY_MS - 1 } }, now));
    assert.ok(needsSpotify({ ...entry, sp: { ...sp, v: SPOTIFY_VERSION + 1 } }, now));

    assert.equal(spotifyImageOf({ ...entry, sp }), sp);
    assert.equal(spotifyImageOf({ ...entry, sp: { ...sp, img: '' } }), null);
    // アルバムのジャケットは使わない（以前の版で記録したもの）
    assert.equal(spotifyImageOf({ ...entry, sp: { ...sp, img: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e022d92e9a2bbb598b699513481' } }), null);
    assert.equal(spotifyImageOf(undefined), null);
});

test('Wikidata の問い合わせには数字の ID だけを入れる', () => {
    const q = spotifyIdQuery(['962221033', '1"} ?x ?y {', 'abc'], [8152202]);
    assert.ok(q.includes('"962221033"'));
    assert.ok(q.includes('"8152202"'));
    assert.ok(!q.includes('abc'));
    assert.ok(!q.includes('?x'));
    assert.ok(q.includes('wdt:P2850') && q.includes('wdt:P2722') && q.includes('wdt:P1902'));
    assert.ok(!spotifyIdQuery([], ['x']).includes('P2722'));
    assert.equal(spotifyIdQuery([], []), '');
    assert.ok(!spotifyIdQuery(['1'], []).includes('UNION'));
});

test('Wikidata の結果を、ID ごとの Spotify の ID の一覧にする', () => {
    const json = { results: { bindings: [
        { apple: { value: '962221033' }, spotify: { value: SP_MGA } },
        { apple: { value: '962221033' }, spotify: { value: SP_MGA } },
        { apple: { value: '962221033' }, spotify: { value: SP_OTHER } },
        { deezer: { value: '8152202' }, spotify: { value: SP_MGA } },
        { deezer: { value: '1' }, spotify: { value: 'javascript:alert(1)' } },
    ] } };
    const r = parseSpotifyIds(json);
    assert.deepEqual(r.apple.get('962221033'), [SP_MGA, SP_OTHER]);
    assert.deepEqual(r.deezer.get('8152202'), [SP_MGA]);
    // Spotify の ID の形でないものは使わない
    assert.ok(!r.deezer.has('1'));
    assert.equal(parseSpotifyIds({}).apple.size, 0);
});

test('Spotify の画像は、Spotify の画像サーバーにあるアーティスト自身の画像だけ使う', () => {
    assert.deepEqual(parseSpotifyOembed({ title: 'Mrs. GREEN APPLE', thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/ab67616100005174c0a723402eb1cfbf2e10ce5c' }), { title: 'Mrs. GREEN APPLE', img: 'https://image-cdn-ak.spotifycdn.com/image/ab67616100005174c0a723402eb1cfbf2e10ce5c' });
    assert.equal(parseSpotifyOembed({ thumbnail_url: 'https://i.scdn.co/image/ab6761610000e5eb0b6fd24c' }).img, 'https://i.scdn.co/image/ab6761610000e5eb0b6fd24c');
    // アーティストの画像がないときに返るアルバムのジャケット
    assert.equal(parseSpotifyOembed({ thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e022d92e9a2bbb598b699513481' }).img, '');
    assert.equal(parseSpotifyOembed({ title: 'No Image' }).img, '');
    assert.equal(parseSpotifyOembed({ thumbnail_url: 'http://i.scdn.co/image/ab6761610000e5eb0b6fd24c' }).img, '');
    assert.equal(parseSpotifyOembed({ thumbnail_url: 'https://evil.example/scdn.co/image/ab6761610000e5eb' }).img, '');
    assert.equal(parseSpotifyOembed({ thumbnail_url: 'javascript:alert(1)' }).img, '');
    assert.deepEqual(parseSpotifyOembed(null), { title: '', img: '' });
});

test('Spotify の ID が複数あるときは、名前が一致するものを選ぶ', () => {
    const a = { id: SP_OTHER, title: 'Other Project', img: 'https://i.scdn.co/image/a' };
    const b = { id: SP_MGA, title: 'Mrs. GREEN APPLE', img: 'https://i.scdn.co/image/b' };
    assert.equal(pickSpotify([a, b], ['Mrs. GREEN APPLE']), b);
    assert.equal(pickSpotify([a, b], ['mrs.green apple', null]), b);
    // 一致しなければ画像のある最初のもの
    assert.equal(pickSpotify([null, { ...a, img: '' }, b], ['別の名前']), b);
    assert.equal(pickSpotify([null], ['x']), null);
    assert.equal(pickSpotify([], ['x']), null);
});
