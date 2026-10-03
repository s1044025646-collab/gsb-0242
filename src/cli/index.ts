#!/usr/bin/env node
import { openDatabase } from "../db.js";
import {
  checkBoardPath,
  checkWord,
  createBoard,
  createDictVersion,
  DEMO_BOARD,
  DEMO_WORDS,
  getReport,
  getVersionWords,
  listDictVersions,
  runSearch,
} from "../service.js";
import { AppError } from "../types.js";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

const dataDir = process.env.WORD_BOARD_HOME
  ? join(process.env.WORD_BOARD_HOME, "data")
  : join(process.cwd(), "data");
const dbFile = process.env.WORD_BOARD_DB ?? join(dataDir, "wordboard.sqlite");
const db = openDatabase(dbFile);

function fail(message: string, code = 1): never {
  console.error(`错误: ${message}`);
  process.exit(code);
}

function parseJsonArg(value: string | undefined, label: string): unknown {
  if (value === undefined || value === "") fail(`缺少参数 ${label}`);
  if (value!.startsWith("@")) {
    return JSON.parse(readText(value!.slice(1))) as unknown;
  }
  try {
    return JSON.parse(value!) as unknown;
  } catch {
    fail(`${label} 不是合法 JSON`);
  }
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function readWordsArg(args: string[]): string[] {
  const fileIdx = args.indexOf("--file");
  if (fileIdx >= 0) {
    const file = args[fileIdx + 1];
    if (!file) fail("--file 需要给出文件路径");
    const text = readText(file);
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
  const inline = args
    .filter((a) => !a.startsWith("--"))
    .flatMap((a) => a.split(","))
    .map((a) => a.trim())
    .filter(Boolean);
  if (inline.length === 0) fail("请提供词条，如：dict-import SHE,HE,HEE 或 --file words.txt");
  return inline;
}

function formatPath(path: { row: number; col: number }[]): string {
  return path.map((p) => `(${p.row},${p.col})`).join(" -> ");
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "demo": {
      const imported = createDictVersion(db, DEMO_WORDS, "自建演示词表", "demo");
      const board = createBoard(db, DEMO_BOARD);
      const result = runSearch(db, board.id, { minLength: 2 });
      console.log("== 演示棋盘（坐标从 0 开始）==");
      DEMO_BOARD.forEach((row, r) =>
        console.log(`  ${row.map((ch, c) => `[${r},${c}]${ch}`).join(" ")}`),
      );
      console.log(`\n字典版本 ${imported.version}，棋盘 id=${board.id}`);
      console.log(`\n== 搜索结果（共 ${result.total} 个单词）==`);
      for (const w of result.words) {
        console.log(`  ${w.word.padEnd(4)} ${formatPath(w.path)}`);
      }
      console.log("\n== 非法示例：HEEH 需要复用 (0,1)=H，路径核验应被拒绝 ==");
      const illegal = checkBoardPath(db, board.id, {
        word: "HEEH",
        path: [
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 0 },
          { row: 0, col: 1 },
        ],
      });
      console.log(JSON.stringify(illegal, null, 2));
      console.log(`\n报告已保存，searchId=${result.searchId}，可用 report ${result.searchId} 查看`);
      break;
    }
    case "dict-import": {
      const noteIdx = args.indexOf("--note");
      const note = noteIdx >= 0 ? (args[noteIdx + 1] ?? "") : "";
      printJson(createDictVersion(db, readWordsArg(args), note, "cli"));
      break;
    }
    case "dict-list":
      printJson({ versions: listDictVersions(db) });
      break;
    case "dict-get": {
      const version = Number(args[0]);
      if (!Number.isInteger(version)) fail("用法：dict-get <version>");
      printJson(getVersionWords(db, version));
      break;
    }
    case "board-create": {
      const grid = parseJsonArg(args[0], "棋盘 JSON，如 [[\"S\",\"H\"],[\"E\",\"A\"]]");
      printJson(createBoard(db, grid));
      break;
    }
    case "search": {
      const boardId = Number(args[0]);
      if (!Number.isInteger(boardId)) fail("用法：search <boardId> [--min 2] [--dict-version N]");
      const minIdx = args.indexOf("--min");
      const dvIdx = args.indexOf("--dict-version");
      printJson(
        runSearch(db, boardId, {
          minLength: minIdx >= 0 ? Number(args[minIdx + 1]) : undefined,
          dictVersion: dvIdx >= 0 ? Number(args[dvIdx + 1]) : undefined,
        }),
      );
      break;
    }
    case "check-word": {
      const boardId = Number(args[0]);
      const word = args[1];
      if (!Number.isInteger(boardId) || !word) fail("用法：check-word <boardId> <WORD>");
      printJson(checkWord(db, boardId, word));
      break;
    }
    case "verify-path": {
      const boardId = Number(args[0]);
      const pathJson = parseJsonArg(args[1], "路径 JSON") as unknown;
      const wordIdx = args.indexOf("--word");
      if (!Number.isInteger(boardId)) fail("用法：verify-path <boardId> '<json>' [--word WORD]");
      printJson(
        checkBoardPath(db, boardId, {
          path: pathJson,
          word: wordIdx >= 0 ? args[wordIdx + 1] : undefined,
        }),
      );
      break;
    }
    case "report": {
      const searchId = Number(args[0]);
      if (!Number.isInteger(searchId)) fail("用法：report <searchId> [--out file.json]");
      const report = getReport(db, searchId);
      const outIdx = args.indexOf("--out");
      if (outIdx >= 0) {
        const out = args[outIdx + 1];
        if (!out) fail("--out 需要给出文件路径");
        writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
        console.log(`报告已导出到 ${out}`);
      } else {
        printJson(report);
      }
      break;
    }
    default:
      console.log(`wordboard - 本地英文单词棋盘搜索 CLI

数据文件: ${dbFile}

用法:
  wordboard demo
  wordboard dict-import SHE,HE,HEE [--note 备注] [--file words.txt]
  wordboard dict-list
  wordboard dict-get <version>
  wordboard board-create '[["S","H","E"],["E","A","T"]]'
  wordboard search <boardId> [--min 2] [--dict-version N]
  wordboard check-word <boardId> <WORD>
  wordboard verify-path <boardId> '[{"row":0,"col":0}]' [--word WORD]
  wordboard report <searchId> [--out report.json]

说明:
  - 棋盘 1~6 行、1~6 列，每格一个英文字母；坐标从 0 开始。
  - JSON 参数可用 @文件 形式从文件读取，如 board-create @board.json。`);
  }
} catch (err) {
  if (err instanceof AppError) fail(`[${err.code}] ${err.message}`);
  fail((err as Error).message);
}
