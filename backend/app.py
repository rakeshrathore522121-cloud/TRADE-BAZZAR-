import os
import io
import csv
import base64
from functools import wraps
from datetime import datetime

import requests
from flask import Flask, request, jsonify, session, send_from_directory, make_response
from flask_cors import CORS
from werkzeug.security import check_password_hash

from database import get_connection, init_database, IntegrityError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.secret_key = os.environ.get("TRADE_BAZZAR_SECRET", "CHANGE_THIS_SECRET_IN_PRODUCTION")
CORS(app, supports_credentials=True)

init_database()

MARKET_MAP = {
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "INFY": "INFY.NS",
    "ICICIBANK": "ICICIBANK.NS",
    "SBIN": "SBIN.NS",
    "ITC": "ITC.NS",
    "BHARTIARTL": "BHARTIARTL.NS",
    "NIFTY 50": "^NSEI",
    "BANK NIFTY": "^NSEBANK",
    "SENSEX": "^BSESN",
}

def row_dict(row):
    return dict(row) if row else None

def current_user():
    uid = session.get("user_db_id")
    if not uid:
        return None
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    conn.close()
    return row

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or not user["active"] or user["blocked"]:
            session.clear()
            return jsonify({"success": False, "message": "Login required."}), 401
        return fn(*args, **kwargs)
    return wrapper

def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or user["role"] != "admin" or not user["active"] or user["blocked"]:
            return jsonify({"success": False, "message": "Admin access required."}), 403
        return fn(*args, **kwargs)
    return wrapper

def public_user(u):
    return {
        "id": u["id"],
        "user_id": u["user_id"],
        "role": u["role"],
        "name": u["name"],
        "aadhaar": u["aadhaar"],
        "pan": u["pan"],
        "mobile": u["mobile"],
        "dob": u["dob"],
        "email": u["email"],
        "balance": float(u["balance"]),
        "forex_balance": float(u["forex_balance"] or 0),
        "active": bool(u["active"]),
        "blocked": bool(u["blocked"]),
        "created_at": u["created_at"],
    }

def nse_option_chain(index_symbol="NIFTY"):
    """Fetch NSE index option-chain data using the current contract-info + v3 routes.

    NSE may still deny automated requests (403/404); in that case return None so
    the API can show an unavailable state rather than fabricated market prices.
    """
    symbol = str(index_symbol).upper().strip()
    if symbol not in ("NIFTY", "BANKNIFTY"):
        return None

    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
        "Referer": f"https://www.nseindia.com/option-chain?symbol={symbol}",
        "Origin": "https://www.nseindia.com",
        "Connection": "keep-alive",
    }
    try:
        # Establish cookies from the NSE website before calling its JSON endpoints.
        session.get("https://www.nseindia.com/", headers=headers, timeout=10)
        session.get(
            "https://www.nseindia.com/option-chain",
            params={"symbol": symbol}, headers=headers, timeout=10,
        )
        info = session.get(
            "https://www.nseindia.com/api/option-chain-contract-info",
            params={"symbol": symbol}, headers=headers, timeout=12,
        )
        info.raise_for_status()
        info_data = info.json()
        expiry_dates = info_data.get("expiryDates", []) or []
        if not expiry_dates:
            return None

        expiry = expiry_dates[0]
        chain = session.get(
            "https://www.nseindia.com/api/option-chain-v3",
            params={"type": "Indices", "symbol": symbol, "expiry": expiry},
            headers=headers, timeout=15,
        )
        chain.raise_for_status()
        chain_data = chain.json()
        records = chain_data.get("records", {}) or {}
        # Keep the response shape expected by existing app routes.
        records.setdefault("expiryDates", expiry_dates)
        return {"records": records}
    except (requests.RequestException, ValueError, TypeError, KeyError):
        return None

def index_option_quote(symbol):
    clean=str(symbol).upper().strip()
    m=__import__('re').match(r"^(NIFTY|BANKNIFTY)(\d+)(CE|PE)$",clean)
    if not m: return None
    index_symbol=m.group(1); strike=float(m.group(2)); side=m.group(3)
    data=nse_option_chain(index_symbol)
    if not data: return None
    records=data.get("records",{})
    expiries=records.get("expiryDates",[])
    rows=records.get("data",[])
    # A watchlist symbol such as NIFTY20900CE does not contain expiry.
    # Search the available expiries instead of assuming the first expiry is the one
    # carrying that strike. This keeps the saved watchlist symbol resolvable.
    for row in rows:
        if float(row.get("strikePrice",-1))!=strike: continue
        leg=row.get(side) or {}
        if not leg or leg.get("lastPrice") is None: continue
        return {
            "symbol":str(symbol).upper().strip(), "price":float(leg.get("lastPrice",0) or 0),
            "previous_close":float((leg.get("lastPrice",0) or 0)-float(leg.get("change",0) or 0)),
            "change":float(leg.get("change",0) or 0),
            "change_percent":float(leg.get("pChange",0) or 0),
            "bid":float(leg.get("bidprice",0) or 0), "ask":float(leg.get("askPrice",0) or 0),
            "bid_qty":int(leg.get("bidQty",0) or 0), "ask_qty":int(leg.get("askQty",0) or 0),
            "low":float(leg.get("lowPrice",0) or 0), "high":float(leg.get("highPrice",0) or 0),
            "expiry":row.get("expiryDate") or (expiries[0] if expiries else "")
        }
    return None

