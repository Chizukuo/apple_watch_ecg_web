/** Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later */
/** CPython round: round the exact binary64 value to a decimal, ties to even. */
export function pythonRound(value: number, digits = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  if (!Number.isInteger(digits) || digits < 0 || digits > 8)
    throw new RangeError("Unsupported rounding precision");
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, Math.abs(value));
  const bits = data.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  const power = (exponent ? exponent - 1023 : -1022) - 52;
  let numerator = mantissa * 10n ** BigInt(digits),
    denominator = 1n;
  if (power >= 0) numerator <<= BigInt(power);
  else denominator <<= BigInt(-power);
  let rounded = numerator / denominator;
  const remainder = numerator % denominator;
  if (
    2n * remainder > denominator ||
    (2n * remainder === denominator && rounded % 2n === 1n)
  )
    rounded++;
  return (Math.sign(value) * Number(rounded)) / 10 ** digits;
}
