/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { Report } from "./types";

export type EvaluationStatus =
  "normal" | "attention" | "urgent" | "unavailable" | "unreliable";
export interface Evaluation {
  status: EvaluationStatus;
  value: number | null;
  formula?: "Bazett" | "Fridericia";
  reason: string;
}

/** Presentation consumes the actual alert decisions; it never reclassifies a measured value. */
export function assessment(report: Report) {
  const mo = report.morphology;
  const { alerts, skipped } = report.morphology_alerts;
  const field = (
    prefix: string,
    value: number | null,
    skip: string | undefined,
  ): Evaluation => {
    const matches = alerts.filter((a) => a.code.startsWith(prefix));
    return {
      value,
      status:
        !mo || value == null
          ? "unavailable"
          : skip
            ? "unreliable"
            : matches.some((a) => a.level === "建议就医")
              ? "urgent"
              : matches.length
                ? "attention"
                : "normal",
      reason: !mo
        ? "没有可用的平均心搏"
        : skip ||
          (value == null
            ? "未能测出"
            : matches.map((a) => a.text).join("；") || "已评估，未触发提醒"),
    };
  };
  const formula: "Bazett" | "Fridericia" =
    report.morphology_alerts.qtc_formula ??
    ((report.rhythm.hr_bpm ?? 0) > 100 ? "Fridericia" : "Bazett");
  const qtc = {
    ...field(
      "QTC",
      (formula === "Bazett" ? mo?.qtc_bazett_ms : mo?.qtc_fridericia_ms) ??
        null,
      skipped.find((s) => s.includes("未做 QTc 提醒")),
    ),
    formula,
  };
  const pr = field(
    "PR_",
    mo?.pr_ms ?? null,
    skipped.find((s) => s.includes("未做 PR 提醒")),
  );
  const qrs = field("QRS_", mo?.qrs_ms ?? null, undefined);
  const rh = report.rhythm;
  const premature = rh.n_premature_same + rh.n_premature_diff;
  const rhythmWarning =
    premature + rh.n_odd + rh.pauses.length + rh.rr_alternation_start_s.length >
    0;
  const status = alerts.some((a) => a.level === "建议就医")
    ? "urgent"
    : alerts.length || rhythmWarning
      ? "attention"
      : !mo
        ? "unavailable"
        : skipped.length ||
            report.quality.clipped ||
            report.quality.artifact_windows_s.length ||
            report.quality.manual_exclude_s.length
          ? "unreliable"
          : "normal";
  const title = {
    urgent: "有建议就医级提醒",
    attention: "检出节律或形态提示",
    unavailable: "形态未评估",
    unreliable: "部分项目未评估或可信度受限",
    normal: "已评估项目未触发异常提示",
  }[status];
  return { qtc, pr, qrs, premature, status, title, skipped };
}
