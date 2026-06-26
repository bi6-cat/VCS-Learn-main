# HAProxy — Tổng Quan & Lab Thực Hành

> **Môi trường:** Ubuntu 22.04 LTS | HAProxy 2.6+  
> **Yêu cầu:** Đã hoàn thành lab Nginx (biết reverse proxy, SSL cơ bản)

---

## Phần 1 — Lý Thuyết

### 1.1 HAProxy là gì?

**HAProxy** (High Availability Proxy) là open-source proxy và load balancer hiệu năng cao, chuyên dụng cho TCP và HTTP. Ra đời năm 2000 bởi Willy Tarreau, hiện là tiêu chuẩn ngành cho load balancing.

Khác với Nginx (web server kiêm proxy), HAProxy **chỉ làm proxy/LB** — không serve static files, không có web server features. Nhờ vậy nó tối ưu hoàn toàn cho nhiệm vụ này.

**Ai dùng HAProxy:** GitHub, Twitter, Reddit, Stack Overflow, Airbnb.

---

### 1.2 Load Balancer là gì?

Load Balancer (LB) là thành phần phân phối traffic đến từ client sang nhiều server backend, nhằm:

- **Tăng khả năng chịu tải** — nhiều server cùng xử lý thay vì 1
- **High Availability** — 1 server chết, traffic tự chuyển sang server khác
- **Horizontal Scaling** — thêm server mới không cần downtime
- **Health Checking** — tự phát hiện server lỗi và loại khỏi pool

```
                     ┌─────────────┐
                     │             │──→ Backend 1 (healthy)
Client ──→  [LB]  ──→│  LB decides │──→ Backend 2 (healthy)
                     │             │──→ Backend 3 (down ✗, bỏ qua)
                     └─────────────┘
```

---

### 1.3 Layer 4 vs Layer 7 Load Balancing

Đây là kiến thức nền tảng và hay hỏi trong phỏng vấn.

#### OSI Model liên quan

```
Layer 7 — Application   HTTP, HTTPS, SMTP, DNS
Layer 6 — Presentation  SSL/TLS encryption
Layer 5 — Session
Layer 4 — Transport     TCP, UDP (port numbers)
Layer 3 — Network       IP addresses
Layer 2 — Data Link     MAC addresses
Layer 1 — Physical      Cables, signals
```

#### Layer 4 Load Balancing (Transport Layer)

- Hoạt động ở tầng **TCP/UDP**
- Nhìn thấy: **IP nguồn, IP đích, port nguồn, port đích**
- **Không đọc** nội dung HTTP (URL, headers, cookies)
- Quyết định route dựa trên IP + port
- **Nhanh hơn** vì không cần parse HTTP
- Hoạt động như **TCP proxy** — forward raw bytes

```
Client:5000 → LB:80 → Backend1:8080
                     (LB không biết đây là GET /api hay POST /login)
```

**Dùng khi:** Database clustering (MySQL, Redis), SMTP, non-HTTP protocols, cần performance tối đa.

#### Layer 7 Load Balancing (Application Layer)

- Hoạt động ở tầng **HTTP/HTTPS**
- Nhìn thấy: **URL path, headers, cookies, request body, hostname**
- Có thể quyết định route dựa trên nội dung request
- **Chậm hơn** một chút (phải parse HTTP) nhưng **thông minh hơn nhiều**
- Có thể: rewrite URL, inject headers, terminate SSL, cache

```
Client → LB → phân tích request:
  GET  /api/*      → API servers
  GET  /static/*   → CDN/File servers
  POST /upload/*   → Upload servers (RAM lớn)
  Host: admin.*    → Admin servers (private network)
```

**Dùng khi:** Web applications, microservices, API gateway, cần routing thông minh.

#### So sánh trực tiếp

| Tiêu chí | Layer 4 | Layer 7 |
|---------|---------|---------|
| Tầng OSI | Transport (TCP/UDP) | Application (HTTP) |
| Thấy được | IP, Port | URL, Headers, Cookies, Body |
| Tốc độ | Nhanh hơn | Chậm hơn một chút |
| Routing | Chỉ theo IP/Port | Theo nội dung request |
| SSL | Passthrough (không giải mã) | Termination (giải mã được) |
| Sticky session | Chỉ bằng IP | IP hoặc Cookie |
| Logging | IP:Port | Full HTTP request |
| Usecase | DB, non-HTTP | Web app, API, microservices |
| HAProxy config | `mode tcp` | `mode http` |

---

