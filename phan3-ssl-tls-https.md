# 🔒 PHẦN 3 — SSL/TLS & HTTPS

> **Mục tiêu:** Hiểu HTTPS hoạt động thế nào từ bên trong.  
> Biết cấu hình đúng, debug được lỗi SSL, và không chỉ copy-paste cert.

---

## 3.1 Lý Thuyết SSL/TLS

### HTTPS là gì?

**HTTPS = HTTP + TLS**

- **HTTP**: Giao thức truyền data — không mã hóa (ai cũng đọc được)
- **TLS** (Transport Layer Security): Lớp mã hóa phía dưới HTTP
- **SSL** (Secure Sockets Layer): Phiên bản cũ của TLS, hiện đã deprecated

```
HTTP (không mã hóa):
  Client ──── GET /login (password=123) ────→ Server
  Hacker có thể đọc: "password=123" ← nguy hiểm!

HTTPS (mã hóa):
  Client ──── [mã hóa] ────→ Server
  Hacker chỉ thấy: x8f2a#@!$%... ← không đọc được
```

**TLS bảo vệ 3 thứ:**
1. **Confidentiality (Bảo mật):** Mã hóa data, không ai đọc được
2. **Integrity (Toàn vẹn):** Data không bị thay đổi trên đường đi (MITM)
3. **Authentication (Xác thực):** Xác nhận đang nói chuyện với đúng server

---

### Symmetric vs Asymmetric Encryption

**Symmetric (Đối xứng) — "1 chìa khóa":**
```
Mã hóa:  PlainText + SecretKey → CipherText
Giải mã: CipherText + SecretKey → PlainText

Ưu điểm: Rất nhanh (AES-256 = hardware accelerated)
Nhược điểm: Làm sao chia sẻ SecretKey an toàn lần đầu?
```

**Asymmetric (Bất đối xứng) — "Cặp chìa khóa công khai/riêng tư":**
```
Có 2 khóa liên quan về mặt toán học:
  - Public Key: Chia sẻ công khai cho mọi người
  - Private Key: Giữ bí mật tuyệt đối

Mã hóa bằng Public Key → chỉ Private Key mới giải mã được
Ký bằng Private Key → ai cũng verify được bằng Public Key

Ưu điểm: Không cần chia sẻ secret trước
Nhược điểm: Chậm hơn Symmetric ~1000x
```

**TLS kết hợp cả hai:**
```
1. Dùng Asymmetric để trao đổi SecretKey an toàn (TLS Handshake)
2. Dùng Symmetric (SecretKey đó) để mã hóa data thực tế

→ An toàn của Asymmetric + Tốc độ của Symmetric
```

---

### TLS Handshake — Vẽ Được Sơ Đồ Này!

```
CLIENT                                    SERVER
  │                                          │
  │──── ClientHello ────────────────────────→│
  │     (TLS version, cipher suites,         │
  │      random number, SNI)                 │
  │                                          │
  │←─── ServerHello ─────────────────────── │
  │     (chọn TLS version, cipher suite,     │
  │      random number, Session ID)          │
  │                                          │
  │←─── Certificate ─────────────────────── │
  │     (Server gửi certificate chứa         │
  │      Public Key + thông tin server)      │
  │                                          │
  │←─── ServerHelloDone ─────────────────── │
  │                                          │
  │  [Client verify certificate]             │
  │  - Cert do trusted CA ký không?          │
  │  - Cert còn hạn không?                  │
  │  - Domain trong cert khớp không?         │
  │                                          │
  │──── ClientKeyExchange ─────────────────→│
  │     (Pre-master secret, mã hóa bằng      │
  │      server Public Key)                  │
  │                                          │
  │  [Cả 2 bên tính Master Secret từ:       │
  │   pre-master secret + 2 random numbers] │
  │  [Từ Master Secret → Session Keys]       │
  │                                          │
  │──── ChangeCipherSpec ──────────────────→│
  │──── Finished (mã hóa) ─────────────────→│
  │                                          │
  │←─── ChangeCipherSpec ─────────────────  │
  │←─── Finished (mã hóa) ────────────────  │
  │                                          │
  │  ══════ Encrypted Application Data ════ │
  │──── GET / HTTP/1.1 (mã hóa) ───────────→│
  │←─── 200 OK (mã hóa) ──────────────────  │
```

