# 🌐 PHẦN 2 — WEB SERVER: NGINX CƠ BẢN

> **Mục tiêu:** Hiểu Nginx từ bên trong — kiến trúc, cú pháp config, và logic routing.  
> Không chỉ "copy config" mà biết **tại sao** mỗi directive tồn tại.

---

## 2.1 Nginx là gì & Kiến trúc

### Nginx là gì?

**Nginx** (đọc là "engine-x") là một phần mềm **đa năng**:
- **Web Server**: Serve static files (HTML, CSS, JS, images)
- **Reverse Proxy**: Forward request đến backend app
- **Load Balancer**: Phân phối traffic đến nhiều backends
- **HTTP Cache**: Cache response từ backend
- **SSL Terminator**: Xử lý HTTPS, backend nhận HTTP thuần

---

### Nginx vs Apache — Tại sao Nginx xử lý concurrency tốt hơn?

**Apache (Process/Thread-based model):**
```
Request 1 → Worker Process/Thread 1  (đang chờ database → blocking)
Request 2 → Worker Process/Thread 2  (đang chờ file I/O → blocking)
Request 3 → Worker Process/Thread 3
...
Request 10000 → ??? (hết worker → queue/reject)

Vấn đề: Mỗi connection chiếm 1 thread/process → tốn RAM nhiều
1 thread ~ 8MB RAM → 1000 connections = 8GB RAM
```

**Nginx (Event-driven, non-blocking I/O model):**
```
1 Worker Process xử lý hàng ngàn connections đồng thời
         │
         ├── Connection 1 (đang chờ I/O) → không block, tiếp tục
         ├── Connection 2 (đang chờ database) → không block, tiếp tục
         ├── Connection 3 (xong rồi) → xử lý ngay
         └── Connection 4 ... (đến 10,000+ connections)

Cơ chế: epoll (Linux) / kqueue (BSD/Mac)
→ OS thông báo khi I/O sẵn sàng, không cần polling
```

**Kết quả thực tế:**
- Apache: ~10,000 concurrent connections → bắt đầu chậm/crash
- Nginx: ~50,000+ concurrent connections trên cùng hardware

> **Nhớ:** Nginx giỏi I/O-bound workloads (network, file). Không giỏi CPU-bound (encoding video, ML).

---

### Master Process vs Worker Process

```bash
# Xem process tree của Nginx
ps aux | grep nginx
# hoặc
pstree -p $(pgrep -o nginx)

# Output:
# nginx: master process /usr/sbin/nginx
#   └── nginx: worker process
#   └── nginx: worker process     ← Thường = số CPU cores
#   └── nginx: worker process
#   └── nginx: cache manager process
```

**Master Process:**
- Chạy bằng **root** (để bind port 80/443)
- **Đọc config** và kiểm tra tính hợp lệ
- **Quản lý Worker processes** (spawn, kill, reload)
- **KHÔNG** xử lý request trực tiếp
- Nhận tín hiệu: `SIGHUP` (reload), `SIGTERM` (graceful stop), `SIGKILL` (force stop)

**Worker Process:**
- Chạy bằng user bình thường (vd: `www-data`, `nginx`)
- **Xử lý tất cả connections** và requests
- Mỗi worker: event loop + epoll → handle ngàn connections
- Số worker nên = số CPU cores

```nginx
# Trong nginx.conf
worker_processes auto;        # Tự động detect số CPU cores
worker_connections 1024;      # Mỗi worker handle tối đa N connections
# Tổng connections = worker_processes × worker_connections
```

---

### Nginx Commands

```bash
# Kiểm tra syntax config (BẮT BUỘC trước khi reload)
nginx -t
# hoặc
nginx -t -c /path/to/custom.conf

# Reload config (graceful - không drop connection đang có)
nginx -s reload
# hoặc
systemctl reload nginx

# Stop graceful (chờ connections hiện tại xong rồi mới stop)
nginx -s quit

# Stop ngay lập tức (drop tất cả connections)
nginx -s stop

# Start Nginx
systemctl start nginx

# Restart (= stop + start, drop connections)
systemctl restart nginx

# Kiểm tra status
systemctl status nginx
```

**Quan trọng: `reload` vs `restart`**
```
reload:   Master process đọc config mới → spawn workers mới →
          Workers cũ phục vụ nốt connections đang có → sau đó thoát
          → KHÔNG mất request nào đang xử lý (zero downtime)

restart:  Kill tất cả → start lại
          → Connections đang xử lý bị DROP
          → Dùng trong dev, KHÔNG dùng trong production
```

---

### Nginx File Structure

