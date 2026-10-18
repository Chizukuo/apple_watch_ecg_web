/**
 * Clinical ECG Analysis Pipeline
 * Ported from analyze() in apple_watch_ecg.py with full mathematical parity
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  AnalysisError,
  AnalysisOutput,
  APPLE_MIN_AGE,
  BeatTableItem,
  LABEL_NORMAL,
  LABEL_ODD,
  LABEL_PREM_DIFF,
  LABEL_PREM_SAME,
  LABEL_REMOVED,
  PauseItem,
  Placement,
  Recording,
  Report,
  SAME_QRS_CORR,
  ODD_QRS_CORR,
  PREMATURE_RATIO,
  ABRUPT_RATIO,
  PAUSE_RATIO,
  WIDE_QRS_DELTA_MS,
  TEMPLATE_CORR,
  ALT_MIN_DELTA_MS,
  Sex,
  WATCH_RANGES_V2,
  WatchInfo,
  AlertItem,
} from "./types";
import { mean, median, percentile, std, var_ } from "./dsp";
import { detectArtifactWindows, estimateBaseline } from "./baseline";
import { detectBeats, inAny } from "./detector";
import { beatMorphology, measureTemplate } from "./morphology";
import { morphologyAlerts } from "./alerts";

/**
 * Checks if interval [a0, a1] overlaps with any interval in intervals.
 */
function overlaps(a0: number, a1: number, intervals: [number, number][]): boolean {
  for (let i = 0; i < intervals.length; i++) {
    const [b0, b1] = intervals[i];
    if (!(b1 < a0 || b0 > a1)) return true;
  }
  return false;
}

/**
 * Clean rounding helper matching Python's r1()
 */
function r1(x: number | null | undefined, n = 1): number | null {
  if (x === null || x === undefined || isNaN(x)) return null;
  const factor = Math.pow(10, n);
  return Math.round(x * factor) / factor;
}

/**
 * Beat classification state machine.
 * Classifies each beat as NORMAL, PREMATURE_SAME, PREMATURE_DIFF, ODD, or REMOVED.
 */
function classifyBeats(
  nb: number,
  remFlags: boolean[],
  usable: boolean[],
  rr: Float64Array,
  cq: (number | null)[],
  widths: (number | null)[],
  width_t: number,
  refFor: (skip: Set<number>, center: number) => number
) {
  const labels: string[] = [];
  const premRatio: (number | null)[] = [];
  const compRatio: (number | null)[] = [];

  for (let k = 0; k < nb; k++) {
    if (remFlags[k]) {
      labels.push(LABEL_REMOVED);
      premRatio.push(null);
      compRatio.push(null);
      continue;
    }

    let pr_: number | null = null;
    let cp_: number | null = null;

    if (k >= 1 && usable[k - 1]) {
      const ref = refFor(new Set([k - 1, k]), k - 1);
      pr_ = rr[k - 1] / ref;
      if (k < nb - 1 && usable[k]) {
        cp_ = (rr[k - 1] + rr[k]) / (2 * ref);
      }
    }

    const isWide = widths[k] !== null && widths[k]! - width_t >= WIDE_QRS_DELTA_MS;
    const c = cq[k] !== null ? cq[k]! : 1.0;

    let abrupt = true;
    if (
      k >= 2 &&
      usable[k - 2] &&
      labels[k - 1] !== LABEL_PREM_SAME &&
      labels[k - 1] !== LABEL_PREM_DIFF
    ) {
      abrupt = rr[k - 1] < ABRUPT_RATIO * rr[k - 2];
    }

    if (pr_ !== null && pr_ < PREMATURE_RATIO && abrupt) {
      labels.push(c < SAME_QRS_CORR || isWide ? LABEL_PREM_DIFF : LABEL_PREM_SAME);
    } else if (c < ODD_QRS_CORR || isWide) {
      labels.push(LABEL_ODD);
    } else {
      labels.push(LABEL_NORMAL);
    }

    premRatio.push(pr_);
    compRatio.push(cp_);
  }

  const premK: number[] = [];
  for (let k = 0; k < labels.length; k++) {
    if (labels[k] === LABEL_PREM_SAME || labels[k] === LABEL_PREM_DIFF) {
      premK.push(k);
    }
  }

  const same = premK.filter((k) => labels[k] === LABEL_PREM_SAME);
  const diff = premK.filter((k) => labels[k] === LABEL_PREM_DIFF);
  const odd = labels.map((l, idx) => (l === LABEL_ODD ? idx : -1)).filter((idx) => idx !== -1);

  return { labels, premRatio, compRatio, premK, same, diff, odd };
}

