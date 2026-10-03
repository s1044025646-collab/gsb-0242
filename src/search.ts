import { Board, Coord, ValidationError, letterAt, neighbors, normalizeWord } from "./board.js";
import { Trie, TrieNode } from "./trie.js";

export interface FoundWord {
  word: string;
  /** 该词所有路径中坐标序列字典序最小的一条（稳定展示路径） */
  path: Coord[];
}

/**
 * 前缀树 + DFS 搜索棋盘上所有可构成的字典单词。
 * 前缀不存在时立即剪枝；同一单词只记录一次，
 * 由于遍历顺序固定（起点按行优先、邻居按坐标升序），
 * 第一个被找到的路径即坐标序列字典序最小的稳定路径。
 */
export function findAllWords(board: Board, trie: Trie, minLen: number): FoundWord[] {
  const found = new Map<string, Coord[]>();
  const maxDepth = board.rows * board.cols;
  const visited = new Array<boolean>(board.rows * board.cols).fill(false);
  const path: Coord[] = [];

  function dfs(r: number, c: number, node: TrieNode): void {
    const idx = r * board.cols + c;
    const ch = board.letters[idx];
    const next = node.children.get(ch);
    if (!next) return; // 前缀不存在，剪枝
    visited[idx] = true;
    path.push([r, c]);
    if (next.isWord && path.length >= minLen) {
      const word = path.map(([pr, pc]) => letterAt(board, pr, pc)).join("");
      if (!found.has(word)) found.set(word, path.map((p) => [...p] as Coord));
    }
    if (path.length < maxDepth) {
      for (const [nr, nc] of neighbors(board, r, c)) {
        if (!visited[nr * board.cols + nc]) dfs(nr, nc, next);
      }
    }
    path.pop();
    visited[idx] = false;
  }

  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) dfs(r, c, trie.root);
  }
  return [...found.entries()]
    .map(([word, path]) => ({ word, path }))
    .sort((a, b) => (a.word < b.word ? -1 : 1));
}

/** 在棋盘上查找指定单词的稳定展示路径；不存在返回 null */
export function findWordPath(board: Board, trie: Trie, word: string): Coord[] | null {
  const target = normalizeWord(word);
  if (target.length === 0 || target.length > board.rows * board.cols) return null;
  const visited = new Array<boolean>(board.rows * board.cols).fill(false);
  const path: Coord[] = [];

  function dfs(r: number, c: number, node: TrieNode, depth: number): Coord[] | null {
    const idx = r * board.cols + c;
    if (board.letters[idx] !== target[depth]) return null;
    const next = node.children.get(target[depth]);
    if (!next) return null;
    visited[idx] = true;
    path.push([r, c]);
    if (depth === target.length - 1) {
      return next.isWord ? path.map((p) => [...p] as Coord) : null;
    }
    for (const [nr, nc] of neighbors(board, r, c)) {
      if (!visited[nr * board.cols + nc]) {
        const res = dfs(nr, nc, next, depth + 1);
        if (res) return res;
      }
    }
    path.pop();
    visited[idx] = false;
    return null;
  }

  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      const res = dfs(r, c, trie.root, 0);
      if (res) return res;
    }
  }
  return null;
}

export interface PathCheckResult {
  valid: boolean;
  /** 拼出的文本（大写） */
  text: string;
}

/**
 * 核验外部传入路径：越界、相邻性（八方向）、重复格、字母一致性。
 * 即使能拼出目标文本，不符合移动规则也拒绝。
 */
export function validatePath(board: Board, word: string, path: Coord[]): PathCheckResult {
  const target = normalizeWord(word);
  if (!Array.isArray(path) || path.length === 0)
    throw new ValidationError("INVALID_PATH", "路径必须是非空坐标数组");
  if (path.length !== target.length)
    throw new ValidationError(
      "PATH_LENGTH_MISMATCH",
      `路径长度 ${path.length} 与单词长度 ${target.length} 不一致`,
    );
  const seen = new Set<number>();
  let text = "";
  let prev: Coord | null = null;
  for (const coord of path) {
    if (!Array.isArray(coord) || coord.length !== 2 || !coord.every(Number.isInteger))
      throw new ValidationError("INVALID_COORD", `坐标必须是 [行,列] 整数对：${JSON.stringify(coord)}`);
    const [r, c] = coord;
    if (r < 0 || r >= board.rows || c < 0 || c >= board.cols)
      throw new ValidationError("COORD_OUT_OF_BOUNDS", `坐标 [${r},${c}] 越界（棋盘 ${board.rows}x${board.cols}）`);
    const idx = r * board.cols + c;
    if (seen.has(idx))
      throw new ValidationError("DUPLICATE_CELL", `路径重复使用格子 [${r},${c}]`);
    seen.add(idx);
    if (prev) {
      const dr = Math.abs(r - prev[0]);
      const dc = Math.abs(c - prev[1]);
      if (dr > 1 || dc > 1)
        throw new ValidationError(
          "NOT_ADJACENT",
          `格子 [${prev[0]},${prev[1]}] 与 [${r},${c}] 不相邻`,
        );
    }
    const letter = letterAt(board, r, c);
    if (letter !== target[text.length])
      throw new ValidationError(
        "LETTER_MISMATCH",
        `格子 [${r},${c}] 的字母 ${letter} 与单词第 ${text.length + 1} 个字母 ${target[text.length]} 不一致`,
      );
    text += letter;
    prev = coord;
  }
  return { valid: true, text };
}
