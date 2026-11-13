import { expect, test } from "vitest";

import { fixed, grouped, percent, round, sum } from "../src/numeric.ts";

// Expected values are CPython 3.12 output for the same inputs.
const VALUES = [0.125, 0.375, 0.625, 0.875, 2.675, 1.005, 8.345, 0.5, 1.5, 2.5, 12345.125, 0.0, 99.995, 1e-9, 85.5, 0.03, 0.305];

test("round(x, 2) rounds the exact binary value, ties to even", () => {
  expect(VALUES.map((x) => round(x, 2))).toEqual(
    [0.12, 0.38, 0.62, 0.88, 2.67, 1.0, 8.35, 0.5, 1.5, 2.5, 12345.12, 0.0, 100.0, 0.0, 85.5, 0.03, 0.3],
  );
});

test("fixed(x, 2) and fixed(x, 0) match Python's .2f and .0f", () => {
  expect(VALUES.map((x) => fixed(x, 2))).toEqual([
    "0.12", "0.38", "0.62", "0.88", "2.67", "1.00", "8.35", "0.50", "1.50", "2.50",
    "12345.12", "0.00", "100.00", "0.00", "85.50", "0.03", "0.30",
  ]);
  expect(VALUES.map((x) => fixed(x, 0))).toEqual(
    ["0", "0", "1", "1", "3", "1", "8", "0", "2", "2", "12345", "0", "100", "0", "86", "0", "0"],
  );
  expect(fixed(-0.001, 2)).toBe("-0.00");
});

test("percent matches Python's .0%", () => {
  expect([0.125, 0.305, 0.03, 0.05, 1 / 3, 0.295, 0.005].map(percent)).toEqual(
    ["12%", "30%", "3%", "5%", "33%", "30%", "0%"],
  );
});

test("grouped adds thousands separators to the integer part", () => {
  expect(grouped(fixed(1234567 / 1000, 1))).toBe("1,234.6");
  expect(grouped("344.1")).toBe("344.1");
  expect(grouped("1234567")).toBe("1,234,567");
});

test("sum compensates for rounding error", () => {
  expect(sum(Array(10).fill(0.1))).toBe(1.0);
  expect(sum([1e100, 1.0, -1e100])).toBe(1.0);
  expect(sum([])).toBe(0);
  expect(sum([0.1, 0.2, 0.3])).toBe(0.6);
});
