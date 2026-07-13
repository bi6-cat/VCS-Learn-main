# Dự án lab: High Availability Web System với HAProxy, Keepalived, Nginx và Supervisor trên VirtualBox

## 1. Tổng quan dự án

Dự án này xây dựng một hệ thống web có tính sẵn sàng cao trên môi trường máy ảo VirtualBox. Hệ thống mô phỏng mô hình triển khai thực tế gồm 2 máy Load Balancer chạy HAProxy và Keepalived, 2 máy Web Server chạy Nginx, và một ứng dụng mẫu được quản lý bằng Supervisor.

Mục tiêu chính của lab là giúp người học hiểu cách kết hợp các thành phần:

- **HAProxy**: cân bằng tải request HTTP đến nhiều web server.
- **Keepalived**: tạo Virtual IP (VIP) và tự động failover giữa 2 load balancer.
- **Nginx**: reverse proxy/web server ở tầng ứng dụng.
- **Supervisor**: quản lý tiến trình ứng dụng mẫu, tự khởi động lại khi process bị lỗi.
- **VirtualBox**: mô phỏng hạ tầng nhiều server trên một máy cá nhân.

Sau khi hoàn thành, người dùng truy cập vào một địa chỉ VIP duy nhất. Nếu một web server chết, HAProxy tự loại khỏi pool. Nếu load balancer chính chết, Keepalived chuyển VIP sang load balancer dự phòng. Nếu ứng dụng trên web server bị dừng, Supervisor tự khởi động lại.

## 2. Mục tiêu học tập

Sau lab này, người học cần nắm được:

1. Cách thiết kế mô hình HA cho web application cơ bản.
2. Cách cấu hình HAProxy để cân bằng tải Layer 7.
3. Cách cấu hình Keepalived dùng VRRP để quản lý VIP.
4. Cách dùng Nginx làm reverse proxy cho ứng dụng nội bộ.
5. Cách dùng Supervisor để quản lý process ứng dụng.
6. Cách kiểm thử failover, health check và tự phục hồi dịch vụ.
7. Cách ghi nhận kết quả lab bằng log, ảnh chụp màn hình và bảng kiểm thử.

## 3. Kiến trúc đề xuất

### 3.1. Sơ đồ logic

```text
                       Client / Host Machine
                              |
                              |
                      http://192.168.56.10
                              |
                       Virtual IP - VIP
                              |
                +-------------+-------------+
                |                           |
          +-----+-----+               +-----+-----+
          |   LB1     |               |   LB2     |
          | HAProxy   |               | HAProxy   |
          | Keepalived|               | Keepalived|
          +-----+-----+               +-----+-----+
                |                           |
                +-------------+-------------+
                              |
                    HAProxy backend pool
                              |
                +-------------+-------------+
                |                           |
          +-----+-----+               +-----+-----+
          |  WEB1     |               |  WEB2     |
          |  Nginx    |               |  Nginx    |
          | Supervisor|               | Supervisor|
          | App :9000 |               | App :9000 |
          +-----------+               +-----------+
```

### 3.2. Luồng request

1. Client truy cập `http://192.168.56.10`.
2. VIP đang nằm trên LB1 hoặc LB2 tùy trạng thái Keepalived.
3. HAProxy nhận request ở port 80.
4. HAProxy kiểm tra sức khỏe WEB1 và WEB2.
5. Request được chuyển đến một web server còn khỏe.
6. Nginx trên web server nhận request.
7. Nginx reverse proxy request vào ứng dụng mẫu chạy local ở `127.0.0.1:9000`.
8. Ứng dụng trả response, Nginx trả về HAProxy, HAProxy trả về client.

## 4. Danh sách máy ảo

| VM | Vai trò | Hostname | IP host-only | Dịch vụ |
|---|---|---|---|---|
| LB1 | Load balancer chính | `lb1` | `192.168.56.11` | HAProxy, Keepalived |
| LB2 | Load balancer dự phòng | `lb2` | `192.168.56.12` | HAProxy, Keepalived |
| WEB1 | Web server 1 | `web1` | `192.168.56.21` | Nginx, Supervisor, app |
| WEB2 | Web server 2 | `web2` | `192.168.56.22` | Nginx, Supervisor, app |
| VIP | IP truy cập dịch vụ | N/A | `192.168.56.10` | Floating IP |

