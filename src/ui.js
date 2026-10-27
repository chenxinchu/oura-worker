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

export function card(inner, padding = '16px 16px 12px 16px') {
  return `<tr><td style="padding:0 0 12px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:#ffffff;border:1px solid #e9ebef;border-radius:12px;">
      <tr><td style="padding:${padding};">${inner}</td></tr>
    </table>
  </td></tr>`;
}

export function sectionTitle(text) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;"><tr>
    <td width="3" style="width:3px;background:${ACCENT};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
    <td style="padding-left:8px;font-size:14px;font-weight:700;color:#111827;line-height:18px;">${text}</td>
  </tr></table>`;
}

export function metricCell(item) {
  if (!item) return '<td width="50%"></td>';
  const [label, value, unit] = item;
  const u = unit ? `<span style="font-size:11px;font-weight:400;color:#9ca3af;"> ${unit}</span>` : '';
  return `<td width="50%" style="padding:6px 8px 6px 0;vertical-align:top;">
    <div style="font-size:11px;color:${MUTED};line-height:16px;">${label}</div>
    <div style="font-size:16px;font-weight:700;color:${INK};line-height:22px;">${value}${u}</div>
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

// 带「→」的条目列表，日报的建议、周报的亮点都复用
export function bulletList(items, color = ACCENT) {
  return items
    .map(
      (t) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td width="16" valign="top" style="width:16px;font-size:13px;line-height:21px;color:${color};font-weight:700;">→</td>
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

export function shell(preheader, body, title = 'Oura 健康日报') {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8;">
<div style="display:none;font-size:1px;color:#f5f6f8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>
<div style="background:#f5f6f8;padding:22px 10px 30px 10px;">
  <div style="max-width:600px;margin:0 auto;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
      ${body}
    </table>
  </div>
</div>
</body></html>`;
}