**TLS 1.3 cải tiến:** Handshake chỉ cần **1 round-trip** (thay vì 2 trong TLS 1.2)

---

### Certificate là gì?

**Certificate (chứng chỉ số)** = tài liệu điện tử chứa:
- Public Key của server
- Thông tin server (domain, organization, location)
- Thời hạn hiệu lực (notBefore, notAfter)
- **Chữ ký số** của Certificate Authority (CA)

```bash
# Xem chi tiết certificate
openssl s_client -connect google.com:443 -showcerts 2>/dev/null | \
  openssl x509 -noout -text | head -50

# Hoặc đơn giản hơn
echo | openssl s_client -connect google.com:443 2>/dev/null | \
  openssl x509 -noout -dates -subject -issuer
```

---

### Certificate Chain — Root CA → Intermediate CA → Leaf

```
Root CA (Mozilla, Google, DigiCert...)
  └─ Intermediate CA (ký bởi Root CA)
       └─ Your Certificate (ký bởi Intermediate CA)

Tại sao cần Intermediate CA?
→ Root CA keys cực kỳ bảo mật, ít khi dùng trực tiếp
→ Nếu Intermediate CA bị compromised → thu hồi chỉ Intermediate
→ Root CA vẫn an toàn

Browser verify:
1. Có Trust Your Cert không? → Xem Issuer
2. Có Trust Intermediate CA không? → Xem Issuer
3. Có Trust Root CA không? → Browser có built-in list ~150 Root CAs
4. Chuỗi hợp lệ → HTTPS padlock ✅
```

```nginx
# Nginx: cần cung cấp full chain (cert + intermediate)
ssl_certificate /etc/nginx/ssl/fullchain.pem;    # cert + intermediate CAs
ssl_certificate_key /etc/nginx/ssl/privkey.pem;  # Private key
```

---

### Self-signed vs CA-signed Certificate

