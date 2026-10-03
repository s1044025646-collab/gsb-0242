import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTrie,
  findWordPaths,
  normalizeGrid,
  searchWords,
  verifyPath,
} from "../search.js";

const BOARD = [
  ["S", "H", "E"],
  ["E", "A", "T"],
  ["E", "T", "H"],
];
const DICT = ["SHE", "HE", "HEE", "HAT", "EAT", "TEE", "AT", "SEAT"];

test("完整词表结果与人工枚举一致", () => {
  const result = searchWords(BOARD, DICT, 2).map((w) => w.word);
  assert.deepEqual(result, ["AT", "EAT", "HAT", "HE", "HEE", "SEAT", "SHE", "TEE"]);
});

test("每个单词只出现一次且展示路径稳定", () => {
  const a = searchWords(BOARD, DICT, 2);
  const b = searchWords(BOARD, DICT, 2);
  assert.deepEqual(a, b);
  const she = a.find((w) => w.word === "SHE")!;
  assert.deepEqual(she.path, [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 0, col: 2 },
  ]);
  const hee = a.find((w) => w.word === "HEE")!;
  assert.deepEqual(hee.path, [
    { row: 0, col: 1 },
    { row: 1, col: 0 },
    { row: 2, col: 0 },
  ]);
});

test("共享前缀剪枝：前缀树结构正确", () => {
  const trie = buildTrie(["HE", "HEE"]);
  const h = trie.children.get("H")!;
  const he = h.children.get("E")!;
  assert.equal(he.terminal, true);
  const hee = he.children.get("E")!;
  assert.equal(hee.terminal, true);
});

test("多路径单词枚举全部路径，且稳定展示路径取第一条", () => {
  const paths = findWordPaths(BOARD, "TEE");
  assert.equal(paths.length, 2);
  const result = searchWords(BOARD, ["TEE"], 2)[0]!;
  assert.deepEqual(result.path, paths[0]);
});

test("重复字母单词不能复用同一格", () => {
  // HEEH 需要第四个字母回到 H，即重复使用第一格，不可能存在路径
  assert.deepEqual(findWordPaths(BOARD, "HEEH"), []);
});

test("外部路径核验：重复格、越界、不相邻、字母不一致均被拒绝", () => {
  const dup = verifyPath(
    BOARD,
    [
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 0, col: 1 },
    ],
    "HEE",
  );
  assert.equal(dup.valid, false);
  assert.ok(dup.violations.some((v) => v.type === "DUPLICATE_CELL"));
  assert.ok(dup.violations.some((v) => v.type === "LETTER_MISMATCH"));

  const oob = verifyPath(BOARD, [{ row: 0, col: 0 }, { row: 3, col: 0 }]);
  assert.ok(oob.violations.some((v) => v.type === "OUT_OF_BOUNDS"));

  const far = verifyPath(BOARD, [{ row: 0, col: 0 }, { row: 2, col: 2 }]);
  assert.ok(far.violations.some((v) => v.type === "NOT_ADJACENT"));

  const ok = verifyPath(BOARD, [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }], "SHE");
  assert.equal(ok.valid, true);
  assert.equal(ok.word, "SHE");
});

test("单格棋盘：长度 1 可命中，长度 2 无结果", () => {
  const one = [["Q"]];
  assert.deepEqual(
    searchWords(one, ["Q", "QQ"], 1).map((w) => w.word),
    ["Q"],
  );
  assert.deepEqual(searchWords(one, ["Q", "QQ"], 2), []);
});

test("边角相邻：1x2 棋盘允许水平移动，禁止重复格", () => {
  const two = [["A", "B"]];
  assert.deepEqual(
    searchWords(two, ["AB", "BA", "AA"], 1).map((w) => w.word),
    ["AB", "BA"],
  );
});

test("大小写统一处理，重复词条不影响结果", () => {
  const grid = normalizeGrid([["s", "h"], ["a", "t"]]);
  assert.deepEqual(grid.cells, [["S", "H"], ["A", "T"]]);
  const result = searchWords(grid.cells, ["sh", "SH", "Sh", "hat"], 2).map((w) => w.word);
  assert.deepEqual(result, ["HAT", "SH"]);
});

test("Q 只代表 Q，不自动当作 QU", () => {
  const qboard = [["Q", "U"], ["E", "E"]];
  assert.deepEqual(searchWords(qboard, ["QU", "QUE", "QUEEN"], 2).map((w) => w.word), ["QU", "QUE"]);
});

test("空词表与无命中均返回空数组", () => {
  assert.deepEqual(searchWords(BOARD, [], 2), []);
  assert.deepEqual(searchWords(BOARD, ["ZZZ"], 2), []);
});

test("非法棋盘输入被拒绝", () => {
  assert.throws(() => normalizeGrid([["A", "B"], ["A"]]), /矩形/);
  assert.throws(() => normalizeGrid([["1"]]), /非法格子/);
  assert.throws(() => normalizeGrid(Array.from({ length: 7 }, () => ["A"])), /6/);
});
