// 历史数据缓存层：D1 里存 Oura 的原始记录，按区间读取，只回源缺失的日期。
//
// 为什么用 D1 而不是 KV：
//   D1 的 db.batch() 无论里面有多少条语句，都只算 1 次
//   「Queries per Worker invocation」；KV 只能逐个 key get。
//   查 62 天历史，D1 是 1 次，KV 是 62 次 —— 免费版每次 invocation 总共只有 50 个配额。
//
// 冷热分离：
//   热区（today-1、today）每次实时回源，不落库。早上 9 点时 today 的活动数据
//   只有几十步、today-1 也可能还没同步完，缓存它们会永久写进脏数据。
//   冷区（<= today-2）才从库里取，缺了才补。

import { addDays } from './report.js';

// personal_info 没有日期，单独用这个 day 值存，不会被日期范围查询命中
const META_DAY = 'meta';

export function dbReady(env) {
  return Boolean(env && env.DB);
}

// 每条记录的唯一标识：优先 Oura 自己的 id（sleep 一天可能多条：long_sleep + nap）
function rowId(it, endpoint, idx) {
  const id = it && (it.id || it.day);
  return id ? String(id) : `${endpoint}-${idx}`;
}

function rowDay(it, endpoint) {
  if (endpoint === 'personal_info') return META_DAY;
  return (it && it.day) || META_DAY;
}

function upsertRaw(env, endpoint, day, id, payload, now) {
  return env.DB.prepare(
    `INSERT INTO oura_raw (endpoint, day, id, payload, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(endpoint, id) DO UPDATE SET
       day = excluded.day,
       payload = excluded.payload,
       fetched_at = excluded.fetched_at`
  ).bind(endpoint, day, id, JSON.stringify(payload), now);
}

function upsertSync(env, day, rows, now) {
  return env.DB.prepare(
    `INSERT INTO sync_day (day, rows, fetched_at)
     VALUES (?1, ?2, ?3)
     ON CONFLICT(day) DO UPDATE SET
       rows = excluded.rows,
       fetched_at = excluded.fetched_at`
  ).bind(day, rows, now);
}

// 读一个区间：3 条 SQL 合成一个 batch，只占 1 个查询配额。
// 返回的 raw 与 fetchOura 的输出结构完全一致，上层无需感知数据来自库里还是接口。
export async function readRange(env, start, end) {
  const empty = { raw: {}, synced: new Set() };
  if (!dbReady(env)) return empty;

  try {
    const [rangeRes, metaRes, syncRes] = await env.DB.batch([
      env.DB.prepare(
        'SELECT endpoint, day, payload FROM oura_raw WHERE day >= ?1 AND day <= ?2 ORDER BY day'
      ).bind(start, end),
      env.DB.prepare('SELECT endpoint, payload FROM oura_raw WHERE day = ?1').bind(META_DAY),
      env.DB.prepare('SELECT day FROM sync_day WHERE day >= ?1 AND day <= ?2').bind(start, end),
    ]);

    const raw = {};
    const synced = new Set();

    for (const row of (rangeRes && rangeRes.results) || []) {
      let obj;
      try {
        obj = JSON.parse(row.payload);
      } catch {
        continue; // 坏行跳过，不要因为一行脏数据拖垮整份报告
      }
      if (!raw[row.endpoint]) raw[row.endpoint] = [];
      raw[row.endpoint].push(obj);
    }

    for (const row of (metaRes && metaRes.results) || []) {
      try {
        raw[row.endpoint] = JSON.parse(row.payload);
      } catch {
        /* ignore */
      }
    }

    for (const row of (syncRes && syncRes.results) || []) synced.add(row.day);

    return { raw, synced };
  } catch (e) {
    // 库出问题不能让日报挂掉：退回全量回源
    console.log('[d1-read-failed]', String((e && e.message) || e));
    return empty;
  }
}

// 区间内哪些天还没同步过
export function missingDays(synced, start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (!synced.has(d)) out.push(d);
  }
  return out;
}

// 把缺失日期压成最少的连续区间，供回源时按 30 天切片
export function toRanges(days) {
  const out = [];
  for (const d of days) {
    const last = out[out.length - 1];
    if (last && addDays(last[1], 1) === d) last[1] = d;
    else out.push([d, d]);
  }
  return out;
}

