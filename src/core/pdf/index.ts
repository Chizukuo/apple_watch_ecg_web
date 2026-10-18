/**
 * Pure TypeScript Apple Watch Quartz PDF Parser and Signal Extractor
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { inflate } from "pako";
import { AnalysisError, DEFAULT_FS, Recording } from "../types";
import { stitch } from "../signal";
import { CMap } from "./types";
import {
  decodeActualText,
  ENDSTREAM_BYTES,
  hexToBytes,
  indexOfBytes,
  latin1Decoder,
  MAC_ROMAN,
  parseCMap,
  STREAM_BYTES,
  unescapePdfString,
  utf16beDecoder,
} from "./encoding";
import { extractPaintedPaths } from "./graphics";
import { parsePdfProperties, parsePdfText } from "./metadata";
import { extractVectorRows, findGridStrips } from "./vector";

export * from "./types";
export * from "./encoding";
export * from "./graphics";
export * from "./metadata";
export * from "./vector";

/**
 * Parses raw Apple Watch ECG PDF bytes and reconstructs the continuous 30-second vector signal.
 */
export function parsePdf(pdfBytes: Uint8Array): Recording {
  const latinText = latin1Decoder.decode(pdfBytes);

  const streamMap = new Map<number, string>();
  const allStreams: string[] = [];

  let pos = 0;
  while (pos < pdfBytes.length) {
    const sIdx = indexOfBytes(pdfBytes, STREAM_BYTES, pos);
    if (sIdx === -1) break;

    const header = latinText.slice(Math.max(0, sIdx - 200), sIdx);
    const m = [...header.matchAll(/(\d+)\s+0\s+obj\b/g)];
    const objNum = m.length > 0 ? parseInt(m[m.length - 1][1], 10) : null;

    let start = sIdx + 6;
    while (pdfBytes[start] === 10 || pdfBytes[start] === 13) start++;
    const eIdx = indexOfBytes(pdfBytes, ENDSTREAM_BYTES, start);
    if (eIdx === -1) break;

    const slice = pdfBytes.subarray(start, eIdx);
    let decomp = "";
    if (slice.length > 2 && slice[0] === 0x78) {
      try {
        decomp = latin1Decoder.decode(inflate(slice));
      } catch {
        decomp = latin1Decoder.decode(slice);
      }
    } else {
      decomp = latin1Decoder.decode(slice);
    }

    if (objNum !== null) streamMap.set(objNum, decomp);
    allStreams.push(decomp);

    pos = eIdx + 9;
  }

  // 1. Build Font to CMap registry from page font references
  const fontToCMap = new Map<string, CMap>();
  const fontDictMatches = [...latinText.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)];
  for (const fdm of fontDictMatches) {
    const fontRefs = [...fdm[1].matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)];
    for (const fr of fontRefs) {
      const fName = fr[1];
      const fObjNum = parseInt(fr[2], 10);
      const fObjRegex = new RegExp("(?:^|[\\r\\n\\s])" + fObjNum + "\\s+0\\s+obj([\\s\\S]*?)endobj");
      const fObjMatch = latinText.match(fObjRegex);
      if (fObjMatch) {
        const toUnicodeMatch = fObjMatch[1].match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
        if (toUnicodeMatch) {
          const uObjNum = parseInt(toUnicodeMatch[1], 10);
          const uStream = streamMap.get(uObjNum);
          if (uStream && uStream.includes("begincmap")) {
            fontToCMap.set(fName, parseCMap(uStream));
          }
        }
      }
    }
  }

  function decodeChar(code: number, activeFont: string | null): string {
    if (activeFont && fontToCMap.has(activeFont)) {
      const cmap = fontToCMap.get(activeFont);
      if (cmap && cmap.has(code)) return cmap.get(code)!;
    }
    if (code >= 32 && code <= 126) return String.fromCharCode(code);
    if (code in MAC_ROMAN) return MAC_ROMAN[code];
    return String.fromCharCode(code);
  }

  // 2. Decode text layer & locate vector stream
  let vectorStreamStr = "";
  let fullText = "";

  for (const s of allStreams) {
    if (
      s.length > 20000 &&
      (s.includes(" m\n") || s.includes(" l\n") || s.includes(" m ") || s.includes(" l "))
    ) {
      vectorStreamStr = s;
    }

    // Decode Tagged PDF / Font CMap text if present
    if (s.includes("BT") && s.includes("ET")) {
      let currentFont: string | null = null;
      let currentActualText: string | null = null;
      let currentY: number | null = null;
      let currentLine = "";

      const tokenRegex =
        /\/Span\s*<<\s*\/ActualText\s*(?:\(([\s\S]*?)\)|<([0-9a-fA-F]+)>)\s*>>\s*BDC|EMC|([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+Tm|\/(\w+)\s+[\d.]+\s+Tf|\(([\s\S]*?)\)\s*(?:Tj|'|")|\[([\s\S]*?)\]\s*TJ/g;
      let m: RegExpExecArray | null;

      while ((m = tokenRegex.exec(s)) !== null) {
        if (m[1] !== undefined || m[2] !== undefined) {
          currentActualText =
            m[1] !== undefined ? decodeActualText(m[1]) : utf16beDecoder.decode(hexToBytes(m[2]));
        } else if (m[0] === "EMC") {
          currentActualText = null;
        } else if (m[8] !== undefined) {
          const yVal = parseFloat(m[8]);
          if (currentY !== null && Math.abs(currentY - yVal) > 4) {
            if (currentLine.trim()) fullText += currentLine.trim() + "\n";
            currentLine = "";
          }
          currentY = yVal;
        } else if (m[9] !== undefined) {
          currentFont = m[9];
        } else if (m[10] !== undefined) {
          if (currentActualText) {
            currentLine += currentActualText;
            currentActualText = null;
          } else {
            const bytes = unescapePdfString(m[10]);
            for (const b of bytes) currentLine += decodeChar(b, currentFont);
          }
        } else if (m[11] !== undefined) {
          const items = [...m[11].matchAll(/\(([\s\S]*?)\)/g)];
          for (const it of items) {
            if (currentActualText) {
              currentLine += currentActualText;
              currentActualText = null;
            } else {
              const bytes = unescapePdfString(it[1]);
              for (const b of bytes) currentLine += decodeChar(b, currentFont);
            }
          }
        }
      }
      if (currentLine.trim()) fullText += currentLine.trim() + "\n";
    }

    // Extract text in raw hex strings [<...>]TJ or <...> (synthetic PDFs)
    const hexMatches = s.match(/<([0-9a-fA-F]+)>/g);
    if (hexMatches) {
      for (const hm of hexMatches) {
        const hex = hm.slice(1, -1);
        if (hex.length >= 4 && hex.length % 2 === 0) {
          fullText += utf16beDecoder.decode(hexToBytes(hex)) + "\n";
        }
      }
    }

    // Extract plain ASCII text ( ... )Tj
    const asciiMatches = s.matchAll(/\(([^)]+)\)\s*(?:Tj|'|")/g);
    for (const am of asciiMatches) {
      fullText += am[1] + "\n";
    }
  }

  // Normalize unicode (NFKC) so CJK radicals map to standard Chinese characters
  fullText = fullText.normalize("NFKC");

  // 3. Parse metadata and properties
  const { watch, identity } = parsePdfText(fullText);
  const { exported_at, ios_build } = parsePdfProperties(latinText);
  if (exported_at) watch.exported_at = exported_at;
  if (ios_build) watch.ios_build = ios_build;

  const fs = watch.sampling_rate_hz || DEFAULT_FS;

  // 4. Extract vector drawings and identify grid strips
  const paintedPaths = extractPaintedPaths(vectorStreamStr, 612);
  const strips = findGridStrips(paintedPaths);

  // 5. Extract rows and resample
  const { rows, notes } = extractVectorRows(paintedPaths, strips, watch, fs);

  if (rows.length === 0) {
    throw new AnalysisError(
      "未在 PDF 中识别到心电图波形，请确保上传的是 Apple Watch 健康 App 导出的原始心电图 PDF"
    );
  }

  const recordId = watch.recorded_at
    ? "ECG_" + watch.recorded_at.replace(/-/g, "").replace(/:/g, "").replace(/ /g, "_")
    : "ECG_IMPORT";

  const { t, v, clip } = stitch(rows, fs);

  return {
    watch,
    identity,
    rows,
    source: "vector",
    fs,
    record_id: recordId,
    t,
    v,
    clip,
    notes,
  };
}
