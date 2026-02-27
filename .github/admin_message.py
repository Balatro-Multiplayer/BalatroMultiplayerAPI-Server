#!/usr/bin/env python3
"""Send admin messages to players on the BMP server."""

import argparse
import json
import socket
import sys


def send_message(host: str, port: int, payload: dict) -> dict:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(5)
        s.connect((host, port))
        s.sendall((json.dumps(payload) + "\n").encode())

        data = b""
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            data += chunk

        return json.loads(data.decode().strip())


def main():
    parser = argparse.ArgumentParser(description="Send admin messages to BMP server players")
    parser.add_argument("message", help="Message to send to players")
    parser.add_argument("--lobby", help="Lobby code to target (omit to broadcast to all lobbies)")

    target = parser.add_mutually_exclusive_group()
    target.add_argument("--host", action="store_true", help="Send only to the host of the lobby")
    target.add_argument("--guest", action="store_true", help="Send only to the guest of the lobby")

    parser.add_argument("--server", default="127.0.0.1", help="Admin server address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8789, help="Admin server port (default: 8789)")

    args = parser.parse_args()

    if (args.host or args.guest) and not args.lobby:
        parser.error("--host/--guest requires --lobby")

    payload = {"message": args.message}
    if args.lobby:
        payload["lobby_code"] = args.lobby
    if args.host:
        payload["is_host"] = True
    elif args.guest:
        payload["is_host"] = False

    try:
        result = send_message(args.server, args.port, payload)
    except ConnectionRefusedError:
        print(f"Error: Could not connect to admin server at {args.server}:{args.port}", file=sys.stderr)
        sys.exit(1)
    except socket.timeout:
        print("Error: Connection timed out", file=sys.stderr)
        sys.exit(1)

    if result.get("success"):
        print(f"Message sent to {result['recipients']} player(s)")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
