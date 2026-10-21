/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { URL } from "node:url";
import {
  PDFDocument,
  PDFArray,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { parsePdf } from "../src/core/pdf";
import { analyze } from "../src/core/pipeline";
const fixture = new URL("./fixtures/synthetic_demo.pdf", import.meta.url);

describe("PDF page content integrity", () => {
  it("combines referenced streams and ignores a larger unreferenced decoy", async () => {
    const bytes = fs.readFileSync(fixture);
    const expected = await parsePdf(bytes);
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    const contents = page.node.Contents() as PDFArray;
    const joined = contents
      .asArray()
      .map((ref) =>
        Buffer.from(
          decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode(),
        ).toString("latin1"),
      )
      .join("\n");
    const cut = joined.indexOf("\n", Math.floor(joined.length / 2)) + 1;
    const a = doc.context.register(doc.context.stream(joined.slice(0, cut)));
    const b = doc.context.register(doc.context.stream(joined.slice(cut)));
    page.node.set(PDFName.of("Contents"), doc.context.obj([a, b]));
    doc.context.register(doc.context.stream("0 0 m\n1 1 l\n".repeat(30000)));
    const actual = await parsePdf(await doc.save({ useObjectStreams: true }));
    expect(Array.from(actual.t)).toEqual(Array.from(expected.t));
    expect(Array.from(actual.v)).toEqual(Array.from(expected.v));
    expect(analyze(actual).report.rhythm).toEqual(
      analyze(expected).report.rhythm,
    );
  });

  it("rejects an incomplete record instead of reporting success", async () => {
    const doc = await PDFDocument.load(fs.readFileSync(fixture));
    const page = doc.getPage(0);
    const contents = page.node.Contents() as PDFArray;
    const joined = contents
      .asArray()
      .map((ref) =>
        Buffer.from(
          decodePDFRawStream(doc.context.lookup(ref) as PDFRawStream).decode(),
        ).toString("latin1"),
      )
      .join("\n");
    const cut = joined.indexOf("\n", Math.floor(joined.length / 2)) + 1;
    page.node.set(
      PDFName.of("Contents"),
      doc.context.register(doc.context.stream(joined.slice(0, cut))),
    );
    await expect(parsePdf(await doc.save())).rejects.toThrow(/不完整|波形/);
  });
});
