import os
import sqlite3
from werkzeug.security import generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "..", "data", "trade_bazzar.db")
_D1_DB = None

class D1Row(dict):
    """SQLite-row compatible mapping for D1 results."""
    def __iter__(self):
        return iter(self.values())

class D1Cursor:
    def __init__(self, result):
        self._result = result or {}
        self._rows = [D1Row(r) for r in (self._result.get("results") or [])]
        meta = self._result.get("meta") or {}
        self.lastrowid = meta.get("last_row_id") or 0
    def fetchone(self):
        return self._rows[0] if self._rows else None
    def fetchall(self):
        return self._rows


def _to_py(value):
    try:
        return value.to_py()
    except Exception:
        return value


def _run(awaitable):
    from pyodide.ffi import run_sync
    return _to_py(run_sync(awaitable))


class D1Connection:
    def __init__(self, db):
        self.db = db
    def execute(self, sql, params=()):
        try:
            stmt = self.db.prepare(sql)
            if params:
                stmt = stmt.bind(*params)
            result = _run(stmt.run())
            return D1Cursor(result)
        except Exception as exc:
            msg = str(exc)
            if "UNIQUE" in msg.upper() or "CONSTRAINT" in msg.upper():
                raise sqlite3.IntegrityError(msg)
            raise
    def executescript(self, script):
        # D1 initialization is performed by the included schema.sql migration.
        for statement in [x.strip() for x in script.split(";") if x.strip()]:
            self.execute(statement)
    def commit(self):
        # D1 statements are persisted as they execute.
        return None
    def rollback(self):
        return None
    def close(self):
        return None


def set_d1_database(db):
    global _D1_DB
    _D1_DB = db


def get_connection():
    if _D1_DB is not None:
        return D1Connection(_D1_DB)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_database():
    # On Cloudflare, D1 is initialized separately with cloudflare/schema.sql.
    if os.environ.get("TRADE_BAZZAR_CLOUDFLARE") == "1":
        return
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_connection()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        name TEXT DEFAULT '',
        aadhaar TEXT DEFAULT '',
        pan TEXT DEFAULT '',
        mobile TEXT DEFAULT '',
        dob TEXT DEFAULT '',
        email TEXT DEFAULT '',
        balance REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        blocked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS watchlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        list_no INTEGER NOT NULL DEFAULT 1,
        symbol TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, list_no, symbol),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'EXECUTED',
        pnl REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0,
        avg_price REAL NOT NULL DEFAULT 0,
        realized_pnl REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, symbol),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        entry_type TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT DEFAULT '',
        reference TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        utr TEXT DEFAULT '',
        note TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        upi_id TEXT DEFAULT '',
        bank_name TEXT DEFAULT '',
        account_no TEXT DEFAULT '',
        ifsc TEXT DEFAULT '',
        note TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT DEFAULT '',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS rejection_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        reference_id INTEGER,
        reason TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS news (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        headline TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """)
    admin = conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1").fetchone()
    if not admin:
        conn.execute("INSERT INTO users (user_id,password_hash,role,name,email) VALUES (?,?,?,?,?)",
                     ("admin", generate_password_hash("Admin@123"), "admin", "Trade Bazzar Admin", "admin@tradebazzar.local"))
    defaults = {
        "upi_id": "tradebazzar@upi", "qr_image": "", "company_name": "TRADE BAZZAR",
        "first_deposit_margin": "3× MARGIN", "payout_text": "10 MIN PAYOUT", "trusted_text": "10L+ TRUSTED USERS",
    }
    for k, v in defaults.items():
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))
    if conn.execute("SELECT COUNT(*) AS c FROM news").fetchone()["c"] == 0:
        conn.execute("INSERT INTO news(headline) VALUES(?)", ("TRADE BAZZAR MARKET UPDATE",))
    conn.commit(); conn.close()
