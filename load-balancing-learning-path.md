# 🗺️ Lộ Trình Học: Distributed System — Load Balancing
> **Mục tiêu:** Hiểu sâu cốt lõi từ cơ bản → gần nâng cao  
> **Phạm vi:** Web Server · Reverse Proxy · Nginx · HAProxy · Load Balancing L4/L7  
> **Cập nhật:** 2026-05-09

---

## 📌 Nguyên tắc học

- ✅ Học lý thuyết → Lab tay → Giải thích lại bằng lời của mình
- ✅ Mỗi mục phải **hiểu được "tại sao"**, không chỉ "làm như thế nào"
- ✅ Ghi chú lại những điều **ngạc nhiên / dễ nhầm**
- ✅ Đánh dấu `[x]` khi hoàn thành, ghi ngày hoàn thành

---

## 🧱 PHẦN 1 — NỀN TẢNG HTTP & MẠNG (Bắt buộc trước)

> Đây là **cốt lõi cốt lõi**. Nếu bỏ qua phần này, mọi thứ sau sẽ học vẹt.

### 1.1 HTTP Protocol
- [ ] HTTP là gì? Client-Server model hoạt động thế nào?
- [ ] HTTP Request / Response anatomy (method, headers, body, status code)
- [ ] HTTP/1.0 vs HTTP/1.1 vs HTTP/2 vs HTTP/3 — **khác nhau cốt lõi là gì?**
- [ ] Keep-Alive connection là gì? Tại sao quan trọng với LB?
- [ ] Stateless protocol — ý nghĩa với load balancing
- [ ] HTTP Headers quan trọng: `Host`, `X-Forwarded-For`, `X-Real-IP`, `Connection`, `Upgrade`

### 1.2 TCP/IP cơ bản (liên quan trực tiếp đến LB L4)
- [ ] TCP 3-way handshake — vẽ được sơ đồ + giải thích
- [ ] TCP connection state: LISTEN, ESTABLISHED, TIME_WAIT, CLOSE_WAIT
- [ ] Socket là gì? `IP:Port` binding
- [ ] Sự khác biệt giữa TCP và UDP — khi nào dùng cái nào?
- [ ] Port number range: well-known (0-1023), registered, dynamic
- [ ] `netstat` / `ss` — đọc được output để debug

### 1.3 DNS cơ bản
- [ ] DNS resolution flow — từ browser đến IP
- [ ] A record, CNAME, TTL
- [ ] DNS và Load Balancing liên quan thế nào? (DNS-based LB)
- [ ] `/etc/hosts` — override DNS local

---

## 🌐 PHẦN 2 — WEB SERVER: NGINX CƠ BẢN

> Hiểu Nginx từ bên trong, không chỉ copy config.

### 2.1 Nginx là gì & kiến trúc
- [ ] Web server là gì? Nginx làm được những gì?
- [ ] **Nginx vs Apache** — Event-driven vs Process/Thread-based → tại sao Nginx xử lý concurrency tốt hơn?
- [ ] Master process vs Worker process — mô hình hoạt động
- [ ] `nginx -t`, `nginx -s reload`, `systemctl` — sự khác biệt reload vs restart
- [ ] Nginx file structure:
  - `/etc/nginx/nginx.conf` — main config
  - `/etc/nginx/conf.d/` — virtual hosts
  - `/etc/nginx/sites-available/` vs `sites-enabled/`
  - `/var/log/nginx/access.log` và `error.log`

### 2.2 Nginx Config — Hiểu cú pháp
- [ ] Directive và Block — `events {}`, `http {}`, `server {}`, `location {}`
- [ ] `listen` directive — port, IPv4, IPv6, `default_server`
- [ ] `server_name` — virtual hosting (nhiều domain trên 1 IP)
- [ ] `root` vs `alias` — khác nhau quan trọng
- [ ] `index` directive
- [ ] `location` block — priority order:
  - Exact match `=`
  - Prefix match (không có ký tự)
  - Regex match `~` và `~*`
  - Best-match prefix `^~`
