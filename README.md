# Oura 健康日报 / 周报 / 月报 · Cloudflare Worker + 邮件推送

每天早上 **09:00（北京时间）**，Cloudflare 上的 Worker 自动拉取 Oura 数据，  
渲染成一封完整的 HTML 邮件发到你邮箱。不依赖电脑开机，全部在免费额度内。

在日报之外还会自动加发两种汇总：

| 报告 | 发送时间 | 统计区间 | 内容 |
|---|---|---|---|
| 周报 | 每周一 09:00 | 上一个完整自然周（周一–周日） | 环比对比表 + 亮点异常 + 下周建议 |
| 月报 | 每月 1 号 09:00 | 上一个完整自然月 | 环比对比表 + 亮点异常 + 下月建议 |

周一收到日报 + 周报两封；1 号收到日报 + 月报两封；**1 号恰好是周一时三封都发**（日报 + 周报 + 月报）。  
调度只用了一个 cron，发哪几封由代码在运行时判断，不需要改配置。

## 日报里的变化标记

每项指标的数值后面跟着一段小字，比如 `↑5.7%`、`↓31m`，表示**较前一日**的变化：

| 写法 | 适用 | 例 |
|---|---|---|
| 分数差 | 顶部三大评分（睡眠/准备度/活动） | `↓13` |
| 百分比 | 其余得分类（效率、静息心率得分、HRV 平衡等） | `↑5.7%` |
| 绝对差 | 时长类 | `↓31m` |
| 绝对差 | 步数、心率、消耗这类计数 | `↑2,745` |

颜色：绿 = 变好，红 = 变差，灰 = 持平或方向不分好坏（体温偏差）。  
方向按指标本身定 —— 入睡耗时、最低心率、久坐、呼吸紊乱是**降了才好**。

覆盖 27 项，三个卡片全部都有：

| 卡片 | 指标 |
|---|---|
| 顶部三大数字 | 睡眠评分、准备度、活动评分 |
| 昨夜睡眠 | 总睡眠、在床时间、深睡、REM、睡眠效率、入睡耗时、平均心率、平均 HRV、最低心率、呼吸频率 |
| 身体状态 | 静息心率得分、HRV 平衡、体温偏差、恢复指数、血氧、呼吸紊乱、心血管年龄、VO₂ Max |
| 活动与压力 | 步数、活动消耗、总消耗、久坐、高压力时长、恢复时长 |

前一日没数据就**什么都不显示**（留空），绝不按 0 算——否则「没戴戒指」会画成暴跌。

> 睡眠和活动的基准日不是同一天：睡眠比「前一夜」，活动（含压力、抗压）比「前一日」。因为活动数据整体滞后一天，这是口径正确的做法，不是 bug。

---

## ⚠️ 关于认证方式（重要）

Oura 的**个人访问令牌（Personal Access Token）已于 2025 年 12 月废弃**，  
官方文档原话：*"personal access tokens were deprecated in December 2025 and are no longer available for use."*

所以现在唯一可行的是 **OAuth2 授权码流程**：

- 在 Oura 开发者门户注册一个 API Application，拿到 `client_id` / `client_secret`
- 在 Worker 上完成**一次性**授权，拿到 `refresh_token`
- `refresh_token` 存进 Workers KV，之后每天自动续期，不用再管

你之前在旧页面看到的「迁移到 developer.ouraring.com」提示，就是这个变化。

---

## 目录结构

```
oura-worker/
├── wrangler.toml.example  配置模板，上传这一份
├── wrangler.toml          本地副本（含真实邮箱与 id），已被 .gitignore 排除
├── package.json
├── migrations/
│   └── 0001_init.sql    D1 建表：原始记录缓存
├── src/
│   ├── index.js         Worker 入口：scheduled + fetch（含 OAuth 路由、调度决策、取数编排）
│   ├── auth.js          OAuth2 授权、令牌刷新、KV 存取
│   ├── store.js         D1 历史缓存：按区间读取、缺口检测、写回
│   ├── oura.js          Oura API v2 取数（超过 30 天自动切片）
│   ├── report.js        日报：数据整理、较前一日对比 + 规则化建议
│   ├── period.js        周报/月报：区间计算、聚合、环比、亮点、建议
│   ├── ui.js            邮件 UI 基础件（日报与周月报共用）
│   ├── delta.js         日报的变化标记（较前一日 + 较 7 日均值）
│   ├── email.js         日报 HTML 渲染（table 布局、全内联、无 SVG）
│   ├── email-period.js  周报/月报 HTML 渲染
│   └── demo.js          演示数据
├── test/
│   ├── preview.mjs      渲染 preview / weekly / monthly / alert
│   └── *.html           产物，浏览器直接打开看效果
├── README.md            部署手册（本文）
├── ARCHITECTURE.md      技术方案与运维手册
├── AGENTS.md            给 AI 编码助手的工作说明与硬性约束
└── LICENSE              MIT
```

