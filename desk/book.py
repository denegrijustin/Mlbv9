"""One open position at a time; bench rejected candidates, with the reason setting the duration."""
BENCH_SECONDS = {"honeypot": float("inf"), "mint_open": float("inf"), "too_early": 20 * 60, "low_liquidity": 3600}


class Book:
    def __init__(self):
        self.position = None
        self.bench: dict[str, tuple[str, float]] = {}

    def can_scan(self) -> bool:
        return self.position is None  # no scan while a position is open

    def bench_add(self, key, reason, now):
        self.bench[key] = (reason, now + BENCH_SECONDS.get(reason, 3600))

    def benched(self, key, now) -> bool:
        e = self.bench.get(key)
        return bool(e and now < e[1])
