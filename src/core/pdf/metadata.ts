/**
 * PDF text metadata, Apple Watch classification, and timestamp extraction
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DEFAULT_FS, IdentityInfo, WatchInfo } from "../types";

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function parseMonthDay(a: string, b: string): [number | null, number | null] {
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  if (aLow in MONTHS && /^\d+$/.test(b)) return [MONTHS[aLow], parseInt(b, 10)];
  if (bLow in MONTHS && /^\d+$/.test(a)) return [MONTHS[bLow], parseInt(a, 10)];
  if (/^\d+$/.test(a) && /^\d+$/.test(b))
    return [parseInt(a, 10), parseInt(b, 10)];
  return [null, null];
}

function adjust12Hour(hour: number, period: string | null | undefined): number {
  if (!period) return hour;
  const p = period.toUpperCase();
  if (p === "下午" || p === "晚上" || p === "PM")
    return hour < 12 ? hour + 12 : hour;
  if (p === "上午" || p === "凌晨" || p === "AM") return hour === 12 ? 0 : hour;
  if (p === "中午") return hour < 11 ? hour + 12 : hour;
  return hour;
}

export function parseRecDatetime(text: string): Date | null {
  // 1. Chinese format
  const m1 = text.match(
    /(?:记录时间|記錄時間)[:：]?\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*(上午|下午|凌晨|中午|晚上|AM|PM)?\s*(\d{1,2})[:：](\d{2})(?:\s*(上午|下午|AM|PM))?/i,
  );
  if (m1) {
    const y = parseInt(m1[1], 10);
    const mo = parseInt(m1[2], 10);
    const d = parseInt(m1[3], 10);
    const p1 = m1[4];
    const h = parseInt(m1[5], 10);
    const mi = parseInt(m1[6], 10);
    const p2 = m1[7];
    const hour = adjust12Hour(h, p1 || p2);
    return new Date(Date.UTC(y, mo - 1, d, hour, mi));
  }

  // 2. English format
  const m2 = text.match(
    /(?:Recorded|Date)[:：]?\s*([A-Za-z]+|\d{1,2})[,\s]+([A-Za-z]+|\d{1,2})[,\s]+(\d{4})\s*(?:at\s*)?(AM|PM)?\s*(\d{1,2})[:：](\d{2})(?:\s*(AM|PM))?/i,
  );
  if (m2) {
    const [month, day] = parseMonthDay(m2[1], m2[2]);
    if (month && day) {
      const y = parseInt(m2[3], 10);
      const h = parseInt(m2[5], 10);
      const mi = parseInt(m2[6], 10);
      const hour = adjust12Hour(h, m2[4] || m2[7]);
      return new Date(Date.UTC(y, month - 1, day, hour, mi));
    }
  }

  // 3. ISO format
  const m3 = text.match(
    /(?:Recorded|记录时间|記錄時間|Date)?[:：]?\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s*(?:at\s*)?(上午|下午|AM|PM)?\s*(\d{1,2})[:：](\d{2})(?:\s*(上午|下午|AM|PM))?/i,
  );
  if (m3) {
    const y = parseInt(m3[1], 10);
    const mo = parseInt(m3[2], 10);
    const d = parseInt(m3[3], 10);
    const h = parseInt(m3[5], 10);
    const mi = parseInt(m3[6], 10);
    const hour = adjust12Hour(h, m3[4] || m3[7]);
    return new Date(Date.UTC(y, mo - 1, d, hour, mi));
  }
  return null;
}

export function parseDob(text: string): Date | null {
  const m1 = text.match(
    /(?:出生日期|出生年月)[:：]?\s*(\d{4})年(\d{1,2})月(\d{1,2})日/,
  );
  if (m1) {
    return new Date(
      Date.UTC(
        parseInt(m1[1], 10),
        parseInt(m1[2], 10) - 1,
        parseInt(m1[3], 10),
      ),
    );
  }

  const m2 = text.match(
    /(?:Date of [Bb]irth|DOB)[:：]?\s*([A-Za-z]+|\d{1,2})[,\s]+([A-Za-z]+|\d{1,2})[,\s]+(\d{4})/i,
  );
  if (m2) {
    const [mo, d] = parseMonthDay(m2[1], m2[2]);
    if (mo && d) {
      return new Date(Date.UTC(parseInt(m2[3], 10), mo - 1, d));
    }
  }

  const m3 = text.match(
    /(?:Date of [Bb]irth|DOB|出生日期)[:：]?\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/i,
  );
  if (m3) {
    return new Date(
      Date.UTC(
        parseInt(m3[1], 10),
        parseInt(m3[2], 10) - 1,
        parseInt(m3[3], 10),
      ),
    );
  }
  return null;
}

export function watchCategory(label: string | null | undefined): string {
  if (!label) return "unknown";
  const lbl = label.toLowerCase().trim();
  if (
    label.includes("房颤") ||
    label.includes("心房颤动") ||
    label.includes("心房纖顫") ||
    label.includes("心房顫動") ||
    lbl.includes("atrial fibrillation") ||
    lbl.includes("afib")
  ) {
    return label.includes("高") || lbl.includes("high") ? "afib_high" : "afib";
  }
  if (
    label.includes("窦性") ||
    label.includes("竇性") ||
    lbl.includes("sinus")
  ) {
    return "sinus";
  }
  if (
    (label.includes("低") && label.includes("高")) ||
    label.includes("过低") ||
    label.includes("過低") ||
    label.includes("低心率") ||
    lbl.includes("low heart rate") ||
    lbl.includes("low or high")
  ) {
    return "low_or_high";
  }
  if (
    label.includes("高心率") ||
    label.includes("心率较高") ||
    label.includes("心率过高") ||
    label.includes("心率較高") ||
    label.includes("心率過高") ||
    lbl.includes("high heart rate")
  ) {
    return "high_hr";
  }
  if (
    label.includes("不确定") ||
    label.includes("不確定") ||
    label.includes("无法") ||
    label.includes("無法") ||
    lbl.includes("inconclusive")
  ) {
    return "inconclusive";
  }
  if (
    label.includes("不佳") ||
    label.includes("较差") ||
    label.includes("較差") ||
    lbl.includes("poor")
  ) {
    return "poor";
  }
  return "unknown";
}

/**
 * Parses decoded multiline text into structured WatchInfo and IdentityInfo.
 */
