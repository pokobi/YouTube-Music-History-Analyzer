// ファイル解析を画面とは別のスレッドで行う
import { parseFile } from './parser.js';

self.onmessage = async (e) => {
    const { id, name, buffer } = e.data;
    try {
        const result = await parseFile(name, buffer);
        self.postMessage({ id, ok: true, result });
    } catch (err) {
        self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
};
