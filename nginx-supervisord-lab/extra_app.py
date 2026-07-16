#!/usr/bin/env python3
import json
import os
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        payload = json.dumps({
            "message": "Extra app đang chạy qua Supervisord",
            "pid": os.getpid(),
            "port": 9100,
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):
        print(f"[extra_app] {fmt % args}", flush=True)


server = ThreadingHTTPServer(("127.0.0.1", 9100), Handler)


def stop(_signum, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
print(f"[extra_app] PID={os.getpid()} lắng nghe tại 127.0.0.1:9100", flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    server.server_close()
