# 字母棋盘词语路径搜索后端（本地）

一个只做 **API 与 CLI** 的本地英文单词棋盘搜索服务：管理字典版本、矩形字母棋盘、
搜索请求与路径报告，使用 TypeScript + Node.js + 内置 SQLite（`node:sqlite`）实现，
**不依赖 Docker、WSL、任何付费服务或在线字典 API**。

## 环境要求

- Windows + PowerShell
- Node.js **>= 22.5**（开发与实测版本：v25.5.0；使用内置 `node:sqlite`，无需原生编译）
- 仅开发依赖 `typescript` 与 `@types/node`，运行时零第三方依赖

## 快速开始

```powershell
npm install        # 安装开发依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 编译并运行 12 个内置测试
npm run demo       # 一键演示（CLI + HTTP + 重启持久化核验）
npm start          # 启动 HTTP 服务，默认自动选择空闲端口
```

指定端口启动：

```powershell
$env:PORT = 8080; npm start
```

数据默认保存在项目内 `data/wordboard.sqlite`（WAL 模式），可用环境变量
`WORD_BOARD_DB` 指定文件、`WORD_BOARD_HOME` 指定数据根目录。

## 规则约定

- **棋盘**：矩形，1～6 行、1～6 列，每格恰好一个英文字母；非矩形、尺寸越界、
  非字母字符一律返回 `VALIDATION` 错误。
- **坐标**：行列均 **从 0 开始**，`row` 为行号、`col` 为列号。
- **移动**：水平、竖直、对角共八个方向；一条路径不能重复使用同一格。
- **匹配**：单词必须完整出现（终止于前缀树叶子标记），不做前缀命中、不做纠错。
- **字母 Q**：只代表 `Q`，不会自动当作 `QU`，也没有任何未声明的拼接规则。
- **大小写**：统一按大写归一化处理；字典保留每次导入的原始字符串 `origWord`。

### 遍历顺序与稳定路径

- 搜索起点按 **行优先（row-major）** 枚举：`(0,0),(0,1),...`。
- 每个格子的八个扩展方向固定为：左上、上、右上、左、右、左下、下、右下。
- DFS 过程中若当前前缀在前缀树中不存在则立即剪枝。
- 一个单词可能有多条路径，但结果列表中 **只出现一次**，并固定选择按上述顺序
  最先找到的那条作为展示路径；结果整体按单词字母序排序。

### 最短单词长度

搜索时通过 `minLength` 配置（API/CLI 均可，默认 `2`），必须是不小于 1 的整数。

## 自建演示词表与棋盘

不下载任何在线字典。演示词表（`src/service.ts` 中 `DEMO_WORDS`）：

```
SHE HE HEE HAT EAT TEE AT
```

演示棋盘：

```
[0,0]S [0,1]H [0,2]E
[1,0]E [1,1]A [1,2]T
[2,0]E [2,1]T [2,2]H
```

`minLength=2` 的完整搜索结果（与人工枚举核对一致，共 7 个；演示词表里没有其他可拼单词）：

| 单词 | 稳定展示路径 |
|------|--------------|
| AT  | `(1,1)->(1,2)` |
| EAT | `(0,2)->(1,1)->(1,2)`（对角移动） |
| HAT | `(0,1)->(1,1)->(1,2)`（共享前缀/前缀树剪枝） |
| HE  | `(0,1)->(0,2)` |
| HEE | `(0,1)->(1,0)->(2,0)`（重复字母 E，不重复格） |
| SHE | `(0,0)->(0,1)->(0,2)` |
| TEE | `(2,1)->(1,0)->(2,0)`（多路径单词，另有 `(2,1)->(2,0)->(1,0)`） |

**非法例子**：`HEEH` 看似能从 H-E-E 再接 H，但第四步只能回到起点 `(0,1)`，
属于重复使用格子；外部传入该路径会被核验拒绝（`DUPLICATE_CELL`），即使文本恰好拼得出来。

## CLI 用法

```powershell
node dist/cli/index.js demo
node dist/cli/index.js dict-import SHE,HE,HEE --note 手动导入
node dist/cli/index.js dict-import --file examples/words.txt
node dist/cli/index.js dict-list
node dist/cli/index.js dict-get 1
node dist/cli/index.js board-create '[["S","H","E"],["E","A","T"],["E","T","H"]]'
node dist/cli/index.js board-create @examples/board.json
node dist/cli/index.js search 1 --min 2
node dist/cli/index.js search 1 --dict-version 1
node dist/cli/index.js check-word 1 TEE
node dist/cli/index.js verify-path 1 '[{"row":0,"col":0},{"row":0,"col":1}]' --word SH
node dist/cli/index.js report 1
node dist/cli/index.js report 1 --out data/report.json
```

