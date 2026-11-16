import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

# A protocol peer, not a tuicr mock: exercise the actual POSIX bridge's framed
# transport, remote addressing, key bytes, failure handling, and pipe cleanup.
CORE = r"""#!/usr/bin/env python3
import json, os, pathlib, struct, sys

root = pathlib.Path(os.environ["FIXTURE"])
failure = os.environ.get("FAILURE")

def frame(channel, payload):
    return struct.pack("<IBI", channel, 0, len(payload)) + payload

def receive():
    channel, kind, size = struct.unpack("<IBI", sys.stdin.buffer.read(9))
    assert kind == 0
    return channel, sys.stdin.buffer.read(size)

if sys.argv[1] == "connect":
    hello = json.loads(sys.stdin.buffer.readline())
    assert hello["params"]["framed"] is True
    if failure == "hello":
        print('{"id":0,"error":{"message":"handshake failed"}}', flush=True)
        sys.exit()
    print('{"id":0,"result":{}}', flush=True)
    channel, request = receive()
    assert channel == 0
    (root / "attach.json").write_bytes(request)
    if failure == "attach":
        reply = b'{"id":1,"error":{"message":"terminal unavailable"}}'
    else:
        reply = b'{"id":1,"result":{"channel":513}}'
    for byte in frame(0, reply):
        sys.stdout.buffer.write(bytes([byte]))
        sys.stdout.buffer.flush()
    if failure == "attach":
        sys.exit()
    channel, data = receive()
    assert channel == 513
    with (root / "ready").open("w") as ready:
        json.dump({"keys": data.hex()}, ready)
    sys.stdin.buffer.read()
elif sys.argv[1] == "wait":
    with (root / "ready").open() as ready:
        result = json.load(ready)
    result["args"] = sys.argv[2:]
    print(json.dumps(result))
else:
    raise AssertionError(sys.argv)
"""


class QuitBridgeTests(unittest.TestCase):
    def setUp(self):
        preferred = Path("/tmp/opencode")
        self.work = tempfile.TemporaryDirectory(
            prefix="tuicr-quit-test-", dir=preferred if preferred.is_dir() else None
        )
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name)
        (self.root / "scratch").mkdir()
        hc = self.root / "hc"
        hc.write_text(CORE)
        hc.chmod(0o755)
        os.mkfifo(self.root / "ready")
        self.attach = {
            "jsonrpc": "2.0", "id": 1, "method": "terminal.attach",
            "params": {"terminal": "dev/t9", "cols": 85, "rows": 61, "history": 0},
        }

    def run_bridge(self, failure=""):
        result = subprocess.run(
            ["sh", str(ROOT / "mods/tuicr-review/quit.sh"), "dev/t9", json.dumps(self.attach)],
            env={**os.environ, "PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}",
                 "FIXTURE": str(self.root), "TMPDIR": str(self.root / "scratch"),
                 "FAILURE": failure},
            text=True, capture_output=True, timeout=10,
        )
        self.assertEqual(list((self.root / "scratch").iterdir()), [])
        return result

    def test_save_quit_preserves_size_and_declines_clipboard_export(self):
        result = self.run_bridge()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / "attach.json").read_text()), self.attach)
        output = json.loads(result.stdout)
        self.assertEqual(bytes.fromhex(output["keys"]), b"\x1b[27u:wq\rn")
        self.assertEqual(output["args"], ["dev/t9", "--timeout", "3", "--json"])

    def test_handshake_failure_is_reported_without_attaching(self):
        result = self.run_bridge("hello")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("handshake failed", result.stderr)
        self.assertFalse((self.root / "attach.json").exists())

    def test_attach_failure_is_reported_without_sending_input(self):
        result = self.run_bridge("attach")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("terminal unavailable", result.stderr)


if __name__ == "__main__":
    unittest.main()
