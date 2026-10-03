import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { Store, SearchReport } from "./db.js";
import { ValidationError } from "./board.js";
import { validatePath } from "./search.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (raw === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("INVALID_JSON", "请求体不是合法 JSON");
  }
}

export function formatReportText(report: SearchReport): string {
  const lines: string[] = [];
  lines.push(`搜索报告 #${report.id}`);
  lines.push(`时间: ${report.createdAt}`);
  lines.push(`棋盘 #${report.boardId} (${report.board.rows}x${report.board.cols}):`);
  for (let r = 0; r < report.board.rows; r++) {
    lines.push(
      "  " +
        [...report.board.letters.slice(r * report.board.cols, (r + 1) * report.board.cols)].join(" "),
    );
  }
  lines.push(`字典版本: ${report.dictVersion}（${report.dictWords.length} 词）`);
  lines.push(`最短词长: ${report.minLen}`);
  lines.push(`命中 ${report.words.length} 个单词:`);
  for (const w of report.words) {
    lines.push(`  ${w.word}  ${w.path.map(([r, c]) => `(${r},${c})`).join(" -> ")}`);
  }
  return lines.join("\n") + "\n";
}

export function createApp(store: Store): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      // GET /api/health
      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { ok: true });
      }
      // GET /api/dictionary
      if (req.method === "GET" && url.pathname === "/api/dictionary") {
        return sendJson(res, 200, {
          version: store.currentDictVersion(),
          minWordLen: store.getMinWordLen(),
          words: store.currentWords(),
        });
      }
      // POST /api/dictionary/words  {words: [...]}
      if (req.method === "POST" && url.pathname === "/api/dictionary/words") {
        const body = (await readBody(req)) as { words?: unknown };
        if (!Array.isArray(body.words))
          throw new ValidationError("INVALID_INPUT", "请求体需要 {words: [..]}");
        return sendJson(res, 201, store.importWords(body.words));
      }
      // DELETE /api/dictionary/words/:word
      if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "dictionary" && parts[2] === "words" && parts[3]) {
        return sendJson(res, 200, store.removeWord(decodeURIComponent(parts[3])));
      }
      // PUT /api/settings/min-word-len  {value: n}
      if (req.method === "PUT" && url.pathname === "/api/settings/min-word-len") {
        const body = (await readBody(req)) as { value?: unknown };
        store.setMinWordLen(Number(body.value));
        return sendJson(res, 200, { minWordLen: store.getMinWordLen() });
      }
      // POST /api/boards  {rows, cols, letters}
      if (req.method === "POST" && url.pathname === "/api/boards") {
        const body = (await readBody(req)) as { rows?: unknown; cols?: unknown; letters?: unknown };
        if (typeof body.letters !== "string")
          throw new ValidationError("INVALID_INPUT", "请求体需要 {rows, cols, letters}");
        return sendJson(res, 201, store.createBoard(Number(body.rows), Number(body.cols), body.letters));
      }
      // GET /api/boards/:id
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "boards" && parts.length === 3) {
        return sendJson(res, 200, store.requireBoard(Number(parts[2])));
      }
      // POST /api/boards/:id/search  {minLen?}
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "boards" && parts[3] === "search") {
        const body = (await readBody(req)) as { minLen?: unknown };
        const minLen = body.minLen === undefined ? undefined : Number(body.minLen);
        const report = store.search(Number(parts[2]), minLen);
        return sendJson(res, 200, {
          searchId: report.id,
          dictVersion: report.dictVersion,
          minLen: report.minLen,
          count: report.words.length,
          words: report.words,
        });
      }
      // POST /api/boards/:id/check  {word}
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "boards" && parts[3] === "check") {
        const body = (await readBody(req)) as { word?: unknown };
        if (typeof body.word !== "string") throw new ValidationError("INVALID_INPUT", "请求体需要 {word}");
        return sendJson(res, 200, store.checkWord(Number(parts[2]), body.word));
      }
      // POST /api/boards/:id/validate-path  {word, path: [[r,c],...]}
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "boards" && parts[3] === "validate-path") {
        const body = (await readBody(req)) as { word?: unknown; path?: unknown };
        if (typeof body.word !== "string" || !Array.isArray(body.path))
          throw new ValidationError("INVALID_INPUT", "请求体需要 {word, path: [[行,列],...]}");
        const board = store.requireBoard(Number(parts[2]));
        const result = validatePath(board, body.word, body.path as [number, number][]);
        const check = store.checkWord(board.id, body.word);
        return sendJson(res, 200, { ...result, inDictionary: check.inDictionary });
      }
      // GET /api/reports
      if (req.method === "GET" && url.pathname === "/api/reports") {
        return sendJson(res, 200, { reports: store.listReports() });
      }
      // GET /api/reports/:id  与  GET /api/reports/:id/export
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "reports" && parts[2]) {
        const report = store.getReport(Number(parts[2]));
        if (!report) throw new ValidationError("REPORT_NOT_FOUND", `报告 ${parts[2]} 不存在`);
        if (parts[3] === "export") {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end(formatReportText(report));
        }
        return sendJson(res, 200, report);
      }
      sendError(res, 404, "NOT_FOUND", `路由不存在：${req.method} ${url.pathname}`);
    } catch (err) {
      if (err instanceof ValidationError) return sendError(res, 400, err.code, err.message);
      sendError(res, 500, "INTERNAL_ERROR", err instanceof Error ? err.message : String(err));
    }
  });
}

/** 启动服务；port 为 0 或未指定时自动选择空闲端口 */
export function startServer(store: Store, port = 0): Promise<{ server: Server; port: number }> {
  const app = createApp(store);
  return new Promise((resolve, reject) => {
    app.on("error", reject);
    app.listen(port, "127.0.0.1", () => {
      const addr = app.address();
      resolve({ server: app, port: typeof addr === "object" && addr ? addr.port : port });
    });
  });
}
