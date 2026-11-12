"""A ledger every model call charges, so each pipeline's running cost sits next to its accuracy."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Charge:
    stage: str
    model: str
    input_tokens: int
    output_tokens: int
    usd: float


@dataclass
class Ledger:
    charges: list[Charge] = field(default_factory=list)

    def charge(self, stage: str, model: str, input_tokens: int, output_tokens: int, usd: float) -> None:
        self.charges.append(Charge(stage, model, input_tokens, output_tokens, usd))

    @property
    def usd(self) -> float:
        return sum(c.usd for c in self.charges)

    @property
    def calls(self) -> int:
        return len(self.charges)
