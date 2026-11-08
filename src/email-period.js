// 周报 / 月报邮件渲染
// 与日报共用 ui.js 的基础件，但版式不同：主体是「环比对比表」而不是当日明细

import { grade, weekdayCN } from './report.js';
import {
  INK,
  MUTED,
  METRIC,
  provenanceChips,
  GREEN,
  RED,
  GRAY,
  ACCENT,
  card,
  sectionTitle,
  bulletList,
  noticeBar,
  shell,
  letterHead,
  metaRow,
  signoffRow,
} from './ui.js';
import { fmtVal, fmtDelta } from './period.js';

const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const mdy = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}/${day.slice(0, 4)}`;
const esc = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const stripHtml = (text) => String(text || '').replace(/<[^>]*>/g, '');

const W = {
  bg: '#EEF0F2',
  card: '#F4F5F6',
  ink: '#25272B',
  title: '#45484E',
  sub: '#90939A',
  line: '#E3E5E8',
  neutral: '#AEB4BC',
  green: '#659E79',
  red: '#C77C7C',
  amber: '#CFA36C',
};

function weeklyShell(preheader, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Weekly Health Report</title></head>
<body style="margin:0;padding:0;background:${W.bg};">
<div style="display:none;font-size:1px;color:${W.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<div style="background:${W.bg};padding:22px 10px 30px 10px;">
  <div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${body}</table>
  </div>
</div></body></html>`;
}

function weeklyCard(inner, padding = '18px 18px 16px 18px') {
  return `<tr><td style="padding:0 0 12px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${W.card};border:1px solid #F8F9FA;border-radius:20px;box-shadow:5px 5px 12px rgba(132,138,145,0.10),-4px -4px 10px rgba(255,255,255,0.72);table-layout:fixed;"><tr><td style="padding:${padding};">${inner}</td></tr></table></td></tr>`;
}

function weeklyTag(text) {
  return '';
}

function weeklyTitle(title, sub = '') {
  return `${weeklyTag(sub || 'WEEKLY HEALTH')}<div style="font-size:20px;font-weight:800;line-height:28px;color:${W.title};letter-spacing:-0.3px;">${title}</div>`;
}

function periodEnglishHead(p) {
  const intro = p.kind === 'monthly'
    ? 'I have processed and compiled your physiological data captured over the past month by Oura for this health briefing.'
    : 'I have processed and compiled your physiological data captured over the past week by Oura for this health briefing.';
  return `<tr><td style="padding:0 0 16px 0;">
    <div style="font-size:15px;font-weight:700;color:${W.ink};line-height:22px;">Dear Max</div>
    <div style="font-size:13px;color:#66636F;line-height:22px;padding-top:12px;">Good day.</div>
    <div style="font-size:13px;color:#66636F;line-height:22px;padding-top:8px;">${intro}</div>
  </td></tr>`;
}

function weeklySignoff() {
  return `<tr><td style="padding:4px 0 14px 0;">
    <div style="font-size:13px;color:#66636F;line-height:22px;">Wishing you a steady day.</div>
    <div align="right" style="font-size:13px;color:${W.sub};line-height:22px;padding-top:6px;">— Jarvis (Oura Clone)</div>
  </td></tr>`;
}

function weeklyNotice(p) {
  const messages = [];
  if (p.cur.n.sleep < p.cur.day_count) messages.push(`睡眠记录覆盖 ${p.cur.n.sleep}/${p.cur.day_count} 天，趋势以已有记录为准。`);
  if (!p.has_prev) messages.push(`${p.kind === 'monthly' ? '上月' : '上周'}数据不足，暂不做环比判断。`);
  if (!messages.length) return '';
  return weeklyCard(`<div style="font-size:12px;line-height:19px;color:#737780;background:#ECEEF0;border-radius:12px;padding:10px 12px;">${esc(messages.join(' '))}</div>`, '10px 12px');
}

function weeklySummary(p) {
  const pick = (k) => p.rows.find((r) => r.k === k)?.cur;
  const period = p.kind === 'monthly' ? '本月' : '本周';
  const next = p.kind === 'monthly' ? '下月' : '下周';
  const sleep = pick('sleep');
  const readiness = pick('readiness');
  const activity = pick('activity');
  const tags = (p.user_tags || []).slice(0, 2);
  const tagLead = tags.length ? `结合${tags.join('、')}记录，` : '';
  if (typeof sleep !== 'number' || typeof readiness !== 'number' || typeof activity !== 'number') {
    return `${tagLead}${period}记录还在积累，建议先把佩戴和同步保持住，再根据连续变化安排节奏。`;
  }
  if (sleep >= 80 && readiness >= 80 && activity >= 80) {
    return `${tagLead}${period}睡眠、恢复和活动配合得不错，建议按原计划推进，同时给自己留一点余量。`;
  }
  if (readiness < 70 || sleep < 70) {
    return `${tagLead}${period}恢复节奏有些吃紧，建议先把睡眠和放松安排完整，训练不需要勉强加量。`;
  }
  if (activity >= 80) return `${tagLead}${period}活动完成得很积极，恢复也基本能跟上，建议${next}继续把节奏放在舒适范围。`;
  return `${tagLead}${period}睡眠、恢复和活动正在慢慢配合，建议${next}保持规律，不必突然加量。`;
}

function weeklyScoreHero(p) {
  const pick = (k) => p.rows.find((r) => r.k === k);
  const period = p.kind === 'monthly' ? '月均' : '周均';
  const previous = p.kind === 'monthly' ? '较上月' : '较上周';
  const score = (label, key) => {
    const r = pick(key);
    const color = key === 'sleep' ? METRIC.sleep : key === 'readiness' ? METRIC.readiness : METRIC.activity;
    const state = p.has_prev && typeof r?.delta === 'number' && r.good !== null
      ? { color: r.good ? W.green : W.red, text: `${previous} ${r.delta > 0 ? '↑' : '↓'}${Math.abs(Math.round(r.delta))}` }
      : { color: W.sub, text: '—' };
    return `<td width="33.33%" valign="top" style="padding:14px 3px 0;"><div style="background:#ECEEF0;border-radius:14px;padding:10px 8px 9px;"><div style="font-size:34px;font-weight:800;line-height:38px;color:${color};">${
      typeof r?.cur === 'number' ? Math.round(r.cur) : '—'
    }</div><div style="font-size:11px;line-height:16px;color:${W.sub};padding-top:4px;">${label}</div><span style="display:inline-block;margin-top:5px;padding:2px 6px;background:#F4F5F6;border-radius:8px;font-size:10px;line-height:14px;color:${state.color};font-weight:700;">${state.text}</span></div></td>`;
  };
  const summary = p.insight?.source === 'llm' ? p.insight.summary : weeklySummary(p);
  return weeklyCard(`${weeklyTag('OURA RING · PERIOD REPORT')}<div style="font-size:12px;line-height:18px;color:${W.sub};">统计日期：${mdy(p.period.start)} – ${mdy(p.period.end)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${score(`${period}睡眠`, 'sleep')}${score(`${period}准备度`, 'readiness')}${score(`${period}活动`, 'activity')}</tr></table>
    <div style="margin-top:13px;border-left:3px solid ${W.green};background:#ECEEF0;border-radius:0 10px 10px 0;padding:10px 11px;font-size:12px;line-height:20px;color:#5F6066;"><span style="font-weight:700;color:${W.title};">一句话总结：</span>${esc(summary)}</div>`);
}

