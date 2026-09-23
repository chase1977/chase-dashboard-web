# backend/src/services/statement_service.py
"""
PDF Statement Extractor.
Sections: FUTURE CONFIRMATIONS, PURCHASE & SALE

Multi-account fix (2026-09-23): a single "Daily Detail Statement" PDF can
contain MULTIPLE accounts under one Client id (e.g. Client 4751R -> Accounts
47511, 47512, 47513, 47514, 47515...), each account's pages grouped together
sequentially, each starting with its own FINANCIAL SUMMARY page carrying its
own Client/Account/Trade Date header block. EVERY page repeats this header,
so it's used to detect account boundaries directly rather than trusting page
order: rows are segmented per (client, account) pair, each with its own
isolated product/fee accumulator, so an instrument traded under TWO
different accounts on the same day (common -- same underlying, different
books, confirmed in a real 4751R statement where crude/gasoil/brent appear
on both 47511 and 47514) is never summed together. Previously the parser
locked onto the FIRST Client/Account it saw and accumulated every
subsequent page's trades into that one account -- silently double/multi
-counting across accounts. See README for the full writeup.
"""

import re
from datetime import datetime
import pdfplumber

_SEC_FUTURE  = "FUTURE CONFIRMATIONS"
_SEC_PNL     = "PURCHASE & SALE"
_SEC_SUMMARY = "FINANCIAL SUMMARY"
_SEC_RECAP   = "RECAP OF CONFIRMATION ACTIVITY"

# Supports both "Total 8 8 ..." (balanced) and "Total 17 ..." (one-sided open position)
_RE_TOTAL_LINE = re.compile(
    r"Total\s+(\d+)(?:\s+(\d+))?"
    r"(?:\s+(Commission fees|Market fees|NFA fees|Realized P/L))?"
    r"\s+([A-Z]+)\s+([-\d,.]+)"
)

_RE_FEE_LINE = re.compile(
    r"^(Commission fees|Market fees|NFA fees|Realized P/L)\s+([A-Z]+)\s+([-\d,.]+)$"
)


def _parse_number(s):
    return float(s.strip().replace(",", ""))


def _empty_book():
    return {"conf": {}, "pnl": {}}