---

## 第 0 步：前置条件

| 项             | 要求                                      |
| ------------- | --------------------------------------- |
| Node.js       | ≥ 18（本机已有 22.22.2）                      |
| Cloudflare 账号 | 免费版即可，需要 Workers 权限                     |
| Oura 会员       | API 需要 **Oura Membership 有效**，过期会返回 403 |
| Resend 账号     | 免费版 3000 封/月                            |

依赖已装好（wrangler 4.152.0）。换机器执行一次 `npm install`。

**先复制配置模板**——仓库里不含真实的 `wrangler.toml`（里面会填你的邮箱和 KV/D1 id），只上传 `wrangler.toml.example`：

```bash
cp wrangler.toml.example wrangler.toml
```

后面几步填的都是这份本地副本，它已被 `.gitignore` 排除，不会被提交。

---

## 第 1 步：建 KV 命名空间和 D1 数据库

两个都要建：**KV 存 OAuth 令牌**，**D1 存历史数据**（周报月报从库里读，不再重复回源）。

### KV（存令牌）

```bash
npx wrangler kv namespace create OURA_KV
```

输出类似：

```
[[kv_namespaces]]
binding = "OURA_KV"
id = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

把那个 **id** 复制出来，填到 `wrangler.toml`（注意 `binding` 要保持 `KV`，不是 `OURA_KV`）：

```toml
[[kv_namespaces]]
binding = "KV"
id = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

### D1（存历史数据）

```bash
npx wrangler d1 create oura-db
```

输出类似：

```
[[d1_databases]]
binding = "oura_db"
database_name = "oura-db"
database_id = "00000000-0000-0000-0000-000000000000"
```

填到 `wrangler.toml`（`binding` 改成 `DB`，和代码里的 `env.DB` 对应）：

```toml
[[d1_databases]]
binding = "DB"
database_name = "oura-db"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"
```

填好之后执行建表：

```bash
npx wrangler d1 migrations apply oura-db --remote
```

> **顺序不能反**：`d1 create` → 填 `wrangler.toml` → `migrations apply`。库没建好就部署，第 4 步会报找不到 D1。
>
> 建好后不需要手动回补——第一次运行会自动拉最近几天，历史缺口用 `/backfill` 补（见「历史数据缓存」章节）。

---

## 第 2 步：登录 Cloudflare

```bash
npx wrangler login
```

浏览器点 **Allow**。验证：

```bash
npx wrangler whoami
```

---

## 第 3 步：先写两个密钥

```bash
npx wrangler secret put RESEND_API_KEY
```

粘贴 Resend 的 `re_` 开头的 key（没有的话先去 <https://resend.com/signup> 注册，  
API Keys → Create，Permission 选 **Sending access**）。

```bash
npx wrangler secret put DEBUG_KEY
```

自己编一串足够长的随机串，比如 `your-debug-key-a1b2c3`。这个口令同时用于：调试接口鉴权、OAuth 的 state 校验。

---

## 第 4 步：填收件邮箱并部署

改 `wrangler.toml`：

```toml
TO_EMAIL = "你的邮箱@example.com"
FROM_EMAIL = "Jarvis (Oura Clone) <onboarding@resend.dev>"
```

> 第一版用 Resend 测试发件域，**不用配 DNS**，但只能发到你自己注册 Resend 的那个邮箱。

时间已经在配置里：

```toml
[triggers]
crons = ["0 1 * * *"]   # 01:00 UTC = 北京 09:00
```

部署：

```bash
npx wrangler deploy
```

输出里会有一行 `https://oura-daily.<你的子域>.workers.dev`，**记下这个地址**，下一步要用。

---

## 第 5 步：在 Oura 开发者门户建应用

1. 打开 <https://developer.ouraring.com/>，用 Oura 账号登录
2. 创建新 Application（旧的 `cloud.ouraring.com/oauth/applications` 只能编辑老应用）
3. 填表：