- [ ] `try_files` — cách hoạt động
- [ ] `return` và `rewrite` — redirect

### 2.3 Lab: Nginx Web Server
- [ ] **Lab 1:** Cài Nginx, serve static HTML từ thư mục custom
- [ ] **Lab 2:** Cấu hình 2 virtual hosts trên cùng máy (dùng `/etc/hosts`)
- [ ] **Lab 3:** Custom error pages (404, 50x)
- [ ] **Lab 4:** Access log format custom — log thêm `$request_time`, `$upstream_addr`

---

## 🔒 PHẦN 3 — SSL/TLS & HTTPS

> Hiểu SSL/TLS là nền tảng để config cert đúng và debug được.

### 3.1 Lý thuyết SSL/TLS
- [ ] HTTPS hoạt động thế nào? (TLS Handshake — vẽ sơ đồ)
- [ ] Symmetric vs Asymmetric encryption — vai trò trong TLS
- [ ] Certificate là gì? Certificate chain (Root CA → Intermediate CA → Leaf cert)
- [ ] Self-signed cert vs CA-signed cert — khi nào dùng gì?
- [ ] TLS 1.2 vs TLS 1.3 — khác nhau chính
- [ ] SNI (Server Name Indication) — tại sao cần thiết với virtual hosting?
- [ ] HTTPS trên port 443 — tại sao? Có thể đổi không?

### 3.2 Nginx SSL Config
- [ ] `ssl_certificate` và `ssl_certificate_key`
- [ ] `ssl_protocols` — chỉ enable TLS 1.2 và 1.3
- [ ] `ssl_ciphers` — cipher suite là gì?
- [ ] HTTP → HTTPS redirect (`return 301 https://...`)
- [ ] HSTS header (`Strict-Transport-Security`)
- [ ] `ssl_session_cache` và `ssl_session_timeout` — tối ưu performance

### 3.3 Lab: SSL/TLS
- [ ] **Lab 1:** Tạo self-signed cert bằng `openssl`, cấu hình Nginx HTTPS
- [ ] **Lab 2:** Cài Let's Encrypt với `certbot` (hoặc dùng `mkcert` cho local lab)
- [ ] **Lab 3:** Verify cert với `openssl s_client -connect host:443`
- [ ] **Lab 4:** Check SSL grade với `curl -vI https://...` và đọc TLS handshake output

---

## 🔄 PHẦN 4 — PROXY: FORWARD PROXY vs REVERSE PROXY

> **Đây là mục hay bị hiểu nhầm nhất.** Phải nắm vững.

### 4.1 Khái niệm cốt lõi
- [ ] **Forward Proxy** là gì?
  - Client biết → proxy không biết → server không biết client thật
  - Use case: kiểm soát internet trong công ty, bypass geo-block, caching
  - Ví dụ: Squid Proxy, corporate proxy
- [ ] **Reverse Proxy** là gì?
  - Client không biết backend thật → proxy biết → backend server
  - Use case: Load balancing, SSL termination, caching, security
  - Ví dụ: Nginx, HAProxy, Traefik, Envoy
- [ ] **So sánh trực quan:**
  ```
  Forward Proxy:  Client → [Proxy] → Internet/Server
                  (Client chủ động cấu hình proxy)

  Reverse Proxy:  Client → [Proxy] → Backend Server(s)
                  (Client không biết backend, chỉ thấy proxy)
  ```
- [ ] Tại sao gọi là "reverse"? — perspective từ phía server
- [ ] Transparent proxy là gì?

### 4.2 Nginx Reverse Proxy
- [ ] `proxy_pass` directive — cú pháp với và không có trailing slash (quan trọng!)
- [ ] `proxy_set_header` — tại sao phải set `Host`, `X-Real-IP`, `X-Forwarded-For`?
- [ ] `proxy_http_version 1.1` — cần cho WebSocket và Keep-Alive
- [ ] `proxy_buffering` — on/off khi nào?
- [ ] `proxy_connect_timeout`, `proxy_read_timeout`, `proxy_send_timeout`
- [ ] `proxy_cache` — caching ở reverse proxy layer
- [ ] **Upstream block** — định nghĩa backend pool

