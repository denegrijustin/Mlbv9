"""Paper grid: one lot per level. Price falling through a level buys it; rising through the next sells it."""


class Grid:
    def __init__(self, center, step, n=3, lot_usd=100.0, fee_bps=5.0):
        self.levels = [center + step * k for k in range(-n, n + 1)]
        self.low, self.high, self.step = self.levels[0], self.levels[-1], step
        self.lot_usd, self.fee = lot_usd, fee_bps / 1e4
        self.lots: dict[int, float] = {}   # level index -> qty held
        self.realized, self.round_trips, self.active = 0.0, 0, True

    def _fee(self, usd):
        return usd * self.fee

    def on_price(self, prev, price, quote=True):
        """quote=False pauses new buys; existing lots can still sell."""
        if not self.active:
            return
        for i, lv in enumerate(self.levels):
            if quote and i < len(self.levels) - 1 and prev > lv >= price and i not in self.lots:
                self.lots[i] = self.lot_usd / lv
                self.realized -= self._fee(self.lot_usd)
            elif i > 0 and prev < lv <= price and (i - 1) in self.lots:
                q = self.lots.pop(i - 1)
                self.realized += q * (lv - self.levels[i - 1]) - self._fee(q * lv)
                self.round_trips += 1

    def flatten(self, price):
        for i, q in list(self.lots.items()):
            self.realized += q * (price - self.levels[i]) - self._fee(q * price)
        self.lots.clear()

    def stop(self, price):
        self.flatten(price)
        self.active = False

    def equity(self, price):
        return self.realized + sum(q * (price - self.levels[i]) for i, q in self.lots.items())
