// 邮件版渲染：只用 table + 内联样式，不用 SVG、不用 <style>
// 通用 UI 件在 ui.js，这里只放日报特有的版式

import { dur, num, signed, grade, advice } from './report.js';
import { deltaTag, deltaInline, deltaText } from './delta.js';
import {
  INK,
  MUTED,
  card,
  sectionTitle,
  metricGrid,
  dur0,
  bulletList,
  shell,
  letterHead,
  metaRow,
  signoffRow,
} from './ui.js';

function scoreRow(p) {
  const gs = grade(p.sleep_score);
  const gr = grade(p.readiness_score);
  const ga = grade(p.activity_score);
  const cmp = p.cmp || {};
  // 变化紧跟在分数右边，跟明细格的呈现保持一致
  const cell = (label, score, g, accent, tag) => `<td width="33.33%" align="center" style="padding:8px 2px;vertical-align:top;">
    <div style="line-height:36px;white-space:nowrap;">
      <span style="font-size:32px;font-weight:700;color:${accent};">${
        typeof score === 'number' ? Math.round(score) : '—'
      }</span>${tag ? `<span style="margin-left:6px;vertical-align:3px;">${tag}</span>` : ''}
    </div>
    <div style="font-size:12px;color:#4b5563;line-height:18px;padding-top:5px;">${label}</div>
    <div style="font-size:11px;color:${g.color};line-height:16px;">${g.label}</div>
  </td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
    ${cell('睡眠', p.sleep_score, gs, '#7c5cff', deltaInline(cmp.sleep))}
    ${cell('准备度', p.readiness_score, gr, '#16a34a', deltaInline(cmp.readiness))}
    ${cell('活动', p.activity_score, ga, '#0ea5e9', deltaInline(cmp.activity))}
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
      [deep, '#4338ca'],
      [rem, '#7c5cff'],
      [light, '#c4b5fd'],
      [awake, '#d8dbe0'],
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
      ${leg('#4338ca', `深睡 ${dur(deep)}`, deltaTag(cmp.deep, 'left'))}
      ${leg('#7c5cff', `REM ${dur(rem)}`, deltaTag(cmp.rem, 'left'))}
      ${leg('#c4b5fd', `浅睡 ${dur(light)}`)}
      ${leg('#d8dbe0', `清醒 ${dur(awake)}`)}
    </tr></table>`;
}