### 4.3 Lab: Reverse Proxy
- [ ] **Lab 1:** Nginx làm reverse proxy cho một app backend (Node.js/Python đơn giản)
- [ ] **Lab 2:** Nginx reverse proxy với SSL termination (HTTPS vào, HTTP ra backend)
- [ ] **Lab 3:** Kiểm tra `X-Forwarded-For` — xem backend nhận được IP gì
- [ ] **Lab 4:** Cấu hình path-based routing (`/api` → backend A, `/web` → backend B)

---

## ⚖️ PHẦN 5 — LOAD BALANCING CƠ BẢN

> Hiểu load balancing là hiểu cách **phân phối traffic một cách thông minh**.

### 5.1 Load Balancing là gì?
- [ ] Tại sao cần Load Balancing? (single point of failure, scalability)
- [ ] Horizontal vs Vertical Scaling — LB thuộc loại nào?
- [ ] LB và High Availability (HA) — liên quan thế nào?
- [ ] **Health Check** — tại sao bắt buộc phải có? Active vs Passive health check

### 5.2 Load Balancing Algorithms
- [ ] **Round Robin** — cách hoạt động, ưu nhược điểm
- [ ] **Weighted Round Robin** — khi backend servers có capacity khác nhau
- [ ] **Least Connections** — gửi đến server ít connection nhất
- [ ] **IP Hash** — session persistence, cùng client → cùng backend
- [ ] **Random** — dùng khi nào?
- [ ] **Least Response Time** — (HAProxy: `leastconn`)
- [ ] Khi nào chọn thuật toán nào? — trade-offs

### 5.3 Session Persistence (Sticky Sessions)
- [ ] Tại sao stateful app gặp vấn đề với LB?
- [ ] Cookie-based persistence vs IP-based
- [ ] Giải pháp tốt hơn: stateless app + external session store (Redis)

### 5.4 Nginx Load Balancing
- [ ] `upstream` block cấu hình
- [ ] `weight`, `max_fails`, `fail_timeout`, `backup` directives
- [ ] `ip_hash` directive
- [ ] Health check trong Nginx (passive — chỉ mark down khi fail)
- [ ] Nginx Plus vs Nginx Open Source — active health check chỉ có trong Plus

### 5.5 Lab: Nginx Load Balancing
- [ ] **Lab 1:** LB 3 backend servers, dùng Round Robin, verify bằng log
- [ ] **Lab 2:** Weighted LB — 1 server mạnh hơn nhận nhiều traffic hơn
- [ ] **Lab 3:** Mô phỏng backend down → Nginx tự động failover
- [ ] **Lab 4:** IP Hash — verify cùng IP luôn đến cùng backend

---

## 🔵 PHẦN 6 — LAYER 4 vs LAYER 7 LOAD BALANCING

> **Đây là kiến thức phân biệt người hiểu thật sự vs hiểu bề mặt.**

### 6.1 OSI Model Review (chỉ những layer liên quan)
- [ ] Layer 4 (Transport): TCP/UDP, port number
- [ ] Layer 7 (Application): HTTP, HTTPS, nội dung request
- [ ] "Layer 4 LB" và "Layer 7 LB" nghĩa là gì?

### 6.2 Layer 4 Load Balancing (L4 LB)
- [ ] **Cách hoạt động:** LB nhìn vào TCP/UDP header (src/dst IP, port) → quyết định forward
- [ ] LB **không đọc** nội dung HTTP request
- [ ] **NAT mode** vs **Direct Server Return (DSR)** vs **Tunneling**
- [ ] Ưu điểm: **rất nhanh**, ít overhead, xử lý được mọi protocol TCP/UDP
- [ ] Nhược điểm: không làm được content-based routing, không SSL termination
- [ ] Use cases: database LB, game server, DNS, bất kỳ TCP/UDP app
- [ ] Công cụ: HAProxy (TCP mode), AWS NLB, LVS (Linux Virtual Server), `ipvs`

