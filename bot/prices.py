"""Shared crypto price fetching with source fallback (stdlib only).

Sources, tried in order per coin:
  1. Kraken public API          (primary)
  2. Coinbase Exchange public API (secondary)
  3. CoinGecko keyless API       (last resort; sends x-cg-demo-api-key if
                                  COINGECKO_API_KEY is set)

If a source fails or doesn't list a coin, the next source fills in only the
coins that are still missing. Each HTTP request is retried once after a short
backoff. A RuntimeError is raised only when some coin can't be fetched from
any source. The source serving each coin is logged to stderr.

Coins are identified by CoinGecko ids (e.g. "bitcoin") so callers and state
files stay unchanged.

24h change: Kraken's Ticker `o` is today's (UTC midnight) open, not a 24h
value, so for Kraken the 24h reference price is taken from OHLC interval=5
(the 5-minute candle covering exactly now-24h). Coinbase uses /stats, whose
`open` is the rolling-24h open. High/low are rolling 24h on both.

Public API:
    get_prices(ids)              -> {id: usd_price}
    get_markets(ids)             -> list shaped like CoinGecko coins/markets
    get_daily_history(id, days)  -> [(ms_ts, close_usd), ...] oldest first
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "kinecta-crypto-bots/1.0 (+prices.py)"
TIMEOUT = 20
RETRY_BACKOFF_S = 2.0

KRAKEN = "https://api.kraken.com/0/public"
COINBASE = "https://api.exchange.coinbase.com"
COINGECKO = "https://api.coingecko.com/api/v3"

# CoinGecko id -> metadata. kraken = (request pair, response key);
# coinbase = product id or None if not listed.
COINS = {
    "bitcoin": {"symbol": "btc", "name": "Bitcoin",
                "kraken": ("XBTUSD", "XXBTZUSD"), "coinbase": "BTC-USD"},
    "ethereum": {"symbol": "eth", "name": "Ethereum",
                 "kraken": ("ETHUSD", "XETHZUSD"), "coinbase": "ETH-USD"},
    "ripple": {"symbol": "xrp", "name": "XRP",
               "kraken": ("XRPUSD", "XXRPZUSD"), "coinbase": "XRP-USD"},
    "bitcoin-cash": {"symbol": "bch", "name": "Bitcoin Cash",
                     "kraken": ("BCHUSD", "BCHUSD"), "coinbase": "BCH-USD"},
    "kaspa": {"symbol": "kas", "name": "Kaspa",
              "kraken": ("KASUSD", "KASUSD"), "coinbase": None},
}

# Which source served each coin on the most recent call (for callers/logs).
last_sources = {}


def _log(msg):
    print(f"[prices] {msg}", file=sys.stderr, flush=True)


def _norm_ids(ids):
    if isinstance(ids, str):
        ids = ids.split(",")
    out = []
    for i in ids:
        i = i.strip()
        if i and i not in out:
            out.append(i)
    return out


def _get_json(url, headers=None):
    """GET url -> parsed JSON, retrying once after a short backoff."""
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    hdrs.update(headers or {})
    last_err = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, OSError, ValueError) as e:
            last_err = e
            if attempt == 0:
                time.sleep(RETRY_BACKOFF_S)
    raise last_err


# ---------------------------------------------------------------- Kraken

def _kraken(method, **params):
    url = f"{KRAKEN}/{method}?{urllib.parse.urlencode(params)}"
    data = _get_json(url)
    if data.get("error"):
        raise RuntimeError(f"Kraken {method} error: {data['error']}")
    return data["result"]


def _kraken_pick(result, cid):
    """Find a coin's entry in a Kraken result keyed by pair name."""
    pair, key = COINS[cid]["kraken"]
    if key in result:
        return result[key]
    if pair in result:
        return result[pair]
    raise KeyError(f"Kraken result missing {key}")