### 1.4 HAProxy vs Nginx — Khi nào dùng cái nào?

| Tiêu chí | HAProxy | Nginx |
|---------|---------|-------|
| Chuyên môn | Load balancing / Proxy | Web server + Proxy |
| Health check | Active (chủ động ping backend) | Passive (chờ request fail) |
| Stats dashboard | Built-in web UI | Cần module thêm |
| Config syntax | Rõ ràng, dễ debug LB | Phức tạp hơn cho LB |
| Static files | Không serve được | Serve được |
| Protocols | TCP, HTTP, gRPC | HTTP, TCP (stream module) |
| Stick tables | Built-in | Không có |
| Khi dùng | Cần LB chuyên nghiệp | Cần web server + LB đơn giản |

**Thực tế:** Nhiều hệ thống dùng cả hai — HAProxy làm LB phía trước, Nginx làm web server/reverse proxy phía sau.

```
Internet → HAProxy (LB) → Nginx (web server) → App
```

---

### 1.5 Kiến trúc HAProxy

```
                 ┌────────────────────────────────────┐
                 │            HAProxy                 │
                 │                                    │
  Client ───────→│  Frontend  →  ACL  →  Backend      │──→ Server 1
  Client ───────→│  (listen)     (rules)  (pool)      │──→ Server 2
  Client ───────→│                                    │──→ Server 3
                 └────────────────────────────────────┘
```

**4 thành phần chính:**

- **Global:** Cấu hình process-level (logging, user, limits)
- **Defaults:** Giá trị mặc định cho frontend/backend
- **Frontend:** Nơi HAProxy lắng nghe connections từ client
- **Backend:** Nhóm servers xử lý request

---

## Phần 2 — Cài Đặt & Cấu Hình Cơ Bản

### Bước 1: Cài HAProxy

```bash
sudo apt update
sudo apt install haproxy -y

# Kiểm tra version
haproxy -v
# HAProxy version 2.6.x

# Kiểm tra trạng thái
sudo systemctl status haproxy

# Test config
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
```

### Bước 2: Cấu trúc file config

```bash
# File config chính
cat /etc/haproxy/haproxy.cfg
```

```haproxy
#---------------------------------------------------------------------
# Global settings
#---------------------------------------------------------------------
global
    log /dev/log local0          # Gửi log đến syslog
    log /dev/log local1 notice
    chroot /var/lib/haproxy      # Chroot jail (bảo mật)
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon                       # Chạy background

#---------------------------------------------------------------------
# Defaults — áp dụng cho mọi frontend/backend nếu không override
#---------------------------------------------------------------------
defaults
    log     global
    mode    http                 # http hoặc tcp
    option  httplog              # Log đầy đủ HTTP request
    option  dontlognull          # Không log health checks
    timeout connect 5s           # Timeout kết nối đến backend
    timeout client  50s          # Timeout từ client
    timeout server  50s          # Timeout từ backend server
    errorfile 400 /etc/haproxy/errors/400.http
    errorfile 503 /etc/haproxy/errors/503.http
```

---

## Lab 1 — Layer 7 HTTP Load Balancer

**Mục tiêu:** HAProxy phân phối HTTP traffic đến 3 backend servers.

### Bước 1: Tạo 3 backend servers

```bash
# Tạo 3 backend Python servers trên port 8001, 8002, 8003
for port in 8001 8002 8003; do
cat > /tmp/backend_${port}.py << EOF
from http.server import HTTPServer, BaseHTTPRequestHandler

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        msg = f"Response from Backend on port ${port} | Path: {self.path}\n"
        self.wfile.write(msg.encode())
    def log_message(self, *args): pass

HTTPServer(('127.0.0.1', ${port}), Handler).serve_forever()
EOF
done

# Chạy 3 backends
python3 /tmp/backend_8001.py &
python3 /tmp/backend_8002.py &
python3 /tmp/backend_8003.py &

# Verify
curl http://127.0.0.1:8001/test
curl http://127.0.0.1:8002/test
curl http://127.0.0.1:8003/test
```

### Bước 2: Config HAProxy Layer 7