### 6.3 Layer 7 Load Balancing (L7 LB)
- [ ] **Cách hoạt động:** LB **đọc HTTP request** (URL, headers, cookies) → quyết định route
- [ ] LB phải terminate connection và tạo connection mới đến backend
- [ ] Ưu điểm: content-based routing, SSL termination, cookie insertion, compression, caching
- [ ] Nhược điểm: overhead cao hơn L4, chỉ dùng được với HTTP/HTTPS
- [ ] Use cases: microservices routing, API gateway, web app LB
- [ ] Công cụ: Nginx, HAProxy (HTTP mode), AWS ALB, Traefik, Envoy

### 6.4 So sánh L4 vs L7
```
Tiêu chí              | L4 LB              | L7 LB
----------------------|--------------------|-------------------
Nhìn vào              | TCP/UDP header     | HTTP headers, body
Tốc độ                | Rất nhanh          | Chậm hơn (nhưng không đáng kể)
SSL Termination       | Không              | Có
Content-based routing | Không              | Có
Giao thức             | Mọi TCP/UDP        | Chủ yếu HTTP/HTTPS
Ví dụ công cụ         | HAProxy TCP mode   | Nginx, HAProxy HTTP mode
AWS equivalent        | NLB                | ALB
```

### 6.5 Lab: L4 vs L7
- [ ] **Lab 1:** HAProxy L4 mode — forward TCP traffic, không đọc HTTP
- [ ] **Lab 2:** HAProxy L7 mode — routing theo URL path (`/api` vs `/web`)
- [ ] **Lab 3:** Dùng `tcpdump` để quan sát sự khác biệt traffic L4 vs L7
- [ ] **Lab 4:** SSL termination tại L7 LB, backend chạy HTTP thuần

---

## 🟠 PHẦN 7 — HAPROXY

> HAProxy là tool LB chuyên nghiệp, mạnh hơn Nginx về LB capabilities.

### 7.1 HAProxy Architecture
- [ ] HAProxy là gì? Tại sao dùng HAProxy thay vì Nginx cho LB?
- [ ] **Frontend** — nhận connection từ client
- [ ] **Backend** — pool of servers
- [ ] **ACL (Access Control List)** — logic routing
- [ ] **Listen** — shorthand cho frontend + backend cùng tên

### 7.2 HAProxy Config Sections
- [ ] `global` — process-level settings (`maxconn`, `log`, `user/group`)
- [ ] `defaults` — default values áp dụng cho tất cả frontend/backend
- [ ] `frontend` — bind port, ACL, use_backend
- [ ] `backend` — server list, algorithm, health check
- [ ] `stats` page — HAProxy admin UI

### 7.3 HAProxy Mode
- [ ] `mode tcp` — L4 load balancing
- [ ] `mode http` — L7 load balancing
- [ ] Khi nào dùng mode nào?

### 7.4 HAProxy Health Checks
- [ ] `check` — basic TCP check
- [ ] `check inter`, `rise`, `fall` — timing parameters
- [ ] HTTP health check — `option httpchk GET /health`
- [ ] `option tcp-check` — custom TCP check sequence

### 7.5 HAProxy ACL & Routing
- [ ] ACL syntax: `acl <name> <criterion> <value>`
- [ ] `hdr(host)` — route theo domain
- [ ] `path_beg`, `path_end`, `path_reg` — route theo URL path
- [ ] `use_backend` — áp dụng ACL
- [ ] `default_backend` — fallback

### 7.6 HAProxy Logging & Stats
- [ ] Log format — đọc được HAProxy log
- [ ] Stats socket — runtime API
- [ ] Stats web UI — enable và đọc metrics

