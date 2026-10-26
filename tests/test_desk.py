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


class GridTests(unittest.TestCase):
    def test_round_trip_earns_step_minus_fees(self):
        from desk.grid import Grid
        g = Grid(100.0, 1.0, n=2, lot_usd=100.0)
        g.on_price(100.5, 99.5)    # falls through 100 -> buy
        g.on_price(99.5, 100.5)    # rises through 100 -> sell the lot bought at 99? no: lot at level 100 sells at 101
        self.assertEqual(g.round_trips, 0)
        g.on_price(100.5, 101.5)   # rises through 101 -> sell
        self.assertEqual(g.round_trips, 1)
        self.assertGreater(g.realized, 0)

    def test_pause_blocks_new_buys(self):
        from desk.grid import Grid
        g = Grid(100.0, 1.0, n=2)
        g.on_price(100.5, 99.5, quote=False)
        self.assertEqual(g.lots, {})

    def test_stop_flattens_and_halts(self):
        from desk.grid import Grid
        g = Grid(100.0, 1.0, n=2)
        g.on_price(100.5, 99.5)
        g.stop(95.0)
        self.assertEqual((g.lots, g.active), ({}, False))
        self.assertLess(g.realized, 0)

    def test_range_guard(self):
        from desk.risk import range_guard
        self.assertTrue(range_guard(97.0, 98.0, 102.0))
        self.assertFalse(range_guard(100.0, 98.0, 102.0))

    def test_judge_variant_not_worse_than_unprotected(self):
        from desk.run_house import simulate_house
        self.assertGreaterEqual(simulate_house("judge")[0], simulate_house("none")[0])


class ReplayTests(unittest.TestCase):
    def test_csv_roundtrip_matches_live_generator(self):
        import os, tempfile
        from desk.replay import write_csv, ticks_from_csv
        from desk.run import gen_ticks, run_gambler
        from desk.logs import Log
        d = tempfile.mkdtemp(); p = os.path.join(d, "t.csv")
        write_csv(p, gen_ticks(500))
        a = run_gambler(ticks_from_csv(p), "paper", log=Log(os.path.join(d, "a.jsonl")))
        b = run_gambler(gen_ticks(500), "paper", log=Log(os.path.join(d, "b.jsonl")))
        self.assertAlmostEqual(a, b, places=6)

    def test_bad_row_rejected(self):
        import os, tempfile
        from desk.replay import ticks_from_csv
        p = os.path.join(tempfile.mkdtemp(), "bad.csv")
        open(p, "w").write("mid,spread,bid_size,ask_size\n100,0.03,nan,5\n")
        with self.assertRaises(ValueError):
            list(ticks_from_csv(p))

    def test_empty_stream_is_safe(self):
        from desk.run import run_gambler
        from desk.run_house import run_house
        import os, tempfile
        from desk.logs import Log
        self.assertEqual(run_gambler(iter([]), log=Log(os.path.join(tempfile.mkdtemp(), "x"))), 0.0)
        self.assertEqual(run_house(iter([]))[0], 0.0)
