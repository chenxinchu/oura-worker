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
const WEEKLY_INSIGHT_PROMPT_VERSION = 'weekly-v2';
const MONTHLY_INSIGHT_PROMPT_VERSION = 'monthly-v2';

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
    overtime: /加班|overtime|overwork/.test(joined),
  };
}

// 每个标签都保留原文和使用边界，避免模型把用户记录直接写成医学因果。
function tagContext(tags) {
  return tags.map((label) => {
    const value = label.toLowerCase();
    let use = '用户记录背景；只在有对应指标时纳入判断，不推断因果。';
    if (/生理期（经期）|经期|menstruation|period/.test(value)) use = '生理周期背景；优先按周期波动理解相关指标。';
    else if (/生理期（经前）|经前|premenstrual|pms/.test(value)) use = '经前周期背景；优先按周期波动理解相关指标。';
    else if (/宝宝夜醒频繁|child.*wake|baby.*wake/.test(value)) use = '夜间照料背景；结合夜间清醒和恢复指标判断。';
    else if (/今天休息不跑步|休息不跑步/.test(value)) use = '训练安排限制；当天不安排跑步。';
    else if (/力量训练|strength/.test(value)) use = '近期训练背景；结合恢复、HRV 和压力判断。';
    else if (/感冒|cold|sick/.test(value)) use = '身体不适记录；结合恢复和 HRV 判断，不作诊断。';
    else if (/加班|overtime|overwork/.test(value)) use = '工作负荷背景；结合压力和恢复时间判断。';
    return { label, use };
  });
}

function percentBelow(value, baseline) {
  if (typeof value !== 'number' || typeof baseline?.avg !== 'number' || baseline.avg <= 0 || baseline.n < 5) return null;
  return Math.round((1 - value / baseline.avg) * 100);
}

function percentAbove(value, baseline) {
  if (typeof value !== 'number' || typeof baseline?.avg !== 'number' || baseline.avg <= 0 || baseline.n < 5) return null;
  return Math.round((value / baseline.avg - 1) * 100);
}

