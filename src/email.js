// 邮件版渲染：只用 table + 内联样式，不用 SVG、不用 <style>
// 通用 UI 件在 ui.js，这里只放日报特有的版式

import { dur, num, signed, grade, advice } from './report.js';
import { change, deltaTag, deltaInline, deltaText, deltaTone } from './delta.js';
import {
  D,
  METRIC,
  INK,
  MUTED,
  card,
  plainTitle,
  sectionTitle,
  metricGrid,
  dur0,
  bulletList,
  provenanceChips,
  shell,
  letterHead,
  metaRow,
  signoffRow,
} from './ui.js';

const esc = (text) =>
  String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function baseline(p, key, format) {
  const b = p.baseline?.[key];
  if (!b || typeof b.avg !== 'number') return '基线 —';
  const value = format ? format(b.avg) : Math.round(b.avg);
  return `基线 ${value}${b.n < 7 ? `（${b.n}天）` : ''}`;
}

function baselineMeta(p, key, format) {
  const text = baseline(p, key, format);
  const tag = deltaInline(p.base_cmp?.[key]);
  return `<div style="font-size:10px;line-height:15px;color:${D.sub};padding-top:3px;">${text}${
    tag ? `<span style="margin-left:5px;">${tag}</span>` : ''
  }</div>`;
}

// 主卡箭头与明细共用同一套方向偏好配色。
function deltaWarn(c, compact = false) {
  if (!c) return '';
  const r = change(c.t, c.cur, c.prev, c.fmt);
  if (!r) return '';
  const body = r.dir === 0 ? '持平' : `${r.dir > 0 ? '↑' : '↓'}${r.text.replace(/^[+−]/, '')}`;
  const color = deltaTone(r, c.pref);
  return `<span style="font-size:11px;font-weight:700;color:${color};white-space:nowrap;margin-left:7px;vertical-align:${
    compact ? 'baseline' : '10px'
  }">${body}</span>`;
}

// 卡内一句点评：解读只保留这一行，不再单独成卡
function noteLine(text, color = D.sub) {
  if (!text) return '';
  return `<div style="padding-top:9px;font-size:12px;line-height:18px;color:${color};"><b style="color:${D.title};">综合解读：</b>${esc(text)}</div>`;
}

function scoreCard({ label, color, score, baseText, tag, featured = false, reason = '' }) {
  const statusColor = color;
  const skin = 'background:#F7F7F9;';
  const align = featured ? ' align="center"' : '';
  return `<td${featured ? '' : ' width="49%"'} valign="top" style="padding:0;">
    <div style="${skin}border-radius:14px;padding:12px 12px 11px 12px;">
    <div${align} style="font-size:11px;color:${D.sub};line-height:15px;">
      <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${statusColor};margin-right:5px;vertical-align:1px;"></span>${label}
    </div>
    <div${align} style="padding-top:5px;line-height:${featured ? '52px' : '38px'};white-space:nowrap;">
      <span style="font-size:34px;font-weight:800;color:${statusColor};letter-spacing:-.5px;">${
        typeof score === 'number' ? Math.round(score) : '—'
      }</span>
    </div>
    <div${align} style="font-size:10px;color:${D.sub};line-height:14px;">${baseText}${
      tag ? `<span style="margin-left:5px;">${tag}</span>` : ''
    }</div>
    ${reason}
    </div>
  </td>`;
}

function readinessReason(p) {
  const reason = p.insight?.readiness_reason || '准备度和最近一周接近';
  return `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #A7F3D0;font-size:12px;line-height:18px;color:${D.title};text-align:left;"><b style="color:#059669;">准备度归因：</b>${esc(reason)}</div>`;
}

