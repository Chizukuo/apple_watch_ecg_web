/**
 * Clinical morphology alerts and guidelines logic
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  AlertItem,
  MIN_TEMPLATE_BEATS,
  Placement,
  PLACEMENTS,
  PR_LONG_MS,
  PR_MAX_HR,
  PR_SHORT_MS,
  QRS_WIDE_MS,
  QT_MAX_IQR_MS,
  QT_MIN_T_MV,
  QTC_FRIDERICIA_ABOVE_HR,
  QTC_LONG,
  QTC_LONG_MARKED,
  QTC_SHORT,
  QTC_SHORT_MARKED,
  Report,
  Sex,
  SEXES,
  SKIP_QT,
  ST_DEV_MV,
  T_INV_MIN_MV,
} from "./types";

export interface MorphologyAlertsResult {
  alerts: AlertItem[];
  skipped: string[];
}

/**
 * Generate clinical morphology alerts based on average beat measurements
 */
export function morphologyAlerts(
  mo: Report["morphology"],
  hr: number,
  sex: Sex = "unknown",
  placement: Placement = "wrist"
): MorphologyAlertsResult {
  const alerts: AlertItem[] = [];
  const skipped: string[] = [];

  if (!mo) {
    return { alerts, skipped: ["没有可用的平均心搏，未做形态提醒"] };
  }

  if (!SEXES.includes(sex)) {
    throw new Error(`sex 只能是 ${SEXES.join(", ")}`);
  }
  if (!PLACEMENTS.includes(placement)) {
    throw new Error(`placement 只能是 ${PLACEMENTS.join(", ")}`);
  }

  const few = mo.template_beats < MIN_TEMPLATE_BEATS;
  const tail = few ? `（平均心搏只有 ${mo.template_beats} 拍，可信度低）` : "";

  function add(code: string, level: "关注" | "建议就医", value: number, text: string) {
    alerts.push({ code, level, value, text: text + tail });
  }

  // 1. QTc alerts
  const useFridericia = hr > QTC_FRIDERICIA_ABOVE_HR;
  const qtc = useFridericia ? mo.qtc_fridericia_ms : mo.qtc_bazett_ms;
  const formula = useFridericia ? "Fridericia" : "Bazett";
  const iqr = mo.qt_beat_iqr_ms;
  const tAmp = mo.t_amp_mv;

  if (qtc === null || qtc === undefined) {
    skipped.push("T 波终点未能测出，" + SKIP_QT);
  } else if (tAmp === null || tAmp === undefined || Math.abs(tAmp) < QT_MIN_T_MV) {
    skipped.push(`T 波太低（${tAmp ?? "None"} mV < ${QT_MIN_T_MV}），T 终点不可靠，${SKIP_QT}`);
  } else if (iqr && iqr[1] - iqr[0] > QT_MAX_IQR_MS) {
    skipped.push(`逐拍 QT 波动太大（四分位距 ${(iqr[1] - iqr[0]).toFixed(0)} ms），${SKIP_QT}`);
  } else {
    const lim = QTC_LONG[sex];
    const who = { male: "男性", female: "女性", unknown: "性别未指定，按男性" }[sex];

    if (qtc >= QTC_LONG_MARKED) {
      add(
        "QTC_LONG_MARKED",
        "建议就医",
        qtc,
        `QTc 明显延长：${qtc.toFixed(0)} ms（${formula}，≥${QTC_LONG_MARKED}）。` +
          "QTc ≥500 ms 与恶性室性心律失常风险显著相关；手表测得的 QT 通常还比 12 导联短。" +
          "请尽快做 12 导联心电图，并带上正在服用的药物清单（不少药物会延长 QT）"
      );
    } else if (qtc >= lim) {
      add(
        "QTC_LONG",
        "关注",
        qtc,
        `QTc 偏长：${qtc.toFixed(0)} ms（${formula}，${who}阈值 ${lim}）。` +
          "单导联测量有误差；若反复出现，或有晕厥、心悸、家族猝死史，或在服用可能延长 QT 的药物，请做 12 导联心电图"
      );
    } else if (qtc <= QTC_SHORT_MARKED) {
      add(
        "QTC_SHORT_MARKED",
        "建议就医",
        qtc,
        `QTc 明显偏短：${qtc.toFixed(0)} ms（${formula}，≤${QTC_SHORT_MARKED}）。` +
          "手表的 QT 常比 12 导联短 10–25 ms，且 T 波终点在单导联上容易判早；请用 12 导联心电图确认"
      );
    } else if (qtc <= QTC_SHORT) {
      add(
        "QTC_SHORT",
        "关注",
        qtc,
        `QTc 偏短：${qtc.toFixed(0)} ms（${formula}，≤${QTC_SHORT}）。` +
          "手表的 QT 常比 12 导联短 10–25 ms，这个值本身不足以说明问题；" +
          "若有不明原因晕厥、心悸或家族猝死史，请做 12 导联心电图确认"
      );
    }
  }

  // 2. QRS width alert
  if (mo.qrs_ms !== null && mo.qrs_ms >= QRS_WIDE_MS) {
    add(
      "QRS_WIDE",
      "关注",
      mo.qrs_ms,
      `QRS 增宽：${mo.qrs_ms.toFixed(0)} ms（≥${QRS_WIDE_MS}）。可能是束支传导阻滞或室内传导延迟，` +
        "也可能是单导联上测量的误差；以前没有发现过的话，请做 12 导联心电图"
    );
  }

  // 3. PR interval alert
  if (!mo.p_measurable || mo.pr_ms === null) {
    skipped.push("P 波不可测，未做 PR 提醒");
  } else if (hr > PR_MAX_HR) {
    skipped.push(`心率 ${hr.toFixed(0)} > ${PR_MAX_HR}：P 波常与上一拍的 T 波重叠，PR 不可靠，未做 PR 提醒`);
  } else if (mo.pr_ms > PR_LONG_MS) {
    add(
      "PR_LONG",
      "关注",
      mo.pr_ms,
      `PR 间期延长：${mo.pr_ms.toFixed(0)} ms（>${PR_LONG_MS}）。可能是一度房室传导阻滞（运动员和年轻人中较常见，` +
        "多数无害），也可能是 P 波起点判早；请在 12 导联心电图上确认"
    );
  } else if (mo.pr_ms < PR_SHORT_MS) {
    add(
      "PR_SHORT",
      "关注",
      mo.pr_ms,
      `PR 间期偏短：${mo.pr_ms.toFixed(0)} ms（<${PR_SHORT_MS}）。可能是正常变异，也可能是预激（如 WPW）；` +
        "有阵发性心动过速的话，请做 12 导联心电图"
    );
  }

  // 4. ST & T alerts (only for wrist placement)
  if (placement !== "wrist") {
    skipped.push("记录时手表不在手腕上（非标准导联），未做 ST 和 T 波提醒");
  } else if (alerts.some((a) => a.code === "QRS_WIDE")) {
    skipped.push("QRS 增宽时 ST 段和 T 波的改变多为继发性，未单独做 ST 和 T 波提醒");
  } else {
    const stJ = mo.st_j_mv;
    const st60 = mo.st_j60_mv;

    if (stJ !== null && stJ >= ST_DEV_MV) {
      add(
        "ST_ELEVATION",
        "关注",
        stJ,
        `ST 段抬高：J 点 +${stJ.toFixed(2)} mV（≥${ST_DEV_MV}）。单导联不能诊断；` +
          "若伴胸痛、胸闷、出冷汗，请立即就医；无症状时也可能是早复极等正常变异"
      );
    } else if (stJ !== null && st60 !== null && stJ <= -ST_DEV_MV && st60 <= -ST_DEV_MV) {
      add(
        "ST_DEPRESSION",
        "关注",
        stJ,
        `ST 段压低：J 点 ${stJ.toFixed(2)} mV、J 点后 60 ms ${st60.toFixed(2)} mV（均 ≤-${ST_DEV_MV}，呈水平或下斜型）。` +
          "单导联不能诊断；宽而缓的 S 波（如右束支阻滞）的末段也可能被算作 ST 段。若伴胸痛、胸闷，请立即就医"
      );
    }

    if (
      mo.t_polarity === "倒置" &&
      tAmp !== null &&
      Math.abs(tAmp) >= T_INV_MIN_MV &&
      mo.r_amp_mv !== null &&
      mo.s_amp_mv !== null &&
      mo.r_amp_mv > Math.abs(mo.s_amp_mv)
    ) {
      add(
        "T_INVERSION",
        "关注",
        tAmp,
        `T 波倒置：${tAmp.toFixed(2)} mV，而 QRS 主波向上。导联 I 中 T 波通常直立；请在 12 导联心电图上确认`
      );
    }
  }

  return { alerts, skipped };
}
