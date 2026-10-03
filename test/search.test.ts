import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Board, Coord, ValidationError, neighbors, parseBoard } from "../src/board.js";
import { Trie } from "../src/trie.js";
import { findAllWords, findWordPath, validatePath } from "../src/search.js";
import { Store } from "../src/db.js";
import { DEMO_BOARD, DEMO_WORDS, DEMO_ILLEGAL } from "../src/demo.js";

/** 独立参照：暴力枚举棋盘上所有简单路径，取属于词表且长度达标的词 */
function bruteForceWords(board: Board, wordSet: Set<string>, minLen: number): Set<string> {
  const found = new Set<string>();
  const maxDepth = board.rows * board.cols;
  const visited = new Array(board.rows * board.cols).fill(false);
  function dfs(r: number, c: number, text: string): void {
    const idx = r * board.cols + c;
    const t = text + board.letters[idx];
    visited[idx] = true;
    if (t.length >= minLen && wordSet.has(t)) found.add(t);
    if (t.length < maxDepth) {
      for (const [nr, nc] of neighbors(board, r, c)) {
        if (!visited[nr * board.cols + nc]) dfs(nr, nc, t);
      }
    }
    visited[idx] = false;
  }
  for (let r = 0; r < board.rows; r++)
    for (let c = 0; c < board.cols; c++) dfs(r, c, "");
  return found;
}

function tempDb(): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "wbs-"));
  return { dir, file: path.join(dir, "test.db") };
}

test("演示棋盘：搜索结果与独立枚举完全一致", () => {
  const board = parseBoard(DEMO_BOARD.rows, DEMO_BOARD.cols, DEMO_BOARD.letters);
  const words = DEMO_WORDS.map((w) => w.toUpperCase());
  const trie = Trie.fromWords(words);
  const found = findAllWords(board, trie, 3);
  const expected = bruteForceWords(board, new Set(words), 3);
  assert.deepEqual(
    found.map((f) => f.word),
    [...expected].sort(),
  );
  assert.ok(expected.has("CAT") && expected.has("CATS") && expected.has("SAT") && expected.has("STAR"));
  assert.ok(!expected.has("DOG"));
});

test("多路径单词只出现一次且选择坐标字典序最小的稳定路径", () => {
  const board = parseBoard(3, 3, "CATATSTAR");
  const trie = Trie.fromWords(["CAT"]);
  const found = findAllWords(board, trie, 3);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].path, [
    [0, 0],
    [0, 1],
    [0, 2],
  ]);
  assert.deepEqual(findWordPath(board, trie, "cat"), found[0].path);
});

test("对角移动合法：SAT 走对角线", () => {
  const board = parseBoard(3, 3, "CATATSTAR");
  const trie = Trie.fromWords(["SAT"]);
  const found = findAllWords(board, trie, 3);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].path, [
    [1, 2],
    [0, 1],
    [0, 2],
  ]);
});

test("单格棋盘", () => {
  const board = parseBoard(1, 1, "A");
  const trie = Trie.fromWords(["A", "AB"]);
  assert.deepEqual(findAllWords(board, trie, 1).map((f) => f.word), ["A"]);
  assert.deepEqual(findAllWords(board, trie, 2), []);
});

