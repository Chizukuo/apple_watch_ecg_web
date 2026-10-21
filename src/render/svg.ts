/**
 * Professional Clinical ECG Vector Dashboard Renderer
 * Full mathematical & aesthetic parity with Python apple_watch_ecg matplotlib dashboard
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  ALERT_NAMES,
  AnalysisOutput,
  LABEL_NORMAL,
  LABEL_ODD,
  LABEL_PREM_DIFF,
  LABEL_PREM_SAME,
  LABEL_REMOVED,
  Recording,
  STRIP_SECONDS,
} from "../core/types";
import { polylinePath } from "./path";

export function renderDashboardSvg(
  rec: Recording,
  res: AnalysisOutput,
  includeIdentity = false,
  calibrated = false,
): string {
  const rep = res.report;
  const nRows =
    rec.rows.length > 0 ? Math.max(...rec.rows.map((r) => r.index)) + 1 : 3;

  const width = 1200;
  const stripHeight = calibrated ? 130 : 115;
  const stripMarginTop = 58;
  const stripSpacing = calibrated ? 22 : 28;
  const bottomHeight = 320;
  const footerHeight = 35;
  const totalHeight =
    stripMarginTop +
    nRows * (stripHeight + stripSpacing) +
    bottomHeight +
    footerHeight;

  const leftPad = 60;
  const rightPad = 24;
  const stripWidth = width - leftPad - rightPad;

  const unitsPerMm = stripWidth / 250;
  const physical = calibrated
    ? `data-calibrated="true" width="${width / unitsPerMm}mm" height="${totalHeight / unitsPerMm}mm"`
    : 'width="100%" height="100%"';
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${totalHeight}" ${physical} style="background:#ffffff; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">\n`;

  // Defs: Arrowheads, clip paths, and patterns
  svg += `  <defs>\n`;
  if (calibrated) {
    const u = unitsPerMm;
    svg += `<pattern id="medical-minor" width="${u}" height="${u}" patternUnits="userSpaceOnUse"><path d="M ${u} 0 L 0 0 0 ${u}" fill="none" stroke="#f8d8d8" stroke-width="0.3"/></pattern>`;
    svg += `<pattern id="medical-major" width="${5 * u}" height="${5 * u}" patternUnits="userSpaceOnUse"><rect width="${5 * u}" height="${5 * u}" fill="url(#medical-minor)"/><path d="M ${5 * u} 0 L 0 0 0 ${5 * u}" fill="none" stroke="#e9aaaa" stroke-width="0.6"/></pattern>`;
  }
  for (let k = 0; k < nRows; k++) {
    svg += `    <clipPath id="strip-clip-${k}"><rect x="0" y="0" width="${stripWidth}" height="${stripHeight}"/></clipPath>\n`;
  }
  svg += `  </defs>\n\n`;

  // 1. Header & Title
  const w = rep.watch;
  const titleParts = [
    includeIdentity ? rec.identity?.name || "" : "",
    rep.record_id,
    w.recorded_at || "",
    w.classification || "",
    w.reported_bpm ? `手表 ${w.reported_bpm} 次/分` : "",
  ];
  if (w.symptoms) titleParts.push(`症状：${w.symptoms}`);
  const titleStr = titleParts.filter(Boolean).join("  ");

  svg += `  <!-- 1. Header Title & Legend -->\n`;
  svg += `  <text x="${leftPad}" y="20" font-size="13" font-weight="700" fill="#0f172a">${escapeXml(titleStr)}</text>\n`;

  // Top Right Legend
  svg += `  <g transform="translate(${leftPad}, 32)" font-size="11" fill="#475569">\n`;
  svg += `    <circle cx="0" cy="8" r="4" fill="#1565c0"/><text x="8" y="11">正常</text>\n`;
  svg += `    <polygon points="52,4 57,13 47,13" fill="#ef6c00"/><text x="61" y="11">提前同形</text>\n`;
  svg += `    <text x="130" y="13" font-size="12" font-weight="800" fill="#c62828">✕</text><text x="142" y="11">提前异形</text>\n`;
  svg += `    <rect x="208" y="4" width="8" height="8" fill="#616161"/><text x="220" y="11">形态异常</text>\n`;
  svg += `    <rect x="290" y="3" width="16" height="10" fill="#999999" opacity="0.3"/><text x="310" y="11">排除时段</text>\n`;
  svg += `  </g>\n\n`;

  // 2. Waveform Strips (10 seconds each)
  const times = res.times;
  const labels = res.labels;

  for (let k = 0; k < nRows; k++) {
    const t0 = k * STRIP_SECONDS;
    const t1 = (k + 1) * STRIP_SECONDS;
    const stripY = stripMarginTop + k * (stripHeight + stripSpacing);

    // Filter points in this strip
    let rowMaxV = -Infinity;
    let rowMinV = Infinity;
    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < rec.t.length; i++) {
      if (rec.t[i] >= t0 && rec.t[i] < t1) {
        if (startIdx === -1) startIdx = i;
        endIdx = i;
        const val = rec.v[i];
        if (val > rowMaxV) rowMaxV = val;
        if (val < rowMinV) rowMinV = val;
      }
    }
    if (startIdx === -1) {
      rowMaxV = 1.0;
      rowMinV = -0.5;
    }

    // Symmetrical / safe voltage bounds matching medical strip scaling
    const vMax = calibrated ? 1.5 : Math.max(1.5, Math.ceil(rowMaxV * 2) / 2);
    const vMin = calibrated
      ? vMax - stripHeight / (10 * unitsPerMm)
      : Math.min(-0.8, Math.floor(rowMinV * 2) / 2);
    const vSpan = vMax - vMin;

    const mapStripY = (v: number) =>
      stripHeight - ((v - vMin) / vSpan) * stripHeight;
    const mapStripX = (t: number) => ((t - t0) / STRIP_SECONDS) * stripWidth;

    svg += `  <!-- Strip ${k + 1} (${t0}s - ${t1}s) -->\n`;
    svg += `  <g transform="translate(${leftPad}, ${stripY})">\n`;
    svg += `    <!-- Background Frame -->\n`;
    svg += `    <rect width="${stripWidth}" height="${stripHeight}" fill="${calibrated ? "url(#medical-major)" : "#ffffff"}" stroke="#cbd5e1" stroke-width="0.8"/>\n`;

    // Clinical Grid Lines (X-axis seconds, Y-axis voltage)
    svg += `    <!-- Grid Lines -->\n`;
    // Y-axis grid & labels
    const yTicks = [-0.5, 0.0, 0.5, 1.0, 1.5, 2.0].filter(
      (v) => v >= vMin && v <= vMax,
    );
    for (const vTick of yTicks) {
      const yPos = mapStripY(vTick);
      const isZero = Math.abs(vTick) < 0.001;
      const strokeColor = isZero ? "#94a3b8" : "#f1f5f9";
      const strokeWidth = isZero ? "1.0" : "0.7";
      svg += `    <line x1="0" y1="${yPos.toFixed(1)}" x2="${stripWidth}" y2="${yPos.toFixed(1)}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>\n`;
      // Y-axis tick mark & label on left
      svg += `    <line x1="-4" y1="${yPos.toFixed(1)}" x2="0" y2="${yPos.toFixed(1)}" stroke="#64748b" stroke-width="0.8"/>\n`;
      svg += `    <text x="-7" y="${(yPos + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#64748b">${vTick.toFixed(1)}</text>\n`;
    }
    // Unit mV label cleanly placed above the Y-axis
    svg += `    <text x="-6" y="-6" text-anchor="end" font-size="8" font-weight="700" fill="#475569">mV</text>\n`;

    // X-axis 1-second minor & 2-second major grid lines
    for (let sec = 1; sec < STRIP_SECONDS; sec++) {
      const xPos = mapStripX(t0 + sec);
      const isMajor = sec % 2 === 0;
      const strokeColor = isMajor ? "#e2e8f0" : "#f8fafc";
      svg += `    <line x1="${xPos.toFixed(1)}" y1="0" x2="${xPos.toFixed(1)}" y2="${stripHeight}" stroke="${strokeColor}" stroke-width="0.7"/>\n`;
      if (isMajor) {
        svg += `    <line x1="${xPos.toFixed(1)}" y1="${stripHeight}" x2="${xPos.toFixed(1)}" y2="${stripHeight + 3}" stroke="#64748b" stroke-width="0.8"/>\n`;
        svg += `    <text x="${xPos.toFixed(1)}" y="${stripHeight + 13}" text-anchor="middle" font-size="8.5" fill="#64748b">${t0 + sec}</text>\n`;
      }
    }
    // Bottom 0s and 10s tick labels
    svg += `    <text x="0" y="${stripHeight + 13}" text-anchor="middle" font-size="8.5" fill="#64748b">${t0}</text>\n`;
    svg += `    <text x="${stripWidth}" y="${stripHeight + 13}" text-anchor="middle" font-size="8.5" fill="#64748b">${t1}</text>\n`;

    // Axis label on the bottom strip
    if (k === nRows - 1) {
      svg += `    <text x="${stripWidth / 2}" y="${stripHeight + 25}" text-anchor="middle" font-size="10" fill="#334155" font-weight="600">时间（s）</text>\n`;
    }

    if (calibrated && k === 0)
      svg += `<path d="M 4 ${mapStripY(0)} h ${2 * unitsPerMm} v ${-10 * unitsPerMm} h ${5 * unitsPerMm} v ${10 * unitsPerMm} h ${2 * unitsPerMm}" fill="none" stroke="#333" stroke-width="1"/><text x="${stripWidth}" y="-8" text-anchor="end" font-size="9">25 mm/s · 10 mm/mV · 1 mV 定标；按原始尺寸打印</text>`;
    if (calibrated && (rowMaxV > vMax || rowMinV < vMin))
      svg += `<text x="${stripWidth - 6}" y="14" text-anchor="end" font-size="9" fill="#b71c1c">部分波形超出绘图范围，完整电压见 CSV</text>`;
    // Shaded removed intervals
    for (const [ra, rb] of res.removed) {
      if (rb >= t0 && ra <= t1) {
        const spanStart = Math.max(ra, t0);
        const spanEnd = Math.min(rb, t1);
        const sx = mapStripX(spanStart);
        const sw = mapStripX(spanEnd) - sx;
        svg += `    <rect x="${sx.toFixed(1)}" y="0" width="${sw.toFixed(1)}" height="${stripHeight}" fill="#999999" opacity="0.22"/>\n`;
      }
    }

    // Clipped ECG Waveform
    svg += `    <g clip-path="url(#strip-clip-${k})">\n`;
    let hasClipInRow = false;
    if (startIdx !== -1) {
      for (let i = startIdx; i <= endIdx; i++) {
        if (rec.clip[i] === 1) hasClipInRow = true;
      }
      const path = polylinePath(
        endIdx - startIdx + 1,
        (i) => mapStripX(rec.t[startIdx + i]),
        (i) => mapStripY(rec.v[startIdx + i]),
      );
      svg += `      <path d="${path}" fill="none" stroke="#c62828" stroke-width="0.9" stroke-linejoin="round"/>\n`;
    }

    // Beat Markers on the wave
    for (let i = 0; i < times.length; i++) {
      const ti = times[i];
      if (ti >= t0 && ti < t1) {
        const px = mapStripX(ti);
        const vi = rec.v[res.pos[i]];
        const py = mapStripY(vi);
        const lbl = labels[i];

        if (lbl === LABEL_NORMAL) {
          svg += `      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.8" fill="#1565c0"/>\n`;
        } else if (lbl === LABEL_PREM_SAME) {
          svg += `      <polygon points="${px.toFixed(1)},${(py - 6).toFixed(1)} ${(px + 4).toFixed(1)},${(py + 3).toFixed(1)} ${(px - 4).toFixed(1)},${(py + 3).toFixed(1)}" fill="#ef6c00"/>\n`;
          svg += `      <text x="${px.toFixed(1)}" y="${(py - 8).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#ef6c00">${ti.toFixed(2)}s</text>\n`;
        } else if (lbl === LABEL_PREM_DIFF) {
          svg += `      <text x="${px.toFixed(1)}" y="${(py + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="900" fill="#c62828">✕</text>\n`;
          svg += `      <text x="${px.toFixed(1)}" y="${(py - 8).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#c62828">${ti.toFixed(2)}s</text>\n`;
        } else if (lbl === LABEL_ODD) {
          svg += `      <rect x="${(px - 3.5).toFixed(1)}" y="${(py - 3.5).toFixed(1)}" width="7" height="7" fill="#616161"/>\n`;
          svg += `      <text x="${px.toFixed(1)}" y="${(py - 8).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#616161">${ti.toFixed(2)}s</text>\n`;
        } else if (lbl === LABEL_REMOVED) {
          svg += `      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.8" fill="#bdbdbd"/>\n`;
        }
      }
    }
    svg += `    </g>\n`;

    // Dynamic Pauses with exact dimension lines |---|
    for (const p of res.pauses) {
      if (t0 <= p.start_s && p.start_s < t1) {
        const sx = mapStripX(p.start_s);
        const ex = Math.min(stripWidth, mapStripX(p.end_s));
        const pauseTopY = Math.max(12, mapStripY(rowMaxV) - 12);

        svg += `    <!-- Pause Dimension Line |---| -->\n`;
        svg += `    <line x1="${sx.toFixed(1)}" y1="${pauseTopY - 4}" x2="${sx.toFixed(1)}" y2="${pauseTopY + 4}" stroke="#c62828" stroke-width="1.2"/>\n`;
        svg += `    <line x1="${ex.toFixed(1)}" y1="${pauseTopY - 4}" x2="${ex.toFixed(1)}" y2="${pauseTopY + 4}" stroke="#c62828" stroke-width="1.2"/>\n`;
        svg += `    <line x1="${sx.toFixed(1)}" y1="${pauseTopY}" x2="${ex.toFixed(1)}" y2="${pauseTopY}" stroke="#c62828" stroke-width="1.2"/>\n`;
        svg += `    <text x="${((sx + ex) / 2).toFixed(1)}" y="${pauseTopY - 4}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#c62828">长间歇 ${p.rr_ms} ms</text>\n`;
      }
    }

    if (hasClipInRow) {
      svg += `    <text x="${stripWidth - 6}" y="14" text-anchor="end" font-size="9" font-weight="700" fill="#b71c1c">截断</text>\n`;
    }

    svg += `  </g>\n\n`;
  }

  // 3. Bottom Panels: Left (Average Beat) & Right (Poincaré & Metrics)
  const bottomY = stripMarginTop + nRows * (stripHeight + stripSpacing) + 14;
  const leftBottomW = Math.round(stripWidth * 0.62);
  const rightBottomX = leftPad + leftBottomW + 16;
  const rightBottomW = stripWidth - leftBottomW - 16;

  // 3A. Bottom-Left: Average Beat Template
  const m = res.morph;
  svg += `  <!-- 3A. Bottom Left: Average Beat Template -->\n`;
  svg += `  <g transform="translate(${leftPad}, ${bottomY})">\n`;
  svg += `    <rect width="${leftBottomW}" height="${bottomHeight}" fill="#fafbfc" stroke="#cbd5e1" rx="6" stroke-width="0.8"/>\n`;
  svg += `    <text x="16" y="22" font-size="11.5" font-weight="700" fill="#0f172a">平均心搏（${m ? m.n : 0} 拍：浅色 = 单拍，红线 = 中位数模板）</text>\n`;

  if (m) {
    const fs = rec.fs;
    const R = m.R;
    const len = m.sm.length;

    const plotL = 50;
    const plotR = leftBottomW - 24;
    const plotT = 38;
    const plotB = bottomHeight - 35;
    const plotW = plotR - plotL;
    const plotH = plotB - plotT;

    const ttMin = ((0 - R) / fs) * 1000;
    const ttMax = ((len - 1 - R) / fs) * 1000;

    const smSub = Array.from(m.sm).map((v) => v - m.base);
    const lo = Math.min(-0.5, ...smSub);
    const topV = Math.max(0.5, ...smSub) + 0.5;
    const ylimLo = lo - 0.75;
    const ylimHi = topV;
    const vSpan = ylimHi - ylimLo;

    const mapTmplX = (tMs: number) =>
      plotL + ((tMs - ttMin) / (ttMax - ttMin)) * plotW;
    const mapTmplY = (vMv: number) => plotT + ((ylimHi - vMv) / vSpan) * plotH;

    // Inner plot frame
    svg += `    <rect x="${plotL}" y="${plotT}" width="${plotW}" height="${plotH}" fill="#ffffff" stroke="#e2e8f0" stroke-width="0.8"/>\n`;

    // Horizontal Voltage Ticks & Grid
    const tmplYTicks = [-0.5, 0.0, 0.5, 1.0, 1.5].filter(
      (v) => v >= ylimLo && v <= ylimHi,
    );
    for (const vTick of tmplYTicks) {
      const yPos = mapTmplY(vTick);
      const isZero = Math.abs(vTick) < 0.001;
      const strokeColor = isZero ? "#888888" : "#f1f5f9";
      const dash = isZero ? `stroke-dasharray="3,3"` : "";
      svg += `    <line x1="${plotL}" y1="${yPos.toFixed(1)}" x2="${plotR}" y2="${yPos.toFixed(1)}" stroke="${strokeColor}" stroke-width="${isZero ? 0.8 : 0.6}" ${dash}/>\n`;
      svg += `    <line x1="${plotL - 3}" y1="${yPos.toFixed(1)}" x2="${plotL}" y2="${yPos.toFixed(1)}" stroke="#64748b" stroke-width="0.7"/>\n`;
      svg += `    <text x="${plotL - 6}" y="${(yPos + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#64748b">${vTick.toFixed(1)}</text>\n`;
    }
    svg += `    <text x="${plotL - 6}" y="${plotT - 6}" text-anchor="end" font-size="8" font-weight="700" fill="#475569">mV</text>\n`;

    // X-axis Time Ticks (ms relative to R peak)
    for (let tMs = -200; tMs <= 400; tMs += 100) {
      if (tMs >= ttMin && tMs <= ttMax) {
        const xPos = mapTmplX(tMs);
        svg += `    <line x1="${xPos.toFixed(1)}" y1="${plotT}" x2="${xPos.toFixed(1)}" y2="${plotB}" stroke="#f8fafc" stroke-width="0.6"/>\n`;
        svg += `    <line x1="${xPos.toFixed(1)}" y1="${plotB}" x2="${xPos.toFixed(1)}" y2="${plotB + 3}" stroke="#64748b" stroke-width="0.7"/>\n`;
        svg += `    <text x="${xPos.toFixed(1)}" y="${plotB + 12}" text-anchor="middle" font-size="8" fill="#64748b">${tMs}</text>\n`;
      }
    }
    svg += `    <text x="${(plotL + plotR) / 2}" y="${plotB + 24}" text-anchor="middle" font-size="9" fill="#334155" font-weight="600">距 R 峰的时间（ms）</text>\n`;

    // 1. All Single Beats Overlay (light pink)
    for (let r = 0; r < m.W.length; r++) {
      const beatRow = m.W[r];
      const bPath = polylinePath(
        beatRow.length,
        (c) => mapTmplX(((c - R) / fs) * 1000),
        (c) => mapTmplY(beatRow[c] - m.base),
      );
      svg += `    <path d="${bPath}" fill="none" stroke="#f2c4c4" stroke-width="0.5" opacity="0.8"/>\n`;
    }

    // 2. Median Template Signal (bold red)
    const tmplPath = polylinePath(
      m.sm.length,
      (c) => mapTmplX(((c - R) / fs) * 1000),
      (c) => mapTmplY(smSub[c]),
    );
    svg += `    <path d="${tmplPath}" fill="none" stroke="#c62828" stroke-width="2.0" stroke-linejoin="round"/>\n`;

    // 3. Vertical Fiducial Boundary Lines & Staggered Labels
    const keys: [string, number | null][] = [
      ["P", m.P],
      ["QRS起", m.on],
      ["R", R],
      ["S", m.S],
      ["J", m.J],
      ["T峰", m.Tpk],
      ["T末", m.Tend],
    ];
    const validKeys = keys
      .filter((k): k is [string, number] => k[1] !== null)
      .sort((a, b) => a[1] - b[1]);

    let lastX = -1e9;
    let level = 0;
    for (const [name, idx] of validKeys) {
      const xMs = ((idx - R) / fs) * 1000;
      level = xMs - lastX < 32 ? (level + 1) % 2 : 0;
      lastX = xMs;

      const px = mapTmplX(xMs);
      svg += `    <line x1="${px.toFixed(1)}" y1="${plotT}" x2="${px.toFixed(1)}" y2="${plotB}" stroke="#9e9e9e" stroke-width="0.6" stroke-dasharray="3,3" opacity="0.4"/>\n`;
      const labelY = plotT - 4 - level * 11;
      svg += `    <text x="${px.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#78909c" font-weight="600">${name}</text>\n`;
    }

    // 4. Annotated Wave Peaks with Leader Lines (matching Python lab_)
    const mo = rep.morphology;
    // P Peak
    if (m.P !== null && mo) {
      const pX = mapTmplX(((m.P - R) / fs) * 1000);
      const pY = mapTmplY(smSub[m.P]);
      const pTargetY = mapTmplY(smSub[m.P] + 0.3);
      const pTxt =
        `P ${mo.p_amp_mv !== null ? mo.p_amp_mv.toFixed(2) : "—"} mV` +
        (m.p_ok ? "" : "（不可测）");
      svg += `    <line x1="${pX.toFixed(1)}" y1="${pY.toFixed(1)}" x2="${pX.toFixed(1)}" y2="${(pTargetY + 4).toFixed(1)}" stroke="#555555" stroke-width="0.6"/>\n`;
      svg += `    <text x="${pX.toFixed(1)}" y="${pTargetY.toFixed(1)}" text-anchor="middle" font-size="8" fill="#334155">${pTxt}</text>\n`;
    }

    // R Peak
    if (mo) {
      const rX = mapTmplX(0);
      const rY = mapTmplY(smSub[R]);
      const rTargetY = mapTmplY(smSub[R] + 0.15);
      const rTxt = `R ${mo.r_amp_mv !== null ? mo.r_amp_mv.toFixed(2) : "—"} mV`;
      svg += `    <line x1="${rX.toFixed(1)}" y1="${rY.toFixed(1)}" x2="${rX.toFixed(1)}" y2="${(rTargetY + 4).toFixed(1)}" stroke="#555555" stroke-width="0.6"/>\n`;
      svg += `    <text x="${rX.toFixed(1)}" y="${rTargetY.toFixed(1)}" text-anchor="middle" font-size="8" font-weight="600" fill="#334155">${rTxt}</text>\n`;
    }

    // S Wave (Offset horizontally to avoid QRS calipers below)
    if (mo) {
      const sX = mapTmplX(((m.S - R) / fs) * 1000);
      const sY = mapTmplY(smSub[m.S]);
      const sTargetX = sX + 45;
      const sPrefix = mo.amplitude_is_lower_bound ? "≤ " : "";
      const sTxt = `S ${sPrefix}${mo.s_amp_mv !== null ? mo.s_amp_mv.toFixed(2) : "—"} mV`;
      svg += `    <line x1="${sX.toFixed(1)}" y1="${sY.toFixed(1)}" x2="${(sTargetX - 3).toFixed(1)}" y2="${sY.toFixed(1)}" stroke="#555555" stroke-width="0.6"/>\n`;
      svg += `    <text x="${sTargetX.toFixed(1)}" y="${(sY + 3).toFixed(1)}" text-anchor="start" font-size="8" fill="#334155">${sTxt}</text>\n`;
    }

    // T Peak
    if (m.Tpk !== null && mo) {
      const tX = mapTmplX(((m.Tpk - R) / fs) * 1000);
      const tY = mapTmplY(smSub[m.Tpk]);
      const tTargetY = mapTmplY(smSub[m.Tpk] + 0.25);
      const tTxt = `T ${mo.t_amp_mv !== null ? mo.t_amp_mv.toFixed(2) : "—"} mV`;
      svg += `    <line x1="${tX.toFixed(1)}" y1="${tY.toFixed(1)}" x2="${tX.toFixed(1)}" y2="${(tTargetY + 4).toFixed(1)}" stroke="#555555" stroke-width="0.6"/>\n`;
      svg += `    <text x="${tX.toFixed(1)}" y="${tTargetY.toFixed(1)}" text-anchor="middle" font-size="8" fill="#334155">${tTxt}</text>\n`;
    }

    // 5. Caliper Measurements with <-> Double-Ended Arrows
    // QRS Caliper
    if (m.on !== null && m.J !== null) {
      const onX = mapTmplX(((m.on - R) / fs) * 1000);
      const jX = mapTmplX(((m.J - R) / fs) * 1000);
      const calQrsY = mapTmplY(lo - 0.15);
      const qrsMs =
        mo?.qrs_ms != null
          ? mo.qrs_ms.toFixed(0)
          : m.qrs != null
            ? m.qrs.toFixed(0)
            : "—";
      svg += `    <!-- QRS Caliper <-> -->\n`;
      svg += `    <line x1="${onX.toFixed(1)}" y1="${calQrsY.toFixed(1)}" x2="${jX.toFixed(1)}" y2="${calQrsY.toFixed(1)}" stroke="#1565c0" stroke-width="1.2"/>\n`;
      svg += `    <polygon points="${onX.toFixed(1)},${calQrsY.toFixed(1)} ${(onX + 4).toFixed(1)},${(calQrsY - 2.5).toFixed(1)} ${(onX + 4).toFixed(1)},${(calQrsY + 2.5).toFixed(1)}" fill="#1565c0"/>\n`;
      svg += `    <polygon points="${jX.toFixed(1)},${calQrsY.toFixed(1)} ${(jX - 4).toFixed(1)},${(calQrsY - 2.5).toFixed(1)} ${(jX - 4).toFixed(1)},${(calQrsY + 2.5).toFixed(1)}" fill="#1565c0"/>\n`;
      svg += `    <text x="${((onX + jX) / 2).toFixed(1)}" y="${(calQrsY + 11).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#1565c0">QRS ${qrsMs} ms</text>\n`;

      // QT Caliper (Fixed arrow points Y coordinate bug)
      if (m.Tend !== null) {
        const tendX = mapTmplX(((m.Tend - R) / fs) * 1000);
        const calQtY = mapTmplY(lo - 0.45);
        const qtReliable = mo?.qt_reliable ?? true;
        const qtMs =
          mo?.qt_ms != null
            ? mo.qt_ms.toFixed(0)
            : m.qt != null
              ? m.qt.toFixed(0)
              : "—";
        svg += `    <!-- QT Caliper <-> -->\n`;
        svg += `    <line x1="${onX.toFixed(1)}" y1="${calQtY.toFixed(1)}" x2="${tendX.toFixed(1)}" y2="${calQtY.toFixed(1)}" stroke="#2e7d32" stroke-width="1.2"/>\n`;
        svg += `    <polygon points="${onX.toFixed(1)},${calQtY.toFixed(1)} ${(onX + 4).toFixed(1)},${(calQtY - 2.5).toFixed(1)} ${(onX + 4).toFixed(1)},${(calQtY + 2.5).toFixed(1)}" fill="#2e7d32"/>\n`;
        svg += `    <polygon points="${tendX.toFixed(1)},${calQtY.toFixed(1)} ${(tendX - 4).toFixed(1)},${(calQtY - 2.5).toFixed(1)} ${(tendX - 4).toFixed(1)},${(calQtY + 2.5).toFixed(1)}" fill="#2e7d32"/>\n`;
        svg += `    <text x="${((onX + tendX) / 2).toFixed(1)}" y="${(calQtY + 11).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="#2e7d32">QT ${qtMs} ms${qtReliable ? "" : "（不可靠）"}</text>\n`;
      }
    }
  } else {
    svg += `    <text x="${leftBottomW / 2}" y="${bottomHeight / 2}" text-anchor="middle" font-size="13" fill="#94a3b8">形态一致的正常心搏不足，未测量平均心搏</text>\n`;
  }
  svg += `  </g>\n\n`;

  // 3B. Bottom-Right: Poincaré Plot & Multi-line Clinical Dashboard
  const rh = rep.rhythm;
  const hv = rep.hrv;
  const mo = rep.morphology;
  const alerts = rep.morphology_alerts.alerts;
  const hasDanger = alerts.some((a) => a.level === "建议就医");
  const headerColor = hasDanger ? "#b71c1c" : "#0f172a";

  svg += `  <!-- 3B. Bottom Right: Poincaré & Clinical Metrics -->\n`;
  svg += `  <g transform="translate(${rightBottomX}, ${bottomY})">\n`;
  svg += `    <rect width="${rightBottomW}" height="${bottomHeight}" fill="#fafbfc" stroke="#cbd5e1" rx="6" stroke-width="0.8"/>\n`;

  // 5-Line Clinical Diagnostic Summary
  svg += `    <!-- Clinical Summary Header -->\n`;
  svg += `    <g transform="translate(16, 20)" font-size="9.5" fill="${headerColor}">\n`;
  svg += `      <text y="0" font-weight="700">心率 ${rh.hr_bpm ?? "—"} 次/分（RR ${rh.rr_ms_min ?? "—"}–${rh.rr_ms_max ?? "—"} ms）</text>\n`;
  svg += `      <text y="16">提前搏动 同形 ${rh.n_premature_same} / 异形 ${rh.n_premature_diff}  形态异常 ${rh.n_odd}  长间歇 ${rh.pauses.length}</text>\n`;
  svg += `      <text y="32">RMSSD ${hv.rmssd_ms ?? "—"} ms  SDNN ${hv.sdnn_ms ?? "—"} ms  pNN50 ${hv.pnn50_pct ?? "—"}%</text>\n`;

  let qtcLine = `QTc ${mo?.qtc_bazett_ms ?? "—"} ms（Bazett）/ ${mo?.qtc_fridericia_ms ?? "—"} ms（Fridericia）`;
  if (mo && !mo.qt_reliable) {
    qtcLine = "QTc 不可靠（T 波太低或逐拍波动大）";
  }
  svg += `      <text y="48">${qtcLine}  PR ${mo?.pr_ms ? `${mo.pr_ms} ms` : "不可测"}</text>\n`;

  const alertNames =
    alerts.length > 0
      ? alerts.map((a) => ALERT_NAMES[a.code] || a.code).join("、")
      : "无";
  svg += `      <text y="64" font-weight="${alerts.length > 0 ? "700" : "400"}">形态提醒：${escapeXml(alertNames)}</text>\n`;
  svg += `    </g>\n`;

  // Poincaré Scatter Plot Frame (Aspect Ratio 1:1)
  const pBoxSize = 150;
  const pBoxX = Math.round((rightBottomW - pBoxSize) / 2);
  const pBoxY = 105;

  svg += `    <!-- Poincaré Plot Box -->\n`;
  svg += `    <g transform="translate(${pBoxX}, ${pBoxY})">\n`;
  svg += `      <rect width="${pBoxSize}" height="${pBoxSize}" fill="#ffffff" stroke="#cbd5e1" stroke-width="0.8"/>\n`;

  if (res.nn.length > 2 && res.nn_pairs.length > 0) {
    const minNn = Math.min(...res.nn);
    const maxNn = Math.max(...res.nn);
    const lo2 = minNn - 30;
    const hi2 = maxNn + 30;
    const span2 = Math.max(1, hi2 - lo2);

    const mapP = (val: number) => ((val - lo2) / span2) * pBoxSize;

    // Grid lines & diagonal y = x
    svg += `      <line x1="0" y1="${pBoxSize}" x2="${pBoxSize}" y2="0" stroke="#999999" stroke-width="0.8" stroke-dasharray="3,3"/>\n`;

    // Numerical axis ticks
    const step = span2 > 300 ? 100 : 50;
    const firstTick = Math.ceil(lo2 / step) * step;
    for (let t = firstTick; t <= hi2; t += step) {
      const p = mapP(t);
      // X tick mark & label
      svg += `      <line x1="${p.toFixed(1)}" y1="${pBoxSize}" x2="${p.toFixed(1)}" y2="${pBoxSize + 3}" stroke="#64748b" stroke-width="0.7"/>\n`;
      svg += `      <text x="${p.toFixed(1)}" y="${pBoxSize + 11}" text-anchor="middle" font-size="7.5" fill="#64748b">${t}</text>\n`;
      // Y tick mark & label
      svg += `      <line x1="-3" y1="${(pBoxSize - p).toFixed(1)}" x2="0" y2="${(pBoxSize - p).toFixed(1)}" stroke="#64748b" stroke-width="0.7"/>\n`;
      svg += `      <text x="-5" y="${(pBoxSize - p + 3).toFixed(1)}" text-anchor="end" font-size="7.5" fill="#64748b">${t}</text>\n`;
    }

    // Scatter Points (purple #6a1b9a)
    for (let i = 0; i < res.nn_pairs.length; i++) {
      const [nx, ny] = res.nn_pairs[i];
      const sx = mapP(nx);
      const sy = pBoxSize - mapP(ny);
      svg += `      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.6" fill="#6a1b9a" opacity="0.75"/>\n`;
    }
  } else {
    svg += `      <text x="${pBoxSize / 2}" y="${pBoxSize / 2}" text-anchor="middle" font-size="10" fill="#94a3b8">无连续心搏对</text>\n`;
  }

  // Axis Titles with proper subscripts and safe clearance
  svg += `      <text x="${pBoxSize / 2}" y="${pBoxSize + 22}" text-anchor="middle" font-size="8.5" fill="#334155" font-weight="600">NN<tspan dy="2" font-size="7">n</tspan><tspan dy="-2">（ms）</tspan></text>\n`;
  svg += `      <text x="-32" y="${pBoxSize / 2}" text-anchor="middle" font-size="8.5" fill="#334155" font-weight="600" transform="rotate(-90, -32, ${pBoxSize / 2})">NN<tspan dy="2" font-size="7">n+1</tspan><tspan dy="-2">（ms）</tspan></text>\n`;
  svg += `    </g>\n`;

  // Bottom Alert Pill Badge
  const alertY = bottomHeight - 34;
  if (alerts.length > 0) {
    const bgFill = hasDanger ? "#fef2f2" : "#fefce8";
    const strokeColor = hasDanger ? "#fecaca" : "#fef08a";
    const textColor = hasDanger ? "#b91c1c" : "#854d0e";
    svg += `    <rect x="12" y="${alertY}" width="${rightBottomW - 24}" height="26" rx="4" fill="${bgFill}" stroke="${strokeColor}"/>\n`;
    svg += `    <text x="20" y="${alertY + 17}" font-size="9.5" font-weight="700" fill="${textColor}">提醒：${escapeXml(alertNames)}</text>\n`;
  } else {
    svg += `    <rect x="12" y="${alertY}" width="${rightBottomW - 24}" height="26" rx="4" fill="#f0fdf4" stroke="#bbf7d0"/>\n`;
    svg += `    <text x="20" y="${alertY + 17}" font-size="9.5" font-weight="600" fill="#15803d">未触发形态提醒；未评估项目请查看报告</text>\n`;
  }

  svg += `  </g>\n\n`;

  // 4. Footer Disclaimer & First Clinical Flag
  let footer =
    "由 Apple Watch 导出文件还原，仅供个人记录与对比，非医疗诊断。完整提示见同名 _report.json";
  if (rep.flags && rep.flags.length > 0) {
    const first = rep.flags[0];
    footer +=
      "。首条提示：" + (first.length <= 70 ? first : first.slice(0, 69) + "…");
  }

  svg += `  <!-- 4. Footer -->\n`;
  svg += `  <text x="${leftPad}" y="${totalHeight - 14}" font-size="8.5" fill="#64748b">${escapeXml(footer)}</text>\n`;
  svg += `</svg>`;

  return svg;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