| 字段               | 填什么                                                            |
| ---------------- | -------------------------------------------------------------- |
| Application name | `Oura Daily Mail`（随意）                                          |
| Redirect URI     | `https://oura-daily.<你的子域>.workers.dev/oauth/callback`         |
| Scopes           | `daily`、`personal`、`heartrate`、`spo2`、`heart_health`、`workout` |

> **Redirect URI 必须一字不差**，包括协议、路径，末尾不能多斜杠。  
> 填错会在回调时报 `redirect_uri` 不匹配。

1. 创建后拿到 **Client ID** 和 **Client Secret**

---

## 第 6 步：写入 Oura 应用凭据

```bash
npx wrangler secret put OURA_CLIENT_ID
npx wrangler secret put OURA_CLIENT_SECRET
```

> secret 更新后**立即生效**，不需要重新部署。

顺便把公开地址填上，这样告警邮件里的「去授权」按钮才可点：

```toml
PUBLIC_ORIGIN = "https://oura-daily.<你的子域>.workers.dev"
```

```bash
npx wrangler deploy
```

---

## 第 7 步：完成一次性授权

浏览器打开（把 `你的DEBUG_KEY` 换成第 3 步设的）：

```
https://oura-daily.<你的子域>.workers.dev/oauth/start?key=你的DEBUG_KEY
```

流程：

1. 自动跳转到 Oura 授权页
2. 用 Oura 账号登录，勾选同意共享数据
3. 点 **Accept**
4. 跳回 Worker，显示 **✅ 授权成功**

这时 `refresh_token` 已经存进 KV 了。

**确认一下：**

```bash
curl -s https://oura-daily.<你的子域>.workers.dev/health | python3 -m json.tool
```

期望看到：

```json
"checks": {
  "oura_client_id": true,
  "oura_client_secret": true,
  "resend_key": true,
  "debug_key": true,
  "kv_bound": true
},
"oauth": { "authorized": true, "scope": "daily personal ..." }
```

---

## 第 8 步：试发一封

```bash
curl -s "https://oura-daily.<你的子域>.workers.dev/send?key=你的DEBUG_KEY" | python3 -m json.tool
```

返回 `"step": "sent"` 和 `"ok": true` 就成功了。去邮箱确认（**先看垃圾箱**）。

想看邮件长什么样但不发信：

```
https://oura-daily.<你的子域>.workers.dev/preview?key=你的DEBUG_KEY&demo=1
```

去掉 `&demo=1` 就是用你真实的 Oura 数据渲染。

**试发周报 / 月报**（不影响定时任务，只发这一次）：

```bash
# 周报
curl -s "https://oura-daily.<你的子域>.workers.dev/send?key=你的DEBUG_KEY&type=weekly&force=1" | python3 -m json.tool

# 月报
curl -s "https://oura-daily.<你的子域>.workers.dev/send?key=你的DEBUG_KEY&type=monthly&force=1" | python3 -m json.tool
```

只想看版式不发信，把 `/send` 换成 `/preview` 并去掉 `&force=1`：

```
https://oura-daily.<你的子域>.workers.dev/preview?key=你的DEBUG_KEY&type=weekly
https://oura-daily.<你的子域>.workers.dev/preview?key=你的DEBUG_KEY&type=monthly
```

刚接入时历史数据不足，周报/月报的「上期」列会是 `—`，顶部有说明——这是正常的，数据积累后自动恢复。

---

## 第 9 步：确认定时任务

```bash
npx wrangler deployments list
```

或 Cloudflare 控制台 → Workers & Pages → `oura-daily` → **Triggers**，  
应该能看到 `Cron: 0 1 * * *`。

看实时日志：

```bash
npx wrangler tail
```

第二天 09:00 会出现 `[oura-report] {"kinds":["daily"],"step":"sent",...}`。

`kinds` 就是当天实际发出的报告类型：`["daily"]` / `["daily","weekly"]` / `["daily","monthly"]`。  
不确定某天该发什么，访问 `/health` 看 `plan.today_kinds`。

---

## 第 10 步（可选）：换成自己的域名发件

测试域有进垃圾箱的风险，稳定后建议换成自有域名：

