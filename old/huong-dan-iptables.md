# Hướng Dẫn Thực Hành iptables Từ Cơ Bản Đến Nâng Cao
## Môi trường: VirtualBox (Ubuntu Server)

---

## MỤC LỤC

1. [Giới thiệu iptables](#1-giới-thiệu-iptables)
2. [Chuẩn bị môi trường VirtualBox](#2-chuẩn-bị-môi-trường-virtualbox)
3. [Kiến trúc iptables](#3-kiến-trúc-iptables)
4. [Cú pháp cơ bản](#4-cú-pháp-cơ-bản)
5. [Thực hành cơ bản](#5-thực-hành-cơ-bản)
6. [Thực hành trung cấp](#6-thực-hành-trung-cấp)
7. [Thực hành nâng cao](#7-thực-hành-nâng-cao)
8. [Lưu và khôi phục rules](#8-lưu-và-khôi-phục-rules)
9. [Bài tập tổng hợp](#9-bài-tập-tổng-hợp)
10. [Tổng kết](#10-tổng-kết)

---

## 1. Giới thiệu iptables

**iptables** là công cụ quản lý tường lửa (firewall) trong Linux, cho phép người quản trị cấu hình các quy tắc lọc gói tin IP trong nhân Linux (kernel). iptables hoạt động dựa trên **Netfilter framework** — một tập hợp các hook trong kernel Linux dùng để can thiệp vào quá trình xử lý gói tin mạng.

### 1.1 Vai trò của iptables

- Lọc gói tin đến/đi/chuyển tiếp
- NAT (Network Address Translation)
- Ghi log các kết nối
- Giới hạn tốc độ kết nối (rate limiting)
- Port forwarding

### 1.2 iptables vs nftables

| Tiêu chí | iptables | nftables |
|---|---|---|
| Phiên bản Linux | Cũ hơn, phổ biến | Mới hơn (kernel 3.13+) |
| Cú pháp | Nhiều lệnh riêng biệt | Thống nhất hơn |
| Hiệu năng | Tốt | Tốt hơn iptables |
| Khả năng học | Dễ tìm tài liệu | Ít tài liệu hơn |

> **Ghi chú:** Ubuntu 22.04 trở lên mặc định dùng `nftables` nhưng vẫn tương thích iptables qua `iptables-legacy`.

---

## 2. Chuẩn bị môi trường VirtualBox

### 2.1 Yêu cầu hệ thống

- **Host:** Windows/macOS/Linux có VirtualBox ≥ 6.1
- **Guest OS:** Ubuntu Server 22.04 LTS (hoặc 20.04)
- **RAM:** Tối thiểu 512 MB mỗi VM
- **Disk:** 10 GB mỗi VM

### 2.2 Tạo máy ảo Lab

Bài thực hành sử dụng **2 máy ảo**:

| VM | Tên | Vai trò | Network |
|---|---|---|---|
| VM1 | `firewall-vm` | Máy chính cấu hình iptables | NAT + Host-only |
| VM2 | `client-vm` | Máy kiểm tra kết nối | Host-only |

#### Bước 1: Tạo VM1 (firewall-vm)

1. Mở VirtualBox → **New**
2. Name: `firewall-vm`, Type: Linux, Version: Ubuntu (64-bit)
3. RAM: 1024 MB, Disk: 10 GB
4. Cài Ubuntu Server 22.04

#### Bước 2: Cấu hình network cho VM1

```
VirtualBox → firewall-vm → Settings → Network

Adapter 1:
  - Attached to: NAT
  - (Dùng để truy cập internet)

Adapter 2:
  - Attached to: Host-only Adapter
  - Name: vboxnet0
  - (Dùng để giao tiếp với VM khác và host)
```

#### Bước 3: Tạo VM2 (client-vm)

Tương tự VM1 nhưng chỉ cần **1 Adapter Host-only**.

#### Bước 4: Cấu hình IP tĩnh trên VM1

```bash
# Xem tên card mạng
ip a

# Sửa file netplan (Ubuntu 22.04)
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp0s3:           # Card NAT
      dhcp4: true
    enp0s8:           # Card Host-only
      addresses:
        - 192.168.56.10/24
      nameservers:
        addresses: [8.8.8.8]
```

```bash
sudo netplan apply
```

#### Bước 5: Cấu hình IP tĩnh trên VM2

```yaml
network:
  version: 2
  ethernets:
    enp0s3:           # Card Host-only
      addresses:
        - 192.168.56.20/24
      routes:
        - to: default
          via: 192.168.56.10
```

```bash
sudo netplan apply
```

#### Bước 6: Kiểm tra kết nối

```bash
# Trên VM2, ping đến VM1
ping 192.168.56.10

# Trên VM1, ping đến VM2
ping 192.168.56.20
```

### 2.3 Cài đặt iptables

```bash
# Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y

# Cài iptables (nếu chưa có)
sudo apt install iptables iptables-persistent -y

# Kiểm tra phiên bản
iptables --version

# Kiểm tra rules hiện tại
sudo iptables -L -v -n
```

---

## 3. Kiến trúc iptables

### 3.1 Tables (Bảng)

iptables có **5 bảng chính**, mỗi bảng phục vụ mục đích khác nhau:

| Bảng | Mục đích | Chains mặc định |
|---|---|---|
| **filter** | Lọc gói tin (mặc định) | INPUT, OUTPUT, FORWARD |
| **nat** | Dịch địa chỉ mạng | PREROUTING, POSTROUTING, OUTPUT |
| **mangle** | Chỉnh sửa header gói tin | Tất cả chains |
| **raw** | Đánh dấu gói tin, bỏ qua tracking | PREROUTING, OUTPUT |
| **security** | SELinux security context | INPUT, OUTPUT, FORWARD |

> **Bảng filter là bảng được dùng nhiều nhất** trong thực tế.

### 3.2 Chains (Chuỗi)

```
Gói tin đến (INBOUND):
  Network Interface → PREROUTING → [Routing Decision]
    → INPUT → Local Process

Gói tin đi (OUTBOUND):
  Local Process → OUTPUT → POSTROUTING → Network Interface

Gói tin chuyển tiếp (FORWARD):
  Network Interface → PREROUTING → [Routing Decision]
    → FORWARD → POSTROUTING → Network Interface
```

### 3.3 Luồng xử lý gói tin

```
                    ┌─────────────────────────────┐
Gói tin vào ──────►│      PREROUTING (nat)        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       Routing Decision       │
                    └────────┬────────────┬────────┘
                             │            │
              ┌──────────────▼──┐    ┌────▼──────────────┐
              │  INPUT (filter) │    │  FORWARD (filter)  │
              └──────────────┬──┘    └────────────────────┘
                             │                │
              ┌──────────────▼──┐    ┌────────▼──────────┐
              │  Local Process  │    │ POSTROUTING (nat)  │
              └──────────────┬──┘    └────────────────────┘
                             │
              ┌──────────────▼──┐
              │ OUTPUT (filter) │
              └──────────────┬──┘
                             │
              ┌──────────────▼──────────────┐
              │      POSTROUTING (nat)       │
              └─────────────────────────────┘
```

### 3.4 Targets (Hành động)

| Target | Mô tả |
|---|---|
| `ACCEPT` | Chấp nhận gói tin |
| `DROP` | Loại bỏ gói tin (không thông báo) |
| `REJECT` | Loại bỏ và gửi thông báo lỗi cho nguồn |
| `LOG` | Ghi log gói tin |
| `RETURN` | Quay lại chain gọi |
| `MASQUERADE` | NAT tự động (dùng cho IP động) |
| `SNAT` | Source NAT (IP cố định) |
| `DNAT` | Destination NAT (port forwarding) |

---

## 4. Cú pháp cơ bản

### 4.1 Cấu trúc lệnh

```
iptables [-t table] COMMAND [chain] [match] -j TARGET
```

### 4.2 Các tùy chọn lệnh (COMMAND)

| Lệnh | Viết tắt | Mô tả |
|---|---|---|
| `--append` | `-A` | Thêm rule vào cuối chain |
| `--insert` | `-I` | Chèn rule vào vị trí cụ thể |
| `--delete` | `-D` | Xóa rule |
| `--replace` | `-R` | Thay thế rule |
| `--list` | `-L` | Liệt kê rules |
| `--flush` | `-F` | Xóa tất cả rules trong chain |
| `--new-chain` | `-N` | Tạo chain mới |
| `--delete-chain` | `-X` | Xóa chain |
| `--policy` | `-P` | Đặt policy mặc định cho chain |

### 4.3 Các tùy chọn match phổ biến

| Tùy chọn | Mô tả | Ví dụ |
|---|---|---|
| `-s` | Source IP | `-s 192.168.1.0/24` |
| `-d` | Destination IP | `-d 10.0.0.1` |
| `-p` | Protocol | `-p tcp` |
| `--sport` | Source port | `--sport 80` |
| `--dport` | Destination port | `--dport 22` |
| `-i` | Interface đến | `-i eth0` |
| `-o` | Interface đi | `-o eth0` |
| `--state` | Trạng thái kết nối | `--state ESTABLISHED` |

---

## 5. Thực hành cơ bản

### Lab 1: Xem và hiểu rules hiện tại

```bash
# Xem rules (dạng đơn giản)
sudo iptables -L

# Xem rules với thông tin chi tiết
sudo iptables -L -v

# Xem rules với số dòng và không resolve DNS
sudo iptables -L -v -n --line-numbers

# Xem rules của bảng cụ thể
sudo iptables -t nat -L -v -n

# Xem rules của chain cụ thể
sudo iptables -L INPUT -v -n
```

**Kết quả mẫu:**
```
Chain INPUT (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source     destination

Chain FORWARD (policy ACCEPT 0 packets, 0 bytes)
...

Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)
...
```

### Lab 2: Rules cơ bản - Chặn và cho phép

#### 2.1 Cho phép traffic cơ bản

```bash
# Cho phép loopback interface (quan trọng, luôn cần thiết)
sudo iptables -A INPUT -i lo -j ACCEPT

# Cho phép các kết nối đã được thiết lập và liên quan
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Cho phép SSH (port 22)
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Kiểm tra rules vừa thêm
sudo iptables -L INPUT -v -n --line-numbers
```

#### 2.2 Chặn traffic

```bash
# Chặn một IP cụ thể
sudo iptables -A INPUT -s 192.168.56.20 -j DROP

# Test từ VM2: ping đến VM1 sẽ không có phản hồi
# ping 192.168.56.10

# Chặn một dải IP
sudo iptables -A INPUT -s 192.168.56.0/24 -j DROP

# Chặn port cụ thể
sudo iptables -A INPUT -p tcp --dport 80 -j DROP
```

#### 2.3 Xóa rules

```bash
# Xóa rule theo số dòng (xem số dòng bằng --line-numbers)
sudo iptables -D INPUT 3

# Xóa rule bằng cách lặp lại lệnh thêm với -D thay -A
sudo iptables -D INPUT -s 192.168.56.20 -j DROP

# Xóa tất cả rules trong chain
sudo iptables -F INPUT

# Xóa tất cả rules trong tất cả chains
sudo iptables -F
```

### Lab 3: Policy mặc định

> **Cảnh báo:** Thao tác này có thể mất kết nối SSH nếu không cẩn thận!

```bash
# TRƯỚC KHI ĐỔI POLICY, phải cho phép SSH trước
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Đặt policy mặc định là DROP (chặn tất cả)
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT

# Kiểm tra: ping từ VM2 đến VM1 sẽ bị chặn
# Nhưng SSH vẫn hoạt động vì đã có rule ACCEPT

# Khôi phục policy về ACCEPT
sudo iptables -P INPUT ACCEPT
sudo iptables -P FORWARD ACCEPT
```

### Lab 4: Chặn theo protocol

```bash
# Chặn ping (ICMP) từ bên ngoài
sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP

# Test từ VM2: ping sẽ không nhận được phản hồi
# ping 192.168.56.10

# Cho phép ping chỉ từ một mạng cụ thể
sudo iptables -A INPUT -p icmp --icmp-type echo-request -s 192.168.56.0/24 -j ACCEPT

# Chặn UDP
sudo iptables -A INPUT -p udp --dport 53 -j DROP
```

---

## 6. Thực hành trung cấp

### Lab 5: Lọc theo trạng thái kết nối (Stateful Firewall)

```bash
# Xóa rules cũ
sudo iptables -F

# Cấu hình Stateful Firewall cơ bản
# 1. Cho phép loopback
sudo iptables -A INPUT -i lo -j ACCEPT

# 2. Cho phép kết nối đã thiết lập
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 3. Cho phép SSH
sudo iptables -A INPUT -p tcp --dport 22 -m state --state NEW -j ACCEPT

# 4. Cho phép HTTP/HTTPS
sudo iptables -A INPUT -p tcp --dport 80 -m state --state NEW -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -m state --state NEW -j ACCEPT

# 5. Đặt policy DROP
sudo iptables -P INPUT DROP

# Kiểm tra
sudo iptables -L -v -n --line-numbers
```

**Các trạng thái kết nối:**
| Trạng thái | Mô tả |
|---|---|
| `NEW` | Kết nối mới, chưa thiết lập |
| `ESTABLISHED` | Kết nối đã được thiết lập |
| `RELATED` | Kết nối liên quan (FTP data, ICMP error) |
| `INVALID` | Gói tin không thuộc kết nối nào |

### Lab 6: Logging

```bash
# Ghi log các gói tin bị DROP
sudo iptables -A INPUT -j LOG --log-prefix "[IPTABLES DROP] " --log-level 4

# Hoặc ghi log trước khi DROP
sudo iptables -I INPUT -s 192.168.56.20 -j LOG --log-prefix "[BLOCKED IP] "
sudo iptables -A INPUT -s 192.168.56.20 -j DROP

# Xem log
sudo tail -f /var/log/kern.log | grep "IPTABLES"
# Hoặc
sudo journalctl -f | grep "IPTABLES"

# Test: từ VM2 thử kết nối
# ping 192.168.56.10
```

### Lab 7: Rate Limiting (Giới hạn tốc độ)

```bash
# Giới hạn số kết nối SSH mới (chống brute force)
sudo iptables -A INPUT -p tcp --dport 22 -m state --state NEW \
  -m recent --set --name SSH

sudo iptables -A INPUT -p tcp --dport 22 -m state --state NEW \
  -m recent --update --seconds 60 --hitcount 4 --name SSH \
  -j LOG --log-prefix "[SSH RATE LIMIT] "

sudo iptables -A INPUT -p tcp --dport 22 -m state --state NEW \
  -m recent --update --seconds 60 --hitcount 4 --name SSH \
  -j DROP

sudo iptables -A INPUT -p tcp --dport 22 -m state --state NEW -j ACCEPT

# Giới hạn ping (chống ping flood)
sudo iptables -A INPUT -p icmp --icmp-type echo-request \
  -m limit --limit 1/s --limit-burst 3 -j ACCEPT

sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP
```

### Lab 8: Custom Chains

```bash
# Tạo chain mới để quản lý rules SSH
sudo iptables -N SSH_RULES

# Thêm rules vào custom chain
sudo iptables -A SSH_RULES -s 192.168.56.0/24 -j ACCEPT
sudo iptables -A SSH_RULES -j LOG --log-prefix "[SSH DENIED] "
sudo iptables -A SSH_RULES -j DROP

# Redirect traffic SSH đến custom chain
sudo iptables -A INPUT -p tcp --dport 22 -j SSH_RULES

# Xem custom chain
sudo iptables -L SSH_RULES -v -n

# Xóa custom chain (phải flush trước)
sudo iptables -D INPUT -p tcp --dport 22 -j SSH_RULES
sudo iptables -F SSH_RULES
sudo iptables -X SSH_RULES
```

### Lab 9: Multiport và IP Range

```bash
# Cho phép nhiều port cùng lúc
sudo iptables -A INPUT -p tcp -m multiport \
  --dports 80,443,8080,8443 -j ACCEPT

# Chặn một dải IP (IP range)
sudo iptables -A INPUT -m iprange \
  --src-range 192.168.56.50-192.168.56.100 -j DROP

# Kết hợp nhiều điều kiện
sudo iptables -A INPUT -p tcp \
  -s 192.168.56.0/24 \
  -m multiport --dports 80,443 \
  -m state --state NEW \
  -j ACCEPT
```

---

## 7. Thực hành nâng cao

### Lab 10: NAT - Masquerading (Chia sẻ Internet)

> **Mục tiêu:** VM1 làm gateway cho VM2 truy cập internet

```bash
# Bật IP forwarding trên VM1
echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward

# Bật vĩnh viễn
sudo nano /etc/sysctl.conf
# Bỏ comment dòng: net.ipv4.ip_forward=1
sudo sysctl -p

# Cấu hình MASQUERADE (NAT động)
sudo iptables -t nat -A POSTROUTING -o enp0s3 -j MASQUERADE

# Cho phép FORWARD traffic
sudo iptables -A FORWARD -i enp0s8 -o enp0s3 \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
sudo iptables -A FORWARD -i enp0s3 -o enp0s8 \
  -m state --state ESTABLISHED,RELATED -j ACCEPT

# Kiểm tra
sudo iptables -t nat -L -v -n

# Từ VM2, ping ra internet (sau khi đã set gateway là 192.168.56.10)
# ping 8.8.8.8
```

### Lab 11: Port Forwarding (DNAT)

> **Mục tiêu:** Chuyển tiếp port 8080 trên VM1 đến port 80 trên VM2

```bash
# Giả sử VM2 chạy web server trên port 80
# Trên VM2: sudo apt install nginx -y

# Trên VM1: Chuyển tiếp port 8080 → VM2:80
sudo iptables -t nat -A PREROUTING \
  -p tcp --dport 8080 \
  -j DNAT --to-destination 192.168.56.20:80

# Cho phép forward traffic
sudo iptables -A FORWARD \
  -p tcp -d 192.168.56.20 --dport 80 \
  -m state --state NEW,ESTABLISHED,RELATED \
  -j ACCEPT

# Kiểm tra từ máy host
# curl http://192.168.56.10:8080

# Xem rules NAT
sudo iptables -t nat -L -v -n --line-numbers
```

### Lab 12: Bảo vệ chống tấn công phổ biến

#### 12.1 Chống SYN Flood

```bash
# Giới hạn SYN packets
sudo iptables -A INPUT -p tcp --syn \
  -m limit --limit 1/s --limit-burst 3 \
  -j ACCEPT

sudo iptables -A INPUT -p tcp --syn -j DROP
```

#### 12.2 Chống Port Scan

```bash
# Tạo chain phát hiện port scan
sudo iptables -N PORT_SCAN

# Phát hiện và log
sudo iptables -A INPUT -m recent --name PORTSCAN --rcheck \
  --seconds 86400 -j DROP

sudo iptables -A INPUT -m recent --name PORTSCAN --remove

sudo iptables -A INPUT -p tcp -m tcp --dport 139 \
  -m recent --name PORTSCAN --set -j LOG \
  --log-prefix "[PORT SCAN] "

sudo iptables -A INPUT -p tcp -m tcp --dport 139 \
  -m recent --name PORTSCAN --set -j DROP
```

#### 12.3 Chống Ping of Death và ICMP Flood

```bash
# Chặn gói tin fragment
sudo iptables -A INPUT -f -j DROP

# Chặn gói tin ICMP bất thường
sudo iptables -A INPUT -p icmp --icmp-type address-mask-request -j DROP
sudo iptables -A INPUT -p icmp --icmp-type timestamp-request -j DROP

# Giới hạn ICMP
sudo iptables -A INPUT -p icmp \
  -m limit --limit 1/s --limit-burst 1 \
  -j ACCEPT
sudo iptables -A INPUT -p icmp -j DROP
```

#### 12.4 Chặn gói tin không hợp lệ

```bash
# Chặn gói tin INVALID state
sudo iptables -A INPUT -m state --state INVALID -j DROP

# Chặn gói tin TCP bất thường (NULL, XMAS scan)
sudo iptables -A INPUT -p tcp --tcp-flags ALL NONE -j DROP
sudo iptables -A INPUT -p tcp --tcp-flags ALL ALL -j DROP
sudo iptables -A INPUT -p tcp ! --syn -m state --state NEW -j DROP
```

### Lab 13: Firewall hoàn chỉnh cho Web Server

```bash
#!/bin/bash
# Script cấu hình firewall cho web server

# Xóa toàn bộ rules cũ
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X
iptables -t mangle -F
iptables -t mangle -X

# Policy mặc định
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# === LOOPBACK ===
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# === KẾT NỐI ĐÃ THIẾT LẬP ===
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# === CHẶN GÓI TIN BẤT HỢP LỆ ===
iptables -A INPUT -m state --state INVALID -j DROP
iptables -A INPUT -p tcp --tcp-flags ALL NONE -j DROP
iptables -A INPUT -p tcp --tcp-flags ALL ALL -j DROP
iptables -A INPUT -f -j DROP

# === SSH ===
# Chỉ cho phép từ mạng quản trị
iptables -A INPUT -p tcp --dport 22 \
  -s 192.168.56.0/24 \
  -m state --state NEW \
  -j ACCEPT

# Rate limit SSH
iptables -A INPUT -p tcp --dport 22 \
  -m recent --update --seconds 60 --hitcount 4 \
  -j LOG --log-prefix "[SSH BRUTE] "
iptables -A INPUT -p tcp --dport 22 \
  -m recent --update --seconds 60 --hitcount 4 \
  -j DROP

# === HTTP/HTTPS ===
iptables -A INPUT -p tcp -m multiport --dports 80,443 \
  -m state --state NEW \
  -m limit --limit 100/s --limit-burst 200 \
  -j ACCEPT

# === DNS (outbound) ===
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# === ICMP ===
iptables -A INPUT -p icmp --icmp-type echo-request \
  -m limit --limit 1/s --limit-burst 5 \
  -j ACCEPT

# === LOG DROPPED ===
iptables -A INPUT -j LOG \
  --log-prefix "[FIREWALL DROP] " \
  --log-level 4

echo "Firewall configured successfully!"
iptables -L -v -n
```

```bash
# Lưu script và chạy
sudo nano /usr/local/bin/setup-firewall.sh
# Paste nội dung trên vào
sudo chmod +x /usr/local/bin/setup-firewall.sh
sudo bash /usr/local/bin/setup-firewall.sh
```

---

## 8. Lưu và khôi phục rules

### 8.1 Lưu rules thủ công

```bash
# Lưu rules hiện tại
sudo iptables-save > /etc/iptables/rules.v4
sudo ip6tables-save > /etc/iptables/rules.v6

# Xem nội dung file
cat /etc/iptables/rules.v4
```

### 8.2 Khôi phục rules

```bash
# Khôi phục từ file
sudo iptables-restore < /etc/iptables/rules.v4

# Khôi phục kết hợp với iptables-persistent
sudo apt install iptables-persistent -y
sudo netfilter-persistent save
sudo netfilter-persistent reload
```

### 8.3 Tự động tải rules khi khởi động

```bash
# Sử dụng iptables-persistent (đã cài ở trên)
# Rules được tải tự động từ:
# /etc/iptables/rules.v4
# /etc/iptables/rules.v6

# Lưu rules hiện tại để tải khi boot
sudo netfilter-persistent save

# Kiểm tra service
sudo systemctl status netfilter-persistent
sudo systemctl enable netfilter-persistent
```

### 8.4 Tạo backup và restore

```bash
# Backup với timestamp
sudo iptables-save > ~/iptables-backup-$(date +%Y%m%d-%H%M%S).rules

# Liệt kê backup
ls ~/iptables-backup-*.rules

# Restore từ backup cụ thể
sudo iptables-restore < ~/iptables-backup-20240101-120000.rules
```

---

## 9. Bài tập tổng hợp

### Bài tập 1: Cấu hình firewall cơ bản

**Yêu cầu:** Cấu hình iptables trên VM1 với các điều kiện sau:
- Cho phép SSH từ mạng `192.168.56.0/24`
- Cho phép HTTP (80) và HTTPS (443) từ mọi nơi
- Cho phép ping từ mạng nội bộ
- Chặn tất cả traffic khác

**Gợi ý:**
```bash
sudo iptables -F
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
# ... thêm các rules còn lại
sudo iptables -P INPUT DROP
```

### Bài tập 2: Cấu hình NAT Gateway

**Yêu cầu:** Cấu hình VM1 làm NAT gateway cho VM2 truy cập internet.

**Kiểm tra thành công:** Từ VM2 có thể `ping 8.8.8.8` và `curl https://google.com`

### Bài tập 3: Port Forwarding

**Yêu cầu:**
- Cài Nginx trên VM2
- Cấu hình VM1 forward port 8080 → VM2:80
- Kiểm tra từ máy Host truy cập `http://192.168.56.10:8080`

### Bài tập 4: Phân tích và Debug

```bash
# Đếm gói tin theo rule
sudo iptables -L -v -n

# Reset counter
sudo iptables -Z

# Theo dõi log realtime
sudo tail -f /var/log/kern.log

# Trace gói tin (cần kernel module)
sudo modprobe nf_log_ipv4
sudo iptables -t raw -A PREROUTING -p icmp -j TRACE
sudo iptables -t raw -A OUTPUT -p icmp -j TRACE
```

---

## 10. Tổng kết

### 10.1 Checklist cấu hình firewall an toàn

- [ ] Luôn cho phép loopback (`-i lo -j ACCEPT`)
- [ ] Luôn cho phép ESTABLISHED,RELATED trước khi set DROP policy
- [ ] Cho phép SSH trước khi set policy DROP
- [ ] Test kết nối sau mỗi thay đổi
- [ ] Lưu rules sau khi cấu hình hoàn tất
- [ ] Bật IP forwarding nếu cần FORWARD
- [ ] Ghi log để theo dõi

### 10.2 Các lệnh hay dùng nhất

```bash
# Xem tất cả rules chi tiết
sudo iptables -L -v -n --line-numbers

# Xóa toàn bộ
sudo iptables -F && sudo iptables -X

# Reset về mặc định
sudo iptables -P INPUT ACCEPT
sudo iptables -P FORWARD ACCEPT
sudo iptables -P OUTPUT ACCEPT
sudo iptables -F

# Lưu rules
sudo netfilter-persistent save

# Xem NAT rules
sudo iptables -t nat -L -v -n
```

### 10.3 Troubleshooting phổ biến

| Vấn đề | Nguyên nhân | Giải pháp |
|---|---|---|
| Mất SSH sau khi set DROP | Chưa có rule ACCEPT SSH | Vào console VBox thêm rule SSH |
| Ping không hoạt động | ICMP bị chặn | Thêm rule ACCEPT ICMP |
| NAT không hoạt động | Chưa bật ip_forward | `echo 1 > /proc/sys/net/ipv4/ip_forward` |
| Rules mất sau reboot | Chưa lưu persistent | `sudo netfilter-persistent save` |
| Port forwarding không hoạt động | FORWARD chain bị DROP | Thêm rule FORWARD cho traffic |

### 10.4 Tài liệu tham khảo

- **Man page:** `man iptables`, `man iptables-extensions`
- **Netfilter project:** https://www.netfilter.org/
- **Ubuntu Wiki:** https://help.ubuntu.com/community/IptablesHowTo
- **ArchLinux Wiki:** https://wiki.archlinux.org/title/iptables

---

*Tài liệu này được biên soạn phục vụ mục đích học tập và thực hành trong môi trường lab VirtualBox.*  
*Phiên bản: 1.0 | Hệ điều hành: Ubuntu Server 22.04 LTS*