```bash
sudo tee /etc/haproxy/haproxy.cfg << 'EOF'
global
    log /dev/log local0
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    user haproxy
    group haproxy
    daemon

defaults
    mode    http
    log     global
    option  httplog
    option  dontlognull
    option  forwardfor          # Thêm X-Forwarded-For header
    option  http-server-close   # Close connection đến server sau mỗi request
    timeout connect 5s
    timeout client  30s
    timeout server  30s

#---------------------------------------------------------------------
# Frontend — lắng nghe port 80
#---------------------------------------------------------------------
frontend http_frontend
    bind *:80
    default_backend web_servers

#---------------------------------------------------------------------
# Backend — pool 3 servers, round robin
#---------------------------------------------------------------------
backend web_servers
    balance roundrobin
    server backend1 127.0.0.1:8001 check
    server backend2 127.0.0.1:8002 check
    server backend3 127.0.0.1:8003 check
    # "check" = bật active health checking

EOF

sudo haproxy -c -f /etc/haproxy/haproxy.cfg   # Validate
sudo systemctl restart haproxy
```

### Bước 3: Test Round Robin

```bash
# Gọi 6 lần → thấy rotate qua 3 backends
for i in {1..6}; do
    curl -s http://localhost/hello
done

# Output:
# Response from Backend on port 8001 | Path: /hello
# Response from Backend on port 8002 | Path: /hello
# Response from Backend on port 8003 | Path: /hello
# Response from Backend on port 8001 | Path: /hello
# ...
```

---

## Lab 2 — Stats Dashboard & Health Check

### Bước 1: Bật Stats UI

Thêm vào `haproxy.cfg`:

```haproxy
#---------------------------------------------------------------------
# Stats Dashboard
#---------------------------------------------------------------------
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 5s              # Auto-refresh mỗi 5 giây
    stats show-legends
    stats show-node
    stats auth admin:secret123    # username:password
    stats admin if TRUE           # Cho phép enable/disable server từ UI
```

```bash
sudo systemctl reload haproxy

# Mở browser: http://localhost:8404/stats
# Login: admin / secret123
```

### Bước 2: Quan sát Health Check

```bash
# Kill một backend để test
kill $(lsof -t -i:8002)

# Chờ vài giây, HAProxy tự phát hiện backend2 down
# Refresh stats UI → backend2 chuyển sang màu đỏ

# Gọi nhiều lần → chỉ route đến backend1 và backend3
for i in {1..6}; do curl -s http://localhost/test; done

# Khởi động lại backend2
python3 /tmp/backend_8002.py &
# Vài giây sau → HAProxy tự thêm lại vào rotation
```

### Bước 3: Cấu hình Health Check nâng cao

```haproxy
backend web_servers
    balance roundrobin
    option httpchk GET /health HTTP/1.1\r\nHost:\ localhost
    # Thay vì chỉ check TCP connect, gửi HTTP request đến /health

    server backend1 127.0.0.1:8001 check inter 2s rise 2 fall 3
    server backend2 127.0.0.1:8002 check inter 2s rise 2 fall 3
    server backend3 127.0.0.1:8003 check inter 2s rise 2 fall 3
    # inter 2s  = check mỗi 2 giây
    # rise 2    = cần 2 lần thành công liên tiếp để đánh dấu UP
    # fall 3    = cần 3 lần thất bại liên tiếp để đánh dấu DOWN
```

---

## Lab 3 — Các Thuật Toán Load Balancing

### Round Robin (mặc định)

```haproxy
backend rr_backend
    balance roundrobin
    server s1 127.0.0.1:8001 check
    server s2 127.0.0.1:8002 check
    server s3 127.0.0.1:8003 check
```

### Weighted Round Robin

```haproxy
backend weighted_backend
    balance roundrobin
    server s1 127.0.0.1:8001 weight 5 check   # Nhận 5/8 requests
    server s2 127.0.0.1:8002 weight 2 check   # Nhận 2/8 requests
    server s3 127.0.0.1:8003 weight 1 check   # Nhận 1/8 requests
```

### Least Connections

```haproxy
backend leastconn_backend
    balance leastconn
    # Gửi đến server có ít active connections nhất
    # Tốt cho long-lived connections (WebSocket, DB)
    server s1 127.0.0.1:8001 check
    server s2 127.0.0.1:8002 check
```

### Source IP Hash (Session Persistence)

```haproxy
backend iphash_backend
    balance source
    # Hash IP client → cùng IP luôn đến cùng server
    # Giải quyết session stickiness đơn giản
    server s1 127.0.0.1:8001 check
    server s2 127.0.0.1:8002 check
```

### Cookie-Based Sticky Session (tốt hơn IP hash)

```haproxy
backend sticky_backend
    balance roundrobin
    cookie SERVER_ID insert indirect nocache
    # HAProxy tự chèn cookie SERVER_ID vào response
    # Lần sau client gửi cookie → route đến đúng server
    server s1 127.0.0.1:8001 check cookie s1
    server s2 127.0.0.1:8002 check cookie s2
    server s3 127.0.0.1:8003 check cookie s3
```

