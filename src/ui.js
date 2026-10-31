// 邮件 UI 基础件：只用 table + 内联样式，不用 SVG、不用 <style>
// 原因：Gmail / Outlook 不渲染 SVG，多数客户端会剥掉 <style>
// 日报、周报、月报共用这一套，避免样式各写一份后跑偏

import { dur } from './report.js';

export const FONT = "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',Arial,sans-serif";
export const INK = '#1a1d21';
export const MUTED = '#8b93a1';

export const GREEN = '#16a34a';
export const RED = '#dc2626';
export const GRAY = '#9ca3af';
export const ACCENT = '#7c5cff';

// 日报视觉规范：浅灰底 + 纯白卡 + 大圆角 + 柔和阴影，颜色只点缀数字与标记
export const D = {
  bg: '#F3F4F6',
  card: '#FFFFFF',
  ink: '#222226',
  title: '#44444B',
  sub: '#888890',
  hair: '#E4E5EA',
  sleep: '#A78BFA',
  ready: '#34D399',
  active: '#60A5FA',
  warn: '#FB923C',
};

// 日报卡片：无边框、20px 圆角、0 8px 24px 阴影；variant 留空时沿用周报/月报的细边框样式
export function card(inner, padding = '16px 16px 12px 16px', variant = 'plain') {
  const skin =
    variant === 'soft'
      ? `background:${D.card};border-radius:20px;box-shadow:0 8px 24px rgba(0,0,0,0.06);`
      : 'background:#ffffff;border:1px solid #e9ebef;border-radius:12px;';
  return `<tr><td style="padding:0 0 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${skin}">
      <tr><td style="padding:${padding};">${inner}</td></tr>
    </table>
  </td></tr>`;
}

export function sectionTitle(text, color = '#111827') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;"><tr>
    <td width="3" style="width:3px;background:${ACCENT};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding-left:8px;font-size:14px;font-weight:700;color:${color};line-height:18px;">${text}</td>
  </tr></table>`;
}

// 日报标题：去掉竖条，只留字重与字色，靠留白分隔
export function plainTitle(text, color = D.title, size = 14) {
  return `<div style="font-size:${size}px;font-weight:700;color:${color};line-height:20px;padding:0 0 12px 0;">${text}</div>`;
}

// item = [label, value, unit?, deltaHtml?, noteHtml?]
// deltaHtml 是「较前一日 / 较 7 日均」的小字，紧跟在数值后面，没有就不占位
export function metricCell(item) {
  if (!item) return '<td width="50%"></td>';
  const [label, value, unit, extra, note] = item;
  const u = unit ? `<span style="font-size:11px;font-weight:400;color:#9ca3af;"> ${unit}</span>` : '';
  const tail = extra ? `<span style="margin-left:7px;">${extra}</span>` : '';
  return `<td width="50%" style="padding:6px 12px 6px 0;vertical-align:top;">
    <div style="font-size:11px;color:${MUTED};line-height:16px;">${label}</div>
    <div style="font-size:16px;font-weight:700;color:${INK};line-height:22px;">${value}${u}${tail}</div>${note || ''}
  </td>`;
}

export function metricGrid(items) {
  let rows = '';
  for (let i = 0; i < items.length; i += 2) {
    rows += `<tr>${metricCell(items[i])}${metricCell(items[i + 1])}</tr>`;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${rows}</table>`;
}

// 0 秒对压力/恢复时长是有意义的数值，不能用 dur() 判成缺失
export const dur0 = (sec) => (typeof sec === 'number' && isFinite(sec) ? (sec > 0 ? dur(sec) : '0m') : '—');

// 带「→」的条目列表，日报的建议、周报的亮点都复用；glyph='dot' 时换成实心圆点
export function bulletList(items, color = ACCENT, glyph = 'arrow') {
  const mark = glyph === 'dot' ? '•' : '→';
  return items
    .map(
      (t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td width="16" valign="top" style="width:16px;font-size:13px;line-height:21px;color:${color};font-weight:700;">${mark}</td>
      <td style="font-size:13px;line-height:21px;color:#374151;padding:0 0 8px 0;">${t}</td>
    </tr></table>`
    )
    .join('');
}

// 提示条：数据不足、上期无对比之类的情况用它，不要静默糊过去
export function noticeBar(text, tone = 'warn') {
  const c =
    tone === 'warn'
      ? { bg: '#fff8ed', bd: '#f6d9a8', fg: '#92400e' }
      : { bg: '#f4f2ff', bd: '#ddd6fe', fg: '#5b45c9' };
  return `<tr><td style="padding:0 0 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:${c.bg};border:1px solid ${c.bd};border-radius:10px;table-layout:fixed;">
      <tr><td style="padding:10px 12px;font-size:12px;line-height:19px;color:${c.fg};">${text}</td></tr>
    </table>
  </td></tr>`;
}

// 信件体骨架：日报 / 周报 / 月报共用，只有 intro 那句话按周期换
export function letterHead(intro) {
  return `<tr><td style="padding:0 0 16px 0;">
    <div style="font-size:15px;font-weight:700;color:${INK};line-height:22px;">Dear Max</div>
    <div style="font-size:13px;color:#374151;line-height:22px;padding-top:12px;">Good day.</div>
    <div style="font-size:13px;color:#374151;line-height:22px;padding-top:8px;">${intro}</div>
  </td></tr>`;
}

// 一行元信息：左边日期，右边品牌
export function metaRow(text) {
  return `<tr><td style="padding:0 0 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td valign="middle" style="font-size:12px;color:${MUTED};line-height:18px;">${text}</td>
      <td align="right" valign="middle" style="font-size:11px;color:#a1a8b3;line-height:18px;">Oura Ring</td>
    </tr></table>
  </td></tr>`;
}

// 落款：祝福语居左，签名单独居右
export function signoffRow() {
  return `<tr><td style="padding:2px 0 14px 0;">
    <div style="font-size:13px;color:#374151;line-height:22px;">Wishing you a steady day.</div>
    <div align="right" style="font-size:13px;color:#6b7280;line-height:22px;padding-top:6px;">— Jarvis (Oura Clone)</div>
  </td></tr>`;
}

export function shell(preheader, body, title = 'Oura 健康日报', bg = '#f5f6f8') {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${bg};">
<div style="display:none;font-size:1px;color:${bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<div style="background:${bg};padding:22px 10px 30px 10px;">
  <div style="max-width:600px;margin:0 auto;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
      ${body}
    </table>
  </div>
</div>
</body></html>`;
}