/**
 * Detects compensatory pauses and genuine sinus pauses (RR >= 1.70 * local ref).
 */
function detectPauses(
  nb: number,
  usable: boolean[],
  rr: Float64Array,
  times: Float64Array,
  labels: string[],
  refFor: (skip: Set<number>, center: number) => number
) {
  const pauses: PauseItem[] = [];
  const compPauses: PauseItem[] = [];

  for (let k = 0; k < nb - 1; k++) {
    if (!usable[k]) continue;
    const ratio = rr[k] / refFor(new Set([k]), k);
    if (ratio >= PAUSE_RATIO) {
      const item: PauseItem = {
        start_s: r1(times[k], 2)!,
        end_s: r1(times[k + 1], 2)!,
        rr_ms: Math.round(rr[k] * 1000),
        ratio: r1(ratio, 2)!,
      };
      if (labels[k] === LABEL_PREM_SAME || labels[k] === LABEL_PREM_DIFF) {
        compPauses.push(item);
      } else {
        pauses.push(item);
      }
    }
  }

  const pauseStarts = new Set(pauses.map((p) => p.start_s));
  return { pauses, compPauses, pauseStarts };
}

/**
 * Detects bigeminy sequences and RR long-short alternation runs.
 */
function detectRhythmPatterns(
  rr: Float64Array,
  usable: boolean[],
  times: Float64Array,
  premK: number[]
) {
  // 1. Long-short alternation
  const usK: number[] = [];
  for (let k = 0; k < rr.length; k++) {
    if (usable[k]) usK.push(k);
  }

  const altRuns: number[] = [];
  let run = 0;
  let runStart: number | null = null;
  for (let i = 0; i < usK.length - 2; i++) {
    const a = usK[i];
    const b = usK[i + 1];
    const c = usK[i + 2];
    if (b !== a + 1 || c !== b + 1) {
      run = 0;
      continue;
    }
    const d1 = (rr[b] - rr[a]) * 1000;
    const d2 = (rr[c] - rr[b]) * 1000;
    if (
      Math.sign(d1) === -Math.sign(d2) &&
      Math.abs(d1) > ALT_MIN_DELTA_MS &&
      Math.abs(d2) > ALT_MIN_DELTA_MS
    ) {
      if (run === 0) runStart = a;
      run++;
      if (run === 3 && runStart !== null) {
        altRuns.push(r1(times[runStart], 1)!);
      }
    } else {
      run = 0;
    }
  }

  // 2. Bigeminy
  let bigeminy: number | null = null;
  let runK: number[] = premK.length > 0 ? [premK[0]] : [];
  for (let i = 0; i < premK.length - 1; i++) {
    const a = premK[i];
    const b = premK[i + 1];
    runK = b - a === 2 ? [...runK, b] : [b];
    if (runK.length >= 3 && bigeminy === null) {
      bigeminy = r1(times[runK[0]], 1);
    }
  }

  return { altRuns, bigeminy };
}

/**
 * Computes HRV metrics on NN intervals and successive differences for Poincaré analysis.
 */
function computeHrvMetrics(
  nb: number,
  usable: boolean[],
  labels: string[],
  rr: Float64Array,
  times: Float64Array,
  pauseStarts: Set<number>,
  usableRrs: Float64Array
) {
  const nnIdx: number[] = [];
  for (let k = 0; k < nb - 1; k++) {
    if (
      usable[k] &&
      labels[k] === LABEL_NORMAL &&
      labels[k + 1] === LABEL_NORMAL &&
      rr[k] > 0.3 &&
      rr[k] < 2.0 &&
      !pauseStarts.has(r1(times[k], 2)!)
    ) {
      nnIdx.push(k);
    }
  }

  const nn = new Float64Array(nnIdx.length);
  for (let i = 0; i < nnIdx.length; i++) {
    nn[i] = rr[nnIdx[i]] * 1000;
  }

  const consecPairs: [number, number][] = [];
  for (let j = 0; j < nnIdx.length - 1; j++) {
    if (nnIdx[j + 1] === nnIdx[j] + 1) {
      consecPairs.push([nn[j], nn[j + 1]]);
    }
  }

  const succ = new Float64Array(consecPairs.length);
  for (let i = 0; i < consecPairs.length; i++) {
    succ[i] = consecPairs[i][1] - consecPairs[i][0];
  }

  const hr = 60.0 / mean(usableRrs);
  const hrNn = nn.length > 0 ? 60.0 / (mean(nn) / 1000) : null;
  const sdnn = nn.length > 2 ? std(nn, 1) : null;

  let succSqSum = 0;
  let pnn50Count = 0;
  for (let i = 0; i < succ.length; i++) {
    succSqSum += succ[i] * succ[i];
    if (Math.abs(succ[i]) > 50) pnn50Count++;
  }

  const rmssd = succ.length > 0 ? Math.sqrt(succSqSum / succ.length) : null;
  const pnn50 = succ.length > 0 ? (pnn50Count / succ.length) * 100 : null;
  const sd1 = succ.length > 2 ? Math.sqrt(0.5 * var_(succ, 1)) : null;
  const sd2 =
    succ.length > 2 && sdnn !== null
      ? Math.sqrt(Math.max(2 * sdnn * sdnn - 0.5 * var_(succ, 1), 0))
      : null;

  return { nn, consecPairs, hr, hrNn, sdnn, rmssd, pnn50, sd1, sd2 };
}

