import type { Cell, FoundWord } from "./types.js";
import { AppError, MAX_DIM, MIN_DIM } from "./types.js";

// 八方向：上、下、左、右、四个对角
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

interface TrieNode {
  children: Map<string, TrieNode>;
  terminal: boolean;
}

function newNode(): TrieNode {
  return { children: new Map(), terminal: false };
}

export function buildTrie(words: Iterable<string>): TrieNode {
  const root = newNode();
  for (const raw of words) {
    const word = normalizeWord(raw);
    if (!word) continue;
    let node = root;
    for (const ch of word) {
      let next = node.children.get(ch);
      if (!next) {
        next = newNode();
        node.children.set(ch, next);
      }
      node = next;
    }
    node.terminal = true;
  }
  return root;
}

export function normalizeWord(word: string): string {
  return word.normalize("NFKC").trim().toUpperCase();
}

export function isValidWordText(word: string): boolean {
  return /^[A-Z]+$/.test(word);
}

export function normalizeGrid(input: unknown): {
  rows: number;
  cols: number;
  cells: string[][];
} {
  let grid: unknown = input;
  if (
    typeof input === "object" &&
    input !== null &&
    "grid" in input &&
    Array.isArray((input as { grid: unknown }).grid)
  ) {
    grid = (input as { grid: unknown }).grid;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "rows" in input &&
    "cols" in input &&
    "cells" in input
  ) {
    const obj = input as { rows: unknown; cols: unknown; cells: unknown };
    const cells = obj.cells;
    if (!Array.isArray(cells) || cells.length === 0) {
      throw new AppError("VALIDATION", "cells 必须是非空二维字母数组");
    }
    const grid2: string[][] = [];
    for (const row of cells) {
      if (!Array.isArray(row)) {
        throw new AppError("VALIDATION", "棋盘每一行必须是数组");
      }
      grid2.push(normalizeRow(row));
    }
    validateDims(grid2, Number(obj.rows), Number(obj.cols));
    return { rows: grid2.length, cols: grid2[0]!.length, cells: grid2 };
  }
  if (Array.isArray(grid)) {
    if (grid.length === 0) {
      throw new AppError("VALIDATION", "棋盘必须至少有一行");
    }
    const out: string[][] = [];
    for (const row of grid) {
      if (!Array.isArray(row)) {
        throw new AppError("VALIDATION", "棋盘每一行必须是数组");
      }
      out.push(normalizeRow(row));
    }
    validateDims(out);
    return { rows: out.length, cols: out[0]!.length, cells: out };
  }
  throw new AppError("VALIDATION", "无法解析棋盘，请提供二维字母数组 grid");
}

function normalizeRow(row: unknown[]): string[] {
  const out: string[] = [];
  for (const cell of row) {
    if (typeof cell !== "string") {
      throw new AppError("VALIDATION", "每格必须是单个英文字母");
    }
    const ch = cell.normalize("NFKC").trim().toUpperCase();
    if (!/^[A-Z]$/.test(ch)) {
      throw new AppError("VALIDATION", `非法格子字符: ${JSON.stringify(cell)}`);
    }
    out.push(ch);
  }
 if (out.length === 0) {
    throw new AppError("VALIDATION", "棋盘行不能为空");
  }
  return out;
}

function validateDims(grid: string[][], rows?: number, cols?: number): void {
  const r = grid.length;
  const c = grid[0]!.length;
  if (r < MIN_DIM || r > MAX_DIM || c < MIN_DIM || c > MAX_DIM) {
    throw new AppError(
      "VALIDATION",
      `棋盘行列必须在 ${MIN_DIM} 到 ${MAX_DIM} 之间，当前为 ${r}x${c}`,
    );
  }
  if (!grid.every((row) => row.length === c)) {
    throw new AppError("VALIDATION", "棋盘必须是矩形，每行长度一致");
  }
  if ((rows !== undefined && rows !== r) || (cols !== undefined && cols !== c)) {
    throw new AppError("VALIDATION", "rows/cols 与实际棋盘尺寸不一致");
  }
}

/**
 * 搜索棋盘上所有字典单词。
 * 每个单词只返回一条稳定展示路径：按起点行优先、列优先，
 * 八个方向按 DIRS 固定顺序深度优先，最先找到的路径即为结果。
 */
export function searchWords(
  cells: string[][],
  words: Iterable<string>,
  minLength: number,
): FoundWord[] {
  if (!Number.isInteger(minLength) || minLength < 1) {
    throw new AppError("VALIDATION", "minLength 必须是不小于 1 的整数");
  }
  const root = buildTrie(words);
  const rows = cells.length;
  const cols = cells[0]!.length;
  const found = new Map<string, Cell[]>();
  const used = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const path: Cell[] = [];

  const dfs = (r: number, c: number, node: TrieNode): void => {
    const ch = cells[r]![c]!;
    const next = node.children.get(ch);
    if (!next) return; // 前缀不存在，及时剪枝
    path.push({ row: r, col: c });
    used[r]![c] = true;
    if (next.terminal && path.length >= minLength && !found.has(currentWord(path, cells))) {
      const word = currentWord(path, cells);
      found.set(word, path.map((p) => ({ ...p })));
    }
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (used[nr]![nc]) continue;
      // 继续扩展前先确认子节点存在，利用前缀剪枝
      if (next.children.size === 0) continue;
      dfs(nr, nc, next);
    }
    used[r]![c] = false;
    path.pop();
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      dfs(r, c, root);
    }
  }
  return [...found.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([word, pathCells]) => ({ word, path: pathCells }));
}