def _kraken_ticker(ids):
    ids = [c for c in ids if c in COINS and COINS[c]["kraken"]]
    if not ids:
        return {}
    pairs = ",".join(COINS[c]["kraken"][0] for c in ids)
    res = _kraken("Ticker", pair=pairs)
    out = {}
    for c in ids:
        try:
            out[c] = _kraken_pick(res, c)
        except KeyError:
            pass
    return out


def _kraken_ohlc(cid, interval):
    res = _kraken("OHLC", pair=COINS[cid]["kraken"][0], interval=interval)
    rows = _kraken_pick(res, cid)
    # [time, open, high, low, close, vwap, volume, count], oldest first
    return rows


def _kraken_prices(ids):
    return {c: float(t["c"][0]) for c, t in _kraken_ticker(ids).items()}


def _kraken_price_24h_ago(cid, now):
    interval = 5  # minutes; 720 candles = 60h of history
    rows = _kraken_ohlc(cid, interval)
    target = now - 86400
    ref = None
    for row in rows:
        start = int(row[0])
        if start > target:
            break
        # candle covering `target` -> its open; fully-past candle -> close
        ref = float(row[1]) if start + interval * 60 > target else float(row[4])
    if ref is None:
        raise RuntimeError(f"Kraken OHLC lacks data 24h back for {cid}")
    return ref


def _kraken_markets(ids):
    tick = _kraken_ticker(ids)
    now = time.time()
    out = {}
    for c, t in tick.items():
        try:
            ref = _kraken_price_24h_ago(c, now)
        except Exception as e:
            _log(f"Kraken 24h reference failed for {c}: {e}")
            continue
        last = float(t["c"][0])
        out[c] = _market_row(c, last, ref, float(t["h"][1]), float(t["l"][1]))
    return out


def _kraken_history(cid, days):
    if cid not in COINS or not COINS[cid]["kraken"]:
        return None
    rows = _kraken_ohlc(cid, 1440)
    want = days + 1
    # Kraken returns at most ~720 daily candles; if capped and short, let a
    # source with deeper history try instead.
    if len(rows) < want and len(rows) >= 720:
        raise RuntimeError(f"Kraken daily history capped at {len(rows)} days")
    return [(int(r[0]) * 1000, float(r[4])) for r in rows[-want:]]


# -------------------------------------------------------------- Coinbase

def _cb_product(cid):
    return COINS.get(cid, {}).get("coinbase")


def _coinbase_prices(ids):
    out = {}
    for c in ids:
        prod = _cb_product(c)
        if not prod:
            continue
        try:
            t = _get_json(f"{COINBASE}/products/{prod}/ticker")
            out[c] = float(t["price"])
        except Exception as e:
            _log(f"Coinbase ticker failed for {c}: {e}")
    return out


def _coinbase_markets(ids):
    out = {}
    for c in ids:
        prod = _cb_product(c)
        if not prod:
            continue
        try:
            s = _get_json(f"{COINBASE}/products/{prod}/stats")
            out[c] = _market_row(c, float(s["last"]), float(s["open"]),
                                 float(s["high"]), float(s["low"]))
        except Exception as e:
            _log(f"Coinbase stats failed for {c}: {e}")
    return out


def _coinbase_history(cid, days):
    prod = _cb_product(cid)
    if not prod:
        return None
    want = days + 1
    by_ts = {}
    end = int(time.time())
    # max 300 candles per request; page backwards until we have enough
    while len(by_ts) < want:
        start = end - 299 * 86400
        q = urllib.parse.urlencode({
            "granularity": 86400,
            "start": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(start)),
            "end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(end)),
        })
        rows = _get_json(f"{COINBASE}/products/{prod}/candles?{q}")
        if not rows:
            break
        # [time, low, high, open, close, volume], newest first
        for r in rows:
            by_ts[int(r[0])] = float(r[4])
        end = min(int(r[0]) for r in rows) - 86400
    pts = sorted(by_ts.items())[-want:]
    return [(ts * 1000, p) for ts, p in pts]


# ------------------------------------------------------------- CoinGecko

