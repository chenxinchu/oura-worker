// Cloudflare Worker 入口
// 定时触发：scheduled()；OAuth 授权与调试：fetch()

import { fetchOura, fetchOuraRange } from './oura.js';
import { dbReady, readRange, missingDays, toRanges, saveRange, dbStatus } from './store.js';
import { buildPayload, todayInTZ, addDays } from './report.js';
import { buildPeriodPayload, weekRange, monthRange, daysBetween } from './period.js';
import { renderEmail, renderAlert, renderText } from './email.js';
import { renderPeriodEmail, renderPeriodEmpty, renderPeriodText } from './email-period.js';
import { demoRaw } from './demo.js';
import {
  authorizeUrl,
  callbackUrl,
  exchangeCode,
  getAccessToken,
  readTokens,
  refreshVariants,
  refreshOnce,
  tokenInfo,
  clearTokens,
} from './auth.js';

const DAYS = 7;

// 同一 isolate 内的在途标记。上游重试可能在几百毫秒内打到同一个实例，
// KV 的读写有延迟挡不住，用内存变量补上这一层。
let sendingInFlight = false;

// TO_EMAIL 支持逗号、分号、空格分隔的多个地址
function parseTo(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@') && !s.startsWith('#'));
}

// 每次真实发信都留一条记录，便于事后核对「到底发了几封」
async function recordSend(env, rec) {
  try {
    const k = `log:${String(rec.at).padStart(15, '0')}-${Math.random().toString(36).slice(2, 7)}`;
    await env.KV.put(k, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (e) {
    console.log('[log-failed]', String(e));
  }
}

async function sendMail(env, subject, html, text) {
  const to = parseTo(env.TO_EMAIL);
  if (!to.length) {
    return { ok: false, error: 'TO_EMAIL 还没配置（wrangler.toml 的 [vars]）' };
  }
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: 'RESEND_API_KEY 还没配置（wrangler secret put RESEND_API_KEY）' };
  }

  const at = Date.now();
  const results = [];

  // 逐个收件人单独发：一个地址被拒不会拖累其他地址，
  // 收件人之间也互相看不到对方的邮箱。
  for (const addr of to) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: env.FROM_EMAIL, to: [addr], subject, html, text }),
      });
      const bodyText = await res.text();
      if (res.ok) {
        let id = null;
        try {
          id = JSON.parse(bodyText).id || null;
        } catch {
          id = null;
        }
        results.push({ to: addr, ok: true, id });
      } else {
        results.push({ to: addr, ok: false, error: `HTTP ${res.status}: ${bodyText.slice(0, 240)}` });
      }
    } catch (e) {
      results.push({ to: addr, ok: false, error: String((e && e.message) || e) });
    }
  }

  const delivered = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  await recordSend(env, {
    at,
    ok: failed.length === 0,
    subject,
    to,
    delivered: delivered.map((r) => r.to),
    failed: failed.map((r) => ({ to: r.to, error: r.error })),
    id: delivered[0] ? delivered[0].id : null,
  });

  if (!delivered.length) {
    return { ok: false, error: failed[0].error, to, delivered: [], failed };
  }
  return {
    ok: failed.length === 0,
    id: delivered[0].id,
    to,
    delivered: delivered.map((r) => r.to),
    failed,
  };
}