class StatementParser:

    def __init__(self):
        self._reset()

    def _reset(self):
        self.trade_date = None
        self._books: dict = {}          # (client, account) -> {"conf": {...}, "pnl": {...}}
        self._order: list = []          # (client, account) pairs, first-seen order
        self._current_key = None        # (client, account) currently being accumulated into
        self._current_section = None    # "CONF" | "PNL" | None
        self._current_product = None

    def parse(self, pdf_path):
        self._reset()
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                self._parse_page_header(text)
                self._parse_page_body(text)
        return self._build_output()

    def _parse_page_header(self, text):
        """
        Every page carries Report/Trade Date/Client/Account. Trade Date is
        the same for the whole statement (one daily-detail run) so it's only
        captured once. Client/Account are re-read on EVERY page -- if the
        pair differs from what we were previously accumulating into, that's
        a new account block starting; switch books and reset section/product
        state so nothing bleeds across the boundary. A page missing one of
        the two fields (shouldn't happen given the real statements, but kept
        defensive) carries forward whichever half is still unknown rather
        than dropping the page.
        """
        client = account = None
        for line in text.splitlines():
            if line.startswith("Trade Date") and self.trade_date is None:
                parts = line.split(":", 1)
                if len(parts) == 2:
                    raw = parts[1].strip()
                    raw = re.sub(r"^[A-Za-z]+,\s*", "", raw)
                    try:
                        self.trade_date = datetime.strptime(raw, "%d %b %Y").strftime("%Y-%m-%d")
                    except ValueError:
                        self.trade_date = raw
            elif line.startswith("Client"):
                m = re.search(r":\s*(\S+)", line)
                if m:
                    client = m.group(1)
            elif line.startswith("Account"):
                m = re.search(r":\s*(\S+)", line)
                if m:
                    account = m.group(1)

        if client is None and account is None:
            return  # continuation page with no header block at all -- keep current key

        prev = self._current_key or (None, None)
        key = (client or prev[0], account or prev[1])

        if key != self._current_key:
            self._current_key = key
            if key not in self._books:
                self._books[key] = _empty_book()
                self._order.append(key)
            self._current_section = None
            self._current_product = None

    def _parse_page_body(self, text):
        if self._current_key is None:
            return
        book = self._books[self._current_key]
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if _SEC_FUTURE in line:
                if self._current_section != "CONF":
                    self._current_product = None
                self._current_section = "CONF"
                i += 1; continue
            if _SEC_PNL in line:
                if self._current_section != "PNL":
                    self._current_product = None
                self._current_section = "PNL"
                i += 1; continue
            if _SEC_SUMMARY in line or _SEC_RECAP in line:
                self._current_section = None
                i += 1; continue
            if line.startswith("Trade Date") and "Long" in line:
                i += 1; continue
            if self._current_section == "CONF":
                self._handle_conf_line(book, line)
            elif self._current_section == "PNL":
                self._handle_pnl_line(book, line)
            i += 1

    def _handle_conf_line(self, book, line):
        conf = book["conf"]
        if re.match(r"^\d{2}-[A-Za-z]{3}-\d{4}", line):
            prod = self._extract_product_from_trade_row(line)
            if prod:
                self._current_product = prod
                if prod not in conf:
                    conf[prod] = {"long": 0, "short": 0, "comm": None, "mkt": None, "nfa": None, "ccy": None}
            return

        m = _RE_TOTAL_LINE.match(line)
        if m and self._current_product:
            prod = self._current_product
            if prod not in conf:
                conf[prod] = {"long": 0, "short": 0, "comm": None, "mkt": None, "nfa": None, "ccy": None}

            first  = int(m.group(1))
            second = m.group(2)
            label  = m.group(3)
            ccy    = m.group(4)
            amount = _parse_number(m.group(5))

            if second is not None:
                longs  = first
                shorts = int(second)
            else:
                # One-sided open position (e.g. "Total 17 Commission fees USD -3.74")
                # Convention: treat as short
                longs  = 0
                shorts = first

            conf[prod]["long"]  += longs
            conf[prod]["short"] += shorts
            if conf[prod]["ccy"] is None:
                conf[prod]["ccy"] = ccy
            if label:
                self._apply_fee(conf, prod, label, amount)
            return

        m2 = _RE_FEE_LINE.match(line)
        if m2 and self._current_product:
            self._apply_fee(conf, self._current_product, m2.group(1), _parse_number(m2.group(3)))

    def _apply_fee(self, conf, prod, label, amount):
        rec = conf.setdefault(prod, {"long": 0, "short": 0, "comm": None, "mkt": None, "nfa": None, "ccy": None})
        if label == "Commission fees":
            rec["comm"] = (rec["comm"] or 0) + amount
        elif label == "Market fees":
            rec["mkt"] = (rec["mkt"] or 0) + amount
        elif label == "NFA fees":
            rec["nfa"] = (rec["nfa"] or 0) + amount

    def _handle_pnl_line(self, book, line):
        pnl = book["pnl"]
        if re.match(r"^\d{2}-[A-Za-z]{3}-\d{4}", line):
            prod = self._extract_product_from_trade_row(line)
            if prod:
                self._current_product = prod
            return

        m = _RE_TOTAL_LINE.match(line)
        if m and self._current_product:
            if m.group(3) == "Realized P/L":
                ccy    = m.group(4)
                amount = _parse_number(m.group(5))
                prod   = self._current_product
                if prod not in pnl:
                    pnl[prod] = {"pnl": 0.0, "ccy": ccy}
                pnl[prod]["pnl"] += amount
                if pnl[prod]["ccy"] is None:
                    pnl[prod]["ccy"] = ccy

    def _extract_product_from_trade_row(self, line):
        parts = line.split(None, 2)
        if len(parts) < 3:
            return None
        m = re.search(r"\S+\s*:\s*\S+\s+(.+)", parts[2])
        if not m:
            return None
        tokens = m.group(1).split()
        fut_idx = next((i for i, t in enumerate(tokens) if t.startswith("FUT-T-T")), None)
        if fut_idx is not None and fut_idx > 0:
            product_tokens = tokens[:fut_idx - 1]
        else:
            product_tokens = list(tokens)
            while product_tokens and re.match(r"^[-\d,.'`]+$", product_tokens[-1]):
                product_tokens.pop()
        return " ".join(product_tokens) if product_tokens else None

    def _build_output(self):
        accounts_out = []
        all_rows = []
        for key in self._order:
            client, account = key
            book = self._books[key]
            conf, pnl = book["conf"], book["pnl"]
            rows = []
            for prod in conf:
                c       = conf[prod]
                pnl_rec = pnl.get(prod, {})
                # P&S currency is authoritative (Nikkei-style: P&L=JPY, fees=USD -> use JPY)
                # Fall back to CONF fee currency for open positions with no P&S entry
                ccy = pnl_rec.get("ccy") or c["ccy"]
                row = {
                    "trade_date":       self.trade_date or "",
                    "client":           client or "",
                    "account":          account or "",
                    "delivery_product": prod,
                    "long":             c["long"],
                    "short":            c["short"],
                    "realized_pnl":     pnl_rec.get("pnl"),
                    "commission_fees":  c["comm"],
                    "market_fees":      c["mkt"],
                    "nfa_fees":         c["nfa"],
                    "currency":         ccy,
                }
                rows.append(row)
                all_rows.append(row)
            accounts_out.append({
                "client":     client,
                "account":    account,
                "trade_date": self.trade_date,
                "row_count":  len(rows),
                "currencies": sorted({r["currency"] for r in rows if r["currency"]}),
            })

        first_key = self._order[0] if self._order else (None, None)
        return {
            "trade_date": self.trade_date,
            # Backward-compat top-level client/account = the FIRST account
            # block seen in this PDF -- callers that need every account must
            # read `accounts` / the per-row `client`+`account` fields below.
            "client":     first_key[0],
            "account":    first_key[1],
            "rows":       all_rows,      # every account's rows, each tagged client+account
            "accounts":   accounts_out,  # per-account breakdown for the account picker UI
        }


def extract_statement(pdf_path):
    return StatementParser().parse(pdf_path)
