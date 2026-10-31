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

// 严格版：只认这一天的记录，查不到就返回空对象。
// mainSleep 有「退到最近一条」的兜底，做对比时不能用它 ——
// 否则昨天没戴戒指会拿到前天的数据，算出一个假的变化。
function sleepOn(sleeps, day) {
  const cands = (sleeps || []).filter((s) => s && s.day === day);
  if (!cands.length) return {};
  const longs = cands.filter((s) => s.type === 'long_sleep');
  const pool = longs.length ? longs : cands;
  return pool.reduce((a, b) => ((b.total_sleep_duration || 0) > (a.total_sleep_duration || 0) ? b : a), pool[0]);
}

function avgWithCount(values) {
  const valid = values.filter((v) => typeof v === 'number' && isFinite(v));
  return {
    avg: valid.length ? Math.round((valid.reduce((sum, v) => sum + v, 0) / valid.length) * 10) / 10 : null,
    n: valid.length,
  };
}

// Oura Tag 在不同版本/类型中可能使用 day、start_day 或 start_time；统一映射到报告日。
function tagsOn(tags, day) {
  const out = [];
  for (const tag of tags || []) {
    if (!tag || typeof tag !== 'object') continue;
    const start = tag.start_day || tag.day || (tag.start_time || '').slice(0, 10);
    const end = tag.end_day || (tag.end_time || '').slice(0, 10) || start;
    if (!start || start > day || (end && end < day)) continue;
    const label = tag.tag_type_name || tag.tag_type_code || tag.comment || tag.name || tag.id;
    if (label) out.push(String(label));
  }
  return [...new Set(out)];
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
  // 压力和抗压水平也属于「一整天」的量，跟活动一样看完整日。
  // 早上 9 点取今天只能拿到 0 点到现在这几个小时，跟「昨日」卡片标题也对不上。
  const stress = stressByDay[actDay] || stressByDay[day] || {};
  const resil = resilByDay[actDay] || resilByDay[day] || {};
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

  // ---- 较前一日 ----
  // 每项都跟「它自己那一天」的前一天比：睡眠类比前一夜，活动类比前一日。
  // 活动整体滞后一天，所以它的基准日比睡眠再早一天，这是对的，不是错位。
  const prevDay = addDays(day, -1);
  const prevActDay = addDays(actDay, -1);
  const sPrev = sleepByDay[prevDay] || {};
  const rPrev = readyByDay[prevDay] || {};
  const aPrev = actByDay[prevActDay] || {};
  const stPrev = stressByDay[prevActDay] || {};
  const spPrev = spo2ByDay[prevDay] || {};
  const cvPrev = cvByDay[prevDay] || {};
  const vo2Prev = vo2ByDay[prevDay] || {};
  const dPrev = sleepOn(raw.sleep, prevDay);

  const cmp = {
    // 顶部三大评分：用绝对分数差，不用百分比（0–100 分制下百分比不直观）
    sleep: { cur: sleep.score, prev: sPrev.score, t: 'score', fmt: 'points', pref: 'up' },
    readiness: { cur: ready.score, prev: rPrev.score, t: 'score', fmt: 'points', pref: 'up' },
    activity: { cur: act.score, prev: aPrev.score, t: 'score', fmt: 'points', pref: 'up' },

    // 昨夜睡眠
    total_sleep: { cur: detail.total_sleep_duration, prev: dPrev.total_sleep_duration, t: 'dur', pref: 'up' },
    time_in_bed: { cur: detail.time_in_bed, prev: dPrev.time_in_bed, t: 'dur', pref: 'none' },
    light: { cur: detail.light_sleep_duration, prev: dPrev.light_sleep_duration, t: 'dur', pref: 'none' },
    awake: { cur: detail.awake_time, prev: dPrev.awake_time, t: 'dur', pref: 'down' },
    deep: { cur: detail.deep_sleep_duration, prev: dPrev.deep_sleep_duration, t: 'dur', pref: 'up' },
    rem: { cur: detail.rem_sleep_duration, prev: dPrev.rem_sleep_duration, t: 'dur', pref: 'up' },
    efficiency: { cur: detail.efficiency, prev: dPrev.efficiency, t: 'pct', pref: 'up' },
    latency: { cur: detail.latency, prev: dPrev.latency, t: 'dur', pref: 'down' },
    avg_hr: { cur: detail.average_heart_rate, prev: dPrev.average_heart_rate, t: 'int', pref: 'down' },
    hrv: { cur: detail.average_hrv, prev: dPrev.average_hrv, t: 'int', pref: 'up' },
    low_hr: { cur: detail.lowest_heart_rate, prev: dPrev.lowest_heart_rate, t: 'int', pref: 'down' },
    breath: { cur: detail.average_breath, prev: dPrev.average_breath, t: 'float1', pref: 'none' },

    // 身体状态
    resting_hr: {
      cur: (ready.contributors || {}).resting_heart_rate,
      prev: (rPrev.contributors || {}).resting_heart_rate,
      t: 'score',
      pref: 'up',
    },
    hrv_balance: {
      cur: (ready.contributors || {}).hrv_balance,
      prev: (rPrev.contributors || {}).hrv_balance,
      t: 'score',
      pref: 'up',
    },
    temp_dev: {
      cur: ready.temperature_deviation,
      prev: rPrev.temperature_deviation,
      t: 'float1',
      pref: 'none', // 体温偏差是「越接近 0 越好」，涨跌本身不分好坏，标灰
    },
    recovery_index: {
      cur: (ready.contributors || {}).recovery_index,
      prev: (rPrev.contributors || {}).recovery_index,
      t: 'score',
      pref: 'up',
    },
    spo2: {
      cur: (spo2.spo2_percentage || {}).average,
      prev: (spPrev.spo2_percentage || {}).average,
      t: 'float1',
      pref: 'up',
    },
    breathing: {
      cur: spo2.breathing_disturbance_index,
      prev: spPrev.breathing_disturbance_index,
      t: 'float1',
      pref: 'down',
    },
    vascular_age: { cur: cv.vascular_age, prev: cvPrev.vascular_age, t: 'int', pref: 'down' },
    vo2max: { cur: vo2.vo2_max, prev: vo2Prev.vo2_max, t: 'float1', pref: 'up' },

    // 活动与压力
    steps: { cur: act.steps, prev: aPrev.steps, t: 'int', pref: 'up' },
    active_cal: { cur: act.active_calories, prev: aPrev.active_calories, t: 'int', pref: 'up' },
    total_cal: { cur: act.total_calories, prev: aPrev.total_calories, t: 'int', pref: 'up' },
    sedentary: { cur: act.sedentary_time, prev: aPrev.sedentary_time, t: 'dur', pref: 'down' },
    stress_high: { cur: stress.stress_high, prev: stPrev.stress_high, t: 'dur', pref: 'down' },
    recovery_high: { cur: stress.recovery_high, prev: stPrev.recovery_high, t: 'dur', pref: 'up' },
    // 压力概况、抗压水平是等级文字，没有数值差，不做对比
  };

  // 个人基线：各指标只和本人最近 7 天的有效记录比较；n < 7 时渲染层会明确说明样本不足。
  const baselineDays = Array.from({ length: 7 }, (_, i) => addDays(day, -i));
  const base = {
    sleep: [], readiness: [], activity: [], total_sleep: [], time_in_bed: [], efficiency: [], latency: [], deep: [], rem: [], light: [], awake: [],
    hrv: [], avg_hr: [], min_hr: [], resp: [], resting_hr: [], hrv_balance: [], temp: [], recovery: [], spo2: [], apnea: [], vascular_age: [], vo2max: [],
    steps: [], active_cal: [], total_cal: [], sedentary: [], stress_high: [], recovery_high: [],
  };
  for (const d of baselineDays) {
    const sd = sleepByDay[d] || {};
    const rd = readyByDay[d] || {};
    const dd = sleepOn(raw.sleep, d);
    const ad = addDays(d, -1);
    const ac = actByDay[ad] || {};
    const st = stressByDay[ad] || {};
    const ox = spo2ByDay[d] || {};
    const ca = cvByDay[d] || {};
    const vm = vo2ByDay[d] || {};
    base.sleep.push(sd.score);
    base.readiness.push(rd.score);
    base.activity.push(ac.score);
    base.total_sleep.push(dd.total_sleep_duration);
    base.time_in_bed.push(dd.time_in_bed);
    base.efficiency.push(dd.efficiency);
    base.latency.push(dd.latency);
    base.deep.push(dd.deep_sleep_duration);
    base.rem.push(dd.rem_sleep_duration);
    base.light.push(dd.light_sleep_duration);
    base.awake.push(dd.awake_time);
    base.hrv.push(dd.average_hrv);
    base.avg_hr.push(dd.average_heart_rate);
    base.min_hr.push(dd.lowest_heart_rate);
    base.resp.push(dd.average_breath);
    base.resting_hr.push((rd.contributors || {}).resting_heart_rate);
    base.hrv_balance.push((rd.contributors || {}).hrv_balance);
    base.temp.push(rd.temperature_deviation);
    base.recovery.push((rd.contributors || {}).recovery_index);
    base.spo2.push((ox.spo2_percentage || {}).average);
    base.apnea.push(ox.breathing_disturbance_index);
    base.vascular_age.push(ca.vascular_age);
    base.vo2max.push(vm.vo2_max);
    base.steps.push(ac.steps);
    base.active_cal.push(ac.active_calories);
    base.total_cal.push(ac.total_calories);
    base.sedentary.push(ac.sedentary_time);
    base.stress_high.push(st.stress_high);
    base.recovery_high.push(st.recovery_high);
  }
  const baseline = Object.fromEntries(Object.entries(base).map(([key, values]) => [key, avgWithCount(values)]));
  const baseKey = {
    sleep: 'sleep', readiness: 'readiness', activity: 'activity', total_sleep: 'total_sleep', time_in_bed: 'time_in_bed',
    light: 'light', awake: 'awake', deep: 'deep', rem: 'rem', efficiency: 'efficiency', latency: 'latency',
    avg_hr: 'avg_hr', hrv: 'hrv', low_hr: 'min_hr', breath: 'resp', resting_hr: 'resting_hr',
    hrv_balance: 'hrv_balance', temp_dev: 'temp', recovery_index: 'recovery', spo2: 'spo2', breathing: 'apnea',
    vascular_age: 'vascular_age', vo2max: 'vo2max', steps: 'steps', active_cal: 'active_cal', total_cal: 'total_cal',
    sedentary: 'sedentary', stress_high: 'stress_high', recovery_high: 'recovery_high',
  };
  const base_cmp = Object.fromEntries(
    Object.entries(cmp).map(([key, item]) => {
      const ref = baseline[baseKey[key]];
      return [key, ref && typeof ref.avg === 'number' ? { ...item, prev: ref.avg } : null];
    })
  );

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
    user_tags: tagsOn(raw.tag, day),
    spo2: (spo2.spo2_percentage || {}).average ?? null,
    breathing_disturbance: spo2.breathing_disturbance_index ?? null,
    vascular_age: cv.vascular_age ?? null,
    vo2max: vo2.vo2_max ?? null,
    trend,
    trend_act: trendAct,
    act_day: actDay,
    prev_day: prevDay,
    prev_act_day: prevActDay,
    cmp,
    base_cmp,
    baseline,
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
