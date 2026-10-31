// 洞察输出的边界：模型只能补充解释和建议，不能改写已计算的健康事实。

export const INSIGHT_PROMPT_VERSION = 'v9';
export const INSIGHT_CAUTION = '健康趋势参考，不构成医疗建议。';

const MAX = { summary: 240, title: 60, reason: 180, action: 240, caution: 100, section: 60 };

function text(v, max) {
  if (typeof v !== 'string') return null;
  const out = v.trim().replace(/\s+/g, ' ');
  return out && out.length <= max ? out : null;
}

// 卡片内的解读只有一句话：超长时在分句标点处收尾，不要硬切断在半句
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf('；'), cut.lastIndexOf('，'), cut.lastIndexOf('。'));
  return at >= max * 0.4 ? cut.slice(0, at) : cut;
}

// v8 及以前每段是 2–4 条要点数组，v9 起收敛为单句；旧缓存进来时合并成一句，避免历史日报渲染错乱
function sentence(v) {
  if (Array.isArray(v)) {
    const parts = v.map((item) => text(item, 180)).filter(Boolean);
    return parts.length ? clip(parts.join('；'), MAX.section) : null;
  }
  const single = text(v, MAX.section);
  return single || null;
}

// 只接受固定 JSON 结构；校验失败时调用方必须降级到规则建议。
export function validateInsight(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = text(value.summary, MAX.summary);
  if (!summary || !Array.isArray(value.priorities) || !value.priorities.length || value.priorities.length > 3) return null;

  const priorities = [];
  for (const item of value.priorities) {
    if (!item || typeof item !== 'object') return null;
    const title = text(item.title, MAX.title);
    const reason = text(item.reason, MAX.reason);
    const action = text(item.action, MAX.action);
    if (!title || !reason || !action) return null;
    priorities.push({ title, reason, action });
  }

  return {
    source: value.source === 'llm' ? 'llm' : 'rules',
    summary,
    priorities,
    caution: text(value.caution, MAX.caution) || INSIGHT_CAUTION,
  };
}

function shortMap(value, keys) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const key of keys) {
    const item = text(value[key], 90);
    if (!item) return null;
    out[key] = item;
  }
  return out;
}

// 周报/月报仍走 validateInsight 的要点列表；日报每段收敛为一句，由 sentence() 校验

// 日报采用“数据卡 + 卡内一句点评”。缺任一段时整体降级到本地规则，避免半份 AI 文案。
export function validateDailyInsight(value) {
  if (!value || typeof value !== 'object') return null;
  // 提示词目标是 50 字；留出少量模型波动，避免一条略长摘要导致整份日报降级。
  const summary = text(value.summary, 70);
  const sections = value.sections && typeof value.sections === 'object'
    ? {
        sleep: sentence(value.sections.sleep),
        body: sentence(value.sections.body),
        activity: sentence(value.sections.activity),
      }
    : null;
  const trend_summary = text(value.trend_summary, 120);
  const advice = shortMap(value.advice, ['priority', 'watch', 'avoid', 'observe']);
  if (!summary || !sections?.sleep || !sections?.body || !sections?.activity || !trend_summary || !advice) return null;
  return {
    source: value.source === 'llm' ? 'llm' : 'rules',
    summary,
    sections,
    trend_summary,
    advice,
    caution: text(value.caution, MAX.caution) || INSIGHT_CAUTION,
  };
}