```
/etc/nginx/
├── nginx.conf              ← Main config file
├── conf.d/                 ← Virtual hosts (*.conf files auto-included)
│   ├── default.conf
│   └── myapp.conf
├── sites-available/        ← Ubuntu/Debian style (manual symlink)
│   ├── default
│   └── myapp
├── sites-enabled/          ← Symlinks từ sites-available
│   └── myapp -> ../sites-available/myapp
├── snippets/               ← Reusable config fragments
│   ├── fastcgi-php.conf
│   └── snakeoil.conf
├── mime.types              ← Mapping file extension → Content-Type
└── modules-enabled/        ← Dynamic modules

/var/log/nginx/
├── access.log              ← Mọi request đến
└── error.log               ← Lỗi

/var/www/html/              ← Default web root
/run/nginx.pid              ← PID của master process
```

**Hai convention:**
- `conf.d/`: Thêm file `.conf` vào đây → tự động load (CentOS/RHEL style)
- `sites-available/` + `sites-enabled/`: Enable/disable bằng symlink (Debian/Ubuntu style)

```bash
# Enable site (Ubuntu/Debian)
ln -s /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/
nginx -t && nginx -s reload

# Disable site
rm /etc/nginx/sites-enabled/myapp
nginx -t && nginx -s reload
```

---

## 2.2 Nginx Config — Hiểu Cú Pháp

### Cấu trúc tổng thể

```nginx
# /etc/nginx/nginx.conf

# Directives ở đây là "main context"
user www-data;
worker_processes auto;
pid /run/nginx.pid;

events {
    # Cấu hình event handling
    worker_connections 1024;
    use epoll;              # Linux event model
    multi_accept on;        # Accept nhiều connections cùng lúc
}

http {
    # Cấu hình HTTP - áp dụng cho tất cả virtual hosts
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    sendfile on;
    tcp_nopush on;
    keepalive_timeout 65;

    # Include các virtual host configs
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

**Quy tắc cú pháp:**
- `directive value;` — kết thúc bằng dấu chấm phẩy
- `block { ... }` — block context, không có dấu chấm phẩy sau `}`
- `#` — comment
- Giá trị có thể là số, string, time (`5s`, `1m`, `2h`), size (`10m`, `1g`)

---

### `listen` directive

```nginx
server {
    listen 80;                      # IPv4, port 80
    listen [::]:80;                 # IPv6, port 80

    listen 443 ssl;                 # HTTPS
    listen [::]:443 ssl;

    listen 80 default_server;       # Default khi không khớp server_name nào
    listen 8080;                    # Custom port

    listen 127.0.0.1:80;            # Chỉ localhost
    listen 10.0.0.1:80;             # Chỉ interface này
}
```

**`default_server`:** Khi request đến với `Host` header không khớp bất kỳ `server_name` nào → dùng virtual host có `default_server`. Nếu không có → virtual host đầu tiên trong config.

---

### `server_name` — Virtual Hosting

**Virtual Hosting** = 1 IP address host nhiều domain, phân biệt qua `Host` header.

```nginx
# Virtual host cho example.com
server {
    listen 80;
    server_name example.com www.example.com;   # Exact match
}

# Wildcard
server {
    listen 80;
    server_name *.example.com;    # Mọi subdomain
}

# Regex (bắt đầu bằng ~)
server {
    listen 80;
    server_name ~^(www\.)?example\.com$;
}

# Catch-all (bắt mọi request không khớp)
server {
    listen 80 default_server;
    server_name _;                # _ là invalid domain name, dùng làm catch-all
}
```

**Nginx chọn virtual host theo thứ tự ưu tiên:**
1. Exact match: `server_name example.com`
2. Wildcard bắt đầu: `*.example.com`
3. Wildcard kết thúc: `example.*`
4. Regex match (theo thứ tự trong file)
5. `default_server`

---

### `root` vs `alias` — Khác nhau quan trọng

```nginx
# root: Nối root + location path
location /static/ {
    root /var/www/myapp;
    # Request: GET /static/logo.png
    # → File: /var/www/myapp/static/logo.png   (root + /static/ + logo.png)
}

# alias: Thay thế location path bằng alias path
location /static/ {
    alias /var/www/myapp/assets/;  # Dấu / cuối BẮT BUỘC với alias
    # Request: GET /static/logo.png
    # → File: /var/www/myapp/assets/logo.png   (alias + logo.png)
}
```

**Khi nào dùng gì?**
- `root`: Khi cấu trúc URL khớp với cấu trúc thư mục
- `alias`: Khi cần map URL khác với đường dẫn thực tế

---

### `location` block — Priority Order

Đây là **phần phức tạp nhất** và hay gây nhầm lẫn nhất trong Nginx config.

