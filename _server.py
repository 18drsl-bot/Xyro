#!/usr/bin/env python3
"""
Xyro local tag server - optional dev accelerator.

Serves nametags.json + media/ from this folder so YOUR executor gets
instant reads (localhost, no internet round-trip). Everyone else keeps
using the GitHub CDN. The script tries localhost first and falls back
automatically, so leaving this running is always safe.

Run:   python _server.py
Stop:  Ctrl+C
"""
import functools
import json
import os
import re
import socket
import socketserver
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8619
# loopback-only by default (nothing leaves your PC); set XYRO_LAN=1 to
# also serve other devices on your network
HOST = "0.0.0.0" if os.environ.get("XYRO_LAN") == "1" else "127.0.0.1"

# public (non-loopback) interfaces, so the console can show a LAN URL too
def lan_ips():
    ips = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            ip = info[4][0]
            if ip and not ip.startswith(("127.", "::1")) and ":" not in ip and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # no caching: localhost is instant anyway, and edits show up on the
    # very next !nametagsfetch
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self):
        # CORS preflight (the https tag editor posts to this http origin)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stdout.write("  %s %s\n" % (self.log_date_time_string(), fmt % args))
        sys.stdout.flush()

    def do_GET(self):
        if self.path.split("?")[0] in ("/nametags.json", "/config"):
            self._serve_json()
        else:
            super().do_GET()

    def do_POST(self):
        # the tag editor calls this right after publishing to GitHub, so the
        # local copy is always the newest published state (never stale)
        if self.path.split("?")[0] != "/sync":
            self._send(404, b'{"error":"unknown endpoint"}', "application/json")
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > 5 * 1024 * 1024:
                raise ValueError("bad body size %d" % length)
            raw = self.rfile.read(length)
            cfg = json.loads(raw)  # validate BEFORE touching the file
            if not isinstance(cfg, dict) or not isinstance(cfg.get("tags"), list):
                raise ValueError("config needs a tags list")
            if not raw.endswith(b"\n"):
                raw += b"\n"
            tmp = os.path.join(ROOT, "nametags.json.tmp")
            with open(tmp, "wb") as f:
                f.write(raw)
            os.replace(tmp, os.path.join(ROOT, "nametags.json"))
            self._send(200, b'{"ok":true}', "application/json")
            print("  [sync] nametags.json updated from editor (%d rules)" % len(cfg["tags"]))
        except Exception as e:
            self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")

    def _serve_json(self):
        path = os.path.join(ROOT, "nametags.json")
        try:
            with open(path, "rb") as f:
                body = f.read()
            json.loads(body)  # refuse to serve a corrupt file
        except Exception as e:
            body = json.dumps({"error": "nametags.json unreadable: %s" % e}).encode()
            self._send(500, body, "application/json")
            return
        self._send(200, body, "application/json")

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    try:
        srv = Server((HOST, PORT), Handler)
    except OSError as e:
        print("port %d busy (%s) - is the server already running?" % (PORT, e))
        sys.exit(1)
    print("Xyro local tag server")
    print("  config : http://localhost:%d/nametags.json" % PORT)
    if HOST == "0.0.0.0":
        for ip in lan_ips():
            print("           http://%s:%d/nametags.json  (LAN)" % (ip, PORT))
    print("  media  : http://localhost:%d/media/<file>" % PORT)
    print("  sync   : POST /sync (the tag editor updates your local copy on publish)")
    print("  root   : %s" % ROOT)
    print("  bound to %s (set XYRO_LAN=1 to share on your network)" % HOST)
    print("  Ctrl+C to stop. Game script falls back to the GitHub CDN")
    print("  automatically whenever this is off.\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
        srv.server_close()


if __name__ == "__main__":
    main()
