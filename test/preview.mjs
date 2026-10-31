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
import { buildPayload, todayInTZ } from '../src/report.js';
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

// ---- 日报 ----
// 演示数据要比趋势窗口多两天：活动整体滞后一天，它的「7 日均值」还要再往前一天
const rawDaily = demoRaw(9, today);
const p = buildPayload(rawDaily, 7, today);
p.insight = buildDailyRuleInsight(p);
const daily = renderEmail(p);
out('preview.html', daily.html);
out('preview.txt', daily.text);

// 动态标签场景：确认「宝宝夜醒频繁」不会被写成自主熬夜或失眠。
const rawTagged = demoRaw(9, today);
rawTagged.tag = [{ id: 'demo-tag-child-waking', day: today, tag_type_name: '宝宝夜醒频繁' }];
const taggedPayload = buildPayload(rawTagged, 7, today);
taggedPayload.insight = buildDailyRuleInsight(taggedPayload);
out('daily-tags.html', renderEmail(taggedPayload).html);

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
