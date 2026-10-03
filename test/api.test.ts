import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Server } from "node:http";
import { Store } from "../src/db.js";
import { startServer } from "../src/server.js";

let server: Server;
let base: string;
let dir: string;
let store: Store;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "wbs-api-"));
  store = new Store(path.join(dir, "api.db"));
  const started = await startServer(store, 0);
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function post(p: string, body: unknown): Promise<{ status: number; json: never }> {
  const res = await fetch(base + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as never };
}

test("API 全流程：导入、建盘、搜索、检查、路径核验、报告导出", async () => {
  let r = await post("/api/dictionary/words", { words: ["cat", "Cats", "sat", "dog"] });
  assert.equal(r.status, 201);
  assert.equal((r.json as { added: number }).added, 4);

  r = await post("/api/boards", { rows: 3, cols: 3, letters: "CATATSTAR" });
  assert.equal(r.status, 201);
  const boardId = (r.json as { id: number }).id;

  r = await post(`/api/boards/${boardId}/search`, {});
  assert.equal(r.status, 200);
  const search = r.json as { searchId: number; count: number; words: { word: string }[] };
  assert.deepEqual(search.words.map((w) => w.word), ["CAT", "CATS", "SAT"]);

  r = await post(`/api/boards/${boardId}/check`, { word: "cat" });
  assert.deepEqual((r.json as { path: number[][] }).path, [[0, 0], [0, 1], [0, 2]]);

  r = await post(`/api/boards/${boardId}/validate-path`, { word: "CAC", path: [[0, 0], [0, 1], [0, 0]] });
  assert.equal(r.status, 400);
  assert.equal((r.json as { error: { code: string } }).error.code, "DUPLICATE_CELL");

  r = await post(`/api/boards/${boardId}/validate-path`, { word: "SAT", path: [[1, 2], [2, 1], [2, 0]] });
  assert.equal(r.status, 200);
  assert.equal((r.json as { valid: boolean }).valid, true);

  const rep = await fetch(`${base}/api/reports/${search.searchId}`);
  assert.equal(rep.status, 200);
  const exp = await fetch(`${base}/api/reports/${search.searchId}/export`);
  const text = await exp.text();
  assert.match(text, /搜索报告/);
  assert.match(text, /CAT/);
});

test("API 错误码：坏 JSON、坏棋盘、未知路由", async () => {
  const bad = await fetch(`${base}/api/boards`, { method: "POST", body: "not json" });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "INVALID_JSON");

  const r = await post("/api/boards", { rows: 9, cols: 9, letters: "A".repeat(81) });
  assert.equal(r.status, 400);
  assert.equal((r.json as { error: { code: string } }).error.code, "BOARD_TOO_LARGE");

  const nf = await fetch(`${base}/api/nope`);
  assert.equal(nf.status, 404);
});