| | Self-signed | CA-signed (Let's Encrypt...) |
|--|-------------|------------------------------|
| Ai ký | Bạn tự ký | Trusted CA ký |
| Browser tin | ❌ Cảnh báo đỏ | ✅ Padlock xanh |
| Dùng khi nào | Internal, dev, test | Production, public |
| Giá | Miễn phí | Miễn phí (Let's Encrypt) đến vài triệu/năm |
| Thời hạn | Tự định | 90 ngày (Let's Encrypt) đến 1-2 năm |

---

### SNI — Server Name Indication

**Vấn đề:** TLS Handshake xảy ra **TRƯỚC** khi HTTP headers được gửi.  
→ Server không biết client muốn domain nào (vì Host header chưa được gửi).  
→ Server không biết phải dùng certificate nào!

**SNI giải quyết:**  
Client gửi **domain name trong ClientHello** (bước đầu tiên của TLS Handshake).  
→ Server đọc SNI → chọn đúng certificate → tiếp tục handshake.

```
ClientHello:
  - TLS version: 1.3
  - Cipher suites: [TLS_AES_256_GCM_SHA384, ...]
  - Extensions:
    - server_name: "site-a.example.com"   ← SNI!
```

```nginx
# Nginx tự động dùng SNI để chọn certificate
# Mỗi server block có certificate riêng
server {
    listen 443 ssl;
    server_name site-a.example.com;
    ssl_certificate /etc/nginx/ssl/site-a.pem;
}

server {
    listen 443 ssl;
    server_name site-b.example.com;
    ssl_certificate /etc/nginx/ssl/site-b.pem;
}
```

> **Lưu ý:** SNI gửi domain name **không mã hóa** → ISP/hacker biết bạn đang truy cập domain nào.  
> **Encrypted Client Hello (ECH)** đang được phát triển để giải quyết vấn đề này.

---

### TLS 1.2 vs TLS 1.3

| | TLS 1.2 | TLS 1.3 |
|--|---------|---------|
| Handshake | 2 RTT | 1 RTT |
| 0-RTT | ❌ | ✅ (cho session resume) |
| Cipher suites | Nhiều, kể cả weak | Chỉ giữ lại mạnh |
| Forward Secrecy | Optional | Bắt buộc |
| Tốc độ | Chậm hơn | Nhanh hơn ~30% |

**Forward Secrecy (Perfect Forward Secrecy):**
> Nếu Private Key bị lộ trong tương lai, hacker vẫn không giải mã được traffic đã bắt trước đó.
> TLS 1.3 bắt buộc → mỗi session có key riêng (ephemeral keys).

---

## 3.2 Nginx SSL Configuration

### Cấu hình cơ bản

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name example.com;

    # Certificate files
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # TLS Protocol versions (chỉ dùng 1.2 và 1.3)
    ssl_protocols TLSv1.2 TLSv1.3;

    # Cipher suites (danh sách thuật toán mã hóa được phép)
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;    # TLS 1.3: client chọn cipher

    # Session caching — tối ưu performance
    ssl_session_cache shared:SSL:10m;    # Cache 10MB, shared giữa workers
    ssl_session_timeout 1d;              # Cache 1 ngày

    # OCSP Stapling — server tự verify cert còn valid, không để client hỏi CA
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    location / {
        root /var/www/html;
        index index.html;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name example.com;

    return 301 https://$host$request_uri;
}
```

---

### HSTS — HTTP Strict Transport Security

```nginx
# Trong server block HTTPS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

**Cách hoạt động:**
```
Lần 1: Browser truy cập http://example.com
        → Nginx redirect 301 → https://example.com
        → Response có header: Strict-Transport-Security: max-age=31536000

Lần 2+: Browser tự động dùng HTTPS (không cần redirect)
         → Nhanh hơn 1 round-trip
         → An toàn hơn (không có HTTP request lần đầu để MITM)

max-age=31536000 = 1 năm
includeSubDomains = áp dụng cho cả subdomain
preload = submit vào browser preload list (HTTPS ngay cả lần đầu tiên)
```

> ⚠️ **Cẩn thận:** Sau khi set HSTS với max-age dài, rất khó rollback về HTTP.  
> Test với max-age=300 (5 phút) trước.

---

### Security Headers (Best Practice)

```nginx
# Thêm vào server block HTTPS
add_header X-Frame-Options "SAMEORIGIN" always;          # Chống clickjacking
add_header X-Content-Type-Options "nosniff" always;      # Chống MIME sniffing
add_header X-XSS-Protection "1; mode=block" always;      # XSS protection (cũ)
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

---

### ssl_session_cache — Tối ưu Performance

```nginx
# Không cache (mỗi connection phải full handshake)
ssl_session_cache off;

# Cache shared giữa tất cả workers (khuyến nghị)
ssl_session_cache shared:SSL:10m;
# "shared:SSL:10m" = tên cache "SSL", kích thước 10MB
# 1MB lưu được khoảng 4000 sessions
# 10MB = 40,000 sessions

ssl_session_timeout 1d;
# Sessions được cache trong 1 ngày
# Client resume session = bỏ qua full handshake = nhanh hơn
```

---

## 3.3 Lab: SSL/TLS

### Lab 3.1: Self-signed Certificate với OpenSSL

```bash
# Tạo thư mục cho SSL files
sudo mkdir -p /etc/nginx/ssl

# Cách 1: Tạo self-signed cert (1 lệnh)
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/privkey.pem \
    -out /etc/nginx/ssl/fullchain.pem \
    -subj "/C=VN/ST=HoChiMinh/L=HoChiMinh/O=VCS/CN=mysite.local"

# Giải thích các tham số:
# req       = certificate request và self-signing
# -x509     = tạo self-signed (không phải CSR)
# -nodes    = không mã hóa private key (no DES → không cần passphrase)
# -days 365 = hạn 1 năm
# -newkey rsa:2048 = tạo RSA key 2048 bits
# -keyout   = file private key
# -out      = file certificate
# -subj     = thông tin cert (không cần interactive)

# Cách 2: Tạo riêng từng bước (để hiểu rõ hơn)
# Bước 1: Tạo private key
openssl genrsa -out privkey.pem 2048

# Bước 2: Tạo CSR (Certificate Signing Request)
openssl req -new -key privkey.pem -out request.csr \
    -subj "/CN=mysite.local/O=VCS/C=VN"

# Bước 3: Self-sign (thay vì gửi CSR lên CA)
openssl x509 -req -days 365 -in request.csr \
    -signkey privkey.pem -out fullchain.pem

# Kiểm tra certificate
openssl x509 -in fullchain.pem -noout -text | grep -E "(Subject|Issuer|Not|DNS)"
```

```nginx
# /etc/nginx/conf.d/mysite-ssl.conf
server {
    listen 443 ssl;
    server_name mysite.local;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    root /var/www/mysite;
    index index.html;
}

server {
    listen 80;
    server_name mysite.local;
    return 301 https://$host$request_uri;
}
```

```bash
sudo nginx -t && sudo nginx -s reload

# Test HTTPS (bỏ qua cert warning với -k)
curl -k https://mysite.local
curl -kv https://mysite.local 2>&1 | grep -E "(TLS|SSL|cipher|subject)"
```

---

### Lab 3.2: Let's Encrypt với Certbot (server có domain thật)

```bash
# Cài certbot
sudo apt install -y certbot python3-certbot-nginx

# Lấy cert (cần domain thật trỏ về server này)
sudo certbot --nginx -d example.com -d www.example.com \
    --non-interactive --agree-tos --email admin@example.com

# Certbot tự sửa nginx config và add cert
# Files được lưu tại:
# /etc/letsencrypt/live/example.com/fullchain.pem
# /etc/letsencrypt/live/example.com/privkey.pem

# Auto-renewal
sudo certbot renew --dry-run    # Test renewal
# Certbot tự tạo cron job hoặc systemd timer để renew

# Xem cert info
sudo certbot certificates
```

---

### Lab 3.3: Dùng mkcert cho local development

```bash
# mkcert tạo cert được browser tin (cho local dev)
# Cài mkcert
brew install mkcert            # Mac
sudo apt install mkcert        # Debian/Ubuntu

# Hoặc download binary: https://github.com/FiloSottile/mkcert

# Cài local CA vào browser
mkcert -install

# Tạo cert cho local domains
mkcert mysite.local api.local "*.dev.local"
# Tạo ra: mysite.local+2.pem và mysite.local+2-key.pem

# Copy vào nginx ssl dir
sudo cp mysite.local+2.pem /etc/nginx/ssl/fullchain.pem
sudo cp mysite.local+2-key.pem /etc/nginx/ssl/privkey.pem
```

---

### Lab 3.4: Debug và Verify SSL

```bash
# Xem TLS handshake chi tiết
openssl s_client -connect mysite.local:443

# Output quan trọng cần đọc được:
# Certificate chain → chain có đủ không?
# Server certificate → CN, expiry
# SSL-Session: Protocol → TLS version nào?
# Cipher Suite → cipher nào đang dùng?
# Verify return code → 0 = OK, khác 0 = lỗi

# Xem chỉ những thông tin quan trọng
echo | openssl s_client -connect mysite.local:443 2>/dev/null | \
    openssl x509 -noout -text | grep -E "(Subject|Issuer|Not Before|Not After|DNS)"

# Test TLS version cụ thể
openssl s_client -connect mysite.local:443 -tls1_2    # Test TLS 1.2
openssl s_client -connect mysite.local:443 -tls1_3    # Test TLS 1.3
openssl s_client -connect mysite.local:443 -tls1      # TLS 1.0 — nên bị từ chối

# Verify redirect HTTP → HTTPS
curl -v http://mysite.local 2>&1 | grep -E "(HTTP|Location)"

# Check SSL headers
curl -kI https://mysite.local | grep -E "(Strict|X-Frame|X-Content)"

# Test với curl verbose (xem TLS details)
curl -kv https://mysite.local 2>&1 | grep -E "(TLS|SSL|cipher|ALPN)"
```

---

### Troubleshooting SSL phổ biến

**1. ERR_CERT_COMMON_NAME_INVALID**
```
Nguyên nhân: Domain trong browser ≠ CN/SAN trong certificate
Kiểm tra:   openssl x509 -in cert.pem -noout -subject
            openssl x509 -in cert.pem -noout -ext subjectAltName
Giải pháp:  Tạo cert với đúng domain
```

**2. ERR_CERT_DATE_INVALID**
```
Nguyên nhân: Certificate hết hạn hoặc chưa đến ngày bắt đầu
Kiểm tra:   openssl x509 -in cert.pem -noout -dates
Giải pháp:  Renew cert
```

**3. ERR_CERT_AUTHORITY_INVALID**
```
Nguyên nhân: CA không được browser tin (self-signed hoặc custom CA)
Kiểm tra:   openssl verify -CAfile ca.pem cert.pem
Giải pháp:  Dùng Let's Encrypt (production) hoặc mkcert (dev)
```

**4. SSL_ERROR_RX_RECORD_TOO_LONG**
```
Nguyên nhân: Browser gửi HTTPS request đến port đang listen HTTP
             (Nginx trả HTTP response, browser expect TLS handshake)
Kiểm tra:   Server đang listen 443 với ssl chưa?
Giải pháp:  Thêm "ssl" vào listen directive: listen 443 ssl;
```

**5. 502 Bad Gateway với HTTPS backend**
```
Nguyên nhân: Nginx proxy_pass đến HTTPS backend nhưng không verify cert
Giải pháp:
  proxy_pass https://backend;
  proxy_ssl_verify off;                    # Dev only
  # Hoặc:
  proxy_ssl_trusted_certificate /path/to/ca.pem;
  proxy_ssl_verify on;
```

---

## ✅ Checkpoint Phần 3

1. **TLS Handshake:** Giải thích tại sao cần handshake trước khi gửi HTTP request?
2. **Symmetric vs Asymmetric:** TLS dùng loại nào và lúc nào? Tại sao không dùng asymmetric cho toàn bộ?
3. **Certificate chain:** Tại sao `fullchain.pem` chứa nhiều certs?
4. **SNI:** Nếu không có SNI, server có nhiều domains nhưng 1 IP có thể phục vụ HTTPS không?
5. **HSTS:** Tại sao cần test với `max-age` nhỏ trước?
6. **Debug:** Bạn thấy `SSL_ERROR_RX_RECORD_TOO_LONG` — nguyên nhân là gì?

> 🔴 **Bài tập thực hành bắt buộc:**
> 1. Tạo self-signed cert, cấu hình Nginx HTTPS, verify bằng `openssl s_client`
> 2. Cấu hình redirect HTTP → HTTPS, verify redirect bằng `curl -v`
> 3. Đọc và hiểu toàn bộ output của `openssl s_client -connect yoursite:443`

---

## 📎 Phụ Lục: OpenSSL Cheat Sheet

```bash
# Tạo private key
openssl genrsa -out key.pem 2048                    # RSA 2048
openssl genrsa -out key.pem 4096                    # RSA 4096 (mạnh hơn, chậm hơn)
openssl ecparam -name prime256v1 -genkey -out key.pem  # ECDSA (nhỏ hơn, nhanh hơn)

# Xem private key
openssl rsa -in key.pem -text -noout

# Tạo self-signed cert
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout key.pem -out cert.pem

# Xem certificate info
openssl x509 -in cert.pem -text -noout
openssl x509 -in cert.pem -noout -dates        # Ngày hết hạn
openssl x509 -in cert.pem -noout -subject      # Thông tin subject
openssl x509 -in cert.pem -noout -issuer       # CA đã ký
openssl x509 -in cert.pem -noout -fingerprint  # Fingerprint

# Verify certificate chain
openssl verify -CAfile ca-bundle.pem cert.pem

# Kiểm tra cert trên server
openssl s_client -connect host:443
openssl s_client -connect host:443 -servername hostname  # Với SNI

# Convert format
openssl x509 -in cert.pem -out cert.der -outform DER    # PEM → DER
openssl x509 -in cert.der -out cert.pem -inform DER     # DER → PEM
openssl pkcs12 -export -in cert.pem -inkey key.pem -out bundle.pfx  # PEM → PFX
```
