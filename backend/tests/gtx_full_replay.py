# backend/tests/gtx_full_replay.py
"""
Full-history GlobalGTX regression (2026-11-27) — READ ONLY, writes nothing.

Replays EVERY saved statement (all books: USD / EUR / GBP) through the
engine in this working copy and prints each day's checks. Run before any
engine push: every day must stay ✓ (a day that was red before the change
must be explained, never new reds).

Sources (pick one):
  python tests\\gtx_full_replay.py                  # live: gtx_statements + gtx_settings via backend/.env
  python tests\\gtx_full_replay.py --csv FILE       # Supabase table export (gtx_statements_rows.csv)
Extra, not-yet-saved statements (preview several days in order):
  ... --add 2026-11-25=path\\to\\stmt.txt --add 2026-11-26=path\\to\\stmt.txt
Options: --settings FILE.json (gtx_settings export; CSV mode default = code defaults)
         --days N  (print only the last N days per book; checks still cover all)
Exit code 1 if any day fails.
"""
import argparse, csv, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
csv.field_size_limit(10_000_000)


def load_rows(args) -> tuple[list[dict], dict]:
    from src.services.gtx_engine import DEFAULT_SETTINGS
    if args.csv:
        with open(args.csv, newline="", encoding="utf-8") as f:
            rows = [{"stmt_date": r["stmt_date"], "raw_text": r["raw_text"]} for r in csv.DictReader(f)]
        settings = dict(DEFAULT_SETTINGS)
        if args.settings:
            with open(args.settings, encoding="utf-8") as f:
                settings.update(json.load(f))
        return rows, settings
    from dotenv import load_dotenv
    load_dotenv()
    from src.services import gtx_service as svc
    rows = svc.list_statements()
    full = [svc.get_statement_raw(r["id"]) for r in rows]
    return [{"stmt_date": r["stmt_date"], "raw_text": r["raw_text"]} for r in full], svc.get_settings()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv"); ap.add_argument("--settings")
    ap.add_argument("--add", action="append", default=[])
    ap.add_argument("--days", type=int, default=0)
    args = ap.parse_args()
    from src.services.gtx_books import replay_books

    rows, settings = load_rows(args)
    have = {r["stmt_date"] for r in rows}
    for a in args.add:
        d, path = a.split("=", 1)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        rows = [r for r in rows if r["stmt_date"] != d] + [{"stmt_date": d, "raw_text": text}]
        print(f"+ {d} from {path}{' (replaces saved)' if d in have else ''}")
    res = replay_books([{"date": r["stmt_date"], "text": r["raw_text"]} for r in rows], settings)

    bad = 0
    for b in res["books"]:
        log = b["recon_log"]
        fails = [x for x in log if not x["ok"]]
        bad += len(fails)
        print(f"\n== {b['ccy']} book: {len(log)} statements · {len(fails)} mismatch ==")
        show = log[-args.days:] if args.days else log
        for x in show:
            flag = "✓" if x["ok"] else "✗ " + ",".join(k for k, v in x["checks"].items() if not v)
            notes = "; ".join(x.get("corrections") or [])
            print(f"  {x['date']}  bal {x['stmt_balance']:>15,.2f}  Δ{x['balance_diff']:+9.2f}  "
                  f"real {x['stmt_realised']:>12,.2f}  fees {x['fees']:>10,.2f}  swaps {x['swaps']:>9,.2f}  "
                  f"booked {x.get('booked_net', 0):>11,.2f}  {flag}" + (f"  [{notes}]" if notes else ""))
        if fails and args.days:
            print("  failures outside the window: " + ", ".join(x["date"] for x in fails if x not in show))
        booked = [(d["date"], d["net_display"]) for d in b.get("booked") or []][-6:]
        print(f"  booked (latest): {booked}")
    print("\nALL DAYS RECONCILE ✓" if not bad else f"\n{bad} DAY(S) MISMATCH ✗")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
