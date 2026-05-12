# Lab Nginx: Web Server, SSL & Reverse Proxy

> **Môi trường:** Ubuntu 22.04 LTS | Nginx 1.24+  
> **Yêu cầu:** Máy có quyền sudo, đã cài Docker (tùy chọn)

---

## Lý thuyết nhanh trước khi lab

### Forward Proxy vs Reverse Proxy

```
Forward Proxy:
Client → [Forward Proxy] → Internet
Client biết proxy, Internet không biết ai đang request
Dùng: VPN, bypass firewall, ẩn danh

Reverse Proxy:
Client → [Reverse Proxy / Nginx] → Backend Server
Client không biết backend thực sự, chỉ thấy Nginx
Dùng: Load balancing, SSL termination, caching, bảo mật
```

---

## Lab 1 — Web Server (Serve Static Files)

**Mục tiêu:** Dựng Nginx serve một website tĩnh, hiểu cấu trúc config cơ bản.

### Bước 1: Cài đặt Nginx

```bash
sudo apt update && sudo apt install nginx -y

# Kiểm tra Nginx đang chạy
sudo systemctl status nginx

# Mở browser: http://localhost → thấy trang "Welcome to nginx!" là OK
```

### Bước 2: Tạo website tĩnh

```bash
# Tạo thư mục cho site
sudo mkdir -p /var/www/mysite

# Tạo file HTML đơn giản
sudo tee /var/www/mysite/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>My Nginx Site</title>
</head>
<body>
  <h1>Hello from Nginx!</h1>
  <p>Lab 1 - Static Web Server</p>
</body>
</html>
EOF

# Gán quyền
sudo chown -R www-data:www-data /var/www/mysite
sudo chmod -R 755 /var/www/mysite
```

### Bước 3: Tạo Virtual Host config

```bash
sudo tee /etc/nginx/sites-available/mysite << 'EOF'
server {
    listen 80;
    server_name mysite.local;

    root /var/www/mysite;
    index index.html;

    # Log riêng cho site này
    access_log /var/log/nginx/mysite.access.log;
    error_log  /var/log/nginx/mysite.error.log;

    location / {
        try_files $uri $uri/ =404;
    }

    # Serve ảnh/css/js với cache dài
    location ~* \.(jpg|jpeg|png|gif|css|js|ico)$ {
        expires 30d;
        add_header Cache-Control "public";
        access_log off;
    }

    # Ẩn Nginx version
    server_tokens off;
}
EOF
```

### Bước 4: Enable site và reload

```bash
# Enable (tạo symlink)
sudo ln -s /etc/nginx/sites-available/mysite /etc/nginx/sites-enabled/

# Tắt default site (tùy chọn)
sudo rm -f /etc/nginx/sites-enabled/default

# Kiểm tra config
sudo nginx -t

# Reload
sudo systemctl reload nginx

# Test trên local (thêm host mapping)
echo "127.0.0.1 mysite.local" | sudo tee -a /etc/hosts

curl http://mysite.local
```

### Bước 5: Thêm trang lỗi tùy chỉnh

```bash
sudo tee /var/www/mysite/404.html << 'EOF'
<!DOCTYPE html>
<html>
<body>
  <h1>404 - Không tìm thấy trang</h1>
  <a href="/">Về trang chủ</a>
</body>
</html>
EOF
```

Thêm vào config trong block `server { }`:
```nginx
error_page 404 /404.html;
location = /404.html {
    internal;   # Chỉ dùng nội bộ, không truy cập trực tiếp được
}
```

### Kiểm tra Lab 1

```bash
curl -I http://mysite.local                    # → 200 OK
curl -I http://mysite.local/khong-ton-tai      # → 404
sudo nginx -t                                  # → syntax OK
cat /var/log/nginx/mysite.access.log           # Xem logs
```

---

## Lab 2 — HTTPS với Self-Signed Certificate

**Mục tiêu:** Bật HTTPS cho site bằng self-signed cert, hiểu SSL config, sau đó dùng Let's Encrypt nếu có domain thật.

### Phần A: Self-Signed Certificate (không cần domain)

#### Bước 1: Tạo certificate

```bash
# Tạo thư mục chứa cert
sudo mkdir -p /etc/nginx/ssl/mysite

# Tạo private key + self-signed certificate (hạn 365 ngày)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/mysite/privkey.pem \
    -out    /etc/nginx/ssl/mysite/cert.pem \
    -subj "/C=VN/ST=HCM/L=HoChiMinh/O=MyOrg/CN=mysite.local"

# Kiểm tra
sudo ls -la /etc/nginx/ssl/mysite/
# cert.pem    → public certificate
# privkey.pem → private key (giữ bí mật!)

# Xem thông tin cert
sudo openssl x509 -in /etc/nginx/ssl/mysite/cert.pem -text -noout | head -30
```

#### Bước 2: Cập nhật Nginx config cho HTTPS

