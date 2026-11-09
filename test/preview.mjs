// 本地预览：用演示数据渲染日报 / 周报 / 月报，输出到 test/ 目录
// 用法：node test/preview.mjs [YYYY-MM-DD]
//   preview.html  日报
//   weekly.html   周报
//   monthly.html  月报
//   alert.html    告警邮件
//   *.txt         对应的纯文本版本

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { demoRaw } from '../src/demo.js';
import { addDays, buildPayload, todayInTZ } from '../src/report.js';
import { deltaInline } from '../src/delta.js';
import { GREEN, RED, GRAY, METRIC } from '../src/ui.js';
import { buildPeriodPayload, daysBetween, monthRange, weekRange } from '../src/period.js';
import { renderEmail, renderAlert } from '../src/email.js';
import { renderPeriodEmail } from '../src/email-period.js';
import { buildDailyRuleInsight, buildPeriodRuleInsight } from '../src/insights.js';

const here = dirname(fileURLToPath(import.meta.url));
const today = process.argv[2] || todayInTZ('Asia/Shanghai');

const out = (name, content) => writeFileSync(join(here, name), content, 'utf8');
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1);
const checks = (label, html) => {
  const svg = (html.match(/<svg/gi) || []).length;
  const style = (html.match(/<style/gi) || []).length;
  console.log(`${label}: ${kb(html)} KB · SVG ${svg} · <style> ${style}`);
  if (svg || style) console.log(`  ⚠️ ${label} 含有不被邮件客户端支持的标签`);
};

const deltaChecks = [
  ['入睡耗时下降', deltaInline({ t: 'dur', cur: 14 * 60, prev: 20 * 60, pref: 'down' }), GREEN],
  ['HRV 下降', deltaInline({ t: 'int', cur: 40, prev: 50, pref: 'up' }), RED],
  ['体温偏差变化', deltaInline({ t: 'float1', cur: 0.4, prev: 0.1, pref: 'none' }), GRAY],
];
for (const [label, html, color] of deltaChecks) {
  if (!html.includes(`color:${color}`)) throw new Error(`${label} 的箭头颜色错误`);
}

// ---- 日报 ----
// 演示数据要比趋势窗口多两天：活动整体滞后一天，它的「7 日均值」还要再往前一天
const rawDaily = demoRaw(9, today);
const p = buildPayload(rawDaily, 7, today);
p.insight = buildDailyRuleInsight(p);
if (p.insight.advice_chains.length !== 3) throw new Error('日报必须生成三条建议');
const daily = renderEmail(p);
out('preview.html', daily.html);
out('preview.txt', daily.text);
if (!daily.html.includes('准备度归因：') || daily.html.includes('今日重点')) throw new Error('日报准备度主卡样式不正确');

// 动态标签场景：确认「宝宝夜醒频繁」不会被写成自主熬夜或失眠。
const rawTagged = demoRaw(9, today);
rawTagged.tag = [{ id: 'demo-tag-child-waking', day: today, tag_type_name: '宝宝夜醒频繁' }];
const taggedPayload = buildPayload(rawTagged, 7, today);
taggedPayload.insight = buildDailyRuleInsight(taggedPayload);
out('daily-tags.html', renderEmail(taggedPayload).html);

// 因果建议场景：确认“HRV 下降 + 就寝推迟”会合成为一条可归因的行动建议。
const rawCausal = demoRaw(9, today);
const currentSleep = rawCausal.sleep.find((item) => item.day === today);
currentSleep.average_hrv = 32;
currentSleep.bedtime_start = `${addDays(today, -1)}T00:25:00+08:00`;
const causalPayload = buildPayload(rawCausal, 7, today);
causalPayload.insight = buildDailyRuleInsight(causalPayload);
const causal = renderEmail(causalPayload);
out('daily-causal.html', causal.html);
out('daily-causal.txt', causal.text);

// ---- 周报 / 月报：演示数据要覆盖到「上上期」 ----
const mRange = monthRange(today);
const wRange = weekRange(today);
const span = Math.max(daysBetween(mRange.prevStart, today), daysBetween(wRange.prevStart, today));
const rawPeriod = demoRaw(span, today);

