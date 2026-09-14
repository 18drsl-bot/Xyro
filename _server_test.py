#!/usr/bin/env python3
"""Smoke-test the local tag server: config, media, headers, error paths."""
import json
import subprocess
import sys
import time
import urllib.request

BASE = "http://localhost:8619"


def get(path, expect=200):
    try:
        r = urllib.request.urlopen(BASE + path, timeout=5)
        return r.status, r.read(), {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), {k.lower(): v for k, v in e.headers.items()}


def wait_up(deadline=10.0):
    end = time.time() + deadline
    while time.time() < end:
        try:
            get("/nametags.json", 200)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    proc = subprocess.Popen([sys.executable, "_server.py"], cwd=".",
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    ok = True
    try:
        if not wait_up():
            print("FAIL: server did not come up")
            return 1
        print("server up")

        st, body, hdrs = get("/nametags.json")
        cfg = json.loads(body)
        assert st == 200 and isinstance(cfg, dict), (st, type(cfg))
        assert isinstance(cfg.get("tags"), list), "tags missing"
        assert hdrs.get("cache-control") == "no-store", hdrs.get("cache-control")
        print("config: OK (%d rules, no-store)" % len(cfg["tags"]))

        import os
        media = sorted(os.listdir("media"))
        if media:
            st, body, _ = get("/media/" + media[0])
            assert st == 200 and len(body) > 0, (st, len(body))
            print("media : OK (%s, %d bytes)" % (media[0], len(body)))
        else:
            print("media : none in folder, skipped")

        st, body, _ = get("/does-not-exist")
        assert st == 404, st
        print("404   : OK")

        # / must serve the tag editor itself (index.html from this folder)
        st, body, hdrs = get("/")
        text = body.decode("utf-8", "replace")
        assert st == 200 and "<html" in text.lower(), (st, len(body))
        assert hdrs.get("content-type", "").startswith("text/html"), hdrs.get("content-type")
        assert "Xyro" in text or "xyro" in text.lower(), "editor html marker missing"
        print("editor: OK (/ serves index.html as %s)" % hdrs.get("content-type"))

        # /sync must update the local file and reject garbage
        import urllib.request as ur
        cfg0 = open("nametags.json", "rb").read()
        bad = json.dumps({"oops": True}).encode()
        try:
            ur.urlopen(ur.Request(BASE + "/sync", data=bad, headers={"Content-Type": "application/json"}), timeout=5)
            print("FAIL: /sync accepted garbage")
            return 1
        except urllib.error.HTTPError as e:
            assert e.code == 400, e.code
        sync_payload = cfg0 if cfg0.endswith(b"\n") else cfg0 + b"\n"
        r = ur.urlopen(ur.Request(BASE + "/sync", data=sync_payload, headers={"Content-Type": "application/json"}), timeout=5)
        assert r.status == 200
        assert open("nametags.json", "rb").read() == sync_payload
        print("sync  : OK (round-trip identical, garbage rejected)")
        print("\nALL PASS")
        return 0
    except Exception as e:
        ok = False
        print("FAIL: %r" % e)
        return 1
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
