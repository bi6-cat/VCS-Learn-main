#!/usr/bin/env python3
import argparse
import json
import os
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def _send_json(self):
        data = {
            "message": "Request đã đi qua Nginx tới backend",
            "worker": self.server.worker_name,
            "pid": os.getpid(),
            "port": self.server.server_port,
            "method": self.command,
            "path": self.path,
        }
        payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    do_GET = _send_json
    do_POST = _send_json
    do_HEAD = _send_json

    def log_message(self, fmt, *args):
        print(f"[{self.server.worker_name}] {fmt % args}", flush=True)


parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--name", required=True)
args = parser.parse_args()

server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
server.worker_name = args.name


def stop(_signum, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)

print(f"[{args.name}] PID={os.getpid()} lắng nghe tại 127.0.0.1:{args.port}", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
    print(f"[{args.name}] đã dừng", flush=True)
