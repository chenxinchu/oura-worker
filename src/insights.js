// 将已聚合的报告事实转换为受限洞察。此文件不读取 Oura 原始数据，也不发起模型请求。

import { dur } from './report.js';
import { INSIGHT_CAUTION, INSIGHT_PROMPT_VERSION, validateDailyInsight, validateInsight } from './insight-schema.js';
import { readInsight, saveInsight } from './store.js';
import { generateLlmInsight } from './llm.js';

const stripHtml = (text) => String(text || '').replace(/<[^>]*>/g, '');
const score = (value) => (typeof value === 'number' ? Math.round(value) : null);
const durationMinutes = (value) => (typeof value === 'number' && isFinite(value) ? Math.round(value / 60) : null);
const durationText = (value) => dur(value);
const DURATION_BASELINES = new Set(['total_sleep', 'deep', 'rem', 'awake', 'sedentary', 'stress_high', 'recovery_high']);

function aiBaseline(baseline) {
  return Object.fromEntries(
    Object.entries(baseline || {}).map(([key, value]) => [
      key,
      DURATION_BASELINES.has(key)
        ? { avg_minutes: durationMinutes(value?.avg), display: durationText(value?.avg), n: value?.n || 0 }
        : value,
    ])
  );
}

function profileFromEnv(env) {
  const fallback = { night_childcare: true, run_days: [2, 4, 6] };
  if (!env?.USER_PROFILE_JSON) return fallback;
  try {
    const input = JSON.parse(env.USER_PROFILE_JSON);
    return {
      night_childcare: input.night_childcare !== false,
      run_days: Array.isArray(input.run_days) ? input.run_days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : fallback.run_days,
    };
  } catch {
    return fallback;
  }
}

function tagFlags(tags) {
  const joined = tags.join('｜').toLowerCase();
  return {
    period: /生理期（经期）|经期|menstruation|period/.test(joined),
    premenstrual: /生理期（经前）|经前|premenstrual|pms/.test(joined),
    child_waking: /宝宝夜醒频繁|child.*wake|baby.*wake/.test(joined),
    rest_day: /今天休息不跑步|休息不跑步/.test(joined),
    strength: /力量训练|strength/.test(joined),
    illness: /感冒|cold|sick/.test(joined),
  };
}

function buildCoachContext(p, env) {
  const profile = profileFromEnv(env);
  const tags = Array.isArray(p.user_tags) ? p.user_tags : [];
  const flags = tagFlags(tags);
  const weekday = new Date(`${p.report_day}T00:00:00Z`).getUTCDay();
  const run_day = profile.run_days.includes(weekday);
  const hrvBase = p.baseline?.hrv || {};
  const hrvLow = typeof p.detail?.average_hrv === 'number' && typeof hrvBase.avg === 'number' && p.detail.average_hrv < hrvBase.avg * 0.88;
  const readinessLow = typeof p.readiness_score === 'number' && p.readiness_score < 70;
  let training_plan = '恢复、拉伸或日常活动';
  if (flags.rest_day) training_plan = '单日标签优先：今天休息，不安排跑步';
  else if (flags.period) training_plan = '经期优先：低强度慢走或拉伸，不安排高强度训练';
  else if (run_day && (readinessLow || hrvLow)) training_plan = '跑步日但恢复不足：取消跑步，改碎片化快走或拉伸';
  else if (run_day) training_plan = '跑步日：低强度慢跑，控制时长和心率，避免冲刺';
  const recoveryBase = p.baseline?.recovery || {};
  const recoveryDrop = typeof p.ready_contrib?.recovery_index === 'number' && typeof recoveryBase.avg === 'number'
    ? p.ready_contrib.recovery_index - recoveryBase.avg
    : null;
  let risk = 'green';
  if (!flags.period && ((typeof recoveryDrop === 'number' && recoveryDrop <= -15) || (typeof p.detail?.average_hrv === 'number' && typeof hrvBase.avg === 'number' && p.detail.average_hrv < hrvBase.avg * 0.75))) risk = 'red';
  else if ((typeof recoveryDrop === 'number' && recoveryDrop <= -8) || hrvLow) risk = 'yellow';
  return {
    profile,
    tags,
    flags,
    run_day,
    training_plan,
    baseline_mode: Object.values(p.baseline || {}).some((b) => b?.n > 0 && b.n < 7) ? '样本不足7天，部分指标仅参考昨日' : '近7天个人基线',
    risk,
  };
}