1. Resend 后台 → **Domains** → **Add Domain**，填 `mail.你的域名.com`
2. Resend 给出 3–4 条 DNS 记录（MX / SPF / DKIM）
3. 到 Cloudflare DNS 逐条添加，**代理状态必须是「仅 DNS」**（灰色云朵）
4. 回 Resend 点 **Verify**，等状态变成 Verified
5. 改 `wrangler.toml`：

```toml
FROM_EMAIL = "\"Jarvis (Oura Clone)\" <daily@mail.你的域名.com>"
```

⚠️ **显示名含空格或中文时必须用引号包起来**。写 `Jarvis (Oura Clone) <daily@...>`（不加引号）会让 Resend 解析 `from` 头失败，直接退回测试模式，报
`You can only send testing emails to your own email address`——看起来像是域名没验证好，其实是显示名的锅。纯英文显示名不加引号没问题。

6. `npx wrangler deploy`
7. 用 `/send?key=...&force=1` 发一封，看返回的 `delivered` 是否包含全部收件人

**收件人**：`TO_EMAIL` 支持多个地址，用逗号分隔。代码会**逐个地址独立发送**，某个地址失败不影响其他地址，返回里 `delivered` / `failed` 分开列出。

---

## 排错表

| 现象                      | 原因                     | 处理                                                  |
| ----------------------- | ---------------------- | --------------------------------------------------- |
| 授权页报 `invalid_client`   | client_id 写错或应用未激活     | 重新 `wrangler secret put OURA_CLIENT_ID`             |
| 回调页报 `redirect_uri` 不匹配 | 应用里登记的 URI 与实际不一致      | 到 Oura 应用设置改成 `https://你的域名/oauth/callback`，一字符都不能差 |
| 回调页报 `invalid_grant`    | 授权码过期（只有 10 分钟）或已用过    | 重新访问 `/oauth/start`                                 |
| 收到「需要重新授权 Oura」         | refresh_token 失效或授权被撤销 | 点邮件里的按钮重新授权一次                                       |
| 刚授权过却还提示要授权             | KV 绑定 id 不对，写入没生效      | 检查 `wrangler.toml` 的 KV id，重新部署后授权                  |
| 收到「Oura 授权失败」           | 403，会员过期或缺 scope       | 续费会员；或到应用里补上 `daily` `personal` 等 scope 后重新授权       |
| 收到「昨夜数据未同步」             | Oura 云上没有当天数据          | 打开手机 Oura App 同步一次                                  |
| 完全没收到邮件                 | Resend 报错              | `npx wrangler tail` 看日志，或看 `/send` 返回的 error        |
| 周报/月报的「上期」列全是 —       | 上期有效数据不足 3 天          | 正常，顶部有提示；数据积累后自动恢复                                  |
| 收到「月报 · 9月 无数据」        | 那个月 Oura 上确实没有任何记录    | 正常，短说明里已写原因                                         |
| `/health` 里 `d1_bound: false` | `wrangler.toml` 缺 `[[d1_databases]]`，或改完没重新部署 | 检查 `binding` 名是否为 `DB`（不是 `oura_db`），再 `deploy` |
| 部署报找不到 D1 数据库 | 库还没建，或 `database_id` 填错 | `npx wrangler d1 list` 核对 id |
| `/backfill` 报「一次最多 92 天」 | 跨度超限 | 用 `from`/`to` 分批，每次 ≤ 92 天 |
| `/backfill` 报「to 不能晚于」 | 想把今天或昨天入库 | 有意限制，热区永不入库，避免缓存未同步完的数据 |
| 周报「上期」列还是空，但明明有数据 | 上期那几天不在库里 | `/backfill?from=&to=` 补那段，再 `/db` 确认 `synced_range` 覆盖到 |
| 某天没收到周报                 | 那天不是周一                | `/health` 的 `plan.today_kinds` 可确认当天该发什么              |
| 邮件进垃圾箱                  | 测试发件域信誉低               | 做第 10 步；或把发件人加进通讯录                                  |
| `/preview` 返回 403       | 没带 key 或 key 不对        | URL 加 `?key=你的DEBUG_KEY`                            |
| 时间不对                    | Cron 是 UTC             | 北京 09:00 = `0 1 * * *`                              |

---

## 接口一览

