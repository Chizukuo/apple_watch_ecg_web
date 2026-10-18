/**
 * PDF string, font CMap, and character set decoding utilities
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CMap } from "./types";

export const latin1Decoder = new TextDecoder("latin1");
export const utf16beDecoder = new TextDecoder("utf-16be");

/**
 * WHATWG TextDecoder('latin1') alias maps 0x80..0x9F to Windows-1252 code points.
 * This reverse table maps those Unicode characters back to their raw 0x80..0x9F byte values.
 */
export const WIN1252_REV: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function charToByte(code: number): number {
  if (code in WIN1252_REV) return WIN1252_REV[code];
  return code & 0xff;
}

/**
 * Unescapes standard PDF literal strings: octal (\037), control chars (\n, \r, \t),
 * and restores raw 8-bit bytes from WHATWG Windows-1252 decoded strings.
 */
export function unescapePdfString(raw: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\") {
      i++;
      if (raw[i] >= "0" && raw[i] <= "7") {
        let oct = raw[i];
        if (raw[i + 1] >= "0" && raw[i + 1] <= "7") {
          oct += raw[++i];
          if (raw[i + 1] >= "0" && raw[i + 1] <= "7") oct += raw[++i];
        }
        bytes.push(parseInt(oct, 8));
      } else if (raw[i] === "n") bytes.push(10);
      else if (raw[i] === "r") bytes.push(13);
      else if (raw[i] === "t") bytes.push(9);
      else if (raw[i] === "b") bytes.push(8);
      else if (raw[i] === "f") bytes.push(12);
      else bytes.push(charToByte(raw.charCodeAt(i)));
    } else {
      bytes.push(charToByte(raw.charCodeAt(i)));
    }
  }
  return bytes;
}

/**
 * Decodes Marked Content /ActualText string (handles UTF-16BE with BOM 0xFEFF or Latin1).
 */
export function decodeActualText(raw: string): string {
  const bytes = unescapePdfString(raw);
  const u8 = new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return utf16beDecoder.decode(u8.subarray(2));
  }
  return latin1Decoder.decode(u8);
}

/**
 * Standard MacRoman encoding table for non-ToUnicode fonts (e.g., SFUI-Regular, Helvetica)
 */
export const MAC_ROMAN: Record<number, string> = {
  160: "\u2020", 161: "\u00B0", 162: "\u00A2", 163: "\u00A3", 164: "\u00A7", 165: "\u2022",
  166: "\u00B6", 167: "\u00DF", 168: "\u00AE", 169: "\u00A9", 170: "\u2122", 171: "\u00B4",
  172: "\u00A8", 173: "\u2260", 174: "\u00C6", 175: "\u00D8", 176: "\u221E", 177: "\u00B1",
  178: "\u2264", 179: "\u2265", 180: "\u00A5", 181: "\u00B5", 182: "\u2202", 183: "\u2211",
  184: "\u220F", 185: "\u03C0", 186: "\u222B", 187: "\u00AA", 188: "\u00BA", 189: "\u03A9",
  190: "\u00E6", 191: "\u00F8", 192: "\u00BF", 193: "\u00A1", 194: "\u00AC", 195: "\u221A",
  196: "\u0192", 197: "\u2248", 198: "\u2206", 199: "\u00AB", 200: "\u00BB", 201: "\u2026",
  202: "\u00A0", 203: "\u00C0", 204: "\u00C3", 205: "\u00D5", 206: "\u0152", 207: "\u0153",
  208: "\u2013", 209: "\u2014", 210: "\u201C", 211: "\u201D", 212: "\u2018", 213: "\u2019",
  214: "\u00F7", 215: "\u25CA", 216: "\u00FF", 217: "\u0178", 218: "\u2044", 219: "\u20AC",
};

/**
 * Parses embedded font ToUnicode CMap stream into a character-code to Unicode map.
 */
export function parseCMap(cmapStr: string): CMap {
  const map: CMap = new Map();
  if (!cmapStr) return map;

  const bfrangeBlocks = cmapStr.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
  for (const block of bfrangeBlocks) {
    for (const ln of block.split(/\r?\n/)) {
      const m = ln.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (m) {
        const startCode = parseInt(m[1], 16);
        const endCode = parseInt(m[2], 16);
        let destCode = parseInt(m[3], 16);
        for (let c = startCode; c <= endCode; c++) {
          map.set(c, String.fromCharCode(destCode));
          destCode++;
        }
      }
    }
  }

  const bfcharBlocks = cmapStr.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
  for (const block of bfcharBlocks) {
    for (const ln of block.split(/\r?\n/)) {
      const m = ln.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (m) {
        map.set(parseInt(m[1], 16), String.fromCharCode(parseInt(m[2], 16)));
      }
    }
  }

  return map;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export const STREAM_BYTES = new Uint8Array([115, 116, 114, 101, 97, 109]); // "stream"
export const ENDSTREAM_BYTES = new Uint8Array([101, 110, 100, 115, 116, 114, 101, 97, 109]); // "endstream"

export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, fromIndex = 0): number {
  const nLen = needle.length;
  const hLen = haystack.length;
  if (nLen === 0) return 0;
  outer: for (let i = fromIndex; i <= hLen - nLen; i++) {
    for (let j = 0; j < nLen; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