function currentWord(path: Cell[], cells: string[][]): string {
  return path.map((p) => cells[p.row]![p.col]!).join("");
}

/** 查找指定单词的全部路径（枚举，用于核验与展示多路径）。 */
export function findWordPaths(cells: string[][], targetWord: string): Cell[][] {
  const word = normalizeWord(targetWord);
  if (!isValidWordText(word)) {
    throw new AppError("VALIDATION", "单词只能包含英文字母");
  }
  const rows = cells.length;
  const cols = cells[0]!.length;
  const results: Cell[][] = [];
  const used = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const path: Cell[] = [];

  const dfs = (r: number, c: number, idx: number): void => {
    if (cells[r]![c] !== word[idx]) return;
    path.push({ row: r, col: c });
    used[r]![c] = true;
    if (idx === word.length - 1) {
      results.push(path.map((p) => ({ ...p })));
    } else {
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (used[nr]![nc]) continue;
        dfs(nr, nc, idx + 1);
      }
    }
    used[r]![c] = false;
    path.pop();
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (cells[r]![c] === word[0]) dfs(r, c, 0);
    }
  }
  return results;
}

export type PathViolation =
  | "OUT_OF_BOUNDS"
  | "DUPLICATE_CELL"
  | "NOT_ADJACENT"
  | "LETTER_MISMATCH";

export interface VerifyPathResult {
  valid: boolean;
  word: string | null;
  violations: { type: PathViolation; index: number; detail: string }[];
}

/** 核验外部传入路径：越界、相邻性、重复格、字母一致性。 */
export function verifyPath(
  cells: string[][],
  pathInput: unknown,
  expectedWord?: string,
): VerifyPathResult {
  if (!Array.isArray(pathInput) || pathInput.length === 0) {
    throw new AppError("VALIDATION", "path 必须是非空坐标数组，如 [{\"row\":0,\"col\":0}]");
  }
  const rows = cells.length;
  const cols = cells[0]!.length;
  const violations: VerifyPathResult["violations"] = [];
  const seen = new Set<string>();
  const normalized: Cell[] = [];

  pathInput.forEach((step, index) => {
    if (
      typeof step !== "object" ||
      step === null ||
      !("row" in step) ||
      !("col" in step)
    ) {
      violations.push({
        type: "OUT_OF_BOUNDS",
        index,
        detail: `第 ${index} 步不是有效坐标对象`,
      });
      return;
    }
    const { row, col } = step as { row: unknown; col: unknown };
    const r = Number(row);
    const c = Number(col);
    if (!Number.isInteger(r) || !Number.isInteger(c)) {
      violations.push({
        type: "OUT_OF_BOUNDS",
        index,
        detail: `第 ${index} 步坐标必须为整数: row=${String(row)}, col=${String(col)}`,
      });
      return;
    }
    if (r < 0 || r >= rows || c < 0 || c >= cols) {
      violations.push({
        type: "OUT_OF_BOUNDS",
        index,
        detail: `第 ${index} 步越界: (${r},${c})，棋盘为 ${rows}x${cols}，坐标从 0 开始`,
      });
      return;
    }
    const key = `${r},${c}`;
    if (seen.has(key)) {
      violations.push({
        type: "DUPLICATE_CELL",
        index,
        detail: `第 ${index} 步重复使用格子 (${r},${c})`,
      });
    }
    seen.add(key);
    normalized.push({ row: r, col: c });
  });

  for (let i = 1; i < normalized.length; i++) {
    const prev = normalized[i - 1]!;
    const cur = normalized[i]!;
    const dr = Math.abs(cur.row - prev.row);
    const dc = Math.abs(cur.col - prev.col);
    if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) {
      violations.push({
        type: "NOT_ADJACENT",
        index: i,
        detail: `第 ${i} 步与上一格 (${prev.row},${prev.col}) 不相邻`,
      });
    }
  }

  let word: string | null = null;
  if (violations.filter((v) => v.type === "OUT_OF_BOUNDS").length === 0) {
    word = normalized.map((p) => cells[p.row]![p.col]!).join("");
    if (expectedWord !== undefined) {
      const expected = normalizeWord(expectedWord);
      if (expected && word !== expected) {
        violations.push({
          type: "LETTER_MISMATCH",
          index: 0,
          detail: `路径拼出 ${word}，与期望单词 ${expected} 不一致`,
        });
      }
    }
  }

  return { valid: violations.length === 0, word, violations };
}