// 把拉到的原始记录写回库，并把区间内每一天标记为「已同步」。
// rows = 0 也要标：那天确实没戴戒指，不标的话每天都会重复回源拉一个空日期。
export async function saveRange(env, raw, start, end) {
  if (!dbReady(env)) return { written: 0, days: 0, batches: 0 };

  const now = Date.now();
  const stmts = [];
  const perDay = {};
  let written = 0;

  for (const [endpoint, val] of Object.entries(raw || {})) {
    if (endpoint === 'personal_info') {
      if (val && typeof val === 'object' && Object.keys(val).length) {
        stmts.push(upsertRaw(env, endpoint, META_DAY, 'personal_info', val, now));
      }
      continue;
    }
    if (!Array.isArray(val)) continue;

    val.forEach((it, i) => {
      const day = rowDay(it, endpoint);
      if (day === META_DAY) return;
      if (day < start || day > end) return; // 只写本次同步的区间
      stmts.push(upsertRaw(env, endpoint, day, rowId(it, endpoint, i), it, now));
      perDay[day] = (perDay[day] || 0) + 1;
      written += 1;
    });
  }

  for (let d = start; d <= end; d = addDays(d, 1)) {
    stmts.push(upsertSync(env, d, perDay[d] || 0, now));
  }

  let batches = 0;
  try {
    // 分块提交：单次 batch 语句太多会撑爆 SQL 长度与执行时间
    for (let i = 0; i < stmts.length; i += 200) {
      await env.DB.batch(stmts.slice(i, i + 200));
      batches += 1;
    }
  } catch (e) {
    console.log('[d1-write-failed]', String((e && e.message) || e));
    return { written: 0, days: 0, batches, error: String((e && e.message) || e) };
  }

  return { written, days: Object.keys(perDay).length, batches };
}

// LLM 洞察单独缓存，避免将解释性内容混入 Oura 原始数据表。
// 当前调用方尚未启用模型；这些接口为后续模型接入提供幂等缓存边界。
export async function readInsight(env, reportType, reportKey, inputHash, promptVersion) {
  if (!dbReady(env)) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT content_json, source, model, created_at
       FROM ai_insight
       WHERE report_type = ?1 AND report_key = ?2 AND input_hash = ?3 AND prompt_version = ?4`
    )
      .bind(reportType, reportKey, inputHash, promptVersion)
      .first();
    if (!row) return null;
    return { ...row, content: JSON.parse(row.content_json) };
  } catch (e) {
    console.log('[insight-read-failed]', String((e && e.message) || e));
    return null;
  }
}

export async function saveInsight(env, rec) {
  if (!dbReady(env)) return false;
  try {
    await env.DB.prepare(
      `INSERT INTO ai_insight (report_type, report_key, input_hash, prompt_version, source, model, content_json, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(report_type, report_key, input_hash, prompt_version) DO UPDATE SET
         source = excluded.source, model = excluded.model, content_json = excluded.content_json, created_at = excluded.created_at`
    )
      .bind(
        rec.report_type,
        rec.report_key,
        rec.input_hash,
        rec.prompt_version,
        rec.source,
        rec.model || null,
        JSON.stringify(rec.content),
        rec.created_at || Date.now()
      )
      .run();
    return true;
  } catch (e) {
    console.log('[insight-write-failed]', String((e && e.message) || e));
    return false;
  }
}

// 诊断用：库里有什么、覆盖到哪天
export async function dbStatus(env) {
  if (!dbReady(env)) return { bound: false, hint: 'wrangler.toml 里没有 [[d1_databases]]' };

  try {
    const [totals, range, synced, recent, size] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS n FROM oura_raw'),
      env.DB.prepare("SELECT MIN(day) AS first_day, MAX(day) AS last_day FROM oura_raw WHERE day <> 'meta'"),
      env.DB.prepare('SELECT COUNT(*) AS n, MIN(day) AS first_day, MAX(day) AS last_day FROM sync_day'),
      env.DB.prepare(
        'SELECT day, rows, fetched_at FROM sync_day ORDER BY day DESC LIMIT 7'
      ),
      env.DB.prepare(
        "SELECT endpoint, COUNT(*) AS n FROM oura_raw WHERE day <> 'meta' GROUP BY endpoint ORDER BY endpoint"
      ),
    ]);

    const t = (totals.results && totals.results[0]) || {};
    const r = (range.results && range.results[0]) || {};
    const s = (synced.results && synced.results[0]) || {};

    return {
      bound: true,
      rows: t.n || 0,
      data_range: { first: r.first_day || null, last: r.last_day || null },
      synced_days: s.n || 0,
      synced_range: { first: s.first_day || null, last: s.last_day || null },
      by_endpoint: (size.results || []).reduce((a, x) => ((a[x.endpoint] = x.n), a), {}),
      recent_days: (recent.results || []).map((x) => ({
        day: x.day,
        rows: x.rows,
        at: new Date(x.fetched_at).toISOString(),
      })),
    };
  } catch (e) {
    return { bound: true, error: String((e && e.message) || e) };
  }
}
