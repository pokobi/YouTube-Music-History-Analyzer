// --- アプリケーションの状態管理 ---
const state = {
    rawData: null,        // 解析された全データ
    stats: null,          // 現在表示すべき統計データ
    filter: {             // フィルタ状態
        year: 'All',
        startDate: '',
        endDate: ''
    },
    searchTerm: '',       // 検索ワード
    loading: false,
    error: null,
    dragActive: false,
    historyList: [],      // 保存された履歴リスト
    db: null,             // IndexedDBインスタンス
    modal: null,          // モーダル表示用データ
    showScrollTop: false  // トップへ戻るボタンの表示状態
};

// --- IndexedDB ヘルパー (履歴保存用) ---
const DB_NAME = 'MusicAnalyzerDB';
const DB_VERSION = 6;
const STORE_HISTORY = 'history';

// DB初期化
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            state.db = request.result;
            resolve(state.db);
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_HISTORY)) {
                db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
            }
            ['metadata', 'corrections'].forEach(store => {
                if (db.objectStoreNames.contains(store)) {
                    db.deleteObjectStore(store);
                }
            });
        };
    });
}

// 履歴の保存
async function saveHistoryToDB(filename, data) {
    if (!state.db) await initDB();
    
    const minifiedData = data.map(item => ({
        t: item.title,
        a: item.artist,
        u: item.url,
        au: item.artistUrl,
        d: item.date.getTime()
    }));

    let minDate = null;
    let maxDate = null;
    if (data.length > 0) {
        minDate = data[0].date.getTime();
        maxDate = data[0].date.getTime();
        for (let i = 1; i < data.length; i++) {
            const t = data[i].date.getTime();
            if (t < minDate) minDate = t;
            if (t > maxDate) maxDate = t;
        }
    }

    const record = {
        filename: filename,
        importDate: new Date(),
        data: minifiedData,
        count: minifiedData.length,
        period: {
            start: minDate,
            end: maxDate
        }
    };

    return new Promise((resolve, reject) => {
        const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
        const store = tx.objectStore(STORE_HISTORY);
        store.add(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// 履歴リストの取得
async function loadHistoryList() {
    if (!state.db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = state.db.transaction(STORE_HISTORY, 'readonly');
        const store = tx.objectStore(STORE_HISTORY);
        const request = store.getAll();
        request.onsuccess = () => {
            const list = request.result.map(item => ({
                id: item.id,
                filename: item.filename,
                importDate: item.importDate,
                count: item.count,
                period: item.period
            })).sort((a, b) => b.importDate - a.importDate);
            state.historyList = list;
            resolve(list);
        };
        request.onerror = () => reject(request.error);
    });
}

// 特定の履歴データをロード
async function loadHistoryData(id) {
    if (!state.db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = state.db.transaction(STORE_HISTORY, 'readonly');
        const store = tx.objectStore(STORE_HISTORY);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// 履歴の削除
async function deleteHistory(id) {
    if (!state.db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = state.db.transaction(STORE_HISTORY, 'readwrite');
        const store = tx.objectStore(STORE_HISTORY);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- ヘルパー関数 ---

function cleanTitle(title) {
    if (!title) return "Unknown Title";
    return title
        .replace(/ を視聴しました$/, '')
        .replace(/^Watched /, '')
        .replace(/を視聴しました$/, '')
        .replace(/\s*[\[\(](?:\s*Official\s*|(?:\s*Music\s*)?Video|MV|PV|Cover|Live|Lyrics|Lyric|Audio|Shorts|feat\.|ft\.).*?[\]\)]/gi, '')
        .trim();
}

function cleanArtist(artistName) {
    if (!artistName) return "Unknown Artist";
    return artistName.replace(/ - Topic$/, '').trim();
}

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
}

function extractChannelId(url) {
    if (!url) return null;
    const match = url.match(/\/channel\/([^/?]+)/);
    return match ? match[1] : null;
}

function formatDate(date) {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateTime(date) {
    return new Date(date).toLocaleString('ja-JP');
}

function formatNumber(num) {
    return num.toLocaleString();
}

// YYYY-MM-DD形式の文字列をDateオブジェクトに変換
function parseDateString(dateStr, endOfDay = false) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (endOfDay) {
        d.setHours(23, 59, 59, 999);
    } else {
        d.setHours(0, 0, 0, 0);
    }
    return d;
}

// 今日の日付をYYYY-MM-DDで取得
function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

// クリップボードにコピー
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast(`「${text}」をコピーしました`);
    }).catch(err => {
        console.error('Copy failed', err);
    });
}

// トースト通知を表示
function showToast(message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg border border-gray-700 text-sm flex items-center gap-2 animate-toast pointer-events-auto';
    toast.innerHTML = `<i data-lucide="check" class="w-4 h-4 text-green-400"></i> ${message}`;
    
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ハイライト用ヘルパー
function highlightText(text) {
    if (!state.searchTerm || !text) return text;
    const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const regex = new RegExp(`(${state.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<span class="bg-yellow-500/30 text-yellow-200 font-bold">$1</span>');
}

// --- メインロジック ---

// 初期化
(async function init() {
    try {
        await initDB();
        await loadHistoryList();
        
        // 初回描画
        renderHeader();
        renderMain(); 
        
        // スクロールイベント監視
        window.addEventListener('scroll', () => {
            const show = window.scrollY > 300;
            if (state.showScrollTop !== show) {
                state.showScrollTop = show;
                renderScrollButton();
            }
        });

        // コピーボタンのイベント委譲
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.copy-btn');
            if (btn) {
                e.stopPropagation();
                const text = btn.dataset.text;
                if (text) copyToClipboard(text);
            }
        });

        // ダッシュボード表示時などのグローバルなドラッグ＆ドロップ（追加マージ用）
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            if (document.getElementById('dropZone')) return;
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const hasJson = Array.from(e.dataTransfer.files).some(f => f.name.endsWith('.json'));
                if (hasJson) {
                    handleFiles(e.dataTransfer.files);
                }
            }
        });

    } catch (e) {
        console.error("Init Failed", e);
    }
})();

// FileReaderをPromise化
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

// 複数ファイル入力および追加マージハンドラ
async function handleFiles(files) {
    if (state.loading) return; 
    if (!files || files.length === 0) return;

    state.loading = true;
    state.error = null;
    renderMain();

    try {
        let allProcessedData = [];
        let baseDataLength = 0;
        
        if (state.rawData && state.rawData.length > 0) {
            allProcessedData = allProcessedData.concat(state.rawData);
            baseDataLength = state.rawData.length;
        } else if (state.historyList && state.historyList.length > 0) {
            // 過去の履歴をマージベースとして全て読み込む
            for (const hist of state.historyList) {
                const record = await loadHistoryData(hist.id);
                if (record && record.data) {
                    const restoredData = record.data.map(item => {
                        const date = new Date(item.d);
                        return {
                            title: item.t,
                            artist: item.a,
                            url: item.u,
                            artistUrl: item.au,
                            date: date,
                            year: date.getFullYear(),
                            hour: date.getHours(),
                            monthKey: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`,
                            dayKey: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
                            dayValue: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
                            videoId: extractVideoId(item.u),
                            channelId: item.au ? extractChannelId(item.au) : null
                        };
                    });
                    allProcessedData = allProcessedData.concat(restoredData);
                }
            }
            baseDataLength = allProcessedData.length;
        }

        // 新しいファイルを追加
        for (const file of Array.from(files)) {
            if (!file.name.endsWith('.json')) continue;
            const text = await readFileAsText(file);
            const json = JSON.parse(text);
            const processed = parseRawJSON(json);
            allProcessedData = allProcessedData.concat(processed);
        }

        if (allProcessedData.length === 0) {
            throw new Error("有効なYouTube履歴データが見つかりませんでした。");
        }

        // 再生日時と楽曲識別情報で重複を排除
        const seen = new Set();
        const mergedData = allProcessedData.filter(item => {
            const uniqueKey = `${item.date.getTime()}_${item.videoId || (item.title + '_' + item.artist)}`;
            if (seen.has(uniqueKey)) return false;
            seen.add(uniqueKey);
            return true;
        });

        // 日付の新しい順に並び替え
        mergedData.sort((a, b) => b.date - a.date);

        // 全く新しいデータが追加されなかった場合は保存処理をスキップする
        const isNoNewData = (mergedData.length === baseDataLength && baseDataLength > 0);
        if (isNoNewData) {
            showToast("新しいデータは追加されませんでした（既存データと重複）");
            state.rawData = mergedData;
            resetFilters();
            calculateStats();
            return;
        }

        // 保存用のファイル名を決定
        let saveFilename = '';
        if (files.length === 1 && (!state.rawData || state.rawData.length === 0) && state.historyList.length === 0) {
            saveFilename = files[0].name;
        } else {
            saveFilename = `Merged_History_${new Date().toISOString().slice(0, 10)}`;
        }

        // 先に新しいマージデータを保存する
        await saveHistoryToDB(saveFilename, mergedData);

        // 自動マージが走った場合、履歴リストが冗長になるのを防ぐため過去の細かな履歴は整理（削除）する
        if (state.historyList && state.historyList.length > 0 && !state.rawData) {
            for (const hist of state.historyList) {
                await deleteHistory(hist.id);
            }
        }

        await loadHistoryList(); 

        state.rawData = mergedData;
        resetFilters();
        calculateStats();

    } catch (err) {
        console.error(err);
        state.error = "ファイルの読み込みまたはマージ処理に失敗しました。データが正しいJSON形式か確認してください。";
        state.loading = false;
        renderMain();
    }
}

