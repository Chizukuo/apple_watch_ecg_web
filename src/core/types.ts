/**
 * Data structures and constants for Apple Watch ECG analysis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const DEFAULT_FS = 512;
export const PT_PER_MM = 72.0 / 25.4;
export const STRIP_SECONDS = 10.0;

// Rhythm determination thresholds
export const PREMATURE_RATIO = 0.80;
export const ABRUPT_RATIO = 0.88;
export const PAUSE_RATIO = 1.70;
export const SAME_QRS_CORR = 0.85;
export const ODD_QRS_CORR = 0.70;
export const WIDE_QRS_DELTA_MS = 40;
export const TEMPLATE_CORR = 0.90;
export const ALT_MIN_DELTA_MS = 80;
export const T_GUARD_MAX_S = 0.42;
export const T_GUARD_SLOPE = 0.33;
export const ARTIFACT_MV = 0.5;

// Chinese label strings
export const LABEL_NORMAL = "正常";
export const LABEL_PREM_SAME = "提前·QRS同形";
export const LABEL_PREM_DIFF = "提前·QRS异形";
export const LABEL_ODD = "形态异常";
export const LABEL_REMOVED = "排除段内";

// Morphology & Clinical alert thresholds
export const WATCH_RANGES_V2: Record<string, [number, number]> = {
  sinus: [50, 99],
  high_hr: [100, 150],
  afib: [50, 99],
  afib_high: [100, 150],
};
export const APPLE_MIN_AGE = 22;

export const QTC_LONG: Record<string, number> = {
  male: 450,
  female: 460,
  unknown: 450,
};
export const QTC_LONG_MARKED = 500;
export const QTC_SHORT = 360;
export const QTC_SHORT_MARKED = 340;
export const QTC_FRIDERICIA_ABOVE_HR = 100;
export const QT_MIN_T_MV = 0.08;
export const QT_MAX_IQR_MS = 40;
export const QRS_WIDE_MS = 120;
export const PR_LONG_MS = 200;
export const PR_SHORT_MS = 120;
export const ST_DEV_MV = 0.10;
export const T_INV_MIN_MV = 0.10;
export const MIN_TEMPLATE_BEATS = 5;
export const PR_MAX_HR = 100;

export const SEXES = ["male", "female", "unknown"] as const;
export type Sex = typeof SEXES[number];

export const PLACEMENTS = ["wrist", "other"] as const;
export type Placement = typeof PLACEMENTS[number];

export const SKIP_QT = "未做 QTc 提醒";

export const ALERT_NAMES: Record<string, string> = {
  QTC_LONG_MARKED: "QTc明显延长",
  QTC_LONG: "QTc偏长",
  QTC_SHORT_MARKED: "QTc明显偏短",
  QTC_SHORT: "QTc偏短",
  QRS_WIDE: "QRS增宽",
  PR_LONG: "PR延长",
  PR_SHORT: "PR偏短",
  ST_ELEVATION: "ST抬高",
  ST_DEPRESSION: "ST压低",
  T_INVERSION: "T波倒置",
};

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}

export interface Row {
  index: number;
  t: Float64Array;
  v: Float64Array;
  clip: Uint8Array; // 1 = clipped, 0 = normal
}

export interface WatchInfo {
  recorded_at: string | null;
  age_at_recording: number | null;
  age_shown: number | null;
  classification: string | null;
  category: string;
  reported_bpm: number | null;
  summary_text: string | null;
  symptoms: string | null;
  paper_speed_mm_s: number;
  gain_mm_mv: number;
  sampling_rate_hz: number;
  lead_label: string | null;
  device_model: string | null;
  ios_version: string | null;
  watchos_version: string | null;
  algorithm_version: number | null;
  exported_at: string | null;
  ios_build: string | null;
}

export interface IdentityInfo {
  name: string | null;
  dob: string | null;
  source_file?: string;
}

export interface Recording {
  path?: string;
  watch: WatchInfo;
  identity: IdentityInfo;
  rows: Row[];
  source: "vector" | "raster";
  fs: number;
  record_id: string;
  t: Float64Array;
  v: Float64Array;
  clip: Uint8Array;
  notes: string[];
}

export interface PauseItem {
  start_s: number;
  end_s: number;
  rr_ms: number;
  ratio: number;
}

export interface BeatTableItem {
  time_s: number | null;
  label: string;
  source: string;
  rr_prev_ms: number | null;
  rr_next_ms: number | null;
  prematurity: number | null;
  compensation: number | null;
  corr_qrs: number | null;
  corr_qrst: number | null;
  qrs_ms: number | null;
}

export interface AlertItem {
  code: string;
  level: "关注" | "建议就医";
  value: number;
  text: string;
}

export interface MorphologyResult {
  tm: Float64Array;
  sm: Float64Array;
  base: number;
  on: number;
  J: number;
  R: number;
  S: number;
  Tpk: number | null;
  Tend: number | null;
  P: number | null;
  p_amp: number;
  p_pol: "直立" | "倒置" | null;
  p_ok: boolean;
  pr: number | null;
  qrs: number;
  r_amp: number;
  s_amp: number;
  st_j: number;
  st_j60: number;
  t_amp: number | null;
  t_pol: "直立" | "倒置" | null;
  qt: number | null;
  qts: Float64Array;
  noise: number;
  n: number;
  W: Float64Array[];
  beat_idx?: number[];
  pre?: number;
  corr_threshold?: number;
}

export interface Report {
  tool_version: string;
  record_id: string;
  source: string;
  watch: WatchInfo;
  rhythm: {
    beats: number;
    hr_bpm: number | null;
    hr_nn_bpm: number | null;
    reported_bpm: number | null;
    rr_ms_min: number | null;
    rr_ms_max: number | null;
    n_normal: number;
    n_premature_same: number;
    n_premature_diff: number;
    n_odd: number;
    n_removed: number;
    pauses: PauseItem[];
    compensatory_pauses: PauseItem[];
    bigeminy_start_s: number | null;
    rr_alternation_start_s: number[];
  };
  hrv: {
    n_nn: number;
    mean_nn_ms: number | null;
    sdnn_ms: number | null;
    rmssd_ms: number | null;
    pnn50_pct: number | null;
    sd1_ms: number | null;
    sd2_ms: number | null;
  };
  morphology: {
    template_beats: number;
    template_corr_threshold?: number;
    p_amp_mv: number | null;
    p_polarity: string | null;
    p_measurable: boolean;
    pr_ms: number | null;
    qrs_ms: number | null;
    r_amp_mv: number | null;
    s_amp_mv: number | null;
    amplitude_is_lower_bound: boolean;
    st_j_mv: number | null;
    st_j60_mv: number | null;
    t_amp_mv: number | null;
    t_polarity: string | null;
    qt_ms: number | null;
    qt_beat_iqr_ms: [number, number] | null;
    qtc_bazett_ms: number | null;
    qtc_fridericia_ms: number | null;
    qt_reliable?: boolean;
  } | null;
  quality: {
    noise_sd_mv: number | null;
    clipped: boolean;
    artifact_windows_s: [number, number][];
    manual_exclude_s: [number, number][];
  };
  flags: string[];
  notes: string[];
  beats: BeatTableItem[];
  morphology_alerts: {
    sex: string;
    placement: string;
    alerts: AlertItem[];
    skipped: string[];
  };
}

export interface AnalysisOutput {
  report: Report;
  times: Float64Array;
  pos: number[];
  labels: string[];
  removed: [number, number][];
  morph: MorphologyResult | null;
  nn: Float64Array;
  nn_pairs: [number, number][];
  pauses: PauseItem[];
}