def market_quote(symbol):
    clean = symbol.upper().strip()
    option=index_option_quote(clean)
    if option: return option
    yahoo_symbol = MARKET_MAP.get(clean, clean if "." in clean or clean.startswith("^") else clean + ".NS")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"
    try:
        r = requests.get(
            url,
            params={"range": "1d", "interval": "1m"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()["chart"]["result"][0]
        meta = data["meta"]
        price = meta.get("regularMarketPrice")
        prev = meta.get("previousClose") or meta.get("chartPreviousClose")
        if price is None:
            return None
        change = float(price) - float(prev or price)
        pct = (change / float(prev) * 100) if prev else 0
        return {
            "symbol": clean,
            "yahoo_symbol": yahoo_symbol,
            "price": round(float(price), 2),
            "previous_close": round(float(prev or price), 2),
            "change": round(change, 2),
            "change_percent": round(pct, 2),
            "low": meta.get("regularMarketDayLow"),
            "high": meta.get("regularMarketDayHigh"),
        }
    except Exception:
        return None

@app.get("/")
def home():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.get("/admin")
def admin_home():
    return send_from_directory(os.path.join(FRONTEND_DIR, "admin"), "index.html")

@app.get("/api/health")
def health():
    return jsonify({"success": True, "message": "TRADE BAZZAR backend is running"})

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get("user_id", "")).strip()
    password = str(data.get("password", ""))
    conn = get_connection()
    u = conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
    conn.close()

    if not u or not check_password_hash(u["password_hash"], password):
        return jsonify({"success": False, "message": "Invalid User ID or password."}), 401
    if not u["active"] or u["blocked"]:
        return jsonify({"success": False, "message": "Account is inactive or blocked."}), 403

    session["user_db_id"] = u["id"]
    return jsonify({"success": True, "user": public_user(u)})

@app.post("/api/admin/login")
def admin_login():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get("user_id", "")).strip()
    password = str(data.get("password", ""))
    conn = get_connection()
    u = conn.execute("SELECT * FROM users WHERE user_id=? AND role='admin'", (user_id,)).fetchone()
    conn.close()
    if not u or not check_password_hash(u["password_hash"], password):
        return jsonify({"success": False, "message": "Invalid admin credentials."}), 401
    if not u["active"] or u["blocked"]:
        return jsonify({"success": False, "message": "Admin account is inactive."}), 403
    session["user_db_id"] = u["id"]
    return jsonify({"success": True, "user": public_user(u)})

@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"success": True})

@app.get("/api/me")
@login_required
def me():
    return jsonify({"success": True, "user": public_user(current_user())})

@app.get("/api/fno")
@login_required
def fno():
    index_symbol=request.args.get("symbol","NIFTY").upper().strip()
    if index_symbol not in ("NIFTY","BANKNIFTY"):
        return jsonify({"success":False,"message":"Unsupported option index."}),400
    data=nse_option_chain(index_symbol)
    # Never manufacture sample strikes or prices when the market feed is absent.
    if not data:
        return jsonify({"success":True,"underlying":index_symbol,"expiry_dates":[],"contracts":[],"live":False})
    records=data.get("records",{}) or {}
    expiries=records.get("expiryDates",[]) or []
    requested_expiry=request.args.get("expiry","").strip()
    target_expiry=requested_expiry if requested_expiry in expiries else (expiries[0] if expiries else None)
    contracts=[]
    for row in records.get("data",[]) or []:
        strike=row.get("strikePrice")
        expiry=row.get("expiryDate")
        if strike is None or not expiry or (target_expiry and expiry!=target_expiry):
            continue
        for side in ("CE","PE"):
            leg=row.get(side) or {}
            if not leg:
                continue
            def num(value):
                try:
                    return float(value) if value is not None else None
                except (TypeError,ValueError):
                    return None
            contracts.append({
                "symbol":f"{index_symbol}{int(float(strike))}{side}",
                "identifier":leg.get("identifier",""), "strike":float(strike),
                "type":side, "expiry":expiry, "ltp":num(leg.get("lastPrice")),
                "change":num(leg.get("change")), "change_percent":num(leg.get("pChange")),
                "bid":num(leg.get("bidprice")), "ask":num(leg.get("askPrice")),
                "bid_qty":num(leg.get("bidQty")), "ask_qty":num(leg.get("askQty")),
                "oi":num(leg.get("openInterest")), "change_oi":num(leg.get("changeinOpenInterest")),
                "volume":num(leg.get("totalTradedVolume")),
                "low":num(leg.get("lowPrice")), "high":num(leg.get("highPrice"))
            })
    return jsonify({"success":True,"underlying":index_symbol,"expiry_dates":expiries,
                    "selected_expiry":target_expiry,"contracts":contracts,"live":True})

