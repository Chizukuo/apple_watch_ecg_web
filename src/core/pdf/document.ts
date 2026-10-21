/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";
import { Inflate } from "pako";
import { AnalysisError } from "../types";
import { CMap } from "./types";
import { decodePdfImage } from "./image";
import { latin1Decoder, parseCMap } from "./encoding";

const MAX_EXPANDED = 32 * 1024 * 1024;

/** Inspect compressed streams before pdf-lib expands object streams during document loading. */
function preflight(bytes: Uint8Array) {
  if (bytes.length > 15 * 1024 * 1024) throw new AnalysisError("PDF 超过 15MB");
  const text = latin1Decoder.decode(bytes);
  const marker = /\bstream(?:\r\n?|\n)/g;
  let m: RegExpExecArray | null;
  let expanded = 0,
    count = 0;
  while ((m = marker.exec(text))) {
    if (++count > 4096) throw new AnalysisError("PDF 内容流过多");
    const end = text.indexOf("endstream", marker.lastIndex);
    if (end < 0) throw new AnalysisError("PDF 内容流不完整");
    const data = bytes.subarray(marker.lastIndex, end);
    const objectStart = text.lastIndexOf(" obj", m.index);
    if (objectStart < 0 || m.index - objectStart > 65536)
      throw new AnalysisError("PDF 流字典无效或过大");
    const filters = text.slice(objectStart, m.index);
    if (/\/(?:Filter|Type)\s+\d+\s+\d+\s+R/.test(filters))
      throw new AnalysisError("暂不支持间接压缩过滤器或类型");
    if (
      /\/Type\s*\/ObjStm/.test(filters) &&
      /\/Filter/.test(filters) &&
      !/\/FlateDecode/.test(filters)
    )
      throw new AnalysisError("暂不支持此对象流压缩格式");
    if (/\/FlateDecode/.test(filters)) {
      if (
        /\/Filter\s*\[/.test(filters) &&
        !/\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(filters)
      )
        throw new AnalysisError("暂不支持多重压缩过滤器");
      const inflater = new Inflate({ chunkSize: 16384 });
      inflater.onData = (chunk: Uint8Array) => {
        expanded += chunk.length;
        if (expanded > MAX_EXPANDED)
          throw new AnalysisError("PDF 解压内容超过 32MB");
      };
      inflater.push(data, true);
      if (inflater.err) throw new AnalysisError("PDF 压缩流无效");
    } else expanded += data.length;
    if (expanded > MAX_EXPANDED) throw new AnalysisError("PDF 内容超过 32MB");
    marker.lastIndex = end + 9;
  }
}

export async function readDocument(bytes: Uint8Array) {
  preflight(bytes);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
      capNumbers: true,
    });
  } catch {
    throw new AnalysisError("无法读取 PDF；请提供未加密的完整原始文件");
  }
  if (
    doc.getPageCount() < 1 ||
    doc.getPageCount() > 8 ||
    doc.context.enumerateIndirectObjects().length > 20000
  )
    throw new AnalysisError("PDF 页数或对象数量超出限制");
  let expanded = 0;
  const decoded = new Map<PDFRawStream, string>();
  const decode = (stream: PDFRawStream): string => {
    const cached = decoded.get(stream);
    if (cached !== undefined) return cached;
    const filter = stream.dict.lookup(PDFName.of("Filter"))?.toString();
    if (
      filter &&
      filter !== "/FlateDecode" &&
      !/^\[\s*\/FlateDecode\s*\]$/.test(filter)
    )
      throw new AnalysisError("PDF 内容过滤器暂不支持");
    const data = decodePDFRawStream(stream).decode();
    expanded += data.length;
    if (expanded > MAX_EXPANDED)
      throw new AnalysisError("PDF 解码内容超过 32MB");
    const text = latin1Decoder.decode(data);
    decoded.set(stream, text);
    return text;
  };
  const pages = doc.getPages().map((page) => {
    const raw = page.node.Contents();
    const list = raw instanceof PDFArray ? raw.asArray() : raw ? [raw] : [];
    const streams = list.map((item) => {
      const obj = item instanceof PDFRef ? doc.context.lookup(item) : item;
      if (!(obj instanceof PDFRawStream))
        throw new AnalysisError("PDF 页面内容流无效");
      return decode(obj);
    });
    const fonts = new Map<string, CMap>();
    const resources = page.node.Resources();
    const fontDict = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
    for (const [name, value] of fontDict?.entries() ?? []) {
      const font = doc.context.lookup(value);
      if (!(font instanceof PDFDict)) continue;
      const ref = font.get(PDFName.of("ToUnicode"));
      const unicode = ref ? doc.context.lookup(ref) : undefined;
      if (unicode instanceof PDFRawStream)
        fonts.set(name.decodeText(), parseCMap(decode(unicode)));
      else {
        const encoding = font.get(PDFName.of("Encoding"))?.toString() ?? "";
        const fallback: CMap & { codeBytes?: number } = new Map();
        fallback.codeBytes = /UTF16/.test(encoding) ? 2 : 1;
        fonts.set(name.decodeText(), fallback);
      }
    }
    const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const images: PDFRawStream[] = [];
    for (const [, value] of xobjects?.entries() ?? []) {
      const object = doc.context.lookup(value);
      if (
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
      )
        images.push(object);
    }
    return {
      content: streams.join("\n"),
      fonts,
      height: page.getHeight(),
      raster: () => {
        if (images.length !== 1)
          throw new AnalysisError(
            "扫描 PDF 需要一张完整页面图片；可改用 PNG/JPEG",
          );
        return decodePdfImage(images[0]);
      },
    };
  });
  const created = doc.getCreationDate();
  return {
    pages,
    properties: {
      exported_at: created ? created.toISOString() : null,
      ios_build: doc.getProducer()?.match(/Build\s+(\w+)/i)?.[1] ?? null,
    },
  };
}
