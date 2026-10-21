/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("uploads, evaluates and exports without script errors or default identity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator("#theme-btn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.selectOption("#sex", "female");
  await page.selectOption("#placement", "other");
  await page.locator("#exclude").fill("0-2");
  await page
    .locator("#file-input")
    .setInputFiles("test/fixtures/synthetic_demo.pdf");
  const apiResponse = page.waitForResponse(
    (r) => r.url().includes("/api/analyze?") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  const response = await apiResponse;
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.identity).toBeUndefined();
  expect(data.morphology_alerts.sex).toBe("female");
  expect(data.morphology_alerts.placement).toBe("other");
  expect(data.quality.manual_exclude_s).toEqual([[0, 2]]);
  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#svg-output svg")).toBeVisible();
  await expect(page.locator("#meta-name")).toHaveText(data.record_id);
  await expect(page.locator("#status-badge")).toHaveText(data.assessment.title);
  await expect(page.locator("#findings-list")).toContainText("非标准导联");
  for (const [name, extension] of [
    ["下载 SVG", ".svg"],
    ["JSON 报告", ".json"],
    ["信号 CSV", ".csv"],
    ["导出 PNG", ".png"],
  ]) {
    const wait = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const download = await wait;
    expect(download.suggestedFilename()).toContain(extension);
    const path = await download.path();
    const bytes = await fs.readFile(path!);
    expect(bytes.length).toBeGreaterThan(100);
    if (extension === ".json") {
      const report = JSON.parse(bytes.toString());
      expect(report.identity).toBeUndefined();
      expect(report.svg).toBeUndefined();
      expect(report.tool_version).toBe("1.1.0");
    }
    if (extension === ".png") {
      expect(bytes.readUInt32BE(16)).toBe(2400);
      expect(bytes.readUInt32BE(20)).toBeGreaterThan(1000);
    }
  }
  expect(errors).toEqual([]);
  await page.screenshot({
    path: test.info().outputPath("workstation.png"),
    fullPage: true,
  });
});

test("sample loading and explicit identity opt-in work", async ({ page }) => {
  await page.goto("/");
  await page.locator("#include-identity").check();
  await page.getByRole("button", { name: "载入合成示例", exact: true }).click();
  await expect(page.locator("#result-view")).toBeVisible();
  await expect(page.locator("#meta-name")).toHaveText("测试用户");
});

test("batch selection exports an ordered summary and calibrated mode preserves physical scale", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#calibrated").check();
  await page
    .locator("#file-input")
    .setInputFiles([
      "test/fixtures/synthetic_demo.pdf",
      "test/fixtures/synthetic_demo.pdf",
    ]);
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.locator("#batch-results")).toBeVisible();
  await expect(page.locator("#batch-list button")).toHaveCount(2);
  await expect(page.locator("#batch-list button").nth(1)).toContainText(
    "ECG_20261013_1125_2",
  );
  const svg = page.locator("#svg-output svg");
  await expect(svg).toHaveAttribute("data-calibrated", "true");
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 summary.csv", exact: true })
    .click();
  const downloaded = await wait;
  expect(downloaded.suggestedFilename()).toBe("summary.csv");
  const summary = await fs.readFile((await downloaded.path())!, "utf8");
  expect(summary.split("\r\n").filter(Boolean)).toHaveLength(3);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#print-output svg")).toBeVisible();
  await expect(page.locator("#upload-panel")).toBeHidden();
  const width = await page
    .locator("#print-output svg")
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeCloseTo((268.8172043 * 96) / 25.4, 0);
});
