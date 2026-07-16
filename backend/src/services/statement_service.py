# backend/src/services/statement_service.py
"""
PDF Statement Extractor.
Sections: FUTURE CONFIRMATIONS, PURCHASE & SALE
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


class StatementParser:

    def __init__(self):
        self._reset()

    def _reset(self):
        self.trade_date = None
        self.client     = None
        self.account    = None
        self._conf = {}
        self._pnl  = {}
        self._current_section = None
        self._current_product = None

    def parse(self, pdf_path):
        self._reset()
        with pdfplumber.open(str(pdf_path)) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                self._parse_header(text)
                self._parse_page(text)
        return self._build_output()

    def _parse_header(self, text):
        if self.trade_date:
            return
        for line in text.splitlines():
            if line.startswith("Trade Date"):
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
                if m and not self.client:
                    self.client = m.group(1)
            elif line.startswith("Account"):
                m = re.search(r":\s*(\S+)", line)
                if m and not self.account:
                    self.account = m.group(1)

    def _parse_page(self, text):
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
                self._handle_conf_line(line)
            elif self._current_section == "PNL":
                self._handle_pnl_line(line)
            i += 1

    def _handle_conf_line(self, line):
        if re.match(r"^\d{2}-[A-Za-z]{3}-\d{4}", line):
            prod = self._extract_product_from_trade_row(line)
            if prod:
                self._current_product = prod
                if prod not in self._conf:
                    self._conf[prod] = {"long": 0, "short": 0, "comm": None, "mkt": None, "nfa": None, "ccy": None}
            return

        m = _RE_TOTAL_LINE.match(line)
        if m and self._current_product:
            prod = self._current_product
            if prod not in self._conf:
                self._conf[prod] = {"long": 0, "short": 0, "comm": None, "mkt": None, "nfa": None, "ccy": None}

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

            self._conf[prod]["long"]  += longs
            self._conf[prod]["short"] += shorts
            if self._conf[prod]["ccy"] is None:
                self._conf[prod]["ccy"] = ccy
            if label:
                self._apply_fee(prod, label, amount)
            return

        m2 = _RE_FEE_LINE.match(line)
        if m2 and self._current_product:
            self._apply_fee(self._current_product, m2.group(1), _parse_number(m2.group(3)))

    def _apply_fee(self, prod, label, amount):
        rec = self._conf.setdefault(prod, {"long": 0, "short": 0, "comm": None, "mkt": None, "nfa": None, "ccy": None})
        if label == "Commission fees":
            rec["comm"] = (rec["comm"] or 0) + amount
        elif label == "Market fees":
            rec["mkt"] = (rec["mkt"] or 0) + amount
        elif label == "NFA fees":
            rec["nfa"] = (rec["nfa"] or 0) + amount

    def _handle_pnl_line(self, line):
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
                if prod not in self._pnl:
                    self._pnl[prod] = {"pnl": 0.0, "ccy": ccy}
                self._pnl[prod]["pnl"] += amount
                if self._pnl[prod]["ccy"] is None:
                    self._pnl[prod]["ccy"] = ccy

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
        rows = []
        for prod in self._conf:
            conf    = self._conf[prod]
            pnl_rec = self._pnl.get(prod, {})
            # P&S currency is authoritative (Nikkei: P&L=JPY, fees=USD → use JPY)
            # Fall back to CONF fee currency for open positions with no P&S entry
            ccy = pnl_rec.get("ccy") or conf["ccy"]
            rows.append({
                "trade_date":       self.trade_date or "",
                "delivery_product": prod,
                "long":             conf["long"],
                "short":            conf["short"],
                "realized_pnl":     pnl_rec.get("pnl"),
                "commission_fees":  conf["comm"],
                "market_fees":      conf["mkt"],
                "nfa_fees":         conf["nfa"],
                "currency":         ccy,
            })
        return {
            "trade_date": self.trade_date,
            "client":     self.client,
            "account":    self.account,
            "rows":       rows,
        }


def extract_statement(pdf_path):
    return StatementParser().parse(pdf_path)
