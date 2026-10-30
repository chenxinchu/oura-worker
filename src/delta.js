// 日报的「较前一日」标记
// 只负责把两个数字变成一段小字，不参与取数，也不改版式

import { fmtDelta } from './period.js';
import { GREEN, RED, GRAY } from './ui.js';

// 小于这个幅度算持平，避免「+0.4 分」这种噪音
const EPS = { dur: 60, score: 0.5, pct: 0.5, int: 0.5, float1: 0.05 };

const isNum = (v) => typeof v === 'number' && isFinite(v);

// 写法规则（用户定的）：时间类给绝对数字，得分类给百分数
//   dur            → +29m / −5m
//   score / pct    → +4.2% / −1.8%
//   int / float1   → +2,745 / +2 / +0.3（上面已有单位，这里不重复）
// fmt='points' 时得分类改用绝对分数差（三大评分用这个：0–100 分制下百分比不直观）
export function change(t, cur, prev, fmt) {
  if (!isNum(cur) || !isNum(prev)) return null;
  const d = cur - prev;
  const eps = EPS[t] ?? 0.5;
  if (Math.abs(d) <= eps) return { text: '持平', dir: 0 };

  if (t === 'dur') return { text: fmtDelta('dur', d), dir: d > 0 ? 1 : -1 };

  const sign = d > 0 ? '+' : '−';
  if (t === 'score' || t === 'pct') {
    if (fmt === 'points') return { text: `${sign}${Math.abs(Math.round(d))}`, dir: d > 0 ? 1 : -1 };
    if (prev === 0) return null; // 除零，宁可不出标记也不出 Infinity
    return { text: `${sign}${Math.abs((d / Math.abs(prev)) * 100).toFixed(1)}%`, dir: d > 0 ? 1 : -1 };
  }
  if (t === 'float1') return { text: `${sign}${Math.abs(d).toFixed(1)}`, dir: d > 0 ? 1 : -1 };
  return { text: `${sign}${Math.abs(Math.round(d)).toLocaleString('en-US')}`, dir: d > 0 ? 1 : -1 };
}

// 方向好坏由指标自己决定：入睡耗时、最低心率是降了才好
function tone(r, pref) {
  if (!r || r.dir === 0 || pref === 'none') return GRAY;
  return (pref === 'up' ? r.dir > 0 : r.dir < 0) ? GREEN : RED;
}

const arrowOf = (r) => (r.dir > 0 ? '↑' : r.dir < 0 ? '↓' : '');

function piece(r, pref) {
  const color = tone(r, pref);
  const a = arrowOf(r);
  const body = a ? `${a}${r.text.replace(/^[+−]/, '')}` : r.text;
  return `<span style="color:${color};font-weight:700;">${body}</span>`;
}

// 一段标记，行内片段，由调用方决定紧跟数值还是另起一行
// 前一日没数据就什么都不显示 —— 空着比挂个「无对比」干净，也不占位
export function deltaInline(c) {
  if (!c) return '';
  const r = change(c.t, c.cur, c.prev, c.fmt);
  if (!r) return '';
  return `<span style="font-size:10px;line-height:14px;white-space:nowrap;">${piece(r, c.pref)}</span>`;
}

// 需要单独占一行时用（图例下方）
export function deltaTag(c, align = 'right') {
  const inner = deltaInline(c);
  return inner ? `<div style="text-align:${align};">${inner}</div>` : '';
}

// 纯文本版：没有颜色可用，箭头 + 数字即可，符号不要重复（↑+5.7% 读起来别扭）
export function deltaText(c) {
  if (!c) return '';
  const r = change(c.t, c.cur, c.prev, c.fmt);
  if (!r) return '';
  return r.dir === 0 ? '持平' : `${arrowOf(r)}${r.text.replace(/^[+−]/, '')}`;
}