function authLink(env) {
  const base = (env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  return base ? `${base}/oauth/start?key=${env.DEBUG_KEY || ''}` : '/oauth/start?key=你的DEBUG_KEY';
}

// 每天发什么：日报每天都发，周一是周报，1 号是月报。
// 1 号恰好是周一时三封都发 —— 月报统计整月、周报统计上一个完整自然周，
// 两者覆盖的日期不重叠，内容也不重复，都要看。
export function planKinds(today) {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const isFirst = today.endsWith('-01');
  const isMonday = dow === 1;

  const out = ['daily'];
  if (isMonday) out.push('weekly');
  if (isFirst) out.push('monthly');
  return out;
}

// 需要往前取多少天，才能同时覆盖日报趋势和最远的对比区间
export function needStart(kinds, today) {
  let s = addDays(today, -DAYS);
  for (const k of kinds) {
    const r = k === 'monthly' ? monthRange(today) : k === 'weekly' ? weekRange(today) : null;
    if (r && r.prevStart < s) s = r.prevStart;
  }
  return s;
}

// 相邻/重叠的区间合并，避免为了一天的缺口多打一轮请求
function mergeRanges(list) {
  const sorted = [...list].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= addDays(last[1], 1)) {
      if (b > last[1]) last[1] = b;
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

function mergeRaw(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (Array.isArray(v)) target[k] = (target[k] || []).concat(v);
    else if (!target[k]) target[k] = v;
  }
  return target;
}

// 库里的记录与刚拉到的记录在区间边界上会重叠，按 id / day 去重
function dedupeRaw(raw) {
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
  return raw;
}

async function sendDaily(env, raw, today, warnings) {
  const p = buildPayload(raw, DAYS, today);
  if (!p.has_sleep) {
    const a = renderAlert(
      'nodata',
      `报告日 ${p.report_day} 在 Oura 云上没有睡眠数据。<br>通常是因为手机上的 Oura App 还没把戒指数据同步上去。`,
      today
    );
    const r = await sendMail(env, a.subject, a.html, a.text);
    return { type: 'daily', step: 'no-data', reportDay: p.report_day, ...r };
  }
  const out = renderEmail(p);
  const r = await sendMail(env, out.subject, out.html, out.text);
  return { type: 'daily', step: 'sent', reportDay: p.report_day, subject: out.subject, warnings, ...r };
}

async function sendPeriod(env, raw, kind, today) {
  const p = buildPeriodPayload(raw, kind, today);

  // 整期无数据：发一条短说明，而不是一张全是「—」的对比表
  if (!p.cur.n.sleep) {
    const out = renderPeriodEmpty(p);
    const r = await sendMail(env, out.subject, out.html, out.text);
    return {
      type: kind,
      step: 'no-data',
      range: `${p.period.start} ~ ${p.period.end}`,
      subject: out.subject,
      ...r,
    };
  }

  const out = renderPeriodEmail(p);
  const r = await sendMail(env, out.subject, out.html, out.text);
  return {
    type: kind,
    step: 'sent',
    range: `${p.period.start} ~ ${p.period.end}`,
    days_with_sleep: p.cur.n.sleep,
    has_prev: p.has_prev,
    subject: out.subject,
    ...r,
  };
}

// 取数：先库后接口。
// runReports 和 /verify 共用这一条路径，保证「验证时看到的」就是「明早定时任务会用的」。
async function collectRaw(env, list, today, token0) {
  const start = needStart(list, today);

  // 冷区（<= today-2）从 D1 取，缺哪天才回源；热区（today-1、today）永远实时拉。
  // 早上 9 点时今天才刚开始、昨天的活动数据也可能还没同步完，
  // 缓存它们会把脏数据永久写进库，之后所有周报月报都跟着错。
  const useDb = dbReady(env);
  const coldEnd = addDays(today, -2);
  const hotStart = addDays(today, -1);

  let cold = { raw: {}, synced: new Set() };
  let ranges;
  let filledDays = 0;

  if (!useDb) {
    // 没绑 D1：退回全量拉取
    ranges = [[start, today]];
  } else {
    ranges = [];
    if (start <= coldEnd) {
      cold = await readRange(env, start, coldEnd);
      const missing = missingDays(cold.synced, start, coldEnd);
      filledDays = missing.length;
      ranges.push(...toRanges(missing));
    }
    ranges.push([hotStart, today]);
    ranges = mergeRanges(ranges);
  }

  let token = token0;
  let refreshed = false;
  const fetched = {};
  const warnings = [];
  const toPersist = [];
  let fatal = null;

  for (const [a, b] of ranges) {
    let r = await fetchOuraRange(token, a, b);
    // 令牌可能被 Oura 提前作废（重复授权、用户撤销等）：刷新一次再试
    if (r.fatal && r.fatal.status === 401 && !refreshed) {
      const rr = await refreshOnce(env);
      if (!rr.error) {
        refreshed = true;
        token = rr.rec.access_token;
        r = await fetchOuraRange(token, a, b);
      }
    }
    if (r.fatal) {
      fatal = r.fatal;
      break;
    }
    warnings.push(...r.warnings);
    mergeRaw(fetched, r.raw);
    // 只把冷区部分落库，热区不缓存
    if (useDb && a <= coldEnd) toPersist.push([a, b < coldEnd ? b : coldEnd]);
  }

  if (fatal) {
    return {
      fatal,
      raw: {},
      warnings: [...new Set(warnings)],
      stats: { use_db: useDb, cold_range: start <= coldEnd ? `${start}~${coldEnd}` : null },
    };
  }

  // 落库放在渲染之前：即使后面渲染失败，这次拉到的数据也已经存下来了
  let saved = null;
  for (const [a, b] of toPersist) {
    const one = await saveRange(env, fetched, a, b);
    if (!saved) saved = { written: 0, days: 0, batches: 0 };
    saved.written += one.written || 0;
    saved.days += one.days || 0;
    saved.batches += one.batches || 0;
    if (one.error) saved.error = one.error;
  }

  return {
    raw: dedupeRaw(mergeRaw(cold.raw, fetched)),
    warnings,
    fatal: null,
    stats: {
      use_db: useDb,
      cold_range: start <= coldEnd ? `${start}~${coldEnd}` : null,
      filled_days: filledDays,
      oura_ranges: ranges.map(([a, b]) => `${a}~${b}`),
      saved,
    },
  };
}

export async function runReports(env, kinds) {
  const tz = env.REPORT_TZ || 'Asia/Shanghai';
  const today = todayInTZ(tz);
  const list = kinds && kinds.length ? kinds : ['daily'];

  const auth = await getAccessToken(env);
  if (auth.error === 'no-auth') {
    const a = renderAlert(
      'reauth',
      '还没完成 Oura 授权，或者授权记录被清掉了。<br>授权一次即可长期使用，之后令牌会自动刷新。',
      today,
      authLink(env)
    );
    const r = await sendMail(env, a.subject, a.html, a.text);
    return { ok: false, step: 'no-auth', results: [{ type: 'alert', ...r }] };
  }
  if (auth.error) {
    const a = renderAlert(
      'reauth',
      `刷新令牌失败：${auth.error}<br>通常是授权被撤销，或 client_secret 改过。`,
      today,
      authLink(env)
    );
    const r = await sendMail(env, a.subject, a.html, a.text);
    return { ok: false, step: 'refresh-failed', results: [{ type: 'alert', ...r }] };
  }

  const col = await collectRaw(env, list, today, auth.token);

  if (col.fatal) {
    const fatal = col.fatal;
    const a = renderAlert(
      'reauth',
      `Oura 返回 HTTP ${fatal.status}（端点 ${fatal.endpoint}）。<br>${
        fatal.status === 401 ? '访问令牌被拒绝，重新授权一次即可。' : '可能是 Oura 会员过期，或应用缺少对应 scope 权限。'
      }`,
      today,
      authLink(env)
    );
    const r = await sendMail(env, a.subject, a.html, a.text);
    return { ok: false, step: 'oura-auth', results: [{ type: 'alert', ...r }] };
  }

  const { raw, warnings } = col;

  // 日报排在最前：万一后续渲染把 CPU 配额吃满，至少当天这封已经发出去了
  const ordered = ['daily', ...list.filter((k) => k !== 'daily')];
  const results = [];
  for (const kind of ordered) {
    results.push(
      kind === 'daily' ? await sendDaily(env, raw, today, warnings) : await sendPeriod(env, raw, kind, today)
    );
  }

  return {
    ok: results.every((x) => x.ok),
    step: 'sent',
    today,
    db: col.stats,
    results,
  };
}

// 兼容旧调用
export async function runDaily(env) {
  return runReports(env, ['daily']);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function page(body, status = 200) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oura 日报</title></head>
<body style="margin:0;padding:40px 20px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e9ebef;border-radius:12px;padding:28px;">
${body}
</div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function guard(url, env) {
  if (!env.DEBUG_KEY) return 'DEBUG_KEY 未设置，调试接口已关闭';
  if (url.searchParams.get('key') !== env.DEBUG_KEY) return '口令不对：请在 URL 后面加 ?key=你的DEBUG_KEY';
  return null;
}

export default {
  async scheduled(event, env, ctx) {
    const tz = env.REPORT_TZ || 'Asia/Shanghai';
    const kinds = planKinds(todayInTZ(tz));
    ctx.waitUntil(
      runReports(env, kinds).then((r) => {
        console.log('[oura-report]', JSON.stringify({ kinds, ...r }));
      })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // ---- 健康检查（免口令，不含任何健康数据） ----
    if (path === '/' || path === '/health') {
      const rec = await readTokens(env);
      return json({
        ok: true,
        now: new Date().toISOString(),
        timezone: env.REPORT_TZ || 'Asia/Shanghai',
        today: todayInTZ(env.REPORT_TZ || 'Asia/Shanghai'),
        cron: '0 1 * * * (UTC) = 北京 09:00',
        plan: {
          today_kinds: planKinds(todayInTZ(env.REPORT_TZ || 'Asia/Shanghai')),
          rule: '每天发日报；周一加发周报；每月 1 号加发月报；1 号恰逢周一时三封都发（日报 + 周报 + 月报）',
        },
        to: env.TO_EMAIL || null,
        checks: {
          oura_client_id: Boolean(env.OURA_CLIENT_ID),
          oura_client_secret: Boolean(env.OURA_CLIENT_SECRET),
          resend_key: Boolean(env.RESEND_API_KEY),
          debug_key: Boolean(env.DEBUG_KEY),
          kv_bound: Boolean(env.KV),
          d1_bound: Boolean(env.DB),
        },
        oauth: rec
          ? {
              authorized: Boolean(rec.refresh_token),
              scope: rec.scope,
              updated_at: rec.updated_at,
              expires_at: rec.expires_at ? new Date(rec.expires_at).toISOString() : null,
            }
          : { authorized: false },
        next: rec && rec.refresh_token ? '已授权，等待定时任务' : '还没授权，先访问 /oauth/start?key=你的DEBUG_KEY',
      });
    }

    // ---- OAuth：发起授权 ----
    if (path === '/oauth/start') {
      const deny = guard(url, env);
      if (deny) {
        return page(
          `<h2 style="font-size:17px;margin:0 0 10px;">无法发起授权</h2><p style="color:#6b7280;font-size:14px;line-height:1.7;">${deny}</p>`,
          403
        );
      }
      if (!env.OURA_CLIENT_ID || !env.OURA_CLIENT_SECRET) {
        return page(
          `<h2 style="font-size:17px;margin:0 0 10px;">还缺 Oura 应用凭据</h2>
           <p style="color:#6b7280;font-size:14px;line-height:1.7;">先执行这两条：<br>
           <code style="background:#f1f2f5;padding:2px 6px;border-radius:4px;">npx wrangler secret put OURA_CLIENT_ID</code><br>
           <code style="background:#f1f2f5;padding:2px 6px;border-radius:4px;">npx wrangler secret put OURA_CLIENT_SECRET</code></p>`,
          400
        );
      }
      return Response.redirect(authorizeUrl(env, request.url), 302);
    }

    // ---- OAuth：回调 ----
    if (path === '/oauth/callback') {
      const err = url.searchParams.get('error');
      if (err) {
        return page(
          `<h2 style="font-size:17px;margin:0 0 10px;">授权被拒绝</h2>
           <p style="color:#6b7280;font-size:14px;line-height:1.7;">Oura 返回：${err}<br>${url.searchParams.get('error_description') || ''}</p>`,
          400
        );
      }
      const state = url.searchParams.get('state');
      if (env.DEBUG_KEY && state !== env.DEBUG_KEY) {
        return page(
          '<h2 style="font-size:17px;margin:0 0 10px;">state 不匹配</h2><p style="color:#6b7280;font-size:14px;">疑似伪造回调，已拒绝。</p>',
          403
        );
      }
      const code = url.searchParams.get('code');
      if (!code) return page('<h2 style="font-size:17px;margin:0 0 10px;">缺少 code</h2>', 400);

      const r = await exchangeCode(env, code, request.url);
      if (r.error) {
        return page(
          `<h2 style="font-size:17px;margin:0 0 10px;">换取令牌失败</h2>
           <p style="color:#6b7280;font-size:14px;line-height:1.7;">${r.error}</p>
           <p style="color:#9ca3af;font-size:13px;line-height:1.7;">常见原因：redirect_uri 与 Oura 应用里登记的不一致（必须正好是 <code>${callbackUrl(
             request.url
           )}</code>），或授权码已过期（只有 10 分钟）。</p>`,
          400
        );
      }

      // 立刻用新令牌取一次数，把问题暴露在授权当场，而不是等到第二天早上
      const tz0 = env.REPORT_TZ || 'Asia/Shanghai';
      const today0 = todayInTZ(tz0);
      const check = await fetchOura(r.rec.access_token, addDays(today0, -DAYS), today0);
      const okCount = check.rows.filter((x) => x.status === 200).length;
      const total = check.rows.length;

      if (check.fatal) {
        return page(
          `<h2 style="font-size:17px;margin:0 0 12px;">⚠️ 令牌拿到了，但 Oura 拒绝取数</h2>
           <p style="color:#374151;font-size:14px;line-height:1.8;">授权本身成功了，但用这个令牌请求 API 时 Oura 返回 HTTP ${check.fatal.status}。<br>
           这通常意味着 Oura 应用在门户里还缺权限，或者应用还没通过审核。</p>
           <p style="color:#6b7280;font-size:13px;line-height:1.8;">已保存 scope：<code>${r.rec.scope || '（未返回）'}</code></p>
           <p style="color:#9ca3af;font-size:12px;line-height:1.8;">请到 developer.ouraring.com 检查应用的 scope 配置，然后重新授权。</p>`,
          502
        );
      }

      return page(
        `<h2 style="font-size:17px;margin:0 0 12px;">✅ 授权成功，数据已连通</h2>
         <p style="color:#374151;font-size:14px;line-height:1.8;">${total} 个端点里 ${okCount} 个正常返回。<br>
         refresh_token 已存入 KV，之后会自动刷新，不用再管。</p>
         <p style="color:#6b7280;font-size:13px;line-height:1.8;">下一步：访问 <code>/send?key=你的DEBUG_KEY</code> 立刻发一封测试邮件。</p>
         <p style="color:#9ca3af;font-size:12px;line-height:1.8;">scope：${r.rec.scope || '（未返回）'}</p>`
      );
    }

    // ---- 以下接口需要口令 ----
    const deny = guard(url, env);
    if (deny) return json({ ok: false, error: deny }, 403);

    // ---- D1 缓存状态：库里有什么、覆盖到哪天 ----
    if (path === '/db') {
      return json({ ok: true, ...(await dbStatus(env)) });
    }

    // ---- 只验证不发送 ----
    // 走和定时任务完全相同的取数路径（collectRaw），把三种报告都渲染一遍，
    // 只回摘要指标。用来确认「库里的数据组装出来」和「实时拉出来」结果一致。
    // 注意：会顺带把缺失的日期补进库，但不会发任何邮件。
    if (path === '/verify') {
      const tz = env.REPORT_TZ || 'Asia/Shanghai';
      const today = todayInTZ(tz);
      const kinds = (url.searchParams.get('kinds') || 'daily,weekly,monthly')
        .split(',')
        .map((s) => s.trim())
        .filter((k) => ['daily', 'weekly', 'monthly'].includes(k));
      if (!kinds.length) return json({ ok: false, error: 'kinds 只能是 daily/weekly/monthly' }, 400);

      const auth = await getAccessToken(env);
      if (auth.error) return json({ ok: false, error: auth.error }, 400);

      const col = await collectRaw(env, kinds, today, auth.token);
      if (col.fatal) return json({ ok: false, step: 'oura-auth', fatal: col.fatal }, 502);

      const reports = [];
      for (const kind of kinds) {
        if (kind === 'daily') {
          const p = buildPayload(col.raw, DAYS, today);
          reports.push({
            kind,
            report_day: p.report_day,
            has_sleep: p.has_sleep,
            sleep: p.sleep_score,
            readiness: p.readiness_score,
            activity: p.activity_score,
            steps: p.steps,
            hrv: p.detail ? p.detail.average_hrv : null,
            total_sleep: p.detail ? p.detail.total_sleep_duration : null,
            trend_days_with_data: p.trend.filter((x) => typeof x.sleep === 'number').length,
            // 排查「对比数据和预览不一致」用：把基准日和每一项的 cur/prev 摊开
            act_day: p.act_day,
            prev_day: p.prev_day,
            prev_act_day: p.prev_act_day,
            cmp: p.cmp,
            // raw 里到底有哪些天的记录（day → 条数、关键值），排查「宽窄窗口不一致」
            sleep_records: (col.raw.sleep || []).reduce((acc, s) => {
              const d = s && s.day;
              if (!d) return acc;
              const cur = acc[d] || { n: 0, max: 0 };
              cur.n += 1;
              cur.max = Math.max(cur.max, s.total_sleep_duration || 0);
              acc[d] = cur;
              return acc;
            }, {}),
            act_days: (col.raw.daily_activity || []).reduce((acc, a) => {
              const d = a && a.day;
              if (!d) return acc;
              const cur = acc[d] || { n: 0, steps: 0 };
              cur.n += 1;
              cur.steps = Math.max(cur.steps, a.steps || 0);
              acc[d] = cur;
              return acc;
            }, {}),
          });
        } else {
          const p = buildPeriodPayload(col.raw, kind, today);
          reports.push({
            kind,
            range: `${p.period.start}~${p.period.end}`,
            prev_range: `${p.period.prevStart}~${p.period.prevEnd}`,
            days_with_sleep: p.cur.n.sleep,
            has_prev: p.has_prev,
            subject: renderPeriodEmail(p).subject,
            avg: p.cur.avg,
            prev_avg: p.has_prev ? p.prev.avg : null,
          });
        }
      }

      return json({
        ok: true,
        today,
        source: col.stats,
        warnings: [...new Set(col.warnings)].slice(0, 8),
        reports,
        note: '只渲染，没有发邮件。缺失的日期已顺带补进库。',
      });
    }

    // ---- 回补历史到 D1：只写库，不发任何邮件 ----
    // 一次最多 92 天（3 个 30 天切片 × 10 端点 = 30 个配额，留出余量）。
    // 不传 from 就自动从 to 往前推 days 天。
    if (path === '/backfill') {
      if (!dbReady(env)) return json({ ok: false, error: 'D1 未绑定（wrangler.toml 缺 [[d1_databases]]）' }, 400);

      const tz = env.REPORT_TZ || 'Asia/Shanghai';
      const today = todayInTZ(tz);
      const coldEnd = addDays(today, -2);
      const to = url.searchParams.get('to') || coldEnd;
      const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 92);
      const start = url.searchParams.get('from') || addDays(to, -(days - 1));

      const span = daysBetween(start, to);
      if (span > 92) {
        return json({ ok: false, error: `一次最多 92 天，当前 ${span} 天。请用 from/to 分批。` }, 400);
      }
      if (to > coldEnd) {
        return json({ ok: false, error: `to 不能晚于 ${coldEnd}（今天和昨天永远实时拉，不入库）` }, 400);
      }

      const auth = await getAccessToken(env);
      if (auth.error) return json({ ok: false, error: auth.error }, 400);

      const cold = await readRange(env, start, to);
      // force=1：无视 sync_day，整段重新拉一遍。
      // 取数逻辑改过（比如 sleep 端点窗口修正）之后，用它修已经入库的脏数据。
      const force = url.searchParams.get('force') === '1';
      const missing = force ? missingDays(new Set(), start, to) : missingDays(cold.synced, start, to);
      if (!missing.length) {
        return json({ ok: true, range: `${start}~${to}`, missing_days: 0, note: '这段已经全部在库里了' });
      }

      const ranges = toRanges(missing);
      const fetched = {};
      const warnings = [];
      let fatal = null;
      let chunks = 0;

      for (const [a, b] of ranges) {
        const r = await fetchOuraRange(auth.token, a, b);
        if (r.fatal) {
          fatal = r.fatal;
          break;
        }
        warnings.push(...r.warnings);
        mergeRaw(fetched, r.raw);
        chunks += r.chunks || 1;
      }
      if (fatal) {
        return json({ ok: false, error: `Oura 拒绝取数：HTTP ${fatal.status}（${fatal.endpoint}）`, fatal }, 502);
      }

      const saved = { written: 0, days: 0, batches: 0 };
      for (const [a, b] of ranges) {
        const one = await saveRange(env, fetched, a, b);
        saved.written += one.written || 0;
        saved.days += one.days || 0;
        saved.batches += one.batches || 0;
        if (one.error) saved.error = one.error;
      }

      return json({
        ok: !saved.error,
        range: `${start}~${to}`,
        missing_days: missing.length,
        oura_chunks: chunks,
        saved,
        warnings: [...new Set(warnings)].slice(0, 5),
        note: '只写库，没有发邮件',
      });
    }

    // 查 Resend 账户里的域名验证状态
    if (path === '/resend/domains') {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      });
      const text = await res.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return json(
        {
          http: res.status,
          current_from: env.FROM_EMAIL,
          current_to: parseTo(env.TO_EMAIL),
          raw: parsed || text.slice(0, 500),
        },
        res.ok ? 200 : 502
      );
    }

    // 字段结构诊断：只返回类型结构，不返回具体数值
    if (path === '/fields') {
      const ep = url.searchParams.get('ep') || 'daily_readiness';
      const auth = await getAccessToken(env);
      if (auth.error) return json({ ok: false, error: auth.error }, 400);
      const tz = env.REPORT_TZ || 'Asia/Shanghai';
      const today = todayInTZ(tz);
      const res = await fetchOura(auth.token, addDays(today, -DAYS), today);
      const arr = res.raw[ep];
      const first = Array.isArray(arr) ? arr[0] : arr;
      if (!first) return json({ ok: false, error: `端点 ${ep} 没有数据`, available: Object.keys(res.raw) }, 404);
      const shape = (o, depth) => {
        if (o === null) return 'null';
        if (typeof o !== 'object') return typeof o;
        if (Array.isArray(o)) return `array(${o.length})`;
        if (depth > 1) return 'object';
        const out = {};
        for (const [k, v] of Object.entries(o)) {
          out[k] = v && typeof v === 'object' && !Array.isArray(v) ? shape(v, depth + 1) : shape(v, depth + 1);
        }
        return out;
      };
      return json({
        ok: true,
        endpoint: ep,
        count: Array.isArray(arr) ? arr.length : 1,
        shape: shape(first, 0),
      });
    }

    // 环境变量体检：检查是否有首尾空白/换行/引号混进密钥里
    if (path === '/envcheck') {
      const probe = (v) => {
        if (!v) return null;
        return {
          length: v.length,
          trimmed_length: v.trim().length,
          has_whitespace: /\s/.test(v),
          has_quote: /["']/.test(v),
          has_newline: /[\r\n]/.test(v),
        };
      };
      const o = {
        OURA_CLIENT_ID: probe(env.OURA_CLIENT_ID),
        OURA_CLIENT_SECRET: probe(env.OURA_CLIENT_SECRET),
        RESEND_API_KEY: probe(env.RESEND_API_KEY),
        DEBUG_KEY: probe(env.DEBUG_KEY),
      };
      const dirty = Object.entries(o)
        .filter(([, v]) => v && (v.has_newline || v.has_quote || v.length !== v.trimmed_length))
        .map(([k]) => k);
      return json({ ok: dirty.length === 0, dirty_keys: dirty, detail: o });
    }

    // 令牌结构诊断：看它自己声称什么时候过期
    if (path === '/tokeninfo') {
      const r = await tokenInfo(env);
      return json(r, r.error ? 400 : 200);
    }

    // 刷新令牌：依次尝试三种 client 认证写法
    if (path === '/refresh') {
      const r = await refreshVariants(env);
      return json(r, r.ok ? 200 : 400);
    }

    // 清空授权，回到「未授权」状态
    if (path === '/revoke') {
      await clearTokens(env);
      return json({ ok: true, note: 'KV 里的令牌已清除，访问 /oauth/start?key= 重新授权' });
    }

    // 逐端点诊断：哪个端点通、哪个被拒、各自返回多少条
    if (path === '/probe') {
      const auth = await getAccessToken(env);
      if (auth.error) return json({ ok: false, error: `授权不可用：${auth.error}` }, 400);
      const tz = env.REPORT_TZ || 'Asia/Shanghai';
      const today = url.searchParams.get('day') || todayInTZ(tz);
      const res = await fetchOura(auth.token, addDays(today, -DAYS), today);
      return json({
        ok: !res.fatal,
        scope: (auth.rec && auth.rec.scope) || null,
        token_expires_at:
          auth.rec && auth.rec.expires_at ? new Date(auth.rec.expires_at).toISOString() : null,
        fatal: res.fatal,
        warnings: res.warnings,
        endpoints: res.rows,
      });
    }

    // 预览邮件 HTML（不发送）
    if (path === '/preview') {
      const tz = env.REPORT_TZ || 'Asia/Shanghai';
      const today = url.searchParams.get('day') || todayInTZ(tz);
      const type = url.searchParams.get('type') || 'daily';
      const kind = type === 'weekly' || type === 'monthly' ? type : 'daily';

      // 周报要跨两周、月报要跨两个月，取数窗口按实际对比区间算
      const from =
        kind === 'monthly'
          ? monthRange(today).prevStart
          : kind === 'weekly'
          ? weekRange(today).prevStart
          : addDays(today, -DAYS);
      const span = daysBetween(from, today);

      let raw;
      let warnings = [];
      if (url.searchParams.get('demo') === '1') {
        raw = demoRaw(span, today);
      } else {
        const auth = await getAccessToken(env);
        if (auth.error) {
          return json({ ok: false, error: `授权不可用：${auth.error}，可加 ?demo=1 看演示版式` }, 400);
        }
        let res = await fetchOuraRange(auth.token, from, today);
        if (res.fatal && res.fatal.status === 401) {
          const rr = await refreshOnce(env);
          if (!rr.error) res = await fetchOuraRange(rr.rec.access_token, from, today);
        }
        if (res.fatal) {
          if (res.fatal.status === 401 || res.fatal.status === 403) {
            const n = res.fatal.denied ? res.fatal.denied.length : 0;
            return page(
              `<h2 style="font-size:17px;margin:0 0 10px;">Oura 令牌被拒绝了</h2>
               <p style="color:#374151;font-size:14px;line-height:1.8;">Oura 对 ${n} 个端点全部返回 HTTP ${res.fatal.status}，刷新令牌也无效。<br>
               本地记录的过期时间不可信，需要重新授权一次。</p>
               <p style="margin:18px 0 6px;"><a href="${authLink(env)}" style="display:inline-block;background:#7c5cff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:14px;">点这里重新授权</a></p>
               <p style="color:#9ca3af;font-size:12px;line-height:1.8;margin-top:16px;">授权完成后回到这个地址刷新即可。想看版式可以加 <code>?demo=1</code>。</p>`,
              502
            );
          }
          return json({ ok: false, error: res.fatal }, 502);
        }
        raw = res.raw;
        warnings = res.warnings || [];
      }

      let out;
      if (kind === 'daily') {
        out = renderEmail(buildPayload(raw, DAYS, today));
      } else {
        // 预览要和实际发送一致：整期无数据时展示的就是那条短说明
        const pp = buildPeriodPayload(raw, kind, today);
        out = pp.cur.n.sleep ? renderPeriodEmail(pp) : renderPeriodEmpty(pp);
      }

      return new Response(out.html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Report-Kind': kind,
          'X-Report-Subject': encodeURIComponent(out.subject),
          // 有降级时把原因透出来，方便在浏览器开发者工具里看到
          'X-Report-Warnings': warnings.length ? encodeURIComponent(warnings.join(' | ')) : '',
        },
      });
    }

    // 立即执行一次并真实发信
    if (path === '/send') {
      // 防重：上游超时重试时不会重复发信，要强制再发加 &force=1
      const force = url.searchParams.get('force') === '1';

      if (!force && sendingInFlight) {
        return json({ ok: true, deduped: true, note: '上一次发送还在进行中，本次请求已跳过' });
      }

      const last = await env.KV.get('last_send', 'json');
      if (!force && last && Date.now() - last.at < 90_000) {
        const ago = Math.round((Date.now() - last.at) / 1000);
        return json({
          ok: true,
          deduped: true,
          note: `${ago} 秒前刚发过一封，已跳过重复发送。要强制再发请加 &force=1`,
          last,
        });
      }

      sendingInFlight = true;
      try {
        const tz = env.REPORT_TZ || 'Asia/Shanghai';
        const today = todayInTZ(tz);
        const type = url.searchParams.get('type') || 'auto';
        let kinds;
        if (type === 'daily') kinds = ['daily'];
        else if (type === 'weekly') kinds = ['weekly'];
        else if (type === 'monthly') kinds = ['monthly'];
        else if (type === 'all') kinds = ['daily', 'weekly', 'monthly'];
        else kinds = planKinds(today);

        const r = await runReports(env, kinds);
        if (r.ok) {
          const first = (r.results && r.results[0]) || {};
          await env.KV.put(
            'last_send',
            JSON.stringify({ at: Date.now(), subject: first.subject, id: first.id, to: first.to, kinds })
          );
        }
        return json(r, r.ok ? 200 : 500);
      } finally {
        sendingInFlight = false;
      }
    }

    // 发送历史：核对「到底发了几封、发给了谁」
    if (path === '/log') {
      const list = await env.KV.list({ prefix: 'log:', limit: 100 });
      const items = [];
      for (const k of list.keys) {
        const v = await env.KV.get(k.name, 'json');
        if (v) items.push(v);
      }
      items.sort((a, b) => b.at - a.at);
      return json({
        ok: true,
        total: items.length,
        sends: items.slice(0, 30).map((x) => ({
          time: new Date(x.at).toISOString(),
          time_local: new Date(x.at + 8 * 3600 * 1000).toISOString().replace('Z', ' +08:00'),
          ok: x.ok,
          subject: x.subject,
          to: x.to,
          delivered: x.delivered || null,
          failed: x.failed || null,
          id: x.id || null,
          error: x.error || null,
        })),
      });
    }

    // 纯文本预览（演示数据）：加 &type=weekly|monthly 看周报月报
    if (path === '/text') {
      const tz = env.REPORT_TZ || 'Asia/Shanghai';
      const today = url.searchParams.get('day') || todayInTZ(tz);
      const type = url.searchParams.get('type') || 'daily';
      const span = type === 'monthly' ? 100 : type === 'weekly' ? 21 : DAYS;
      const raw = demoRaw(span, today);
      const body =
        type === 'weekly' || type === 'monthly'
          ? renderPeriodText(buildPeriodPayload(raw, type, today))
          : renderText(buildPayload(raw, DAYS, today));
      return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    return json(
      {
        ok: false,
        error: '可用路径：/health、/oauth/start?key=、/oauth/callback、/probe?key=、/resend/domains?key=、/fields?key=&ep=、/envcheck?key=、/tokeninfo?key=、/refresh?key=、/revoke?key=、/preview?key=&type=daily|weekly|monthly&demo=1、/send?key=&type=auto|daily|weekly|monthly|all、/log?key=、/text?key=',
      },
      404
    );
  },
};