export function parsePdfText(text: string): {
  watch: WatchInfo;
  identity: IdentityInfo;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const watch: WatchInfo = {
    recorded_at: null,
    age_at_recording: null,
    age_shown: null,
    classification: null,
    category: "unknown",
    reported_bpm: null,
    summary_text: null,
    symptoms: null,
    paper_speed_mm_s: 25.0,
    gain_mm_mv: 10.0,
    sampling_rate_hz: DEFAULT_FS,
    lead_label: null,
    device_model: null,
    ios_version: null,
    watchos_version: null,
    algorithm_version: null,
    exported_at: null,
    ios_build: null,
  };

  const identity: IdentityInfo = {
    name: lines.length > 0 ? lines[0] : null,
    dob: null,
  };

  const recDt = parseRecDatetime(text);
  if (recDt) {
    const yyyy = recDt.getUTCFullYear();
    const mm = String(recDt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(recDt.getUTCDate()).padStart(2, "0");
    const hh = String(recDt.getUTCHours()).padStart(2, "0");
    const min = String(recDt.getUTCMinutes()).padStart(2, "0");
    watch.recorded_at = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  const dob = parseDob(text);
  if (dob) {
    const yyyy = dob.getUTCFullYear();
    const mm = String(dob.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dob.getUTCDate()).padStart(2, "0");
    identity.dob = `${yyyy}-${mm}-${dd}`;

    if (recDt) {
      let age = recDt.getUTCFullYear() - dob.getUTCFullYear();
      const mDiff = recDt.getUTCMonth() - dob.getUTCMonth();
      if (mDiff < 0 || (mDiff === 0 && recDt.getUTCDate() < dob.getUTCDate())) {
        age--;
      }
      watch.age_at_recording = age;
    }
  }

  // Age shown in parentheses
  const mAge =
    text.match(
      /(?:出生日期|Date of [Bb]irth|DOB)[^\n]*[（(]\s*(\d+)\s*(?:岁|歲|years? old|yo|yr)?\s*[)）]/i,
    ) ||
    text.match(/[（(]\s*(\d+)\s*(?:岁|歲|years? old|yo|yr)\s*[)）]/i) ||
    text.match(/[（(]\s*(\d+)\s*岁\s*[)）]/);
  if (mAge) {
    watch.age_shown = parseInt(mAge[1], 10);
  }

  // Reported heart rate
  const mBpm =
    text.match(/平均\s*(\d+)\s*次\s*\/\s*(?:分|分鐘)/) ||
    text.match(/(?:Average\s*)?(\d+)\s*BPM/i) ||
    text.match(/(\d+)\s*BPM\s*Average/i);
  if (mBpm) {
    watch.reported_bpm = parseInt(mBpm[1], 10);
  }

  // Hardware and export parameters
  const mSpeed = text.match(/(\d+(?:\.\d+)?)\s*mm\/s/i);
  if (mSpeed) watch.paper_speed_mm_s = parseFloat(mSpeed[1]);

  const mGain = text.match(/(\d+(?:\.\d+)?)\s*mm\/mV/i);
  if (mGain) watch.gain_mm_mv = parseFloat(mGain[1]);

  const mHz = text.match(/(\d+)\s*Hz/i);
  if (mHz) watch.sampling_rate_hz = parseInt(mHz[1], 10);

  const mLead = text.match(/((?:导联|導聯|Lead)\s*[IVX]+)/i);
  if (mLead) watch.lead_label = mLead[1].trim();

  const mIos = text.match(/iOS\s*([\d.]+\d)/i);
  if (mIos) watch.ios_version = mIos[1];

  const mWatchos = text.match(/watchOS\s*([\d.]+\d)/i);
  if (mWatchos) watch.watchos_version = mWatchos[1];

  const mModel = text.match(/(Watch\d+,\d+)/i);
  if (mModel) watch.device_model = mModel[1];

  const mAlgo = text.match(
    /(?:算法版本|演算法版本|Algorithm\s*[Vv]ersion)\s*(\d+)/i,
  );
  if (mAlgo) watch.algorithm_version = parseInt(mAlgo[1], 10);

  // Classification line: "窦性心律 — 平均64次/分"
  for (const ln of lines) {
    const hasRate =
      ln.includes("次/分") || ln.includes("次/分鐘") || /bpm/i.test(ln);
    const hasDash = ln.includes("—") || ln.includes("–") || ln.includes("-");
    if (hasRate && hasDash) {
      const parts = ln.split(/\s*[—–-]\s*/);
      if (parts && parts[0]) {
        watch.classification = parts[0].trim();
        break;
      }
    }
  }

  watch.category = watchCategory(watch.classification);

  // Summary statement text
  const startPrefixes = [
    "此心电图",
    "此心電圖",
    "This ECG",
    "This recording",
    "This is an ECG",
  ];
  const startKeywords = [
    "房颤迹象",
    "心房顫動跡象",
    "atrial fibrillation",
    "AFib",
  ];
  let startIdx: number | null = null;
  for (let k = 0; k < lines.length; k++) {
    const ln = lines[k];
    if (
      startPrefixes.some((p) => ln.startsWith(p)) ||
      (startKeywords.some((w) => ln.includes(w)) &&
        !ln.includes("—") &&
        !ln.includes("–") &&
        !ln.includes("-"))
    ) {
      startIdx = k;
      break;
    }
  }

  if (startIdx !== null) {
    let endIdx = lines.length;
    for (let k = startIdx; k < lines.length; k++) {
      if (lines[k].includes("mm/s")) {
        endIdx = k;
        break;
      }
    }
    const sub = lines.slice(startIdx, endIdx);
    const isAscii = sub.some((ln) => /[a-zA-Z]/.test(ln));
    watch.summary_text = isAscii ? sub.join(" ") : sub.join("");
  }

  const mSym = text.match(
    /(?:症状|症狀|Symptoms(?:\s*recorded)?|Symptom)[:：]\s*(.+)/i,
  );
  if (mSym) watch.symptoms = mSym[1].trim();

  return { watch, identity };
}

/**
 * Extracts PDF document metadata properties (CreationDate and Producer build)
 */
export function parsePdfProperties(latinText: string): {
  exported_at: string | null;
  ios_build: string | null;
} {
  let exported_at: string | null = null;
  let ios_build: string | null = null;

  const creationMatch = latinText.match(/\/CreationDate\s*\(([^)]+)\)/);
  if (creationMatch) {
    const raw = creationMatch[1];
    const cm = raw.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    if (cm) {
      const zone = raw.match(/(?:Z|([+-])(\d{2})'?(\d{2})'?)[ ]*$/);
      const offset = zone?.[1] ? `${zone[1]}${zone[2]}:${zone[3]}` : "Z";
      const date = new Date(
        `${cm[1]}-${cm[2]}-${cm[3]}T${cm[4]}:${cm[5]}:${cm[6]}${offset}`,
      );
      if (Number.isFinite(date.getTime())) exported_at = date.toISOString();
    }
  }

  const prodMatch = latinText.match(/\/Producer\s*\(([^)]+)\)/);
  if (prodMatch) {
    const pm = prodMatch[1].match(/Build\s+(\w+)/i);
    if (pm) ios_build = pm[1];
  }

  return { exported_at, ios_build };
}