/**
 * Builds average beat template from normal beats satisfying correlation thresholds.
 */
function buildAverageTemplate(
  v: Float64Array,
  pos: number[],
  labels: string[],
  cqt: (number | null)[],
  rrMean: number,
  fs: number,
  clip: Uint8Array
) {
  const pre = Math.floor(Math.min(0.4, 0.75 * rrMean) * fs);
  const post = Math.floor(Math.min(0.6, 0.92 * rrMean) * fs);
  const nb = pos.length;

  let morph: ReturnType<typeof measureTemplate> | null = null;
  for (const thr of [TEMPLATE_CORR, 0.8]) {
    const tbIdx: number[] = [];
    for (let k = 0; k < nb; k++) {
      if (
        labels[k] === LABEL_NORMAL &&
        cqt[k] !== null &&
        cqt[k]! >= thr &&
        pos[k] - pre >= 0 &&
        pos[k] + post <= v.length &&
        (k + 1 >= nb || pos[k + 1] - pos[k] >= post)
      ) {
        tbIdx.push(k);
      }
    }

    if (tbIdx.length >= 3) {
      const W: Float64Array[] = tbIdx.map((k) =>
        new Float64Array(v.subarray(pos[k] - pre, pos[k] + post))
      );
      morph = measureTemplate(W, pre, rrMean, fs);
      morph.beat_idx = tbIdx;
      morph.pre = pre;
      morph.corr_threshold = thr;
      break;
    }
  }

  let clipped = false;
  if (morph && morph.beat_idx) {
    for (const k of morph.beat_idx) {
      const from = Math.max(0, pos[k] - pre);
      const to = Math.min(clip.length, pos[k] + post);
      for (let i = from; i < to; i++) {
        if (clip[i] === 1) {
          clipped = true;
          break;
        }
      }
      if (clipped) break;
    }
  }

  return { morph, clipped, rrMean };
}

/**
 * Compiles clinical warning flags, Apple Watch diagnosis comparison, and notes.
 */