```nginx
server {
    listen 80;
    server_name example.com;
    root /var/www/html;

    # 1. Exact match (=) — ưu tiên cao nhất, dừng ngay khi khớp
    location = /favicon.ico {
        log_not_found off;
        access_log off;
    }

    # 2. Prefix match với ^~ — nếu khớp, dừng ngay (không xét regex)
    location ^~ /static/ {
        expires 30d;    # Cache 30 ngày
    }

    # 3. Regex match (~: case-sensitive, ~*: case-insensitive)
    location ~ \.php$ {
        fastcgi_pass unix:/run/php/php8.1-fpm.sock;
    }

    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        expires 7d;
    }

    # 4. Prefix match thông thường (longest match wins, nhưng vẫn xét regex)
    location /api/ {
        proxy_pass http://backend;
    }

    # 5. Catch-all (không có modifier)
    location / {
        try_files $uri $uri/ =404;
    }
}
```

**Thuật toán matching của Nginx:**
```
1. Kiểm tra tất cả prefix locations (=, ^~, không modifier)
2. Tìm longest prefix match
3. Nếu longest match là = hoặc ^~ → dùng ngay, dừng
4. Nếu là prefix thường → lưu lại, tiếp tục
5. Kiểm tra regex locations theo thứ tự trong file
6. Nếu có regex khớp → dùng regex đó
7. Nếu không regex khớp → dùng longest prefix match đã lưu
```

**Ví dụ minh họa:**

```
Request: GET /static/images/logo.png

Nginx xét:
- location = /favicon.ico       → không khớp
- location ^~ /static/          → KHỚP! (prefix /static/)
                                   → Dừng ngay, không xét regex nữa
                                   → Dùng location ^~ /static/
```

```
Request: GET /api/users

Nginx xét:
- location = /favicon.ico       → không khớp
- location ^~ /static/          → không khớp
- location ~ \.php$              → không khớp
- location ~* \.(jpg|...)$       → không khớp
- location /api/                 → KHỚP! (prefix, lưu lại)
- location /                     → KHỚP! (prefix, ngắn hơn)
→ Longest prefix: /api/ → dùng location /api/
```

---

### `try_files`

```nginx
location / {
    try_files $uri $uri/ /index.html;
    # Thử theo thứ tự:
    # 1. $uri: tìm file chính xác (vd: /var/www/html/about.html)
    # 2. $uri/: tìm thư mục (vd: /var/www/html/about/index.html)
    # 3. /index.html: fallback (cho SPA như React/Vue)
}

location /api/ {
    try_files $uri $uri/ =404;
    # =404 → trả về 404 nếu không tìm thấy
}
```

---

### `return` và `rewrite`

```nginx
# return — đơn giản hơn, ưu tiên hơn
server {
    listen 80;
    server_name example.com;

    # Redirect HTTP → HTTPS
    return 301 https://$host$request_uri;
}

# return các status code khác
location /old-page {
    return 301 /new-page;         # Permanent redirect
    return 302 /temp-page;        # Temporary redirect
    return 404;                    # Not Found
    return 200 "OK";              # OK với body
}

# rewrite — phức tạp hơn, dùng regex
rewrite ^/old-blog/(.*)$ /new-blog/$1 permanent;    # permanent = 301
rewrite ^/user/(\d+)$ /profile?id=$1 last;          # last = tiếp tục xử lý
rewrite ^/old$ /new redirect;                        # redirect = 302
```

**Khi nào dùng `return` vs `rewrite`?**
- Ưu tiên `return` cho redirects đơn giản (nhanh hơn, rõ ràng hơn)
- Dùng `rewrite` khi cần regex capture groups phức tạp

---

### Variables quan trọng trong Nginx

```nginx
$host             # Giá trị Host header (hoặc server_name nếu không có header)
$request_uri      # Full URI bao gồm query string (/path?query=value)
$uri              # URI sau khi normalize (không có query string)
$args             # Query string (không có ?)
$remote_addr      # IP của client (hoặc IP của proxy nếu có)
$server_addr      # IP của server
$server_port      # Port đang listen
$scheme           # http hoặc https
$request_method   # GET, POST, etc.
$status           # Response status code
$body_bytes_sent  # Số bytes body đã gửi
$request_time     # Thời gian xử lý request (giây)
$upstream_addr    # IP:Port của backend server (khi dùng proxy_pass)
$http_user_agent  # User-Agent header
$http_referer     # Referer header
```

---

## 2.3 Lab: Nginx Web Server

### Lab 2.1: Cài Nginx và serve static HTML

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y nginx

# CentOS/RHEL
sudo yum install -y nginx    # hoặc dnf