### 7.7 Lab: HAProxy
- [ ] **Lab 1:** HAProxy làm L4 LB cho 3 backend TCP servers
- [ ] **Lab 2:** HAProxy làm L7 LB, routing theo URL path
- [ ] **Lab 3:** HAProxy routing theo domain (virtual hosting + LB)
- [ ] **Lab 4:** Health check — tắt 1 backend, verify HAProxy tự loại ra
- [ ] **Lab 5:** HAProxy Stats page — monitor backend status real-time
- [ ] **Lab 6:** SSL termination tại HAProxy

---

## 🔴 PHẦN 8 — HIGH AVAILABILITY & PRODUCTION PATTERNS

> Khi đã hiểu LB, cần hiểu cách làm cho **chính LB không là SPOF**.

### 8.1 LB bản thân có thể là Single Point of Failure
- [ ] Vấn đề: nếu LB chết thì toàn bộ hệ thống chết
- [ ] Giải pháp: Active-Passive LB pair với Virtual IP (VIP)

### 8.2 Keepalived & VRRP
- [ ] VRRP protocol là gì?
- [ ] Keepalived + HAProxy/Nginx — cách triển khai
- [ ] VIP (Virtual IP) failover — cách hoạt động
- [ ] Active-Passive vs Active-Active

### 8.3 Lab: HA Load Balancer
- [ ] **Lab 1:** 2 HAProxy nodes + Keepalived — failover VIP khi 1 node down
- [ ] **Lab 2:** Test failover — verify client không bị mất connection

---

## 📊 PHẦN 9 — MONITORING & DEBUGGING

> Không có monitoring = không biết hệ thống đang làm gì.

### 9.1 Metrics cần theo dõi
- [ ] Active connections
- [ ] Request rate (RPS)
- [ ] Backend response time
- [ ] Error rate (4xx, 5xx)
- [ ] Backend health status

### 9.2 Debug Tools
- [ ] `curl -v` và `curl -I` — inspect HTTP headers
- [ ] `tcpdump` — capture và analyze traffic
- [ ] `ss -tlnp` — xem listening ports
- [ ] `ab` (Apache Benchmark) — basic load test
- [ ] `wrk` hoặc `hey` — modern HTTP load testing
- [ ] Nginx/HAProxy logs — đọc và phân tích

### 9.3 Common Issues & Troubleshooting
- [ ] 502 Bad Gateway — nguyên nhân và cách debug
- [ ] 504 Gateway Timeout — nguyên nhân và cách debug
- [ ] Backend health check failing — checklist debug
- [ ] SSL certificate errors — common causes
- [ ] High latency — cách profile và tìm bottleneck

---

## 🗂️ TỔNG KẾT LỘ TRÌNH

```
TUẦN 1-2:  Phần 1 (HTTP/TCP cơ bản) + Phần 2 (Nginx Web Server)
TUẦN 3:    Phần 3 (SSL/TLS) + Phần 4 (Proxy concepts)
TUẦN 4:    Phần 5 (LB cơ bản) + Phần 6 (L4 vs L7)
TUẦN 5-6:  Phần 7 (HAProxy) + Lab tổng hợp
TUẦN 7:    Phần 8 (HA) + Phần 9 (Monitoring)
```

---

## 📚 Tài liệu tham khảo

### Official Docs
- [Nginx Documentation](https://nginx.org/en/docs/)
- [HAProxy Documentation](https://www.haproxy.org/download/2.8/doc/configuration.txt)
- [HAProxy Blog](https://www.haproxy.com/blog/)

### Học thực hành
- Dùng Vagrant/VirtualBox (đã có sẵn trong lab) để dựng môi trường
- Mỗi lab nên có ít nhất: 1 LB node + 2-3 backend nodes

### Kiểm tra hiểu biết
Tự hỏi mình những câu sau sau mỗi phần:
1. Mình có thể giải thích phần này cho người không biết kỹ thuật không?
2. Mình có thể debug một vấn đề liên quan đến phần này không?
3. Mình có thể thiết kế một hệ thống dùng kiến thức này không?

---

> 💡 **Ghi nhớ:** Hiểu sâu 1 chủ đề còn hơn biết qua 10 chủ đề.  
> Lab tay là không thể thiếu — đọc mà không làm = không học được gì.
