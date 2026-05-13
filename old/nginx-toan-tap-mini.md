# NGINX — Lab Thực Hành Trên Ubuntu VirtualBox

> **Mục tiêu:** Dựng Nginx trên Ubuntu Server trong VirtualBox, cấu hình site, reverse proxy và kiểm tra kết quả bằng các lệnh thực tế.

---

## 1. Môi Trường Lab

### 1.1 Yêu cầu

- Host: Windows, có cài VirtualBox
- Guest OS: Ubuntu Server 22.04 LTS hoặc 24.04 LTS
- RAM: 1 GB cho mỗi VM là đủ cho lab cơ bản
- Disk: 10 GB trở lên

### 1.2 Topology đề xuất

| VM | Vai trò | Network |
|---|---|---|
| `nginx-vm` | Máy cài Nginx | NAT + Host-only |
| `client-vm` | Máy test truy cập | Host-only |

Nếu chỉ học một máy, có thể dùng luôn host Windows để truy cập qua IP Host-only của VM.

### 1.3 Cấu hình mạng VirtualBox

- Adapter 1: NAT để VM ra Internet và cài gói
- Adapter 2: Host-only Adapter để host/client truy cập vào VM

Trên Ubuntu, xem IP bằng:

```bash
ip a
```

---

## 2. Cài Đặt Nginx Trên Ubuntu

### 2.1 Cập nhật hệ thống

```bash
sudo apt update
sudo apt upgrade -y
```

### 2.2 Cài Nginx

```bash
sudo apt install nginx -y
```

Kiểm tra service:

```bash
systemctl status nginx
```

Nếu firewall bật, mở port 80:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw status
```

### 2.3 Kiểm tra Nginx hoạt động

Mở trình duyệt trên host hoặc client và truy cập IP của VM:

```text
http://<ip-host-only-cua-vm>
```

Nếu thấy trang mặc định của Nginx thì cài đặt thành công.

---

## 3. Cấu Trúc File Quan Trọng Trên Ubuntu

```text
/etc/nginx/
├── nginx.conf
├── sites-available/
├── sites-enabled/
├── conf.d/
└── mime.types

/var/log/nginx/
├── access.log
└── error.log
```

Trên Ubuntu, thường dùng `sites-available` và `sites-enabled` để tạo virtual host.

---

## 4. Lab 1: Serve Static HTML

### 4.1 Tạo thư mục web

```bash
sudo mkdir -p /var/www/lab-nginx
sudo chown -R $USER:$USER /var/www/lab-nginx
```

### 4.2 Tạo file index

```bash
cat > /var/www/lab-nginx/index.html <<'EOF'
<html>
<head><title>Lab Nginx Ubuntu VBox</title></head>
<body>
  <h1>Nginx lab running on Ubuntu VirtualBox</h1>
</body>
</html>
EOF
```

### 4.3 Tạo virtual host

```bash
sudo nano /etc/nginx/sites-available/lab-nginx
```

Nội dung:

```nginx
server {
    listen 80;
    server_name lab-nginx.local;

    root /var/www/lab-nginx;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### 4.4 Bật site

```bash
sudo ln -s /etc/nginx/sites-available/lab-nginx /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.5 Trỏ tên miền nội bộ bằng hosts

Trên máy host hoặc client, thêm dòng sau vào file hosts:

```text
<ip-host-only-cua-vm> lab-nginx.local
```

Truy cập:

```text
http://lab-nginx.local
```

---

## 5. Lab 2: Virtual Host Nhiều Site Trên Cùng 1 VM

### 5.1 Tạo site thứ hai

```bash
sudo mkdir -p /var/www/site2
echo '<h1>Site 2</h1>' | sudo tee /var/www/site2/index.html
```

### 5.2 Cấu hình site2

```bash
sudo nano /etc/nginx/sites-available/site2
```

```nginx
server {
    listen 80;
    server_name site2.local;

    root /var/www/site2;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### 5.3 Kích hoạt site2

```bash
sudo ln -s /etc/nginx/sites-available/site2 /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Thêm `site2.local` vào file hosts và kiểm tra từng site riêng biệt.

---

## 6. Lab 3: Reverse Proxy Sang Backend

Giả sử có app chạy ở port `3000` trên cùng VM hoặc máy khác.

### 6.1 Tạo cấu hình reverse proxy

```bash
sudo nano /etc/nginx/sites-available/api-proxy
```

```nginx
server {
    listen 80;
    server_name api.local;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6.2 Bật site và reload

```bash
sudo ln -s /etc/nginx/sites-available/api-proxy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 6.3 Lưu ý về dấu `/` trong `proxy_pass`

- `proxy_pass http://127.0.0.1:3000;` giữ nguyên URI
- `proxy_pass http://127.0.0.1:3000/;` cắt phần location khớp

---

## 7. Lab 4: Log, Lỗi 404 và Kiểm Tra Config

### 7.1 Custom log format

```bash
sudo nano /etc/nginx/nginx.conf
```

Thêm trong khối `http {}`:

```nginx
log_format lab '$remote_addr - [$time_local] "$request" $status '
               '$body_bytes_sent rt=$request_time urt=$upstream_response_time';

access_log /var/log/nginx/access.log lab;
error_log /var/log/nginx/error.log warn;
```

### 7.2 Custom error page 404

```nginx
error_page 404 /404.html;

location = /404.html {
    root /var/www/lab-nginx;
    internal;
}
```

### 7.3 Kiểm tra config

```bash
sudo nginx -t
sudo nginx -T
sudo tail -f /var/log/nginx/error.log
```

---

## 8. HTTPS Cơ Bản Cho Lab

Nếu muốn test HTTPS trên Ubuntu VBox, có thể dùng self-signed cert:

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/lab-nginx.key \
  -out /etc/ssl/certs/lab-nginx.crt
```

Ví dụ cấu hình:

```nginx
server {
    listen 443 ssl;
    server_name lab-nginx.local;

    ssl_certificate /etc/ssl/certs/lab-nginx.crt;
    ssl_certificate_key /etc/ssl/private/lab-nginx.key;

    root /var/www/lab-nginx;
    index index.html;
}

server {
    listen 80;
    server_name lab-nginx.local;
    return 301 https://$host$request_uri;
}
```

---

## 9. Lệnh Hay Dùng Trong Lab

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart nginx
sudo systemctl status nginx
sudo journalctl -u nginx -f
curl -I http://lab-nginx.local
```

### Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `502 Bad Gateway` | Backend không chạy hoặc sai `proxy_pass` | Kiểm tra app backend và port |
| `403 Forbidden` | Sai quyền thư mục/file | Đặt lại quyền `755` cho thư mục, `644` cho file |
| `404 Not Found` | Sai `root`, sai `server_name`, hoặc chưa bật site | Kiểm tra symlink và config |
| `nginx: [emerg]` | Lỗi cú pháp | Chạy `sudo nginx -t` để dò lỗi |

---

## 10. Ghi Nhớ Nhanh

- `nginx -t` dùng để test config trước khi reload
- Ubuntu thường quản lý site qua `sites-available` và `sites-enabled`
- `systemctl reload nginx` không làm rớt kết nối đang có
- `proxy_set_header` giúp backend biết thông tin client thật
- Lab trên VirtualBox nên dùng Host-only để máy host truy cập VM dễ hơn