// 履歴からのロードハンドラ
async function handleHistoryLoad(id) {
    state.loading = true;
    state.error = null;
    renderMain();

    try {
        const record = await loadHistoryData(id);
        if (!record) throw new Error("データが見つかりません");

        state.rawData = record.data.map(item => {
            const date = new Date(item.d);
            return {
                title: item.t,
                artist: item.a,
                url: item.u,
                artistUrl: item.au,
                date: date,
                year: date.getFullYear(),
                hour: date.getHours(),
                monthKey: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`,
                dayKey: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
                dayValue: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
                videoId: extractVideoId(item.u),
                channelId: item.au ? extractChannelId(item.au) : null
            };
        });

        resetFilters();
        calculateStats();

    } catch (err) {
        state.error = "履歴の読み込みに失敗しました: " + err.message;
        state.loading = false;
        renderMain();
    }
}

function resetFilters() {
    state.filter.year = 'All';
    state.filter.startDate = '';
    state.filter.endDate = '';
    state.searchTerm = '';
}

// 生JSONのパース処理
function parseRawJSON(jsonData) {
    if (!Array.isArray(jsonData)) throw new Error("Invalid Format");

    const musicData = jsonData.filter(item => 
        item.header === "YouTube Music" && item.titleUrl?.includes("music.youtube.com")
    );

    if (musicData.length === 0) throw new Error("No YouTube Music data found");

    return musicData.map(item => {
        const date = new Date(item.time);
        const title = cleanTitle(item.title.replace(/ を視聴しました$/, '').replace(/^Watched /, '').replace(/を視聴しました$/, ''));
        const artist = item.subtitles && item.subtitles[0] ? cleanArtist(item.subtitles[0].name) : "Unknown Artist";
        const artistUrl = item.subtitles && item.subtitles[0] ? item.subtitles[0].url : null;

        return {
            title: title,
            artist: artist,
            url: item.titleUrl,
            artistUrl: artistUrl,
            date: date,
            year: date.getFullYear(),
            hour: date.getHours(),
            monthKey: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`,
            dayKey: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
            dayValue: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
            videoId: extractVideoId(item.titleUrl),
            channelId: artistUrl ? extractChannelId(artistUrl) : null
        };
    });
}

// 統計計算
function calculateStats() {
    if (!state.rawData) return;

    const availableYears = new Set();
    state.rawData.forEach(d => availableYears.add(d.year));
    const sortedYears = Array.from(availableYears).sort((a, b) => b - a);

    let startFilter = state.filter.startDate ? parseDateString(state.filter.startDate) : null;
    let endFilter = state.filter.endDate ? parseDateString(state.filter.endDate, true) : null;

    const filteredData = state.rawData.filter(item => {
        if (state.filter.year !== 'All' && state.filter.year !== 'Custom') {
            if (item.year !== parseInt(state.filter.year)) return false;
        }
        if (startFilter && item.date < startFilter) return false;
        if (endFilter && item.date > endFilter) return false;
        return true;
    });

    const totalPlays = filteredData.length;

    if (totalPlays === 0) {
        state.stats = {
            totalPlays: 0,
            activeDays: 0,
            avgPlaysPerDay: "0.0",
            uniqueSongs: 0,
            uniqueArtists: 0,
            longestStreak: 0,
            allSongs: [],
            allArtists: [],
            topSongs: [],
            topArtists: [],
            artistShare: [],
            hourlyActivity: [],
            monthlyActivity: [],
            dateRange: { start: startFilter || new Date(), end: endFilter || new Date() },
            years: sortedYears
        };
        state.loading = false;
        renderHeader();
        renderMain();
        return;
    }

    const songCounts = {};
    const artistCounts = {};
    const hourCounts = new Array(24).fill(0);
    const monthCounts = {};
    const activeDaysSet = new Set();
    
    let minDate = new Date(8640000000000000);
    let maxDate = new Date(-8640000000000000);

    filteredData.forEach(item => {
        if (item.date < minDate) minDate = item.date;
        if (item.date > maxDate) maxDate = item.date;

        hourCounts[item.hour]++;
        if (!monthCounts[item.monthKey]) monthCounts[item.monthKey] = 0;
        monthCounts[item.monthKey]++;
        activeDaysSet.add(item.dayValue);

        const songKey = item.videoId || `${item.title}-${item.artist}`;
        if (!songCounts[songKey]) {
            songCounts[songKey] = {
                id: item.videoId,
                title: item.title,
                artist: item.artist,
                count: 0,
                url: item.url,
                artistUrl: item.artistUrl,
                firstPlayed: item.date,
                imgId: item.videoId,
                history: [],
                monthActivity: {}
            };
        }
        songCounts[songKey].count++;
        songCounts[songKey].history.push({ date: item.date });
        if (item.date < songCounts[songKey].firstPlayed) songCounts[songKey].firstPlayed = item.date;
        if (!songCounts[songKey].monthActivity[item.monthKey]) songCounts[songKey].monthActivity[item.monthKey] = 0;
        songCounts[songKey].monthActivity[item.monthKey]++;

        const artistKey = item.channelId || item.artist;
        if (!artistCounts[artistKey]) {
            artistCounts[artistKey] = {
                id: item.channelId,
                name: item.artist,
                count: 0,
                url: item.artistUrl,
                firstPlayed: item.date,
                history: [],
                monthActivity: {}
            };
        }
        artistCounts[artistKey].count++;
        artistCounts[artistKey].history.push({ date: item.date, title: item.title });
        if (item.date < artistCounts[artistKey].firstPlayed) artistCounts[artistKey].firstPlayed = item.date;
        if (!artistCounts[artistKey].monthActivity[item.monthKey]) artistCounts[artistKey].monthActivity[item.monthKey] = 0;
        artistCounts[artistKey].monthActivity[item.monthKey]++;
    });

    const sortedActiveDays = Array.from(activeDaysSet).sort((a, b) => a - b);
    let longestStreak = 0;
    let currentStreak = 0;
    let prevDay = null;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    sortedActiveDays.forEach(dayTime => {
        if (prevDay !== null) {
            if (dayTime - prevDay === ONE_DAY_MS) {
                currentStreak++;
            } else if (dayTime !== prevDay) {
                currentStreak = 1;
            }
        } else {
            currentStreak = 1;
        }
        if (currentStreak > longestStreak) longestStreak = currentStreak;
        prevDay = dayTime;
    });

    const allSongs = Object.values(songCounts).sort((a, b) => b.count - a.count);
    const allArtists = Object.values(artistCounts).sort((a, b) => b.count - a.count);

    allArtists.forEach(a => {
        a.percentage = ((a.count / totalPlays) * 100).toFixed(2);
    });

    const topArtistsShare = allArtists.slice(0, 10).map(a => ({ 
        label: a.name, 
        value: a.count, 
        percent: ((a.count / totalPlays) * 100).toFixed(1)
    }));
    const othersCount = allArtists.slice(10).reduce((sum, a) => sum + a.count, 0);
    if (othersCount > 0) {
        topArtistsShare.push({ 
            label: 'その他', 
            value: othersCount, 
            percent: ((othersCount / totalPlays) * 100).toFixed(1)
        });
    }

    const hourlyData = hourCounts.map((count, hour) => ({ label: `${hour}`, value: count }));
    const monthlyData = Object.entries(monthCounts).map(([k, v]) => ({ label: k, value: v })).sort((a, b) => a.label.localeCompare(b.label));

    const daysDuration = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) || 1;
    const avgPlaysPerDay = (totalPlays / daysDuration).toFixed(1);
    const uniqueSongCount = Object.keys(songCounts).length;

    state.stats = {
        totalPlays: totalPlays,
        activeDays: activeDaysSet.size,
        avgPlaysPerDay,
        uniqueSongs: uniqueSongCount,
        uniqueArtists: Object.keys(artistCounts).length,
        longestStreak,
        allSongs,
        allArtists,
        topSongs: allSongs.slice(0, 100),
        topArtists: allArtists.slice(0, 100),
        artistShare: topArtistsShare,
        hourlyActivity: hourlyData,
        monthlyActivity: monthlyData,
        dateRange: { start: minDate, end: maxDate },
        years: sortedYears
    };
    state.loading = false;

    renderHeader();
    renderMain();
}

