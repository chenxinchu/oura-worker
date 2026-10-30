# AGENTS.md

给 AI 编码助手的项目说明。人类读者请先看 `README.md`（部署手册），设计取舍在 `ARCHITECTURE.md`。

## 这是什么

一个 Cloudflare Worker：每天北京时间 09:00 从 Oura Ring 拉健康数据，渲染成 HTML 邮件发出。日报每天发，周一加周报，1 号加月报，1 号逢周一三封都发。

| 项 | 值 |
|---|---|
| 线上地址 | `https://oura-daily.your-domain.com` |
| Worker 名 | `oura-daily` |
| 运行时 | Cloudflare Workers（免费版） |
| 语言 | 纯 ESM JavaScript，无构建步骤、无框架、无 TS |
| 依赖 | 只有 `wrangler`（devDependency） |
| 存储 | KV（OAuth 令牌、发送日志）+ D1（历史数据） |
| 配置 | 本地 `wrangler.toml`（含真实邮箱与 id，**不入库**），模板是 `wrangler.toml.example` |
| 发信 | Resend API |

---

## 工作方式：先方案，后动手

**动手改任何代码或文件之前，先停下来。**

1. **先澄清需求**。需求不明确就问，不要靠猜测补全。宁可多问一句，也不要按自己的理解做出一版需要返工的东西。
2. **先给方案**。说明打算改什么、怎么改、会牵动哪些地方、有什么代价和风险。
3. **等确认再执行**。方案没被明确认可之前，不要开始写代码，也不要「顺手」改配置或文档。

这条规则优先于本文件后面所有的技术约定。哪怕改动看起来只有一行、哪怕你觉得显而易见，也要先说明、再动手。

用户明确说了「直接改」「按你说的做」「执行」时，视为方案已确认，可以动手。

---

## 🚫 硬性约束

### 1. 未经用户明确同意，绝不发真实邮件

这是本项目最高优先级的规则，用户已多次强调。

**不要碰**：`/send`、`/send?force=1`、`/send?type=*`，以及任何会走到 `sendMail()` 的路径。

**验证一律用这些无副作用的手段**：

| 手段 | 作用 | 会发信吗 |
|---|---|---|
| `npm run preview` | 本地渲染四种报告到 `test/*.html` | 否 |
| `GET /health` | 配置、授权状态、今天该发几封 | 否 |
| `GET /db` | D1 里有什么、覆盖到哪天 | 否 |
| `GET /verify` | 走生产取数路径渲染三种报告，只回摘要 | 否 |
| `GET /preview?type=` | 用真实 Oura 数据渲染 HTML | 否 |
| `GET /backfill` | 回补历史到 D1 | 否 |
| `GET /log` | 查已发记录 | 否 |

部署完**不要**「顺手发一封试试」。只有用户明确说「发一条」「试发」时才调 `/send`。

### 2. 改 D1 表结构必须走 migration

不要用 `d1 execute --command "ALTER TABLE ..."` 直接改线上库——本地和远程会不一致，下次部署就报错。

```bash
# 1. 新增 migrations/000N_描述.sql
# 2. 应用
npx wrangler d1 migrations apply oura-db --remote
```

### 3. 热区（today-1 / today）永远不入库

`src/store.js` 的冷热分离是刻意设计，不要「顺手把今天也缓存起来」。

早上 9 点时今天才刚开始（活动只有几十步），昨天的数据也可能还没从手机同步到 Oura 云。缓存它们会把脏数据永久写进库，之后所有周报月报都跟着错。入库边界固定在 `today-2`。

### 4. 邮件 HTML 只能用老式 HTML

邮件客户端（尤其 QQ 邮箱、Outlook）不认现代 CSS。改 `email.js` / `email-period.js` / `ui.js` 时：

- **零 SVG**、**零 `<style>` 标签**、**零 flex / grid / CSS 变量**
- 全 `table` 布局 + **全部内联样式**
- 带百分比宽度的 table 必须加 `table-layout:fixed`，否则内容会把列撑开
- 限宽用**外层 `div`** 包 600px，不要给 `table` 设 `max-width`（不随视口收缩）
- 改完必须 `npm run preview` 在浏览器里看一眼，不要只看代码

### 5. cron 只认 UTC

北京 09:00 = UTC 01:00 = `0 1 * * *`。改 `wrangler.toml` 的 `[triggers]` 时别写北京时间。

