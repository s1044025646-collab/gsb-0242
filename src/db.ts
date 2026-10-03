import { DatabaseSync } from "node:sqlite";
import { Board, Coord, ValidationError, assertValidWord, parseBoard } from "./board.js";
import { Trie } from "./trie.js";
import { FoundWord, findAllWords, findWordPath } from "./search.js";

export const DEFAULT_MIN_WORD_LEN = 3;

export interface DictWord {
  word: string;
  raw: string;
}

export interface SearchReport {
  id: number;
  boardId: number;
  dictVersion: number;
  minLen: number;
  createdAt: string;
  board: Board;
  words: FoundWord[];
  dictWords: DictWord[];
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dict_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS words (
        version_id INTEGER NOT NULL REFERENCES dict_versions(id),
        word TEXT NOT NULL,
        raw TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (version_id, word)
      );
      CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        letters TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id INTEGER NOT NULL REFERENCES boards(id),
        dict_version INTEGER REFERENCES dict_versions(id),
        min_len INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  getMinWordLen(): number {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = 'min_word_len'")
      .get() as { value: string } | undefined;
    return row ? Number(row.value) : DEFAULT_MIN_WORD_LEN;
  }

  setMinWordLen(n: number): void {
    if (!Number.isInteger(n) || n < 1 || n > 36)
      throw new ValidationError("INVALID_MIN_LEN", "最短单词长度必须是 1-36 的整数");
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('min_word_len', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(n));
  }

  currentDictVersion(): number | null {
    const row = this.db.prepare("SELECT MAX(id) AS id FROM dict_versions").get() as { id: number | null };
    return row.id;
  }

  getWords(versionId: number): DictWord[] {
    return this.db
      .prepare("SELECT word, raw FROM words WHERE version_id = ? ORDER BY position")
      .all(versionId) as unknown as DictWord[];
  }

  currentWords(): DictWord[] {
    const v = this.currentDictVersion();
    return v === null ? [] : this.getWords(v);
  }

