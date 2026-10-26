"""Paper broker only. Same interface a live broker would expose; there is no live implementation."""


class PaperBroker:
    def __init__(self, fee_bps=5.0):
        self.fee_bps, self.cash_pnl, self.qty, self.entry, self.entry_fees = fee_bps, 0.0, 0.0, 0.0, 0.0

    def buy(self, price, notional):
        q = notional / price
        self.cash_pnl -= notional * self.fee_bps / 1e4
        self.entry_fees += notional * self.fee_bps / 1e4
        self.entry = (self.entry * self.qty + price * q) / (self.qty + q)
        self.qty += q
        return {"side": "buy", "price": price, "qty": q}

    def close(self, price):
        if not self.qty:
            return None
        pnl = (price - self.entry) * self.qty - price * self.qty * self.fee_bps / 1e4
        self.cash_pnl += (price - self.entry) * self.qty - price * self.qty * self.fee_bps / 1e4
        fill = {"side": "sell", "price": price, "qty": self.qty, "pnl": pnl, "net": pnl - self.entry_fees}
        self.qty, self.entry, self.entry_fees = 0.0, 0.0, 0.0
        return fill

    def equity(self, price):
        return self.cash_pnl + (price - self.entry) * self.qty
