/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { AnalysisError } from "../types";
import { CMap } from "./types";
import {
  decodeActualText,
  hexToBytes,
  MAC_ROMAN,
  unescapePdfString,
  utf16beDecoder,
} from "./encoding";

/** PDF lexical boundaries: comments and strings must never become drawing operators. */
export function contentTokens(source: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < source.length) {
    const start = i,
      c = source[i++];
    if (/\s|\0/.test(c)) continue;
    if (c === "%") {
      while (i < source.length && !/[\r\n]/.test(source[i])) i++;
      continue;
    }
    if (c === "(") {
      let depth = 1;
      while (i < source.length && depth) {
        const ch = source[i++];
        if (ch === "\\") {
          if (source[i] === "\r" && source[i + 1] === "\n") i++;
          i++;
        } else if (ch === "(") depth++;
        else if (ch === ")") depth--;
      }
      if (depth) throw new AnalysisError("PDF 文字字符串不完整");
    } else if (c === "<" && source[i] !== "<") {
      while (i < source.length && source[i] !== ">") i++;
      if (i >= source.length)
        throw new AnalysisError("PDF 十六进制字符串不完整");
      i++;
    } else if (
      (c === "<" && source[i] === "<") ||
      (c === ">" && source[i] === ">")
    )
      i++;
    else if (!"[]<>".includes(c)) {
      while (i < source.length && !/[\s\0()[\]<>/%]/.test(source[i])) i++;
    }
    tokens.push(source.slice(start, i));
    if (tokens.length > 1000000)
      throw new AnalysisError("PDF 指令数量超过限制");
  }
  return tokens;
}

export function extractText(source: string, fonts: Map<string, CMap>): string {
  const tokens = contentTokens(source);
  let font = "",
    y: number | null = null,
    line = "";
  const lines: string[] = [],
    operands: string[] = [];
  const spans: { actual: string | null; used: boolean }[] = [];
  const newline = () => {
    if (line.trim()) lines.push(line.trim());
    line = "";
  };
  const decode = (token: string) => {
    const bytes = token.startsWith("(")
      ? unescapePdfString(token.slice(1, -1))
      : Array.from(hexToBytes(token.slice(1, -1).replace(/\s/g, "")));
    const map = fonts.get(font);
    if (map) {
      const width =
        (map as CMap & { codeBytes?: number }).codeBytes ??
        (Math.max(...Array.from(map.keys()), 0) > 255 ? 2 : 1);
      if (![1, 2, 3, 4].includes(width))
        throw new AnalysisError("PDF 字体编码宽度无效");
      let out = "";
      for (let j = 0; j < bytes.length; j += width) {
        let code = 0;
        for (let k = 0; k < width; k++) code = code * 256 + (bytes[j + k] ?? 0);
        out +=
          map.get(code) ??
          (code >= 32 && code <= 126
            ? String.fromCharCode(code)
            : (MAC_ROMAN[code] ?? String.fromCharCode(code)));
      }
      return out;
    }
    if (bytes[0] === 254 && bytes[1] === 255)
      return utf16beDecoder.decode(new Uint8Array(bytes.slice(2)));
    return bytes.map((b) => MAC_ROMAN[b] ?? String.fromCharCode(b)).join("");
  };
  for (const token of tokens) {
    if (
      token.startsWith("/") ||
      token.startsWith("(") ||
      token.startsWith("<") ||
      token === ">>" ||
      token === "[" ||
      token === "]" ||
      /^[+-]?(?:\d*\.)?\d+$/.test(token)
    ) {
      operands.push(token);
      continue;
    }
    if (token === "Tf")
      font = (operands.at(-2) ?? "")
        .slice(1)
        .replace(/#([0-9a-fA-F]{2})/g, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        );
    if (token === "Tm") {
      const next = Number(operands.at(-1));
      if (y !== null && Math.abs(y - next) > 4) newline();
      y = next;
    }
    if (token === "Td" || token === "TD") {
      const dy = Number(operands.at(-1));
      if (Math.abs(dy) > 4) newline();
      if (y !== null) y += dy;
    }
    if (token === "T*" || token === "'" || token === '"') newline();
    if (token === "BDC" || token === "BMC") {
      const k = operands.indexOf("/ActualText"),
        actual = k < 0 ? null : operands[k + 1];
      spans.push({
        actual: actual
          ? actual.startsWith("(")
            ? decodeActualText(actual.slice(1, -1))
            : utf16beDecoder.decode(hexToBytes(actual.slice(1, -1)))
          : null,
        used: false,
      });
    }
    if (token === "EMC") spans.pop();
    if (["Tj", "TJ", "'", '"'].includes(token)) {
      const span = [...spans].reverse().find((s) => s.actual !== null);
      if (span) {
        if (!span.used) line += span.actual;
        span.used = true;
      } else
        for (const value of operands)
          if (
            value.startsWith("(") ||
            (value.startsWith("<") && value !== "<<")
          )
            line += decode(value);
    }
    operands.length = 0;
  }
  newline();
  return lines.join("\n").normalize("NFKC");
}