  /** 导入单词，生成新的字典版本（全量快照），重复词条按规范化后去重、保留首次原始写法 */
  importWords(inputs: string[]): { version: number; added: number; total: number } {
    if (!Array.isArray(inputs) || inputs.length === 0)
      throw new ValidationError("EMPTY_IMPORT", "导入列表不能为空");
    const merged = new Map<string, string>();
    for (const w of this.currentWords()) merged.set(w.word, w.raw);
    let added = 0;
    for (const input of inputs) {
      if (typeof input !== "string") throw new ValidationError("INVALID_WORD", "词条必须是字符串");
      const word = assertValidWord(input);
      if (!merged.has(word)) {
        merged.set(word, input.trim());
        added++;
      }
    }
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const res = this.db.prepare("INSERT INTO dict_versions (created_at) VALUES (?)").run(now);
      const version = Number(res.lastInsertRowid);
      const stmt = this.db.prepare("INSERT INTO words (version_id, word, raw, position) VALUES (?, ?, ?, ?)");
      let pos = 0;
      for (const [word, raw] of merged) stmt.run(version, word, raw, pos++);
      this.db.exec("COMMIT");
      return { version, added, total: merged.size };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  removeWord(input: string): { version: number; removed: boolean; total: number } {
    const word = assertValidWord(input);
    const remaining = this.currentWords().filter((w) => w.word !== word);
    const removed = remaining.length !== this.currentWords().length;
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      const res = this.db.prepare("INSERT INTO dict_versions (created_at) VALUES (?)").run(now);
      const version = Number(res.lastInsertRowid);
      const stmt = this.db.prepare("INSERT INTO words (version_id, word, raw, position) VALUES (?, ?, ?, ?)");
      remaining.forEach((w, i) => stmt.run(version, w.word, w.raw, i));
      this.db.exec("COMMIT");
      return { version, removed, total: remaining.length };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  createBoard(rows: number, cols: number, letters: string): { id: number } & Board {
    const board = parseBoard(rows, cols, letters);
    const res = this.db
      .prepare("INSERT INTO boards (rows, cols, letters, created_at) VALUES (?, ?, ?, ?)")
      .run(board.rows, board.cols, board.letters, new Date().toISOString());
    return { id: Number(res.lastInsertRowid), ...board };
  }

  getBoard(id: number): ({ id: number } & Board) | null {
    const row = this.db
      .prepare("SELECT id, rows, cols, letters FROM boards WHERE id = ?")
      .get(id) as ({ id: number } & Board) | undefined;
    return row ?? null;
  }

  requireBoard(id: number): { id: number } & Board {
    const board = this.getBoard(id);
    if (!board) throw new ValidationError("BOARD_NOT_FOUND", `棋盘 ${id} 不存在`);
    return board;
  }

  private currentTrie(): { trie: Trie; version: number | null; words: DictWord[] } {
    const words = this.currentWords();
    return { trie: Trie.fromWords(words.map((w) => w.word)), version: this.currentDictVersion(), words };
  }

  /** 全量搜索并保存报告；空词表返回明确空结果 */
  search(boardId: number, minLen?: number): SearchReport {
    const board = this.requireBoard(boardId);
    const len = minLen ?? this.getMinWordLen();
    if (!Number.isInteger(len) || len < 1)
      throw new ValidationError("INVALID_MIN_LEN", "最短单词长度必须是正整数");
    const { trie, version, words: dictWords } = this.currentTrie();
    const found = version === null ? [] : findAllWords(board, trie, len);
    const res = this.db
      .prepare("INSERT INTO searches (board_id, dict_version, min_len, created_at, result_json) VALUES (?, ?, ?, ?, ?)")
      .run(boardId, version, len, new Date().toISOString(), JSON.stringify(found));
    return {
      id: Number(res.lastInsertRowid),
      boardId,
      dictVersion: version ?? 0,
      minLen: len,
      createdAt: new Date().toISOString(),
      board,
      words: found,
      dictWords,
    };
  }

  /** 检查指定单词，返回稳定展示路径；不保存报告 */
  checkWord(boardId: number, word: string): { word: string; inDictionary: boolean; path: Coord[] | null } {
    const board = this.requireBoard(boardId);
    const normalized = assertValidWord(word);
    const { trie, words } = this.currentTrie();
    const inDictionary = words.some((w) => w.word === normalized);
    const path = inDictionary ? findWordPath(board, trie, normalized) : null;
    return { word: normalized, inDictionary, path };
  }

  getReport(id: number): SearchReport | null {
    const row = this.db
      .prepare("SELECT id, board_id, dict_version, min_len, created_at, result_json FROM searches WHERE id = ?")
      .get(id) as
      | { id: number; board_id: number; dict_version: number; min_len: number; created_at: string; result_json: string }
      | undefined;
    if (!row) return null;
    const board = this.getBoard(row.board_id);
    if (!board) return null;
    return {
      id: row.id,
      boardId: row.board_id,
      dictVersion: row.dict_version ?? 0,
      minLen: row.min_len,
      createdAt: row.created_at,
      board,
      words: JSON.parse(row.result_json) as FoundWord[],
      dictWords: row.dict_version ? this.getWords(row.dict_version) : [],
    };
  }

  listReports(): { id: number; boardId: number; dictVersion: number; minLen: number; createdAt: string; count: number }[] {
    const rows = this.db
      .prepare("SELECT id, board_id, dict_version, min_len, created_at, result_json FROM searches ORDER BY id")
      .all() as { id: number; board_id: number; dict_version: number; min_len: number; created_at: string; result_json: string }[];
    return rows.map((r) => ({
      id: r.id,
      boardId: r.board_id,
      dictVersion: r.dict_version,
      minLen: r.min_len,
      createdAt: r.created_at,
      count: (JSON.parse(r.result_json) as FoundWord[]).length,
    }));
  }
}
