import type { DatabaseSync } from "node:sqlite";
import {
  getBoard,
  getWordsForVersion,
  latestDictVersion,
  saveSearch,
} from "./db.js";
import {
  findWordPaths,
  isValidWordText,
  normalizeGrid,
  normalizeWord,
  searchWords,
  verifyPath,
} from "./search.js";
import { AppError, DEFAULT_MIN_WORD_LENGTH, type Board, type FoundWord } from "./types.js";

export interface ImportResult {
  version: number;
  imported: number;
  duplicates: string[];
  words: string[];
}

export function createDictVersion(
  db: DatabaseSync,
  rawWords: unknown,
  sourceNote = "",
  source = "manual",
): ImportResult {
  if (!Array.isArray(rawWords)) {
    throw new AppError("VALIDATION", "words 必须是字符串数组");
  }
  const cleaned: { word: string; orig: string }[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const raw of rawWords) {
    if (typeof raw !== "string") {
      throw new AppError("VALIDATION", `词条必须是字符串，收到: ${JSON.stringify(raw)}`);
    }
    const word = normalizeWord(raw);
    if (!word) {
      throw new AppError("VALIDATION", "词条不能为空");
    }
    if (!isValidWordText(word)) {
      throw new AppError("VALIDATION", `词条只能包含英文字母: ${JSON.stringify(raw)}`);
    }
    if (seen.has(word)) {
      duplicates.push(raw);
      continue; // 大小写或重复词条只保留一条
    }
    seen.add(word);
    cleaned.push({ word, orig: raw });
  }

  db.exec("BEGIN");
  try {
    const info = db
      .prepare("INSERT INTO dict_versions (source_note) VALUES (?)")
      .run(sourceNote);
    const version = Number(info.lastInsertRowid);
    const stmt = db.prepare(
      "INSERT INTO dict_words (version, word, orig_word, source) VALUES (?, ?, ?, ?)",
    );
    for (const { word, orig } of cleaned) {
      stmt.run(version, word, orig, source);
    }
    db.exec("COMMIT");
    return {
      version,
      imported: cleaned.length,
      duplicates,
      words: cleaned.map((w) => w.word).sort(),
    };
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function requireDictVersion(db: DatabaseSync, version?: number): number {
  const latest = latestDictVersion(db);
  if (latest === null) {
    throw new AppError(
      "NOT_FOUND",
      "字典为空，请先导入词条（POST /api/dict/versions）",
      404,
    );
  }
  if (version === undefined) return latest;
  const row = db
    .prepare("SELECT version FROM dict_versions WHERE version = ?")
    .get(version);
  if (!row) {
    throw new AppError("NOT_FOUND", `字典版本 ${version} 不存在`, 404);
  }
  return version;
}

export function listDictVersions(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT v.version, v.source_note AS sourceNote, v.created_at AS createdAt,
              (SELECT COUNT(*) FROM dict_words w WHERE w.version = v.version) AS wordCount
       FROM dict_versions v ORDER BY v.version`,
    )
    .all() as { version: number; sourceNote: string; createdAt: string; wordCount: number }[];
}

export function getVersionWords(db: DatabaseSync, version: number): {
  version: number;
  words: string[];
} {
  requireDictVersion(db, version);
  return { version, words: getWordsForVersion(db, version) };
}

export function createBoard(db: DatabaseSync, body: unknown): Board {
  const grid = normalizeGrid(body);
  const info = db
    .prepare("INSERT INTO boards (rows, cols, cells_json) VALUES (?, ?, ?)")
    .run(grid.rows, grid.cols, JSON.stringify(grid.cells));
  const board = getBoard(db, Number(info.lastInsertRowid));
  if (!board) throw new AppError("INTERNAL", "棋盘创建失败", 500);
  return board;
}

export function requireBoard(db: DatabaseSync, boardId: number): Board {
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw new AppError("VALIDATION", "boardId 必须是正整数");
  }
  const board = getBoard(db, boardId);
  if (!board) throw new AppError("NOT_FOUND", `棋盘 ${boardId} 不存在`, 404);
  return board;
}

export interface SearchResponse {
  searchId: number;
  boardId: number;
  dictVersion: number;
  minLength: number;
  total: number;
  words: FoundWord[];
}

export function runSearch(
  db: DatabaseSync,
  boardId: number,
  opts: { dictVersion?: number; minLength?: number } = {},
): SearchResponse {
  const board = requireBoard(db, boardId);
  const version = requireDictVersion(db, opts.dictVersion);
  const minLength = opts.minLength ?? DEFAULT_MIN_WORD_LENGTH;
  if (!Number.isInteger(minLength) || minLength < 1) {
    throw new AppError("VALIDATION", "minLength 必须是不小于 1 的整数");
  }
  const dictWords = getWordsForVersion(db, version);
  const words = searchWords(board.cells, dictWords, minLength);
  const searchId = saveSearch(db, board.id, version, minLength, words);
  return {
    searchId,
    boardId: board.id,
    dictVersion: version,
    minLength,
    total: words.length,
    words,
  };
}

export function checkWord(
  db: DatabaseSync,
  boardId: number,
  word: unknown,
  dictVersion?: number,
) {
  const board = requireBoard(db, boardId);
  if (typeof word !== "string" || !word.trim()) {
    throw new AppError("VALIDATION", "word 必须是非空字符串");
  }
  const normalized = normalizeWord(word);
  if (!isValidWordText(normalized)) {
    throw new AppError("VALIDATION", "单词只能包含英文字母");
  }
  const version = requireDictVersion(db, dictVersion);
  const inDict = getWordsForVersion(db, version).includes(normalized);
  const paths = findWordPaths(board.cells, normalized);
  return {
    word: normalized,
    inDict,
    dictVersion: version,
    found: inDict && paths.length > 0,
    pathCount: paths.length,
    paths,
    displayPath: paths[0] ?? null,
  };
}

export function checkBoardPath(
  db: DatabaseSync,
  boardId: number,
  body: { path?: unknown; word?: unknown },
) {
  const board = requireBoard(db, boardId);
  const expected =
    typeof body.word === "string" && body.word.trim() ? body.word : undefined;
  const result = verifyPath(board.cells, body.path, expected);
  let inDict = false;
  if (result.word) {
    const latest = latestDictVersion(db);
    if (latest !== null) {
      inDict = getWordsForVersion(db, latest).includes(result.word);
    }
  }
  return { ...result, inDict };
}

export function getReport(db: DatabaseSync, searchId: number) {
  if (!Number.isInteger(searchId) || searchId <= 0) {
    throw new AppError("VALIDATION", "searchId 必须是正整数");
  }
  const search = db
    .prepare("SELECT * FROM searches WHERE id = ?")
    .get(searchId) as
    | {
        id: number;
        board_id: number;
        dict_version: number;
        min_length: number;
        created_at: string;
      }
    | undefined;
  if (!search) throw new AppError("NOT_FOUND", `报告 ${searchId} 不存在`, 404);
  const rows = db
    .prepare("SELECT word, path_json FROM search_words WHERE search_id = ? ORDER BY ord")
    .all(searchId) as { word: string; path_json: string }[];
  return {
    searchId: search.id,
    boardId: search.board_id,
    dictVersion: search.dict_version,
    minLength: search.min_length,
    createdAt: search.created_at,
    total: rows.length,
    words: rows.map((r) => ({ word: r.word, path: JSON.parse(r.path_json) })),
  };
}

export function listReports(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT s.id AS searchId, s.board_id AS boardId, s.dict_version AS dictVersion,
              s.min_length AS minLength, s.created_at AS createdAt,
              (SELECT COUNT(*) FROM search_words sw WHERE sw.search_id = s.id) AS total
       FROM searches s ORDER BY s.id`,
    )
    .all();
}

/** 自建演示词表，不下载任何在线字典。 */
export const DEMO_WORDS = ["SHE", "HE", "HEE", "HAT", "EAT", "TEE", "AT"];

export const DEMO_BOARD: string[][] = [
  ["S", "H", "E"],
  ["E", "A", "T"],
  ["E", "T", "H"],
];
