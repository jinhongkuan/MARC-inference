/**
 * A seeded random source: a Mersenne Twister with the seeding and per-draw algorithms of
 * CPython's `random.Random`, ported so seeds built the same worlds as the Python spike.
 *
 * Nothing compares against Python any more. What pins the output now is the README's
 * baseline table, which tests/bench.test.ts checks against the worlds these draws build.
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class Random {
  readonly #state = new Uint32Array(N);
  #index = N;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new RangeError(`seed must be a safe integer, got ${seed}`);
    this.#seedByArray(words(Math.abs(seed)));
  }

  /** A float in [0, 1) built from 53 random bits. */
  random(): number {
    const a = this.#next() >>> 5;
    const b = this.#next() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** `a + (b - a) * random()`, so `b` itself can come out through rounding. */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** An integer in [a, b], both ends included. */
  randint(a: number, b: number): number {
    return a + this.#below(b - a + 1);
  }

  choice<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("cannot choose from an empty sequence");
    return items[this.#below(items.length)] as T;
  }

  /** One weighted draw: CPython's `choices(items, weights)[0]`. */
  weightedChoice<T>(items: readonly T[], weights: readonly number[]): T {
    if (weights.length !== items.length) throw new RangeError("the number of weights does not match the items");
    const cumulative: number[] = [];
    let running = 0;
    for (const weight of weights) cumulative.push((running += weight));
    const total = running;
    if (!(total > 0) || !Number.isFinite(total)) throw new RangeError("total of weights must be positive and finite");
    const x = this.random() * total;
    // bisect_right over cumulative[0 .. n-1)
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x < (cumulative[mid] as number)) hi = mid;
      else lo = mid + 1;
    }
    return items[lo] as T;
  }

  /** Shuffle in place (Fisher-Yates, from the end). */
  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.#below(i + 1);
      [items[i], items[j]] = [items[j] as T, items[i] as T];
    }
  }

  /** `k` distinct items, in selection order. */
  sample<T>(items: readonly T[], k: number): T[] {
    const n = items.length;
    if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError("sample larger than population or is negative");
    let setSize = 21;
    if (k > 5) setSize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    const result: T[] = [];
    if (n <= setSize) {
      const pool = [...items];
      for (let i = 0; i < k; i++) {
        const j = this.#below(n - i);
        result.push(pool[j] as T);
        pool[j] = pool[n - i - 1] as T;
      }
    } else {
      const selected = new Set<number>();
      for (let i = 0; i < k; i++) {
        let j = this.#below(n);
        while (selected.has(j)) j = this.#below(n);
        selected.add(j);
        result.push(items[j] as T);
      }
    }
    return result;
  }

  /** An integer in [0, n), by rejection sampling on the fewest bits that can hold n. */
  #below(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) throw new RangeError(`empty or unsupported range: ${n}`);
    const shift = Math.clz32(n); // 32 - bit length
    let r = this.#next() >>> shift;
    while (r >= n) r = this.#next() >>> shift;
    return r;
  }

  #next(): number {
    const mt = this.#state;
    if (this.#index >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = ((mt[kk] as number) & UPPER_MASK) | ((mt[kk + 1] as number) & LOWER_MASK);
        mt[kk] = (mt[kk + M] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = ((mt[kk] as number) & UPPER_MASK) | ((mt[kk + 1] as number) & LOWER_MASK);
        mt[kk] = (mt[kk + M - N] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      }
      const y = ((mt[N - 1] as number) & UPPER_MASK) | ((mt[0] as number) & LOWER_MASK);
      mt[N - 1] = (mt[M - 1] as number) ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
      this.#index = 0;
    }
    let y = mt[this.#index++] as number;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  #seedByArray(key: readonly number[]): void {
    const mt = this.#state;
    mt[0] = 19650218;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] as number;
      mt[i] = Math.imul(1812433253, prev ^ (prev >>> 30)) + i;
    }
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1] as number;
      mt[i] = (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1664525)) >>> 0) + (key[j] as number) + j;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1] as number;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1] as number;
      mt[i] = (((mt[i] as number) ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) >>> 0) - i;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1] as number;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
    this.#index = N;
  }
}

/** A non-negative integer as 32-bit words, least significant first, as CPython seeds from it. */
function words(n: number): number[] {
  const out: number[] = [];
  do {
    out.push(n % 2 ** 32);
    n = Math.floor(n / 2 ** 32);
  } while (n > 0);
  return out;
}
