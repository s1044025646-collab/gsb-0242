# 字母棋盘词语路径搜索后端

本地英文单词棋盘搜索服务：管理字典、矩形字母棋盘、搜索请求和路径报告。仅提供 HTTP API 与 CLI，无网页界面。技术栈：TypeScript + Node.js（内置 `node:http` / `node:sqlite`，零运行时依赖），Windows 本地直接运行，不需要 Docker / WSL / 外部服务。

## 环境要求

- Node.js >= 22.5（推荐 22.12+ 或 24+；内置 SQLite 为实验特性，启动时有一条 ExperimentalWarning 属正常）
- 仅开发依赖：typescript、tsx（`npm install` 安装）

## 快速开始

```powershell
npm install        # 安装开发依赖
npm run build      # 编译 TypeScript 到 dist/
npm test           # 运行全部测试（15 个）
npm run demo       # 固定演示：演示棋盘 + 演示词表 + 合法/非法路径示例
npm start          # 启动 API 服务（自动选择空闲端口）
node dist/cli.js serve --port 8080   # 指定端口
```

数据保存在项目内 `data/wordsearch.db`（可用环境变量 `WORDSEARCH_DB` 覆盖）。

## 坐标与遍历规则（公开约定）

- 坐标**从零开始**，格式 `[行, 列]`，左上角为 `(0,0)`。
- 相邻为八方向（水平、竖直、对角），一条路径不能重复使用同一格。
- 稳定展示路径：同一单词可能有多条路径，结果中去重只出现一次，展示**坐标序列字典序最小**的一条。实现上起点按行优先、邻居按 `(行,列)` 升序遍历，第一个找到的路径即该稳定路径。
- 字母 `Q` 只代表 `Q`，不自动当作 `QU`；无其他格子拼接规则。
- 大小写统一按大写处理，字典保留首次导入的原始写法。

## 输入上限

- 棋盘最大 6 行 6 列，每格一个英文字母 A-Z。
- 最短单词长度默认 3，可用 `config set min-word-len N`（1-36）或搜索时按次覆盖。
- 单词仅含 A-Z；路径长度必须等于单词长度。

## CLI 命令

```
node dist/cli.js import cat dog --file words.txt   # 导入单词（新字典版本）
node dist/cli.js words                             # 查看当前字典
node dist/cli.js remove dog                        # 删除单词（新版本）
node dist/cli.js board create 3 3 CATATSTAR        # 创建棋盘
node dist/cli.js search 1 --min-len 3              # 全量搜索并保存报告
node dist/cli.js check 1 cat                       # 检查单词及稳定路径
node dist/cli.js validate 1 SAT "1,2;0,1;0,2"      # 核验外部路径
node dist/cli.js report 1 --export                 # 导出文本报告
node dist/cli.js reports                           # 列出全部报告
node dist/cli.js config set min-word-len 2         # 配置最短词长
```

## HTTP API

默认监听 `127.0.0.1`，未指定端口时自动选空闲端口（`PORT` 环境变量或 `--port` 可指定）。错误统一返回 `{"error":{"code","message"}}`，参数错误 HTTP 400，未找到 404。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/dictionary` | 当前字典版本与词条 |
| POST | `/api/dictionary/words` | `{words:[..]}` 导入，生成新版本 |
| DELETE | `/api/dictionary/words/:word` | 删除单词，生成新版本 |
| PUT | `/api/settings/min-word-len` | `{value:n}` 设置最短词长 |
| POST | `/api/boards` | `{rows,cols,letters}` 创建棋盘 |
| GET | `/api/boards/:id` | 查看棋盘 |
| POST | `/api/boards/:id/search` | `{minLen?}` 全量搜索并保存报告 |
| POST | `/api/boards/:id/check` | `{word}` 检查单词及稳定路径 |
| POST | `/api/boards/:id/validate-path` | `{word,path:[[r,c],..]}` 核验外部路径 |
| GET | `/api/reports` / `/api/reports/:id` | 报告列表 / 详情 |
| GET | `/api/reports/:id/export` | 导出纯文本报告 |

主要错误码：`INVALID_INPUT`、`INVALID_JSON`、`INVALID_WORD`、`EMPTY_WORD`、`EMPTY_IMPORT`、`INVALID_BOARD_SIZE`、`BOARD_TOO_LARGE`、`INVALID_LETTERS`、`BOARD_NOT_FOUND`、`REPORT_NOT_FOUND`、`INVALID_MIN_LEN`、`INVALID_PATH`、`PATH_LENGTH_MISMATCH`、`INVALID_COORD`、`COORD_OUT_OF_BOUNDS`、`DUPLICATE_CELL`、`NOT_ADJACENT`、`LETTER_MISMATCH`。

## 字典版本与历史报告

每次导入/删除生成新的字典版本（全量快照）。搜索报告记录当时的字典版本号，历史报告可随时回看当时的词表依据；新查询始终使用最新版本。空词表或无命中时返回明确的空结果（`count: 0, words: []`），不报错。

## 演示棋盘

```
C A T
A T S
T A R
```

演示词表（自建）：CAT CATS CAR TAR RAT RATS SAT STAR TARS ART DOG。覆盖共享前缀（CAT/CATS）、对角移动（SAT）、重复字母（A/T 各 3 个）、多路径单词（CAT 有两条路径，稳定选择 `(0,0)(0,1)(0,2)`）。非法示例：`CAC` 只能复用格子 `(0,0)` 拼出，路径核验以 `DUPLICATE_CELL` 拒绝。

## 实现说明

- 搜索：自建前缀树 + 深度优先搜索，前缀不存在即剪枝（`src/search.ts`、`src/trie.ts`）。
- 路径核验：检查越界、八方向相邻、重复格、字母一致性；能拼出文本但违反移动规则同样拒绝。
- 测试：人工词表结果核对 + 小棋盘独立暴力枚举参照，覆盖单格棋盘、边角相邻、重复词条、大小写、多路径稳定选择、坏坐标、空词表、字典版本与服务重启持久化（`test/`）。
- 限制：面向小棋盘与本地演示规模词表，未做大型字典极限性能优化；`node:sqlite` 目前为实验特性。