@app.get("/api/market")
def market():
    symbols = request.args.get("symbols", "NIFTY 50,BANK NIFTY,SENSEX,RELIANCE,TCS,HDFCBANK,INFY").split(",")
    result = []
    for s in symbols:
        q = market_quote(s)
        if q:
            result.append(q)
    return jsonify({"success": True, "data": result})


@app.get("/api/chart")
@login_required
def chart_data():
    """Return genuine Yahoo Finance OHLC candles for the selected index/timeframe."""
    symbol = request.args.get("symbol", "NIFTY 50").strip().upper()
    interval = request.args.get("interval", "1m").strip().lower()
    interval_map = {
        "1m": ("1m", "5d"),
        "5m": ("5m", "1mo"),
        "15m": ("15m", "1mo"),
        "1h": ("60m", "3mo"),
        "1d": ("1d", "1y"),
    }
    if interval not in interval_map:
        return jsonify({"success": False, "message": "Unsupported chart interval."}), 400
    if symbol not in ("NIFTY 50", "BANK NIFTY"):
        return jsonify({"success": False, "message": "Unsupported chart symbol."}), 400
    yahoo_symbol = MARKET_MAP.get(symbol)
    if not yahoo_symbol:
        return jsonify({"success": False, "message": "Chart symbol is not configured."}), 400
    yahoo_interval, period = interval_map[interval]
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"
    try:
        response = requests.get(
            url,
            params={"range": period, "interval": yahoo_interval, "includePrePost": "false"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=12,
        )
        response.raise_for_status()
        payload = response.json().get("chart", {})
        if payload.get("error"):
            raise ValueError("Market data provider returned an error")
        result = (payload.get("result") or [None])[0]
        if not result:
            return jsonify({"success": False, "message": "No chart data returned."}), 503
        timestamps = result.get("timestamp") or []
        quote = (result.get("indicators", {}).get("quote") or [{}])[0]
        opens, highs = quote.get("open") or [], quote.get("high") or []
        lows, closes = quote.get("low") or [], quote.get("close") or []
        candles = []
        for i, timestamp in enumerate(timestamps):
            try:
                o, h, l, c = opens[i], highs[i], lows[i], closes[i]
                if None in (o, h, l, c):
                    continue
                candles.append({
                    "time": int(timestamp),
                    "open": float(o), "high": float(h),
                    "low": float(l), "close": float(c),
                })
            except (IndexError, TypeError, ValueError):
                continue
        if not candles:
            return jsonify({"success": False, "message": "No complete candles available."}), 503
        meta = result.get("meta", {})
        return jsonify({
            "success": True, "symbol": symbol, "interval": interval,
            "source": "Yahoo Finance", "currency": meta.get("currency", "INR"),
            "candles": candles,
        })
    except Exception:
        return jsonify({"success": False, "message": "Historical candle data is temporarily unavailable."}), 503

@app.get("/api/quote/<path:symbol>")
@login_required
def quote(symbol):
    q = market_quote(symbol)
    if not q:
        return jsonify({"success": False, "message": "Market data temporarily unavailable."}), 503
    return jsonify({"success": True, "data": q})

@app.get("/api/settings")
def get_settings():
    conn = get_connection()
    rows = conn.execute("SELECT key,value FROM settings").fetchall()
    conn.close()
    return jsonify({"success": True, "settings": {r["key"]: r["value"] for r in rows}})

@app.get("/api/news")
@login_required
def get_news():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM news WHERE active=1 ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify({"success": True, "news": [row_dict(r) for r in rows]})

@app.get("/api/watchlist")
@login_required
def watchlist():
    u = current_user()
    list_no = int(request.args.get("list", 1))
    conn = get_connection()
    rows = conn.execute(
        "SELECT symbol FROM watchlists WHERE user_id=? AND list_no=? ORDER BY id",
        (u["id"], list_no),
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "symbols": [r["symbol"] for r in rows]})

@app.post("/api/watchlist")
@login_required
def add_watchlist():
    u = current_user()
    data = request.get_json(silent=True) or {}
    symbol = str(data.get("symbol", "")).strip().upper()
    list_no = int(data.get("list_no", 1))
    if not symbol or list_no not in (1, 2):
        return jsonify({"success": False, "message": "Invalid watchlist request."}), 400
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO watchlists(user_id,list_no,symbol) VALUES(?,?,?)",
            (u["id"], list_no, symbol),
        )
        conn.commit()
    except IntegrityError:
        pass
    conn.close()
    return jsonify({"success": True})

