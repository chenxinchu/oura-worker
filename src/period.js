// 周报 / 月报：区间计算、聚合、环比、亮点、建议
// 与日报（report.js）共用同一份原始数据，区别只在统计区间和呈现口径

import { addDays, dur, signed, weekdayCN } from './report.js';

const DAY = 86400000;

const utc = (day) => new Date(`${day}T00:00:00Z`);
const numOrNull = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

function avg(arr) {
  const v = arr.filter((x) => typeof x === 'number' && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function total(arr) {
  const v = arr.filter((x) => typeof x === 'number' && isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

function count(arr) {
  return arr.filter((x) => typeof x === 'number' && isFinite(x)).length;
}

// ISO 周序号（周一为一周第一天）
export function isoWeek(day) {
  const t = utc(day);
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fdow = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fdow + 3);
  return 1 + Math.round((t - firstThu) / (7 * DAY));
}

function monthStart(y, m) {
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

// 上一个完整自然周（周一–周日）。发信日固定是周一，但写成通用逻辑：
// 无论哪天发，统计的都是「已经过完」的那个周。
export function weekRange(today) {
  const dow = (utc(today).getUTCDay() + 6) % 7; // 周一 = 0
  const thisMon = addDays(today, -dow);
  const end = addDays(thisMon, -1);
  const start = addDays(end, -6);
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -6);
  return { kind: 'weekly', start, end, prevStart, prevEnd, today };
}

// 上一个完整自然月
export function monthRange(today) {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - 1;
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  const start = monthStart(y, m);
  const end = addDays(m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1), -1);

  let py = y;
  let pm = m - 1;
  if (pm === 0) {
    pm = 12;
    py -= 1;
  }
  return {
    kind: 'monthly',
    start,
    end,
    prevStart: monthStart(py, pm),
    prevEnd: addDays(start, -1),
    today,
  };
}

export function periodFor(kind, today) {
  return kind === 'monthly' ? monthRange(today) : weekRange(today);
}

const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

export function rangeLabel(p) {
  if (p.kind === 'monthly') {
    const y = p.start.slice(0, 4);
    const m = Number(p.start.slice(5, 7));
    return {
      title: `${y}年${m}月`,
      short: `${m}月`,
      sub: `${md(p.start)} – ${md(p.end)} · ${daysBetween(p.start, p.end)} 天`,
      prevTitle: `较上月`,
    };
  }
  const w = isoWeek(p.start);
  return {
    title: `${md(p.start)} – ${md(p.end)}`,
    short: `${md(p.start)}–${Number(p.end.slice(8, 10))}`,
    sub: `第 ${w} 周 · ${daysBetween(p.start, p.end)} 天`,
    prevTitle: '较上周',
  };
}

export function daysBetween(a, b) {
  return Math.round((utc(b) - utc(a)) / DAY) + 1;
}

function firstByDay(items) {
  const out = {};
  for (const it of items || []) {
    if (it && it.day && !out[it.day]) out[it.day] = it;
  }
  return out;
}

// 每天取最长的一段 long_sleep，忽略小睡
function longSleepByDay(sleeps) {
  const out = {};
  for (const s of sleeps || []) {
    if (!s || !s.day) continue;
    if (s.type && s.type !== 'long_sleep') continue;
    const prev = out[s.day];
    if (!prev || (s.total_sleep_duration || 0) > (prev.total_sleep_duration || 0)) out[s.day] = s;
  }
  return out;
}

const BUCKETS = [
  'sleep',
  'readiness',
  'activity',
  'total_sleep',
  'deep',
  'rem',
  'efficiency',
  'latency',
  'hrv',
  'low_hr',
  'steps',
  'active_cal',
  'sedentary',
  'temp_dev',
  'spo2',
  'stress_high',
  'recovery_high',
];

export function aggregate(raw, start, end) {
  const sl = firstByDay(raw.daily_sleep);
  const rd = firstByDay(raw.daily_readiness);
  const ac = firstByDay(raw.daily_activity);
  const st = firstByDay(raw.daily_stress);
  const sp = firstByDay(raw.daily_spo2);
  const dt = longSleepByDay(raw.sleep);

  const days = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);

  const b = {};
  for (const k of BUCKETS) b[k] = [];
  const per_day = [];

  for (const d of days) {
    const s = sl[d] || {};
    const r = rd[d] || {};
    const a = ac[d] || {};
    const t = dt[d] || {};
    const x = st[d] || {};
    const o = sp[d] || {};
    const oxy = o.spo2_percentage || {};

    const row = {
      day: d,
      sleep: numOrNull(s.score),
      readiness: numOrNull(r.score),
      activity: numOrNull(a.score),
      steps: numOrNull(a.steps),
      hrv: numOrNull(t.average_hrv),
      total_sleep: numOrNull(t.total_sleep_duration),
      efficiency: numOrNull(t.efficiency),
      temp_dev: numOrNull(r.temperature_deviation),
    };
    per_day.push(row);

    b.sleep.push(row.sleep);
    b.readiness.push(row.readiness);
    b.activity.push(row.activity);
    b.total_sleep.push(row.total_sleep);
    b.deep.push(numOrNull(t.deep_sleep_duration));
    b.rem.push(numOrNull(t.rem_sleep_duration));
    b.efficiency.push(row.efficiency);
    b.latency.push(numOrNull(t.latency));
    b.hrv.push(row.hrv);
    b.low_hr.push(numOrNull(t.lowest_heart_rate));
    b.steps.push(row.steps);
    b.active_cal.push(numOrNull(a.active_calories));
    b.sedentary.push(numOrNull(a.sedentary_time));
    b.temp_dev.push(row.temp_dev);
    b.spo2.push(numOrNull(oxy.average));
    b.stress_high.push(numOrNull(x.stress_high));
    b.recovery_high.push(numOrNull(x.recovery_high));
  }

  const averages = {};
  for (const k of BUCKETS) averages[k] = avg(b[k]);

  return {
    start,
    end,
    day_count: days.length,
    n: {
      sleep: count(b.sleep),
      readiness: count(b.readiness),
      activity: count(b.activity),
      detail: count(b.total_sleep),
    },
    avg: averages,
    total: { steps: total(b.steps), active_cal: total(b.active_cal) },
    per_day,
  };
}

// 环比表里的指标顺序 = 呈现顺序
export const METRICS = [
  { k: 'sleep', label: '睡眠评分', t: 'score', pref: 'up' },
  { k: 'readiness', label: '准备度', t: 'score', pref: 'up' },
  { k: 'activity', label: '活动评分', t: 'score', pref: 'up' },
  { k: 'total_sleep', label: '平均睡眠时长', t: 'dur', pref: 'up' },
  { k: 'deep', label: '平均深睡', t: 'dur', pref: 'up' },
  { k: 'rem', label: '平均 REM', t: 'dur', pref: 'up' },
  { k: 'efficiency', label: '睡眠效率', t: 'pct', pref: 'up' },
  { k: 'latency', label: '入睡耗时', t: 'dur', pref: 'down' },
  { k: 'hrv', label: '平均 HRV', t: 'int', unit: 'ms', pref: 'up' },
  { k: 'low_hr', label: '最低心率', t: 'int', unit: 'bpm', pref: 'down' },
  { k: 'steps', label: '日均步数', t: 'int', pref: 'up' },
  { k: 'active_cal', label: '日均活动消耗', t: 'int', unit: 'kcal', pref: 'up' },
  { k: 'sedentary', label: '日均久坐', t: 'dur', pref: 'down' },
  { k: 'temp_dev', label: '体温偏差', t: 'signed1', unit: '°C', pref: 'none' },
  { k: 'spo2', label: '血氧 SpO2', t: 'float1', unit: '%', pref: 'up' },
];

export function fmtVal(t, v, unit = '') {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  const u = unit ? ` ${unit}` : '';
  switch (t) {
    case 'score':
      return String(Math.round(v));
    case 'dur':
      return dur(v);
    case 'pct':
      return `${Math.round(v)}%`;
    case 'int':
      return `${Math.round(v).toLocaleString('en-US')}${u}`;
    case 'float1':
      return `${v.toFixed(1)}${u}`;
    case 'signed1':
      return `${signed(v)}${u}`;
    default:
      return String(v);
  }
}

export function fmtDelta(t, d) {
  if (typeof d !== 'number' || !isFinite(d)) return '—';
  if (t === 'dur') {
    const m = Math.round(d / 60);
    if (m === 0) return '持平';
    const sign = m > 0 ? '+' : '−';
    const a = Math.abs(m);
    if (a >= 60) return `${sign}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}m`;
    return `${sign}${a}m`;
  }
  if (t === 'score' || t === 'int') {
    const r = Math.round(d);
    if (r === 0) return '持平';
    return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('en-US')}`;
  }
  if (t === 'pct') {
    const r = Math.round(d);
    if (r === 0) return '持平';
    return `${r > 0 ? '+' : '−'}${Math.abs(r)}`;
  }
  const r = Math.round(d * 10) / 10;
  if (r === 0) return '持平';
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}`;
}

export function compareRows(cur, prev) {
  return METRICS.map((m) => {
    const c = cur.avg[m.k];
    const p = prev ? prev.avg[m.k] : null;
    const delta = typeof c === 'number' && typeof p === 'number' ? c - p : null;
    let good = null;
    if (typeof delta === 'number' && m.pref !== 'none') {
      const eps = m.t === 'dur' ? 60 : 0.5;
      if (Math.abs(delta) > eps) good = m.pref === 'up' ? delta > 0 : delta < 0;
    }
    return { ...m, cur: c, prev: p, delta, good };
  });
}

// 亮点与异常：从逐日数据里挑真正值得看一眼的点，不堆砌
export function highlights(cur, prev, kind) {
  const out = [];
  const period = kind === 'monthly' ? '本月' : '本周';
  const pd = cur.per_day;

  const withSleep = pd.filter((d) => typeof d.sleep === 'number');
  if (withSleep.length >= 2) {
    const best = withSleep.reduce((a, b) => (b.sleep > a.sleep ? b : a));
    const worst = withSleep.reduce((a, b) => (b.sleep < a.sleep ? b : a));
    out.push(
      `睡得最好的一晚是 <b>${md(best.day)} ${weekdayCN(best.day)}</b>，睡眠 ${Math.round(best.sleep)} 分；最差是 <b>${md(
        worst.day
      )}</b>，${Math.round(worst.sleep)} 分，两者相差 ${Math.round(best.sleep - worst.sleep)} 分。`
    );
  }

  const withSteps = pd.filter((d) => typeof d.steps === 'number');
  if (withSteps.length >= 2) {
    const top = withSteps.reduce((a, b) => (b.steps > a.steps ? b : a));
    out.push(`步数最多的一天是 <b>${md(top.day)}</b>，走了 ${top.steps.toLocaleString('en-US')} 步。`);
  }

  // 连续「睡眠 ≥ 80」的最长天数
  let run = 0;
  let bestRun = 0;
  for (const d of pd) {
    if (typeof d.sleep === 'number' && d.sleep >= 80) {
      run += 1;
      bestRun = Math.max(bestRun, run);
    } else {
      run = 0;
    }
  }
  if (bestRun >= 2) out.push(`最长连续 <b>${bestRun} 天</b>睡眠评分保持在 80 分以上。`);

  // 睡眠时长的波动幅度
  const totals = pd.map((d) => d.total_sleep).filter((v) => typeof v === 'number');
  if (totals.length >= 3) {
    const lo = Math.min(...totals);
    const hi = Math.max(...totals);
    const spread = (hi - lo) / 3600;
    if (spread >= 1.5) {
      out.push(
        `睡眠时长在 <b>${dur(lo)}</b> 到 <b>${dur(hi)}</b> 之间波动，跨度 ${spread.toFixed(
          1
        )} 小时，作息不够稳定。`
      );
    } else {
      out.push(`睡眠时长很稳定，每天最多只差 ${spread.toFixed(1)} 小时。`);
    }
  }

  // 环比变化最大的两个评分项
  if (prev) {
    const scored = compareRows(cur, prev)
      .filter((r) => ['sleep', 'readiness', 'activity'].includes(r.k) && typeof r.delta === 'number')
      .sort((a, b) => b.delta - a.delta);
    if (scored.length) {
      const top = scored[0];
      if (top.delta >= 2) {
        out.push(`<b>${top.label}</b>比上期高 ${Math.round(top.delta)} 分，是${period}最大的进步。`);
      }
      const bottom = scored[scored.length - 1];
      if (bottom.delta <= -2) {
        out.push(`<b>${bottom.label}</b>比上期低 ${Math.abs(Math.round(bottom.delta))} 分，值得留意。`);
      }
    }
  }

  if (!out.length) out.push(`${period}数据量还不足以看出明显规律，再积累几天会更准。`);
  return out.slice(0, 4);
}

export function periodAdvice(cur, prev, kind) {
  const out = [];
  const a = cur.avg;
  const next = kind === 'monthly' ? '下个月' : '下周';

  // 整期没数据时不能套规则，否则会说出「各项指标平稳」这种明显错误的话
  if (!cur.n.sleep) {
    return ['本期没有可用的睡眠数据，暂时无法给出建议。先确认戒指有正常佩戴，并让 Oura App 完成一次同步。'];
  }

  if (typeof a.total_sleep === 'number' && a.total_sleep < 7 * 3600) {
    const gap = Math.round((7 * 3600 - a.total_sleep) / 60);
    const shift = Math.min(45, Math.max(15, Math.round(gap / 2 / 5) * 5));
    out.push(
      `平均睡眠 ${dur(a.total_sleep)}，距 7 小时还差 <b>${gap} 分钟</b>。${next}把上床时间整体提前 ${shift} 分钟，比周末补觉有效得多。`
    );
  }

  if (typeof a.sleep === 'number' && a.sleep < 70) {
    out.push('睡眠评分整期偏低，先解决时长和规律性，暂时不要加训练量。');
  }

  if (prev && typeof a.readiness === 'number' && typeof prev.avg.readiness === 'number') {
    const d = a.readiness - prev.avg.readiness;
    if (d <= -4) {
      out.push(
        `准备度比上期降了 ${Math.abs(Math.round(d))} 分，恢复在走下坡，${next}安排 1–2 天完全休息日。`
      );
    }
  }

  if (prev && typeof a.hrv === 'number' && typeof prev.avg.hrv === 'number') {
    if (a.hrv < prev.avg.hrv * 0.92) {
      out.push(
        `平均 HRV 从 ${Math.round(prev.avg.hrv)}ms 降到 ${Math.round(a.hrv)}ms，交感神经负荷偏高，${next}减少一次高强度课。`
      );
    }
  }

  if (typeof a.steps === 'number') {
    if (a.steps < 6000) {
      out.push(
        `日均 ${Math.round(a.steps).toLocaleString('en-US')} 步，活动量偏少。${next}固定一段 25 分钟快走，比偶尔一次长距离更有效。`
      );
    } else if (a.steps >= 10000) {
      out.push(
        `日均 ${Math.round(a.steps).toLocaleString('en-US')} 步，活动量很足，注意补碳水和蛋白质，避免消耗大于恢复。`
      );
    }
  }

  if (typeof a.sedentary === 'number' && a.sedentary > 8 * 3600) {
    out.push(`日均久坐 ${dur(a.sedentary)}，${next}每小时起身活动 3 分钟，对代谢的改善比集中运动更明显。`);
  }

  if (typeof a.latency === 'number' && a.latency > 20 * 60) {
    out.push(`平均入睡耗时 ${dur(a.latency)}，偏长。睡前 1 小时调暗灯光、离开屏幕，能明显缩短入睡时间。`);
  }

  if (typeof a.efficiency === 'number' && a.efficiency < 85) {
    out.push(
      `睡眠效率 ${Math.round(a.efficiency)}%，夜间觉醒偏多。${next}把卧室温度降到 19℃ 左右、睡前两小时少喝水。`
    );
  }

  if (typeof a.deep === 'number' && typeof a.total_sleep === 'number' && a.total_sleep > 0) {
    const ratio = a.deep / a.total_sleep;
    if (ratio < 0.14) {
      out.push(
        `深睡只占 ${Math.round(ratio * 100)}%，低于 15% 的参考线。${next}把高强度训练挪到白天早些时候，别让交感神经在晚间兴奋。`
      );
    }
  }

  if (typeof a.temp_dev === 'number' && Math.abs(a.temp_dev) >= 0.3) {
    out.push(
      `整期体温偏差 ${signed(a.temp_dev)}°C 持续偏${a.temp_dev > 0 ? '高' : '低'}，留意是否有慢性炎症或作息紊乱。`
    );
  }

  // 规则都没触发时不要只说「保持」，把做得好的部分点出来，否则读起来像敷衍
  if (out.length < 2) {
    const good = [];
    if (typeof a.sleep === 'number' && a.sleep >= 80) good.push(`睡眠均值 ${Math.round(a.sleep)} 分`);
    if (typeof a.efficiency === 'number' && a.efficiency >= 88) good.push(`睡眠效率 ${Math.round(a.efficiency)}%`);
    if (typeof a.steps === 'number' && a.steps >= 8000)
      good.push(`日均 ${Math.round(a.steps).toLocaleString('en-US')} 步`);
    if (good.length) out.push(`${good.join('、')}都保持得不错，${next}不用大改，守住当前节奏就行。`);
  }

  if (!out.length) out.push(`各项指标平稳，${next}维持当前作息和训练节奏即可。`);
  return out.slice(0, 4);
}

// 打包成渲染层要用的结构
export function buildPeriodPayload(raw, kind, today) {
  const range = periodFor(kind, today);
  const cur = aggregate(raw, range.start, range.end);
  const prev = aggregate(raw, range.prevStart, range.prevEnd);
  const label = rangeLabel(range);

  return {
    kind,
    period: range,
    label,
    cur,
    prev,
    rows: compareRows(cur, prev),
    // 上期有效天数太少时不做环比，避免拿 1 天数据当「上周」
    has_prev: prev.n.sleep >= 3,
    // 本期数据覆盖率偏低时要在邮件里明说
    coverage: cur.day_count ? cur.n.sleep / cur.day_count : 0,
    highlights: highlights(cur, prev, kind),
    advice: periodAdvice(cur, prev, kind),
    prev_title: label.prevTitle,
  };
}