Gợi ý cấu hình mỗi VM:

| Thành phần | Cấu hình tối thiểu |
|---|---|
| OS | Ubuntu Server 22.04 LTS hoặc 24.04 LTS |
| CPU | 1 vCPU |
| RAM | 1 GB |
| Disk | 10-20 GB |
| Network 1 | NAT để cài package từ Internet |
| Network 2 | Host-only Adapter `192.168.56.0/24` |

Lưu ý: VIP `192.168.56.10` phải nằm cùng subnet với LB1, LB2, WEB1, WEB2 và không được trùng IP với VM khác hoặc DHCP range của VirtualBox.

## 5. Phạm vi triển khai

### 5.1. Trong phạm vi

- Cấu hình IP tĩnh cho từng VM.
- Cài HAProxy trên LB1 và LB2.
- Cài Keepalived trên LB1 và LB2.
- Cài Nginx trên WEB1 và WEB2.
- Cài Supervisor trên WEB1 và WEB2.
- Tạo ứng dụng HTTP mẫu trả về hostname/IP để quan sát cân bằng tải.
- Kiểm thử failover load balancer.
- Kiểm thử health check web server.
- Kiểm thử Supervisor tự restart ứng dụng.

### 5.2. Ngoài phạm vi

- HTTPS/TLS production.
- Database cluster.
- CI/CD tự động.
- Monitoring nâng cao bằng Prometheus/Grafana.
- Hardening bảo mật đầy đủ cho môi trường production.

## 6. Chuẩn bị môi trường VirtualBox

### 6.1. Tạo Host-only Network

Trong VirtualBox:

1. Mở `File` -> `Tools` -> `Network Manager`.
2. Tạo hoặc chọn mạng Host-only.
3. Đặt subnet, ví dụ:

```text
IPv4 Address: 192.168.56.1
IPv4 Network Mask: 255.255.255.0
```

Có thể tắt DHCP để dễ quản lý IP tĩnh, hoặc giữ DHCP nhưng chọn IP tĩnh nằm ngoài DHCP range.

### 6.2. Gắn 2 card mạng cho mỗi VM

Mỗi VM nên có:

- Adapter 1: NAT.
- Adapter 2: Host-only Adapter.

NAT dùng để cài package. Host-only dùng để các VM và máy host giao tiếp với nhau.

## 7. Cấu hình IP tĩnh mẫu bằng Netplan

Ví dụ trên LB1, file `/etc/netplan/01-lab.yaml`:

```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:
      dhcp4: false
      addresses:
        - 192.168.56.11/24
```

Áp dụng cấu hình:

```bash
sudo netplan apply
ip a
ping -c 3 192.168.56.1
```

Thay IP tương ứng cho các máy:

```text
LB1  : 192.168.56.11/24
LB2  : 192.168.56.12/24
WEB1 : 192.168.56.21/24
WEB2 : 192.168.56.22/24
VIP  : 192.168.56.10/24
```

## 8. Cài đặt package

Trên LB1 và LB2:

```bash
sudo apt update
sudo apt install -y haproxy keepalived curl vim
```

Trên WEB1 và WEB2:

```bash
sudo apt update
sudo apt install -y nginx supervisor python3 curl vim
```

## 9. Triển khai ứng dụng mẫu trên WEB1 và WEB2

Tạo thư mục ứng dụng:

```bash
sudo mkdir -p /opt/lab-app
sudo vim /opt/lab-app/app.py
```

Nội dung `/opt/lab-app/app.py`:

```python
#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, HTTPServer
import socket

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        hostname = socket.gethostname()
        body = f"Hello from {hostname}\nPath: {self.path}\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body.encode())))
        self.end_headers()
        self.wfile.write(body.encode())

server = HTTPServer(("127.0.0.1", 9000), Handler)
server.serve_forever()
```

Phân quyền:

```bash
sudo chmod +x /opt/lab-app/app.py
```