@app.delete("/api/watchlist")
@login_required
def remove_watchlist():
    u = current_user()
    symbol = str(request.args.get("symbol", "")).strip().upper()
    list_no = int(request.args.get("list", 1))
    conn = get_connection()
    conn.execute(
        "DELETE FROM watchlists WHERE user_id=? AND list_no=? AND symbol=?",
        (u["id"], list_no, symbol),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.get("/api/orders")
@login_required
def get_orders():
    u = current_user()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 200",
        (u["id"],),
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "orders": [row_dict(r) for r in rows]})

@app.post("/api/orders")
@login_required
def create_order():
    u = current_user()
    data = request.get_json(silent=True) or {}
    symbol = str(data.get("symbol", "")).strip().upper()
    side = str(data.get("side", "")).strip().upper()
    try:
        qty = int(data.get("quantity", 0))
        price = float(data.get("price", 0))
    except Exception:
        qty, price = 0, 0

    if not symbol or side not in ("BUY", "SELL") or qty <= 0 or price <= 0:
        return jsonify({"success": False, "message": "Invalid order details."}), 400

    value = qty * price
    conn = get_connection()
    fresh = conn.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()

    if side == "BUY" and value > fresh["balance"]:
        conn.close()
        return jsonify({"success": False, "message": "Insufficient funds."}), 400

    pos = conn.execute(
        "SELECT * FROM positions WHERE user_id=? AND symbol=?", (u["id"], symbol)
    ).fetchone()

    if side == "SELL":
        if not pos or pos["quantity"] < qty:
            conn.close()
            return jsonify({"success": False, "message": "Insufficient position quantity."}), 400

    # Simple paper-trading execution.
    if side == "BUY":
        new_qty = (pos["quantity"] if pos else 0) + qty
        old_cost = (pos["quantity"] * pos["avg_price"]) if pos else 0
        new_avg = (old_cost + value) / new_qty
        conn.execute(
            """INSERT INTO positions(user_id,symbol,quantity,avg_price,updated_at)
               VALUES(?,?,?,?,CURRENT_TIMESTAMP)
               ON CONFLICT(user_id,symbol) DO UPDATE SET
               quantity=excluded.quantity, avg_price=excluded.avg_price,
               updated_at=CURRENT_TIMESTAMP""",
            (u["id"], symbol, new_qty, new_avg),
        )
        conn.execute("UPDATE users SET balance=balance-? WHERE id=?", (value, u["id"]))
        conn.execute(
            "INSERT INTO ledger(user_id,entry_type,amount,note) VALUES(?,?,?,?)",
            (u["id"], "TRADE_DEBIT", -value, f"BUY {qty} {symbol}"),
        )
    else:
        pnl = (price - pos["avg_price"]) * qty
        remaining = pos["quantity"] - qty
        conn.execute(
            """UPDATE positions SET quantity=?, realized_pnl=realized_pnl+?,
               updated_at=CURRENT_TIMESTAMP WHERE id=?""",
            (remaining, pnl, pos["id"]),
        )
        conn.execute("UPDATE users SET balance=balance+? WHERE id=?", (value, u["id"]))
        conn.execute(
            "INSERT INTO ledger(user_id,entry_type,amount,note) VALUES(?,?,?,?)",
            (u["id"], "TRADE_CREDIT", value, f"SELL {qty} {symbol} | P&L {pnl:.2f}"),
        )

    cur = conn.execute(
        """INSERT INTO orders(user_id,symbol,side,quantity,price,status,pnl)
           VALUES(?,?,?,?,?,?,?)""",
        (u["id"], symbol, side, qty, price, "EXECUTED", pnl if side == "SELL" else 0),
    )
    conn.commit()
    order_id = cur.lastrowid
    conn.close()
    return jsonify({"success": True, "message": "Order executed.", "order_id": order_id})

@app.get("/api/positions")
@login_required
def positions():
    u = current_user()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM positions WHERE user_id=? AND quantity>0 ORDER BY symbol",
        (u["id"],),
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        q = market_quote(r["symbol"])
        ltp = q["price"] if q else r["avg_price"]
        unrealized = (ltp - r["avg_price"]) * r["quantity"]
        out.append({
            **row_dict(r),
            "ltp": ltp,
            "unrealized_pnl": round(unrealized, 2),
        })
    return jsonify({"success": True, "positions": out})

@app.get("/api/ledger")
@login_required
def ledger():
    u = current_user()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 300", (u["id"],)
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "ledger": [row_dict(r) for r in rows]})

