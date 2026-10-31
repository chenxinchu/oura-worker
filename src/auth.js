// Oura OAuth2 授权码流程
// 背景：Oura 的个人访问令牌（PAT）已于 2025 年 12 月废弃，
// 现在唯一可用的方式是注册 API Application + OAuth2 授权码流程。
// 文档：https://cloud.ouraring.com/v2/docs

const AUTHORIZE_URL = 'https://cloud.ouraring.com/oauth/authorize';
const TOKEN_URL = 'https://api.ouraring.com/oauth/token';

// 覆盖日报用到的全部数据类型
const SCOPES = ['daily', 'personal', 'heartrate', 'spo2', 'heart_health', 'workout', 'tag'];

const KV_KEY = 'oauth';

export function callbackUrl(requestUrl) {
  return `${new URL(requestUrl).origin}/oauth/callback`;
}

export function authorizeUrl(env, requestUrl) {
  const qs = new URLSearchParams({
    client_id: env.OURA_CLIENT_ID || '',
    redirect_uri: callbackUrl(requestUrl),
    response_type: 'code',
    scope: SCOPES.join(' '),
    // 用 DEBUG_KEY 当 state，只有你知道，能防住伪造回调
    state: env.DEBUG_KEY || 'oura',
  });
  return `${AUTHORIZE_URL}?${qs.toString()}`;
}

async function tokenRequest(env, params) {
  const body = new URLSearchParams({
    ...params,
    client_id: env.OURA_CLIENT_ID || '',
    client_secret: env.OURA_CLIENT_SECRET || '',
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const text = await res.text();
    let j = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    if (!res.ok || !j) {
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { data: j };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}

async function saveTokens(env, j, prev) {
  const rec = {
    access_token: j.access_token,
    // Oura 可能会轮换 refresh_token，返回新的就用新的
    refresh_token: j.refresh_token || (prev && prev.refresh_token) || null,
    // 提前 2 分钟判定过期，避免边界情况
    expires_at: Date.now() + Math.max(60, (j.expires_in || 86400) - 120) * 1000,
    scope: j.scope || (prev && prev.scope) || '',
    updated_at: new Date().toISOString(),
  };
  await env.KV.put(KV_KEY, JSON.stringify(rec));
  return rec;
}

export async function exchangeCode(env, code, requestUrl) {
  const r = await tokenRequest(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(requestUrl),
  });
  if (r.error) return { error: r.error };
  return { rec: await saveTokens(env, r.data, null) };
}

export async function readTokens(env) {
  return env.KV.get(KV_KEY, 'json');
}

function b64urlDecode(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : '';
  return atob(t + pad);
}

function jwtPayload(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return null;
  }
}

/**
 * 只暴露令牌的结构性信息（长度、JWT 声明），不返回令牌原文。
 * 用途：判断「本地记录的过期时间」与令牌自带的 exp 是否一致。
 */
export async function tokenInfo(env) {
  const rec = await readTokens(env);
  if (!rec) return { error: 'no-auth：KV 里没有令牌记录' };
  const p = jwtPayload(rec.access_token);
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: {
      length: (rec.access_token || '').length,
      prefix: (rec.access_token || '').slice(0, 8),
      is_jwt: Boolean(p),
      claims: p
        ? {
            exp_iso: p.exp ? new Date(p.exp * 1000).toISOString() : null,
            seconds_left: typeof p.exp === 'number' ? p.exp - now : null,
            iat_iso: p.iat ? new Date(p.iat * 1000).toISOString() : null,
            aud: p.aud || null,
            iss: p.iss || null,
            scope: p.scope || null,
            token_type: p.token_type || null,
          }
        : null,
    },
    refresh_token: {
      length: (rec.refresh_token || '').length,
      prefix: (rec.refresh_token || '').slice(0, 6),
    },
    recorded: {
      expires_at: rec.expires_at ? new Date(rec.expires_at).toISOString() : null,
      scope: rec.scope || null,
      updated_at: rec.updated_at || null,
    },
  };
}