function compileClinicalFlags(params: {
  diff: number[];
  same: number[];
  odd: number[];
  bigeminy: number | null;
  pauses: PauseItem[];
  altRuns: number[];
  removed: [number, number][];
  exclude: [number, number][];
  artifacts: [number, number][];
  clipped: boolean;
  morph: ReturnType<typeof measureTemplate> | null;
  hr: number;
  watch: WatchInfo;
  premK: number[];
  sortedAlerts: AlertItem[];
  placement: Placement;
  times: Float64Array;
}): string[] {
  const {
    diff, same, odd, bigeminy, pauses, altRuns, removed, exclude,
    artifacts, clipped, morph, hr, watch, premK, sortedAlerts,
    placement, times,
  } = params;

  const flags: string[] = [];
  const tList = (ks: number[]) => ks.map((k) => times[k].toFixed(1)).join("、") + " 秒";

  if (diff.length > 0) {
    flags.push(
      `${diff.length} 个提前搏动（QRS 异形）：${tList(diff)}。可能为室性早搏（或伴差异传导的房性早搏），请就医时提供原始 PDF`
    );
  }
  if (same.length > 0) {
    flags.push(
      `${same.length} 个提前搏动（QRS 同形）：${tList(same)}。可能为房性早搏，也可能是窦性心律不齐，单导联无法确定`
    );
  }
  if (bigeminy !== null) {
    flags.push(`提前搏动从约 ${bigeminy} 秒起规律地每隔一拍出现（二联律样）`);
  }
  if (pauses.length > 0) {
    flags.push(
      "长间歇：" +
        pauses
          .map((p) => `${p.start_s}–${p.end_s} 秒（${p.rr_ms} ms，约为参考间期的 ${p.ratio} 倍）`)
          .join("；")
    );
  }
  if (altRuns.length > 0) {
    flags.push(
      "RR 间期出现规律的长短交替（起点约 " +
        altRuns.map((x) => `${x} 秒`).join("、") +
        "）：可能是呼吸相关的窦性心律不齐，也可能是房性二联律，单导联无法区分；此时 RMSSD 与 Poincaré 图不能按常规 HRV 解读"
    );
  }
  if (odd.length > 0) {
    flags.push(
      `${odd.length} 个心搏出现时间正常但形态异常：${tList(odd)}。多为伪影或接触变化，也可能是异常搏动，请人工查看`
    );
  }
  if (removed.length > 0) {
    const kinds: string[] = [];
    if (exclude.length > 0) kinds.push("手动排除");
    if (artifacts.length > 0) kinds.push("自动识别的伪影");
    flags.push(
      `以下时段被排除（${kinds.join("、")}）：` +
        removed.map(([a, b]) => `${a.toFixed(1)}–${b.toFixed(1)} 秒`).join("，") +
        "。跨越这些时段的间隔不计入 RR/HRV，也不会被当作停顿"
    );
  }
  if (clipped) {
    flags.push("波形碰到网格边缘被截断：R/S 振幅只是下限");
  }
  if (!morph) {
    flags.push("形态一致的正常心搏少于 3 个，未测量平均心搏");
  } else if (!morph.p_ok) {
    flags.push("P 波低于可测阈值，PR 间期无法测量");
  }

  const repBpm = watch.reported_bpm;
  if (repBpm !== null && Math.abs(hr - repBpm) > 3) {
    flags.push(`计算心率 ${hr.toFixed(0)} 与手表报告 ${repBpm} 相差超过 3 次/分，请检查提取结果`);
  }

  const cat = watch.category;
  if (watch.algorithm_version === 2 && cat in WATCH_RANGES_V2) {
    const [lo, hi] = WATCH_RANGES_V2[cat];
    if (!(lo - 2 <= hr && hr <= hi + 2)) {
      flags.push(
        `手表分类“${watch.classification}”对应 ${lo}–${hi} 次/分，与计算心率 ${hr.toFixed(0)} 不一致，请检查提取结果`
      );
    }
  } else if (watch.algorithm_version !== null && watch.algorithm_version !== 2) {
    flags.push(`手表算法版本为 ${watch.algorithm_version}，未内置其分类规则，跳过分类一致性检查`);
  }

  if (cat === "afib" || cat === "afib_high") {
    flags.push("手表提示房颤：本工具不做房颤判断，请以手表结果和医生意见为准");
  }
  if (cat === "sinus" && (premK.length > 0 || pauses.length > 0)) {
    flags.push("手表判为窦性心律与上述提示并不矛盾：Apple 的算法只区分房颤与窦性心律，不识别早搏和停顿");
  }

  const age = watch.age_at_recording;
  if (age !== null && age < APPLE_MIN_AGE) {
    flags.push(
      `记录时 ${age} 岁：Apple 说明书注明心电图 App 不适用于 ${APPLE_MIN_AGE} 岁以下人群，手表分类仅供参考（波形仍可分析）`
    );
  }
  if (watch.symptoms) {
    flags.push(`记录时补录的症状：${watch.symptoms}`);
  }

  flags.push("HRV 来自约 30 秒的超短时记录，仅供同条件下自身对比");
  flags.push("PDF 一律标注“导联 I”；若手表不是贴在对侧手腕上记录，则不是标准导联 I");

  const fullFlags = [
    ...sortedAlerts.map((a) => `【${a.level}】${a.text}`),
    ...flags,
  ];

  if (placement !== "wrist") {
    fullFlags.push("已声明手表不在手腕上记录：波形方向和幅度与标准导联 I 不可比");
  }

  return fullFlags;
}

/**
 * Main Clinical Analysis Pipeline.
 * Orchestrates signal quality assessment, beat detection, morphology extraction,
 * HRV metrics, and clinical safety alerts.
 */
