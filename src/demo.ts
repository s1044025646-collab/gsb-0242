/**
 * 固定演示棋盘与演示词表（自建，不下载在线字典）。
 *
 * 棋盘 3x3：
 *   C A T
 *   A T S
 *   T A R
 *
 * 覆盖场景：
 *  - 共享前缀：CAT / CATS
 *  - 对角移动：SAT = (1,2)->(2,1)->(2,0)
 *  - 重复字母：A 出现 3 次、T 出现 3 次
 *  - 多路径单词：CAT 有两条路径，稳定选择坐标字典序最小的 (0,0)(0,1)(0,2)
 *  - 非法示例：CAC 只能复用格子 (0,0) 才能拼出，路径核验必须拒绝
 */
export const DEMO_BOARD = {
  rows: 3,
  cols: 3,
  letters: "CATATSTAR",
};

export const DEMO_WORDS = [
  "cat",
  "Cats",
  "CAR",
  "tar",
  "rat",
  "Rats",
  "sat",
  "star",
  "tars",
  "art",
  "dog", // 不在棋盘上，用于展示未命中
];

/** 只能复用格子才能拼出的非法示例 */
export const DEMO_ILLEGAL = {
  word: "CAC",
  path: [
    [0, 0],
    [0, 1],
    [0, 0],
  ] as [number, number][],
};