@app.post("/api/deposits")
@login_required
def deposit_request():
    u = current_user()
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount", 0))
    except Exception:
        amount = 0
    utr = str(data.get("utr", "")).strip()
    note = str(data.get("note", "")).strip()
    if amount <= 0:
        return jsonify({"success": False, "message": "Enter a valid amount."}), 400
    conn = get_connection()
    cur = conn.execute(
        "INSERT INTO deposits(user_id,amount,utr,note) VALUES(?,?,?,?)",
        (u["id"], amount, utr, note),
    )
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return jsonify({"success": True, "message": "Deposit request submitted.", "id": rid})

@app.get("/api/deposits")
@login_required
def deposits():
    u = current_user()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM deposits WHERE user_id=? ORDER BY id DESC", (u["id"],)
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "deposits": [row_dict(r) for r in rows]})

@app.post("/api/withdrawals")
@login_required
def withdrawal_request():
    u = current_user()
    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount", 0))
    except Exception:
        amount = 0
    if amount <= 0:
        return jsonify({"success": False, "message": "Enter a valid amount."}), 400
    conn = get_connection()
    fresh = conn.execute("SELECT balance FROM users WHERE id=?", (u["id"],)).fetchone()
    pending = conn.execute(
        "SELECT COALESCE(SUM(amount),0) AS total FROM withdrawals WHERE user_id=? AND status='PENDING'",
        (u["id"],),
    ).fetchone()["total"]
    if amount + pending > fresh["balance"]:
        conn.close()
        return jsonify({"success": False, "message": "Withdrawal exceeds available balance."}), 400

    cur = conn.execute(
        """INSERT INTO withdrawals
        (user_id,amount,upi_id,bank_name,account_no,ifsc,note)
        VALUES(?,?,?,?,?,?,?)""",
        (
            u["id"], amount,
            str(data.get("upi_id","")).strip(),
            str(data.get("bank_name","")).strip(),
            str(data.get("account_no","")).strip(),
            str(data.get("ifsc","")).strip(),
            str(data.get("note","")).strip(),
        ),
    )
    conn.commit()
    rid = cur.lastrowid
    conn.close()
    return jsonify({"success": True, "message": "Withdrawal request submitted.", "id": rid})

@app.get("/api/withdrawals")
@login_required
def withdrawals():
    u = current_user()
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM withdrawals WHERE user_id=? ORDER BY id DESC", (u["id"],)
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "withdrawals": [row_dict(r) for r in rows]})

@app.post("/api/change-password")
@login_required
def change_password():
    u = current_user()
    data = request.get_json(silent=True) or {}
    old = str(data.get("old_password", ""))
    new = str(data.get("new_password", ""))
    if not check_password_hash(u["password_hash"], old):
        return jsonify({"success": False, "message": "Current password is incorrect."}), 400
    if len(new) < 6:
        return jsonify({"success": False, "message": "New password must be at least 6 characters."}), 400
    from werkzeug.security import generate_password_hash
    conn = get_connection()
    conn.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new), u["id"]))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Password changed successfully."})

# ---------------- ADMIN ----------------

@app.get("/api/admin/stats")
@admin_required
def admin_stats():
    conn = get_connection()
    data = {
        "users": conn.execute("SELECT COUNT(*) c FROM users WHERE role='user'").fetchone()["c"],
        "active_users": conn.execute("SELECT COUNT(*) c FROM users WHERE role='user' AND active=1 AND blocked=0").fetchone()["c"],
        "pending_deposits": conn.execute("SELECT COUNT(*) c FROM deposits WHERE status='PENDING'").fetchone()["c"],
        "pending_withdrawals": conn.execute("SELECT COUNT(*) c FROM withdrawals WHERE status='PENDING'").fetchone()["c"],
        "orders": conn.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"],
        "balance_total": conn.execute("SELECT COALESCE(SUM(balance),0) s FROM users WHERE role='user'").fetchone()["s"],
    }
    conn.close()
    return jsonify({"success": True, "stats": data})

@app.get("/api/admin/users")
@admin_required
def admin_users():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM users WHERE role='user' ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify({"success": True, "users": [public_user(r) for r in rows]})