function scoreTriplet(p) {
  const cmp = p.base_cmp || {};
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
    ${scoreCard({
      label: '准备度',
      color: METRIC.readiness,
      score: p.readiness_score,
      baseText: baseline(p, 'readiness'),
      tag: deltaWarn(cmp.readiness, true),
      featured: true,
      reason: readinessReason(p),
    })}
  </tr></table>
  <div style="height:12px;font-size:0;line-height:0;">&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
    ${scoreCard({
      label: '睡眠',
      color: METRIC.sleep,
      score: p.sleep_score,
      baseText: baseline(p, 'sleep'),
      tag: deltaInline(cmp.sleep),
    })}
    <td width="2%"></td>
    ${scoreCard({
      label: '活动',
      color: METRIC.activity,
      score: p.activity_score,
      baseText: baseline(p, 'activity'),
      tag: deltaInline(cmp.activity),
    })}
  </tr></table>`;
}

function sleepBar(d, cmp = {}) {
  const deep = d.deep_sleep_duration || 0;
  const rem = d.rem_sleep_duration || 0;
  const light = d.light_sleep_duration || 0;
  const awake = d.awake_time || 0;
  const tot = deep + rem + light + awake;

  let segs;
  if (tot > 0) {
    segs = [
      [deep, '#7C6BD6'],
      [rem, METRIC.sleep],
      [light, '#D5C8FB'],
      [awake, '#E4E5EA'],
    ].filter(([v]) => v > 0);
  } else {
    segs = [[1, '#eceef2']];
  }
  const sum = segs.reduce((a, [v]) => a + v, 0) || 1;

  const cells = segs
    .map(
      ([v, c]) =>
        `<td width="${((v / sum) * 100).toFixed(1)}%" style="padding:0;"><div style="height:10px;background:${c};font-size:0;line-height:0;">&nbsp;</div></td>`
    )
    .join('');

  // 深睡 / REM 是四栏里最窄的，标记只放「较前夜」，7 日均值在下面的明细格里给
  const leg = (c, t, tag) =>
    `<td width="25%" style="padding:8px 0 0 0;font-size:11px;color:#6b7280;line-height:16px;vertical-align:top;"><span style="display:inline-block;width:8px;height:8px;background:${c};border-radius:2px;margin-right:4px;"></span>${t}${
      tag ? `<div style="padding-left:12px;">${tag}</div>` : ''
    }</td>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#f1f2f5;border-radius:5px;overflow:hidden;table-layout:fixed;"><tr>${cells}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      ${leg('#7C6BD6', `深睡 ${dur(deep)}`, deltaTag(cmp.deep, 'left'))}
      ${leg(METRIC.sleep, `REM ${dur(rem)}`, deltaTag(cmp.rem, 'left'))}
      ${leg('#D5C8FB', `浅睡 ${dur(light)}`)}
      ${leg('#E4E5EA', `清醒 ${dur(awake)}`)}
    </tr></table>`;
}

// 邮件不支持可靠的绝对定位，用 10 层 table 网格画出纵向得分和横向个人基线。
function scoreBand(value) {
  if (typeof value !== 'number' || value < 0 || value > 100) return null;
  return Math.min(9, Math.floor((100 - Math.round(value)) / 10));
}

function trendBaseline(p, key) {
  const base = p.baseline?.[key];
  if (!base || typeof base.avg !== 'number') return { band: null, text: '基线暂无数据' };
  if (base.n < 5) return { band: null, text: `基线样本不足（${base.n}天）` };
  return { band: scoreBand(base.avg), text: `个人基线 ${Math.round(base.avg)}` };
}

function trendStrip(label, trend, key, color, base) {
  const markerBands = trend.map((item) => scoreBand(item[key]));
  const rows = Array.from({ length: 10 }, (_, band) => {
    const cells = markerBands
      .map((markerBand, index) => {
        const isToday = index === markerBands.length - 1;
        const line = base.band === band ? 'border-top:1px dashed #9CA3AF;' : '';
        const dot = markerBand === band
          ? `<span style="display:block;width:7px;height:7px;margin:-1px auto 0;background:${color};border:${isToday ? '1px solid #44444B' : '0'};border-radius:7px;font-size:0;line-height:0;">&nbsp;</span>`
          : '&nbsp;';
        return `<td style="padding:0;${line}"><div style="height:4px;font-size:0;line-height:0;">${dot}</div></td>`;
      })
      .join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  const values = trend
    .map((item, index) => `<td align="center" style="padding:4px 0 0;font-size:10px;line-height:13px;font-weight:${
      index === trend.length - 1 ? '700' : '400'
    };color:${index === trend.length - 1 ? D.title : D.sub};">${typeof item[key] === 'number' ? Math.round(item[key]) : '—'}</td>`)
    .join('');
  return `<tr>
    <td width="78" valign="top" style="width:78px;padding:7px 6px 0 0;font-size:11px;font-weight:700;color:${D.title};line-height:15px;">${label}<div style="font-size:9px;font-weight:400;color:${D.sub};line-height:13px;padding-top:2px;">${base.text}</div></td>
    <td colspan="7" style="padding:7px 0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${rows}</table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${values}</tr></table>
    </td>
  </tr>`;
}