const weeklyPayload = buildPeriodPayload(rawPeriod, 'weekly', today);
weeklyPayload.insight = buildPeriodRuleInsight(weeklyPayload);
const weekly = renderPeriodEmail(weeklyPayload);
out('weekly.html', weekly.html);
out('weekly.txt', weekly.text);

const monthlyPayload = buildPeriodPayload(rawPeriod, 'monthly', today);
monthlyPayload.insight = buildPeriodRuleInsight(monthlyPayload);
const monthly = renderPeriodEmail(monthlyPayload);
out('monthly.html', monthly.html);
out('monthly.txt', monthly.text);

if (!weekly.html.includes('较上周')) throw new Error('周报顶部缺少较上周口径');
if (!monthly.html.includes('较上月')) throw new Error('月报顶部缺少较上月口径');
if (weekly.html.includes('letter-spacing:-0.5px;">Weekly Health Report') || monthly.html.includes('letter-spacing:-0.5px;">Monthly Health Report')) throw new Error('周期报告不应显示英文首屏标题');
if (!weekly.html.includes('统计日期：') || !monthly.html.includes('统计日期：')) throw new Error('周期报告缺少统计日期标签');
if (weekly.html.includes('目标 10k') || monthly.html.includes('目标 10k')) throw new Error('步数图不应显示目标文字');
if (weekly.html.includes('border-top:1px dashed #9CA3AF') || monthly.html.includes('border-top:1px dashed #9CA3AF')) throw new Error('步数图不应显示虚线目标线');
if (!weekly.html.includes('本周睡眠达标日历（≥7h）')) throw new Error('周报缺少睡眠达标日历');
if (!monthly.html.includes('每周平均睡眠达标')) throw new Error('月报缺少每周平均睡眠达标格');
for (const [label, html] of [['日报', daily.html], ['周报', weekly.html], ['月报', monthly.html]]) {
  for (const text of ['数据源', '统计区间', '基线口径']) {
    if (!html.includes(text)) throw new Error(`${label} 缺少数据溯源 ${text}`);
  }
}

// 睡眠达标日历必须能同时呈现达标紫色与未达标灰色。
const rawSleepTarget = demoRaw(span, today);
for (const [index, item] of rawSleepTarget.sleep.filter((item) => item.day >= wRange.start && item.day <= wRange.end).entries()) {
  item.total_sleep_duration = index % 2 ? 6 * 3600 + 45 * 60 : 7 * 3600 + 30 * 60;
}
const sleepTargetWeek = renderPeriodEmail(buildPeriodPayload(rawSleepTarget, 'weekly', today));
if (!sleepTargetWeek.html.includes('background:#EDE9FE') || !sleepTargetWeek.html.includes('background:#ECEEF0')) {
  throw new Error('睡眠达标日历没有正确区分达标与未达标');
}

for (const [label, html] of [['日报', daily.html], ['周报', weekly.html], ['月报', monthly.html]]) {
  for (const color of Object.values(METRIC)) {
    if (!html.includes(color)) throw new Error(`${label} 缺少统一指标色板 ${color}`);
  }
}

// ---- 数据不足的降级版式：只有 3 天数据、上期完全空白 ----
// 用来确认提示条和「上期无数据」的呈现，而不是等真遇到才发现糊了
const sparse = renderPeriodEmail(buildPeriodPayload(demoRaw(3, today), 'weekly', today));
out('weekly-sparse.html', sparse.html);

// ---- 告警邮件 ----
const alert = renderAlert(
  'reauth',
  '还没完成 Oura 授权，或者授权记录被清掉了。<br>授权一次即可长期使用，之后令牌会自动刷新。',
  today,
  'https://oura-daily.example.workers.dev/oauth/start?key=demo-key'
);
out('alert.html', alert.html);

console.log('=== 主题行 ===');
console.log('日报：', daily.subject);
console.log('周报：', weekly.subject);
console.log('月报：', monthly.subject);
console.log('告警：', alert.subject);
console.log('');
console.log('=== 体积与兼容性 ===');
checks('日报', daily.html);
checks('周报', weekly.html);
checks('月报', monthly.html);
console.log('');
console.log('=== 周报正文 ===');
console.log(weekly.text);
console.log('');
console.log('=== 月报正文 ===');
console.log(monthly.text);