# Kiểm tra
sudo systemctl start nginx
sudo systemctl enable nginx
systemctl status nginx
curl http://localhost

# Tạo thư mục và file
sudo mkdir -p /var/www/mysite
sudo bash -c 'cat > /var/www/mysite/index.html << EOF
<!DOCTYPE html>
<html>
<head><title>My Site</title></head>
<body><h1>Hello from Nginx!</h1></body>
</html>
EOF'

# Cấu hình virtual host
sudo bash -c 'cat > /etc/nginx/conf.d/mysite.conf << EOF
server {
    listen 80;
    server_name mysite.local;
    root /var/www/mysite;
    index index.html;

    access_log /var/log/nginx/mysite_access.log;
    error_log /var/log/nginx/mysite_error.log;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF'

# Test và reload
sudo nginx -t
sudo nginx -s reload

# Test (thêm vào /etc/hosts: 127.0.0.1 mysite.local)
curl -H "Host: mysite.local" http://localhost
```

---

### Lab 2.2: Multiple Virtual Hosts

```bash
# Virtual host 1: site-a.local
sudo mkdir -p /var/www/site-a
echo "<h1>Site A</h1>" | sudo tee /var/www/site-a/index.html

sudo bash -c 'cat > /etc/nginx/conf.d/site-a.conf << EOF
server {
    listen 80;
    server_name site-a.local;
    root /var/www/site-a;
    index index.html;
}
EOF'

# Virtual host 2: site-b.local
sudo mkdir -p /var/www/site-b
echo "<h1>Site B</h1>" | sudo tee /var/www/site-b/index.html

sudo bash -c 'cat > /etc/nginx/conf.d/site-b.conf << EOF
server {
    listen 80;
    server_name site-b.local;
    root /var/www/site-b;
    index index.html;
}
EOF'

# Thêm vào /etc/hosts
echo "127.0.0.1 site-a.local site-b.local" | sudo tee -a /etc/hosts

sudo nginx -t && sudo nginx -s reload

# Test
curl http://site-a.local    # → Site A
curl http://site-b.local    # → Site B

# Thực nghiệm: Header Host quyết định virtual host
curl -H "Host: site-a.local" http://127.0.0.1    # → Site A
curl -H "Host: site-b.local" http://127.0.0.1    # → Site B
curl -H "Host: unknown.local" http://127.0.0.1   # → Default server
```

---

### Lab 2.3: Custom Error Pages

```bash
# Tạo custom error pages
sudo bash -c 'cat > /var/www/mysite/404.html << EOF
<!DOCTYPE html>
<html>
<body>
  <h1>404 - Trang không tồn tại</h1>
  <a href="/">Về trang chủ</a>
</body>
</html>
EOF'

# Config trong server block
sudo bash -c 'cat >> /etc/nginx/conf.d/mysite.conf << EOF
    error_page 404 /404.html;
    error_page 500 502 503 504 /50x.html;

    location = /404.html {
        internal;    # Không cho phép truy cập trực tiếp URL /404.html
    }
EOF'
```

---

### Lab 2.4: Custom Access Log Format

```nginx
# Trong http {} block của nginx.conf
log_format custom '$remote_addr - $remote_user [$time_local] '
                  '"$request" $status $body_bytes_sent '
                  '"$http_referer" "$http_user_agent" '
                  '$request_time $upstream_addr';

# Trong server {} block
access_log /var/log/nginx/access.log custom;
```

```bash
# Xem log real-time
sudo tail -f /var/log/nginx/access.log

# Test và xem kết quả
curl http://mysite.local/page-khong-ton-tai

# Đọc log
# 127.0.0.1 - - [09/May/2026:22:00:00 +0700] "GET /404 HTTP/1.1" 404 153 "-" "curl/7.81.0" 0.001 -
```

---

## ✅ Checkpoint Phần 2

1. **Architecture:** Nginx master process làm gì? Worker process làm gì?
2. **Reload vs Restart:** Tại sao production dùng `reload` thay `restart`?
3. **Virtual hosting:** Nếu có 2 `server` blocks, Nginx quyết định dùng cái nào dựa vào gì?
4. **location matching:** Request `GET /static/logo.png` khớp với location nào trong ví dụ trên?
5. **root vs alias:** Tại sao cần 2 directive khác nhau?
6. **try_files:** `try_files $uri $uri/ /index.html` có ý nghĩa gì với React/Vue SPA?

> 🔴 **Bài tập thực hành bắt buộc:**  
> Cấu hình Nginx có 3 virtual hosts trên 1 máy. Mỗi host serve nội dung khác nhau.  
> Verify bằng `curl -H "Host: ..."`.