## HTTP API

所有响应均为 JSON；错误统一形如 `{"error":{"code":"...","message":"..."}}`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 |
| POST | `/api/dict/versions` | 导入一批词条，创建**新字典版本**，body：`{"words":["SHE"],"sourceNote":"..."}` |
| GET  | `/api/dict/versions` | 字典版本列表（含每版词条数） |
| GET  | `/api/dict/versions/:version` | 查看指定版本词条 |
| POST | `/api/boards` | 创建棋盘，body 为二维数组或 `{"grid":[[...]]}` |
| GET  | `/api/boards/:id` | 查看棋盘 |
| POST | `/api/boards/:id/search` | 搜索全部可构单词，body：`{"minLength":2,"dictVersion":1}`（版本可省略，默认最新） |
| GET  | `/api/boards/:id/words/:word` | 检查指定单词，枚举其全部路径 |
| POST | `/api/boards/:id/verify-path` | 核验外部路径，body：`{"path":[{row,col}...],"word":"可选期望词"}` |
| GET  | `/api/reports` | 搜索报告列表 |
| GET  | `/api/reports/:id` | 查看历史报告（含当时的字典版本号与全部路径） |

`curl` 示例：

```powershell
curl.exe -X POST http://127.0.0.1:8080/api/dict/versions `
  -H "Content-Type: application/json" `
  -d '{\"words\":[\"SHE\",\"HE\"],\"sourceNote\":\"测试\"}'
```

### 字典版本与历史报告

- 每次导入生成一个**不可变新版本**（同一版本内重复/仅大小写不同的词条只保留一条，
  响应中通过 `duplicates` 提示被去重的原始输入）。
- 新查询默认使用最新版本，也可显式指定 `dictVersion`。
- 每次搜索都会把结果快照（单词、展示路径、`minLength`、字典版本号）写入 SQLite，
  之后即使字典更新，历史报告仍保留当时的词表依据。
- 空词表、没有命中时都返回明确的空数组：`{"total":0,"words":[]}`。

### 错误码

| code | HTTP 状态 | 场景 |
|------|-----------|------|
| `VALIDATION` | 400 | 参数非法：棋盘尺寸/字符、单词字符、minLength、路径格式等 |
| `BAD_REQUEST` | 400 | 请求体不是合法 JSON |
| `NOT_FOUND` | 404 | 棋盘、字典版本、报告不存在，或字典为空时发起搜索 |
| `INTERNAL` | 500 | 服务内部错误 |

路径核验的 `violations[].type`：`OUT_OF_BOUNDS`（越界）、`NOT_ADJACENT`（不相邻）、
`DUPLICATE_CELL`（重复格）、`LETTER_MISMATCH`（与期望单词不一致）；
一次核验可能同时返回多种违规。

## 测试

`npm test` 使用 Node 内置测试运行器，共 12 个用例，覆盖：

- 固定棋盘上的**人工完整词表**结果核对
- 单格棋盘、边角（1x2）相邻
- 共享前缀与前缀树剪枝、对角移动、重复字母、多路径稳定选择
- 重复词条与大小写归一化、Q 不自动当 QU
- 外部路径的越界/不相邻/重复格/字母不一致核验
- 空词表与无命中的空结果、非法棋盘输入

服务重启后的持久化由 `npm run demo`（内含“写入→重启→读取报告”）人工/脚本核验。

## 设计说明与限制

- 算法为自建前缀树（Trie）+ DFS，最坏复杂度随棋盘格数阶乘增长；棋盘被限制在
  6x6 以内，面向演示与中小词表，**不针对大型字典做极限性能优化**。
- 仅监听 `127.0.0.1`，定位为本地单机工具，没有鉴权、多人、计时排名或网页界面。
- `node:sqlite` 在当前 Node 版本会打印一条 experimental 警告，不影响功能。
- 不含自然语言纠错、词形还原或自动补全；未在字典中的单词即使棋盘上可拼，
  搜索结果也不会出现（`check-word` 会分别给出 `inDict` 与路径枚举）。
