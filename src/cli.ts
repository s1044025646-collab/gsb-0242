import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./db.js";
import { ValidationError } from "./board.js";
import { validatePath } from "./search.js";
import { startServer, formatReportText } from "./server.js";
import { DEMO_BOARD, DEMO_WORDS, DEMO_ILLEGAL } from "./demo.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB = path.join(PROJECT_ROOT, "data", "wordsearch.db");

function dbPath(): string {
  return process.env.WORDSEARCH_DB ?? DEFAULT_DB;
}

function parseCoordList(spec: string): [number, number][] {
  return spec.split(";").map((pair) => {
    const [r, c] = pair.split(",").map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c))
      throw new ValidationError("INVALID_COORD", `无法解析坐标 "${pair}"，格式应为 行,列;行,列`);
    return [r, c];
  });
}

const USAGE = [
  "用法: node dist/cli.js <命令> [参数]",
  "",
  "  serve [--port N]              启动 HTTP API（默认自动选择空闲端口，也可用 PORT 环境变量）",
  "  import <单词... | --file 路径>  导入单词（生成新字典版本）",
  "  words                         查看当前字典",
  "  remove <单词>                 从字典删除单词（生成新版本）",
  "  board create <行> <列> <字母串> 创建棋盘（最大 6x6）",
  "  board show <id>               查看棋盘",
  "  search <棋盘id> [--min-len N]  搜索所有可构成单词并保存报告",
  "  check <棋盘id> <单词>         检查指定单词及稳定展示路径",
  "  validate <棋盘id> <单词> <r,c;r,c;...>  核验外部路径",
  "  report <搜索id> [--export]    查看/导出报告",
  "  reports                       列出全部报告",
  "  config show | set min-word-len N  查看/设置最短词长",
  "  demo                          运行固定演示（演示棋盘 + 演示词表）",
  "",
].join("\n");

export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  const store = new Store(dbPath());
  try {
    switch (cmd) {
      case "serve": {
        const portIdx = args.indexOf("--port");
        const port = portIdx >= 0 ? Number(args[portIdx + 1]) : Number(process.env.PORT ?? 0);
        const { port: actual } = await startServer(store, Number.isInteger(port) ? port : 0);
        process.stdout.write(`API 服务已启动: http://127.0.0.1:${actual}/api/health\n`);
        return;
      }
      case "import": {
        let words: string[];
        const fileIdx = args.indexOf("--file");
        if (fileIdx >= 0) {
          words = readFileSync(args[fileIdx + 1], "utf-8")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        } else {
          words = args;
        }
        const res = store.importWords(words);
        console.log(`字典版本 ${res.version}：新增 ${res.added} 词，共 ${res.total} 词`);
        break;
      }
      case "words": {
        const version = store.currentDictVersion();
        const words = store.currentWords();
        console.log(`字典版本: ${version ?? "（空）"}，共 ${words.length} 词`);
        for (const w of words) console.log(`  ${w.word}（原始: ${w.raw}）`);
        break;
      }
      case "remove": {
        const res = store.removeWord(args[0] ?? "");
        console.log(res.removed ? `已删除，新版本 ${res.version}，共 ${res.total} 词` : "单词不存在");
        break;
      }
      case "board": {
        if (args[0] === "create") {
          const board = store.createBoard(Number(args[1]), Number(args[2]), args[3] ?? "");
          console.log(`棋盘 #${board.id}（${board.rows}x${board.cols}）: ${board.letters}`);
        } else if (args[0] === "show") {
          const b = store.requireBoard(Number(args[1]));
          for (let r = 0; r < b.rows; r++)
            console.log([...b.letters.slice(r * b.cols, (r + 1) * b.cols)].join(" "));
        } else {
          throw new ValidationError("INVALID_INPUT", "board 子命令: create | show");
        }
        break;
      }
      case "search": {
        const minIdx = args.indexOf("--min-len");
        const minLen = minIdx >= 0 ? Number(args[minIdx + 1]) : undefined;
        const report = store.search(Number(args[0]), minLen);
        console.log(formatReportText(report));
        break;
      }
      case "check": {
        const res = store.checkWord(Number(args[0]), args[1] ?? "");
        if (!res.inDictionary) console.log(`${res.word} 不在当前字典中`);
        else if (!res.path) console.log(`${res.word} 在字典中，但棋盘上无法构成`);
        else console.log(`${res.word} 路径: ${res.path.map(([r, c]) => `(${r},${c})`).join(" -> ")}`);
        break;
      }
      case "validate": {
        const board = store.requireBoard(Number(args[0]));
        const result = validatePath(board, args[1] ?? "", parseCoordList(args[2] ?? ""));
        console.log(`路径合法，拼出: ${result.text}`);
        break;
      }
      case "report": {
        const report = store.getReport(Number(args[0]));
        if (!report) throw new ValidationError("REPORT_NOT_FOUND", `报告 ${args[0]} 不存在`);
        if (args.includes("--export")) process.stdout.write(formatReportText(report));
        else console.log(JSON.stringify(report, null, 2));
        break;
      }
      case "reports": {
        for (const r of store.listReports())
          console.log(`#${r.id}  棋盘${r.boardId}  字典v${r.dictVersion}  最短${r.minLen}  命中${r.count}  ${r.createdAt}`);
        break;
      }
      case "config": {
        if (args[0] === "set" && args[1] === "min-word-len") {
          store.setMinWordLen(Number(args[2]));
          console.log(`最短词长已设为 ${store.getMinWordLen()}`);
        } else {
          console.log(`min-word-len = ${store.getMinWordLen()}`);
        }
        break;
      }
      case "demo": {
        const imp = store.importWords(DEMO_WORDS);
        console.log(`导入演示词表：版本 ${imp.version}，共 ${imp.total} 词`);
        const board = store.createBoard(DEMO_BOARD.rows, DEMO_BOARD.cols, DEMO_BOARD.letters);
        console.log(`演示棋盘 #${board.id}:`);
        for (let r = 0; r < board.rows; r++)
          console.log("  " + [...board.letters.slice(r * board.cols, (r + 1) * board.cols)].join(" "));
        const report = store.search(board.id);
        console.log("\n" + formatReportText(report));
        const check = store.checkWord(board.id, "CAT");
        console.log(`合法示例 CAT 稳定路径: ${check.path?.map(([r, c]) => `(${r},${c})`).join(" -> ")}`);
        try {
          validatePath(board, DEMO_ILLEGAL.word, DEMO_ILLEGAL.path);
          console.log("非法示例未被拒绝（异常）");
        } catch (err) {
          if (err instanceof ValidationError)
            console.log(`非法示例 ${DEMO_ILLEGAL.word} 被拒绝 [${err.code}]: ${err.message}`);
          else throw err;
        }
        break;
      }
      default:
        throw new ValidationError("UNKNOWN_COMMAND", `未知命令 "${cmd}"\n${USAGE}`);
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    if (err instanceof ValidationError) {
      console.error(`错误 [${err.code}]: ${err.message}`);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
}