| 路径                | 作用                   | 需要 key |
| ----------------- | -------------------- | ------ |
| `/health`         | 健康检查：配置是否齐全、授权状态     | 否      |
| `/oauth/start`    | 发起 Oura 授权           | 是      |
| `/oauth/callback` | Oura 回调，换取令牌并立即验证取数   | —      |
| `/probe`          | 逐端点诊断：10 个端点各自 HTTP 状态 | 是      |
| `/tokeninfo`      | 令牌结构：长度、JWT 声明、记录的过期时间 | 是      |
| `/refresh`        | 依次尝试三种刷新写法，定位认证问题    | 是      |
| `/envcheck`       | 检查密钥是否混入换行/空格/引号      | 是      |
| `/revoke`         | 清空 KV 里的令牌，回到未授权状态    | 是      |
| `/preview?demo=1` | 用演示数据渲染邮件 HTML       | 是      |
| `/preview`        | 用真实 Oura 数据渲染邮件 HTML | 是      |
| `/preview?type=`  | `daily`（默认）/ `weekly` / `monthly` | 是      |
| `/text`           | 纯文本版本，支持 `type=`      | 是      |
| `/send`           | 立即执行一次并真实发信          | 是      |
| `/send?type=`     | `auto`（按日期）/ `daily` / `weekly` / `monthly` / `all` | 是      |
| `/log`            | 发送历史：时间、收件人、delivered/failed、Resend id | 是      |
| `/fields?ep=`     | 某端点的字段类型结构（不含数值），判断字段缺失原因 | 是      |
| `/resend/domains` | 查 Resend 域名状态（sending-only key 会 401，正常） | 是      |
| `/db`             | D1 缓存状态：行数、数据日期范围、已同步天数、各端点条数 | 是      |
| `/verify`         | 走和定时任务相同的取数路径，渲染三种报告并只回摘要，**不发信**；`kinds=daily` 时附带 `cmp`（每项 cur/prev）和 `sleep_records`/`act_days`（raw 里各天的记录），用来排查对比数据 | 是      |
| `/backfill`       | 回补历史到 D1：`?days=30` 或 `?from=&to=`，加 `&force=1` 无视已同步标记重拉（修脏数据用），一次最多 92 天，**不发信** | 是      |

**排查顺序**：`/health`（配置齐不齐）→ `/envcheck`（密钥干净不干净）→ `/probe`（哪个端点通）→ `/tokeninfo`（令牌什么状态）→ `/refresh`（能不能换新的）。全部 401 且 `/refresh` 报 `invalid_request`，说明 refresh_token 在 Oura 侧已作废，直接访问 `/oauth/start` 重新授权。

---

## 历史数据缓存（D1）

### 为什么需要

周报要跨 2 周、月报要跨 2 个月，`needStart()` 会往前算到最远的对比起点。原来的做法是**每次都把这整段区间重新拉一遍**，带来三个问题：

1. **重复拉取**：月报要 62 天，其中 60 天上次已经拉过了
2. **撞配额上限**：免费版 Worker 单次 invocation 只有 **50 个**配额（D1 查询和 fetch 共用这个池子）。62 天 = 3 个 30 天切片 × 10 端点 = 30 个，已经很紧；想做季报（40 个）勉强，**做年报（130 个）直接失败**
3. **数据不留存**：Oura 会员中断或令牌失效，历史就取不回来；1 号那天出问题，当月月报永久丢失

建库后，取数成本与统计周期**解耦**：查 62 天和查 365 天都是 1 次 D1 batch（`db.batch()` 无论含多少语句只算 1 个配额）。

### 为什么是 D1 不是 KV

KV 只能逐个 key `get`，查 62 天要 62 次读，比回源还贵。D1 一次 `batch` 就能把整段区间取回来。

### 冷热分离

| 区域 | 范围 | 处理 |
|---|---|---|
| 热区 | `today-1`、`today` | **每次实时回源，永不入库** |
| 冷区 | `<= today-2` | 先查 D1，缺哪天才回源，拉到后写回 |

热区不入库是有意的：早上 9 点时今天才刚开始（活动只有几十步），昨天的数据也可能还没同步完。缓存它们会把脏数据永久写进库，之后所有周报月报都跟着错。

### 什么时候读库、什么时候写库

**每次运行都读一次库，只在发现缺口时才写库。某天的数据在 T+2 那天入库。**

以 10-27 为起点（库里已覆盖到 10-25）：