test("边角相邻：角格只有 3 个邻居", () => {
  const board = parseBoard(2, 2, "ABCD");
  assert.deepEqual(neighbors(board, 0, 0), [
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
  assert.equal(neighbors(board, 1, 1).length, 3);
});

test("Q 只代表 Q，不当作 QU", () => {
  const board = parseBoard(1, 2, "QI");
  const trie = Trie.fromWords(["QI"]);
  assert.deepEqual(findAllWords(board, trie, 2).map((f) => f.word), ["QI"]);
  // 棋盘没有 U，QU 开头的词不可能命中
  const trie2 = Trie.fromWords(["QUIT"]);
  assert.deepEqual(findAllWords(board, trie2, 2), []);
});

test("路径核验：越界、不相邻、重复格、字母不符均拒绝", () => {
  const board = parseBoard(3, 3, "CATATSTAR");
  assert.throws(() => validatePath(board, "CAT", [[0, 0], [0, 1], [0, 9]]), (e: ValidationError) => e.code === "COORD_OUT_OF_BOUNDS");
  assert.throws(() => validatePath(board, "CRA", [[0, 0], [2, 2], [2, 1]]), (e: ValidationError) => e.code === "NOT_ADJACENT");
  assert.throws(() => validatePath(board, DEMO_ILLEGAL.word, DEMO_ILLEGAL.path), (e: ValidationError) => e.code === "DUPLICATE_CELL");
  assert.throws(() => validatePath(board, "CAT", [[0, 0], [0, 1], [1, 0]]), (e: ValidationError) => e.code === "LETTER_MISMATCH");
  assert.throws(() => validatePath(board, "CATS", [[0, 0], [0, 1], [0, 2]]), (e: ValidationError) => e.code === "PATH_LENGTH_MISMATCH");
  assert.throws(() => validatePath(board, "CAT", [[0, 0], [0, 1], ["x" as never, 2]]), (e: ValidationError) => e.code === "INVALID_COORD");
  const ok = validatePath(board, "CAT", [[0, 0], [0, 1], [0, 2]]);
  assert.equal(ok.valid, true);
  assert.equal(ok.text, "CAT");
});

test("棋盘参数校验", () => {
  assert.throws(() => parseBoard(7, 1, "ABCDEFG"), (e: ValidationError) => e.code === "BOARD_TOO_LARGE");
  assert.throws(() => parseBoard(2, 2, "ABC"), (e: ValidationError) => e.code === "INVALID_LETTERS");
  assert.throws(() => parseBoard(2, 2, "AB1D"), (e: ValidationError) => e.code === "INVALID_LETTERS");
  assert.throws(() => parseBoard(0, 2, "AB"), (e: ValidationError) => e.code === "INVALID_BOARD_SIZE");
});

test("字典：重复词条去重、大小写统一并保留原始写法", () => {
  const { dir, file } = tempDb();
  try {
    const store = new Store(file);
    const r1 = store.importWords(["cat", "CAT", "Cat", "dog"]);
    assert.equal(r1.added, 2);
    assert.equal(r1.total, 2);
    const words = store.currentWords();
    assert.deepEqual(words.map((w) => w.word), ["CAT", "DOG"]);
    assert.equal(words[0].raw, "cat"); // 保留首次导入的原始写法
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 临时目录锁定，交给系统清理 */ }
  }
});

test("空词表搜索返回明确空结果", () => {
  const { dir, file } = tempDb();
  try {
    const store = new Store(file);
    const board = store.createBoard(2, 2, "ABCD");
    const report = store.search(board.id);
    assert.equal(report.words.length, 0);
    assert.equal(report.dictVersion, 0);
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 临时目录锁定，交给系统清理 */ }
  }
});

test("字典版本：修改后新查询用新版本，历史报告保留旧词表依据", () => {
  const { dir, file } = tempDb();
  try {
    const store = new Store(file);
    store.importWords(["cat", "dog"]);
    const board = store.createBoard(1, 3, "CAT");
    const r1 = store.search(board.id, 1);
    assert.equal(r1.dictVersion, 1);
    assert.deepEqual(r1.words.map((w) => w.word), ["CAT"]);
    store.importWords(["cat", "dog", "act", "a"]);
    const r2 = store.search(board.id, 1);
    assert.equal(r2.dictVersion, 2);
    assert.deepEqual(r2.words.map((w) => w.word), ["A", "CAT"]);
    const old = store.getReport(r1.id)!;
    assert.equal(old.dictVersion, 1);
    assert.deepEqual(old.words.map((w) => w.word), ["CAT"]);
    assert.deepEqual(old.dictWords.map((w) => w.word), ["CAT", "DOG"]);
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 临时目录锁定，交给系统清理 */ }
  }
});

test("服务重启后数据保留", () => {
  const { dir, file } = tempDb();
  try {
    let store = new Store(file);
    store.importWords(["cat"]);
    const board = store.createBoard(1, 3, "CAT");
    const report = store.search(board.id, 3);
    store.close();
    store = new Store(file);
    assert.deepEqual(store.currentWords().map((w) => w.word), ["CAT"]);
    assert.equal(store.getBoard(board.id)!.letters, "CAT");
    assert.equal(store.getReport(report.id)!.words[0].word, "CAT");
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 临时目录锁定，交给系统清理 */ }
  }
});

test("checkWord：字典中但棋盘无法构成时 path 为 null", () => {
  const { dir, file } = tempDb();
  try {
    const store = new Store(file);
    store.importWords(["cat", "zzz"]);
    const board = store.createBoard(1, 3, "CAT");
    assert.deepEqual(store.checkWord(board.id, "cat").path, [[0, 0], [0, 1], [0, 2]]);
    const miss = store.checkWord(board.id, "zzz");
    assert.equal(miss.inDictionary, true);
    assert.equal(miss.path, null);
    assert.equal(store.checkWord(board.id, "nope").inDictionary, false);
    store.close();
  } finally {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows 临时目录锁定，交给系统清理 */ }
  }
});