// --- モーダル関連処理 ---

function openDetailModal(type, id) {
    if (!state.stats) return;
    
    let data = null;
    if (type === 'song') {
        data = state.stats.allSongs.find(s => s.id === id || (!s.id && `${s.title}-${s.artist}` === id));
    } else {
        data = state.stats.allArtists.find(a => a.id === id || (!a.id && a.name === id));
    }

    if (data) {
        const chartData = Object.entries(data.monthActivity)
            .map(([k, v]) => ({ label: k, value: v }))
            .sort((a, b) => a.label.localeCompare(b.label));
        
        state.modal = { type, data, chartData };
        renderModal();
    }
}

function closeModal() {
    state.modal = null;
    renderModal();
}

// --- 描画関数群 ---

// 1. ヘッダー描画
function renderHeader() {
    const container = document.getElementById('header-container');
    const headerHTML = `
        <header class="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md relative md:sticky md:top-0 z-50">
            <div class="max-w-7xl mx-auto px-4 py-3 md:py-4 flex flex-col md:flex-row items-center justify-between gap-3 md:gap-4">
                <div class="flex items-center space-x-3 cursor-pointer group w-full md:w-auto justify-center md:justify-start" onclick="location.reload()">
                    <div class="bg-gradient-to-br from-red-600 to-red-700 p-2 rounded-xl shadow-lg shadow-red-900/20 group-hover:scale-105 transition-transform flex-shrink-0">
                        <i data-lucide="music" class="text-white w-5 h-5 md:w-6 md:h-6"></i>
                    </div>
                    <h1 class="text-lg md:text-xl font-bold tracking-tight group-hover:text-red-400 transition-colors truncate">YouTube Music Analyzer</h1>
                </div>
                ${state.stats ? renderControls() : ''}
            </div>
        </header>
    `;
    container.innerHTML = headerHTML;
    lucide.createIcons();
    setupHeaderListeners();
}

// 2. メインコンテンツ描画
function renderMain() {
    const container = document.getElementById('main-container');
    
    if (state.loading) {
        container.innerHTML = renderLoading();
    } else if (!state.rawData) {
        container.innerHTML = renderUploadScreen();
    } else {
        container.innerHTML = renderDashboard();
    }
    
    lucide.createIcons();
    setupMainListeners();
}

