import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Board, FoundWord } from "./types.js";

export function openDatabase(filePath: string): DatabaseSync {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dict_versions (
      version     INTEGER PRIMARY KEY AUTOINCREMENT,
      source_note TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS dict_words (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      version    INTEGER NOT NULL,
      word       TEXT    NOT NULL,
      orig_word  TEXT    NOT NULL,
      source     TEXT    NOT NULL DEFAULT 'manual',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (version) REFERENCES dict_versions(version)
    );
    CREATE INDEX IF NOT EXISTS idx_dict_words_version ON dict_words(version);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_dict_words_version_word
      ON dict_words(version, word);

    CREATE TABLE IF NOT EXISTS boards (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      rows       INTEGER NOT NULL,
      cols       INTEGER NOT NULL,
      cells_json TEXT    NOT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS searches (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id     INTEGER NOT NULL,
      dict_version INTEGER NOT NULL,
      min_length   INTEGER NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (board_id) REFERENCES boards(id)
    );
    CREATE TABLE IF NOT EXISTS search_words (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL,
      word      TEXT    NOT NULL,
      path_json TEXT    NOT NULL,
      ord       INTEGER NOT NULL,
      FOREIGN KEY (search_id) REFERENCES searches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_search_words_search ON search_words(search_id);
  `);
}

export function latestDictVersion(db: DatabaseSync): number | null {
  const row = db
    .prepare("SELECT MAX(version) AS v FROM dict_versions")
    .get() as { v: number | null };
  return row.v ?? null;
}

export function getWordsForVersion(db: DatabaseSync, version: number): string[] {
  const rows = db
    .prepare("SELECT word FROM dict_words WHERE version = ? ORDER BY word")
    .all(version) as { word: string }[];
  return rows.map((r) => r.word);
}

export function getBoard(db: DatabaseSync, id: number): Board | null {
  const row = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(id) as
    | { id: number; rows: number; cols: number; cells_json: string; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    rows: row.rows,
    cols: row.cols,
    cells: JSON.parse(row.cells_json) as string[][],
    createdAt: row.created_at,
  };
}

export function saveSearch(
  db: DatabaseSync,
  boardId: number,
  dictVersion: number,
  minLength: number,
  words: FoundWord[],
): number {
  const info = db
    .prepare(
      "INSERT INTO searches (board_id, dict_version, min_length) VALUES (?, ?, ?)",
    )
    .run(boardId, dictVersion, minLength);
  const searchId = Number(info.lastInsertRowid);
  const stmt = db.prepare(
    "INSERT INTO search_words (search_id, word, path_json, ord) VALUES (?, ?, ?, ?)",
  );
  words.forEach((w, i) => {
    stmt.run(searchId, w.word, JSON.stringify(w.path), i);
  });
  return searchId;
}