### 6. 核心端点与可选端点不能混

`src/oura.js` 里 `CORE` 只有 4 个：`daily_sleep`、`daily_readiness`、`daily_activity`、`sleep`。只有这 4 个全被 401/403 才判定令牌失效并告警。

新增端点默认标 `false`（可选），失败只记 warning 并跳过该指标。**不要把可选端点加进 `CORE`**——一个指标缺权限不该毁掉整份日报。

### 7. 取数窗口必须往前多要一天

`src/oura.js` 的 `getOne()` 里统一 `start_date = start - 1 天`。Oura 的 `start_date` **不含当天**，不挪的话区间第一天的记录永远拿不到；`sleep` 端点更严重，会只剩当天的小睡（表现为「总睡眠 ↑6h48m」这种荒谬对比）。

改动取数逻辑后，已入库的脏数据不会自愈，要用 `/backfill?from=&to=&force=1` 重拉。

---

## 常用命令

```bash
# 本地渲染四种报告（日报/周报/月报/告警），输出到 test/*.html，不联网不发信
npm run preview

# 构建预检，不部署
npx wrangler deploy --dry-run

# 部署（立即覆盖线上，cron 立即生效）
npm run deploy

# 实时日志
npm run tail

# 语法检查（没有 lint 配置，用这个兜底）
node --check src/index.js

# D1
npx wrangler d1 migrations apply oura-db --remote
npx wrangler d1 execute oura-db --remote --command "SELECT * FROM sync_day ORDER BY day DESC LIMIT 5;"

# 改密钥
npx wrangler secret put RESEND_API_KEY
```

## 线上验证（不发信）

`DEBUG_KEY` 在本地 `.dev.vars`（已 gitignore），线上用 `wrangler secret put DEBUG_KEY` 设置，两边必须一致。

```bash
BASE=https://oura-daily.your-domain.com
KEY=$(grep DEBUG_KEY .dev.vars | cut -d= -f2-)

curl -s "$BASE/health"
curl -s "$BASE/db?key=$KEY"
curl -s "$BASE/verify?kinds=daily,weekly,monthly&key=$KEY"
curl -s "$BASE/preview?type=weekly&key=$KEY"
curl -s "$BASE/log?key=$KEY"
```

`/verify` 会顺带把缺失日期补进库（不发信），是验证「库数据组装出来和实时拉取一致」的主要手段。

---

## 代码结构

| 文件 | 职责 | 改动频率 |
|---|---|---|
| `src/index.js` | Worker 入口：`scheduled` + 全部 HTTP 路由 + `collectRaw()` 取数编排 | 高 |
| `src/store.js` | D1 读写：`readRange` / `missingDays` / `toRanges` / `saveRange` / `dbStatus` | 中 |
| `src/auth.js` | OAuth2 授权码流程、令牌刷新与轮换（存 KV） | 低 |
| `src/oura.js` | 10 个端点并发取数、超 30 天切片、核心/可选判定 | 中 |
| `src/report.js` | 日报：数据整理、7 日趋势、较前一日对比（`cmp`）、规则化建议 | 中 |
| `src/period.js` | 周报/月报：区间计算、聚合、环比、亮点、建议 | 中 |
| `src/delta.js` | 日报变化标记：`change` / `deltaTag` / `deltaText`，格式化规则与配色都在这 | 中 |
| `src/email.js` | 日报 HTML 渲染 | 高 |
| `src/email-period.js` | 周报/月报 HTML 渲染 + 无数据短说明 | 高 |
| `src/ui.js` | 邮件 UI 基础件：`card` / `sectionTitle` / `metricGrid` / `metricCell` / `bulletList` / `noticeBar` / `shell` / `dur0` / 信件体骨架 `letterHead` / `metaRow` / `signoffRow`（三份报告共用） | 高 |
| `src/demo.js` | 演示数据，本地预览用 | 低 |
| `migrations/*.sql` | D1 建表与变更 | 低 |
| `test/preview.mjs` | 本地渲染脚本 | 低 |

## 数据流

```
cron(UTC 01:00)
  → planKinds(today)              今天该发哪几封
  → collectRaw()                  先查 D1，只对缺口 + 热区回源 Oura
  → buildPayload / buildPeriodPayload   聚合成报告数据结构
  → renderEmail / renderPeriodEmail     渲染 HTML
  → sendMail()                    逐个收件人独立发 Resend
  → recordSend()                  写 KV log:*
```

