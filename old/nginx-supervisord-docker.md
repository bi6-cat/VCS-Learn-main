# Lý Thuyết & Thực Hành: Nginx + Supervisord + Docker-Compose

> **Bài lab chạy được:** xem [`nginx-supervisord-lab/README.md`](nginx-supervisord-lab/README.md). Lab có cấu trúc phẳng, chạy bằng Docker CLI và bao quát log, port, certificate, method, header, expose file/directory, cùng Supervisord add/remove service, log path, multi-worker.

> Tài liệu bao gồm: cài đặt/cấu hình Nginx (file log, port listen, cert path, allow method, add header, expose file/directory), quản lý tiến trình bằng Supervisord (add/remove service, log path, multi worker), triển khai trong Docker-compose, cơ chế kết nối bên trong, và các tình huống lỗi thường gặp kèm cách xử lý.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Nginx – Lý thuyết](#2-nginx--lý-thuyết)
3. [Nginx – Thực hành cấu hình](#3-nginx--thực-hành-cấu-hình)
4. [Cơ chế kết nối bên trong Nginx](#4-cơ-chế-kết-nối-bên-trong-nginx)
5. [Supervisord – Lý thuyết](#5-supervisord--lý-thuyết)
6. [Supervisord – Thực hành cấu hình](#6-supervisord--thực-hành-cấu-hình)
7. [Cơ chế Supervisord quản lý tiến trình con](#7-cơ-chế-supervisord-quản-lý-tiến-trình-con)
8. [Triển khai Nginx + Supervisord trong Docker-compose](#8-triển-khai-nginx--supervisord-trong-docker-compose)
9. [Demo cấu trúc thư mục NGINX](#9-demo-cấu-trúc-thư-mục-nginx)
10. [Các tình huống thường gặp & cách xử lý](#10-các-tình-huống-thường-gặp--cách-xử-lý)
11. [Checklist thực hành](#11-checklist-thực-hành)

---

## 1. Tổng quan kiến trúc

Mô hình tổng thể trong bài này:

```
                ┌───────────────────────────────────────┐
                │              Container                │
                │                                         │
   Client ───►  │   Nginx (reverse proxy / static)        │
                │        │                                │
                │        ├──► App worker 1 (upstream)     │
                │        ├──► App worker 2 (upstream)     │
                │        └──► App worker N (upstream)     │
                │                                         │
                │   Supervisord (init process, PID 1)     │
                │        ├── quản lý: nginx                │
                │        ├── quản lý: app worker 1..N      │
                │        └── ghi log riêng từng service    │
                └───────────────────────────────────────┘
```

- **Nginx**: đóng vai trò reverse proxy / web server đứng trước, xử lý TLS, log truy cập, kiểm soát method/header, phục vụ file tĩnh.
- **Supervisord**: đóng vai trò process manager bên trong container (thay cho việc container chỉ chạy được 1 tiến trình chính), khởi động, giám sát, tự restart các service (nginx, app, worker...).
- **Docker-compose**: đóng gói toàn bộ thành 1 (hoặc nhiều) service, mount volume cho log/cert/code, expose port ra ngoài.

---

## 2. Nginx – Lý thuyết

### 2.1 Nginx là gì
Nginx là web server / reverse proxy hoạt động theo mô hình **event-driven, non-blocking I/O** (khác với Apache dùng mô hình process/thread-per-connection). Nhờ vậy Nginx xử lý được số lượng connection đồng thời rất lớn với ít tài nguyên.

### 2.2 Kiến trúc tiến trình
- **Master process**: đọc config, mở socket lắng nghe (bind port), sinh ra (fork) các **worker process**, quản lý reload/restart.
- **Worker process**: là nơi thực sự xử lý request (accept connection, đọc/ghi dữ liệu, proxy tới upstream). Số lượng worker cấu hình bằng `worker_processes`.
- Mỗi worker dùng **event loop** (epoll trên Linux) để xử lý hàng nghìn connection cùng lúc mà không cần tạo thread riêng cho từng connection.

### 2.3 Các khối cấu hình chính (context)
```
main
 └── events { ... }        # cấu hình I/O, số connection/worker
 └── http { ... }
      └── server { ... }   # 1 virtual host (site)
           └── location { ... }  # route theo URL
```

### 2.4 Các yêu cầu cấu hình cần nắm (theo bảng yêu cầu)
| Yêu cầu | Directive liên quan | Ý nghĩa |
|---|---|---|
| File log | `access_log`, `error_log` | Ghi log truy cập & lỗi |
| Port listen | `listen` | Cổng và địa chỉ Nginx lắng nghe |
| Cert path | `ssl_certificate`, `ssl_certificate_key` | Đường dẫn chứng chỉ TLS/SSL |
| Allow method | `limit_except`, `if ($request_method ...)` | Giới hạn HTTP method được phép |
| Add header | `add_header` | Thêm response header (bảo mật, CORS, cache...) |
| Expose file/directory | `root`, `alias`, `autoindex` | Phục vụ file tĩnh / duyệt thư mục |

---

## 3. Nginx – Thực hành cấu hình

### 3.1 Cấu trúc file cấu hình chuẩn

```
/etc/nginx/
├── nginx.conf              # file chính, include các file khác
├── conf.d/                 # hoặc sites-available/sites-enabled
│   └── app.conf
├── ssl/
│   ├── server.crt
│   └── server.key
└── logs/
    ├── access.log
    └── error.log
```

### 3.2 `nginx.conf` cơ bản

```nginx
user  nginx;
worker_processes  auto;          # tự động = số CPU core

error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;    # số connection tối đa / worker
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                       '$status $body_bytes_sent "$http_referer" '
                       '"$http_user_agent"';

    access_log  /var/log/nginx/access.log  main;

    sendfile        on;
    keepalive_timeout  65;

    include /etc/nginx/conf.d/*.conf;
}
```

### 3.3 File log riêng theo từng site

```nginx
server {
    listen 80;
    server_name example.com;

    access_log /var/log/nginx/example_access.log main;
    error_log  /var/log/nginx/example_error.log  error;
    ...
}
```
> **Lưu ý**: tách log theo từng `server{}` giúp debug nhanh hơn khi có nhiều domain/service dùng chung 1 Nginx.

### 3.4 Port listen

```nginx
server {
    listen 80;              # HTTP
}

server {
    listen 443 ssl;         # HTTPS
}

server {
    listen 8080;            # port tùy chỉnh, ví dụ nội bộ
}
```

- `listen 80 default_server;` → server block xử lý khi không domain nào khớp.
- Có thể listen nhiều port trong cùng 1 server block.

### 3.5 Cert path (cấu hình SSL/TLS)

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    ssl_certificate     /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # redirect HTTP -> HTTPS
    location / {
        proxy_pass http://backend_upstream;
    }
}

server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}
```

### 3.6 Allow method (giới hạn HTTP method)

```nginx
location /api/ {
    limit_except GET POST {
        deny all;
    }
    proxy_pass http://backend_upstream;
}
```

Hoặc dùng `if` (không khuyến khích vì Nginx `if` có nhiều edge-case, nhưng vẫn phổ biến):

```nginx
location /api/ {
    if ($request_method !~ ^(GET|POST)$) {
        return 405;
    }
    proxy_pass http://backend_upstream;
}
```

### 3.7 Add header

```nginx
location / {
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Access-Control-Allow-Origin "*" always;
    add_header Cache-Control "no-cache, must-revalidate";
}
```
> `always` đảm bảo header được thêm cả khi response là lỗi (4xx/5xx).

### 3.8 Expose file/directory (phục vụ file tĩnh)

```nginx
location /static/ {
    alias /var/www/app/static/;
    autoindex on;              # cho phép duyệt danh sách file (dùng cẩn thận, có rủi ro bảo mật)
    autoindex_exact_size off;
    autoindex_localtime on;
}

location /download/ {
    root /data/files;
    # truy cập: http://host/download/<path-trong-/data/files>
}
```

- `root` nối path gốc + URI đầy đủ.
- `alias` thay thế phần path khớp `location` bằng path chỉ định → dùng khi path không trùng cấu trúc URL.

### 3.9 Upstream (khi cần cân bằng tải nhiều backend)

```nginx
upstream backend_upstream {
    server app1:5000;
    server app2:5000;
    keepalive 32;
}

server {
    location / {
        proxy_pass http://backend_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## 4. Cơ chế kết nối bên trong Nginx

Hiểu rõ phần này giúp debug lỗi 502/504, timeout, hoặc hiệu năng kém.

### 4.1 Vòng đời một request

1. Client mở TCP connection tới port Nginx đang `listen`.
2. Master process không xử lý request — nó chỉ giữ socket đã bind; **worker process** giành quyền `accept()` connection (cơ chế "thundering herd" được kiểm soát bằng `accept_mutex` hoặc `reuseport`).
3. Worker đọc request qua event loop (epoll), parse header.
4. Nginx đối chiếu `server_name` (virtual host) rồi tới `location` phù hợp nhất (theo độ ưu tiên: exact match `=` > prefix dài nhất > regex `~`/`~*` > prefix thường).
5. Nếu là `proxy_pass` → Nginx mở **kết nối riêng** tới upstream (có thể tái sử dụng qua `keepalive` connection pool), forward request, chờ response.
6. Nginx nhận response từ upstream, áp `add_header`, ghi log (`access_log`), rồi trả về client.
7. Connection với client có thể giữ `keepalive` để tái sử dụng cho request tiếp theo (giảm chi phí bắt tay TCP/TLS).

### 4.2 Kết nối TLS (khi có cert)
- TLS handshake diễn ra **trước khi** Nginx đọc được HTTP request (SNI dùng để chọn đúng `server_name`/cert nếu có nhiều virtual host HTTPS trên cùng port 443).
- Sau handshake, dữ liệu được giải mã tại Nginx rồi mới forward tới upstream (thường ở dạng HTTP thường - gọi là "TLS termination").

### 4.3 Kết nối tới upstream (proxy)
- Không dùng `keepalive` → Nginx mở TCP connection mới cho **mỗi request**, tốn thời gian bắt tay → hiệu năng kém khi tải cao.
- Dùng `keepalive 32;` trong `upstream{}` → Nginx giữ pool tối đa 32 connection idle, tái sử dụng cho request sau → giảm độ trễ đáng kể.
- Cần thêm `proxy_http_version 1.1;` và `proxy_set_header Connection "";` để keepalive hoạt động đúng khi proxy.

### 4.4 Reload vs Restart
- `nginx -s reload`: master đọc lại config, sinh worker mới, worker cũ xử lý nốt request đang dở rồi thoát (graceful) → **không mất connection đang có**.
- `nginx -s stop` / restart toàn bộ: ngắt kết nối ngay lập tức.

---

## 5. Supervisord – Lý thuyết

### 5.1 Vấn đề Supervisord giải quyết
Container Docker mặc định chỉ chạy tốt với **1 tiến trình chính (PID 1)**. Nhưng nhiều bài toán thực tế cần chạy **nhiều tiến trình trong cùng 1 container** (ví dụ: Nginx + PHP-FPM, hoặc Nginx + app worker). Supervisord đóng vai trò:
- Là tiến trình PID 1 (init) trong container.
- Khởi động, giám sát, tự động **restart** các tiến trình con khi chúng crash.
- Quản lý log riêng cho từng tiến trình con.
- Cho phép **add/remove service** động qua `supervisorctl` mà không cần restart toàn bộ container.

### 5.2 Kiến trúc
```
supervisord (PID 1)
 ├── supervisorctl (CLI điều khiển qua socket/HTTP)
 ├── program:nginx      -> fork/exec tiến trình nginx
 ├── program:worker1     -> fork/exec tiến trình worker
 └── program:worker2     -> fork/exec tiến trình worker
```
Supervisord dùng **fork() + exec()** để sinh tiến trình con, theo dõi qua signal `SIGCHLD`, và giữ file descriptor stdout/stderr của con để redirect vào log file riêng.

---

## 6. Supervisord – Thực hành cấu hình

### 6.1 File cấu hình chính `/etc/supervisor/supervisord.conf`

```ini
[unix_http_server]
file=/var/run/supervisor.sock   ; socket để supervisorctl giao tiếp

[supervisord]
nodaemon=true                   ; chạy foreground -> bắt buộc khi làm PID 1 trong Docker
logfile=/var/log/supervisor/supervisord.log
logfile_maxbytes=50MB
logfile_backups=10
loglevel=info
pidfile=/var/run/supervisord.pid

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[include]
files = /etc/supervisor/conf.d/*.conf
```

### 6.2 Log path riêng cho từng service

```ini
; /etc/supervisor/conf.d/nginx.conf
[program:nginx]
command=/usr/sbin/nginx -g "daemon off;"
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/nginx_stdout.log
stdout_logfile_maxbytes=10MB
stderr_logfile=/var/log/supervisor/nginx_stderr.log
stderr_logfile_maxbytes=10MB
priority=10
```

```ini
; /etc/supervisor/conf.d/app_worker.conf
[program:app_worker]
command=/usr/bin/python3 /app/worker.py
directory=/app
autostart=true
autorestart=true
startsecs=5
startretries=3
stdout_logfile=/var/log/supervisor/worker_stdout.log
stderr_logfile=/var/log/supervisor/worker_stderr.log
priority=20
```

### 6.3 Multi worker (chạy nhiều instance cùng 1 chương trình)

Dùng `numprocs` để Supervisord tự sinh N tiến trình giống nhau, mỗi tiến trình có biến `%(process_num)d` để phân biệt (ví dụ port, log riêng):

```ini
[program:app_worker]
command=/usr/bin/python3 /app/worker.py --port=90%(process_num)02d
process_name=%(program_name)s_%(process_num)02d
numprocs=4
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/worker_%(process_num)02d.log
stderr_logfile=/var/log/supervisor/worker_%(process_num)02d_error.log
```

→ Sẽ tạo ra 4 tiến trình: `app_worker_00` (port 9000), `app_worker_01` (port 9001), ... `app_worker_03` (port 9003).

Có thể nhóm chúng lại để điều khiển cùng lúc:
```ini
[group:workers]
programs=app_worker
```

### 6.4 Add / Remove service động (không cần restart container)

```bash
# Thêm 1 file cấu hình mới vào conf.d/, sau đó:
supervisorctl reread      # đọc lại config, phát hiện thay đổi
supervisorctl update      # áp dụng: thêm service mới, gỡ service đã xóa

# Điều khiển từng service
supervisorctl status
supervisorctl start app_worker
supervisorctl stop app_worker
supervisorctl restart app_worker
supervisorctl remove app_worker   # gỡ khỏi danh sách quản lý (sau khi đã stop + xóa file conf)
```

Quy trình **remove service an toàn**:
1. `supervisorctl stop <name>`
2. Xóa file `.conf` tương ứng trong `conf.d/`
3. `supervisorctl reread`
4. `supervisorctl update`

---

## 7. Cơ chế Supervisord quản lý tiến trình con

### 7.1 Vòng đời tiến trình (state machine)

```
STOPPED → STARTING → RUNNING → STOPPING → STOPPED
                 │
                 ├─► nếu thoát trước startsecs → BACKOFF → (thử lại nếu còn startretries) → FATAL
                 └─► nếu RUNNING rồi crash và autorestart=true → chuyển lại STARTING
```

- `startsecs`: thời gian tiến trình phải sống liên tục mới được tính là "chạy thành công". Nếu thoát sớm hơn → tính là lỗi khởi động (BACKOFF).
- `startretries`: số lần thử lại tối đa trước khi chuyển sang `FATAL` (ngừng thử).
- `autorestart`: `true` / `false` / `unexpected` (chỉ restart khi exit code không nằm trong `exitcodes` khai báo là "bình thường").

### 7.2 Redirect log
Supervisord giữ file descriptor stdout/stderr của tiến trình con (không để in ra console cha) và ghi trực tiếp vào file `stdout_logfile` / `stderr_logfile` đã cấu hình → đây là lý do khi `docker logs` container chỉ thấy log của **Supervisord**, không thấy log của Nginx/app trừ khi cấu hình `stdout_logfile=/dev/stdout` (đặc thù khi muốn gộp log ra `docker logs`).

### 7.3 Signal handling
- Supervisord nhận `SIGTERM` từ Docker khi `docker stop` → nó lần lượt gửi tín hiệu dừng (`stopsignal`, mặc định `SIGTERM`) tới từng tiến trình con theo thứ tự `priority` ngược lại, chờ tối đa `stopwaitsecs` rồi mới `SIGKILL` nếu chưa thoát.
- `priority` nhỏ hơn → khởi động trước, dừng sau.

---

## 8. Triển khai Nginx + Supervisord trong Docker-Compose

### 8.1 Dockerfile

```dockerfile
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y nginx supervisor python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# copy cấu hình
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/conf.d/ /etc/nginx/conf.d/
COPY supervisor/supervisord.conf /etc/supervisor/supervisord.conf
COPY supervisor/conf.d/ /etc/supervisor/conf.d/
COPY app/ /app/

EXPOSE 80 443

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
```

> Lưu ý quan trọng: **CMD phải chạy Supervisord** (không phải Nginx trực tiếp), vì Supervisord mới là tiến trình PID 1 chịu trách nhiệm sinh và giám sát cả Nginx lẫn app.

### 8.2 docker-compose.yml

```yaml
version: "3.9"

services:
  web:
    build: .
    container_name: web_nginx_supervisor
    ports:
      - "8080:80"
      - "8443:443"
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro          # cấu hình nginx, dễ chỉnh không cần rebuild
      - ./nginx/ssl:/etc/nginx/ssl:ro                 # cert path
      - ./logs/nginx:/var/log/nginx                   # log nginx đẩy ra host
      - ./logs/supervisor:/var/log/supervisor          # log supervisor đẩy ra host
      - ./app:/app                                     # source code app/worker
    environment:
      - APP_ENV=production
    restart: unless-stopped
    networks:
      - app_net

networks:
  app_net:
    driver: bridge
```

### 8.3 Các điểm cần lưu ý khi container hóa

| Vấn đề | Giải pháp |
|---|---|
| Container tự thoát ngay sau khi chạy | Đảm bảo Supervisord có `nodaemon=true` |
| Không thấy log qua `docker logs` | Redirect log của 1 service quan trọng ra `/dev/stdout`, `/dev/stderr` |
| Cert hết hạn / renew | Mount volume cert từ host hoặc từ certbot container riêng, `nginx -s reload` sau khi renew |
| Sửa cấu hình Nginx không cần build lại image | Mount `conf.d` dạng volume, sau đó `docker exec ... nginx -s reload` |
| Muốn thêm worker mới lúc runtime | `docker exec -it web_nginx_supervisor supervisorctl reread && supervisorctl update` |

---

## 9. Demo cấu trúc thư mục NGINX

```
project/
├── docker-compose.yml
├── Dockerfile
├── app/
│   └── worker.py
├── nginx/
│   ├── nginx.conf
│   ├── conf.d/
│   │   └── app.conf
│   └── ssl/
│       ├── server.crt
│       └── server.key
├── supervisor/
│   ├── supervisord.conf
│   └── conf.d/
│       ├── nginx.conf
│       └── app_worker.conf
└── logs/
    ├── nginx/
    │   ├── access.log
    │   └── error.log
    └── supervisor/
        ├── supervisord.log
        ├── nginx_stdout.log
        └── worker_00.log
```

Test nhanh sau khi `docker-compose up -d --build`:

```bash
# kiểm tra service đang chạy trong container
docker exec -it web_nginx_supervisor supervisorctl status

# kiểm tra nginx test config trước khi reload
docker exec -it web_nginx_supervisor nginx -t

# test HTTP
curl -I http://localhost:8080/

# test HTTPS (bỏ qua cert self-signed để test)
curl -Ik https://localhost:8443/

# test allow method
curl -X DELETE http://localhost:8080/api/     # kỳ vọng trả 405

# test expose static file
curl http://localhost:8080/static/logo.png -o /dev/null -w "%{http_code}\n"
```

---

## 10. Các tình huống thường gặp & cách xử lý

### 10.1 Nginx báo lỗi 502 Bad Gateway
**Nguyên nhân thường gặp:**
- Upstream (app/worker) chưa khởi động, chết, hoặc sai port trong `proxy_pass`.
- Supervisord chưa kịp start app worker trước khi Nginx nhận request (thứ tự `priority`).
- SELinux/firewall chặn kết nối tới upstream.

**Cách xử lý:**
```bash
docker exec -it web_nginx_supervisor supervisorctl status     # xem worker có RUNNING không
docker exec -it web_nginx_supervisor cat /var/log/nginx/error.log
```
Đặt `priority` của app worker thấp hơn (khởi động trước) Nginx, hoặc thêm cơ chế "wait-for" trong entrypoint.

### 10.2 Nginx báo lỗi 504 Gateway Timeout
- Do upstream xử lý quá lâu, vượt `proxy_read_timeout` (mặc định 60s).
- Xử lý: tăng timeout hợp lý (`proxy_connect_timeout`, `proxy_send_timeout`, `proxy_read_timeout`) hoặc tối ưu code backend, tránh tăng timeout tùy tiện vì có thể che giấu vấn đề hiệu năng thật sự.

### 10.3 Permission denied khi Nginx đọc file tĩnh hoặc ghi log
- User chạy worker Nginx (`user nginx;`) không có quyền đọc thư mục `root`/`alias`, hoặc thư mục log không có quyền ghi.
- Xử lý: `chown -R nginx:nginx /var/www/app/static`, kiểm tra thêm quyền thực thi (`x`) trên **toàn bộ path cha** (một lỗi hay bị bỏ sót: thư mục cha thiếu quyền `x` dù thư mục con đã đủ quyền).

### 10.4 Port đã bị chiếm (Address already in use)
- Container khác hoặc tiến trình host đang dùng port `80`/`443` map ra ngoài.
- Xử lý: đổi cổng map trong `docker-compose.yml` (`"8080:80"`), hoặc `lsof -i :80` trên host để tìm tiến trình đang giữ port.

### 10.5 SSL handshake failed / cert không hợp lệ
- Sai đường dẫn `ssl_certificate`/`ssl_certificate_key`, cert hết hạn, hoặc thiếu **cert chain trung gian (intermediate)**.
- Xử lý: `openssl x509 -in server.crt -noout -dates` kiểm tra hạn; ghép đầy đủ chain vào 1 file `fullchain.crt` theo đúng thứ tự (server cert → intermediate → root nếu cần).

### 10.6 `autoindex on` gây lộ thông tin nhạy cảm
- Bật `autoindex on` cho thư mục chứa file cấu hình, backup, `.env`... → rủi ro bảo mật nghiêm trọng (duyệt được toàn bộ danh sách file).
- Xử lý: chỉ bật `autoindex` cho thư mục thực sự cần thiết, luôn có `location` chặn truy cập file nhạy cảm:
```nginx
location ~ /\.(?!well-known).* {
    deny all;
}
```

### 10.7 Supervisord: service liên tục ở trạng thái `BACKOFF`/`FATAL`
- Chương trình con thoát ngay lập tức (crash loop) trước khi đạt `startsecs`.
- Xử lý: xem log riêng (`stderr_logfile`) để tìm lỗi thật sự (thiếu biến môi trường, sai path, thiếu quyền); tăng `startretries` chỉ là giải pháp tạm, cần fix nguyên nhân gốc.

### 10.8 Container thoát ngay sau khi chạy dù Supervisord đã cấu hình
- Quên `nodaemon=true` → Supervisord tự fork xuống background và tiến trình PID 1 (theo nghĩa Docker) kết thúc → Docker coi container đã dừng.
- Xử lý: luôn set `nodaemon=true` trong `[supervisord]`.

### 10.9 Nhiều worker (multi worker) nhưng chỉ thấy 1 tiến trình chạy
- Nhầm giữa **Nginx worker_processes** (do Nginx tự quản lý nội bộ) và **Supervisord numprocs** (do Supervisord sinh nhiều instance của 1 chương trình khác) — hai khái niệm độc lập, không cấu hình chồng lên nhau nhầm lẫn.
- Kiểm tra: `docker exec -it <container> supervisorctl status` phải liệt kê đủ `app_worker_00`, `app_worker_01`... nếu dùng `numprocs`.

### 10.10 Reload cấu hình Nginx nhưng không có hiệu lực
- Sửa file trong `conf.d/` nhưng quên `nginx -s reload`, hoặc sửa nhầm file không được `include` trong `nginx.conf`.
- Xử lý: luôn `nginx -t` để kiểm tra cú pháp trước, sau đó `supervisorctl signal HUP nginx` hoặc `nginx -s reload` (cách nào cũng cần thực thi **bên trong** container, đúng tiến trình đang chạy).

### 10.11 Log không được ghi ra ngoài host dù đã mount volume
- Mount sai path bên trong container (không khớp với `access_log`/`stdout_logfile` đã cấu hình), hoặc log bị buffer chưa flush.
- Xử lý: đảm bảo path mount và path cấu hình log trùng khớp tuyệt đối; với Nginx có thể set `access_log ... buffer=off;` khi debug.

### 10.12 CORS / header không xuất hiện dù đã `add_header`
- `add_header` bị **ghi đè hoàn toàn** (không kế thừa) khi khai báo lại `add_header` ở block con (location) — đây là hành vi đặc trưng của Nginx: nếu location con có `add_header` riêng, toàn bộ `add_header` ở block cha bị bỏ qua, không cộng dồn.
- Xử lý: khai báo đầy đủ toàn bộ header cần thiết ở **cùng một block** (location) đang áp dụng, không chia rải ở nhiều tầng cha/con.

---

## 11. Checklist thực hành

- [ ] Cài Nginx, tạo `server{}` với `listen`, `server_name` đúng domain/port.
- [ ] Tách `access_log`/`error_log` riêng cho từng site, mount volume log ra ngoài container.
- [ ] Cấu hình `ssl_certificate` + `ssl_certificate_key`, kiểm tra hạn dùng, redirect HTTP → HTTPS.
- [ ] Giới hạn method bằng `limit_except`, test bằng `curl -X <METHOD>`.
- [ ] Thêm các header bảo mật cơ bản bằng `add_header ... always;`.
- [ ] Cấu hình `root`/`alias` + `autoindex` hợp lý, chặn truy cập file nhạy cảm.
- [ ] Cài Supervisord, viết `supervisord.conf` với `nodaemon=true`.
- [ ] Viết từng file `.conf` riêng cho mỗi service trong `conf.d/`, có `stdout_logfile`/`stderr_logfile` riêng.
- [ ] Dùng `numprocs` để chạy multi worker khi cần scale theo tiến trình.
- [ ] Thử nghiệm add/remove service bằng `supervisorctl reread && update` mà không cần restart container.
- [ ] Viết `Dockerfile` với `CMD` chạy Supervisord làm PID 1.
- [ ] Viết `docker-compose.yml` mount đủ: `conf.d`, `ssl`, `logs`, `app`.
- [ ] Test toàn bộ luồng: `docker-compose up -d --build` → `supervisorctl status` → `nginx -t` → `curl` kiểm tra từng yêu cầu (log, port, cert, method, header, static file).
- [ ] Diễn tập các tình huống lỗi ở mục 10 để quen cách debug thực tế.

---

*Tài liệu này có thể mở rộng thêm phần load balancing nâng cao (least_conn, ip_hash), rate limiting (`limit_req`), hoặc tích hợp Let's Encrypt/Certbot tự động renew cert nếu cần đào sâu hơn.*
