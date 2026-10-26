import unittest
from desk.state import Tape
from desk.risk import RiskEngine, Limits, exit_reason
from desk.run import simulate


def tape(n=60, mid=100.0, size=100.0):
    t = Tape()
    for _ in range(n):
        t.push(mid, 0.03, size, size)
    return t


class ExitTests(unittest.TestCase):
    def test_no_data_closes(self):
        self.assertEqual(exit_reason(Tape(), 100.0), "no_data")

    def test_stop(self):
        t = tape(); t.push(99.0, 0.03, 100, 100)
        self.assertEqual(exit_reason(t, 100.0), "stop")

    def test_liquidity_collapse(self):
        t = tape()
        for _ in range(6): t.push(100.0, 0.03, 1, 1)
        self.assertEqual(exit_reason(t, 100.0), "liquidity_collapse")

    def test_hold(self):
        self.assertIsNone(exit_reason(tape(), 100.0))


class RiskTests(unittest.TestCase):
    def base(self, **kw):
        a = dict(notional=500, leverage=1, daily_pnl=0, expected_edge_bps=25, model_version="mock-0.1")
        a.update(kw); return RiskEngine(Limits()).check(**a)

    def test_ok(self): self.assertIsNone(self.base())
    def test_version(self): self.assertEqual(self.base(model_version="x"), "model_version_mismatch")
    def test_economics(self): self.assertEqual(self.base(expected_edge_bps=5), "economics")
    def test_leverage(self): self.assertEqual(self.base(leverage=5), "leverage_cap")
    def test_loss_halt_latches(self):
        r = RiskEngine(Limits())
        self.assertEqual(r.check(notional=1, leverage=1, daily_pnl=-60, expected_edge_bps=99, model_version="mock-0.1"), "daily_loss_halt")
        self.assertEqual(r.check(notional=1, leverage=1, daily_pnl=0, expected_edge_bps=99, model_version="mock-0.1"), "daily_loss_halt")


class SimTests(unittest.TestCase):
    def test_shadow_never_trades(self):
        self.assertEqual(simulate("shadow", 400), 0.0)


if __name__ == "__main__":
    unittest.main()