| 运行时刻 | 读库区间 | 发现缺口 | 回源 Oura | 写入库 |
|---|---|---|---|---|
| 10-27 | 08-01~10-25 | 无 | 10-26~10-27（2 天） | 无 |
| 10-28 | 10-21~10-26 | **10-26** | 10-26~10-28（3 天） | 10-26 |
| 10-29 | 10-22~10-27 | **10-27** | 10-27~10-29（3 天） | 10-27 |
| 10-30 | 10-23~10-28 | **10-28** | 10-28~10-30（3 天） | 10-28 |

稳态下每天：**读库 1 次 batch + 回源 3 天 + 写 1 天**。

缺口区间和热区会被 `mergeRanges()` 合并，所以补缺口不会多打一轮请求。

**为什么是 T+2 不是 T+1**：`today-1` 也算热区。戒指 → 手机 → Oura 云可能还没同步完，缓存了不完整的数据就是永久的脏数据。

### 周报月报不会多查

它们需要的历史全在库里。`runReports()` 只调一次 `collectRaw()`，三种报告共用同一份 `raw`：

| 日期 | 报告 | 需要的数据跨度 | 从 D1 读 | 回源 Oura | 请求数 |
|---|---|---|---|---|---|
| 周三 | 日报 | 8 天 | 8 天 | 3 天 | 10 |
| 周一 | 日报 + 周报 | 15 天 | 15 天 | 3 天 | 10 |
| 1 号 | 日报 + 月报 | 62 天 | 62 天 | 3 天 | 10 |
| 1 号逢周一 | 日报 + 周报 + 月报 | 62 天 | 62 天 | 3 天 | **10** |

请求数恒为 10，是因为 Oura 端点接受 `start_date`/`end_date`，一次返回区间内所有记录；只有超过 30 天才需要切片。

**发三封也只取一次数**：`collectRaw()` 只调一遍，三份报告共用同一份 `raw`，不会各查一遍 Oura。

### 各入口的读写行为

| 入口 | 读库 | 写库 | 回源 |
|---|---|---|---|
| 定时任务 09:00 | ✓ 1 次 | 有缺口才写 | 热区 + 冷区缺口 |
| `/send` | ✓ | 有缺口才写 | 同上 |
| `/verify` | ✓ | 有缺口才写 | 同上 |
| `/backfill` | ✓ 先查缺口 | ✓ 总是写 | 指定区间的缺口 |
| `/db` | ✓ 只读统计 | ✗ | ✗ |
| `/preview` | ✗ | ✗ | **全量实时拉，完全绕过库** |

`/preview` 是唯一不碰库的接口，看到的永远是 Oura 实时数据，适合做对照。

### 表结构

```sql
CREATE TABLE oura_raw (
  endpoint   TEXT    NOT NULL,   -- daily_sleep / sleep / daily_readiness / personal_info ...
  day        TEXT    NOT NULL,   -- 归属日期；personal_info 这类无日期的存 'meta'
  id         TEXT    NOT NULL,   -- Oura 记录 id（sleep 一天可能多条：long_sleep + nap）
  payload    TEXT    NOT NULL,   -- 原始 JSON 整条
  fetched_at INTEGER NOT NULL,   -- 拉取时间戳（毫秒）
  PRIMARY KEY (endpoint, id)
);

CREATE INDEX idx_oura_raw_day ON oura_raw (endpoint, day);

CREATE TABLE sync_day (
  day        TEXT PRIMARY KEY,   -- 已完整同步过的日期
  rows       INTEGER NOT NULL,   -- 那天拉到几条记录（0 = 查过了，确实没数据）
  fetched_at INTEGER NOT NULL
);
```

| 字段 | 说明 |
|---|---|
| `endpoint` | 数据来自哪个 Oura 端点，还原时按它分组拼回 `raw.daily_sleep = [...]` |
| `day` | 记录归属日期，按区间查询靠它。`personal_info` 没有日期，存 `'meta'`（字典序在日期之后，不会被 `BETWEEN` 命中） |
| `id` | **主键是 `(endpoint, id)` 而不是 `(endpoint, day)`**，因为 sleep 一天可能多条（主睡眠 + 小睡） |
| `payload` | 整条原始 JSON |
| `fetched_at` | 这条数据是什么时候拿的 |

`payload` 存整条原始 JSON 而不拆宽表，三个理由：

1. **零字段遗漏**：日报的 sleep detail 是整条对象直接传给渲染层的，拆宽表漏一个字段就会出现「日报正常、从库读少一块」的隐性 bug
2. **加指标不用改表**：以后想加呼吸频率、入睡时间点，数据已经在库里了
3. **Oura 历史补不回来**：删掉原始粒度数据就真没了