```bash
# Test sticky session
curl -c /tmp/cookies.txt http://localhost/   # Lần 1 — nhận cookie
curl -b /tmp/cookies.txt http://localhost/   # Lần 2 — luôn cùng backend
curl -b /tmp/cookies.txt http://localhost/   # Lần 3 — vẫn cùng backend

cat /tmp/cookies.txt   # Thấy cookie SERVER_ID
```

---

## Lab 4 — Layer 4 TCP Load Balancing

**Mục tiêu:** Load balance TCP (không đọc HTTP content), ứng dụng cho database, Redis, bất kỳ TCP service nào.

### Bước 1: Tạo TCP backend servers

```bash
# Dùng netcat làm TCP server đơn giản
# Terminal 1
while true; do echo "Backend TCP port 9001" | nc -l 9001; done &

# Terminal 2
while true; do echo "Backend TCP port 9002" | nc -l 9002; done &
```

### Bước 2: Config HAProxy TCP mode

```haproxy
frontend tcp_frontend
    bind *:9000
    mode tcp                     # ← Key difference: tcp không phải http
    option tcplog                # Log TCP connections
    default_backend tcp_servers

backend tcp_servers
    mode tcp                     # Backend cũng phải là tcp
    balance roundrobin
    option tcp-check             # Health check bằng TCP connect
    server tcp1 127.0.0.1:9001 check
    server tcp2 127.0.0.1:9002 check
```

```bash
sudo systemctl reload haproxy

# Test TCP load balancing
nc localhost 9000   # Kết nối qua LB → nhận từ một trong 2 backends
nc localhost 9000   # Kết nối lần 2 → backend còn lại
```

### Bước 3: MySQL Load Balancing (ví dụ thực tế)

```haproxy
# Usecase thực tế: MySQL read replicas
frontend mysql_frontend
    bind *:3306
    mode tcp
    option tcplog
    timeout client 1h
    default_backend mysql_replicas

backend mysql_replicas
    mode tcp
    balance leastconn            # leastconn tốt hơn roundrobin cho DB
    option tcp-check
    timeout connect 10s
    timeout server 1h
    server mysql-read1 10.0.0.1:3306 check
    server mysql-read2 10.0.0.2:3306 check
    server mysql-read3 10.0.0.3:3306 check backup  # backup: chỉ dùng khi hết server
```

---

## Lab 5 — ACL & Content-Based Routing (Layer 7 nâng cao)

**Mục tiêu:** Route request đến backend khác nhau dựa trên URL path, hostname, header.

### Bước 1: Tạo các backend chuyên biệt

```bash
# API backend (port 8001)
cat > /tmp/api_backend.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.end_headers()
        self.wfile.write(b'{"service":"API","status":"ok"}')
    def log_message(self,*a): pass
HTTPServer(('127.0.0.1',8001),H).serve_forever()
EOF

# Static backend (port 8002)
cat > /tmp/static_backend.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','text/html')
        self.end_headers()
        self.wfile.write(b'<h1>Static Content Server</h1>')
    def log_message(self,*a): pass
HTTPServer(('127.0.0.1',8002),H).serve_forever()
EOF

# Admin backend (port 8003)
cat > /tmp/admin_backend.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','text/plain')
        self.end_headers()
        self.wfile.write(b'Admin Panel - Restricted')
    def log_message(self,*a): pass
HTTPServer(('127.0.0.1',8003),H).serve_forever()
EOF

python3 /tmp/api_backend.py &
python3 /tmp/static_backend.py &
python3 /tmp/admin_backend.py &
```

### Bước 2: Config ACL routing

