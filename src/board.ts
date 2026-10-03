export type Coord = [number, number]; // [row, col]，从零开始

export interface Board {
  rows: number;
  cols: number;
  /** 长度必须为 rows*cols，仅含 A-Z 大写字母 */
  letters: string;
}

export const MAX_ROWS = 6;
export const MAX_COLS = 6;

export class ValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function normalizeWord(word: string): string {
  return word.trim().toUpperCase();
}

export function assertValidWord(word: string): string {
  const w = normalizeWord(word);
  if (w.length === 0) throw new ValidationError("EMPTY_WORD", "单词不能为空");
  if (!/^[A-Z]+$/.test(w))
    throw new ValidationError("INVALID_WORD", `单词只能包含英文字母 A-Z：${word}`);
  return w;
}

export function parseBoard(rows: number, cols: number, letters: string): Board {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1)
    throw new ValidationError("INVALID_BOARD_SIZE", "棋盘行列必须是正整数");
  if (rows > MAX_ROWS || cols > MAX_COLS)
    throw new ValidationError(
      "BOARD_TOO_LARGE",
      `棋盘最大为 ${MAX_ROWS}x${MAX_COLS}，收到 ${rows}x${cols}`,
    );
  const normalized = letters.trim().toUpperCase();
  if (normalized.length !== rows * cols)
    throw new ValidationError(
      "INVALID_LETTERS",
      `字母数量 ${normalized.length} 与棋盘大小 ${rows}x${cols} 不符`,
    );
  if (!/^[A-Z]+$/.test(normalized))
    throw new ValidationError("INVALID_LETTERS", "棋盘每格只能是一个英文字母 A-Z");
  return { rows, cols, letters: normalized };
}

export function letterAt(board: Board, r: number, c: number): string {
  return board.letters[r * board.cols + c];
}

/** 邻居遍历顺序固定：按 (行,列) 升序，保证路径选择稳定可复现 */
const NEIGHBOR_OFFSETS: Coord[] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function neighbors(board: Board, r: number, c: number): Coord[] {
  const out: Coord[] = [];
  for (const [dr, dc] of NEIGHBOR_OFFSETS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < board.rows && nc >= 0 && nc < board.cols) out.push([nr, nc]);
  }
  return out;
}

/** 比较两条路径的坐标序列字典序 */
export function comparePaths(a: Coord[], b: Coord[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i][0] !== b[i][0]) return a[i][0] - b[i][0];
    if (a[i][1] !== b[i][1]) return a[i][1] - b[i][1];
  }
  return a.length - b.length;
}
