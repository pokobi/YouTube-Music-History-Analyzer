// IndexedDB への保存と、旧バージョンのデータの引き継ぎ。

import { parseLegacyRecords } from './parser.js';

const DB_NAME = 'ytm-history-analyzer';
const DB_VERSION = 1;
const STORE = 'kv';

const LEGACY_DB_NAME = 'MusicAnalyzerDB';
const LEGACY_STORE = 'history';

let dbPromise = null;

function openDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error('別のタブでこのページが開かれているため、データを開けません。'));
        });
        dbPromise.catch(() => { dbPromise = null; });
    }
    return dbPromise;
}

function run(mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        const req = fn(store);
        if (req) req.onsuccess = () => { result = req.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('保存に失敗しました。'));
    }));
}

export function getValue(key) {
    return run('readonly', (s) => s.get(key));
}

/** 複数のキーをまとめて保存する（1 トランザクション） */
export function setValues(obj) {
    return run('readwrite', (s) => {
        for (const [k, v] of Object.entries(obj)) s.put(v, k);
        return null;
    });
}

export function clearAll() {
    return run('readwrite', (s) => s.clear());
}

/**
 * 旧バージョン（MusicAnalyzerDB）に保存されていた再生記録を読み出す。
 * データベースが無い場合は作らずに null を返す。
 */
export function readLegacyEntries() {
    return new Promise((resolve) => {
        let req;
        try {
            req = indexedDB.open(LEGACY_DB_NAME);
        } catch {
            resolve(null);
            return;
        }
        let created = false;
        req.onupgradeneeded = () => {
            // 存在しなかった。作成を取り消す
            created = true;
            req.transaction.abort();
        };
        req.onerror = () => {
            if (created) indexedDB.deleteDatabase(LEGACY_DB_NAME);
            resolve(null);
        };
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(LEGACY_STORE)) {
                db.close();
                resolve(null);
                return;
            }
            const tx = db.transaction(LEGACY_STORE, 'readonly');
            const all = tx.objectStore(LEGACY_STORE).getAll();
            all.onsuccess = () => {
                const entries = [];
                for (const rec of all.result || []) {
                    for (const e of parseLegacyRecords(rec.data)) entries.push(e);
                }
                db.close();
                resolve(entries);
            };
            all.onerror = () => { db.close(); resolve(null); };
        };
    });
}
