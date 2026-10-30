// 周报 / 月报邮件渲染
// 与日报共用 ui.js 的基础件，但版式不同：主体是「环比对比表」而不是当日明细

import { grade } from './report.js';
import {
  INK,
  MUTED,
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
    ${cell('睡眠', pick('sleep'), '#7c5cff')}
    ${cell('准备度', pick('readiness'), GREEN)}
    ${cell('活动', pick('activity'), '#0ea5e9')}
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
      `${sectionTitle(isMonth ? '下个月建议' : '下周建议')}${bulletList(p.advice)}`,
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
  lines.push('', isMonth ? '下个月建议' : '下周建议');
  for (const t of p.advice) lines.push(`· ${t.replace(/<\/?b>/g, '')}`);
  lines.push('', 'Wishing you a steady day.', '— Jarvis (Oura Clone)');

  return lines.join('\n');
}
