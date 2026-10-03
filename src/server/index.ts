import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../db.js";
import {
  checkBoardPath,
  checkWord,
  createBoard,
  createDictVersion,
  getReport,
  getVersionWords,
  listDictVersions,
  listReports,
  requireBoard,
  runSearch,
} from "../service.js";
import { AppError } from "../types.js";

const require = createRequire(import.meta.url);
const net = require("node:net") as typeof import("node:net");

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot =
  process.env.WORD_BOARD_HOME ?? join(here, "..", "..");
const dataDir = join(projectRoot, "data");
const dbFile = process.env.WORD_BOARD_DB ?? join(dataDir, "wordboard.sqlite");
const db = openDatabase(dbFile);

interface RouteContext {
  params: Record<string, string>;
  body: unknown;
  query: URLSearchParams;
}

type Handler = (ctx: RouteContext) => unknown | Promise<unknown>;

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] =
  [];

function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:([^/]+)/g, (_m, key: string) => {
      keys.push(key);
      return "([^/]+)";
    })}$`,
  );
  routes.push({ method, pattern, keys, handler });
}

route("POST", "/api/dict/versions", (ctx) => {
  const body = (ctx.body ?? {}) as { words?: unknown; sourceNote?: unknown };
  return createDictVersion(
    db,
    body.words,
    typeof body.sourceNote === "string" ? body.sourceNote : "",
    "api",
  );
});
route("GET", "/api/dict/versions", () => ({ versions: listDictVersions(db) }));
route("GET", "/api/dict/versions/:version", (ctx) =>
  getVersionWords(db, Number(ctx.params.version)),
);

route("POST", "/api/boards", (ctx) => createBoard(db, ctx.body));
route("GET", "/api/boards/:id", (ctx) => ({
  board: requireBoard(db, Number(ctx.params.id)),
}));

route("POST", "/api/boards/:id/search", (ctx) => {
  const body = (ctx.body ?? {}) as {
    dictVersion?: number;
    minLength?: number;
  };
  return runSearch(db, Number(ctx.params.id), {
    dictVersion: body.dictVersion,
    minLength: body.minLength,
  });
});
route("GET", "/api/boards/:id/words/:word", (ctx) =>
  checkWord(
    db,
    Number(ctx.params.id),
    decodeURIComponent(ctx.params.word ?? ""),
    ctx.query.get("dictVersion") !== null
      ? Number(ctx.query.get("dictVersion"))
      : undefined,
  ),
);
route("POST", "/api/boards/:id/verify-path", (ctx) =>
  checkBoardPath(db, Number(ctx.params.id), (ctx.body ?? {}) as { path?: unknown; word?: unknown }),
);

route("GET", "/api/reports", () => ({ reports: listReports(db) }));
route("GET", "/api/reports/:id", (ctx) => getReport(db, Number(ctx.params.id)));

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "请求体不是合法 JSON");
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
      send(res, 200, { ok: true, service: "word-board-search", db: dbFile });
      return;
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.pattern.exec(url.pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((key, i) => {
        params[key] = match[i + 1]!;
      });
      const body = req.method === "POST" ? await readBody(req) : {};
      const data = await r.handler({ params, body, query: url.searchParams });
      send(res, 200, data);
      return;
    }
    send(res, 404, { error: { code: "NOT_FOUND", message: `无此路由: ${req.method} ${url.pathname}` } });
  } catch (err) {
    if (err instanceof AppError) {
      send(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
    } else {
      send(res, 500, {
        error: { code: "INTERNAL", message: (err as Error).message },
      });
    }
  }
});

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(preferred === 0 ? 0 : preferred, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === "object") resolve(addr.port);
        else reject(new Error("无法获取端口"));
      });
    });
  });
}

const requestedPort = Number(process.env.PORT ?? 0);
findFreePort(Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 0)
  .then((port) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`[word-board] 服务已启动: http://127.0.0.1:${port}`);
      console.log(`[word-board] 数据文件: ${dbFile}`);
    });
  })
  .catch((err) => {
    console.error("启动失败:", err);
    process.exit(1);
  });

export { server };