function clock(minute) {
  if (typeof minute !== 'number' || !isFinite(minute)) return null;
  const normalized = ((Math.round(minute) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

// 建议候选由规则层先绑定事实，模型只能选择和润色，不能自行拼接因果。
function dailyAdviceChains(p) {
  const d = p.detail || {};
  const base = p.baseline || {};
  const hrvDrop = percentBelow(d.average_hrv, base.hrv);
  const sleepDrop = percentBelow(d.total_sleep_duration, base.total_sleep);
  const stressRise = percentAbove(p.stress_high, base.stress_high);
  const readinessDrop = typeof p.readiness_score === 'number' && typeof base.readiness?.avg === 'number'
    ? Math.round(base.readiness.avg - p.readiness_score)
    : null;
  const bedtimeDelay = typeof p.bedtime_minute === 'number' && typeof base.bedtime?.avg === 'number' && base.bedtime.n >= 5
    ? Math.round(p.bedtime_minute - base.bedtime.avg)
    : null;
  const bedtimeTarget = base.bedtime?.n >= 5 ? clock(base.bedtime?.avg) : null;
  const chains = [];

  if (hrvDrop >= 10 && bedtimeDelay >= 30) {
    chains.push({
      anomaly: `HRV ${Math.round(d.average_hrv)}ms，较个人基线低 ${hrvDrop}%`,
      factor: `可能与昨夜较平时晚 ${bedtimeDelay} 分钟入睡有关`,
      action: `今晚 ${bedtimeTarget || '按平时就寝时间'} 前入睡，今天避免高强度训练`,
    });
  } else if (hrvDrop >= 10 && typeof d.awake_time === 'number' && (d.awake_time > 30 * 60 || d.awake_time > (base.awake?.avg || Infinity) * 1.25)) {
    chains.push({
      anomaly: `HRV ${Math.round(d.average_hrv)}ms，较个人基线低 ${hrvDrop}%`,
      factor: `可能与昨夜清醒 ${durationText(d.awake_time)}、睡眠不够连贯有关`,
      action: '今天改为轻松活动，今晚预留 20 分钟无屏幕放松',
    });
  }

  if (sleepDrop >= 10 && bedtimeDelay >= 30) {
    chains.push({
      anomaly: `总睡眠 ${durationText(d.total_sleep_duration)}，较个人基线少 ${sleepDrop}%`,
      factor: `可能与昨夜较平时晚 ${bedtimeDelay} 分钟入睡有关`,
      action: `今晚 ${bedtimeTarget || '比平时提前 30 分钟'} 前上床，下午后避免咖啡因`,
    });
  } else if (sleepDrop >= 10 && typeof d.awake_time === 'number' && d.awake_time > 30 * 60) {
    chains.push({
      anomaly: `总睡眠 ${durationText(d.total_sleep_duration)}，较个人基线少 ${sleepDrop}%`,
      factor: `可能与夜间清醒 ${durationText(d.awake_time)} 有关`,
      action: '今晚睡前 1 小时减少屏幕和饮水，给自己留出更完整的睡眠窗口',
    });
  }

  if (stressRise >= 25 && typeof p.recovery_high === 'number' && (p.recovery_high < 30 * 60 || p.recovery_high < (base.recovery_high?.avg || Infinity) * 0.7)) {
    chains.push({
      anomaly: `昨日高压力 ${durationText(p.stress_high)}，较个人基线高 ${stressRise}%`,
      factor: `可能与恢复时长只有 ${durationText(p.recovery_high)}、没有充分放松有关`,
      action: '今天安排两次 10 分钟离开屏幕的慢走或呼吸练习，晚上不加练',
    });
  }

  if (readinessDrop >= 8 && base.readiness?.n >= 5 && typeof p.ready_contrib?.recovery_index === 'number' &&
    typeof base.recovery?.avg === 'number' && base.recovery.n >= 5 && p.ready_contrib.recovery_index <= base.recovery.avg - 8) {
    chains.push({
      anomaly: `准备度 ${Math.round(p.readiness_score)} 分，较个人基线低 ${readinessDrop} 分`,
      factor: `可能与恢复指数低于平时 ${Math.round(base.recovery.avg - p.ready_contrib.recovery_index)} 分有关`,
      action: '取消间歇、冲刺和大重量训练，改为散步、拉伸或 Zone 2 活动',
    });
  }

  const hasSleepAdvice = chains.some((item) => /HRV|总睡眠|准备度/.test(item.anomaly));
  const hasActivityAdvice = chains.some((item) => /活动|步数|久坐/.test(item.anomaly));
  const hasStressAdvice = chains.some((item) => /高压力|压力/.test(item.anomaly));
  const stableChains = [
    !hasSleepAdvice && {
      anomaly: '睡眠与恢复数据当前没有明显偏离个人基线',
      factor: '可能说明昨夜恢复窗口基本稳定',
      action: '按既定训练和作息推进，今晚保持平时就寝时间',
    },
    !hasActivityAdvice && {
      anomaly: '昨日活动量当前没有明显失衡',
      factor: '可能说明活动节奏与恢复尚能配合',
      action: '今天保持日间短时活动，避免连续久坐超过 1 小时',
    },
    !hasStressAdvice && {
      anomaly: '压力与恢复时间当前没有明显警讯',
      factor: '可能说明日间压力暂时维持在可控范围',
      action: '晚上保留 20 分钟无屏幕放松，为明天恢复留出余量',
    },
  ].filter(Boolean);
  for (const item of stableChains) {
    if (chains.length >= 3) break;
    chains.push(item);
  }
  return chains.slice(0, 3);
}

function buildCoachContext(p, env) {
  const profile = profileFromEnv(env);
  const tags = Array.isArray(p.user_tags) ? p.user_tags : [];
  const flags = tagFlags(tags);
  const tag_context = tagContext(tags);
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
  const awakeBase = p.baseline?.awake?.avg;
  const sleepShort = typeof p.detail?.total_sleep_duration === 'number' && typeof p.baseline?.total_sleep?.avg === 'number'
    ? p.detail.total_sleep_duration < p.baseline.total_sleep.avg * 0.9
    : false;
  const sleepInterrupted = typeof p.detail?.awake_time === 'number' &&
    (p.detail.awake_time > 30 * 60 || (typeof awakeBase === 'number' && p.detail.awake_time > awakeBase * 1.25));
  const stressBase = p.baseline?.stress_high?.avg;
  const highStress = typeof p.stress_high === 'number' &&
    (p.stress_high > 2 * 3600 || (typeof stressBase === 'number' && p.stress_high > stressBase * 1.25));
  const recoveryTimeLow = typeof p.recovery_high === 'number' && p.recovery_high < 30 * 60;
  let risk = 'green';
  if (!flags.period && ((typeof recoveryDrop === 'number' && recoveryDrop <= -15) || (typeof p.detail?.average_hrv === 'number' && typeof hrvBase.avg === 'number' && p.detail.average_hrv < hrvBase.avg * 0.75))) risk = 'red';
  else if ((typeof recoveryDrop === 'number' && recoveryDrop <= -8) || hrvLow) risk = 'yellow';
  const readiness_drivers = [];
  if (flags.period || flags.premenstrual) readiness_drivers.push('生理周期波动');
  if (flags.child_waking && sleepInterrupted) readiness_drivers.push('宝宝夜醒记录下夜间睡眠被打断');
  else if (sleepInterrupted) readiness_drivers.push(profile.night_childcare ? '夜间睡眠被打断' : '夜间清醒偏多');
  else if (sleepShort) readiness_drivers.push('睡眠时间比平时少');
  if (flags.illness && (hrvLow || (typeof recoveryDrop === 'number' && recoveryDrop <= -8))) readiness_drivers.push('感冒记录下恢复偏弱');
  if (flags.overtime && (highStress || recoveryTimeLow)) readiness_drivers.push('加班记录下压力没有放下来');
  if (flags.strength && (hrvLow || (typeof recoveryDrop === 'number' && recoveryDrop <= -8))) readiness_drivers.push('力量训练记录下恢复不足');
  if (hrvLow) readiness_drivers.push('HRV 比平时低');
  if (typeof recoveryDrop === 'number' && recoveryDrop <= -8) readiness_drivers.push('恢复不够');
  if (highStress || recoveryTimeLow) readiness_drivers.push('压力没有放下来');
  const tag_factors = [];
  if (flags.child_waking) tag_factors.push('宝宝夜醒频繁标签');
  if (flags.overtime) tag_factors.push('加班标签');
  if (flags.illness) tag_factors.push('感冒标签');
  if (flags.strength) tag_factors.push('力量训练标签');
  if ((flags.period || flags.premenstrual) && !tag_factors.length) tag_factors.push('生理周期标签');
  const pressure_factors = [
    ...tag_factors,
    ...(profile.night_childcare && p.pressure_factors?.includes('夜间清醒偏多') ? ['夜间照料幼儿'] : []),
    ...(p.pressure_factors || []),
  ];
  return {
    profile,
    tags,
    tag_context,
    flags,
    run_day,
    training_plan,
    baseline_mode: Object.values(p.baseline || {}).some((b) => b?.n > 0 && b.n < 7) ? '样本不足7天，部分指标仅参考昨日' : '近7天个人基线',
    risk,
    readiness_drivers: readiness_drivers.slice(0, 3),
    pressure_factors: [...new Set(pressure_factors)].slice(0, 3),
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
      activity: {
        day: p.act_day,
        steps: p.steps,
        active_calories: p.active_cal,
        total_calories: p.total_cal,
        sedentary: { minutes: durationMinutes(p.sedentary), display: durationText(p.sedentary) },
        load: p.activity_load,
      },
      stress: {
        high: { minutes: durationMinutes(p.stress_high), display: durationText(p.stress_high) },
        recovery: { minutes: durationMinutes(p.recovery_high), display: durationText(p.recovery_high) },
        summary: p.stress_summary,
        load: p.pressure_load,
        factors: coach.pressure_factors,
      },
      health: { spo2: p.spo2, apnea_index: p.breathing_disturbance, cardio_age: p.vascular_age, vo2max: p.vo2max },
      baseline: aiBaseline(p.baseline),
      advice_candidates: dailyAdviceChains(p),
      changes_vs_yesterday: { sleep_score: p.cmp?.sleep || null, readiness_score: p.cmp?.readiness || null, activity_score: p.cmp?.activity || null },
      trend: p.avg,
      // 所有标签均带使用边界传给模型，避免只把少数已识别标签用于判断。
      tags: coach.tag_context,
      coaching_rules: coach,
    },
  };
}

export function buildPeriodInsightContext(p) {
  return {
    kind: p.kind,
    key: `${p.period.start}:${p.period.end}`,
    prompt_version: p.kind === 'weekly' ? WEEKLY_INSIGHT_PROMPT_VERSION : p.kind === 'monthly' ? MONTHLY_INSIGHT_PROMPT_VERSION : INSIGHT_PROMPT_VERSION,
    facts: {
      period: { start: p.period.start, end: p.period.end, coverage: p.coverage, days_with_sleep: p.cur.n.sleep },
      averages: p.cur.avg,
      previous_averages: p.has_prev ? p.prev.avg : null,
      comparison: p.rows.map(({ k, cur, prev, delta }) => ({ k, cur, prev: p.has_prev ? prev : null, delta: p.has_prev ? delta : null })),
      tags: p.user_tags || [],
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
  const hrv = p.detail?.average_hrv;
  const hrvBase = p.baseline?.hrv?.avg;
  const interrupted = typeof awake === 'number' && awake > 1800;
  const short = typeof total === 'number' && typeof p.baseline?.total_sleep?.avg === 'number' && total < p.baseline.total_sleep.avg * 0.9;
  const hrvLow = typeof hrv === 'number' && typeof hrvBase === 'number' && hrv < hrvBase * 0.9;
  if (interrupted && hrvLow) {
    return coach.profile.night_childcare
      ? '整体睡得不够连贯，夜间照料中断和 HRV 回落一起拖慢恢复'
      : '整体睡得不够连贯，夜间清醒和 HRV 回落一起拖慢恢复';
  }
  if (short || (typeof eff === 'number' && eff < 85)) return '整体睡眠质量偏弱，睡眠时长或效率没有回到平时水平';
  if (typeof total === 'number') return '整体睡眠比较平稳，时长和夜间恢复没有明显短板';
  return '睡眠数据不足，暂时无法判断整体恢复情况';
}

function bodySentence(p, coach) {
  const hrv = p.detail?.average_hrv;
  const hrvBase = p.baseline?.hrv?.avg;
  const recovery = p.ready_contrib?.recovery_index;
  const recoveryBase = p.baseline?.recovery?.avg;
  const hrvLow = typeof hrv === 'number' && typeof hrvBase === 'number' && hrv < hrvBase * 0.95;
  const recoveryWeak = typeof recovery === 'number' && (typeof recoveryBase === 'number' ? recovery < recoveryBase - 8 : recovery < 70);
  if (coach.flags.period || coach.flags.premenstrual) return '身体指标有些波动，优先按生理周期带来的变化理解';
  if (hrvLow && recoveryWeak) return '身体恢复偏弱，HRV 回落和恢复储备不足是主要原因';
  if (coach.risk !== 'green') return '身体还没完全缓过来，恢复和压力指标需要多留意';
  if (typeof hrv === 'number' || typeof recovery === 'number') return '身体状态整体平稳，恢复指标和心率表现没有明显异常';
  return '身体状态数据不足，暂时无法形成综合判断';
}

function activitySentence(p) {
  const stepsBase = p.baseline?.steps?.avg;
  const highActivity = typeof p.steps === 'number' && (typeof stepsBase === 'number' ? p.steps > stepsBase * 1.1 : p.steps > 10000);
  if (p.activity_load?.level === '偏高' || highActivity) return '昨天活动量偏高，今天需要给身体留出恢复空间';
  if (p.activity_load?.level === '偏低') return '昨天活动量偏少，今天可安排一段轻松活动';
  if (typeof p.steps === 'number') return '昨天活动节奏适中，步数和消耗都在平时范围附近';
  return '活动数据不足，暂时无法形成综合判断';
}

function trendState(p, key) {
  const avg = score(p.avg?.[key]);
  const baseline = p.baseline?.[key];
  const base = score(baseline?.avg);
  if (avg === null || base === null || baseline.n < 5) return null;
  if (avg <= base - 4) return 'low';
  if (avg >= base + 4) return 'high';
  return 'steady';
}

function trendSentence(p) {
  const sleep = trendState(p, 'sleep');
  const readiness = trendState(p, 'readiness');
  const activity = trendState(p, 'activity');
  if (!sleep || !readiness || !activity) {
    return '近几天的恢复节奏还在形成，今天先看睡眠、准备度和活动是否协调，再决定训练强度。';
  }
  if (sleep === 'low' && readiness === 'low') {
    return '近几天睡眠和准备度没有形成稳定恢复节奏，活动安排应跟着收一收；今天以轻松活动和规律作息为主，避免额外加量。';
  }
  if (activity === 'high' && (sleep === 'low' || readiness === 'low')) {
    return '近几天活动推进较快，但恢复没有同步跟上；今天把训练留在舒适强度，并给晚上留出放松空间。';
  }
  if (activity === 'low' && (sleep === 'low' || readiness === 'low')) {
    return '近几天活动已收敛，但恢复节奏仍不够稳；今天维持轻松活动，优先把睡眠和放松安排完整。';
  }
  if (activity === 'high') {
    return '近几天活动节奏积极，睡眠和准备度仍能配合；今天可按计划推进，但不需要额外堆高强度。';
  }
  return '近几天睡眠、准备度和活动的配合较平稳；今天按原计划活动，继续给恢复留出余量。';
}

function pressureSentence(p, coach) {
  const factors = coach.pressure_factors || [];
  const suffix = factors.length ? `，主要伴随${factors.slice(0, 2).join('、')}` : '';
  if (p.pressure_load?.level === '偏高') return `压力没有充分释放${suffix}`;
  if (p.pressure_load?.level === '需要留意') return `压力和恢复之间不够平衡${suffix}`;
  return factors.length ? `压力整体可控，但仍需留意${factors[0]}` : '压力和恢复时间整体比较平衡';
}

// 模型尚未启用时，沿用既有规则建议，确保报告质量和发送成功率不受外部服务影响。
export function buildDailyRuleInsight(p) {
  const coach = p.coach || buildCoachContext(p);
  p.coach = coach;
  const summaryBody = coach.flags.rest_day
    ? '今天先休息，不安排跑步；分几次做短暂拉伸就够了。'
    : coach.flags.period
    ? '生理周期带来的波动优先考虑，今天用慢走和拉伸替代高强度训练。'
    : coach.risk === 'red'
    ? '昨天消耗和压力都偏高，身体还没缓过来；今天别加练，先把节奏放慢。'
    : coach.risk === 'yellow'
    ? '恢复比平时差一些，今天把训练降一级；优先做轻松活动和放松。'
    : coach.run_day
    ? '恢复比较平稳，可以跑步；控制在轻松配速，不用追速度。'
    : '整体状态平稳，按原计划活动；晚上留一点时间让自己放松下来。';
  const tagLabels = coach.tags.join('、');
  const summary = tagLabels
    ? `结合${tagLabels.length > 40 ? '当日全部标签' : tagLabels}记录与睡眠、恢复、压力和活动指标，${summaryBody}`
    : summaryBody;
  return validateDailyInsight({
    source: 'rules',
    summary,
    readiness_reason: coach.readiness_drivers.length ? coach.readiness_drivers.join('，') : '今天的准备度和最近一周接近',
    sections: {
      sleep: sleepSentence(p, coach),
      body: bodySentence(p, coach),
      activity: activitySentence(p),
      pressure: pressureSentence(p, coach),
    },
    trend_summary: trendSentence(p),
    advice_chains: dailyAdviceChains(p),
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

export async function resolveDailyInsight(env, p) {
  p.coach = buildCoachContext(p, env);
  const insight = await resolveInsight(env, buildDailyInsightContext(p, env), buildDailyRuleInsight(p), validateDailyInsight);
  // 因果链必须保留规则层已验证的事实关系，不允许模型改写或拼接新的关联。
  return { ...insight, advice_chains: dailyAdviceChains(p) };
}

export function resolvePeriodInsight(env, p) {
  return resolveInsight(env, buildPeriodInsightContext(p), buildPeriodRuleInsight(p), validateInsight);
}