// 同一份最小化事实和 prompt 版本得到同一个 key，供模型启用后的 D1 缓存使用。
export async function hashInsightContext(context) {
  const bytes = new TextEncoder().encode(JSON.stringify(context));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildDailyInsightContext(p, env) {
  const coach = p.coach || buildCoachContext(p, env);
  return {
    kind: 'daily',
    key: p.report_day,
    prompt_version: INSIGHT_PROMPT_VERSION,
    facts: {
      report_day: p.report_day,
      scores: { sleep: score(p.sleep_score), readiness: score(p.readiness_score), activity: score(p.activity_score) },
      sleep: {
        total_sleep: { minutes: durationMinutes(p.detail?.total_sleep_duration), display: durationText(p.detail?.total_sleep_duration) },
        time_in_bed: { minutes: durationMinutes(p.detail?.time_in_bed), display: durationText(p.detail?.time_in_bed) },
        efficiency: p.detail?.efficiency ?? null,
        deep_sleep: { minutes: durationMinutes(p.detail?.deep_sleep_duration), display: durationText(p.detail?.deep_sleep_duration) },
        rem_sleep: { minutes: durationMinutes(p.detail?.rem_sleep_duration), display: durationText(p.detail?.rem_sleep_duration) },
        light_sleep: { minutes: durationMinutes(p.detail?.light_sleep_duration), display: durationText(p.detail?.light_sleep_duration) },
        awake: { minutes: durationMinutes(p.detail?.awake_time), display: durationText(p.detail?.awake_time) },
        average_hrv: p.detail?.average_hrv ?? null,
        average_heart_rate: p.detail?.average_heart_rate ?? null,
        lowest_heart_rate: p.detail?.lowest_heart_rate ?? null,
        average_breath: p.detail?.average_breath ?? null,
      },
      readiness: { contributors: p.ready_contrib, temperature_deviation: p.temp_dev },
      activity: { day: p.act_day, steps: p.steps, active_calories: p.active_cal, total_calories: p.total_cal, sedentary: { minutes: durationMinutes(p.sedentary), display: durationText(p.sedentary) } },
      stress: { high: { minutes: durationMinutes(p.stress_high), display: durationText(p.stress_high) }, recovery: { minutes: durationMinutes(p.recovery_high), display: durationText(p.recovery_high) }, summary: p.stress_summary },
      health: { spo2: p.spo2, apnea_index: p.breathing_disturbance, cardio_age: p.vascular_age, vo2max: p.vo2max },
      baseline: aiBaseline(p.baseline),
      changes_vs_yesterday: { sleep_score: p.cmp?.sleep || null, readiness_score: p.cmp?.readiness || null, activity_score: p.cmp?.activity || null },
      trend: p.avg,
      tags: coach.tags,
      coaching_rules: coach,
    },
  };
}

export function buildPeriodInsightContext(p) {
  return {
    kind: p.kind,
    key: `${p.period.start}:${p.period.end}`,
    prompt_version: INSIGHT_PROMPT_VERSION,
    facts: {
      period: { start: p.period.start, end: p.period.end, coverage: p.coverage, days_with_sleep: p.cur.n.sleep },
      averages: p.cur.avg,
      previous_averages: p.has_prev ? p.prev.avg : null,
      comparison: p.rows.map(({ k, cur, prev, delta }) => ({ k, cur, prev: p.has_prev ? prev : null, delta: p.has_prev ? delta : null })),
    },
  };
}

function fromAdvice(summary, items) {
  const priorities = items.slice(0, 3).map((action, index) => ({
    title: ['恢复安排', '睡眠与作息', '活动与压力'][index] || '今日重点',
    reason: '基于本次报告中已计算的指标与趋势。',
    action: stripHtml(action),
  }));
  return validateInsight({ source: 'rules', summary, priorities, caution: INSIGHT_CAUTION });
}

// 规则版的一句话点评：判断在前、证据在后，长度控制在一行内，直接内嵌进数据卡片
function sleepSentence(p, coach) {
  const total = p.detail?.total_sleep_duration;
  const eff = p.detail?.efficiency;
  const awake = p.detail?.awake_time;
  const parts = [typeof total === 'number' ? `总睡眠 ${dur(total)}` : '睡眠数据缺失'];
  if (typeof awake === 'number' && awake > 1800) {
    parts.push(coach.profile.night_childcare ? '夜间清醒来自照料中断' : '夜间清醒是主要消耗');
  } else if (typeof eff === 'number') {
    parts.push(eff >= 85 ? '睡眠结构稳定' : '睡眠效率偏低');
  }
  return parts.join('，');
}

function bodySentence(p, coach) {
  const hrv = p.detail?.average_hrv;
  const hrvBase = p.baseline?.hrv?.avg;
  const recovery = p.ready_contrib?.recovery_index;
  const recoveryBase = p.baseline?.recovery?.avg;
  const parts = [];
  if (typeof hrv === 'number') {
    if (typeof hrvBase !== 'number') parts.push(`HRV ${Math.round(hrv)}ms`);
    else parts.push(hrv < hrvBase * 0.95 ? 'HRV 回落' : hrv > hrvBase * 1.05 ? 'HRV 抬升' : 'HRV 持平');
  }
  if (typeof recovery === 'number') {
    const weak = typeof recoveryBase === 'number' ? recovery < recoveryBase - 8 : recovery < 70;
    parts.push(weak ? '恢复储备偏弱' : '恢复储备充足');
  }
  if (coach.flags.period || coach.flags.premenstrual) parts.push('波动优先按生理周期理解');
  else if (coach.risk !== 'green') parts.push('压力负荷偏高');
  return parts.join('，') || '生理指标数据缺失';
}

function activitySentence(p) {
  const stepsBase = p.baseline?.steps?.avg;
  const parts = [];
  if (typeof p.steps === 'number') {
    const high = typeof stepsBase === 'number' ? p.steps > stepsBase * 1.1 : p.steps > 10000;
    parts.push(high ? '昨日活动量偏高' : '昨日活动量适中');
  } else {
    parts.push('步数数据缺失');
  }
  if (typeof p.stress_high === 'number') parts.push(p.stress_high > 2 * 3600 ? '高压持续' : '高压时长可控');
  if (typeof p.recovery_high === 'number') parts.push(p.recovery_high < 30 * 60 ? '主动恢复时间不足' : '主动恢复充足');
  return parts.join('，');
}

// 模型尚未启用时，沿用既有规则建议，确保报告质量和发送成功率不受外部服务影响。
export function buildDailyRuleInsight(p) {
  const coach = p.coach || buildCoachContext(p);
  const summary = coach.flags.rest_day
    ? '今天休息不跑步，以碎片化恢复为主。'
    : coach.flags.period
    ? '生理周期波动优先，今天保持低强度活动。'
    : coach.risk === 'red'
    ? '恢复明显偏离基线，今天主动减负。'
    : coach.risk === 'yellow'
    ? '恢复偏弱，今天降低训练强度。'
    : coach.run_day
    ? '恢复稳定，跑步以轻松配速完成。'
    : '状态平稳，今天维持轻量恢复节奏。';
  const priority = coach.flags.rest_day
    ? '今天不跑步；分两次做 5 分钟拉伸即可。'
    : coach.flags.period
    ? '今天用慢走和拉伸替代高强度训练。'
    : coach.risk === 'red' || coach.risk === 'yellow'
    ? '取消高强度训练，改为两次 5 分钟慢走或拉伸。'
    : coach.run_day
    ? '慢跑时控制配速和时长，全程避免冲刺。'
    : '安排两次短时活动，避免久坐超过 1 小时。';
  return validateDailyInsight({
    source: 'rules',
    summary,
    sections: {
      sleep: sleepSentence(p, coach),
      body: bodySentence(p, coach),
      activity: activitySentence(p),
    },
    trend_summary: `近7天睡眠均分 ${score(p.avg?.sleep) ?? '—'}，准备度 ${score(p.avg?.readiness) ?? '—'}，以个人趋势为准。`,
    advice: {
      priority,
      watch: '睡前减少手机使用，给自己留出短暂放松时间。',
      avoid: coach.run_day ? '避免冲刺、长距离和高强度间歇。' : '避免高负荷活动。',
      observe: '明早查看 HRV、高压力时长和恢复时长。',
    },
    caution: INSIGHT_CAUTION,
  });
}

export function buildPeriodRuleInsight(p) {
  const name = p.kind === 'monthly' ? '本月' : '本周';
  const summary = `${name}睡眠数据覆盖 ${p.cur.n.sleep}/${p.cur.day_count} 天${p.has_prev ? '，并已与上期完成对比。' : '，上期数据不足，因此不做趋势比较。'}`;
  return fromAdvice(summary, p.advice || []);
}

async function resolveInsight(env, context, fallback, validate) {
  // 两项都未配置时完全不触网，方便先部署并观察规则版输出。
  if (!env.LLM_API_KEY || !env.LLM_BASE_URL || !env.LLM_MODEL) return fallback;

  try {
    const inputHash = await hashInsightContext(context);
    const cached = await readInsight(env, context.kind, context.key, inputHash, context.prompt_version);
    const cachedInsight = validate(cached && { ...cached.content, source: cached.source });
    if (cachedInsight && cachedInsight.source === 'llm') return cachedInsight;

    const generated = validate({ ...(await generateLlmInsight(env, context)), source: 'llm' });
    if (!generated) return fallback;

    // 缓存失败不影响本次报告；下次会再次尝试生成。
    await saveInsight(env, {
      report_type: context.kind,
      report_key: context.key,
      input_hash: inputHash,
      prompt_version: context.prompt_version,
      source: 'llm',
      model: env.LLM_MODEL,
      content: generated,
    });
    return generated;
  } catch (e) {
    console.log('[insight-resolve-failed]', String((e && e.name) || e));
    return fallback;
  }
}

export function resolveDailyInsight(env, p) {
  p.coach = buildCoachContext(p, env);
  return resolveInsight(env, buildDailyInsightContext(p, env), buildDailyRuleInsight(p), validateDailyInsight);
}

export function resolvePeriodInsight(env, p) {
  return resolveInsight(env, buildPeriodInsightContext(p), buildPeriodRuleInsight(p), validateInsight);
}