## 10. Cấu hình Supervisor trên WEB1 và WEB2

Tạo file `/etc/supervisor/conf.d/lab-app.conf`:

```ini
[program:lab-app]
command=/usr/bin/python3 /opt/lab-app/app.py
directory=/opt/lab-app
autostart=true
autorestart=true
startsecs=3
startretries=3
stderr_logfile=/var/log/lab-app.err.log
stdout_logfile=/var/log/lab-app.out.log
user=root
```

Reload Supervisor:

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status
```

Kiểm tra ứng dụng:

```bash
curl http://127.0.0.1:9000
```

## 11. Cấu hình Nginx trên WEB1 và WEB2

Tạo file `/etc/nginx/sites-available/lab-app`:

```nginx
server {
    listen 80;
    server_name _;

    access_log /var/log/nginx/lab-app.access.log;
    error_log  /var/log/nginx/lab-app.error.log;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        return 200 "ok\n";
        add_header Content-Type text/plain;
    }
}
```

Kích hoạt site:

```bash
sudo ln -s /etc/nginx/sites-available/lab-app /etc/nginx/sites-enabled/lab-app
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Kiểm tra từ LB1 hoặc LB2:

```bash
curl http://192.168.56.21
curl http://192.168.56.22
curl http://192.168.56.21/health
curl http://192.168.56.22/health
```

## 12. Cấu hình HAProxy trên LB1 và LB2

Sao lưu file cấu hình cũ:

```bash
sudo cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.bak
sudo vim /etc/haproxy/haproxy.cfg
```

Nội dung cấu hình mẫu:

```haproxy
global
    log /dev/log local0
    log /dev/log local1 notice
    chroot /var/lib/haproxy
    stats socket /run/haproxy/admin.sock mode 660 level admin
    stats timeout 30s
    user haproxy
    group haproxy
    daemon

defaults
    log global
    mode http
    option httplog
    option dontlognull
    option forwardfor
    timeout connect 5s
    timeout client  50s
    timeout server  50s

frontend fe_web
    bind *:80
    default_backend be_web

backend be_web
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200
    server web1 192.168.56.21:80 check inter 2s fall 2 rise 2
    server web2 192.168.56.22:80 check inter 2s fall 2 rise 2

listen stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 5s
    stats auth admin:admin123
```

Kiểm tra và restart:

```bash
sudo haproxy -c -f /etc/haproxy/haproxy.cfg
sudo systemctl restart haproxy
sudo systemctl enable haproxy
```

Kiểm tra trực tiếp từng load balancer:

```bash
curl http://192.168.56.11
curl http://192.168.56.12
```

Trang thống kê HAProxy:

```text
http://192.168.56.11:8404/stats
http://192.168.56.12:8404/stats
Username: admin
Password: admin123
```

## 13. Cấu hình Keepalived

### 13.1. Script kiểm tra HAProxy

Tạo file `/etc/keepalived/check_haproxy.sh` trên cả LB1 và LB2:

```bash
#!/usr/bin/env bash
pidof haproxy >/dev/null 2>&1
```

Phân quyền:

```bash
sudo chmod +x /etc/keepalived/check_haproxy.sh
```

### 13.2. Cấu hình Keepalived trên LB1

File `/etc/keepalived/keepalived.conf`:

```conf
global_defs {
    router_id LB1
}

vrrp_script chk_haproxy {
    script "/etc/keepalived/check_haproxy.sh"
    interval 2
    fall 2
    rise 2
    weight -30
}

vrrp_instance VI_1 {
    state MASTER
    interface enp0s8
    virtual_router_id 51
    priority 150
    advert_int 1

    authentication {
        auth_type PASS
        auth_pass labpass
    }

    virtual_ipaddress {
        192.168.56.10/24
    }

    track_script {
        chk_haproxy
    }
}
```

### 13.3. Cấu hình Keepalived trên LB2

File `/etc/keepalived/keepalived.conf`:

```conf
global_defs {
    router_id LB2
}

vrrp_script chk_haproxy {
    script "/etc/keepalived/check_haproxy.sh"
    interval 2
    fall 2
    rise 2
    weight -30
}

vrrp_instance VI_1 {
    state BACKUP
    interface enp0s8
    virtual_router_id 51
    priority 100
    advert_int 1

    authentication {
        auth_type PASS
        auth_pass labpass
    }

    virtual_ipaddress {
        192.168.56.10/24
    }

    track_script {
        chk_haproxy
    }
}
```

Lưu ý:

- `interface enp0s8` cần đúng với tên card Host-only trên VM.
- `virtual_router_id` phải giống nhau giữa LB1 và LB2.
- `priority` của LB1 cao hơn LB2 để LB1 làm MASTER mặc định.
- `auth_pass` nên đổi nếu dùng trong môi trường thật.

Khởi động Keepalived:

```bash
sudo systemctl restart keepalived
sudo systemctl enable keepalived
sudo systemctl status keepalived
```

Kiểm tra VIP đang ở máy nào:

```bash
ip a | grep 192.168.56.10
```

## 14. Kiểm thử chức năng

### 14.1. Kiểm thử truy cập qua VIP

Từ máy host hoặc một VM client:

```bash
curl http://192.168.56.10
```

Chạy nhiều lần:

```bash
for i in {1..10}; do curl -s http://192.168.56.10; done
```

Kết quả kỳ vọng:

- Response luân phiên giữa `web1` và `web2`.
- HAProxy stats hiển thị cả 2 backend ở trạng thái UP.

### 14.2. Kiểm thử WEB1 bị lỗi

Trên WEB1:

```bash
sudo systemctl stop nginx
```

Trên client:

```bash
for i in {1..10}; do curl -s http://192.168.56.10; done
```

Kết quả kỳ vọng:

- Request vẫn thành công.
- Toàn bộ response đến từ `web2`.
- HAProxy stats hiển thị `web1` DOWN.

Khôi phục:

```bash
sudo systemctl start nginx
```

### 14.3. Kiểm thử Supervisor tự restart app

Trên WEB1:

```bash
sudo supervisorctl status
sudo pkill -f "/opt/lab-app/app.py"
sleep 5
sudo supervisorctl status
curl http://127.0.0.1:9000
```

Kết quả kỳ vọng:

- Process `lab-app` được Supervisor tự khởi động lại.
- Nginx tiếp tục proxy được vào app.

### 14.4. Kiểm thử failover LB1 sang LB2

Trên LB1:

```bash
sudo systemctl stop keepalived
```

Trên LB2:

```bash
ip a | grep 192.168.56.10
```

Trên client:

```bash
curl http://192.168.56.10
```

Kết quả kỳ vọng:

- VIP chuyển sang LB2.
- Client vẫn truy cập được dịch vụ qua `192.168.56.10`.

Khôi phục LB1:

```bash
sudo systemctl start keepalived
```

Tùy cấu hình priority, VIP có thể chuyển lại LB1.

### 14.5. Kiểm thử HAProxy chết trên LB1

Trên LB1:

```bash
sudo systemctl stop haproxy
```

Kết quả kỳ vọng:

- Script `chk_haproxy` làm giảm priority của LB1.
- Keepalived chuyển VIP sang LB2 nếu LB1 không còn đủ điều kiện làm MASTER.
- Client vẫn truy cập được qua VIP.

Khôi phục:

```bash
sudo systemctl start haproxy
```

## 15. Bảng nghiệm thu

| Mã kiểm thử | Nội dung | Cách kiểm tra | Kết quả kỳ vọng | Trạng thái |
|---|---|---|---|---|
| TC01 | Truy cập VIP | `curl http://192.168.56.10` | Có response HTTP 200 | Chưa test |
| TC02 | Cân bằng tải | Curl nhiều lần | Response luân phiên WEB1/WEB2 | Chưa test |
| TC03 | WEB1 down | Stop Nginx WEB1 | Traffic chuyển sang WEB2 | Chưa test |
| TC04 | WEB2 down | Stop Nginx WEB2 | Traffic chuyển sang WEB1 | Chưa test |
| TC05 | App bị kill | `pkill` app | Supervisor restart app | Chưa test |
| TC06 | LB1 down | Stop Keepalived hoặc tắt VM LB1 | VIP chuyển sang LB2 | Chưa test |
| TC07 | HAProxy LB1 lỗi | Stop HAProxy LB1 | VIP chuyển sang LB2 | Chưa test |
| TC08 | Khôi phục node | Start lại dịch vụ | Node quay lại trạng thái UP | Chưa test |