function weeklySignals(p) {
  const colors = { positive: W.green, risk: W.red, change: W.amber };
  const items = p.signals || [];
  const lineCount = (text, chars) => Math.max(1, Math.ceil([...String(text || '')].length / chars));
  // 三栏宽度固定，按最长标题与说明预留共同高度，避免邮件客户端无法拉齐卡片。
  const height = Math.max(
    132,
    ...items.map((item) => 22 + lineCount(item.title, 11) * 18 + 6 + lineCount(item.reason, 15) * 18)
  );
  const cells = items
    .map((item, index) => {
      const color = colors[item.tone] || W.neutral;
      return `<td width="33.33%" valign="top" style="padding:${index ? '0 0 0 5px' : '0 5px 0 0'};"><div style="height:${height}px;background:#ECEEF0;border-radius:14px;padding:11px 10px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.08);"><div style="font-size:12px;font-weight:700;line-height:18px;color:${W.title};"><span style="display:inline-block;width:6px;height:6px;background:${color};border-radius:6px;margin-right:4px;vertical-align:1px;"></span>${esc(item.title)}</div><div style="font-size:11px;line-height:18px;color:#666A71;padding-top:6px;">${esc(item.reason)}</div></div></td>`;
    })
    .join('');
  return weeklyCard(`${weeklyTitle('三个值得注意的信号')}<div style="height:12px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${cells}</tr></table>`);
}

function weeklyTrendSummary(p) {
  const baseline = p.baseline?.avg;
  const values = (key) => p.cur.per_day.map((day) => day[key]).filter((value) => typeof value === 'number');
  const direction = (key) => {
    const list = values(key);
    if (list.length < 4) return 'steady';
    const edge = Math.min(3, Math.floor(list.length / 2));
    const first = list.slice(0, edge).reduce((sum, value) => sum + value, 0) / edge;
    const last = list.slice(-edge).reduce((sum, value) => sum + value, 0) / edge;
    return last - first >= 4 ? 'up' : last - first <= -4 ? 'down' : 'steady';
  };
  const mostlyBelow = (key) => {
    const list = values(key);
    const base = baseline?.[key];
    return typeof base === 'number' && list.filter((value) => value < base).length > list.length / 2;
  };
  if (!baseline) return '本周状态有起伏，但个人基线仍在积累；下周先保持规律作息和稳定活动，再观察变化方向。';
  const sleep = direction('sleep');
  const readiness = direction('readiness');
  const activity = direction('activity');
  if (sleep === 'up' && readiness === 'up') return '本周后半程睡眠和准备度同步回升，恢复节奏正在变稳；下周可维持适中活动，不需要额外加量。';
  if (sleep === 'down' && readiness === 'down') return '本周后半程睡眠和准备度同步走弱，恢复节奏需要收一收；下周以轻松活动为主，优先稳住作息。';
  if (mostlyBelow('sleep') && mostlyBelow('readiness')) return '本周睡眠和准备度多数时间低于个人常态，恢复储备仍需补足；下周先减少高负荷叠加，把规律作息放在第一位。';
  if (activity === 'up' && (mostlyBelow('sleep') || mostlyBelow('readiness'))) return '本周活动节奏走高，但恢复没有同步跟上；下周保留轻松活动，避免连续叠加高强度。';
  return '本周三项状态围绕个人常态小幅波动，整体节奏平稳；下周按现有安排推进，并继续为恢复留出余量。';
}

function dailyTrend(p) {
  const labels = { sleep: '睡眠', readiness: '准备度', activity: '活动' };
  const colors = { sleep: METRIC.sleep, readiness: METRIC.readiness, activity: METRIC.activity };
  const dates = p.cur.per_day;
  const baseline = p.baseline?.avg || {};
  const header = dates.map((d) => `<td align="center" style="font-size:9px;line-height:13px;color:${W.sub};padding:0 1px 4px;">${md(d.day)}</td>`).join('');
  const row = (key) => {
    const base = baseline[key];
    const baseText = typeof base === 'number' ? `基线 ${Math.round(base)}` : '基线积累中';
    return `<tr><td width="70" style="width:70px;font-size:11px;font-weight:700;line-height:16px;color:${W.title};padding-right:5px;">${labels[key]}<div style="font-size:9px;font-weight:400;color:${W.sub};line-height:13px;">${baseText}</div></td>${dates
      .map((d) => {
        const value = d[key];
        const width = typeof value === 'number' ? Math.max(24, Math.min(100, value)) : 0;
        const color = typeof value === 'number' && typeof base === 'number' && value < base ? W.neutral : colors[key];
        return `<td style="padding:2px;"><div style="height:18px;background:#E7E9EB;border-radius:9px;overflow:hidden;"><div style="width:${width}%;height:18px;background:${color};border-radius:9px;font-size:9px;font-weight:700;line-height:18px;color:#FFFFFF;text-align:center;">${typeof value === 'number' ? Math.round(value) : ''}</div></div></td>`;
      })
      .join('')}</tr>`;
  };
  return weeklyCard(`${weeklyTitle('每日状态趋势')}<div style="height:10px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr><td width="70" style="width:70px;"></td>${header}</tr>${row('sleep')}${row('readiness')}${row('activity')}</table><div style="margin-top:12px;border-left:3px solid ${W.neutral};background:#ECEEF0;border-radius:0 10px 10px 0;padding:10px 11px;font-size:12px;line-height:20px;color:#5F6066;">${weeklyTrendSummary(p)}</div>`);
}