function heatmap(p) {
  const days = p.trend || [];
  const head = days
    .map(
      (item, index) =>
        `<td align="center" style="font-size:9px;color:${index === days.length - 1 ? D.title : '#B6B8C0'};line-height:13px;padding:0 2px 4px 2px;">${item.label}</td>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
    <tr><td width="78" style="width:78px;"></td>${head}</tr>
    ${trendStrip('睡眠', days, 'sleep', METRIC.sleep, trendBaseline(p, 'sleep'))}
    ${trendStrip('准备度', days, 'readiness', METRIC.readiness, trendBaseline(p, 'readiness'))}
    ${trendStrip('活动', p.trend_act || days, 'activity', METRIC.activity, trendBaseline(p, 'activity'))}
  </table>`;
}

function adviceList(p) {
  if (!p.insight?.advice_chains) return bulletList(advice(p), '#8b93a1', 'dot');
  const item = (chain, index) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7F9;border-radius:14px;table-layout:fixed;"><tr>
    <td style="padding:12px 14px 13px 14px;">
      <div style="font-size:11px;font-weight:700;line-height:15px;color:${D.sub};">建议 ${index + 1}</div>
      <div style="padding-top:5px;font-size:13px;line-height:21px;color:#374151;">${esc(chain.anomaly)}，${esc(chain.factor)}；建议${esc(chain.action)}。</div>
    </td>
  </tr></table>`;
  return `${p.insight.advice_chains.map((chain, index) => `${item(chain, index)}<div style="height:8px;font-size:0;line-height:0;">&nbsp;</div>`).join('')}<div style="font-size:11px;line-height:18px;color:${D.sub};padding:0 0 2px 0;">${esc(p.insight.caution)}</div>`;
}

export function renderEmail(p) {
  const d = p.detail || {};
  // 主题只留报告名 + 署名，分数和日期在正文里
  const subject = 'Daily Health Report · Jarvis (Oura Clone)';

  const cmp = p.base_cmp || {};
  const dt = (k) => deltaInline(cmp[k]);
  const meta = (k, fmt) => baselineMeta(p, k, fmt);
  const int = (v) => Math.round(v).toLocaleString('en-US');
  const float1 = (v) => v.toFixed(1);

  const sleepMetrics = [
    ['总睡眠', dur(d.total_sleep_duration), '', '', meta('total_sleep', dur)],
    ['在床时间', dur(d.time_in_bed), '', '', meta('time_in_bed', dur)],
    ['睡眠效率', num(d.efficiency, 0, '%'), '', '', meta('efficiency', (v) => `${Math.round(v)}%`)],
    ['入睡耗时', dur(d.latency), '', '', meta('latency', dur)],
    ['深睡', dur(d.deep_sleep_duration), '', '', meta('deep', dur)],
    ['REM', dur(d.rem_sleep_duration), '', '', meta('rem', dur)],
    ['浅睡', dur(d.light_sleep_duration), '', '', meta('light', dur)],
    ['清醒', dur(d.awake_time), '', '', meta('awake', dur)],
    ['平均心率', num(d.average_heart_rate, 0), 'bpm', '', meta('avg_hr', int)],
    ['平均 HRV', num(d.average_hrv, 0), 'ms', '', meta('hrv', int), '#EFEFF2'],
    ['最低心率', num(d.lowest_heart_rate, 0), 'bpm', '', meta('low_hr', int)],
    ['呼吸频率', num(d.average_breath, 1), 'rpm', '', meta('breath', float1)],
  ];

  const bodyMetrics = [
    ['静息心率得分', num(p.ready_contrib.resting_heart_rate, 0), '分', '', meta('resting_hr', int)],
    ['HRV 平衡', num(p.ready_contrib.hrv_balance, 0), '分', '', meta('hrv_balance', int)],
    ['体温偏差', signed(p.temp_dev), '°C', '', meta('temp_dev', (v) => signed(v))],
    ['恢复指数', num(p.ready_contrib.recovery_index, 0), '分', '', meta('recovery_index', int), '#EFEFF2'],
    ['血氧 SpO2', num(p.spo2, 1), '%', '', meta('spo2', float1)],
    ['呼吸紊乱指数', num(p.breathing_disturbance, 1), '', '', meta('breathing', float1)],
    ['心血管年龄', num(p.vascular_age, 0), '岁', '', meta('vascular_age', int)],
    ['VO₂ Max', num(p.vo2max, 1), '', '', meta('vo2max', float1)],
  ];

  const activityMetrics = [
    ['活动负荷', p.activity_load?.level || '—'],
    ['步数', typeof p.steps === 'number' ? p.steps.toLocaleString('en-US') : '—', '', '', meta('steps', int)],
    ['活动消耗', num(p.active_cal, 0), 'kcal', '', meta('active_cal', int)],
    ['总消耗', num(p.total_cal, 0), 'kcal', '', meta('total_cal', int)],
    ['久坐时长', dur(p.sedentary), '', '', meta('sedentary', dur)],
  ];

  const pressureMetrics = [
    ['压力负荷', p.pressure_load?.level || '—'],
    ['高压力时长', dur0(p.stress_high), '', '', meta('stress_high', dur), '#EFEFF2'],
    ['恢复时长', dur0(p.recovery_high), '', '', meta('recovery_high', dur), '#EFEFF2'],
    ['压力概况', p.stress_summary],
    ['抗压水平', p.resilience],
  ];

  const header = metaRow(
    `${Number(p.report_day.slice(5, 7))}/${Number(p.report_day.slice(8, 10))}/${p.report_day.slice(0, 4)}`
  );
  const riskColor = p.coach?.risk === 'red' ? '#dc2626' : p.coach?.risk === 'yellow' ? '#d97706' : '#16a34a';
  const provenance = provenanceChips([
    { label: '数据源', text: 'Oura Cloud API v2' },
    { label: '统计区间', text: `睡眠 ${p.report_day.slice(5)} · 活动 ${p.act_day.slice(5)}` },
    { label: '基线口径', text: '近 7 天个人基线' },
  ]);

  const signoff = signoffRow();

  const body = [
    letterHead('I have processed and compiled your physiological data captured overnight by Oura for this health briefing.'),
    header,
    p.insight ? card(`<div style="border-left:3px solid ${riskColor};padding-left:10px;font-size:13px;line-height:22px;color:#374151;"><b style="color:${riskColor};">报告摘要：</b>${esc(p.insight.summary)}</div>`, '14px 16px', 'soft') : '',
    // 准备度独占主卡，睡眠和活动在下方并列，归因固定在主卡内左对齐。
    card(scoreTriplet(p), '18px 18px 16px 18px', 'soft'),
    card(
      `${plainTitle('昨夜睡眠')}${sleepBar(d, cmp)}<div style="height:12px;font-size:0;line-height:0;">&nbsp;</div>${metricGrid(sleepMetrics)}${noteLine(p.insight?.sections?.sleep)}`,
      '18px 18px 16px 18px',
      'soft'
    ),
    card(`${plainTitle('身体状态')}${metricGrid(bodyMetrics)}${noteLine(p.insight?.sections?.body)}`, '18px 18px 16px 18px', 'soft'),
    card(`${plainTitle('昨日活动')}${metricGrid(activityMetrics)}${noteLine(p.insight?.sections?.activity)}`, '18px 18px 16px 18px', 'soft'),
    card(`${plainTitle('昨日压力')}${metricGrid(pressureMetrics)}${noteLine(p.insight?.sections?.pressure)}`, '18px 18px 16px 18px', 'soft'),
    card(
      `${plainTitle('近 ' + p.days + ' 天趋势')}` +
        heatmap(p) +
        (p.insight ? `<div style="font-size:12px;line-height:19px;color:${D.sub};padding-top:2px;">${esc(p.insight.trend_summary)}</div>` : ''),
      '18px 18px 16px 18px',
      'soft'
    ),
    card(`${plainTitle('今日建议')}${adviceList(p)}`, '18px 18px 14px 18px', 'soft'),
    provenance,
    signoff,
    `<tr><td align="center" style="padding:6px 0 0 0;font-size:11px;color:#a1a8b3;line-height:18px;">
      由 Cloudflare Worker 自动生成
    </td></tr>`,
  ].join('');

  const preheader = `睡眠 ${typeof p.sleep_score === 'number' ? Math.round(p.sleep_score) : '—'} 分，准备度 ${
    typeof p.readiness_score === 'number' ? Math.round(p.readiness_score) : '—'
  } 分，${typeof p.steps === 'number' ? p.steps.toLocaleString('en-US') + ' 步' : '步数缺失'}`;

  return { subject, html: shell(preheader, body, 'Oura 健康日报', D.bg), text: renderText(p) };
}

export function renderText(p) {
  const d = p.detail || {};
  const gs = grade(p.sleep_score);
  const gr = grade(p.readiness_score);
  const ga = grade(p.activity_score);
  const dt0 = p.report_day;
  const cmp = p.base_cmp || {};
  // 纯文本里没有颜色和箭头列，变化直接跟在数值后面
  const t = (k) => {
    const s = deltaText(cmp[k]);
    return s ? ` ${s}` : '';
  };

  const lines = [
    'Dear Max',
    '',
    'Good day.',
    '',
    'I have processed and compiled your physiological data captured overnight by Oura for this health briefing.',
    '',
    `${Number(dt0.slice(5, 7))}/${Number(dt0.slice(8, 10))}/${dt0.slice(0, 4)}`,
    '',
    `睡眠 ${num(p.sleep_score)} 分 · ${gs.label}${t('sleep')}`,
    `${dur(d.total_sleep_duration)}${t('total_sleep')}｜深睡 ${dur(d.deep_sleep_duration)}${t('deep')}｜REM ${dur(
      d.rem_sleep_duration
    )}${t('rem')}`,
    `准备度 ${num(p.readiness_score)} 分 · ${gr.label}${t('readiness')}`,
    `平均心率 ${num(d.average_heart_rate)}bpm${t('avg_hr')}｜HRV ${num(d.average_hrv)}ms${t('hrv')}｜最低心率 ${num(
      d.lowest_heart_rate
    )}bpm${t('low_hr')}`,
    `体温 ${signed(p.temp_dev)}°C${t('temp_dev')}｜SpO2 ${num(p.spo2, 1)}%${t('spo2')}｜呼吸 ${num(
      d.average_breath,
      1
    )}rpm${t('breath')}`,
    `心血管年龄 ${num(p.vascular_age, 0)} 岁${t('vascular_age')}｜VO₂ Max ${num(p.vo2max, 1)}${t('vo2max')}`,
    '',
    `昨日活动 ${num(p.activity_score)} 分 · ${ga.label}${t('activity')}`,
    `${typeof p.steps === 'number' ? p.steps.toLocaleString('en-US') + ' 步' : '步数缺失'}${t('steps')}｜消耗 ${num(
      p.active_cal
    )} kcal${t('active_cal')}`,
    `总消耗 ${num(p.total_cal)} kcal${t('total_cal')}｜久坐 ${dur(p.sedentary)}${t('sedentary')}`,
    '',
    `昨日压力 · ${p.pressure_load?.level || '—'}`,
    `高压力 ${dur0(p.stress_high)}${t('stress_high')}｜恢复 ${dur0(p.recovery_high)}${t('recovery_high')}`,
    `压力概况 ${p.stress_summary}｜抗压水平 ${p.resilience}`,
    '',
    '↑↓ 为较近 7 天个人基线变化',
    '',
    p.insight ? '今日建议' : '今日建议',
  ];
  if (p.insight?.advice_chains) {
    lines.push(p.insight.summary);
    const sec = p.insight.sections || {};
    if (sec.sleep) lines.push(`睡眠：${sec.sleep}`);
    if (sec.body) lines.push(`身体：${sec.body}`);
    if (sec.activity) lines.push(`活动：${sec.activity}`);
    if (sec.pressure) lines.push(`压力：${sec.pressure}`);
    for (const item of p.insight.advice_chains) {
      lines.push(`· ${item.anomaly}，${item.factor}；建议${item.action}。`);
    }
    lines.push(p.insight.caution);
  } else if (p.insight) {
    lines.push(p.insight.summary);
    for (const x of p.insight.priorities) lines.push(`· ${x.title}：${x.action}`);
    lines.push(p.insight.caution);
  } else {
    for (const x of advice(p)) lines.push('· ' + x.replace(/<\/?b>/g, ''));
  }
  lines.push('', 'Wishing you a steady day.', '— Jarvis (Oura Clone)');
  return lines.join('\n');
}

// 数据未同步 / 授权失效 / 配置异常时的兜底邮件：宁可发一封说明，也不要静默失败
export function renderAlert(kind, detail, day, link) {
  const conf = {
    nodata: {
      subject: `⚠️ 昨夜数据未同步 · ${day.slice(5, 7)}/${Number(day.slice(8, 10))}`,
      title: '昨夜数据还没同步',
      hint: '打开手机上的 Oura App 让它同步一次，明天的日报就会恢复正常。',
    },
    reauth: {
      subject: '⚠️ 需要重新授权 Oura',
      title: 'Oura 授权需要更新',
      hint: '点下面按钮完成一次授权，之后令牌会自动续期，不用每天管。',
    },
    auth: {
      subject: '⚠️ Oura 授权失败',
      title: 'Oura 授权失败',
      hint: '检查 Oura 应用的 client_id / client_secret 是否正确。',
    },
    config: {
      subject: '⚠️ Oura 日报配置有问题',
      title: '配置异常',
      hint: '检查 wrangler.toml 里的 TO_EMAIL / FROM_EMAIL，以及 Resend 后台的发件域名状态。',
    },
  }[kind];

  const btn = link
    ? `<div style="height:14px;font-size:0;line-height:0;">&nbsp;</div>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
         <td style="background:#7c5cff;border-radius:8px;">
           <a href="${link}" style="display:inline-block;padding:10px 18px;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;">去授权</a>
         </td>
       </tr></table>
       <div style="height:8px;font-size:0;line-height:0;">&nbsp;</div>
       <div style="font-size:11px;line-height:18px;color:#a1a8b3;word-break:break-all;">${link}</div>`
    : '';

  const inner = `${sectionTitle(conf.title)}
    <div style="font-size:13px;line-height:22px;color:#374151;">${detail}</div>
    <div style="height:10px;font-size:0;line-height:0;">&nbsp;</div>
    <div style="font-size:13px;line-height:22px;color:#6b7280;">${conf.hint}</div>
    ${btn}`;

  const body = [
    `<tr><td style="padding:0 0 16px 0;font-size:21px;font-weight:700;color:${INK};line-height:27px;">Oura 健康日报</td></tr>`,
    card(inner),
    `<tr><td align="center" style="padding:6px 0 0 0;font-size:11px;color:#a1a8b3;line-height:18px;">Cloudflare Worker 自动通知</td></tr>`,
  ].join('');

  const text = [conf.title, '', detail.replace(/<br\s*\/?>/gi, '\n'), '', conf.hint, link ? `\n${link}` : ''].join('\n');
  return { subject: conf.subject, html: shell(conf.title, body), text };
}