## 16. Các lỗi thường gặp

### 16.1. Không ping được giữa các VM

Nguyên nhân có thể:

- Chưa gắn Host-only Adapter.
- IP không cùng subnet.
- Netplan cấu hình sai tên interface.
- Firewall chặn ICMP hoặc HTTP.

Kiểm tra:

```bash
ip a
ip route
ping 192.168.56.11
ping 192.168.56.21
```

### 16.2. VIP không xuất hiện

Kiểm tra:

```bash
sudo systemctl status keepalived
sudo journalctl -u keepalived -f
ip a
```

Nguyên nhân thường gặp:

- Sai tên interface trong `keepalived.conf`.
- Trùng `virtual_router_id` với lab khác trong cùng mạng.
- VIP bị trùng với IP của máy khác.
- Keepalived chưa được restart sau khi đổi cấu hình.

### 16.3. HAProxy báo backend DOWN

Kiểm tra từ LB:

```bash
curl -v http://192.168.56.21/health
curl -v http://192.168.56.22/health
sudo journalctl -u haproxy -f
```

Nguyên nhân thường gặp:

- Nginx chưa chạy.
- Sai IP backend trong `haproxy.cfg`.
- Endpoint `/health` không trả HTTP 200.
- Firewall chặn port 80.

### 16.4. Nginx trả 502 Bad Gateway

Kiểm tra trên WEB:

```bash
sudo supervisorctl status
curl http://127.0.0.1:9000
sudo tail -f /var/log/nginx/lab-app.error.log
```

Nguyên nhân thường gặp:

- App chưa chạy.
- Supervisor chưa load config.
- App không listen ở `127.0.0.1:9000`.
- Sai `proxy_pass` trong Nginx.

## 17. Mở rộng lab

Sau khi lab cơ bản chạy ổn, có thể mở rộng:

1. Thêm WEB3 vào backend pool của HAProxy.
2. Bật sticky session bằng cookie trong HAProxy.
3. Thêm HTTPS termination tại HAProxy.
4. Thêm rate limiting bằng HAProxy hoặc Nginx.
5. Gửi log HAProxy/Nginx về một máy log tập trung.
6. Thêm Prometheus Node Exporter để giám sát VM.
7. Viết Ansible playbook để tự động hóa toàn bộ lab.
8. Đổi app mẫu Python thành Node.js, Flask hoặc Laravel.

## 18. Sản phẩm bàn giao

Khi hoàn thành dự án, cần có:

- File mô tả kiến trúc hệ thống.
- Ảnh chụp sơ đồ VirtualBox network.
- Ảnh chụp danh sách VM và IP.
- File cấu hình HAProxy trên LB1/LB2.
- File cấu hình Keepalived trên LB1/LB2.
- File cấu hình Nginx trên WEB1/WEB2.
- File cấu hình Supervisor trên WEB1/WEB2.
- Ảnh hoặc log chứng minh truy cập VIP thành công.
- Ảnh hoặc log chứng minh failover LB thành công.
- Ảnh hoặc log chứng minh backend health check hoạt động.
- Bảng nghiệm thu đã điền kết quả thực tế.

## 19. Kết luận

Lab này mô phỏng một kiến trúc web có tính sẵn sàng cao ở mức cơ bản nhưng sát với thực tế triển khai. HAProxy xử lý cân bằng tải, Keepalived xử lý failover cho tầng load balancer, Nginx làm web/reverse proxy ở tầng ứng dụng, và Supervisor đảm bảo process ứng dụng tự phục hồi khi gặp lỗi.

Điểm quan trọng nhất của bài lab không chỉ là cài được từng công cụ riêng lẻ, mà là hiểu được cách chúng phối hợp với nhau để giảm Single Point of Failure và giữ dịch vụ tiếp tục hoạt động khi một thành phần bị lỗi.