function monthlyTrendSummary(p) {
  if (!p.has_prev) return '本月趋势已经整理好，但上月记录不足；下月继续保持规律，让变化方向更清楚。';
  const rows = p.rows;
  const delta = (key) => rows.find((row) => row.k === key)?.delta;
  const sleep = delta('sleep') || 0;
  const readiness = delta('readiness') || 0;
  const activity = delta('activity') || 0;
  if (sleep >= 2 && readiness >= 2) return '本月睡眠和准备度同步走稳，恢复节奏正在积累；下月延续当前作息，再逐步安排活动。';
  if (sleep <= -2 && readiness <= -2) return '本月睡眠和准备度一起走弱，恢复节奏需要收一收；下月先稳定作息，避免连续叠加高负荷。';
  if (activity >= 2 && (sleep <= -2 || readiness <= -2)) return '本月活动推进较快，但恢复没有完全跟上；下月保留轻松活动，让身体有更多缓冲。';
  return '本月睡眠、准备度和活动整体保持平稳；下月按现在的节奏推进，并继续观察身体感受。';
}

function monthlyTrend(p) {
  const colors = { sleep: METRIC.sleep, readiness: METRIC.readiness, activity: METRIC.activity };
  const labels = { sleep: '睡眠', readiness: '准备度', activity: '活动' };
  const baseline = p.prev?.avg || {};
  const blocks = [];
  for (let index = 0; index < p.cur.per_day.length; index += 7) {
    const days = p.cur.per_day.slice(index, index + 7);
    const avg = (key) => {
      const values = days.map((day) => day[key]).filter((value) => typeof value === 'number');
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    blocks.push({ label: `${md(days[0].day)}–${days[days.length - 1].day.slice(8)}`, sleep: avg('sleep'), readiness: avg('readiness'), activity: avg('activity') });
  }
  const row = (key) => {
    const base = baseline[key];
    const baseText = typeof base === 'number' ? `上月 ${Math.round(base)}` : '上月参考';
    return `<tr><td width="70" style="width:70px;font-size:11px;font-weight:700;line-height:16px;color:${W.title};padding-right:5px;">${labels[key]}<div style="font-size:9px;font-weight:400;color:${W.sub};line-height:13px;">${baseText}</div></td>${blocks
    .map((block) => {
      const value = block[key];
      const width = typeof value === 'number' ? Math.max(24, Math.min(100, value)) : 0;
      const color = typeof value === 'number' && typeof base === 'number' && value < base ? W.neutral : colors[key];
      return `<td style="padding:2px;"><div style="height:18px;background:#E7E9EB;border-radius:9px;overflow:hidden;"><div style="width:${width}%;height:18px;background:${color};border-radius:9px;font-size:9px;font-weight:700;line-height:18px;color:#FFFFFF;text-align:center;">${typeof value === 'number' ? Math.round(value) : ''}</div></div></td>`;
    })
    .join('')}</tr>`;
  };
  const header = blocks.map((block) => `<td align="center" style="font-size:8px;line-height:13px;color:${W.sub};padding:0 1px 4px;white-space:nowrap;">${block.label}</td>`).join('');
  return weeklyCard(`${weeklyTitle('每周状态趋势')}<div style="height:10px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr><td width="70" style="width:70px;"></td>${header}</tr>${row('sleep')}${row('readiness')}${row('activity')}</table><div style="margin-top:12px;border-left:3px solid ${W.neutral};background:#ECEEF0;border-radius:0 10px 10px 0;padding:10px 11px;font-size:12px;line-height:20px;color:#5F6066;">${monthlyTrendSummary(p)}</div>`);
}

const STEP_TARGET = 10000;

function weeklyBars(p, key, color, format, outsideZero = false) {
  const values = p.cur.per_day.map((d) => d[key]);
  const target = key === 'steps' ? STEP_TARGET : null;
  const max = Math.max(...values.filter((v) => typeof v === 'number'), target || 1);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${p.cur.per_day
    .map((d, index) => {
      const value = values[index];
      const height = typeof value === 'number' ? Math.max(8, Math.round((value / max) * 46)) : 4;
      const label = typeof value === 'number' ? format(value) : '—';
      const isOutside = outsideZero && typeof value === 'number' && value <= 0;
      if (target) {
        const targetColor = typeof value === 'number' && value < target ? '#AEB4BC' : color;
        return `<td align="center" valign="bottom" style="height:65px;padding:0 2px;"><div style="height:14px;font-size:9px;font-weight:700;line-height:14px;color:${W.ink};">${label}</div><div style="height:${height}px;background:${typeof value === 'number' ? targetColor : '#EDEAF2'};border-radius:8px 8px 3px 3px;font-size:0;line-height:0;">&nbsp;</div><div style="font-size:9px;line-height:13px;color:${W.sub};padding-top:3px;">${md(d.day)}</div></td>`;
      }
      return `<td align="center" valign="bottom" style="height:65px;padding:0 2px;">${isOutside ? `<div style="height:14px;font-size:9px;font-weight:700;line-height:14px;color:${W.ink};">${label}</div>` : ''}<div style="height:${height}px;background:${typeof value === 'number' ? color : '#EDEAF2'};border-radius:8px 8px 3px 3px;font-size:9px;font-weight:700;line-height:14px;color:${W.ink};">${isOutside ? '&nbsp;' : label}</div><div style="font-size:9px;line-height:13px;color:${W.sub};padding-top:3px;">${md(d.day)}</div></td>`;
    })
    .join('')}</tr></table>`;
}

function monthlyBars(p, key, color, format) {
  const blocks = [];
  for (let index = 0; index < p.cur.per_day.length; index += 7) {
    const days = p.cur.per_day.slice(index, index + 7);
    const values = days.map((day) => day[key]).filter((value) => typeof value === 'number');
    const value = values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : null;
    blocks.push({ label: `${md(days[0].day)}–${days[days.length - 1].day.slice(8)}`, value });
  }
  const target = key === 'steps' ? STEP_TARGET : null;
  const max = Math.max(...blocks.map((block) => block.value).filter((value) => typeof value === 'number'), target || 1);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${blocks
    .map((block) => {
       const height = typeof block.value === 'number' ? Math.max(8, Math.round((block.value / max) * 46)) : 4;
       if (target) {
         const label = typeof block.value === 'number' ? format(block.value) : '—';
         const targetColor = typeof block.value === 'number' && block.value < target ? '#AEB4BC' : color;
         return `<td align="center" valign="bottom" style="height:65px;padding:0 3px;"><div style="height:14px;font-size:9px;font-weight:700;line-height:14px;color:${W.ink};">${label}</div><div style="height:${height}px;background:${typeof block.value === 'number' ? targetColor : '#EDEAF2'};border-radius:8px 8px 3px 3px;font-size:0;line-height:0;">&nbsp;</div><div style="font-size:8px;line-height:13px;color:${W.sub};padding-top:3px;white-space:nowrap;">${block.label}</div></td>`;
       }
       return `<td align="center" valign="bottom" style="height:65px;padding:0 3px;"><div style="height:${height}px;background:${typeof block.value === 'number' ? color : '#EDEAF2'};border-radius:8px 8px 3px 3px;font-size:9px;font-weight:700;line-height:14px;color:${W.ink};">${typeof block.value === 'number' ? format(block.value) : '—'}</div><div style="font-size:8px;line-height:13px;color:${W.sub};padding-top:3px;white-space:nowrap;">${block.label}</div></td>`;
    })
    .join('')}</tr></table>`;
}

function weeklyDeltaPill(p, key) {
  const row = p.rows.find((item) => item.k === key);
  const previous = p.kind === 'monthly' ? '上月' : '上周';
  if (!p.has_prev || !row || typeof row.delta !== 'number') {
    return `<span style="display:inline-block;margin-top:5px;padding:2px 6px;background:#F4F5F6;border-radius:8px;font-size:10px;line-height:14px;color:${W.sub};">较${previous}无数据</span>`;
  }
  const delta = fmtDelta(row.t, row.delta);
  const color = delta === '持平' || row.good === null ? W.sub : row.good ? W.green : W.red;
  const mark = delta === '持平' ? '—' : row.delta > 0 ? '↑' : '↓';
  return `<span style="display:inline-block;margin-top:5px;padding:2px 6px;background:#F4F5F6;border-radius:8px;font-size:10px;line-height:14px;color:${color};font-weight:700;">较${previous} ${mark} ${delta === '持平' ? '持平' : delta.replace(/^[+−]/, '')}</span>`;
}

function weeklyCardSummary(p, type) {
  const avg = p.cur.avg;
  const period = p.kind === 'monthly' ? '本月' : '本周';
  const next = p.kind === 'monthly' ? '下月' : '下周';
  const tags = (p.user_tags || []).slice(0, 2);
  const tagLead = tags.length ? `结合${tags.join('、')}记录，` : '';
  const sleepWeak = (typeof avg.total_sleep === 'number' && avg.total_sleep < 7 * 3600) || (typeof avg.sleep === 'number' && avg.sleep < 70);
  const recoveryWeak = (typeof avg.readiness === 'number' && avg.readiness < 70) || (typeof avg.hrv === 'number' && typeof p.prev?.avg.hrv === 'number' && avg.hrv < p.prev.avg.hrv * 0.92);
  const activityHigh = typeof avg.activity === 'number' && avg.activity >= 80 || typeof avg.steps === 'number' && avg.steps >= 10000;
  if (type === 'sleep') {
    if (sleepWeak || recoveryWeak) return `${tagLead}${period}睡眠与恢复没有同步回到稳定状态，准备度和 HRV 也需要多留意；${next}先守住规律作息，把高负荷安排留到恢复更稳的时候。`;
    return `${tagLead}${period}睡眠、恢复和心率信号整体配合顺畅；${next}延续当前作息，并继续给晚间留出放松空间。`;
  }
  if (activityHigh && (sleepWeak || recoveryWeak)) return `${tagLead}${period}活动量很充足，但睡眠与恢复没有完全跟上；${next}保留轻松活动，避免连续叠加高强度。`;
  if (typeof avg.sedentary === 'number' && avg.sedentary > 8 * 3600) return `${tagLead}${period}活动安排还可以更均匀，久坐会抵消一部分恢复感；${next}把走动分散到每天，不必集中补量。`;
  return `${tagLead}${period}活动、恢复和日常节奏配合平稳；${next}按现在的强度推进，并持续给身体保留缓冲。`;
}

const SLEEP_TARGET = 7 * 3600;

function sleepClock(value) {
  if (typeof value !== 'number' || value < 0) return '—';
  // 达标判定精确到秒；显示向下取整分钟，避免 6:59 被显示为 7:00。
  const minutes = Math.floor(value / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function sleepTargetProgress(items) {
  const values = items.map((item) => item.value).filter((value) => typeof value === 'number');
  return { met: values.filter((value) => value >= SLEEP_TARGET).length, total: items.length, known: values.length };
}

function sleepTargetCells(items) {
  const width = (100 / items.length).toFixed(2);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${items.map((item, index) => {
    const met = typeof item.value === 'number' && item.value >= SLEEP_TARGET;
    const hasValue = typeof item.value === 'number';
    const bg = met ? '#EDE9FE' : '#ECEEF0';
    const color = met ? '#7C6BD6' : W.sub;
    return `<td width="${width}%" valign="top" style="padding:${index ? '0 0 0 4px' : '0 4px 0 0'};"><div style="background:${bg};border-radius:12px;padding:10px 4px 9px;text-align:center;"><div style="font-size:11px;font-weight:700;line-height:15px;color:${color};">${item.label}</div><div style="font-size:16px;font-weight:800;line-height:22px;color:${color};padding-top:2px;">${hasValue ? sleepClock(item.value) : '—'}</div></div></td>`;
  }).join('')}</tr></table>`;
}

function sleepTargetSummary(p, items) {
  const current = sleepTargetProgress(items);
  const previousItems = p.kind === 'monthly'
    ? sleepTargetWeeks(p.prev?.per_day || [])
    : (p.prev?.per_day || []).map((day) => ({ value: day.total_sleep }));
  const previous = sleepTargetProgress(previousItems);
  const unit = p.kind === 'monthly' ? '周' : '天';
  const coverage = current.known < current.total ? `，${current.total - current.known}${unit}无记录` : '';
  if (!p.has_prev || previous.known === 0) return `本期 ${current.met}/${current.total}${unit} 达标${coverage}。`;
  const delta = current.met - previous.met;
  const deltaText = delta === 0 ? '与上期持平' : `较${p.kind === 'monthly' ? '上月' : '上周'}${delta > 0 ? '多' : '少'} ${Math.abs(delta)}${unit}`;
  return `本期 ${current.met}/${current.total}${unit} 达标，${deltaText}${coverage}。`;
}

function sleepTargetWeeks(days) {
  const weeks = [];
  for (let index = 0; index < days.length; index += 7) {
    const group = days.slice(index, index + 7);
    const values = group.map((day) => day.total_sleep).filter((value) => typeof value === 'number');
    weeks.push({
      label: `第${weeks.length + 1}周`,
      value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    });
  }
  return weeks;
}

function weeklySleepAndRecovery(p) {
  const sleep = p.cur.avg.total_sleep;
  const hrv = p.cur.avg.hrv;
  const debt = p.cur.avg.sleep_debt;
  const debtLabel = p.kind === 'monthly' ? '月睡眠负债' : '周睡眠负债';
  const targetItems = p.kind === 'monthly'
    ? sleepTargetWeeks(p.cur.per_day)
    : p.cur.per_day.map((day) => ({ label: weekdayCN(day.day).slice(1), value: day.total_sleep }));
  const targetTitle = p.kind === 'monthly' ? '每周平均睡眠达标' : '本周睡眠达标日历（≥7h）';
  return weeklyCard(`${weeklyTitle('睡眠与恢复', '这一周怎么过来的')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td width="33.33%" valign="top" style="padding:10px 4px 0 0;"><div style="background:#ECEEF0;border-radius:15px;padding:12px 10px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">平均睡眠时长</div><div style="font-size:23px;font-weight:800;color:${W.ink};line-height:29px;">${fmtVal('dur', sleep)}</div>${weeklyDeltaPill(p, 'total_sleep')}</div></td>
      <td width="33.33%" valign="top" style="padding:10px 2px;"><div style="background:#ECEEF0;border-radius:15px;padding:12px 10px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">恢复信号</div><div style="font-size:23px;font-weight:800;color:${W.ink};line-height:29px;">${typeof hrv === 'number' ? Math.round(hrv) + ' ms' : '—'}</div>${weeklyDeltaPill(p, 'hrv')}</div></td>
      <td width="33.33%" valign="top" style="padding:10px 0 0 4px;"><div style="background:#ECEEF0;border-radius:15px;padding:12px 10px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">${debtLabel}</div><div style="font-size:23px;font-weight:800;color:${W.ink};line-height:29px;">${fmtVal('dur0', debt)}</div>${weeklyDeltaPill(p, 'sleep_debt')}</div></td>
    </tr></table><div style="font-size:11px;font-weight:700;line-height:16px;color:${W.title};padding:14px 0 7px;">${targetTitle}</div>${sleepTargetCells(targetItems)}<div style="margin-top:12px;border-left:3px solid ${METRIC.sleep};background:#ECEEF0;border-radius:0 10px 10px 0;padding:10px 11px;font-size:12px;line-height:20px;color:#5F6066;">${sleepTargetSummary(p, targetItems)}</div>`);
}

function weeklyActivity(p) {
  return weeklyCard(`${weeklyTitle('活动节奏', '走动、消耗和留白')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td width="50%" style="padding:10px 7px 0 0;"><div style="background:#ECEEF0;border-radius:15px;padding:12px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">日均步数</div><div style="font-size:25px;font-weight:800;color:${W.ink};line-height:31px;">${typeof p.cur.avg.steps === 'number' ? Math.round(p.cur.avg.steps).toLocaleString('en-US') : '—'}</div>${weeklyDeltaPill(p, 'steps')}</div></td>
      <td width="50%" style="padding:10px 0 0 7px;"><div style="background:#ECEEF0;border-radius:15px;padding:12px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">日均活动消耗</div><div style="font-size:25px;font-weight:800;color:${W.ink};line-height:31px;">${fmtVal('int', p.cur.avg.active_cal, 'kcal')}</div>${weeklyDeltaPill(p, 'active_cal')}</div></td>
    </tr></table><div style="font-size:11px;font-weight:700;line-height:16px;color:${W.title};padding:14px 0 4px;">${p.kind === 'monthly' ? '每周平均步数' : '每日步数'}</div>${p.kind === 'monthly' ? monthlyBars(p, 'steps', METRIC.activity, (v) => Math.round(v / 1000) + 'k') : weeklyBars(p, 'steps', METRIC.activity, (v) => Math.round(v / 1000) + 'k', true)}<div style="margin-top:12px;border-left:3px solid ${METRIC.activity};background:#ECEEF0;border-radius:0 10px 10px 0;padding:10px 11px;font-size:12px;line-height:20px;color:#5F6066;">${esc(weeklyCardSummary(p, 'activity'))}</div>`);
}

function weeklyPressureSummary(p) {
  const avg = p.cur.avg;
  const period = p.kind === 'monthly' ? '本月' : '本周';
  const next = p.kind === 'monthly' ? '下月' : '下周';
  const tags = (p.user_tags || []).slice(0, 2);
  const tagLead = tags.length ? `结合${tags.join('、')}记录，` : '';
  const stressHigh = typeof avg.stress_high === 'number' && avg.stress_high > 2 * 3600;
  const recoveryLow = typeof avg.recovery_high === 'number' && avg.recovery_high < 60 * 60;
  const sleepWeak = typeof avg.total_sleep === 'number' && avg.total_sleep < 7 * 3600;
  const hrvWeak = typeof avg.hrv === 'number' && typeof p.prev?.avg.hrv === 'number' && avg.hrv < p.prev.avg.hrv * 0.92;
  if (stressHigh || recoveryLow || sleepWeak || hrvWeak) {
    return `${tagLead}${period}压力和恢复之间还不够平衡，睡眠与 HRV 也需要多留意；${next}每天留出一段不安排任务的放松时间，避免把高负荷集中叠加。`;
  }
  return `${tagLead}${period}压力有释放空间，恢复节奏也能跟上日常活动；${next}延续现在的节奏，并继续给晚间留出安静时间。`;
}

function weeklyPressure(p) {
  const stress = p.cur.avg.stress_high;
  const recovery = p.cur.avg.recovery_high;
  if (typeof stress !== 'number' && typeof recovery !== 'number') return '';
  return weeklyCard(`${weeklyTitle('压力与恢复')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td width="50%" valign="top" style="padding:10px 7px 0 0;"><div style="background:#ECEEF0;border-radius:15px;padding:12px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">日均高压力</div><div style="font-size:25px;font-weight:800;color:${W.ink};line-height:31px;">${fmtVal('dur0', stress)}</div>${weeklyDeltaPill(p, 'stress_high')}</div></td>
      <td width="50%" valign="top" style="padding:10px 0 0 7px;"><div style="background:#ECEEF0;border-radius:15px;padding:12px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;color:${W.sub};line-height:16px;">日均恢复时间</div><div style="font-size:25px;font-weight:800;color:${W.ink};line-height:31px;">${fmtVal('dur0', recovery)}</div>${weeklyDeltaPill(p, 'recovery_high')}</div></td>
    </tr></table><div style="margin-top:12px;border-left:3px solid ${W.amber};background:#ECEEF0;border-radius:0 10px 10px 0;padding:10px 11px;font-size:12px;line-height:20px;color:#5F6066;">${esc(weeklyPressureSummary(p))}</div>`);
}

function weeklySnapshot(p) {
  const rows = p.rows.filter((r) => !['sleep', 'readiness', 'activity'].includes(r.k));
  const cell = (r, index) => {
      const signal = (p.signals || []).find((item) => item.metric === r.k);
      const skin = signal?.tone === 'risk'
        ? { bg: '#F8EFEF', border: '#EAD1D1', dot: W.red }
        : signal?.tone === 'change'
        ? { bg: '#F8F1E8', border: '#E9D8C3', dot: W.amber }
        : signal?.tone === 'positive'
        ? { bg: '#EEF5F0', border: '#D7E6DB', dot: W.green }
        : { bg: '#ECEEF0', border: '#ECEEF0', dot: null };
      const marker = skin.dot ? `<span style="display:inline-block;width:5px;height:5px;background:${skin.dot};border-radius:5px;margin-right:4px;vertical-align:1px;"></span>` : '';
      const padding = index % 2 ? '4px 0 4px 4px' : '4px 4px 4px 0';
      return `<td width="50%" valign="top" style="padding:${padding};"><div style="background:${skin.bg};border:1px solid ${skin.border};border-radius:11px;padding:9px 10px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.06);"><div style="font-size:10px;color:${W.sub};line-height:15px;">${marker}${r.label}</div><div style="font-size:14px;font-weight:700;color:${W.ink};line-height:20px;">${fmtVal(r.t, r.cur, r.unit)}</div>${weeklyDeltaPill(p, r.k)}</div></td>`;
    };
  let grid = '';
  for (let index = 0; index < rows.length; index += 2) {
    grid += `<tr>${cell(rows[index], index)}${rows[index + 1] ? cell(rows[index + 1], index + 1) : '<td width="50%"></td>'}</tr>`;
  }
  return weeklyCard(`${weeklyTitle('一周数据速览')}<div style="height:10px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${grid}</table>`, '18px 18px 14px');
}

function weeklyStory(p) {
  const items = p.story || [];
  if (!items.length) return '';
  const rows = items
    .map((item, index) => {
      const last = index === items.length - 1;
      return `<tr>
        <td width="72" valign="top" align="right" style="width:72px;padding:2px 10px 14px 0;font-size:11px;font-weight:700;line-height:18px;color:${W.sub};">${md(item.day)}（${weekdayCN(item.day)}）</td>
        <td width="26" valign="top" align="center" style="width:26px;padding:2px 0 0;"><div style="width:10px;height:10px;background:#F4F5F6;border:2px solid ${W.green};border-radius:10px;font-size:0;line-height:0;">&nbsp;</div>${last ? '' : '<div style="width:1px;height:57px;background:#D9DDE1;margin:0 auto;"></div>'}</td>
        <td valign="top" style="padding:0 0 14px 10px;"><div style="font-size:13px;font-weight:800;line-height:19px;color:${W.title};">${esc(item.title)}</div><div style="font-size:11px;line-height:18px;color:#666A71;padding-top:3px;">${esc(item.reason)}</div></td>
      </tr>`;
    })
    .join('');
  return weeklyCard(`${weeklyTitle(p.kind === 'monthly' ? '这个月身体经历了什么' : '这一周身体经历了什么')}<div style="height:12px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${rows}</table>`);
}

function weeklyActions(p) {
  const signals = p.signals || [];
  const risk = signals.find((item) => item.tone === 'risk') || signals[1];
  const change = signals.find((item) => item.tone === 'change') || signals[2];
  const positive = signals.find((item) => item.tone === 'positive') || signals[0];
  const changeAction = ['activity', 'steps', 'active_cal', 'sedentary'].includes(change?.metric)
    ? '下周把活动分散到每天，避免连续加量。'
    : '下周保持固定作息，先把节奏稳住。';
  const period = p.kind === 'monthly' ? '本月' : '本周';
  const next = p.kind === 'monthly' ? '下月' : '下周';
  const changeTitle = change?.title || `${period}变化需要继续观察`;
  const positiveTitle = positive?.title || `${period}有稳定表现`;
  const actions = [
    { title: '优先照顾恢复', text: `${risk?.title || '恢复节奏需要照顾'}，${next}固定上床时间，把高负荷安排留到状态更稳的日子。` },
    { title: '调整节奏', text: `${changeTitle}，${changeAction.replace('下周', next)}` },
    { title: '守住有效习惯', text: `${positiveTitle}，${next}延续当前做法，同时每天留一点恢复余量。` },
  ];
  const cell = (item, index) => `<td width="32%" valign="top" bgcolor="#ECEEF0" style="background:#ECEEF0;border-radius:14px;padding:11px 10px;box-shadow:inset 1px 1px 3px rgba(144,150,158,0.07);"><div style="font-size:11px;font-weight:800;color:${W.ink};line-height:17px;"><span style="display:inline-block;width:16px;height:16px;background:#E1E4E7;border-radius:8px;color:${[W.green, W.neutral, W.amber][index]};text-align:center;line-height:16px;margin-right:3px;">${index + 1}</span>${item.title}</div><div style="font-size:11px;color:#50535A;line-height:18px;padding-top:7px;">${esc(item.text)}</div></td>`;
  const cells = `${cell(actions[0], 0)}<td width="2%" style="width:2%;"></td>${cell(actions[1], 1)}<td width="2%" style="width:2%;"></td>${cell(actions[2], 2)}`;
  return weeklyCard(`${weeklyTitle('三条可执行的行动')}<div style="height:12px;font-size:0;line-height:0;">&nbsp;</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${cells}</tr></table>`);
}

function periodProvenance(p) {
  const baseline = p.kind === 'weekly'
    ? p.baseline ? '前 21 天个人基线' : '基线积累中'
    : p.has_prev ? '上月均值' : '上月数据不足';
  return provenanceChips([
    { label: '数据源', text: 'Oura Cloud API v2' },
    { label: '统计区间', text: `${md(p.period.start)}–${md(p.period.end)}` },
    { label: '基线口径', text: baseline },
  ]);
}

function renderPeriodDashboard(p) {
  const pick = (k) => p.rows.find((r) => r.k === k);
  const isMonth = p.kind === 'monthly';
  const body = [
    periodEnglishHead(p),
    weeklyNotice(p),
    weeklyScoreHero(p),
    weeklySignals(p),
    isMonth ? monthlyTrend(p) : dailyTrend(p),
    weeklySleepAndRecovery(p),
    weeklyPressure(p),
    weeklyActivity(p),
    weeklySnapshot(p),
    weeklyStory(p),
    weeklyActions(p),
    periodProvenance(p),
    weeklySignoff(),
    `<tr><td align="center" style="padding:6px 0 0;font-size:10px;color:#AAA5B3;line-height:17px;">由 Cloudflare Worker 自动生成</td></tr>`,
  ].join('');
  const preheader = `睡眠 ${Math.round(pick('sleep').cur ?? 0)} · 准备度 ${Math.round(pick('readiness').cur ?? 0)} · 活动 ${Math.round(pick('activity').cur ?? 0)}`;
  return { subject: `${isMonth ? 'Monthly' : 'Weekly'} Health Report · Jarvis (Oura Clone)`, html: weeklyShell(preheader, body), text: renderPeriodText(p) };
}

function adviceBlock(p) {
  if (!p.insight) return bulletList(p.advice);
  const esc = (text) =>
    String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const items = p.insight.priorities.map(
    (item) => `<b>${esc(item.title)}</b>：${esc(item.reason)}<br>${esc(item.action)}`
  );
  return `<div style="font-size:13px;line-height:21px;color:#374151;padding:0 0 10px 0;">${esc(p.insight.summary)}</div>${bulletList(
    items
  )}<div style="font-size:11px;line-height:18px;color:#8b93a1;padding:2px 0 0 0;">${esc(p.insight.caution)}</div>`;
}

// 环比箭头：跌了用红、涨了用绿；对「入睡耗时」「久坐」这类指标，
// 方向好坏由 r.good 决定，不是单纯看涨跌
function deltaChip(r, p) {
  if (!p.has_prev || typeof r.delta !== 'number') {
    return `<div style="font-size:10px;line-height:15px;padding-top:4px;color:#a1a8b3;">${p.prev_title.replace('较', '')}无数据</div>`;
  }
  const t = fmtDelta(r.t, r.delta);
  const color = t === '持平' ? GRAY : r.good === null ? '#6b7280' : r.good ? GREEN : RED;
  const arrow = t === '持平' ? '持平' : `${r.delta > 0 ? '↑' : '↓'}${t.replace(/^[+−]/, '')}`;
  return `<div style="font-size:10px;line-height:15px;padding-top:4px;">
    <span style="color:${color};font-weight:700;">${arrow}</span>
    <span style="color:#a1a8b3;"> ${p.prev_title.replace('较', '')} ${fmtVal(r.t, r.prev)}</span>
  </div>`;
}

function scoreRow(p) {
  const pick = (k) => p.rows.find((r) => r.k === k);
  const cell = (label, r, color) => {
    const g = grade(r.cur);
    return `<td width="33.33%" align="center" style="padding:8px 2px 4px 2px;vertical-align:top;">
      <div style="font-size:32px;font-weight:700;color:${color};line-height:36px;">${
        typeof r.cur === 'number' ? Math.round(r.cur) : '—'
      }</div>
      <div style="font-size:12px;color:#4b5563;line-height:18px;padding-top:5px;">${label} · ${g.label}</div>
      ${deltaChip(r, p)}
    </td>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
    ${cell('睡眠', pick('sleep'), METRIC.sleep)}
    ${cell('准备度', pick('readiness'), METRIC.readiness)}
    ${cell('活动', pick('activity'), METRIC.activity)}
  </tr></table>`;
}

function compareTable(p) {
  const th = (w, text, align = 'right') =>
    `<td width="${w}" align="${align}" style="font-size:10px;color:#a1a8b3;line-height:15px;padding:0 0 7px 0;">${text}</td>`;

  const head = `<tr>${th('34%', '指标', 'left')}${th('21%', '本期')}${th('20%', '上期')}${th('25%', '变化')}</tr>`;

  const rows = p.rows
    .map((r, i) => {
      const last = i === p.rows.length - 1;
      const bd = last ? '' : 'border-bottom:1px solid #f3f4f6;';
      const t = fmtDelta(r.t, r.delta);
      const color =
        !p.has_prev || t === '—' ? GRAY : t === '持平' ? '#6b7280' : r.good === null ? '#6b7280' : r.good ? GREEN : RED;
      return `<tr>
        <td style="font-size:12px;color:#4b5563;line-height:18px;padding:7px 0;${bd}">${r.label}</td>
        <td align="right" style="font-size:12px;font-weight:700;color:${INK};line-height:18px;padding:7px 0;${bd}">${fmtVal(
          r.t,
          r.cur,
          r.unit
        )}</td>
        <td align="right" style="font-size:12px;color:${MUTED};line-height:18px;padding:7px 0;${bd}">${
          p.has_prev ? fmtVal(r.t, r.prev, r.unit) : '—'
        }</td>
        <td align="right" style="font-size:12px;font-weight:700;color:${color};line-height:18px;padding:7px 0;${bd}">${
          p.has_prev ? t : '—'
        }</td>
      </tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${head}${rows}</table>`;
}

function notices(p) {
  const n = p.cur.n.sleep;
  const d = p.cur.day_count;
  const out = [];

  if (!n) {
    out.push(
      noticeBar(
        `本期（${p.period.start} 至 ${p.period.end}）在 Oura 上没有任何睡眠记录。可能是这段时间没戴戒指，或手机一直没同步。`,
        'warn'
      )
    );
  } else if (n < d * 0.6) {
    out.push(
      noticeBar(
        `本期共 ${d} 天，只有 ${n} 天有睡眠记录，下面的均值只代表这 ${n} 天，参考价值有限。`,
        'warn'
      )
    );
  }

  if (!p.has_prev) {
    out.push(
      noticeBar(
        `${p.prev_title.replace('较', '')}有效数据不足 3 天，本次不做环比，只列本期均值。再积累一段时间对比才有意义。`,
        'info'
      )
    );
  }

  return out.join('');
}

export function renderPeriodEmail(p) {
  const isMonth = p.kind === 'monthly';
  return renderPeriodDashboard(p);
  const title = isMonth ? 'Oura 月报' : 'Oura 周报';
  const pick = (k) => p.rows.find((r) => r.k === k);

  // 主题只留报告名 + 署名，区间和分数在正文里
  const subject = `${isMonth ? 'Monthly' : 'Weekly'} Health Report · Jarvis (Oura Clone)`;

  // 信件体：intro 按周期换，日期行左边是本期区间
  const intro = isMonth
    ? 'I have processed and compiled your physiological data captured over the past month by Oura for this health briefing.'
    : 'I have processed and compiled your physiological data captured over the past week by Oura for this health briefing.';

  const header = `${letterHead(intro)}${metaRow(`${mdy(p.period.start)} – ${mdy(p.period.end)}`)}`;

  const body = [
    header,
    notices(p),
    card(scoreRow(p), '8px 16px 12px 16px'),
    card(`${sectionTitle(`${p.prev_title.replace('较', '')}对比`)}${compareTable(p)}`),
    card(`${sectionTitle(isMonth ? '本月亮点与异常' : '本周亮点与异常')}${bulletList(p.highlights)}`),
    card(
      `${sectionTitle(p.insight ? (isMonth ? '本月解读与下月建议' : '本周解读与下周建议') : isMonth ? '下个月建议' : '下周建议')}${adviceBlock(p)}`,
      '16px 16px 8px 16px'
    ),
    signoffRow(),
    `<tr><td align="center" style="padding:6px 0 0 0;font-size:11px;color:#a1a8b3;line-height:18px;">
      数据来源 Oura Cloud API v2 · 由 Cloudflare Worker 自动生成<br>
      统计区间 ${p.period.start} – ${p.period.end} · 令牌直连，不经第三方
    </td></tr>`,
  ].join('');

  const preheader = `睡眠 ${Math.round(pick('sleep').cur ?? 0)} · 准备度 ${Math.round(
    pick('readiness').cur ?? 0
  )} · 日均 ${typeof pick('steps').cur === 'number' ? Math.round(pick('steps').cur).toLocaleString('en-US') + ' 步' : '—'}`;

  return { subject, html: shell(preheader, body, title), text: renderPeriodText(p) };
}

// 整期没有任何数据时，不发明细表 —— 一张全是「—」的表格既没用又容易让人误读，
// 换成一条短说明，同时仍然把邮件发出去（绝不静默失败）
export function renderPeriodEmpty(p) {
  const isMonth = p.kind === 'monthly';
  const title = isMonth ? 'Oura 月报' : 'Oura 周报';
  const subject = `${isMonth ? 'Monthly' : 'Weekly'} Health Report · ${p.label.short} 无数据`;

  const inner = `${sectionTitle('本期没有 Oura 记录')}
    <div style="font-size:13px;line-height:22px;color:#374151;">
      统计区间 ${p.period.start} 至 ${p.period.end}（${p.cur.day_count} 天）在 Oura 云上没有任何睡眠记录。<br>
      常见原因：这段时间没戴戒指、戒指没电，或手机上的 Oura App 一直没有同步。
    </div>
    <div style="height:10px;font-size:0;line-height:0;">&nbsp;</div>
    <div style="font-size:13px;line-height:22px;color:#6b7280;">
      打开 Oura App 让它同步一次，下个周期的${isMonth ? '月报' : '周报'}就会恢复正常。数据补齐后，这一期也会重新统计。
    </div>`;

  // 整期无数据也走信件体，但 intro 要如实说「没有东西可编译」，不能照抄日报那句
  const intro = isMonth
    ? 'I have checked the physiological data Oura captured over the past month, but there is nothing to compile for this period.'
    : 'I have checked the physiological data Oura captured over the past week, but there is nothing to compile for this period.';

  const body = [
    letterHead(intro),
    metaRow(`${mdy(p.period.start)} – ${mdy(p.period.end)}`),
    card(inner),
    signoffRow(),
    `<tr><td align="center" style="padding:6px 0 0 0;font-size:11px;color:#a1a8b3;line-height:18px;">Cloudflare Worker 自动通知</td></tr>`,
  ].join('');

  const text = [
    'Dear Max',
    '',
    'Good day.',
    '',
    isMonth
      ? 'I have checked the physiological data Oura captured over the past month, but there is nothing to compile for this period.'
      : 'I have checked the physiological data Oura captured over the past week, but there is nothing to compile for this period.',
    '',
    `${mdy(p.period.start)} – ${mdy(p.period.end)}`,
    '',
    `统计区间 ${p.period.start} 至 ${p.period.end}（${p.cur.day_count} 天）在 Oura 云上没有任何睡眠记录。`,
    '常见原因：这段时间没戴戒指、戒指没电，或手机上的 Oura App 一直没有同步。',
    '',
    '打开 Oura App 让它同步一次，下个周期就会恢复正常。',
    '',
    'Wishing you a steady day.',
    '— Jarvis (Oura Clone)',
  ].join('\n');

  return { subject, html: shell(`${p.label.title} 没有 Oura 数据`, body, title), text };
}

export function renderPeriodText(p) {
  const isMonth = p.kind === 'monthly';
  const prevWord = p.prev_title.replace('较', '');
  const pick = (k) => p.rows.find((r) => r.k === k);

  const line = (r) => {
    const v = fmtVal(r.t, r.cur, r.unit);
    if (!p.has_prev || typeof r.delta !== 'number') return `· ${r.label} ${v}`;
    return `· ${r.label} ${v}（${fmtDelta(r.t, r.delta)}）`;
  };

  const lines = [
    'Dear Max',
    '',
    'Good day.',
    '',
    isMonth
      ? 'I have processed and compiled your physiological data captured over the past month by Oura for this health briefing.'
      : 'I have processed and compiled your physiological data captured over the past week by Oura for this health briefing.',
    '',
    `${mdy(p.period.start)} – ${mdy(p.period.end)}`,
    '',
    `睡眠 ${fmtVal('score', pick('sleep').cur)} 分（${grade(pick('sleep').cur).label}）${
      p.has_prev ? fmtDelta('score', pick('sleep').delta) : ''
    }`,
    `准备度 ${fmtVal('score', pick('readiness').cur)} 分（${grade(pick('readiness').cur).label}）${
      p.has_prev ? fmtDelta('score', pick('readiness').delta) : ''
    }`,
    `活动 ${fmtVal('score', pick('activity').cur)} 分（${grade(pick('activity').cur).label}）${
      p.has_prev ? fmtDelta('score', pick('activity').delta) : ''
    }`,
    '',
    `${prevWord}对比`,
    ...p.rows.map(line),
    '',
    '亮点与异常',
  ];
  for (const t of p.highlights) lines.push(`· ${t.replace(/<\/?b>/g, '')}`);
  lines.push('', p.insight ? (isMonth ? '本月解读与下月建议' : '本周解读与下周建议') : isMonth ? '下个月建议' : '下周建议');
  if (p.insight) {
    lines.push(p.insight.summary);
    for (const item of p.insight.priorities) lines.push(`· ${item.title}：${item.action}`);
    lines.push(p.insight.caution);
  } else {
    for (const t of p.advice) lines.push(`· ${t.replace(/<\/?b>/g, '')}`);
  }
  lines.push('', 'Wishing you a steady day.', '— Jarvis (Oura Clone)');

  return lines.join('\n');
}
