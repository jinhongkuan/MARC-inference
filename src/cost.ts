/** A ledger every model call charges, so each pipeline's running cost sits next to its accuracy. */

import { sum } from "./numeric.ts";

export interface Charge {
  readonly stage: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly usd: number;
}

export class Ledger {
  readonly #charges: Charge[] = [];

  charge(charge: Charge): void {
    this.#charges.push(charge);
  }

  get charges(): readonly Charge[] {
    return this.#charges;
  }

  get usd(): number {
    return sum(this.#charges.map((c) => c.usd));
  }

  get calls(): number {
    return this.#charges.length;
  }
}
