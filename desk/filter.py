"""The funnel: cheapest check first. Facts kill in code before any judgment is requested."""
from .book import Book


def funnel(candidates, book: Book, now, log, judge_check):
    """candidates: dicts with id, liquidity, honeypot, mint_open, age_s. judge_check(c)->bool is the costly step."""
    survivors = []
    for c in candidates:
        if book.benched(c["id"], now):
            log("reject", id=c["id"], check="benched")
        elif c.get("honeypot"):
            book.bench_add(c["id"], "honeypot", now); log("reject", id=c["id"], check="honeypot")
        elif c.get("mint_open"):
            book.bench_add(c["id"], "mint_open", now); log("reject", id=c["id"], check="mint_open")
        elif c["age_s"] < 300:
            book.bench_add(c["id"], "too_early", now); log("reject", id=c["id"], check="too_early")
        elif c["liquidity"] < 10_000:
            book.bench_add(c["id"], "low_liquidity", now); log("reject", id=c["id"], check="low_liquidity")
        else:
            survivors.append(c)
    return [c for c in survivors if judge_check(c)][:1]  # one final pick