export function analyze(
  rec: Recording,
  exclude: [number, number][] = [],
  sex: Sex = "unknown",
  placement: Placement = "wrist"
): AnalysisOutput {
  const { fs, t, v } = rec;
  const baseline = estimateBaseline(v, fs);
  const artifacts = detectArtifactWindows(t, v, fs, baseline);
  const removed: [number, number][] = [...exclude, ...artifacts];

  const { beats: rawBeats, sources } = detectBeats(t, v, fs, removed);
  const remFlags = rawBeats.map((b) => inAny(t[b], removed));

  const { pos, cq, cqt, widths, width_t } = beatMorphology(v, rawBeats, fs, remFlags, baseline);
  const notes = [...rec.notes];

  // Head artifacts removal
  const beats = [...rawBeats];
  for (let k = pos.length - 1; k >= 0; k--) {
    if (t[pos[k]] - t[0] < 0.45 && cq[k] !== null && cq[k]! < 0.5) {
      notes.push(`记录开头 ${t[pos[k]].toFixed(2)} 秒处的不完整波形已忽略（多为记录开始前那一拍的 T 波）`);
      beats.splice(k, 1);
      remFlags.splice(k, 1);
      pos.splice(k, 1);
      cq.splice(k, 1);
      cqt.splice(k, 1);
      widths.splice(k, 1);
    }
  }

  const nb = pos.length;
  if (nb < 5) {
    throw new AnalysisError("可用心搏少于 5 个，无法分析");
  }

  const times = new Float64Array(nb);
  for (let i = 0; i < nb; i++) times[i] = t[pos[i]];

  const rr = new Float64Array(nb - 1);
  for (let i = 0; i < nb - 1; i++) rr[i] = times[i + 1] - times[i];

  const usable = new Array(nb - 1).fill(false);
  for (let k = 0; k < nb - 1; k++) {
    usable[k] =
      !remFlags[k] &&
      !remFlags[k + 1] &&
      !overlaps(times[k], times[k + 1], removed) &&
      rr[k] > 0.25;
  }

  const usableCount = usable.filter(Boolean).length;
  if (usableCount < 3) {
    throw new AnalysisError("可用的 RR 间期少于 3 个（伪影或排除段太多）");
  }

  const usableRrs = rr.filter((_, idx) => usable[idx]);
  const globMed = median(usableRrs);

  function refFor(skip: Set<number>, center: number): number {
    const js: number[] = [];
    const minJ = Math.max(0, center - 6);
    const maxJ = Math.min(rr.length, center + 7);
    for (let j = minJ; j < maxJ; j++) {
      if (usable[j] && !skip.has(j)) js.push(j);
    }

    const pairs: number[] = [];
    for (let i = 0; i < js.length - 1; i++) {
      const a = js[i];
      const b = js[i + 1];
      if (b === a + 1) {
        pairs.push((rr[a] + rr[b]) / 2);
      }
    }

    if (pairs.length >= 3) return median(pairs);
    if (js.length >= 3) return median(js.map((j) => rr[j]));
    return globMed;
  }

  // 1. Classify beats
  const { labels, premRatio, compRatio, premK, same, diff, odd } = classifyBeats(
    nb, remFlags, usable, rr, cq, widths, width_t, refFor
  );

  // 2. Detect pauses & rhythm patterns
  const { pauses, compPauses, pauseStarts } = detectPauses(
    nb, usable, rr, times, labels, refFor
  );
  const { altRuns, bigeminy } = detectRhythmPatterns(rr, usable, times, premK);

  // 3. Compute HRV metrics
  const { nn, consecPairs, hr, hrNn, sdnn, rmssd, pnn50, sd1, sd2 } = computeHrvMetrics(
    nb, usable, labels, rr, times, pauseStarts, usableRrs
  );

  // 4. Build average template & measure morphology
  const rrMean = nn.length > 0 ? mean(nn) / 1000 : globMed;
  const { morph, clipped } = buildAverageTemplate(
    v, pos, labels, cqt, rrMean, fs, rec.clip
  );

  // 5. Build beat table
  const beatsTable: BeatTableItem[] = [];
  for (let k = 0; k < nb; k++) {
    beatsTable.push({
      time_s: r1(times[k], 3),
      label: labels[k],
      source: sources[beats[k]] || "检测",
      rr_prev_ms: k >= 1 ? r1(rr[k - 1] * 1000, 0) : null,
      rr_next_ms: k < nb - 1 ? r1(rr[k] * 1000, 0) : null,
      prematurity: r1(premRatio[k], 2),
      compensation: r1(compRatio[k], 2),
      corr_qrs: r1(cq[k], 3),
      corr_qrst: r1(cqt[k], 3),
      qrs_ms: r1(widths[k], 0),
    });
  }

  // 6. Morphology metrics and alerts
  const qt = morph ? morph.qt : null;
  const qtcBazett = qt && rrMean > 0 ? r1(qt / Math.sqrt(rrMean), 0) : null;
  const qtcFridericia = qt && rrMean > 0 ? r1(qt / Math.cbrt(rrMean), 0) : null;

  let qtBeatIqr: [number, number] | null = null;
  if (morph && morph.qts.length > 0) {
    qtBeatIqr = [
      r1(percentile(morph.qts, 25), 0)!,
      r1(percentile(morph.qts, 75), 0)!,
    ];
  }

  const morphologyReport = morph
    ? {
        template_beats: morph.n,
        template_corr_threshold: morph.corr_threshold,
        p_amp_mv: r1(morph.p_amp, 3),
        p_polarity: morph.p_pol,
        p_measurable: morph.p_ok,
        pr_ms: r1(morph.pr, 0),
        qrs_ms: r1(morph.qrs, 0),
        r_amp_mv: r1(morph.r_amp, 3),
        s_amp_mv: r1(morph.s_amp, 3),
        amplitude_is_lower_bound: clipped,
        st_j_mv: r1(morph.st_j, 3),
        st_j60_mv: r1(morph.st_j60, 3),
        t_amp_mv: r1(morph.t_amp, 3),
        t_polarity: morph.t_pol,
        qt_ms: r1(qt, 0),
        qt_beat_iqr_ms: qtBeatIqr,
        qtc_bazett_ms: qtcBazett,
        qtc_fridericia_ms: qtcFridericia,
        qt_reliable: true,
      }
    : null;

  const { alerts, skipped } = morphologyAlerts(morphologyReport, hr, sex, placement);
  if (morphologyReport) {
    morphologyReport.qt_reliable = !skipped.some((x) => x.endsWith("未做 QTc 提醒"));
  }

  const sortedAlerts = alerts.slice().sort((a, _b) => (a.level === "建议就医" ? -1 : 1));

  // 7. Assemble clinical flags and comparison
  const fullFlags = compileClinicalFlags({
    diff, same, odd, bigeminy, pauses, altRuns, removed, exclude,
    artifacts, clipped, morph, hr, watch: rec.watch, premK, sortedAlerts,
    placement, times,
  });

  const repBpm = rec.watch.reported_bpm;

  const report: Report = {
    tool_version: "1.0.0",
    record_id: rec.record_id,
    source: rec.source,
    watch: rec.watch,
    rhythm: {
      beats: nb,
      hr_bpm: r1(hr),
      hr_nn_bpm: r1(hrNn),
      reported_bpm: repBpm,
      rr_ms_min: r1(Math.min(...usableRrs) * 1000, 0),
      rr_ms_max: r1(Math.max(...usableRrs) * 1000, 0),
      n_normal: labels.filter((l) => l === LABEL_NORMAL).length,
      n_premature_same: same.length,
      n_premature_diff: diff.length,
      n_odd: odd.length,
      n_removed: labels.filter((l) => l === LABEL_REMOVED).length,
      pauses,
      compensatory_pauses: compPauses,
      bigeminy_start_s: bigeminy,
      rr_alternation_start_s: altRuns,
    },
    hrv: {
      n_nn: nn.length,
      mean_nn_ms: nn.length > 0 ? r1(mean(nn)) : null,
      sdnn_ms: r1(sdnn),
      rmssd_ms: r1(rmssd),
      pnn50_pct: r1(pnn50),
      sd1_ms: r1(sd1),
      sd2_ms: r1(sd2),
    },
    morphology: morphologyReport,
    quality: {
      noise_sd_mv: r1(morph?.noise, 3),
      clipped,
      artifact_windows_s: artifacts.map(([a, b]) => [r1(a)!, r1(b)!]),
      manual_exclude_s: exclude,
    },
    flags: fullFlags,
    notes,
    beats: beatsTable,
    morphology_alerts: {
      sex,
      placement,
      alerts,
      skipped,
    },
  };

  return {
    report,
    times,
    pos,
    labels,
    removed,
    morph,
    nn,
    nn_pairs: consecPairs,
    pauses,
  };
}
