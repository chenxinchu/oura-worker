-- 历史数据缓存
-- 目的：日报/周报/月报需要的区间先查本地库，只有库里没有的日期才回源 Oura。
-- 这样统计周期再长（季报、年报）也不会撞免费版「单次 invocation 50 个配额」的上限。

-- 一行 = Oura 的一条原始记录，整条 JSON 存进 payload。
-- 不拆成宽表是刻意的：日报的 sleep detail 是整条对象直接传给渲染层的，
-- 拆宽表一旦漏存字段，就会出现「日报正常、从库里读就少一块」的隐性 bug。
CREATE TABLE IF NOT EXISTS oura_raw (
  endpoint   TEXT    NOT NULL,   -- daily_sleep / sleep / daily_readiness / personal_info ...
  day        TEXT    NOT NULL,   -- 归属日期；personal_info 这类无日期的存 'meta'
  id         TEXT    NOT NULL,   -- Oura 记录 id（sleep 一天可能多条：long_sleep + nap）
  payload    TEXT    NOT NULL,   -- 原始 JSON
  fetched_at INTEGER NOT NULL,   -- 拉取时间戳（毫秒）
  PRIMARY KEY (endpoint, id)
);

CREATE INDEX IF NOT EXISTS idx_oura_raw_day ON oura_raw (endpoint, day);

-- 记录「哪些日期已经完整同步过」。
-- 没有这张表的话，某天没戴戒指（库里本来就没有该天的行）会被永远判定为「缺失」，
-- 于是每天重复回源拉一个空日期。rows = 0 也要落一行，表示「查过了，确实没有」。
CREATE TABLE IF NOT EXISTS sync_day (
  day        TEXT PRIMARY KEY,
  rows       INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);