`runReports()` 只调一次 `collectRaw()`，日报/周报/月报共用同一份 `raw`。加新报告类型时不要另起一次取数。

---

## 关键约定

**日期口径**（`report.js` / `period.js`，这里最容易错）

| 数据 | 取哪一天 | 原因 |
|---|---|---|
| 睡眠评分、睡眠明细、准备度 | 报告日当天 | Oura 的 `day` 是「睡眠结束日」，当天 = 昨夜 |
| 活动评分、步数、消耗、久坐、压力 | 报告日**前一天** | 早上 9 点今天才刚开始，取今天只有几十步 |

**配额**：免费版单次 invocation 只有 50 个，**D1 查询和 `fetch` 共用这个池子**。`db.batch()` 无论多少语句只算 1 个，这是选 D1 不选 KV 的原因。加功能时留意别把配额吃满。

**变化标记**（`delta.js`）：时间类写绝对差（`+29m`），三大评分写分数差（`+13`，`fmt: 'points'`），其余得分类写百分比（`+5.7%`），计数类写绝对差（`+2,745`）。前一日缺数据时什么都不显示，**不许按 0 算** —— 那会把「没戴戒指」画成暴跌。

算对比要用 `sleepOn()`（严格按 `day` 匹配），不能用 `mainSleep()` —— 后者有「退到最近一条」的兜底，用它算前一日会拿到更早的数据，生成假变化。

压力与抗压水平取 `actDay`（完整日），不取报告日。早上 9 点取今天只有几个小时，跟「昨日」卡片标题也对不上。

**存储分工**：KV 只存令牌（`oauth`）、发送日志（`log:*`）、防抖（`last_send`）；历史健康数据全在 D1。不要把健康数据写 KV。

**D1 存整条原始 JSON**，不拆宽表。日报的 `detail` 是整条 sleep 对象直传渲染层的，拆宽表漏一个字段就会出现「日报正常、从库读少一块」的隐性 bug。

**发送顺序**：`runReports()` 里日报永远排最前。万一 CPU 超限，至少当天那封已经落地。

**防重复发送**：`/send` 有内存锁 + KV 90 秒防抖。改这块时别把两道都去掉。

---

## 改完代码的检查清单

（`$BASE` / `$KEY` 见上一节）

1. `node --check src/index.js`（没有 lint，靠这个兜底）
2. `npm run preview` —— 打开 `test/preview.html`、`weekly.html`、`monthly.html` 看版式
3. `npx wrangler deploy --dry-run` —— 确认绑定和构建没问题
4. `npm run deploy`
5. `curl $BASE/health` —— `checks` 全为 `true`
6. `curl $BASE/verify?key=$KEY` —— 三种报告都能渲染，数值合理
7. `curl $BASE/log?key=$KEY` —— 确认没有意外多发

这 7 步全程都不要调 `/send`。

## 排错入口

按顺序走：

| 顺序 | 接口 | 看什么 |
|---|---|---|
| 1 | `/health` | 配置齐不齐、授权状态、`d1_bound`、今天该发几封 |
| 2 | `/envcheck` | 密钥是否混入换行/空格/引号 |
| 3 | `/probe` | 10 个端点各自 HTTP 状态 |
| 4 | `/tokeninfo` | 令牌结构、过期时间 |
| 5 | `/refresh` | 能不能换新令牌 |
| 6 | `/db` | 库里覆盖到哪天、有没有缺口 |

全部 401 且 `/refresh` 报 `invalid_request` → refresh_token 已在 Oura 侧作废，访问 `/oauth/start` 重新授权。

## 已知坑

| 坑 | 说明 |
|---|---|
| `vO2_max` 大小写 | Oura 路径是小写 `v` + 大写 `O`，写成 `vo2_max` 返回 404 |
| Resend 中文显示名 | `FROM_EMAIL` 的中文显示名**必须加引号**，否则解析 `from` 头失败，退回测试模式报「只能发给注册邮箱」 |
| QQ 邮箱进垃圾箱 | 新发件域常见，需在邮箱里标记「非垃圾邮件」 |
| `daily_resilience` 401 | 缺 `stress` scope，属预期，不影响日报 |
| `dur(0)` 显示 `—` | 用 `dur0()` 处理 0 值，别用 `dur()` |
| 390px 截图假性裁切 | macOS 窗口最小宽约 500px，窄于此的截图不可信 |