```haproxy
frontend http_frontend
    bind *:80
    mode http
    option httplog

    # ── Định nghĩa ACL ──────────────────────────────
    acl is_api      path_beg /api/            # URL bắt đầu bằng /api/
    acl is_static   path_beg /static/         # URL bắt đầu bằng /static/
    acl is_admin    path_beg /admin/          # URL bắt đầu bằng /admin/
    acl is_admin    hdr(host) -i admin.local  # HOẶC hostname là admin.local

    acl is_get      method GET
    acl is_post     method POST
    acl has_auth    hdr_cnt(Authorization) gt 0  # Có Authorization header

    # Block user agent cụ thể
    acl bad_bot     hdr_sub(User-Agent) -i badbot scrapy

    # ── Apply rules theo thứ tự (first match wins) ──
    http-request deny if bad_bot
    use_backend admin_servers if is_admin
    use_backend api_servers   if is_api
    use_backend static_servers if is_static
    default_backend api_servers   # Fallback

#---------------------------------------------------------------------
frontend https_frontend
    bind *:443 ssl crt /etc/haproxy/certs/combined.pem
    mode http
    # Redirect HTTP host đến admin backend
    acl is_admin_host hdr(host) -i admin.mysite.com
    use_backend admin_servers if is_admin_host
    default_backend api_servers

#---------------------------------------------------------------------
backend api_servers
    mode http
    balance roundrobin
    option forwardfor
    http-request set-header X-Backend-Name api
    server api1 127.0.0.1:8001 check

backend static_servers
    mode http
    balance roundrobin
    server static1 127.0.0.1:8002 check

backend admin_servers
    mode http
    # Chỉ cho phép IP nội bộ truy cập admin
    acl allowed_ip src 127.0.0.1 192.168.0.0/16
    http-request deny unless allowed_ip
    server admin1 127.0.0.1:8003 check
```

```bash
sudo systemctl reload haproxy

# Test routing
curl http://localhost/api/users          # → API server
curl http://localhost/static/style.css   # → Static server
curl http://localhost/admin/             # → Admin (từ localhost → được phép)
curl http://localhost/random             # → Fallback: API server

# Test hostname routing
curl -H "Host: admin.local" http://localhost/   # → Admin server
```

---

## Lab 6 — HTTPS / SSL Termination

**Mục tiêu:** HAProxy nhận HTTPS từ client, giải mã SSL, forward HTTP đến backend.

### Bước 1: Tạo certificate

```bash
# Tạo self-signed cert
sudo mkdir -p /etc/haproxy/certs

sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/haproxy/certs/site.key \
    -out    /etc/haproxy/certs/site.crt \
    -subj "/CN=mysite.local"

# HAProxy cần cert + key gộp vào 1 file (PEM bundle)
sudo cat /etc/haproxy/certs/site.crt \
         /etc/haproxy/certs/site.key \
    | sudo tee /etc/haproxy/certs/combined.pem

sudo chmod 600 /etc/haproxy/certs/combined.pem
```

### Bước 2: Config SSL termination

```haproxy
global
    log /dev/log local0
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    user haproxy
    group haproxy
    daemon
    # Tuning SSL
    ssl-default-bind-ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    ssl-default-bind-options ssl-min-ver TLSv1.2 no-tls-tickets

defaults
    mode    http
    log     global
    option  httplog
    option  forwardfor
    option  http-server-close
    timeout connect 5s
    timeout client  30s
    timeout server  30s

# ── HTTP → HTTPS redirect ──────────────────────────
frontend http_redirect
    bind *:80
    mode http
    http-request redirect scheme https code 301

# ── HTTPS frontend ─────────────────────────────────
frontend https_frontend
    bind *:443 ssl crt /etc/haproxy/certs/combined.pem
    mode http
    option httplog

    # Thêm security headers
    http-response set-header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    http-response set-header X-Content-Type-Options "nosniff"
    http-response set-header X-Frame-Options "SAMEORIGIN"

    # Inject header để backend biết request đến qua HTTPS
    http-request set-header X-Forwarded-Proto https

    default_backend web_servers

backend web_servers
    mode http
    balance roundrobin
    option forwardfor
    server s1 127.0.0.1:8001 check
    server s2 127.0.0.1:8002 check

# ── Stats ──────────────────────────────────────────
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 5s
    stats auth admin:secret123
```

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
sudo systemctl restart haproxy

# Test
curl -k https://localhost/           # → HTTPS works
curl -I http://localhost/            # → 301 redirect to HTTPS

# Xem cert info
echo | openssl s_client -connect localhost:443 2>/dev/null | openssl x509 -noout -subject -dates
```

### SSL Passthrough (Layer 4 — không giải mã)

```haproxy
# Dùng khi muốn backend tự xử lý SSL (end-to-end encryption)
frontend ssl_passthrough
    bind *:443
    mode tcp                         # tcp mode, không giải mã
    option tcplog
    tcp-request inspect-delay 5s
    tcp-request content accept if { req_ssl_hello_type 1 }

    # Route theo SNI (Server Name Indication — domain trong TLS handshake)
    use_backend app1_ssl if { req_ssl_sni -i app1.example.com }
    use_backend app2_ssl if { req_ssl_sni -i app2.example.com }

