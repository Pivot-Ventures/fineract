"""SQLite store for member credentials, sessions, idempotency and the audit trail.

Only secrets' hashes are stored: PINs (scrypt), activation codes, session tokens and device keys.
"""

import hashlib
import hmac
import json
import secrets
import sqlite3
import time
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
    client_id        INTEGER PRIMARY KEY,
    member_no        TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL,          -- pending | active | blocked
    pin_hash         TEXT,
    failed_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until     INTEGER NOT NULL DEFAULT 0,
    device_hash      TEXT,
    device_name      TEXT,
    created_at       INTEGER NOT NULL,
    activated_at     INTEGER,
    last_login_at    INTEGER
);
CREATE TABLE IF NOT EXISTS activation_codes (
    client_id   INTEGER PRIMARY KEY,
    code_hash   TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    issued_by   TEXT NOT NULL,
    issued_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    client_id    INTEGER NOT NULL,
    device_hash  TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
    client_id   INTEGER NOT NULL,
    key         TEXT NOT NULL,
    response    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (client_id, key)
);
CREATE TABLE IF NOT EXISTS money_moves (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id    INTEGER NOT NULL,
    kind         TEXT NOT NULL,
    amount       REAL NOT NULL,
    local_date   TEXT NOT NULL,
    fineract_id  INTEGER,
    created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS money_moves_day ON money_moves (client_id, local_date);
CREATE TABLE IF NOT EXISTS momo_deposits (
    id            TEXT PRIMARY KEY,           -- our request id, shown to the member
    client_id     INTEGER NOT NULL,
    savings_id    INTEGER NOT NULL,
    network       TEXT NOT NULL,
    msisdn        TEXT NOT NULL,
    amount        REAL NOT NULL,
    provider_ref  TEXT,
    status        TEXT NOT NULL,              -- pending | successful | failed
    reason        TEXT,
    fineract_id   INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         INTEGER NOT NULL,
    client_id  INTEGER,
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT
);
"""

# scrypt parameters: ~16 MiB, tens of milliseconds per hash.
_N, _R, _P = 2**14, 8, 1


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pin.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(salt_hex), n=_N, r=_R, p=_P, dklen=32)
    return hmac.compare_digest(digest.hex(), digest_hex)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def now() -> int:
    return int(time.time())


class Store:
    def __init__(self, path: str):
        self.path = path
        with self.conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, isolation_level=None, timeout=10)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        try:
            yield c
        finally:
            c.close()

    # ---------- members ----------
    def member(self, client_id: int):
        with self.conn() as c:
            return c.execute("SELECT * FROM members WHERE client_id=?", (client_id,)).fetchone()

    def member_by_no(self, member_no: str):
        with self.conn() as c:
            return c.execute("SELECT * FROM members WHERE member_no=?", (member_no,)).fetchone()

    def upsert_pending_member(self, client_id: int, member_no: str):
        with self.conn() as c:
            c.execute(
                """INSERT INTO members (client_id, member_no, status, created_at)
                   VALUES (?, ?, 'pending', ?)
                   ON CONFLICT(client_id) DO UPDATE SET member_no=excluded.member_no""",
                (client_id, member_no, now()),
            )

    def update_member(self, client_id: int, **fields):
        cols = ", ".join(f"{k}=?" for k in fields)
        with self.conn() as c:
            c.execute(f"UPDATE members SET {cols} WHERE client_id=?", (*fields.values(), client_id))

    # ---------- activation codes ----------
    def put_activation_code(self, client_id: int, code: str, ttl_seconds: int, issued_by: str):
        with self.conn() as c:
            c.execute(
                """INSERT INTO activation_codes (client_id, code_hash, expires_at, attempts, issued_by, issued_at)
                   VALUES (?, ?, ?, 0, ?, ?)
                   ON CONFLICT(client_id) DO UPDATE SET code_hash=excluded.code_hash,
                     expires_at=excluded.expires_at, attempts=0, issued_by=excluded.issued_by,
                     issued_at=excluded.issued_at""",
                (client_id, hash_pin(code), now() + ttl_seconds, issued_by, now()),
            )

    def activation_code(self, client_id: int):
        with self.conn() as c:
            return c.execute("SELECT * FROM activation_codes WHERE client_id=?", (client_id,)).fetchone()

    def bump_activation_attempts(self, client_id: int):
        with self.conn() as c:
            c.execute("UPDATE activation_codes SET attempts=attempts+1 WHERE client_id=?", (client_id,))

    def delete_activation_code(self, client_id: int):
        with self.conn() as c:
            c.execute("DELETE FROM activation_codes WHERE client_id=?", (client_id,))

    # ---------- sessions ----------
    def create_session(self, client_id: int, device_hash: str) -> str:
        token = secrets.token_urlsafe(32)
        t = now()
        with self.conn() as c:
            c.execute(
                "INSERT INTO sessions (token_hash, client_id, device_hash, created_at, last_seen_at) VALUES (?,?,?,?,?)",
                (sha256(token), client_id, device_hash, t, t),
            )
        return token

    def session(self, token: str):
        with self.conn() as c:
            return c.execute("SELECT * FROM sessions WHERE token_hash=?", (sha256(token),)).fetchone()

    def touch_session(self, token: str):
        with self.conn() as c:
            c.execute("UPDATE sessions SET last_seen_at=? WHERE token_hash=?", (now(), sha256(token)))

    def delete_session(self, token: str):
        with self.conn() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (sha256(token),))

    def delete_sessions_for(self, client_id: int):
        with self.conn() as c:
            c.execute("DELETE FROM sessions WHERE client_id=?", (client_id,))

    def purge_sessions(self, idle_seconds: int, max_seconds: int):
        t = now()
        with self.conn() as c:
            c.execute("DELETE FROM sessions WHERE last_seen_at < ? OR created_at < ?",
                      (t - idle_seconds, t - max_seconds))

    # ---------- idempotency ----------
    def idempotent_response(self, client_id: int, key: str):
        with self.conn() as c:
            row = c.execute("SELECT response FROM idempotency WHERE client_id=? AND key=?",
                            (client_id, key)).fetchone()
        return json.loads(row["response"]) if row else None

    def save_idempotent_response(self, client_id: int, key: str, response: dict):
        with self.conn() as c:
            c.execute("INSERT OR REPLACE INTO idempotency (client_id, key, response, created_at) VALUES (?,?,?,?)",
                      (client_id, key, json.dumps(response), now()))

    # ---------- limits ----------
    def moved_today(self, client_id: int, local_date: str) -> float:
        with self.conn() as c:
            row = c.execute("SELECT COALESCE(SUM(amount),0) AS s FROM money_moves WHERE client_id=? AND local_date=?",
                            (client_id, local_date)).fetchone()
        return float(row["s"])

    def record_move(self, client_id: int, kind: str, amount: float, local_date: str, fineract_id):
        with self.conn() as c:
            c.execute("INSERT INTO money_moves (client_id, kind, amount, local_date, fineract_id, created_at) VALUES (?,?,?,?,?,?)",
                      (client_id, kind, amount, local_date, fineract_id, now()))

    # ---------- mobile-money deposits ----------
    def create_deposit(self, row: dict):
        t = now()
        with self.conn() as c:
            c.execute(
                """INSERT INTO momo_deposits (id, client_id, savings_id, network, msisdn, amount, provider_ref,
                   status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)""",
                (row["id"], row["client_id"], row["savings_id"], row["network"], row["msisdn"], row["amount"],
                 row["provider_ref"], t, t),
            )

    def deposit(self, deposit_id: str):
        with self.conn() as c:
            return c.execute("SELECT * FROM momo_deposits WHERE id=?", (deposit_id,)).fetchone()

    def finish_deposit(self, deposit_id: str, status: str, reason=None, fineract_id=None):
        with self.conn() as c:
            c.execute("UPDATE momo_deposits SET status=?, reason=?, fineract_id=?, updated_at=? WHERE id=? AND status='pending'",
                      (status, reason, fineract_id, now(), deposit_id))

    # ---------- audit ----------
    def audit(self, actor: str, action: str, client_id=None, detail=None, ip=None):
        with self.conn() as c:
            c.execute("INSERT INTO audit (ts, client_id, actor, action, detail, ip) VALUES (?,?,?,?,?,?)",
                      (now(), client_id, actor, action, json.dumps(detail) if detail else None, ip))
