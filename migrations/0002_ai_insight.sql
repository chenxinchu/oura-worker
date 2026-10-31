-- 模型洞察缓存。保留输入哈希和 prompt 版本，避免同一份报告重复调用模型；
-- 不保存 Oura 原始数据，洞察内容仅为已聚合事实上的解释和建议。
CREATE TABLE IF NOT EXISTS ai_insight (
  report_type    TEXT    NOT NULL, -- daily / weekly / monthly
  report_key     TEXT    NOT NULL, -- 日报日期，或周期起止日期
  input_hash     TEXT    NOT NULL, -- 发送给模型的最小化事实摘要哈希
  prompt_version TEXT    NOT NULL,
  source         TEXT    NOT NULL, -- rules / llm
  model          TEXT,
  content_json   TEXT    NOT NULL,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (report_type, report_key, input_hash, prompt_version)
);
