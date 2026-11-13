import { expect, test } from "vitest";

import { Random } from "../src/random.ts";

/** Every kind of draw, in a fixed order, so two sources can be compared draw for draw. */
function draws(r: Random): unknown[] {
  const xs = Array.from({ length: 10 }, (_, i) => i);
  return [
    [r.random(), r.random(), r.random()],
    Array.from({ length: 5 }, () => r.randint(1, 28)),
    r.uniform(0.9, 1.1),
    (r.shuffle(xs), xs),
    r.sample(Array.from({ length: 100 }, (_, i) => i), 10),
    Array.from({ length: 6 }, () => r.weightedChoice(["table", "inline"], [0.6, 0.4])),
    Array.from({ length: 5 }, () => r.choice([0.0, 0.03, 0.04, 0.05])),
    r.randint(0, 2 ** 31 + 5),
  ];
}

test("a seed always draws the same sequence", () => {
  expect(draws(new Random(7))).toEqual(draws(new Random(7)));
});

test("different seeds draw different sequences", () => {
  expect(draws(new Random(1))).not.toEqual(draws(new Random(2)));
});

test("rejects seeds and ranges it cannot reproduce", () => {
  expect(() => new Random(1.5)).toThrow(RangeError);
  expect(() => new Random(2 ** 53)).toThrow(RangeError);
  expect(() => new Random(1).randint(5, 4)).toThrow(RangeError);
  expect(() => new Random(1).choice([])).toThrow(RangeError);
});
