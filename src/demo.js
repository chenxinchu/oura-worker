// 演示数据：不连 Oura，用于本地预览邮件版式
// 用固定种子的伪随机，保证每次预览结果一致

import { addDays } from './report.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoRaw(days = 7, reportDay) {
  const rnd = mulberry32(20261026);
  const ri = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;

  const daily_sleep = [];
  const daily_readiness = [];
  const daily_activity = [];
  const sleep = [];
  const daily_stress = [];
  const daily_resilience = [];
  const daily_spo2 = [];
  const daily_cardiovascular_age = [];
  const vo2_max = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(reportDay, -i);
    const isLast = i === 0;

    daily_sleep.push({
      day,
      score: isLast ? 74 : ri(66, 92),
      contributors: { deep_sleep: 78, efficiency: 88, latency: 92, rem_sleep: 81, restfulness: 70, timing: 86, total_sleep: 84 },
    });

    daily_readiness.push({
      day,
      score: isLast ? 79 : ri(62, 91),
      temperature_deviation: Number((rnd() * 0.5 - 0.15).toFixed(1)),
      temperature_trend_deviation: 0.1,
      contributors: {
        activity_balance: ri(60, 92), body_temperature: ri(70, 95), hrv_balance: ri(58, 90),
        previous_day_activity: ri(62, 94), previous_night: ri(65, 92), recovery_index: ri(60, 93),
        resting_heart_rate: ri(64, 96), sleep_balance: ri(66, 92),
      },
    });

    daily_activity.push({
      day,
      score: isLast ? 82 : ri(58, 95),
      steps: isLast ? 9862 : ri(4200, 13400),
      active_calories: isLast ? 416 : ri(240, 720),
      total_calories: isLast ? 2194 : ri(1850, 2480),
      sedentary_time: ri(5, 9) * 3600,
      resting_time: ri(4, 7) * 3600,
      target_calories: 500,
    });

    daily_stress.push({
      day,
      stress_high: ri(1800, 7200),
      recovery_high: ri(7200, 18000),
      day_summary: isLast ? 'normal' : ['restored', 'normal', 'stressful'][ri(0, 2)],
    });

    daily_resilience.push({ day, level: ['solid', 'adequate', 'strong'][ri(0, 2)] });

    daily_spo2.push({
      day,
      spo2_percentage: { average: Number((95.4 + rnd() * 2.8).toFixed(1)) },
      breathing_disturbance_index: ri(1, 6),
    });

    daily_cardiovascular_age.push({ day, vascular_age: isLast ? 31 : ri(29, 34) });
    vo2_max.push({ day, vo2_max: Number((42 + rnd() * 4).toFixed(1)) });

    sleep.push({
      day,
      type: 'long_sleep',
      bedtime_start: `${addDays(day, -1)}T23:41:00+08:00`,
      bedtime_end: `${day}T07:12:00+08:00`,
      total_sleep_duration: isLast ? 24780 : ri(19800, 27600),
      time_in_bed: 27060,
      deep_sleep_duration: isLast ? 4680 : ri(3200, 6400),
      rem_sleep_duration: isLast ? 6120 : ri(4200, 7800),
      light_sleep_duration: isLast ? 13980 : ri(11000, 16000),
      awake_time: isLast ? 2280 : ri(900, 3200),
      efficiency: isLast ? 91 : ri(82, 96),
      latency: isLast ? 780 : ri(300, 1800),
      average_hrv: isLast ? 46 : ri(32, 68),
      average_heart_rate: isLast ? 54 : ri(48, 62),
      lowest_heart_rate: isLast ? 47 : ri(42, 56),
      average_breath: 13.8,
      restless_periods: 9,
    });
  }

  return {
    personal_info: { age: 33, biological_sex: 'male', weight: 70, height: 175 },
    daily_sleep,
    daily_readiness,
    daily_activity,
    sleep,
    daily_stress,
    daily_resilience,
    daily_spo2,
    daily_cardiovascular_age,
    vo2_max,
  };
}
