#!/usr/bin/env python3
"""Relay a pre-signed admin envelope to the BMP admin server."""

import json
import socket
import sys


def main():
    if len(sys.argv) != 2:
        print("Usage: admin_message.py '<signed_envelope_json>'", file=sys.stderr)
        sys.exit(1)

    envelope = sys.argv[1]

    # Validate it's valid JSON before sending
    try:
        parsed = json.loads(envelope)
        if "payload" not in parsed or "signature" not in parsed:
            print("Error: envelope must contain 'payload' and 'signature'", file=sys.stderr)
            sys.exit(1)
    except json.JSONDecodeError:
        print("Error: invalid JSON envelope", file=sys.stderr)
        sys.exit(1)

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(5)
            s.connect(("127.0.0.1", 8789))
            s.sendall((envelope + "\n").encode())

            data = b""
            while True:
                chunk = s.recv(4096)
                if not chunk:
                    break
                data += chunk

            print(data.decode().strip())
    except ConnectionRefusedError:
        print(json.dumps({"success": False, "error": "Could not connect to admin server"}))
        sys.exit(1)
    except socket.timeout:
        print(json.dumps({"success": False, "error": "Connection timed out"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
