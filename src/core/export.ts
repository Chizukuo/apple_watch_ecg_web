/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { ALERT_NAMES, AnalysisOutput, Recording, Report } from "./types";
export function summaryRow(rep: Report, sourceFile?: string) {
  const w = rep.watch,
    rh = rep.rhythm,
    mo = rep.morphology,
    hv = rep.hrv;
  const hour = w.recorded_at ? Number(w.recorded_at.slice(11, 13)) : null;
  return {
    记录: rep.record_id,
    记录时间: w.recorded_at,
    时段: hour == null ? null : hour < 6 ? "夜间" : hour < 18 ? "白天" : "晚上",
    记录时年龄: w.age_at_recording,
    手表结论: w.classification,
    手表心率: w.reported_bpm,
    症状: w.symptoms,
    计算心率: rh.hr_bpm,
    心搏: rh.beats,
    提前_同形: rh.n_premature_same,
    提前_异形: rh.n_premature_diff,
    形态异常: rh.n_odd,
    长间歇: rh.pauses.length,
    长短交替: rh.rr_alternation_start_s.length > 0,
    QRS_ms: mo?.qrs_ms ?? null,
    PR_ms: mo?.pr_ms ?? null,
    QT_ms: mo?.qt_ms ?? null,
    QTcB_ms: mo?.qtc_bazett_ms ?? null,
    QTcF_ms: mo?.qtc_fridericia_ms ?? null,
    QT可靠: mo?.qt_reliable ?? null,
    P_mV: mo?.p_amp_mv ?? null,
    R_mV: mo?.r_amp_mv ?? null,
    S_mV: mo?.s_amp_mv ?? null,
    T_mV: mo?.t_amp_mv ?? null,
    RMSSD_ms: hv.rmssd_ms,
    SDNN_ms: hv.sdnn_ms,
    NN数: hv.n_nn,
    截断: rep.quality.clipped,
    形态提醒: rep.morphology_alerts.alerts
      .map((a) => ALERT_NAMES[a.code])
      .join("、"),
    提示数: rep.flags.length,
    ...(sourceFile ? { 源文件: sourceFile } : {}),
  };
}
export function signalCsv(rec: Recording, result: AnalysisOutput): string {
  const labels = new Map(result.pos.map((p, k) => [p, result.labels[k]]));
  const lines = ["\ufefftime_s,voltage_mv,clipped,beat"];
  for (let i = 0; i < rec.t.length; i++)
    lines.push(
      `${rec.t[i].toFixed(5)},${rec.v[i].toFixed(5)},${rec.clip[i]},${labels.get(i) ?? ""}`,
    );
  return lines.join("\r\n") + "\r\n";
}
