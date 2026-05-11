# BÁO CÁO: LÝ THUYẾT VÀ THỰC HÀNH NGINX TOÀN TẬP

## PHẦN I: LÝ THUYẾT NGINX

### 1. Nginx là gì?
Nginx (đọc là "engine-x") là một phần mềm web server mã nguồn mở nổi tiếng vì hiệu năng cao, độ ổn định và tiêu thụ rất ít tài nguyên. Ngoài việc đóng vai trò là một HTTP Web Server chia sẻ các tập tin tĩnh, Nginx còn được sử dụng rộng rãi như là một Reverse Proxy, Load Balancer và HTTP Cache.

### 2. Kiến trúc của Nginx
- Khác với web server truyền thống như Apache (sử dụng kiến trúc multi-thread hoặc multi-process, với mỗi request là một thread/process riêng), Nginx sử dụng kiến trúc hướng sự kiện (Event-driven) và bất đồng bộ (Asynchronous).
- Kiến trúc xử lý theo từng luồng sự kiện phi tuyến tính này giúp Nginx có thể xử lý hàng chục ngàn kết nối đồng thời mà chỉ sử dụng một lượng tài nguyên RAM rất nhỏ, ngăn chặn tối đa tình trạng "thắt cổ chai".

### 3. Cấu trúc thư mục và file cấu hình (Trên Linux)
- `/etc/nginx/`: Thư mục chính chứa mọi cấu hình của hệ thống.
- `/etc/nginx/nginx.conf`: File cấu hình chung, quyết định cấu hình global cho toàn bộ Nginx.
- `/etc/nginx/sites-available/` & `/etc/nginx/sites-enabled/` (đối với Ubuntu/Debian) hoặc `/etc/nginx/conf.d/` (đối với CentOS): Là nơi quản lý cấu hình Virtual Host (Server Block) cho từng website riêng biệt.
- `/var/log/nginx/`: Cung cấp thông tin truy cập (`access.log`) và các lỗi xảy ra (`error.log`).

---

## PHẦN II: THỰC HÀNH (LAB) NGINX

### Bài Lab 1: Cài đặt và Quản lý Nginx Cơ Bản
**1. Cài đặt trên Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install nginx -y
```

**2. Quản lý service Nginx:**
```bash
# Khởi động Nginx
sudo systemctl start nginx 

# Cho phép Nginx khởi động cùng hệ thống tự động
sudo systemctl enable nginx 

# Kiểm tra trạng thái hiện tại
sudo systemctl status nginx
```
Truy cập IP của máy chủ bằng trình duyệt web `http://[IP-cua-ban]`, bạn sẽ thấy trang welcome mặc định của Nginx.

---

### Bài Lab 2: Cấu hình Virtual Host (Server Blocks)
**Tham vọng:** Chạy 2 website độc lập ví dụ `site1.local` trên duy nhất 1 máy chủ Nginx chạy port 80.

**1. Tạo thư mục chứa source web và dữ liệu test:**
```bash
sudo mkdir -p /var/www/site1.local/html
sudo chown -R $USER:$USER /var/www/site1.local/html

# Tạo 1 trang index.html để test
echo "<h1>Welcome to Site 1 on Nginx!</h1>" > /var/www/site1.local/html/index.html
```

**2. Tạo cấu hình Server Block cho website mới:**
```bash
sudo nano /etc/nginx/sites-available/site1.local
```
Nhập cấu hình sau vào và lưu lại:
```nginx
server {
    listen 80;
    server_name site1.local www.site1.local;
    
    root /var/www/site1.local/html;
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

**3. Kích hoạt website và Khởi động lại Nginx:**
```bash
# Tạo biểu tượng liên kết (symlink) kích hoạt
sudo ln -s /etc/nginx/sites-available/site1.local /etc/nginx/sites-enabled/

# Kiểm tra xem cấu hình có sai lỗi cú pháp không
sudo nginx -t

# Tải lại cấu hình mới cập nhật
sudo systemctl reload nginx
```

---

### Bài Lab 3: Cấu hình Nginx làm Reverse Proxy
**Tham vọng:** Nginx làm tấm thảm đỡ đạn phía trước và giấu backend application đang chạy nội bộ (Ví dụ NodeJS ở cổng 3000)

**1. Sửa hoặc tạo cấu hình trong Nginx:**
```nginx
server {
    listen 80;
    server_name app.domain.com;

    location / {
        proxy_pass http://localhost:3000; # Đẩy request về Backend Nodejs
        
        # Các header cần thiết gửi lại Backend hiểu ip thực của Client
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

### Bài Lab 4: Cấu hình Load Balancing (Cân Bằng Tải Cơ Bản)
**Tham vọng:** Phân phối lượng truy cập dồn dập từ frontend tới nhiều backend server nhỏ phía sau (1 máy trạm chia cho 2 webserver xử lý).

**1. Sửa lại cấu hình web server Nginx:**
```nginx
# Định nghĩa cụm group máy chủ backend (upstream)
upstream backend_servers {
    # Thuật toán mặc định là Round-Robin
    server 10.0.0.101:80;
    server 10.0.0.102:80;
}

server {
    listen 80;
    server_name lb.domain.com;

    location / {
        # proxy mọi request truy cập sang cho upstream xử lý
        proxy_pass http://backend_servers;
    }
}
```
*Lưu ý: Chạy lệnh `sudo nginx -t` và `sudo systemctl reload nginx` để cập nhật các Lab 3 và 4 sau khi tạo thay đổi file config. *