```bash
sudo tee /etc/nginx/sites-available/mysite << 'EOF'
# ── Redirect HTTP → HTTPS ─────────────────────────
server {
    listen 80;
    server_name mysite.local;
    return 301 https://$host$request_uri;
}

# ── HTTPS Server ──────────────────────────────────
server {
    listen 443 ssl;
    server_name mysite.local;

    root /var/www/mysite;
    index index.html;

    # Certificate
    ssl_certificate     /etc/nginx/ssl/mysite/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/mysite/privkey.pem;

    # TLS settings (chỉ cho phép TLS 1.2 và 1.3)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Session cache (tăng performance)
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    server_tokens off;

    access_log /var/log/nginx/mysite-ssl.access.log;
    error_log  /var/log/nginx/mysite-ssl.error.log;

    location / {
        try_files $uri $uri/ =404;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

#### Bước 3: Test

```bash
# Test HTTPS (bỏ qua verify cert vì self-signed)
curl -k https://mysite.local

# Xem thông tin SSL
curl -kv https://mysite.local 2>&1 | grep -E "SSL|TLS|certificate|subject"

# Test redirect HTTP → HTTPS
curl -I http://mysite.local   # → 301 Moved Permanently
```

---

### Phần B: Let's Encrypt (cần domain thật + port 80/443 public)

> Bỏ qua phần này nếu chỉ lab local. Dùng khi có VPS + domain thật.

```bash
# Cài certbot
sudo apt install certbot python3-certbot-nginx -y

# Lấy cert tự động (certbot sửa nginx config luôn)
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Certbot tự tạo cron renew, kiểm tra:
sudo certbot renew --dry-run

# Xem cert đã được cài
sudo certbot certificates
```

Config sau khi certbot chạy sẽ tự thêm:
```nginx
ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
include /etc/letsencrypt/options-ssl-nginx.conf;
```

### Hiểu sâu hơn: Luồng TLS Handshake

```
1. Client → Server: "ClientHello" (TLS version, cipher suites hỗ trợ)
2. Server → Client: "ServerHello" + Certificate (cert.pem)
3. Client xác minh cert (CA chain, expiry, domain)
4. Client tạo session key, mã hóa bằng public key trong cert
5. Server giải mã bằng private key (privkey.pem)
6. Cả hai dùng session key để mã hóa data từ đây
```

### Kiểm tra Lab 2

```bash
# Kiểm tra grade SSL (nếu có domain public)
# https://www.ssllabs.com/ssltest/

# Local check
openssl s_client -connect mysite.local:443 -servername mysite.local

# Xem cert expiry
echo | openssl s_client -connect mysite.local:443 2>/dev/null \
    | openssl x509 -noout -dates
```

---

## Lab 3 — Reverse Proxy

**Mục tiêu:** Dùng Nginx làm reverse proxy trước một backend app (Node.js/Python), hiểu cách route request, pass headers.

### Bước 1: Tạo backend app đơn giản

#### Cách A: Python (không cần cài gì thêm)

```bash
# Tạo backend app
mkdir -p ~/backend-app
tee ~/backend-app/app.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
import json, os

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

        data = {
            "message": "Hello from Backend!",
            "path": self.path,
            "headers": {
                "x-real-ip":        self.headers.get("X-Real-IP", ""),
                "x-forwarded-for":  self.headers.get("X-Forwarded-For", ""),
                "host":             self.headers.get("Host", ""),
                "x-forwarded-proto":self.headers.get("X-Forwarded-Proto", ""),
            }
        }
        self.wfile.write(json.dumps(data, indent=2).encode())

    def log_message(self, format, *args):
        print(f"[Backend] {args[0]} {args[1]}")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3000))
    print(f"Backend running on port {port}")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
EOF

# Chạy backend (background)
python3 ~/backend-app/app.py &
echo "Backend PID: $!"

# Test backend trực tiếp
curl http://127.0.0.1:3000/api/test
```

#### Cách B: Node.js

```bash
mkdir -p ~/backend-app
tee ~/backend-app/server.js << 'EOF'
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        message: "Hello from Backend!",
        path: req.url,
        headers: {
            "x-real-ip":         req.headers["x-real-ip"] || "",
            "x-forwarded-for":   req.headers["x-forwarded-for"] || "",
            "host":              req.headers["host"] || "",
            "x-forwarded-proto": req.headers["x-forwarded-proto"] || "",
        }
    }, null, 2));
});

server.listen(3000, '127.0.0.1', () => console.log('Backend on port 3000'));
EOF

node ~/backend-app/server.js &
```

### Bước 2: Config Nginx Reverse Proxy

```bash
sudo tee /etc/nginx/sites-available/reverseproxy << 'EOF'
server {
    listen 80;
    server_name proxy.local;

    access_log /var/log/nginx/proxy.access.log;
    error_log  /var/log/nginx/proxy.error.log;

    # ── Proxy tất cả requests đến backend ────────────
    location / {
        proxy_pass http://127.0.0.1:3000;

        # Truyền thông tin client thật cho backend
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout    30s;
        proxy_read_timeout    30s;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/reverseproxy /etc/nginx/sites-enabled/
echo "127.0.0.1 proxy.local" | sudo tee -a /etc/hosts
sudo nginx -t && sudo systemctl reload nginx
```

### Bước 3: Test và quan sát headers

```bash
# Gọi qua Nginx (port 80)
curl http://proxy.local/api/hello

# So sánh: gọi thẳng backend
curl http://127.0.0.1:3000/api/hello

# Thấy sự khác biệt:
# - Qua Nginx: x-real-ip, x-forwarded-for có giá trị
# - Gọi thẳng: headers đó rỗng
```

### Bước 4: Routing nhiều backend (path-based)

```bash
# Tạo backend thứ 2 trên port 3001
tee ~/backend-app/app2.py << 'EOF'
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"service": "Backend 2", "path": self.path}).encode())

