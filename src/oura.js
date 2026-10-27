// Oura Cloud API v2 取数层
// 文档: https://cloud.ouraring.com/v2/docs

import { addDays } from './report.js';

const BASE = 'https://api.ouraring.com/v2/usercollection';

// [端点, 是否必需]
// 必需端点缺失只记录不中断；只有「核心端点」被 401/403 才算令牌失效。
const PLAN = [
  ['personal_info', false],
  ['daily_sleep', true],
  ['daily_readiness', true],
  ['daily_activity', true],
  ['sleep', true],
  ['daily_stress', false],
  ['daily_resilience', false],
  ['daily_spo2', false],
  ['daily_cardiovascular_age', false],
  // Oura 的 VO2 Max 路径是大小写敏感的 vO2_max，内部仍用 vo2_max 作 key
  ['vO2_max', false, 'vo2_max'],
];

// 核心端点：这些全被拒才说明令牌/账号有根本问题。
// 其余端点（如 daily_cardiovascular_age、vo2_max）需要额外权限或会员，
// 个别失败只降级跳过，不能拖垮整份日报。
const CORE = ['daily_sleep', 'daily_readiness', 'daily_activity', 'sleep'];

async function getOne(token, endpoint, start, end, alias) {
  const key = alias || endpoint;
  const url = `${BASE}/${endpoint}?start_date=${start}&end_date=${end}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const j = await res.json();
      const data = endpoint === 'personal_info' ? j : Array.isArray(j.data) ? j.data : [];
      return { endpoint: key, path: endpoint, data, status: 200 };
    }
    const body = (await res.text()).slice(0, 300);
    return { endpoint: key, path: endpoint, data: [], status: res.status, body };
  } catch (e) {
    return { endpoint: key, path: endpoint, data: [], status: 0, body: String((e && e.message) || e) };
  }
}

export async function fetchOura(token, start, end) {
  // 并发拉取，10 个请求大约 1 秒内完成
  const results = await Promise.all(PLAN.map(([ep, , alias]) => getOne(token, ep, start, end, alias)));

  const raw = {};
  const warnings = [];
  const denied = [];
  let fatal = null;

  for (const r of results) {
    raw[r.endpoint] = r.data;
    if (r.status === 401 || r.status === 403) {
      denied.push({ endpoint: r.endpoint, status: r.status, body: r.body || '' });
    } else if (r.status && r.status !== 200) {
      warnings.push(`${r.endpoint}: HTTP ${r.status}${r.body ? ` ${r.body}` : ''}`);
    }
  }

  const coreDenied = denied.filter((d) => CORE.includes(d.endpoint));
  if (coreDenied.length) {
    // 核心端点都拿不到 → 令牌失效或会员过期，必须报错
    fatal = { status: coreDenied[0].status, endpoint: coreDenied[0].endpoint, denied };
  } else if (denied.length) {
    // 只是个别可选端点无权限 → 跳过该指标，日报照常生成
    warnings.push(
      `以下端点被拒，已跳过对应指标：${denied.map((d) => `${d.endpoint}(${d.status})`).join('、')}`
    );
  }

  if (!raw.personal_info || Array.isArray(raw.personal_info)) raw.personal_info = {};

  // 每个端点的原始状态，供 /probe 诊断用
  const rows = results.map((r) => ({
    endpoint: r.endpoint,
    status: r.status,
    core: CORE.includes(r.endpoint),
    count: Array.isArray(r.data) ? r.data.length : r.data && Object.keys(r.data).length ? 1 : 0,
    body: r.status === 200 ? undefined : r.body,
  }));

  return { raw, fatal, warnings, denied, rows };
}

// Oura 对单次查询的日期跨度有上限（文档写的是 30 天），月报要跨两个月，
// 所以按 30 天切片并发拉取，再合并去重。周报只有 14 天，走不到这里。
const MAX_SPAN = 30;

export function splitRange(start, end, span = MAX_SPAN) {
  const out = [];
  let s = start;
  while (s <= end) {
    let e = addDays(s, span - 1);
    if (e > end) e = end;
    out.push([s, e]);
    s = addDays(e, 1);
  }
  return out;
}

export async function fetchOuraRange(token, start, end) {
  const chunks = splitRange(start, end);
  if (chunks.length <= 1) return fetchOura(token, start, end);

  const parts = await Promise.all(chunks.map(([a, b]) => fetchOura(token, a, b)));

  const raw = {};
  const warnings = [];
  const rows = [];
  let fatal = null;

  for (const r of parts) {
    if (!fatal && r.fatal) fatal = r.fatal;
    warnings.push(...r.warnings);
    rows.push(...r.rows);
    for (const [k, v] of Object.entries(r.raw)) {
      if (Array.isArray(v)) raw[k] = (raw[k] || []).concat(v);
      else if (!raw[k]) raw[k] = v;
    }
  }

  // 切片边界上的记录可能被重复返回，按 id / day 去重
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) continue;
    const seen = new Set();
    raw[k] = v.filter((it) => {
      const key = (it && (it.id || it.day)) || JSON.stringify(it);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return {
    raw,
    fatal,
    warnings: [...new Set(warnings)],
    denied: parts.flatMap((p) => p.denied || []),
    rows,
    chunks: chunks.length,
  };
}