function trendBlock(title, trend, key, color, avg) {
  const n = trend.length || 1;
  const bars = trend
    .map((t, i) => {
      const v = t[key];
      const has = typeof v === 'number';
      const h = has ? Math.max(5, Math.round((v / 100) * 54)) : 4;
      const bg = has ? color : '#eceef2';
      const op = i === n - 1 ? 1 : 0.45;
      return `<td width="${(100 / n).toFixed(2)}%" height="58" valign="bottom" align="center"
        style="height:58px;padding:0 3px;vertical-align:bottom;">
        <div style="height:${h}px;background:${bg};opacity:${op};border-radius:2px;font-size:0;line-height:0;">&nbsp;</div>
      </td>`;
    })
    .join('');

  const labels = trend
    .map(
      (t) =>
        `<td width="${(100 / n).toFixed(2)}%" align="center" style="font-size:10px;color:#a1a8b3;line-height:14px;padding:5px 0 0 0;">${t.label}</td>`
    )
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0;">
    <tr><td style="padding:0 0 6px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
        <td style="font-size:11px;color:#6b7280;line-height:16px;">${title}</td>
        <td align="right" style="font-size:11px;color:#a1a8b3;line-height:16px;">近 ${n} 日均 ${typeof avg === 'number' ? Math.round(avg) : '—'}</td>
      </tr></table>
    </td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${bars}</tr></table></td></tr>
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${labels}</tr></table></td></tr>
  </table>`;
}

function adviceList(p) {
  return bulletList(advice(p));
}

export function renderEmail(p) {
  const d = p.detail || {};
  // 主题只留报告名 + 署名，分数和日期在正文里
  const subject = 'Daily Health Report · Jarvis (Oura Clone)';

  const cmp = p.cmp || {};
  const dt = (k) => deltaInline(cmp[k]);

  const sleepMetrics = [
    ['总睡眠', dur(d.total_sleep_duration), '', dt('total_sleep')],
    ['在床时间', dur(d.time_in_bed), '', dt('time_in_bed')],
    ['睡眠效率', num(d.efficiency, 0, '%'), '', dt('efficiency')],
    ['入睡耗时', dur(d.latency), '', dt('latency')],
    ['平均心率', num(d.average_heart_rate, 0), 'bpm', dt('avg_hr')],
    ['平均 HRV', num(d.average_hrv, 0), 'ms', dt('hrv')],
    ['最低心率', num(d.lowest_heart_rate, 0), 'bpm', dt('low_hr')],
    ['呼吸频率', num(d.average_breath, 1), 'rpm', dt('breath')],
  ];

  const bodyMetrics = [
    ['静息心率得分', num(p.ready_contrib.resting_heart_rate, 0), '分', dt('resting_hr')],
    ['HRV 平衡', num(p.ready_contrib.hrv_balance, 0), '分', dt('hrv_balance')],
    ['体温偏差', signed(p.temp_dev), '°C', dt('temp_dev')],
    ['恢复指数', num(p.ready_contrib.recovery_index, 0), '分', dt('recovery_index')],
    ['血氧 SpO2', num(p.spo2, 1), '%', dt('spo2')],
    ['呼吸紊乱指数', num(p.breathing_disturbance, 1), '', dt('breathing')],
    ['心血管年龄', num(p.vascular_age, 0), '岁', dt('vascular_age')],
    ['VO₂ Max', num(p.vo2max, 1), '', dt('vo2max')],
  ];

  const actMetrics = [
    ['步数', typeof p.steps === 'number' ? p.steps.toLocaleString('en-US') : '—', '', dt('steps')],
    ['活动消耗', num(p.active_cal, 0), 'kcal', dt('active_cal')],
    ['总消耗', num(p.total_cal, 0), 'kcal', dt('total_cal')],
    ['久坐时长', dur(p.sedentary), '', dt('sedentary')],
    ['高压力时长', dur0(p.stress_high), '', dt('stress_high')],
    ['恢复时长', dur0(p.recovery_high), '', dt('recovery_high')],
    ['压力概况', p.stress_summary],
    ['抗压水平', p.resilience],
  ];

  // 信件体：开头称呼 + 说明，结尾落款。中间才是数据表格
  const greet = letterHead(
    'I have processed and compiled your physiological data captured overnight by Oura for this health briefing.'
  );

  // 只留一行元信息：左边 月/日/年，右边 Oura Ring
  const header = metaRow(
    `${Number(p.report_day.slice(5, 7))}/${Number(p.report_day.slice(8, 10))}/${p.report_day.slice(0, 4)}`
  );

  const signoff = signoffRow();

  const body = [
    greet,
    header,
    card(scoreRow(p), '8px 16px 12px 16px'),
    card(`${sectionTitle('昨夜睡眠')}${sleepBar(d, cmp)}<div style="height:12px;font-size:0;line-height:0;">&nbsp;</div>${metricGrid(sleepMetrics)}`),
    card(`${sectionTitle('身体状态')}${metricGrid(bodyMetrics)}`),
    card(`${sectionTitle('活动与压力 · 昨日')}${metricGrid(actMetrics)}`),
    card(
      `${sectionTitle('近 ' + p.days + ' 天趋势')}` +
        trendBlock('睡眠评分', p.trend, 'sleep', '#7c5cff', p.avg.sleep) +
        trendBlock('准备度', p.trend, 'readiness', '#16a34a', p.avg.readiness) +
        trendBlock('活动评分', p.trend_act || p.trend, 'activity', '#0ea5e9', p.avg.activity)
    ),
    card(`${sectionTitle('今日建议')}${adviceList(p)}`, '16px 16px 8px 16px'),
    signoff,
    `<tr><td align="center" style="padding:6px 0 0 0;font-size:11px;color:#a1a8b3;line-height:18px;">
      数据来源 Oura Cloud API v2 · 由 Cloudflare Worker 自动生成<br>
      报告日期 ${p.report_day} · 令牌直连，不经第三方
    </td></tr>`,
  ].join('');

  const preheader = `睡眠 ${typeof p.sleep_score === 'number' ? Math.round(p.sleep_score) : '—'} 分，准备度 ${
    typeof p.readiness_score === 'number' ? Math.round(p.readiness_score) : '—'
  } 分，${typeof p.steps === 'number' ? p.steps.toLocaleString('en-US') + ' 步' : '步数缺失'}`;

  return { subject, html: shell(preheader, body), text: renderText(p) };
}

export function renderText(p) {
  const d = p.detail || {};
  const gs = grade(p.sleep_score);
  const gr = grade(p.readiness_score);
  const ga = grade(p.activity_score);
  const dt0 = p.report_day;
  const cmp = p.cmp || {};
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
    `活动 ${num(p.activity_score)} 分 · ${ga.label}${t('activity')}`,
    `${typeof p.steps === 'number' ? p.steps.toLocaleString('en-US') + ' 步' : '步数缺失'}${t('steps')}｜消耗 ${num(
      p.active_cal
    )} kcal${t('active_cal')}`,
    `总消耗 ${num(p.total_cal)} kcal${t('total_cal')}｜久坐 ${dur(p.sedentary)}${t('sedentary')}`,
    `高压力 ${dur0(p.stress_high)}${t('stress_high')}｜恢复 ${dur0(p.recovery_high)}${t('recovery_high')}`,
    `压力概况 ${p.stress_summary}｜抗压水平 ${p.resilience}`,
    '',
    '↑↓ 为较前一日变化',
    '',
    '今日建议',
  ];
  for (const x of advice(p)) lines.push('· ' + x.replace(/<\/?b>/g, ''));
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
