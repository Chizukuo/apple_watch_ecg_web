/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["scripts/shortcut-benchmark.test.ts"],
    maxWorkers: 1,
    testTimeout: 60000,
  },
});