// 3. モーダル描画
function renderModal() {
    const container = document.getElementById('modal-container');
    if (!state.modal) {
        container.innerHTML = '';
        document.body.style.overflow = '';
        return;
    }

    document.body.style.overflow = 'hidden';
    const { type, data, chartData } = state.modal;
    const isSong = type === 'song';
    const sortedHistory = data.history.sort((a, b) => b.date - a.date);

    const listHTML = sortedHistory.map(item => `
        <div class="flex items-center justify-between p-3 border-b border-gray-700 last:border-0 hover:bg-gray-700/50 transition-colors">
            <div class="flex flex-col min-w-0 pr-4">
                ${!isSong ? `<span class="text-sm text-white font-medium truncate">${item.title}</span>` : ''}
                <span class="text-xs text-gray-400">${formatDate(item.date)}</span>
            </div>
            <span class="text-sm text-gray-500 font-mono flex-shrink-0">${item.date.toLocaleTimeString('ja-JP', {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in-up p-4" onclick="closeModal()">
            <div class="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-modal-in" onclick="event.stopPropagation()">
                <div class="p-6 border-b border-gray-700 flex justify-between items-start bg-gray-800 sticky top-0 z-10">
                    <div class="pr-8 min-w-0">
                        <p class="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">${isSong ? 'SONG HISTORY' : 'ARTIST HISTORY'}</p>
                        <h2 class="text-xl sm:text-2xl font-bold text-white leading-tight truncate pr-2" title="${isSong ? data.title : data.name}">${isSong ? data.title : data.name}</h2>
                        ${isSong ? `<p class="text-gray-400 text-sm mt-1 truncate">${data.artist}</p>` : ''}
                    </div>
                    <button onclick="closeModal()" class="text-gray-500 hover:text-white transition-colors flex-shrink-0 p-1">
                        <i data-lucide="x" class="w-6 h-6"></i>
                    </button>
                </div>
                
                <div class="p-4 bg-gray-900/50 border-b border-gray-700 grid grid-cols-2 gap-4">
                    <div class="bg-gray-800 p-3 rounded-lg border border-gray-700">
                        <p class="text-xs text-gray-500">総再生回数</p>
                        <p class="text-xl font-bold text-white">${formatNumber(data.count)}<span class="text-xs font-normal text-gray-500 ml-1">回</span></p>
                    </div>
                    <div class="bg-gray-800 p-3 rounded-lg border border-gray-700">
                        <p class="text-xs text-gray-500">初再生</p>
                        <p class="text-sm font-bold text-white mt-1">${formatDate(data.firstPlayed)}</p>
                    </div>
                </div>

                <div class="p-4 border-b border-gray-700 bg-gray-800">
                    <p class="text-xs text-gray-500 mb-2">月別再生推移</p>
                    <div class="h-48 w-full overflow-x-auto custom-scrollbar" id="modal-chart-container">
                        <div class="min-w-max h-full pb-8">
                            ${renderBarChart(chartData, "bg-green-500", true, true)}
                        </div>
                    </div>
                </div>

                <div class="overflow-y-auto p-2 custom-scrollbar flex-1 bg-gray-800">
                    <p class="text-xs text-gray-500 p-2 sticky top-0 bg-gray-800/95 backdrop-blur z-10 border-b border-gray-700/50">再生履歴一覧 (${sortedHistory.length}件)</p>
                    ${listHTML}
                </div>
            </div>
        </div>
    `;
    lucide.createIcons();
    
    // グラフを右端（最新）にスクロール
    const chartContainer = document.getElementById('modal-chart-container');
    if (chartContainer) {
        chartContainer.scrollLeft = chartContainer.scrollWidth;
    }
}

// 4. スクロールボタン描画
function renderScrollButton() {
    const container = document.getElementById('scroll-btn-container');
    const btnClass = state.showScrollTop 
        ? "fixed bottom-8 right-8 bg-red-600 hover:bg-red-500 text-white p-3 rounded-full shadow-2xl transition-all duration-300 z-40" 
        : "fixed bottom-8 right-8 bg-red-600 hover:bg-red-500 text-white p-3 rounded-full shadow-2xl transition-all duration-300 z-40 translate-y-20 opacity-0 pointer-events-none";
    
    container.innerHTML = `
        <button onclick="window.scrollTo({top: 0, behavior: 'smooth'})" class="${btnClass}">
            <i data-lucide="arrow-up" class="w-6 h-6"></i>
        </button>
    `;
    lucide.createIcons();
}

// --- HTML生成ヘルパー ---

function renderControls() {
    const yearOptions = state.stats ? state.stats.years.map(year => 
        `<option value="${year}" ${state.filter.year == year ? 'selected' : ''}>${year}年</option>`
    ).join('') : '';

    const today = getTodayString();

    return `
        <div class="flex flex-col xl:flex-row items-center gap-3 w-full md:w-auto mt-1 md:mt-0">
            <div class="flex flex-wrap justify-center items-center gap-2 w-full md:w-auto">
                <div class="relative group flex-shrink-0">
                    <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                        <i data-lucide="filter" class="w-3.5 h-3.5 text-gray-400"></i>
                    </div>
                    <select id="yearSelect" class="bg-gray-800 border border-gray-700 text-white text-xs md:text-sm rounded-lg focus:ring-red-500 focus:border-red-500 block w-28 md:w-32 pl-8 p-1.5 md:p-2 appearance-none cursor-pointer hover:bg-gray-750 transition-colors">
                        <option value="All" ${state.filter.year === 'All' ? 'selected' : ''}>全期間</option>
                        ${yearOptions}
                        <option value="Custom" ${state.filter.year === 'Custom' ? 'selected' : ''} disabled>カスタム</option>
                    </select>
                </div>

                <div class="flex items-center gap-1.5 bg-gray-800 border border-gray-700 rounded-lg p-1 px-2 flex-shrink-0">
                    <input type="date" id="startDate" value="${state.filter.startDate}" max="${today}" class="bg-transparent text-white text-xs md:text-sm focus:outline-none [color-scheme:dark] w-[110px] md:w-auto">
                    <span class="text-gray-500 text-xs md:text-sm">〜</span>
                    <input type="date" id="endDate" value="${state.filter.endDate}" max="${today}" class="bg-transparent text-white text-xs md:text-sm focus:outline-none [color-scheme:dark] w-[110px] md:w-auto">
                </div>
            </div>

            <div class="flex items-center justify-center gap-2 flex-wrap w-full md:w-auto">
                <button id="backupBtn" class="text-xs md:text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg transition-colors flex items-center gap-1.5 border border-gray-700" title="JSONバックアップ">
                    <i data-lucide="save" class="w-3.5 h-3.5 md:w-4 md:h-4"></i>
                </button>
                <button id="downloadBtn" class="text-xs md:text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg transition-colors flex items-center gap-1.5 border border-gray-700" title="CSV保存">
                    <i data-lucide="download" class="w-3.5 h-3.5 md:w-4 md:h-4"></i>
                </button>
                
                <div class="w-px h-5 bg-gray-700 mx-0.5"></div>
                
                <button id="addFileBtn" class="text-xs md:text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg transition-colors flex items-center gap-1.5 border border-gray-700" title="別の履歴ファイルを追加してマージ">
                    <i data-lucide="plus" class="w-3.5 h-3.5 md:w-4 md:h-4"></i>
                    <span class="hidden sm:inline">追加</span>
                </button>
                <button id="resetBtn" class="text-xs md:text-sm bg-gray-800 hover:bg-red-900/50 text-gray-300 hover:text-red-400 px-2.5 md:px-3 py-1.5 md:py-2 rounded-lg transition-colors flex items-center gap-1.5 border border-gray-700" title="現在のデータをクリアしてトップに戻る">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5 md:w-4 md:h-4"></i>
                </button>
                
                <input type="file" id="headerFileInput" multiple accept=".json" class="hidden">
            </div>
        </div>
    `;
}

function renderLoading() {
    return `
        <div class="max-w-2xl mx-auto mt-12 flex flex-col items-center animate-fade-in-up">
            <div class="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p class="text-xl font-medium text-gray-300">データを処理中...</p>
            <p class="text-sm text-gray-500 mt-2">これには数秒かかる場合があります</p>
        </div>
    `;
}

function renderUploadScreen() {
    const errorHTML = state.error ? `
        <div class="mt-8 p-4 bg-red-900/20 border border-red-500/50 rounded-xl flex items-center text-red-200 text-sm max-w-md animate-fade-in-up">
            <i data-lucide="alert-circle" class="mr-3 w-5 h-5 flex-shrink-0"></i>
            ${state.error}
        </div>
    ` : '';

    let historyHTML = '';
    if (state.historyList.length > 0) {
        const historyItems = state.historyList.map(item => {
            const periodStr = item.period && item.period.start 
                ? `<span class="font-medium text-blue-300">${formatDate(item.period.start)}</span> 〜 <span class="font-medium text-blue-300">${formatDate(item.period.end)}</span>`
                : '期間情報なし';

            return `
            <div onclick="handleHistoryLoad(${item.id})" class="flex items-center justify-between p-4 bg-gray-800 border border-gray-700 rounded-xl hover:bg-gray-700 transition-colors cursor-pointer group">
                <div class="flex items-center gap-4">
                    <div class="p-2 bg-gray-700 rounded-lg group-hover:bg-gray-600 transition-colors">
                        <i data-lucide="history" class="text-blue-400"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-white text-base">${item.filename}</h3>
                        <p class="text-xs text-gray-400 mt-1">
                            集計対象期間: ${periodStr}
                        </p>
                        <p class="text-[10px] text-gray-500 mt-1">
                            読込日: ${formatDateTime(item.importDate)} • データ数: ${formatNumber(item.count)}
                        </p>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); deleteHistoryAndReload(${item.id})" class="p-2 text-gray-500 hover:text-red-400 transition-colors rounded-full hover:bg-gray-600/50" title="履歴を削除">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        `}).join('');

        historyHTML = `
            <div class="mt-12 w-full max-w-2xl animate-fade-in-up">
                <h3 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <i data-lucide="clock" class="text-blue-500"></i>
                    履歴一覧 (ワンクリックで再ロード)
                </h3>
                <div class="space-y-3">
                    ${historyItems}
                </div>
            </div>
        `;
    }

    return `
        <div class="flex flex-col items-center">
            <div class="max-w-2xl w-full mt-8 animate-zoom-in">
                <div id="dropZone" class="relative border-2 border-dashed rounded-3xl p-12 text-center transition-all duration-300 flex flex-col items-center justify-center min-h-[300px] group ${state.dragActive ? 'border-red-500 bg-red-500/10 scale-105 shadow-2xl shadow-red-900/20' : 'border-gray-700 bg-gray-800/30 hover:border-gray-500 hover:bg-gray-800/50'}">
                    <input type="file" id="fileInput" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" accept=".json" multiple />
                    
                    <div class="bg-gray-800 p-6 rounded-2xl mb-6 shadow-xl group-hover:scale-110 transition-transform duration-300">
                        <i data-lucide="upload" class="w-12 h-12 text-red-500"></i>
                    </div>
                    <h2 class="text-2xl font-bold mb-3 bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">watch-history.json をドロップ</h2>
                    <p class="text-gray-400 mb-6 text-sm leading-relaxed">
                        Google Takeoutのファイルを選択（複数選択可）。データはブラウザ内に自動保存されます。<br/>
                        ※複数のファイルを同時に読み込んだり、後から追加で読み込ませてデータを統合（マージ）することが可能です。期間が重複しているデータは自動で判別され、除外されます。
                    </p>
                    <button class="bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-8 rounded-full transition-all shadow-lg shadow-red-900/30 hover:shadow-red-900/50 active:scale-95 pointer-events-none">ファイルを選択</button>
                    ${errorHTML}
                </div>
                
                <details class="group bg-gray-800 p-4 rounded-xl border border-gray-700 text-left w-full max-w-2xl mt-8">
                    <summary class="font-bold text-blue-400 cursor-pointer flex items-center justify-between hover:text-blue-300 transition-colors list-none">
                        <div class="flex items-center gap-2">
                            <i data-lucide="help-circle" class="w-5 h-5"></i> 
                            <span>JSONファイルの取得方法（Google Takeout）</span>
                        </div>
                        <i data-lucide="chevron-down" class="w-5 h-5 transition-transform duration-300 group-open:rotate-180"></i>
                    </summary>
                    <div class="mt-4 text-sm text-gray-300 space-y-2 leading-relaxed border-t border-gray-700 pt-4">
                        <ol class="list-decimal list-inside space-y-3">
                            <li><a href="https://takeout.google.com/" target="_blank" class="text-blue-400 hover:underline">Google Takeout</a> にアクセスします。</li>
                            <li><strong>「選択をすべて解除」</strong>をクリックします。</li>
                            <li>下にスクロールし、<strong>「YouTube と YouTube Music」</strong>のみにチェックを入れます。</li>
                            <li>「YouTube のすべてのデータが含まれます」ボタンをクリックし、<strong>「履歴」</strong>のみを選択して「OK」を押します（他のチェックは外してください）。</li>
                            <li>「複数のフォーマット」ボタンをクリックし、履歴が<strong>「JSON」</strong>形式になっていることを確認します。</li>
                            <li>ページ最下部の<strong>「次のステップ」</strong>をクリックします。</li>
                            <li>「エクスポートを作成」をクリックし、ダウンロードの準備ができるのを待ちます（通常数分〜数十分）。</li>
                            <li>ダウンロードしたZIPファイルを解凍し、フォルダ内の <code>Takeout/YouTube と YouTube Music/履歴/watch-history.json</code> をこのサイトにアップロードしてください。</li>
                        </ol>
                    </div>
                </details>
            </div>
            ${historyHTML}
        </div>
    `;
}

function renderDashboard() {
    const s = state.stats;
    if (s.totalPlays === 0) {
        return `
            <div class="flex flex-col items-center justify-center h-[50vh] text-gray-400 animate-fade-in-up">
                <div class="bg-gray-800 p-6 rounded-full mb-4">
                    <i data-lucide="calendar-off" class="w-12 h-12 text-gray-500"></i>
                </div>
                <h3 class="text-xl font-bold text-white mb-2">データが見つかりませんでした</h3>
                <p class="text-sm">選択された期間に一致する再生履歴はありません。<br>右上のフィルタ設定を変更してください。</p>
            </div>
        `;
    }

    const searchLower = state.searchTerm.toLowerCase();
    
    // 初期表示用のフィルタリング
    const filteredSongs = state.searchTerm 
        ? s.allSongs.filter(item => item.title.toLowerCase().includes(searchLower) || item.artist.toLowerCase().includes(searchLower)).slice(0, 100)
        : s.topSongs;
    
    const filteredArtists = state.searchTerm
        ? s.allArtists.filter(item => item.name.toLowerCase().includes(searchLower)).slice(0, 100)
        : s.topArtists;

    return `
        <div class="space-y-8 animate-fade-in-up">
            <!-- 概要 -->
            <div class="space-y-4">
                <div class="bg-gradient-to-r from-gray-800 to-gray-800/50 border border-gray-700 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div class="flex items-center gap-3">
                        <div class="bg-gray-700 p-2 rounded-lg text-gray-300"><i data-lucide="calendar"></i></div>
                        <div>
                            <p class="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                                集計期間 ${state.filter.year !== 'All' ? `<span class="text-red-400 ml-1">(${state.filter.year === 'Custom' ? '指定期間' : state.filter.year + '年'})</span>` : ''}
                            </p>
                            <p class="text-white font-medium">${formatDate(s.dateRange.start)} 〜 ${formatDate(s.dateRange.end)}</p>
                        </div>
                    </div>
                    <div class="text-xs text-gray-500 bg-gray-900/50 px-3 py-1.5 rounded-full border border-gray-700">
                        ${Math.ceil((s.dateRange.end - s.dateRange.start) / (1000 * 60 * 60 * 24))} 日間の記録
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    ${renderStatCard("総再生回数", formatNumber(s.totalPlays), `1日平均 ${s.avgPlaysPerDay} 再生`, "hash", "text-red-500")}
                    ${renderStatCard("最長連続再生", formatNumber(s.longestStreak), "連続リスニング記録 (日)", "zap", "text-yellow-400")}
                    ${renderStatCard("ユニークアーティスト", formatNumber(s.uniqueArtists), null, "mic", "text-purple-400")}
                    ${renderStatCard("ユニーク楽曲", formatNumber(s.uniqueSongs), null, "music", "text-blue-400")}
                </div>
            </div>

            <!-- ランキング -->
            <div class="space-y-6">
                <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                        <i data-lucide="file-text" class="text-red-500"></i>
                        ランキング (TOP100)
                    </h2>
                    <div class="relative w-full sm:w-64 group">
                        <div class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><i data-lucide="search" class="w-4 h-4"></i></div>
                        <input type="text" id="searchInput" placeholder="検索..." value="${state.searchTerm}" class="w-full bg-gray-800 border border-gray-700 text-white pl-10 pr-8 py-2 rounded-full focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-sm">
                        ${state.searchTerm ? `<button onclick="document.getElementById('searchInput').value=''; document.getElementById('searchInput').dispatchEvent(new Event('input'));" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><i data-lucide="x" class="w-3 h-3"></i></button>` : ''}
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <!-- 楽曲ランキング -->
                    <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden flex flex-col h-[500px]">
                        <div class="p-4 border-b border-gray-700 bg-gray-800/50 flex justify-between items-center sticky top-0 z-10 backdrop-blur">
                            <h3 class="font-bold flex items-center gap-2 text-white">
                                <i data-lucide="music" class="w-5 h-5 text-yellow-500"></i>
                                楽曲
                            </h3>
                            <span id="song-count-badge" class="bg-gray-700 text-white text-xs px-2 py-1 rounded-full ${state.searchTerm ? '' : 'hidden'}">${filteredSongs.length}件</span>
                        </div>
                        <div id="song-ranking-list" class="overflow-y-auto flex-1 p-4 custom-scrollbar">
                            ${filteredSongs.length > 0 ? filteredSongs.map((song, idx) => 
                                renderRankingItem(idx + 1, highlightText(song.title), highlightText(song.artist), song.count, s.topSongs[0] ? (song.count / s.topSongs[0].count) * 100 : 0, song.url, song.artistUrl, song.firstPlayed, song.imgId, 'song', null, song.id || `${song.title}-${song.artist}`)
                            ).join('') : '<div class="text-center text-gray-500 py-10">該当なし</div>'}
                        </div>
                    </div>

                    <!-- アーティストランキング -->
                    <div class="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden flex flex-col h-[500px]">
                        <div class="p-4 border-b border-gray-700 bg-gray-800/50 flex justify-between items-center sticky top-0 z-10 backdrop-blur">
                            <h3 class="font-bold flex items-center gap-2 text-white">
                                <i data-lucide="mic" class="w-5 h-5 text-purple-500"></i>
                                アーティスト
                            </h3>
                            <span id="artist-count-badge" class="bg-gray-700 text-white text-xs px-2 py-1 rounded-full ${state.searchTerm ? '' : 'hidden'}">${filteredArtists.length}件</span>
                        </div>
                        <div id="artist-ranking-list" class="overflow-y-auto flex-1 p-4 custom-scrollbar">
                            ${filteredArtists.length > 0 ? filteredArtists.map((artist, idx) => 
                                renderRankingItem(idx + 1, highlightText(artist.name), null, artist.count, s.topArtists[0] ? (artist.count / s.topArtists[0].count) * 100 : 0, artist.url, null, artist.firstPlayed, null, 'artist', artist.percentage, artist.id || artist.name)
                            ).join('') : '<div class="text-center text-gray-500 py-10">該当なし</div>'}
                        </div>
                    </div>
                </div>
            </div>

            <!-- 詳細統計 -->
            <div class="pt-8 border-t border-gray-800">
                <h2 class="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                    <i data-lucide="trending-up" class="text-blue-500"></i>
                    詳細統計データ
                </h2>
                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 w-full overflow-hidden">
                        <div class="flex items-center justify-between mb-6">
                            <h3 class="text-lg font-bold flex items-center gap-2"><i data-lucide="pie-chart" class="w-5 h-5 text-purple-500"></i> アーティストシェア (TOP10)</h3>
                        </div>
                        <div class="w-full flex justify-center items-center p-4">
                            ${renderPieChart(s.artistShare)}
                        </div>
                    </div>

                    <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 w-full overflow-hidden">
                        <div class="flex items-center justify-between mb-6">
                            <h3 class="text-lg font-bold flex items-center gap-2"><i data-lucide="clock" class="w-5 h-5 text-red-500"></i> 時間帯別推移</h3>
                        </div>
                        <div class="h-64 w-full overflow-x-auto custom-scrollbar">
                            <div class="min-w-[400px] h-full">${renderBarChart(s.hourlyActivity, "bg-red-500", true)}</div>
                        </div>
                    </div>

                    <div class="bg-gray-800 p-6 rounded-xl border border-gray-700 lg:col-span-2 flex flex-col">
                        <div class="flex items-center justify-between mb-2">
                            <h3 class="text-lg font-bold flex items-center gap-2"><i data-lucide="bar-chart-2" class="w-5 h-5 text-blue-500"></i> 月別推移</h3>
                        </div>
                        <div class="flex-1 min-h-[200px] overflow-x-auto pb-4 custom-scrollbar">
                            <div class="min-w-max h-full pt-4 pr-4">${renderBarChart(s.monthlyActivity, "bg-blue-500", true, true)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderStatCard(title, value, subtext, icon, colorClass, className = "") {
    return `
        <div class="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 flex items-start space-x-4 hover:bg-gray-750 transition-colors h-full ${className}">
            <div class="p-3 rounded-lg bg-gray-700/50 ${colorClass}"><i data-lucide="${icon}"></i></div>
            <div class="flex-1 min-w-0">
                <p class="text-gray-400 text-sm font-medium">${title}</p>
                <h3 class="text-2xl font-bold text-white mt-1 truncate" title="${value}">${value}</h3>
                ${subtext ? `<p class="text-gray-500 text-xs mt-1">${subtext}</p>` : ''}
            </div>
        </div>
    `;
}

function renderRankingItem(rank, title, subtitle, count, percentage, songUrl, artistUrl, firstPlayed, imgId, type, sharePercent, id) {
    const isTop5 = rank <= 5;
    const rankColor = rank <= 3 ? 'text-white' : 'text-gray-500';
    const titleClass = isTop5 ? 'text-lg text-white' : 'text-sm text-gray-200';
    const subClass = isTop5 ? 'text-gray-400 text-sm' : 'text-gray-500 text-xs';
    
    let crownIcon = '';
    if (rank === 1) crownIcon = '<i data-lucide="crown" class="w-5 h-5 text-yellow-400 mb-1 fill-current"></i>';
    else if (rank === 2) crownIcon = '<i data-lucide="crown" class="w-5 h-5 text-gray-300 mb-1 fill-current"></i>';
    else if (rank === 3) crownIcon = '<i data-lucide="crown" class="w-5 h-5 text-amber-600 mb-1 fill-current"></i>';

    const rawTitle = title.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const copyText = rawTitle.replace(/"/g, '&quot;');

    const titleHTML = songUrl 
        ? `<div class="flex items-center min-w-0 group/title">
            <a href="${songUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="font-medium truncate hover:text-red-400 transition-colors flex items-center gap-1 group/link ${titleClass}" title="開く"><span class="truncate">${title}</span><i data-lucide="external-link" class="w-3 h-3 opacity-0 group-hover/link:opacity-100 transition-opacity flex-shrink-0"></i></a>
            <button class="copy-btn ml-2 text-gray-600 hover:text-white opacity-0 group-hover/title:opacity-100 transition-opacity" data-text="${copyText}" title="コピー"><i data-lucide="copy" class="w-3 h-3"></i></button>
           </div>`
        : `<div class="flex items-center min-w-0 group/title">
            <h4 class="font-medium truncate ${titleClass}" title="${copyText}">${title}</h4>
            <button class="copy-btn ml-2 text-gray-600 hover:text-white opacity-0 group-hover/title:opacity-100 transition-opacity" data-text="${copyText}" title="コピー"><i data-lucide="copy" class="w-3 h-3"></i></button>
           </div>`;

    const subHTML = subtitle ? (artistUrl 
        ? `<a href="${artistUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="truncate flex items-center gap-1 hover:text-gray-300 ${subClass}">${subtitle}</a>`
        : `<p class="truncate ${subClass}">${subtitle}</p>`) : '';

    let coverHTML = '';
    if (type === 'song') {
        if (imgId) {
            coverHTML = `<div class="w-12 h-12 flex-shrink-0 mr-3 overflow-hidden rounded border border-gray-700 bg-gray-900 relative">
                 <img src="https://i.ytimg.com/vi/${imgId}/mqdefault.jpg" alt="cover" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display='none'">
               </div>`;
        } else {
            coverHTML = `<div class="w-12 h-12 flex-shrink-0 mr-3 rounded border border-gray-700 bg-gray-800 flex items-center justify-center"><i data-lucide="music" class="w-6 h-6 text-gray-600"></i></div>`;
        }
    } else {
        coverHTML = '';
    }

    return `
        <div onclick="openDetailModal('${type}', '${id}')" class="flex items-center p-3 transition-colors rounded-lg group cursor-pointer ${isTop5 ? 'bg-gray-700/30 mb-2 border border-gray-700 hover:bg-gray-700/60' : 'hover:bg-gray-700/50'}">
            <div class="text-center font-bold flex-shrink-0 flex flex-col items-center justify-center ${isTop5 ? 'w-12' : 'w-8'}">
                ${crownIcon}
                <span class="${isTop5 ? 'text-xl text-white' : rankColor}">${rank}</span>
            </div>
            
            <div class="flex-1 min-w-0 ml-3 flex items-center">
                ${coverHTML}
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-baseline mb-1 gap-2">
                        <div class="min-w-0 flex-1">${titleHTML}</div>
                        <div class="text-right flex-shrink-0">
                            <span class="${isTop5 ? 'text-white font-bold' : 'text-gray-400 text-sm'} block">${formatNumber(count)} 回</span>
                            ${sharePercent ? `<span class="text-xs text-gray-500 block">${sharePercent}%</span>` : ''}
                        </div>
                    </div>
                    
                    <div class="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden mb-1">
                        <div class="h-1.5 rounded-full transition-all duration-500 ease-out ${rank === 1 ? 'bg-gradient-to-r from-yellow-500 to-red-500' : 'bg-red-500'}" style="width: ${percentage}%"></div>
                    </div>

                    <div class="flex items-center justify-between mt-1">
                        <div class="flex items-center gap-1 min-w-0 flex-1">${subHTML}</div>
                        ${firstPlayed ? `<div class="text-[10px] text-gray-600 flex items-center gap-1 ml-2 flex-shrink-0" title="初めて再生した日"><i data-lucide="play-circle" class="w-3 h-3"></i>${formatDate(firstPlayed)}</div>` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function updateRankings() {
    const s = state.stats;
    if (!s) return;

    const searchLower = state.searchTerm.toLowerCase();
    
    const highlightText = (text) => {
        if (!state.searchTerm || !text) return text;
        const escapedText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        const regex = new RegExp(`(${state.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapedText.replace(regex, '<span class="bg-yellow-500/30 text-yellow-200 font-bold">$1</span>');
    };

    const filteredSongs = state.searchTerm 
        ? s.allSongs.filter(item => item.title.toLowerCase().includes(searchLower) || item.artist.toLowerCase().includes(searchLower)).slice(0, 100)
        : s.topSongs;
    
    const filteredArtists = state.searchTerm
        ? s.allArtists.filter(item => item.name.toLowerCase().includes(searchLower)).slice(0, 100)
        : s.topArtists;

    const songBadge = document.getElementById('song-count-badge');
    const artistBadge = document.getElementById('artist-count-badge');
    if (songBadge) {
        songBadge.textContent = `${filteredSongs.length}件`;
        songBadge.classList.toggle('hidden', !state.searchTerm);
    }
    if (artistBadge) {
        artistBadge.textContent = `${filteredArtists.length}件`;
        artistBadge.classList.toggle('hidden', !state.searchTerm);
    }

    const songList = document.getElementById('song-ranking-list');
    const artistList = document.getElementById('artist-ranking-list');

    if (songList) {
        songList.innerHTML = filteredSongs.length > 0 ? filteredSongs.map((song, idx) => 
            renderRankingItem(idx + 1, highlightText(song.title), highlightText(song.artist), song.count, s.topSongs[0] ? (song.count / s.topSongs[0].count) * 100 : 0, song.url, song.artistUrl, song.firstPlayed, song.imgId, 'song', null, song.id || `${song.title}-${song.artist}`)
        ).join('') : '<div class="text-center text-gray-500 py-10">該当なし</div>';
    }

    if (artistList) {
        artistList.innerHTML = filteredArtists.length > 0 ? filteredArtists.map((artist, idx) => 
            renderRankingItem(idx + 1, highlightText(artist.name), null, artist.count, s.topArtists[0] ? (artist.count / s.topArtists[0].count) * 100 : 0, artist.url, null, artist.firstPlayed, null, 'artist', artist.percentage, artist.id || artist.name)
        ).join('') : '<div class="text-center text-gray-500 py-10">該当なし</div>';
    }
    
    lucide.createIcons();
}

function renderBarChart(data, colorClass, showLabels, labelRotate = false) {
    if (!data || data.length === 0) return '<div class="text-center text-gray-500 text-xs py-4">データなし</div>';
    
    const maxValue = Math.max(...data.map(d => d.value));
    const bars = data.map(item => {
        const heightPercent = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        return `
            <div class="flex-1 flex flex-col justify-end items-center group relative h-full min-w-[20px]">
                <div class="w-full max-w-[30px] rounded-t-sm opacity-80 hover:opacity-100 transition-all ${colorClass}" style="height: ${heightPercent}%; min-height: 4px;">
                    <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-30 border border-gray-700 shadow-xl transition-opacity">
                        <span class="font-bold">${item.label}</span>: ${formatNumber(item.value)}回
                    </div>
                </div>
                ${showLabels ? `<div class="text-[10px] text-gray-500 mt-2 whitespace-nowrap overflow-visible ${labelRotate ? 'origin-top-left rotate-45 translate-x-1' : 'text-center'}">${item.label}</div>` : ''}
            </div>
        `;
    }).join('');
    return `<div class="flex items-end justify-between space-x-1 h-full w-full">${bars}</div>`;
}

function renderPieChart(data) {
    if (!data || data.length === 0) return '';

    const colors = [
        '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', 
        '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#64748b'
    ];

    let cumulativePercent = 0;
    
    function getCoordinatesForPercent(percent) {
        const x = Math.cos(2 * Math.PI * percent);
        const y = Math.sin(2 * Math.PI * percent);
        return [x, y];
    }

    const slices = data.map((slice, index) => {
        const startPercent = cumulativePercent;
        const endPercent = cumulativePercent + (slice.percent / 100);
        cumulativePercent = endPercent;

        if (slice.percent >= 100) {
            return `<circle cx="0" cy="0" r="1" fill="${colors[index % colors.length]}" />`;
        }

        const [startX, startY] = getCoordinatesForPercent(startPercent);
        const [endX, endY] = getCoordinatesForPercent(endPercent);
        const largeArcFlag = slice.percent > 50 ? 1 : 0;

        const pathData = [
            `M 0 0`,
            `L ${startX} ${startY}`,
            `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
            `L 0 0`,
        ].join(' ');

        return `<path d="${pathData}" fill="${colors[index % colors.length]}" stroke="#1f2937" stroke-width="0.02" class="hover:opacity-80 transition-opacity"><title>${slice.label}: ${slice.percent}%</title></path>`;
    }).join('');

    const legends = data.map((slice, index) => `
        <div class="flex items-center justify-between text-xs mb-1">
            <div class="flex items-center">
                <span class="w-3 h-3 rounded-full mr-2" style="background-color: ${colors[index % colors.length]}"></span>
                <span class="text-gray-300 truncate w-24" title="${slice.label}">${slice.label}</span>
            </div>
            <span class="text-gray-400 font-mono">${slice.percent}%</span>
        </div>
    `).join('');

    return `
        <div class="flex flex-col md:flex-row items-center gap-8">
            <div class="w-48 h-48 flex-shrink-0">
                <svg viewBox="-1 -1 2 2" style="transform: rotate(-90deg);" class="w-full h-full overflow-visible">
                    ${slices}
                </svg>
            </div>
            <div class="flex-1 max-h-48 overflow-y-auto custom-scrollbar w-full">
                ${legends}
            </div>
        </div>
    `;
}

// --- イベントリスナー & 外部公開関数 ---

window.handleHistoryLoad = handleHistoryLoad;
window.deleteHistoryAndReload = async (id) => {
    if(confirm('この履歴を削除してもよろしいですか？')) {
        await deleteHistory(id);
        await loadHistoryList();
        renderMain();
    }
};
window.openDetailModal = openDetailModal;
window.closeModal = closeModal;
window.copyToClipboard = copyToClipboard;

function setupHeaderListeners() {
    const yearSelect = document.getElementById('yearSelect');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const downloadBtn = document.getElementById('downloadBtn');
    const backupBtn = document.getElementById('backupBtn');
    const resetBtn = document.getElementById('resetBtn');
    const addFileBtn = document.getElementById('addFileBtn');
    const headerFileInput = document.getElementById('headerFileInput');

    if (yearSelect) {
        yearSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            state.filter.year = val;
            if (val !== 'Custom') {
                state.filter.startDate = '';
                state.filter.endDate = '';
                if (startDateInput) startDateInput.value = '';
                if (endDateInput) endDateInput.value = '';
            }
            calculateStats();
        });
    }

    const handleDateChange = () => {
        const start = startDateInput.value;
        const end = endDateInput.value;
        state.filter.startDate = start;
        state.filter.endDate = end;
        if (start || end) {
            state.filter.year = 'Custom';
            if (yearSelect) yearSelect.value = 'Custom';
        }
        calculateStats();
    };

    if (startDateInput) startDateInput.addEventListener('change', handleDateChange);
    if (endDateInput) endDateInput.addEventListener('change', handleDateChange);

    if (downloadBtn) downloadBtn.addEventListener('click', downloadCSV);
    if (backupBtn) backupBtn.addEventListener('click', downloadJSON);
    
    // クリアボタン（全データリセット）
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('現在の表示データをクリアして、トップ画面に戻りますか？\n(履歴自体は保存されています)')) {
                state.stats = null;
                state.rawData = null;
                renderHeader();
                renderMain();
            }
        });
    }

    // 追加マージ用ボタンと隠しファイル入力の連携
    if (addFileBtn && headerFileInput) {
        addFileBtn.addEventListener('click', () => headerFileInput.click());
        headerFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFiles(e.target.files);
            }
        });
    }
}

function setupMainListeners() {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
        dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); state.dragActive = true; renderUploadScreenAndUpdate(); });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); state.dragActive = false; renderUploadScreenAndUpdate(); });
        dropZone.addEventListener('dragover', (e) => e.preventDefault());
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            state.dragActive = false;
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleFiles(e.dataTransfer.files);
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.searchTerm = e.target.value;
            updateRankings();
        });
    }
}

function renderUploadScreenAndUpdate() {
    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
        if (state.dragActive) {
            dropZone.classList.add('border-red-500', 'bg-red-500/10', 'scale-105', 'shadow-2xl');
            dropZone.classList.remove('border-gray-700', 'bg-gray-800/30');
        } else {
            dropZone.classList.remove('border-red-500', 'bg-red-500/10', 'scale-105', 'shadow-2xl');
            dropZone.classList.add('border-gray-700', 'bg-gray-800/30');
        }
    }
}

function downloadCSV() {
    if (!state.stats) return;
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let csvContent = `Type,Rank,Name,Artist,Plays,Percent,FirstPlayed,URL\n`;
    
    state.stats.allSongs.slice(0, 100).forEach((song, idx) => {
        csvContent += `Song,${idx + 1},"${song.title.replace(/"/g, '""')}","${song.artist.replace(/"/g, '""')}",${song.count},-,${formatDate(song.firstPlayed)},"${song.url || ''}"\n`;
    });
    
    state.stats.allArtists.slice(0, 100).forEach((artist, idx) => {
        csvContent += `Artist,${idx + 1},"${artist.name.replace(/"/g, '""')}",-,${artist.count},${artist.percentage}%,${formatDate(artist.firstPlayed)},"${artist.url || ''}"\n`;
    });

    const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = state.filter.year === 'Custom' 
        ? `${state.filter.startDate}_to_${state.filter.endDate}`
        : state.filter.year;
    link.download = `music_stats_${dateStr}_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

function downloadJSON() {
    if (!state.rawData) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.rawData));
    const link = document.createElement('a');
    link.href = dataStr;
    link.download = `music_history_backup_${new Date().toISOString().slice(0,10)}.json`;
    link.click();
}