backend app1_ssl
    mode tcp
    server app1 10.0.0.1:443 check

backend app2_ssl
    mode tcp
    server app2 10.0.0.2:443 check
```

---

## Lab 7 — HAProxy làm Reverse Proxy (Giống Nginx lab cũ nhưng với HAProxy)

```bash
# Khởi động backend app (từ Nginx lab hoặc tạo mới)
python3 /tmp/api_backend.py &   # port 8001
```

```haproxy
frontend app_frontend
    bind *:80
    mode http
    option httplog
    option forwardfor

    # Thêm request ID để trace
    http-request set-header X-Request-ID %[uuid()]

    default_backend app_pool

backend app_pool
    mode http
    balance leastconn
    option httpchk GET /health
    http-check expect status 200

    # Timeout riêng cho backend này
    timeout connect 5s
    timeout server  60s

    # Retry khi backend lỗi
    retry-on conn-failure empty-response 503
    retries 2

    server app1 127.0.0.1:8001 check inter 3s
    server app2 127.0.0.1:8002 check inter 3s
    server app3 127.0.0.1:8003 check inter 3s backup
```

---

## Tổng Kết & Checklist

### Kiến thức cần nắm

- [ ] Hiểu LB là gì, giải quyết vấn đề gì
- [ ] Phân biệt được Layer 4 vs Layer 7 (cơ chế, usecase, config `mode tcp` vs `mode http`)
- [ ] HAProxy: Frontend → ACL → Backend
- [ ] Các thuật toán: roundrobin, leastconn, source, cookie sticky
- [ ] Active health check (khác passive của Nginx)
- [ ] SSL termination với PEM bundle
- [ ] ACL routing theo path, hostname, header

### Labs đã hoàn thành

- [ ] Lab 1: HTTP LB cơ bản, round robin
- [ ] Lab 2: Stats dashboard, health check
- [ ] Lab 3: Các thuật toán LB, sticky session
- [ ] Lab 4: Layer 4 TCP mode
- [ ] Lab 5: ACL content-based routing
- [ ] Lab 6: HTTPS termination
- [ ] Lab 7: Full reverse proxy setup

### Câu hỏi phỏng vấn nhanh

**Q: Layer 4 vs Layer 7 LB khác nhau chỗ nào?**
> Layer 4 hoạt động ở TCP/UDP, chỉ thấy IP và port, không đọc HTTP content, nhanh hơn. Layer 7 đọc được HTTP (URL, headers, cookies), có thể route thông minh theo nội dung, terminate SSL, nhưng tốn CPU hơn.

**Q: Sticky session là gì? Khi nào cần?**
> Đảm bảo cùng 1 client luôn đến cùng 1 backend — cần khi app lưu session state tại server (không dùng Redis). HAProxy làm bằng cookie (`cookie insert`) hoặc IP hash (`balance source`). Cookie tốt hơn vì client có thể đổi IP (mobile).

**Q: Active vs Passive health check?**
> Passive: chờ request thật fail rồi mới đánh dấu server down (Nginx mặc định). Active: chủ động gửi health check request định kỳ đến backend, phát hiện lỗi sớm hơn không cần chờ user bị ảnh hưởng (HAProxy mặc định với `check`).

**Q: SSL Termination vs SSL Passthrough?**
> Termination: LB giải mã SSL, forward HTTP đến backend — backend đơn giản, LB quản lý cert tập trung. Passthrough: LB forward raw TLS bytes, backend tự giải mã — end-to-end encryption nhưng LB không thể đọc HTTP content (chỉ dùng Layer 4).

### Lệnh thường dùng

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg   # Validate config
sudo systemctl reload haproxy                  # Graceful reload
sudo systemctl restart haproxy                 # Hard restart

# Xem stats qua socket (không cần web UI)
echo "show info" | sudo socat stdio /run/haproxy/admin.sock
echo "show stat" | sudo socat stdio /run/haproxy/admin.sock | column -t -s,

# Enable/disable server runtime (không reload config)
echo "disable server web_servers/backend2" | sudo socat stdio /run/haproxy/admin.sock
echo "enable server web_servers/backend2"  | sudo socat stdio /run/haproxy/admin.sock

# Xem log realtime
sudo journalctl -u haproxy -f
sudo tail -f /var/log/haproxy.log
```

### Dọn dẹp

```bash
kill $(lsof -t -i:8001) $(lsof -t -i:8002) $(lsof -t -i:8003) 2>/dev/null
sudo systemctl stop haproxy
```
