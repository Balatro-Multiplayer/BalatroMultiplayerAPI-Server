#!/usr/bin/env python3
"""Manually manage the BMP relay ban list.

Writes straight to the relay's SQLite ban table (the same one src/banStore.ts
maintains). The running relay re-reads this table every BAN_RELOAD_INTERVAL_MS
(default 60s), so a ban added here takes effect within ~a minute with no restart.

Bans are keyed by one of two kinds:
  conn  the client hardware id (serversideConnectionID) — survives IP/VPN changes
  ip    the remote IP address
"conn", "serverid", "ssid" are accepted as aliases for the hardware id.

The DB lives on the relay's /data volume. From the host that's the bind mount,
typically  /root/server/data/log_hashes.db  (override with --db or $BAN_DB /
$LOG_HASH_DB_PATH).

Examples:
  # Permanently ban a hardware id
  python3 admin_ban.py ban serverid fda8e818 --reason "packet flood"

  # Ban an IP for 24 hours
  python3 admin_ban.py ban ip 203.0.113.5 --ttl 86400 --reason "flood"

  # Lift a ban / list current bans
  python3 admin_ban.py unban serverid fda8e818
  python3 admin_ban.py list
"""

import argparse
import os
import sqlite3
import sys
import time

DEFAULT_DB = (
    os.environ.get("BAN_DB")
    or os.environ.get("LOG_HASH_DB_PATH")
    or "/root/server/data/log_hashes.db"
)

# Keep this schema identical to src/banStore.ts so either side can create it.
SCHEMA = """
CREATE TABLE IF NOT EXISTS bans (
    kind       TEXT NOT NULL,
    id         TEXT NOT NULL,
    reason     TEXT,
    created_ts INTEGER NOT NULL,
    expires_ts INTEGER NOT NULL,
    PRIMARY KEY (kind, id)
);
"""

KIND_ALIASES = {
    "conn": "conn",
    "serverid": "conn",
    "ssid": "conn",
    "serversideconnectionid": "conn",
    "hwid": "conn",
    "ip": "ip",
}


def normalize_kind(raw):
    kind = KIND_ALIASES.get(raw.lower())
    if not kind:
        sys.exit(f"error: kind must be one of conn/serverid/ssid or ip (got {raw!r})")
    return kind


def connect(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute(SCHEMA)
    return conn


def fmt_expiry(expires_ts):
    if expires_ts == 0:
        return "permanent"
    secs = (expires_ts - int(time.time() * 1000)) / 1000
    if secs <= 0:
        return "expired"
    return f"expires in {int(secs)}s ({time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(expires_ts / 1000))})"


def cmd_ban(conn, args):
    kind = normalize_kind(args.kind)
    now = int(time.time() * 1000)
    expires_ts = 0 if args.ttl <= 0 else now + args.ttl * 1000
    conn.execute(
        """
        INSERT INTO bans (kind, id, reason, created_ts, expires_ts)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET
            reason = excluded.reason,
            created_ts = excluded.created_ts,
            expires_ts = excluded.expires_ts
        """,
        (kind, args.id, args.reason, now, expires_ts),
    )
    conn.commit()
    print(f"banned {kind}={args.id} ({fmt_expiry(expires_ts)}) — {args.reason!r}")
    print("takes effect on the live relay within the ban-reload interval (~60s).")


def cmd_unban(conn, args):
    kind = normalize_kind(args.kind)
    cur = conn.execute("DELETE FROM bans WHERE kind = ? AND id = ?", (kind, args.id))
    conn.commit()
    if cur.rowcount:
        print(f"unbanned {kind}={args.id}")
    else:
        print(f"no ban found for {kind}={args.id}")


def cmd_list(conn, _args):
    rows = conn.execute(
        "SELECT kind, id, reason, expires_ts FROM bans ORDER BY created_ts DESC"
    ).fetchall()
    if not rows:
        print("no bans.")
        return
    print(f"{len(rows)} ban(s):")
    for kind, id_, reason, expires_ts in rows:
        print(f"  {kind:4} {id_:24} {fmt_expiry(expires_ts):28} {reason or ''}")


def main():
    parser = argparse.ArgumentParser(description="Manage the BMP relay ban list.")
    parser.add_argument("--db", default=DEFAULT_DB, help=f"SQLite ban DB path (default {DEFAULT_DB})")
    sub = parser.add_subparsers(dest="command", required=True)

    p_ban = sub.add_parser("ban", help="add or update a ban")
    p_ban.add_argument("kind", help="conn/serverid/ssid or ip")
    p_ban.add_argument("id", help="the id to ban")
    p_ban.add_argument("--ttl", type=int, default=0, help="seconds until expiry (0 = permanent)")
    p_ban.add_argument("--reason", default="manual", help="reason note")
    p_ban.set_defaults(func=cmd_ban)

    p_unban = sub.add_parser("unban", help="lift a ban")
    p_unban.add_argument("kind", help="conn/serverid/ssid or ip")
    p_unban.add_argument("id", help="the id to unban")
    p_unban.set_defaults(func=cmd_unban)

    p_list = sub.add_parser("list", help="list current bans")
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    conn = connect(args.db)
    try:
        args.func(conn, args)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