// 三种可能的 client 认证写法，逐个试，成功即停
const VARIANTS = ['body-secret', 'basic-auth', 'body-id-only'];

async function tryRefresh(env, rec, variant) {
  const params = { grant_type: 'refresh_token', refresh_token: rec.refresh_token };
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (variant === 'basic-auth') {
    headers.Authorization = `Basic ${btoa(`${env.OURA_CLIENT_ID || ''}:${env.OURA_CLIENT_SECRET || ''}`)}`;
  } else if (variant === 'body-id-only') {
    params.client_id = env.OURA_CLIENT_ID || '';
  } else {
    params.client_id = env.OURA_CLIENT_ID || '';
    params.client_secret = env.OURA_CLIENT_SECRET || '';
  }
  try {
    const res = await fetch(TOKEN_URL, { method: 'POST', headers, body: new URLSearchParams(params) });
    const text = await res.text();
    return { variant, status: res.status, ok: res.ok, preview: text.slice(0, 220), full: text };
  } catch (e) {
    return { variant, status: 0, ok: false, preview: String((e && e.message) || e) };
  }
}

/**
 * 依次尝试不同请求格式，找到 Oura 接受的那一种并保存新令牌。
 * 用于排查 refresh 返回 invalid_request 的情况。
 */
export async function refreshVariants(env) {
  const rec = await readTokens(env);
  if (!rec || !rec.refresh_token) return { error: 'no-auth：KV 里没有 refresh_token' };

  const results = [];
  for (const v of VARIANTS) {
    const r = await tryRefresh(env, rec, v);
    results.push({ variant: r.variant, status: r.status, ok: r.ok, response: r.preview });
    if (r.ok) {
      try {
        const j = JSON.parse(r.full);
        const saved = await saveTokens(env, j, rec);
        return {
          ok: true,
          winner: v,
          results,
          scope: saved.scope || null,
          expires_at: new Date(saved.expires_at).toISOString(),
          note: '已换到新令牌，现在访问 /probe 看端点状态',
        };
      } catch (e) {
        return { ok: true, winner: v, results, note: `换取成功但解析失败：${e}` };
      }
    }
  }
  return { ok: false, results, hint: '三种写法都被拒绝，说明 refresh_token 本身已失效，需要重新授权' };
}

export async function clearTokens(env) {
  await env.KV.delete(KV_KEY);
}

/**
 * 拿到可用的 access_token。过期就自动用 refresh_token 换新的。
 * 返回 { token } 或 { error }
 */
// Oura 文档对 access_token 有效期的说法前后不一（24 小时 / 30 天），
// 而 token 是 opaque 的、本地无法校验。所以不信任 expires_at：
// 拿到手超过 20 小时就主动刷新一次，宁可多换一次也不要撞 401。
const MAX_AGE_MS = 20 * 3600 * 1000;

export async function getAccessToken(env) {
  const rec = await readTokens(env);
  if (!rec || !rec.refresh_token) return { error: 'no-auth', rec };

  const age = rec.updated_at ? Date.now() - Date.parse(rec.updated_at) : Infinity;
  const fresh = rec.access_token && rec.expires_at && Date.now() < rec.expires_at && age < MAX_AGE_MS;
  if (fresh) return { token: rec.access_token, rec };

  const r = await tokenRequest(env, {
    grant_type: 'refresh_token',
    refresh_token: rec.refresh_token,
  });
  if (r.error) return { error: `refresh-failed: ${r.error}`, rec };

  const saved = await saveTokens(env, r.data, rec);
  return { token: saved.access_token, rec: saved };
}

/** 单次刷新，供 401 后重试用 */
export async function refreshOnce(env) {
  const rec = await readTokens(env);
  if (!rec || !rec.refresh_token) return { error: 'no-auth' };
  const r = await tokenRequest(env, {
    grant_type: 'refresh_token',
    refresh_token: rec.refresh_token,
  });
  if (r.error) return { error: r.error };
  return { rec: await saveTokens(env, r.data, rec) };
}
