/**
 * Rounding, formatting and summing with exact, documented semantics.
 *
 * `Math.round(x * 100) / 100` and `toFixed` both drift at ties, so a reported rate could
 * differ by a cent depending on how it was computed. Every function here works on the exact
 * binary value of the float and rounds half to even. These are the semantics of Python's
 * `round`, `format` and `sum` (3.12+), which the benchmark numbers were first recorded with.
 */

/** `x` rounded to `digits` decimal places, ties to even. Python's `round(x, digits)`. */
export function round(x: number, digits: number): number {
  return Number(fixed(x, digits));
}

/** `x` formatted with exactly `digits` decimal places, ties to even. Python's `f"{x:.{digits}f}"`. */
export function fixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) throw new RangeError(`cannot format ${x}`);
  if (!Number.isInteger(digits) || digits < 0) throw new RangeError(`bad digit count: ${digits}`);
  const { mantissa, exponent } = decompose(Math.abs(x));
  const scaled = mantissa * 10n ** BigInt(digits);
  let units: bigint;
  if (exponent >= 0) {
    units = scaled << BigInt(exponent);
  } else {
    const denominator = 1n << BigInt(-exponent);
    units = scaled / denominator;
    const twiceRemainder = (scaled % denominator) * 2n;
    if (twiceRemainder > denominator || (twiceRemainder === denominator && units % 2n === 1n)) units += 1n;
  }
  const text = units.toString().padStart(digits + 1, "0");
  const body = digits > 0 ? `${text.slice(0, -digits)}.${text.slice(-digits)}` : text;
  return x < 0 || Object.is(x, -0) ? `-${body}` : body;
}

/** A share as a whole percentage, e.g. 0.305 -> "30%" (30.5 is a tie, so it goes to even). */
export function percent(share: number): string {
  return `${fixed(share * 100, 0)}%`;
}

/** Thousands separators on the integer part of a formatted number: "1234567.8" -> "1,234,567.8". */
export function grouped(formatted: string): string {
  const [whole = "", fraction] = formatted.split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+$)/g, ",");
  return fraction === undefined ? withCommas : `${withCommas}.${fraction}`;
}

/** Sum with Neumaier compensation, so the result doesn't depend on accumulated rounding error. */
export function sum(values: Iterable<number>): number {
  let total = 0;
  let compensation = 0;
  for (const x of values) {
    const t = total + x;
    compensation += Math.abs(total) >= Math.abs(x) ? total - t + x : x - t + total;
    total = t;
  }
  return compensation !== 0 && Number.isFinite(compensation) ? total + compensation : total;
}

/** A finite, non-negative double as mantissa * 2^exponent, exactly. */
function decompose(x: number): { mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  const biased = (high >>> 20) & 0x7ff;
  const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  return biased === 0
    ? { mantissa: fraction, exponent: -1074 }
    : { mantissa: fraction | (1n << 52n), exponent: biased - 1075 };
}