def _cg_headers():
    key = os.environ.get("COINGECKO_API_KEY")
    return {"x-cg-demo-api-key": key} if key else {}


def _coingecko_prices(ids):
    q = urllib.parse.urlencode({"ids": ",".join(ids), "vs_currencies": "usd"})
    data = _get_json(f"{COINGECKO}/simple/price?{q}", _cg_headers())
    return {k: float(v["usd"]) for k, v in data.items() if "usd" in v}


def _coingecko_markets(ids):
    q = urllib.parse.urlencode({"vs_currency": "usd", "ids": ",".join(ids),
                                "price_change_percentage": "24h"})
    data = _get_json(f"{COINGECKO}/coins/markets?{q}", _cg_headers())
    return {row["id"]: row for row in data if isinstance(row, dict)}


def _coingecko_history(cid, days):
    q = urllib.parse.urlencode({"vs_currency": "usd", "days": days,
                                "interval": "daily"})
    data = _get_json(f"{COINGECKO}/coins/{urllib.parse.quote(cid)}/market_chart?{q}",
                     _cg_headers())
    # CoinGecko's midnight point is the price at the start of day D, i.e. the
    # close of D-1; relabel so every source means (day start, day close).
    by_day = {}
    for ts, p in data["prices"]:
        sec = int(ts // 1000)
        day = sec - sec % 86400
        if sec == day:
            day -= 86400
        by_day[day] = float(p)
    pts = sorted(by_day.items())[-(days + 1):]
    return [(d * 1000, p) for d, p in pts]


# --------------------------------------------------------------- helpers

def _market_row(cid, last, ref, high, low):
    meta = COINS[cid]
    change = last - ref
    return {
        "id": cid,
        "symbol": meta["symbol"],
        "name": meta["name"],
        "current_price": last,
        "high_24h": high,
        "low_24h": low,
        "price_change_24h": change,
        "price_change_percentage_24h": (change / ref * 100) if ref else None,
        "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _fill(ids, sources, what):
    """Run each (name, fn) source over the still-missing ids."""
    result, served = {}, {}
    missing = list(ids)
    for name, fn in sources:
        if not missing:
            break
        try:
            got = fn(missing) or {}
        except Exception as e:
            _log(f"{name} {what} failed: {e}")
            continue
        for c in missing:
            if got.get(c) not in (None, [], {}):
                result[c] = got[c]
                served[c] = name
        missing = [c for c in missing if c not in result]
    for c in ids:
        if c in served:
            _log(f"{what}: {c} <- {served[c]}")
    last_sources.update(served)
    if missing:
        raise RuntimeError(f"no source could provide {what} for: "
                           f"{', '.join(missing)}")
    return result


def get_prices(ids):
    """{coingecko_id: usd_price} for every id, or raise RuntimeError."""
    ids = _norm_ids(ids)
    return _fill(ids, [("Kraken", _kraken_prices),
                       ("Coinbase", _coinbase_prices),
                       ("CoinGecko", _coingecko_prices)], "price")


def get_markets(ids):
    """List of CoinGecko coins/markets-shaped dicts, in the requested order."""
    ids = _norm_ids(ids)
    rows = _fill(ids, [("Kraken", _kraken_markets),
                       ("Coinbase", _coinbase_markets),
                       ("CoinGecko", _coingecko_markets)], "market")
    return [rows[c] for c in ids]


def get_daily_history(cid, days):
    """[(ms_ts, usd_close)] daily, oldest first, ~days+1 points ending today.

    Each timestamp is a UTC day start and the price is that day's close
    (today's point is the latest price).
    """
    def one(fn):
        return lambda ids: {cid: fn(cid, days)}

    got = _fill([cid], [("Kraken", one(_kraken_history)),
                        ("Coinbase", one(_coinbase_history)),
                        ("CoinGecko", one(_coingecko_history))],
                "daily history")
    return got[cid]


if __name__ == "__main__":
    ids = sys.argv[1:] or list(COINS)
    print(json.dumps(get_prices(ids), indent=2))