HTTPServer(("127.0.0.1", 3001), Handler).serve_forever()
EOF

python3 ~/backend-app/app2.py &
```

Cập nhật Nginx config:
```bash
sudo tee /etc/nginx/sites-available/reverseproxy << 'EOF'
server {
    listen 80;
    server_name proxy.local;

    # Route /api/ → Backend 1 (port 3000)
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Route /service2/ → Backend 2 (port 3001)
    location /service2/ {
        proxy_pass http://127.0.0.1:3001/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Route / → Static files
    location / {
        root /var/www/mysite;
        try_files $uri $uri/ =404;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

```bash
# Test routing
curl http://proxy.local/          # → Static HTML
curl http://proxy.local/api/test  # → Backend 1
curl http://proxy.local/service2/ # → Backend 2
```

### Bước 5: Thêm Load Balancing

```bash
# Tạo thêm backend 3 trên port 3002 (giả lập 3 instances cùng app)
# Hoặc dùng lại port 3000 và 3001 làm demo

sudo tee /etc/nginx/sites-available/reverseproxy << 'EOF'
upstream backend_pool {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    # Khi thêm server: chỉ thêm dòng này + reload, không downtime
}

server {
    listen 80;
    server_name proxy.local;

    location /api/ {
        proxy_pass http://backend_pool/;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Thêm header để thấy upstream nào xử lý
        add_header X-Upstream $upstream_addr;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx

# Gọi nhiều lần → thấy X-Upstream thay đổi (round robin)
for i in {1..6}; do
    curl -s -I http://proxy.local/api/ | grep X-Upstream
done
```

### Bước 6: Kết hợp HTTPS + Reverse Proxy (hoàn chỉnh)

```bash
sudo tee /etc/nginx/sites-available/full-stack << 'EOF'
upstream app_backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name proxy.local;
    return 301 https://$host$request_uri;
}

# HTTPS + Reverse Proxy
server {
    listen 443 ssl;
    server_name proxy.local;

    ssl_certificate     /etc/nginx/ssl/mysite/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/mysite/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;

    server_tokens off;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # Static files
    location / {
        root /var/www/mysite;
        try_files $uri $uri/ =404;
    }

    # API → Backend (SSL terminated tại đây, backend nhận HTTP)
    location /api/ {
        proxy_pass http://app_backend/;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # "https"
    }
}
EOF

# Disable config cũ, enable config mới
sudo rm -f /etc/nginx/sites-enabled/reverseproxy
sudo rm -f /etc/nginx/sites-enabled/mysite
sudo ln -s /etc/nginx/sites-available/full-stack /etc/nginx/sites-enabled/

sudo nginx -t && sudo systemctl reload nginx

# Test
curl -k https://proxy.local/            # → Static HTML
curl -k https://proxy.local/api/hello   # → Backend (round robin)
curl -I http://proxy.local              # → 301 redirect HTTPS
```

---

## Tổng kết & Checklist

### Lab 1 — Web Server ✅
- [ ] Nginx cài và chạy
- [ ] Virtual host phục vụ static files
- [ ] Trang 404 tùy chỉnh
- [ ] Cache header cho static assets

### Lab 2 — SSL ✅
- [ ] Tạo được self-signed certificate bằng OpenSSL
- [ ] Config `listen 443 ssl` với cert + key
- [ ] Redirect HTTP → HTTPS tự động
- [ ] Hiểu luồng TLS handshake
- [ ] (Bonus) Dùng certbot với domain thật

### Lab 3 — Reverse Proxy ✅
- [ ] Backend app chạy local
- [ ] Nginx proxy đến backend, pass đúng headers
- [ ] Path-based routing (nhiều backend)
- [ ] Load balancing round robin
- [ ] HTTPS + Reverse Proxy kết hợp

### Debug nhanh

```bash
sudo nginx -t                             # Kiểm tra config
sudo journalctl -u nginx -f               # Xem logs realtime
tail -f /var/log/nginx/error.log          # Error log
curl -v http://proxy.local                # Verbose request
curl -kv https://proxy.local             # HTTPS verbose
ps aux | grep nginx                       # Xem process
```

### Dọn dẹp sau lab

```bash
# Kill backend processes
kill $(lsof -t -i:3000) $(lsof -t -i:3001) 2>/dev/null

# Xóa host entries
sudo sed -i '/mysite.local\|proxy.local/d' /etc/hosts
```
