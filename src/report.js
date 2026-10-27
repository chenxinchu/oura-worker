// 把 Oura 原始数据整理成报告所需的扁平结构，并生成规则化建议

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayInTZ(tz) {
  // en-CA 的日期格式就是 YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function weekdayCN(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return WEEKDAY_CN[d.getUTCDay()];
}

export function dur(sec) {
  if (typeof sec !== 'number' || !isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function num(v, nd = 0, unit = '') {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return '—';
  if (typeof v === 'number' && isFinite(v)) {
    const s = v.toLocaleString('en-US', { minimumFractionDigits: nd, maximumFractionDigits: nd });
    return unit ? `${s}${unit}` : s;
  }
  return `${v}${unit}`;
}

export function signed(v, nd = 1) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  const t = Math.abs(v) < 0.5 * Math.pow(10, -nd) ? 0 : v;
  const s = t.toFixed(nd);
  return t > 0 ? `+${s}` : s;
}

export function grade(score) {
  if (typeof score !== 'number' || !isFinite(score)) return { label: '—', color: '#9ca3af' };
  if (score >= 85) return { label: '优秀', color: '#16a34a' };
  if (score >= 70) return { label: '良好', color: '#0ea5e9' };
  if (score >= 55) return { label: '一般', color: '#d97706' };
  return { label: '偏低', color: '#dc2626' };
}

function pickByDay(items) {
  const out = {};
  for (const it of items || []) {
    const d = it && it.day;
    if (d && !out[d]) out[d] = it;
  }
  return out;
}

function latestDay(byDay) {
  const keys = Object.keys(byDay).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

function mainSleep(sleeps, day) {
  let cands = (sleeps || []).filter((s) => s.day === day);
  if (!cands.length) cands = (sleeps || []).filter((s) => s.type === 'long_sleep');
  if (!cands.length) cands = sleeps || [];
  if (!cands.length) return {};
  const longs = cands.filter((s) => s.type === 'long_sleep');
  const pool = longs.length ? longs : cands;
  return pool.reduce((a, b) => ((b.total_sleep_duration || 0) > (a.total_sleep_duration || 0) ? b : a), pool[0]);
}

const STRESS_CN = { restored: '恢复充足', normal: '正常', stressful: '压力偏高', unknown: '—' };
const RESIL_CN = { limited: '有限', adequate: '尚可', solid: '稳定', strong: '强', exceptional: '极佳' };

export function buildPayload(raw, days, reportDay) {
  const sleepByDay = pickByDay(raw.daily_sleep);
  const readyByDay = pickByDay(raw.daily_readiness);
  const actByDay = pickByDay(raw.daily_activity);
  const stressByDay = pickByDay(raw.daily_stress);
  const resilByDay = pickByDay(raw.daily_resilience);
  const spo2ByDay = pickByDay(raw.daily_spo2);
  const cvByDay = pickByDay(raw.daily_cardiovascular_age);
  const vo2ByDay = pickByDay(raw.vo2_max);

  // 报告日：优先今天；今天没数据就退到最近有数据的一天
  let day = reportDay;
  if (!sleepByDay[day] && !readyByDay[day]) {
    day = latestDay(sleepByDay) || latestDay(readyByDay) || reportDay;
  }

  const detail = mainSleep(raw.sleep, day);
  const sleep = sleepByDay[day] || {};
  const ready = readyByDay[day] || {};
  // 活动必须是「完整的一天」。早上 9 点发报时今天才刚开始，
  // 取今天会得到几百步，所以固定看报告日的前一天。
  const actDay = addDays(day, -1);
  const act = actByDay[actDay] || actByDay[day] || {};
  const stress = stressByDay[day] || {};
  const resil = resilByDay[day] || {};
  const spo2 = spo2ByDay[day] || {};
  const cv = cvByDay[day] || cvByDay[latestDay(cvByDay)] || {};
  const vo2 = vo2ByDay[day] || vo2ByDay[latestDay(vo2ByDay)] || {};

  const trend = [];
  const trendAct = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(reportDay, -i);
    trend.push({
      day: d,
      label: d.slice(5).replace('-', '/'),
      sleep: (sleepByDay[d] || {}).score ?? null,
      readiness: (readyByDay[d] || {}).score ?? null,
    });
    // 活动趋势同样只取完整自然日，整体前移一天
    const da = addDays(d, -1);
    trendAct.push({
      day: da,
      label: da.slice(5).replace('-', '/'),
      activity: (actByDay[da] || {}).score ?? null,
    });
  }

  const avgOf = (arr, k) => {
    const vals = arr.map((t) => t[k]).filter((v) => typeof v === 'number');
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };

  return {
    report_day: day,
    is_today: day === reportDay,
    has_sleep: Boolean(sleepByDay[day] || detail.total_sleep_duration),
    days,
    person: raw.personal_info || {},
    sleep_score: sleep.score ?? null,
    readiness_score: ready.score ?? null,
    activity_score: act.score ?? null,
    detail,
    temp_dev: ready.temperature_deviation ?? null,
    ready_contrib: ready.contributors || {},
    steps: act.steps ?? null,
    active_cal: act.active_calories ?? null,
    total_cal: act.total_calories ?? null,
    sedentary: act.sedentary_time ?? null,
    stress_high: stress.stress_high ?? null,
    recovery_high: stress.recovery_high ?? null,
    stress_summary: STRESS_CN[stress.day_summary] || '—',
    resilience: RESIL_CN[resil.level] || '—',
    spo2: (spo2.spo2_percentage || {}).average ?? null,
    breathing_disturbance: spo2.breathing_disturbance_index ?? null,
    vascular_age: cv.vascular_age ?? null,
    vo2max: vo2.vo2_max ?? null,
    trend,
    trend_act: trendAct,
    act_day: actDay,
    avg: { sleep: avgOf(trend, 'sleep'), readiness: avgOf(trend, 'readiness'), activity: avgOf(trendAct, 'activity') },
  };
}

export function advice(p) {
  const out = [];
  const d = p.detail || {};
  const s = p.sleep_score;
  const r = p.readiness_score;
  const hrv = d.average_hrv;
  const temp = p.temp_dev;
  const steps = p.steps;

  if (typeof r === 'number') {
    if (r >= 85) out.push('<b>身体已完全恢复</b>，今天可以安排强度课（间歇 / 大重量），不用留力。');
    else if (r >= 70) out.push('<b>恢复良好</b>，中高强度训练没问题，建议控制在 60–75 分钟。');
    else if (r >= 55) out.push('<b>恢复一般</b>，把今天的主课降为 Zone 2 有氧或力量维持，别再堆强度。');
    else out.push('<b>恢复偏低</b>，今天优先休息、散步、拉伸，训练可以整体推迟一天。');
  }

  if (typeof s === 'number' && s < 70) {
    out.push('昨夜睡眠质量拖后腿，今晚提前 45 分钟上床，睡前 2 小时不碰咖啡因和屏幕。');
  } else if (typeof s === 'number' && s >= 85) {
    out.push('睡眠质量优秀，这个作息保持住就是最好的补剂。');
  }

  if (typeof temp === 'number' && Math.abs(temp) >= 0.4) {
    out.push(`体表温度偏差 ${signed(temp)}°C 明显${temp > 0 ? '偏高' : '偏低'}，留意是否感冒前兆或饮酒 / 晚睡影响。`);
  }

  if (typeof hrv === 'number' && hrv > 0 && hrv < 35) {
    out.push(`HRV ${hrv}ms 处于较低区间，交感神经偏紧张，今天加 10 分钟深呼吸或冥想。`);
  }

  if (typeof steps === 'number' && steps < 5000) {
    out.push(`昨天只走了 ${steps.toLocaleString('en-US')} 步，今天找机会补一段 20 分钟快走。`);
  }

  if (p.stress_summary === '压力偏高') {
    out.push('全天压力负荷偏高，晚上安排一段不看手机的放松时间。');
  }

  if (out.length < 2) {
    if (typeof d.latency === 'number' && d.latency > 1200) {
      out.push(`入睡用了 ${dur(d.latency)}，偏久；睡前 1 小时调暗灯光、做几组 4-7-8 呼吸。`);
    }
    if (typeof d.efficiency === 'number' && d.efficiency < 85) {
      out.push(`睡眠效率 ${d.efficiency}%，夜间觉醒偏多，睡前少喝水、卧室温度降到 19℃ 左右。`);
    }
    if (typeof steps === 'number' && steps >= 8000) {
      out.push('活动量已达标，注意补水与蛋白质摄入，帮夜间恢复加分。');
    }
  }

  if (out.length < 2) out.push('各项指标平稳，按既定作息和训练计划推进即可。');
  return out.slice(0, 4);
}