@app.post("/api/admin/users")
@admin_required
def admin_create_user():
    from werkzeug.security import generate_password_hash
    data = request.get_json(silent=True) or {}
    user_id = str(data.get("user_id","")).strip()
    password = str(data.get("password",""))
    if len(user_id) < 3 or len(password) < 6:
        return jsonify({"success": False, "message": "User ID min 3 chars and password min 6 chars."}), 400
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO users(user_id,password_hash,name,aadhaar,pan,mobile,dob,email,balance)
               VALUES(?,?,?,?,?,?,?,?,0)""",
            (
                user_id, generate_password_hash(password),
                str(data.get("name","")).strip(),
                str(data.get("aadhaar","")).strip(),
                str(data.get("pan","")).strip(),
                str(data.get("mobile","")).strip(),
                str(data.get("dob","")).strip(),
                str(data.get("email","")).strip(),
            ),
        )
        conn.commit()
        new_id = cur.lastrowid
    except IntegrityError:
        conn.close()
        return jsonify({"success": False, "message": "User ID already exists."}), 400
    conn.close()
    return jsonify({"success": True, "id": new_id, "message": "User created."})

@app.patch("/api/admin/users/<int:user_db_id>")
@admin_required
def admin_update_user(user_db_id):
    data = request.get_json(silent=True) or {}
    conn = get_connection()
    user = conn.execute("SELECT * FROM users WHERE id=? AND role='user'", (user_db_id,)).fetchone()
    if not user:
        conn.close()
        return jsonify({"success": False, "message": "User not found."}), 404

    fields = ["name","aadhaar","pan","mobile","dob","email"]
    updates, vals = [], []
    for f in fields:
        if f in data:
            updates.append(f"{f}=?")
            vals.append(str(data[f]))
    if "active" in data:
        updates.append("active=?")
        vals.append(1 if data["active"] else 0)
    if "blocked" in data:
        updates.append("blocked=?")
        vals.append(1 if data["blocked"] else 0)

    if updates:
        vals.append(user_db_id)
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id=?", vals)

    if data.get("reset_password"):
        from werkzeug.security import generate_password_hash
        if len(str(data["reset_password"])) < 6:
            conn.close()
            return jsonify({"success": False, "message": "Password must be at least 6 characters."}), 400
        conn.execute(
            "UPDATE users SET password_hash=? WHERE id=?",
            (generate_password_hash(str(data["reset_password"])), user_db_id),
        )

    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "User updated."})

@app.get("/api/admin/deposits")
@admin_required
def admin_deposits():
    conn = get_connection()
    rows = conn.execute(
        """SELECT d.*, u.user_id, u.name
           FROM deposits d JOIN users u ON u.id=d.user_id
           ORDER BY d.id DESC"""
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "deposits": [row_dict(r) for r in rows]})

@app.post("/api/admin/deposits/<int:deposit_id>/review")
@admin_required
def review_deposit(deposit_id):
    data = request.get_json(silent=True) or {}
    action = str(data.get("action","")).upper()
    reason = str(data.get("reason","")).strip()
    if action not in ("APPROVE","REJECT"):
        return jsonify({"success": False, "message": "Invalid action."}), 400

    conn = get_connection()
    d = conn.execute("SELECT * FROM deposits WHERE id=?", (deposit_id,)).fetchone()
    if not d or d["status"] != "PENDING":
        conn.close()
        return jsonify({"success": False, "message": "Request not pending."}), 400

    status = "APPROVED" if action == "APPROVE" else "REJECTED"
    conn.execute(
        "UPDATE deposits SET status=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
        (status, deposit_id),
    )
    if action == "APPROVE":
        conn.execute("UPDATE users SET balance=balance+? WHERE id=?", (d["amount"], d["user_id"]))
        conn.execute(
            "INSERT INTO ledger(user_id,entry_type,amount,note,reference) VALUES(?,?,?,?,?)",
            (d["user_id"], "DEPOSIT", d["amount"], "Deposit approved", f"DEP-{deposit_id}"),
        )
    else:
        conn.execute(
            "INSERT INTO rejection_logs(user_id,type,reference_id,reason) VALUES(?,?,?,?)",
            (d["user_id"], "DEPOSIT", deposit_id, reason),
        )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"Deposit {status.lower()}."})

@app.get("/api/admin/withdrawals")
@admin_required
def admin_withdrawals():
    conn = get_connection()
    rows = conn.execute(
        """SELECT w.*, u.user_id, u.name, u.balance
           FROM withdrawals w JOIN users u ON u.id=w.user_id
           ORDER BY w.id DESC"""
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "withdrawals": [row_dict(r) for r in rows]})

@app.post("/api/admin/withdrawals/<int:withdrawal_id>/review")
@admin_required
def review_withdrawal(withdrawal_id):
    data = request.get_json(silent=True) or {}
    action = str(data.get("action","")).upper()
    reason = str(data.get("reason","")).strip()
    if action not in ("APPROVE","REJECT"):
        return jsonify({"success": False, "message": "Invalid action."}), 400

    conn = get_connection()
    w = conn.execute("SELECT * FROM withdrawals WHERE id=?", (withdrawal_id,)).fetchone()
    if not w or w["status"] != "PENDING":
        conn.close()
        return jsonify({"success": False, "message": "Request not pending."}), 400

    if action == "APPROVE":
        u = conn.execute("SELECT balance FROM users WHERE id=?", (w["user_id"],)).fetchone()
        if not u or u["balance"] < w["amount"]:
            conn.close()
            return jsonify({"success": False, "message": "Insufficient current balance."}), 400
        conn.execute("UPDATE users SET balance=balance-? WHERE id=?", (w["amount"], w["user_id"]))
        conn.execute(
            "INSERT INTO ledger(user_id,entry_type,amount,note,reference) VALUES(?,?,?,?,?)",
            (w["user_id"], "WITHDRAWAL", -w["amount"], "Withdrawal approved", f"WDR-{withdrawal_id}"),
        )
        status = "APPROVED"
    else:
        status = "REJECTED"
        conn.execute(
            "INSERT INTO rejection_logs(user_id,type,reference_id,reason) VALUES(?,?,?,?)",
            (w["user_id"], "WITHDRAWAL", withdrawal_id, reason),
        )

    conn.execute(
        "UPDATE withdrawals SET status=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
        (status, withdrawal_id),
    )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": f"Withdrawal {status.lower()}."})

@app.get("/api/admin/orders")
@admin_required
def admin_orders():
    conn = get_connection()
    rows = conn.execute(
        """SELECT o.*, u.user_id, u.name
           FROM orders o JOIN users u ON u.id=o.user_id
           ORDER BY o.id DESC LIMIT 500"""
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "orders": [row_dict(r) for r in rows]})

@app.get("/api/admin/settings")
@admin_required
def admin_settings():
    return get_settings()

@app.put("/api/admin/settings")
@admin_required
def update_admin_settings():
    data = request.get_json(silent=True) or {}
    conn = get_connection()
    for k, v in data.items():
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(k), str(v)),
        )
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Settings saved."})

@app.post("/api/admin/news")
@admin_required
def add_news():
    data = request.get_json(silent=True) or {}
    headline = str(data.get("headline","")).strip()
    if not headline:
        return jsonify({"success": False, "message": "Headline required."}), 400
    conn = get_connection()
    conn.execute("INSERT INTO news(headline) VALUES(?)", (headline,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.delete("/api/admin/news/<int:news_id>")
@admin_required
def delete_news(news_id):
    conn = get_connection()
    conn.execute("UPDATE news SET active=0 WHERE id=?", (news_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.get("/api/admin/reports/orders.csv")
@admin_required
def orders_csv():
    conn = get_connection()
    rows = conn.execute(
        """SELECT o.id,u.user_id,o.symbol,o.side,o.quantity,o.price,o.status,o.pnl,o.created_at
           FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC"""
    ).fetchall()
    conn.close()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["ID","User ID","Symbol","Side","Quantity","Price","Status","P&L","Created At"])
    for r in rows:
        writer.writerow(list(r.values()))
    resp = make_response(out.getvalue())
    resp.headers["Content-Type"] = "text/csv"
    resp.headers["Content-Disposition"] = "attachment; filename=trade_bazzar_orders.csv"
    return resp


# ---------------- USER EXTRA MODULES ----------------

@app.get("/api/rejections")
@login_required
def user_rejections():
    u = current_user()
    conn = get_connection()
    rows = conn.execute("SELECT * FROM rejection_logs WHERE user_id=? ORDER BY id DESC LIMIT 300",(u["id"],)).fetchall()
    conn.close()
    return jsonify({"success": True, "rejections": [row_dict(r) for r in rows]})

@app.get("/api/account")
@login_required
def user_account():
    return jsonify({"success": True, "user": public_user(current_user())})

@app.get("/api/transactions")
@login_required
def user_transactions():
    u = current_user()
    conn = get_connection()
    rows = conn.execute(
        """SELECT id, entry_type, amount, note, reference, created_at
           FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 500""",(u["id"],)
    ).fetchall()
    conn.close()
    return jsonify({"success": True, "transactions": [row_dict(r) for r in rows]})

@app.get("/api/bill/<int:order_id>")
@login_required
def bill(order_id):
    u = current_user()
    conn = get_connection()
    r = conn.execute(
        "SELECT o.*,u.user_id,u.name FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=? AND o.user_id=?",
        (order_id,u["id"])
    ).fetchone()
    conn.close()
    if not r: return jsonify({"success":False,"message":"Order not found."}),404
    return jsonify({"success":True,"bill":row_dict(r)})

# ---------------- ADMIN EXTRA MODULES ----------------

@app.get("/api/admin/positions")
@admin_required
def admin_positions():
    conn = get_connection()
    rows = conn.execute(
        """SELECT p.*,u.user_id,u.name FROM positions p JOIN users u ON u.id=p.user_id
           WHERE p.quantity>0 ORDER BY p.id DESC"""
    ).fetchall()
    conn.close()
    out=[]
    for r in rows:
        q=market_quote(r["symbol"])
        ltp=q["price"] if q else r["avg_price"]
        x=row_dict(r); x["ltp"]=ltp; x["unrealized_pnl"]=round((ltp-r["avg_price"])*r["quantity"],2)
        out.append(x)
    return jsonify({"success":True,"positions":out})

@app.get("/api/admin/rejections")
@admin_required
def admin_rejections():
    conn=get_connection()
    rows=conn.execute(
        """SELECT r.*,u.user_id,u.name FROM rejection_logs r JOIN users u ON u.id=r.user_id
           ORDER BY r.id DESC LIMIT 500"""
    ).fetchall()
    conn.close()
    return jsonify({"success":True,"rejections":[row_dict(r) for r in rows]})

@app.post("/api/admin/users/<int:user_db_id>/balance")
@admin_required
def admin_adjust_balance(user_db_id):
    data=request.get_json(silent=True) or {}
    try: amount=float(data.get("amount",0))
    except: amount=0
    note=str(data.get("note","Admin balance adjustment")).strip()
    if amount==0: return jsonify({"success":False,"message":"Amount cannot be zero."}),400
    conn=get_connection()
    u=conn.execute("SELECT * FROM users WHERE id=? AND role='user'",(user_db_id,)).fetchone()
    if not u: conn.close(); return jsonify({"success":False,"message":"User not found."}),404
    if u["balance"]+amount < 0: conn.close(); return jsonify({"success":False,"message":"Balance cannot go below zero."}),400
    conn.execute("UPDATE users SET balance=balance+? WHERE id=?",(amount,user_db_id))
    conn.execute("INSERT INTO ledger(user_id,entry_type,amount,note,reference) VALUES(?,?,?,?,?)",
                 (user_db_id,"ADMIN_ADJUSTMENT",amount,note,"ADMIN"))
    conn.commit(); conn.close()
    return jsonify({"success":True,"message":"Balance updated."})
# ---------------- FOREX BALANCE ----------------

@app.get("/api/forex/balance")
@login_required
def get_forex_balance():
    u = current_user()

    conn = get_connection()
    row = conn.execute(
        "SELECT forex_balance FROM users WHERE id=?",
        (u["id"],)
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({
            "success": False,
            "message": "User not found."
        }), 404

    return jsonify({
        "success": True,
        "forex_balance": float(row["forex_balance"] or 0)
    })


@app.post("/api/admin/users/<int:user_db_id>/forex-balance")
@admin_required
def admin_adjust_forex_balance(user_db_id):
    data = request.get_json(silent=True) or {}

    try:
        amount = float(data.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({
            "success": False,
            "message": "Enter a valid amount."
        }), 400

    import math

    if not math.isfinite(amount):
        return jsonify({
            "success": False,
            "message": "Enter a valid amount."
        }), 400

    if amount == 0:
        return jsonify({
            "success": False,
            "message": "Amount cannot be zero."
        }), 400

    note = str(
        data.get("note", "Admin Forex balance adjustment")
    ).strip()

    conn = get_connection()

    user = conn.execute(
        "SELECT id, forex_balance FROM users WHERE id=? AND role='user'",
        (user_db_id,)
    ).fetchone()

    if not user:
        conn.close()
        return jsonify({
            "success": False,
            "message": "User not found."
        }), 404

    current_balance = float(user["forex_balance"] or 0)
    new_balance = current_balance + amount

    if new_balance < 0:
        conn.close()
        return jsonify({
            "success": False,
            "message": "Forex balance cannot go below zero."
        }), 400

    conn.execute(
        "UPDATE users SET forex_balance=? WHERE id=?",
        (new_balance, user_db_id)
    )

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "Forex balance updated.",
        "forex_balance": new_balance
    })


@app.post("/api/admin/qr-upload")
@admin_required
def admin_qr_upload():
    f=request.files.get("qr")
    if not f or not f.filename:
        return jsonify({"success":False,"message":"Select a QR image."}),400
    mime=(f.mimetype or "").lower()
    if mime not in ("image/png","image/jpeg","image/webp"):
        return jsonify({"success":False,"message":"Only PNG, JPG or WEBP allowed."}),400
    raw=f.read()
    if len(raw)>2*1024*1024:
        return jsonify({"success":False,"message":"QR image must be 2 MB or smaller."}),400
    data_uri=f"data:{mime};base64,{base64.b64encode(raw).decode()}"
    conn=get_connection()
    conn.execute("INSERT INTO settings(key,value) VALUES('qr_image',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(data_uri,))
    conn.commit(); conn.close()
    return jsonify({"success":True,"message":"QR updated.","qr_image":data_uri})

@app.post("/api/admin/qr-remove")
@admin_required
def admin_qr_remove():
    conn=get_connection()
    conn.execute("INSERT INTO settings(key,value) VALUES('qr_image','') ON CONFLICT(key) DO UPDATE SET value=''")
    conn.commit(); conn.close()
    return jsonify({"success":True,"message":"QR removed."})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
