import { describe, it, expect } from "vitest";
import { morphologyAlerts } from "../src/core/alerts";
import { Report } from "../src/core/types";

describe("Clinical Morphology Alerts Logic", () => {
  const baseMorphology: NonNullable<Report["morphology"]> = {
    template_beats: 10,
    p_amp_mv: 0.1,
    p_polarity: "直立",
    p_measurable: true,
    pr_ms: 160,
    qrs_ms: 85,
    r_amp_mv: 1.0,
    s_amp_mv: -0.2,
    st_j_mv: 0.0,
    st_j60_mv: 0.0,
    t_amp_mv: 0.25,
    t_polarity: "直立",
    qt_ms: 380,
    qtc_bazett_ms: 410,
    qtc_fridericia_ms: 400,
    qt_beat_iqr_ms: [375, 385],
    qt_reliable: true,
    amplitude_is_lower_bound: false,
  };

  it("handles null morphology gracefully", () => {
    const res = morphologyAlerts(null, 70);
    expect(res.alerts).toHaveLength(0);
    expect(res.skipped).toContain("没有可用的平均心搏，未做形态提醒");
  });

  it("validates sex and placement input types", () => {
    // @ts-expect-error invalid sex
    expect(() => morphologyAlerts(baseMorphology, 70, "other")).toThrow(/sex/);
    // @ts-expect-error invalid placement
    expect(() => morphologyAlerts(baseMorphology, 70, "male", "chest")).toThrow(/placement/);
  });

  describe("QTc evaluation rules", () => {
    it("uses Bazett for HR <= 100 and Fridericia for HR > 100", () => {
      const mo = {
        ...baseMorphology,
        qtc_bazett_ms: 510,
        qtc_fridericia_ms: 440,
      };

      // At HR 75: Bazett is 510 -> QTC_LONG_MARKED
      const resLow = morphologyAlerts(mo, 75);
      expect(resLow.alerts.some((a) => a.code === "QTC_LONG_MARKED")).toBe(true);

      // At HR 105: Fridericia is 440 -> Normal (<450)
      const resHigh = morphologyAlerts(mo, 105);
      expect(resHigh.alerts.some((a) => a.code.startsWith("QTC"))).toBe(false);
    });

    it("triggers QTC_LONG based on gender threshold", () => {
      const mo = {
        ...baseMorphology,
        qtc_bazett_ms: 455,
      };

      // Male threshold is 450 -> alert
      const resMale = morphologyAlerts(mo, 70, "male");
      expect(resMale.alerts.some((a) => a.code === "QTC_LONG")).toBe(true);

      // Female threshold is 460 -> normal
      const resFemale = morphologyAlerts(mo, 70, "female");
      expect(resFemale.alerts.some((a) => a.code === "QTC_LONG")).toBe(false);

      // Unknown sex defaults to male threshold 450 -> alert
      const resUnknown = morphologyAlerts(mo, 70, "unknown");
      expect(resUnknown.alerts.some((a) => a.code === "QTC_LONG")).toBe(true);
    });

    it("triggers QTC_SHORT and QTC_SHORT_MARKED", () => {
      const moShort = { ...baseMorphology, qtc_bazett_ms: 350 };
      const resShort = morphologyAlerts(moShort, 70);
      expect(resShort.alerts.some((a) => a.code === "QTC_SHORT")).toBe(true);

      const moMarked = { ...baseMorphology, qtc_bazett_ms: 320 };
      const resMarked = morphologyAlerts(moMarked, 70);
      expect(resMarked.alerts.some((a) => a.code === "QTC_SHORT_MARKED")).toBe(true);
    });

    it("skips QT when T wave is flat or unreliable", () => {
      const moNull = { ...baseMorphology, qtc_bazett_ms: null };
      expect(morphologyAlerts(moNull, 70).skipped.some((s) => s.includes("T 波终点未能测出"))).toBe(true);

      const moFlatT = { ...baseMorphology, t_amp_mv: 0.05 };
      expect(morphologyAlerts(moFlatT, 70).skipped.some((s) => s.includes("T 波太低"))).toBe(true);

      const moHighIqr = { ...baseMorphology, qt_beat_iqr_ms: [350, 400] as [number, number] };
      expect(morphologyAlerts(moHighIqr, 70).skipped.some((s) => s.includes("逐拍 QT 波动太大"))).toBe(true);
    });
  });

  describe("QRS and PR evaluation rules", () => {
    it("flags QRS_WIDE when QRS >= 120 ms", () => {
      const mo = { ...baseMorphology, qrs_ms: 125 };
      const res = morphologyAlerts(mo, 70);
      expect(res.alerts.some((a) => a.code === "QRS_WIDE")).toBe(true);
    });

    it("flags PR_LONG and PR_SHORT", () => {
      const moLong = { ...baseMorphology, pr_ms: 220 };
      expect(morphologyAlerts(moLong, 70).alerts.some((a) => a.code === "PR_LONG")).toBe(true);

      const moShort = { ...baseMorphology, pr_ms: 110 };
      expect(morphologyAlerts(moShort, 70).alerts.some((a) => a.code === "PR_SHORT")).toBe(true);
    });

    it("skips PR when P wave is not measurable or HR > 110", () => {
      const moNoP = { ...baseMorphology, p_measurable: false, pr_ms: null };
      expect(morphologyAlerts(moNoP, 70).skipped.some((s) => s.includes("P 波不可测"))).toBe(true);

      const moTachy = { ...baseMorphology, pr_ms: 220 };
      expect(morphologyAlerts(moTachy, 115).skipped.some((s) => s.includes("P 波常与上一拍的 T 波重叠"))).toBe(true);
    });
  });

  describe("ST segment and T wave evaluation rules", () => {
    it("skips ST and T evaluation when placement is not wrist", () => {
      const mo = { ...baseMorphology, st_j_mv: 0.2 };
      const res = morphologyAlerts(mo, 70, "male", "other");
      expect(res.skipped.some((s) => s.includes("记录时手表不在手腕上"))).toBe(true);
      expect(res.alerts.some((a) => a.code === "ST_ELEVATION")).toBe(false);
    });

    it("skips ST and T evaluation when QRS is wide (secondary changes)", () => {
      const mo = { ...baseMorphology, qrs_ms: 130, st_j_mv: 0.2 };
      const res = morphologyAlerts(mo, 70);
      expect(res.alerts.some((a) => a.code === "QRS_WIDE")).toBe(true);
      expect(res.skipped.some((s) => s.includes("QRS 增宽时 ST 段和 T 波的改变多为继发性"))).toBe(true);
      expect(res.alerts.some((a) => a.code === "ST_ELEVATION")).toBe(false);
    });

    it("detects ST_ELEVATION", () => {
      const mo = { ...baseMorphology, st_j_mv: 0.12 };
      const res = morphologyAlerts(mo, 70);
      expect(res.alerts.some((a) => a.code === "ST_ELEVATION")).toBe(true);
    });

    it("detects ST_DEPRESSION only if both J and J+60 are <= -0.1 mV", () => {
      // Both depressed -> alert
      const moDep = { ...baseMorphology, st_j_mv: -0.12, st_j60_mv: -0.11 };
      expect(morphologyAlerts(moDep, 70).alerts.some((a) => a.code === "ST_DEPRESSION")).toBe(true);

      // J depressed but J+60 recovered (upsloping) -> no alert
      const moUpsloping = { ...baseMorphology, st_j_mv: -0.12, st_j60_mv: -0.04 };
      expect(morphologyAlerts(moUpsloping, 70).alerts.some((a) => a.code === "ST_DEPRESSION")).toBe(false);
    });

    it("detects T_INVERSION when T is inverted and QRS net dominant upright", () => {
      const moInv = {
        ...baseMorphology,
        t_polarity: "倒置" as const,
        t_amp_mv: -0.18,
        r_amp_mv: 1.2,
        s_amp_mv: -0.3,
      };
      expect(morphologyAlerts(moInv, 70).alerts.some((a) => a.code === "T_INVERSION")).toBe(true);

      // If QRS is primarily negative (R <= |S|), inverted T is concordant (no T_INVERSION alert)
      const moNegativeQrs = {
        ...moInv,
        r_amp_mv: 0.2,
        s_amp_mv: -0.9,
      };
      expect(morphologyAlerts(moNegativeQrs, 70).alerts.some((a) => a.code === "T_INVERSION")).toBe(false);
    });

    it("appends low-confidence tail when template beats < 3", () => {
      const moFew = { ...baseMorphology, template_beats: 2, st_j_mv: 0.15 };
      const res = morphologyAlerts(moFew, 70);
      const alert = res.alerts.find((a) => a.code === "ST_ELEVATION");
      expect(alert?.text).toContain("平均心搏只有 2 拍，可信度低");
    });
  });
});