代价是不能直接 SQL 聚合——但本来就在 JS 里聚合，D1 只当持久化缓存。

`sync_day` 里 `rows = 0` 也要落一行：表示「这天查过了，确实没戴戒指」。不记的话，空日期会被永远判定为「缺失」，每天重复回源。

### 数据量与体积

`sleep` 端点一条记录约 2.9 KB / 32 字段，其中约 2/3 是 `movement_30_sec` 和 `sleep_phase_30_sec` 这两个 30 秒粒度的长字符串（报告不用它们）。`daily_*` 端点每条约 240 字节。

一年约 **2.4 MB**，占免费额度 5 GB 的 0.05%。即使剥掉那两个大字段能省 60%，也没必要——省下的空间换不回已删的原始粒度数据。

### 建库与回补

```bash
# 建库（只需一次）
npx wrangler d1 create oura-db          # 把输出的 database_id 填进 wrangler.toml
npx wrangler d1 migrations apply oura-db --remote

# 回补最近 30 天（只写库，不发信）
curl "https://oura-daily.your-domain.com/backfill?days=30&key=你的DEBUG_KEY"

# 指定区间，一次最多 92 天（3 个切片 × 10 端点 = 30 配额，留余量）
curl "https://oura-daily.your-domain.com/backfill?from=2026-08-01&to=2026-09-30&key=你的DEBUG_KEY"

# 看库状态
curl "https://oura-daily.your-domain.com/db?key=你的DEBUG_KEY"
```

月报的环比要往前 **62 天**，所以只回补 30 天的话，第一次发月报仍会现拉剩下的部分（拉完就进库，只有一次）。要一步到位就回补 62 天以上。

### 验证不发送

`/verify` 走的是和定时任务**完全相同**的取数函数 `collectRaw()`，把三种报告都渲染一遍，只返回摘要指标。用它可以在不打扰收件箱的前提下确认库数据组装正确。

---

## 令牌是怎么续的

| 令牌            | 有效期      | 存放位置 | 处理方式                |
| ------------- | -------- | ---- | ------------------- |
| access_token  | 约 24 小时  | KV   | 每次运行前检查，过期自动刷新      |
| refresh_token | 长期，直到被撤销 | KV   | 刷新时若 Oura 返回新的，自动覆盖 |

KV 里存的是 `oauth` 这一个 key，内容形如：

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1793060400000,
  "scope": "daily personal heartrate spo2 heart_health workout",
  "updated_at": "2026-10-26T08:00:00.000Z"
}
```

清掉授权记录重来：Cloudflare 控制台 → Workers KV → `OURA_KV` → 删除 `oauth` 这个 key。

---

## 成本

| 项         | 用量              | 免费额度        | 结论  |
| --------- | --------------- | ----------- | --- |
| Worker 请求 | 每天 1 次定时 + 偶尔调试 | 100,000 / 天 | 0 元 |
| Cron 触发   | 1 条             | 免费版 3 条     | 0 元 |
| KV        | 1 个 key，每天几次读写  | 1000 写 / 天  | 0 元 |
| D1        | 每天写约 8 行、读 1 次 batch | 5 GB 存储 / 10 万行写 / 天 | 0 元 |
| Resend 邮件 | 每天 1 封，周一/1 号 2 封，1 号逢周一 3 封 | 3,000 / 月   | 0 元 |
| Oura 请求   | 每天固定 10 次（热区），冷区只在首次补 | 无明确限流      | 0 元 |

D1 的实际占用：一年约 3650 行、7 MB 左右，不到免费额度 5 GB 的 0.2%。

---

## 说明

- 报告里「静息心率得分」「HRV 平衡」是 Oura 的 0–100 贡献分，不是 bpm/ms；  
  真实心率与 HRV 在「昨夜睡眠」卡片里（平均心率 / 平均 HRV / 最低心率）。
- 邮件正文就是完整报告，没有外链，健康数据只存在于你的邮箱里。
- 数据未同步、授权失效时**也会发一封说明邮件**，不会静默失败。
- Oura 应用在获批前最多 10 个用户；你自己用完全够。

---

## License

[MIT](LICENSE) © 2026 chenxinchu

可自由使用、修改、分发，包括商用，保留版权声明即可。  
仓库里不含任何真实凭证与健康数据，克隆后按本文档填自己的 `wrangler.toml` 即可跑起来。
