#!/usr/bin/env python3
import argparse
import json
import os
import signal
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        status = 200

        # Các endpoint phụ trợ chỉ phục vụ bài lab Nginx nâng cao.
        if parsed.path == "/slow":
            try:
                delay = min(max(float(query.get("seconds", ["3"])[0]), 0), 15)
            except ValueError:
                delay = 3
            time.sleep(delay)

        if parsed.path.startswith("/status/"):
            try:
                status = int(parsed.path.rsplit("/", 1)[1])
            except ValueError:
                status = 400
            if status < 200 or status > 599:
                status = 400

        # worker_00 cố tình lỗi, worker_01 thành công để quan sát proxy retry.
        if parsed.path == "/unstable" and self.server.server_port == 9000:
            status = 503

        data = {
            "message": "Request đã đi qua Nginx tới backend",
            "worker": self.server.worker_name,
            "pid": os.getpid(),
            "port": self.server.server_port,
            "method": self.command,
            "path": self.path,
            "status": status,
            "generated_at": time.time(),
            "forwarded_headers": {
                "host": self.headers.get("Host"),
                "x_real_ip": self.headers.get("X-Real-IP"),
                "x_forwarded_for": self.headers.get("X-Forwarded-For"),
                "x_forwarded_proto": self.headers.get("X-Forwarded-Proto"),
                "x_request_id": self.headers.get("X-Request-ID"),
            },
        }

        if parsed.path == "/large":
            try:
                size_kb = min(max(int(query.get("kb", ["128"])[0]), 1), 1024)
            except ValueError:
                size_kb = 128
            data["blob"] = "x" * (size_kb * 1024)

        payload = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
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
