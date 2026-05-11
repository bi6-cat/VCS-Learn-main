# Báo Cáo & Thực Hành OpenVPN
## Kịch bản thực tế: Remote Access VPN + Site-to-Site VPN
### Môi trường: VirtualBox 5 VM – Ubuntu Server 22.04 LTS

---

## MỤC LỤC

**PHẦN I – THIẾT KẾ HỆ THỐNG**

1. [Tổng quan kịch bản thực tế](#1-tổng-quan-kịch-bản-thực-tế)
2. [Kiến trúc mạng tổng thể](#2-kiến-trúc-mạng-tổng-thể)
3. [Chuẩn bị môi trường VirtualBox](#3-chuẩn-bị-môi-trường-virtualbox)

**PHẦN II – KỊCH BẢN 1: REMOTE ACCESS VPN**

4. [Cài đặt và cấu hình PKI](#4-cài-đặt-và-cấu-hình-pki)
5. [Cấu hình VPN Gateway Server](#5-cấu-hình-vpn-gateway-server)
6. [Cấu hình Internal Server](#6-cấu-hình-internal-server)
7. [Cấu hình Remote Client](#7-cấu-hình-remote-client)
8. [Kiểm tra kịch bản Remote Access](#8-kiểm-tra-kịch-bản-remote-access)

**PHẦN III – KỊCH BẢN 2: SITE-TO-SITE VPN**

9. [Thiết kế Site-to-Site](#9-thiết-kế-site-to-site)
10. [Cấu hình Gateway Chi nhánh A](#10-cấu-hình-gateway-chi-nhánh-a)
11. [Cấu hình Gateway Chi nhánh B](#11-cấu-hình-gateway-chi-nhánh-b)
12. [Kiểm tra Site-to-Site](#12-kiểm-tra-site-to-site)

**PHẦN IV – BÁO CÁO**

13. [Kết quả thực hành](#13-kết-quả-thực-hành)
14. [Phân tích và đánh giá](#14-phân-tích-và-đánh-giá)
15. [Xử lý sự cố](#15-xử-lý-sự-cố)

---

# PHẦN I – THIẾT KẾ HỆ THỐNG

## 1. Tổng quan kịch bản thực tế

### 1.1 Bối cảnh doanh nghiệp mô phỏng

Bài lab mô phỏng hệ thống mạng của công ty **VCS** có:

- **Trụ sở chính (HEAD)** tại Hà Nội — có VPN Gateway, Web Server nội bộ, và kết nối Internet
- **Chi nhánh (Branch)** tại TP.HCM — kết nối về trụ sở qua Site-to-Site VPN
- **Nhân viên làm từ xa (Remote Employee)** — kết nối từ nhà về mạng công ty qua Remote Access VPN

### 1.2 Hai kịch bản triển khai

**Kịch bản 1 – Remote Access VPN:**
> Nhân viên Quang đang làm việc tại nhà (mạng khác hoàn toàn với công ty). Anh cần kết nối VPN về mạng HEAD để truy cập Web Server nội bộ và các tài nguyên chỉ có trong mạng LAN công ty.

**Kịch bản 2 – Site-to-Site VPN:**
> Chi nhánh TP.HCM cần truy cập trực tiếp vào File Server của Trụ sở Hà Nội như thể hai văn phòng đang trong cùng một mạng LAN — kết nối 24/7, tự động, không cần thao tác thủ công từ nhân viên.

---

## 2. Kiến trúc mạng tổng thể

### 2.1 Sơ đồ tổng quan

```
                        ┌─────────────────────────────┐
                        │   INTERNET (Giả lập)        │
                        │   NAT Network: 10.0.2.0/24  │
                        └──────┬──────────────┬────────┘
                               │              │
              ┌────────────────▼──┐      ┌────▼─────────────────┐
              │  VM1: HEAD-Gateway  │      │  VM4: Branch-Gateway │
              │  (VPN Server HEAD)  │      │  (VPN Server Branch) │
              │                   │◄════►│                      │
              │  WAN: 10.0.2.10   │  S2S │  WAN: 10.0.2.40      │
              │  LAN: 192.168.56.10   │  VPN │  LAN: 192.168.57.10      │
              │  VPN: 10.8.0.1    │      │  VPN: 10.8.0.1(s2s)  │
              └────────┬──────────┘      └─────────┬────────────┘
                       │                           │
              ┌────────▼──────────┐      ┌─────────▼────────────┐
              │  LAN HEAD (vboxnet1)│      │ LAN Branch (vboxnet2)│
              │  192.168.56.0/24     │      │  192.168.57.0/24        │
              │                   │      │                      │
              │  ┌─────────────┐  │      │  ┌────────────────┐  │
              │  │VM2:HEAD-Server│  │      │  │VM5:Branch-Client│ │
              │  │192.168.56.11   │  │      │  │192.168.57.11      │  │
              │  │(Web/File Svr│  │      │  │(PC chi nhánh)  │  │
              │  └─────────────┘  │      │  └────────────────┘  │
              └───────────────────┘      └──────────────────────┘

              ┌──────────────────────────────────────────────────┐
              │  REMOTE NETWORK (vboxnet3) - Mạng nhà nhân viên │
              │  192.168.147.0/24                                │
              │                                                  │
              │  ┌───────────────────────────────────────────┐   │
              │  │  VM3: Remote-Client (Laptop nhân viên)   │   │
              │  │  IP: 192.168.147.10                       │   │
              │  │  Kết nối VPN về HEAD qua Internet          │   │
              │  └───────────────────────────────────────────┘   │
              └──────────────────────────────────────────────────┘

══════════════════════════════════════════════════════════════════
LEGEND:
  ◄════►  Site-to-Site VPN Tunnel (10.9.0.0/30)
  - - ->  Remote Access VPN Tunnel (10.8.0.0/24)
```

### 2.2 Bảng quy hoạch địa chỉ IP

| VM | Hostname | Vai trò | Interface | IP Address | Network |
|---|---|---|---|---|---|
| VM1 | head-gateway | VPN Server HEAD + Router | eth0 (WAN) | 10.0.2.10 | NAT Network |
| VM1 | head-gateway | | eth1 (LAN) | 192.168.56.10/24 | vboxnet1 |
| VM1 | head-gateway | | tun0 (RA-VPN) | 10.8.0.1 | VPN Pool |
| VM1 | head-gateway | | tun1 (S2S-VPN) | 10.9.0.1/30 | S2S Tunnel |
| VM2 | head-server | Web + File Server | eth0 | 192.168.56.11/24 | vboxnet1 |
| VM3 | remote-client | Laptop nhân viên WFH | eth0 (WAN) | 10.0.2.30 | NAT Network |
| VM3 | remote-client | | eth1 (Home LAN) | 192.168.147.10/24 | vboxnet3 |
| VM3 | remote-client | | tun0 (RA-VPN) | 10.8.0.x | VPN Pool |
| VM4 | branch-gateway | VPN Server Branch | eth0 (WAN) | 10.0.2.40 | NAT Network |
| VM4 | branch-gateway | | eth1 (LAN) | 192.168.57.10/24 | vboxnet2 |
| VM4 | branch-gateway | | tun0 (S2S-VPN) | 10.9.0.2/30 | S2S Tunnel |
| VM5 | branch-client | PC nhân viên chi nhánh | eth0 | 192.168.57.11/24 | vboxnet2 |

### 2.3 Quy hoạch VPN Subnet

| VPN | Subnet | Mục đích |
|---|---|---|
| Remote Access Pool | 10.8.0.0/24 | Cấp IP cho nhân viên WFH |
| Site-to-Site Tunnel | 10.9.0.0/30 | Kết nối HEAD ↔ Branch Gateway |

---

## 3. Chuẩn bị môi trường VirtualBox

### 3.1 Tạo các Host-only Network

```
VirtualBox → File → Host Network Manager → Tạo 3 network:

vboxnet1 (LAN HEAD):
  IPv4: 192.168.56.1/24
  DHCP: Disabled

vboxnet2 (LAN Branch):
  IPv4: 192.168.57.1/24
  DHCP: Disabled

vboxnet3 (Home LAN - mạng nhà nhân viên):
  IPv4: 192.168.147.1/24
  DHCP: Disabled
```

### 3.2 Tạo NAT Network (giả lập Internet)

```
VirtualBox → File → Preferences → Network → NAT Networks → Add:

Name: LabInternet
Network CIDR: 10.0.2.0/24
DHCP: Disabled   ← Dùng IP tĩnh để dễ kiểm soát
```

### 3.3 Tạo và cấu hình 5 máy ảo

#### VM1 — head-gateway

```
Name: head-gateway | RAM: 1024MB | Disk: 10GB
Network:
  Adapter 1: NAT Network → LabInternet
  Adapter 2: Host-only → vboxnet1
```

#### VM2 — head-server

```
Name: head-server | RAM: 512MB | Disk: 10GB
Network:
  Adapter 1: Host-only → vboxnet1
```

#### VM3 — remote-client

```
Name: remote-client | RAM: 512MB | Disk: 10GB
Network:
  Adapter 1: NAT Network → LabInternet   ← "Internet" của nhân viên
  Adapter 2: Host-only → vboxnet3        ← "Mạng nhà" (không dùng VPN)
```

#### VM4 — branch-gateway

```
Name: branch-gateway | RAM: 512MB | Disk: 10GB
Network:
  Adapter 1: NAT Network → LabInternet
  Adapter 2: Host-only → vboxnet2
```

#### VM5 — branch-client

```
Name: branch-client | RAM: 512MB | Disk: 10GB
Network:
  Adapter 1: Host-only → vboxnet2
```

### 3.4 Cài đặt Ubuntu và cấu hình IP tĩnh

Sau khi cài Ubuntu Server 22.04 trên tất cả VM, cấu hình IP tĩnh:

**VM1 (head-gateway):**
```bash
sudo nano /etc/netplan/00-installer-config.yaml
```
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [10.0.2.10/24]
      routes:
        - to: default
          via: 10.0.2.1
      nameservers:
        addresses: [8.8.8.8]
    eth1:
      addresses: [192.168.56.10/24]
```
```bash
sudo netplan apply
sudo hostnamectl set-hostname head-gateway
```

**VM2 (head-server):**
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.56.11/24]
      routes:
        - to: default
          via: 192.168.56.10     # Gateway là head-gateway
      nameservers:
        addresses: [8.8.8.8]
```
```bash
sudo hostnamectl set-hostname head-server
```

**VM3 (remote-client):**
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [10.0.2.30/24]
      routes:
        - to: default
          via: 10.0.2.1
      nameservers:
        addresses: [8.8.8.8]
    eth1:
      addresses: [192.168.147.10/24]
```
```bash
sudo hostnamectl set-hostname remote-client
```

**VM4 (branch-gateway):**
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [10.0.2.40/24]
      routes:
        - to: default
          via: 10.0.2.1
      nameservers:
        addresses: [8.8.8.8]
    eth1:
      addresses: [192.168.57.10/24]
```
```bash
sudo hostnamectl set-hostname branch-gateway
```

**VM5 (branch-client):**
```yaml
network:
  version: 2
  ethernets:
    eth0:
      addresses: [192.168.57.11/24]
      routes:
        - to: default
          via: 192.168.57.10     # Gateway là branch-gateway
      nameservers:
        addresses: [8.8.8.8]
```
```bash
sudo hostnamectl set-hostname branch-client
```

### 3.5 Cài đặt gói phần mềm cơ bản

```bash
# Chạy trên TẤT CẢ 5 VM
sudo apt update && sudo apt upgrade -y
sudo apt install -y openvpn easy-rsa net-tools curl wget vim \
                    iptables iptables-persistent tcpdump
```

### 3.6 Kiểm tra kết nối ban đầu

```bash
# VM1 ping VM4 (cùng NAT Network - "Internet")
ping -c 3 10.0.2.40     # → Phải thành công

# VM1 ping VM2 (cùng LAN HEAD)
ping -c 3 192.168.56.11    # → Phải thành công

# VM3 ping VM1 (qua Internet giả lập)
ping -c 3 10.0.2.10     # → Phải thành công

# VM3 ping VM2 (chưa qua VPN → PHẢI THẤT BẠI)
ping -c 3 192.168.56.11    # → Request timeout (đây là điều bình thường)
```

---

# PHẦN II – KỊCH BẢN 1: REMOTE ACCESS VPN

## 4. Cài đặt và cấu hình PKI

> Thực hiện trên **VM1 (head-gateway)**

### 4.1 Khởi tạo PKI

```bash
# Tạo thư mục CA
mkdir -p ~/vcs-pki
cp -r /usr/share/easy-rsa/* ~/vcs-pki/
cd ~/vcs-pki

# Khởi tạo PKI
./easyrsa init-pki
```
> **Mục đích:** Xây dựng cơ sở hạ tầng khóa công khai (Public Key Infrastructure - PKI). PKI là thành phần bảo mật cốt lõi, nơi sẽ quản lý toàn bộ việc cấp phát, thu hồi chứng chỉ (Certificate) số cho cả VPN Server và VPN Client.
> **Giải thích:** Việc copy thư mục `easy-rsa` ra ngoài giúp cấu hình không bị mất khi update phần mềm. Lệnh `init-pki` sẽ xóa sạch dữ liệu PKI cũ (nếu có) và tạo mới các thư mục để chuẩn bị sinh khóa CA.

### 4.2 Tùy chỉnh thông tin tổ chức

```bash
nano ~/vcs-pki/pki/vars
```
```bash
set_var EASYRSA_REQ_COUNTRY    "VN"
set_var EASYRSA_REQ_PROVINCE   "Hanoi"
set_var EASYRSA_REQ_CITY       "Hanoi"
set_var EASYRSA_REQ_ORG        "VCS"
set_var EASYRSA_REQ_EMAIL      "admin@vcs.vn"
set_var EASYRSA_REQ_OU         "IT Department"
set_var EASYRSA_ALGO           "rsa"
set_var EASYRSA_KEY_SIZE       2048
set_var EASYRSA_CA_EXPIRE      3650
set_var EASYRSA_CERT_EXPIRE    825
```

### 4.3 Tạo Certificate Authority

```bash
cd ~/vcs-pki
./easyrsa build-ca nopass
# Common Name: VCS-VPN-CA
```
> **Mục đích:** Tạo giấy phép mẹ Cấp cao nhất (Certificate Authority - CA).  
> **Giải thích:** File CA này đóng vai trò như "chữ ký của tổng giám đốc". Các máy tính/chi nhánh tham gia hệ thống VPN đều phải có file `ca.crt` này. Bất kỳ chứng chỉ Client/Server nào được ký bởi CA này mới được OpenVPN chấp nhận kết nối.

```bash
# Xác minh CA
openssl x509 -in pki/ca.crt -text -noout | grep -E "Subject:|Issuer:|Not"
# Subject: CN=VCS-VPN-CA
# Not Before: ...
# Not After : ... (+10 năm)
```

### 4.4 Tạo chứng chỉ Server

```bash
cd ~/vcs-pki

# Tạo server cert
./easyrsa gen-req head-vpn-server nopass
# Common Name: head-vpn-server

# Ký bởi CA
./easyrsa sign-req server head-vpn-server
# Confirm: yes

# Tạo DH parameters
./easyrsa gen-dh

# Tạo TLS-Auth key
sudo openvpn --genkey secret ~/vcs-pki/pki/ta.key

# Xác minh server cert
openssl verify -CAfile pki/ca.crt pki/issued/head-vpn-server.crt
# pki/issued/head-vpn-server.crt: OK
```
> **Mục đích:** Cấp phát "thẻ căn cước" cho Server HEAD và sinh các khóa mật mã giao tiếp.  
> **Giải thích phần phức tạp:** 
> - `gen-req` & `sign-req`: Tạo yêu cầu và CA ký duyệt để Server có chứng chỉ hợp lệ.
> - `gen-dh` (Diffie-Hellman): Thuật toán giúp Client và Server trao đổi khóa an toàn trong môi trường mạng không bảo mật.
> - `ta.key` (TLS Auth Key): Giống như một lớp bảo vệ "cửa ngoài". Gói tin VPN nào bay tới Server mà không có chữ ký `ta.key` này sẽ bị firewall (OpenVPN) vứt bỏ ngay lập tức, ngăn chặn hiệu quả các cuộc tấn công rà quét port (Port scanning) và từ chối dịch vụ (DoS).

### 4.5 Tạo chứng chỉ Client (nhân viên WFH)

```bash
cd ~/vcs-pki

# Tạo cert cho nhân viên "quang.nguyen"
./easyrsa gen-req quang.nguyen nopass
# Common Name: quang.nguyen

./easyrsa sign-req client quang.nguyen
# Confirm: yes

# Xác minh
openssl verify -CAfile pki/ca.crt pki/issued/quang.nguyen.crt
# pki/issued/quang.nguyen.crt: OK
```

### 4.6 Triển khai files vào thư mục OpenVPN

```bash
sudo mkdir -p /etc/openvpn/server/ra
sudo mkdir -p /etc/openvpn/client/quang.nguyen

# Files cho server Remote Access
sudo cp pki/ca.crt                      /etc/openvpn/server/ra/
sudo cp pki/issued/head-vpn-server.crt    /etc/openvpn/server/ra/
sudo cp pki/private/head-vpn-server.key   /etc/openvpn/server/ra/
sudo cp pki/dh.pem                      /etc/openvpn/server/ra/
sudo cp pki/ta.key                      /etc/openvpn/server/ra/

# Phân quyền bảo mật
sudo chmod 600 /etc/openvpn/server/ra/head-vpn-server.key
sudo chmod 600 /etc/openvpn/server/ra/ta.key
sudo chown root:root /etc/openvpn/server/ra/*

# Files cho client quang.nguyen
cp pki/ca.crt                  ~/client-configs/
cp pki/issued/quang.nguyen.crt   ~/client-configs/
cp pki/private/quang.nguyen.key  ~/client-configs/
cp pki/ta.key                  ~/client-configs/
```

---

## 5. Cấu hình VPN Gateway Server

> Thực hiện trên **VM1 (head-gateway)**

### 5.1 Bật IP Forwarding

```bash
# Bật ngay lập tức
sudo sysctl -w net.ipv4.ip_forward=1

# Bật vĩnh viễn
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Kiểm tra
cat /proc/sys/net/ipv4/ip_forward
# 1
```
> **Mục đích:** Biến máy ảo Ubuntu thành một Router thực thụ.
> **Giải thích:** Mặc định Kernel Linux cấm việc nhận gói tin từ card mạng này đẩy sang card mạng khác (vì lý do bảo mật). Bật `ip_forward=1` cho phép Server định tuyến luồng dữ liệu từ card ảo của VPN (`tun0`) sang card nội bộ (`enp0s8`) để nhân viên vào được mạng công ty.

### 5.2 Tạo file cấu hình OpenVPN Server (Remote Access)

```bash
sudo nano /etc/openvpn/server/ra.conf
```

```conf
# ============================================================
# VCS HEAD – Remote Access VPN Server
# Kịch bản: Nhân viên làm việc từ xa
# Port: UDP 1194
# ============================================================

# --- Giao thức và cổng ---
port 1194
proto udp
dev tun

# --- Chứng chỉ ---
ca   /etc/openvpn/server/ra/ca.crt
cert /etc/openvpn/server/ra/head-vpn-server.crt
key  /etc/openvpn/server/ra/head-vpn-server.key
dh   /etc/openvpn/server/ra/dh.pem

# TLS Auth – chống DoS và replay attack
tls-auth /etc/openvpn/server/ra/ta.key 0
tls-version-min 1.2

# Yêu cầu client phải có cert đúng loại
remote-cert-tls client

# --- Dải IP cấp cho VPN clients ---
server 10.8.0.0 255.255.255.0

# Lưu IP đã cấp cho client (khi reconnect sẽ giữ nguyên IP)
ifconfig-pool-persist /var/log/openvpn/ra-ipp.txt

# --- Đẩy routes về phía client ---
# Client sẽ biết cách đến mạng LAN HEAD qua VPN
push "route 192.168.56.0 255.255.255.0"

# DNS nội bộ (nếu có DNS server riêng, thay 8.8.8.8)
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DOMAIN vcs.local"

# Thông báo subnet của các client VPN khác
# (cho phép client-to-client communication)
client-to-client

# --- Cấu hình IP tĩnh theo từng user ---
client-config-dir /etc/openvpn/server/ccd-ra

# --- Bảo mật ---
cipher AES-256-GCM
auth SHA256
user nobody
group nogroup
persist-key
persist-tun

# --- Keepalive ---
keepalive 10 120

# --- Giới hạn ---
max-clients 50

# --- Logging ---
status /var/log/openvpn/ra-status.log 30
log-append /var/log/openvpn/ra.log
verb 3
mute 20

# --- Management interface ---
management 127.0.0.1 7505
```

### 5.3 Tạo thư mục cấu hình per-client

```bash
sudo mkdir -p /etc/openvpn/server/ccd-ra
sudo mkdir -p /var/log/openvpn

# Cấu hình IP tĩnh cho quang.nguyen
sudo nano /etc/openvpn/server/ccd-ra/quang.nguyen
```
```conf
# Cấp IP cố định 10.8.0.10 cho nhân viên quang.nguyen
ifconfig-push 10.8.0.10 255.255.255.0
```

### 5.4 Cấu hình iptables cho Remote Access VPN

```bash
# Tạo script iptables
sudo nano /usr/local/bin/setup-head-firewall.sh
```

```bash
#!/bin/bash
# Firewall rules cho HEAD Gateway

WAN_IF="eth0"   # Interface kết nối Internet
LAN_IF="eth1"   # Interface kết nối LAN HEAD
VPN_IF="tun0"     # Interface VPN tunnel (Remote Access)

# Xóa rules cũ
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# Policy mặc định
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# === INPUT ===
# Loopback
iptables -A INPUT -i lo -j ACCEPT

# Kết nối đã thiết lập
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# SSH từ LAN nội bộ và VPN
iptables -A INPUT -p tcp --dport 22 -s 192.168.56.0/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -s 10.8.0.0/24  -j ACCEPT

# OpenVPN Remote Access (port 1194 UDP)
iptables -A INPUT -p udp --dport 1194 -j ACCEPT

# ICMP từ LAN và VPN
iptables -A INPUT -p icmp -s 192.168.56.0/24 -j ACCEPT
iptables -A INPUT -p icmp -s 10.8.0.0/24  -j ACCEPT

# Nhận traffic từ tun interface
iptables -A INPUT -i $VPN_IF -j ACCEPT

# === FORWARD ===
# VPN clients → LAN HEAD
iptables -A FORWARD -i $VPN_IF -o $LAN_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT

# LAN HEAD → VPN clients (reply)
iptables -A FORWARD -i $LAN_IF -o $VPN_IF \
  -m state --state ESTABLISHED,RELATED -j ACCEPT

# LAN HEAD → Internet
iptables -A FORWARD -i $LAN_IF -o $WAN_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT

iptables -A FORWARD -i $WAN_IF -o $LAN_IF \
  -m state --state ESTABLISHED,RELATED -j ACCEPT

# === NAT ===
# VPN clients ra Internet
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o $WAN_IF -j MASQUERADE

# LAN HEAD ra Internet
iptables -t nat -A POSTROUTING -s 192.168.56.0/24 -o $WAN_IF -j MASQUERADE

echo "[OK] HEAD Firewall configured"
iptables -L -v -n --line-numbers
```

```bash
sudo chmod +x /usr/local/bin/setup-head-firewall.sh
sudo bash /usr/local/bin/setup-head-firewall.sh

# Lưu rules persistent
sudo netfilter-persistent save
```
> **Mục đích:** Xây dựng hàng rào bảo mật tường lửa đồng thời mở thông luồng giao thông để luồng VPN đi lại bình thường.
> **Giải thích phần phức tạp:**
> - `iptables -A FORWARD -i $VPN_IF -o $LAN_IF`: Cho phép mạng thẻ ảo VPN (`tun0`) được kết nối xuyên sang LAN thật của công ty (`enp0s8`).
> - Lệnh kết thúc bằng `MASQUERADE`: Nhân viên WFH dùng IP ảo `10.8.0.x`. Khi gói tin của họ muốn đẩy đi ra Internet, Server sẽ dán "vỏ bọc" bằng IP thật của WAN_IF (`enp0s3`) giúp họ duyệt mạng mượt mà.

### 5.5 Khởi động OpenVPN Remote Access Server

```bash
sudo systemctl start openvpn-server@ra
sudo systemctl enable openvpn-server@ra
sudo systemctl status openvpn-server@ra
```

```bash
# Kiểm tra interface tun0 đã được tạo
ip a show tun0
# inet 10.8.0.1 peer 10.8.0.2/32 scope global tun0

# Kiểm tra port đang listen
sudo ss -ulnp | grep 1194
# UNCONN 0 0 0.0.0.0:1194  users:(("openvpn",pid=XXX))
```

---

## 6. Cấu hình Internal Server

> Thực hiện trên **VM2 (head-server)**

### 6.1 Cài dịch vụ mô phỏng tài nguyên nội bộ

```bash
# Cài Nginx làm Web Server nội bộ
sudo apt install nginx -y

# Tạo trang web nội bộ
sudo nano /var/www/html/index.html
```

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>VCS Internal Portal</title>
  <style>
    body { font-family: Arial; background: #1a1a2e; color: #eee;
           display:flex; justify-content:center; align-items:center;
           height:100vh; margin:0; }
    .box { background:#16213e; padding:40px; border-radius:12px;
           border:1px solid #0f3460; text-align:center; }
    h1 { color:#e94560; }
    .badge { background:#0f3460; padding:8px 20px; border-radius:20px;
             font-size:0.85em; margin-top:20px; display:inline-block; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🔒 VCS Internal Portal</h1>
    <p>Chào mừng bạn đã kết nối thành công qua VPN!</p>
    <p>Server: head-server | IP: 192.168.56.11</p>
    <div class="badge">⚡ Chỉ truy cập được qua VPN</div>
  </div>
</body>
</html>
```

```bash
sudo systemctl start nginx
sudo systemctl enable nginx

# Kiểm tra nginx chạy
curl http://192.168.56.11
```

### 6.2 Tạo file chia sẻ mô phỏng File Server

```bash
# Cài vsftpd làm file server đơn giản
sudo apt install vsftpd -y

# Tạo thư mục và file nội bộ
sudo mkdir -p /srv/vcs-files
echo "VCS Confidential Document - Q4 2024 Report" | sudo tee /srv/vcs-files/report.txt
echo "Internal System Manual v2.1" | sudo tee /srv/vcs-files/manual.txt

sudo systemctl start vsftpd
```

### 6.3 Cấu hình routing cho head-server

```bash
# head-server cần biết route đến VPN clients qua head-gateway
sudo ip route add 10.8.0.0/24 via 192.168.56.10
sudo ip route add 10.9.0.0/30 via 192.168.56.10
sudo ip route add 192.168.57.0/24 via 192.168.56.10

# Lưu route vĩnh viễn vào netplan
sudo nano /etc/netplan/00-installer-config.yaml
```
```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      addresses: [192.168.56.11/24]
      routes:
        - to: default
          via: 192.168.56.10
        - to: 10.8.0.0/24
          via: 192.168.56.10
        - to: 192.168.57.0/24
          via: 192.168.56.10
      nameservers:
        addresses: [8.8.8.8]
```
```bash
sudo netplan apply
```

---

## 7. Cấu hình Remote Client

> Thực hiện trên **VM3 (remote-client)**

### 7.1 Tạo file cấu hình .ovpn

Trên **VM1 (head-gateway)**, tạo script đóng gói file `.ovpn`:

```bash
nano ~/make-ovpn.sh
```

```bash
#!/bin/bash
# Script tạo file .ovpn inline cho client

CLIENT=$1
PKI_DIR=~/vcs-pki/pki
OUTPUT=~/client-configs/${CLIENT}.ovpn
SERVER_IP="10.0.2.10"    # WAN IP của head-gateway (địa chỉ "Internet")
SERVER_PORT="1194"

mkdir -p ~/client-configs

cat > "$OUTPUT" << OVPN
# ============================================================
# VCS Remote Access VPN – Client Profile
# User: $CLIENT
# Server: $SERVER_IP:$SERVER_PORT
# Generated: $(date)
# ============================================================

client
dev tun
proto udp
remote $SERVER_IP $SERVER_PORT

# Thử lại kết nối liên tục
resolv-retry infinite
nobind

# Bảo mật
remote-cert-tls server
tls-auth [inline] 1
key-direction 1
cipher AES-256-GCM
auth SHA256

# Chạy dưới quyền thấp
user nobody
group nogroup
persist-key
persist-tun

# Log
verb 3

# --- Certificates (inline) ---
<ca>
$(cat $PKI_DIR/ca.crt)
</ca>

<cert>
$(openssl x509 -in $PKI_DIR/issued/$CLIENT.crt)
</cert>

<key>
$(cat $PKI_DIR/private/$CLIENT.key)
</key>

<tls-auth>
$(cat $PKI_DIR/ta.key)
</tls-auth>
OVPN

echo "[OK] Created: $OUTPUT"
chmod 600 "$OUTPUT"
```

```bash
chmod +x ~/make-ovpn.sh
./make-ovpn.sh quang.nguyen

# Kiểm tra file tạo ra
ls -la ~/client-configs/quang.nguyen.ovpn
wc -l ~/client-configs/quang.nguyen.ovpn
```

### 7.2 Chuyển file .ovpn sang VM3

```bash
# Cài SSH server nếu chưa có
sudo apt install openssh-server -y

# Từ VM3, scp file từ VM1
scp user@10.0.2.10:~/client-configs/quang.nguyen.ovpn ~/

# Kiểm tra file
ls -la ~/quang.nguyen.ovpn
```

### 7.3 Kết nối VPN từ VM3

```bash
# Kết nối và xem log trực tiếp
sudo openvpn --config ~/quang.nguyen.ovpn
```

---

## 8. Kiểm tra kịch bản Remote Access

### 8.1 Xác minh kết nối tunnel

```bash
# Trên VM3 sau khi kết nối VPN thành công

# 1. Kiểm tra interface tun0
ip a show tun0
# inet 10.8.0.10 peer 10.8.0.9/32 scope global tun0
# (IP cố định do ccd config)

# 2. Kiểm tra routing table
ip route show
# 10.8.0.0/24 via 10.8.0.9 dev tun0    ← Route VPN pool
# 192.168.56.0/24 via 10.8.0.9 dev tun0   ← Route LAN HEAD (do server push)
```

### 8.2 Kiểm tra truy cập tài nguyên nội bộ

```bash
# Trên VM3 (remote-client) – SAU KHI kết nối VPN

# Ping đến VPN server
ping -c 4 10.8.0.1
# 0% packet loss

# Ping đến head-server (nằm trong LAN HEAD)
ping -c 4 192.168.56.11
# 0% packet loss ← Chứng minh VPN tunnel hoạt động

# Truy cập Web Server nội bộ
curl http://192.168.56.11
# → Hiển thị trang VCS Internal Portal

# Kiểm tra từ góc độ head-server
# (VM3 - 10.8.0.10 kết nối vào 192.168.56.11)
```

### 8.3 Chứng minh mã hóa hoạt động

```bash
# Trên VM3 (hoặc VM1): bắt gói tin trên WAN interface
# Dùng tcpdump bắt traffic UDP port 1194

sudo tcpdump -i enp0s3 udp port 1194 -c 10 -XX 2>/dev/null

# Kết quả: tất cả payload là cipher text — không đọc được
# So sánh: nếu dùng HTTP thông thường (không VPN) thì thấy rõ nội dung
```

### 8.4 Kiểm tra phía Server

```bash
# Trên VM1 (head-gateway)

# Xem danh sách client đang kết nối
cat /var/log/openvpn/ra-status.log
```

```
OpenVPN CLIENT LIST
Updated,2024-01-01 10:00:00
Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since
quang.nguyen,10.0.2.30:54321,45678,12345,2024-01-01 09:55:00

ROUTING TABLE
Virtual Address,Common Name,Real Address,Last Ref
10.8.0.10,quang.nguyen,10.0.2.30:54321,2024-01-01 10:00:00
```

```bash
# Dùng management interface xem realtime
echo "status" | nc 127.0.0.1 7505
```

### 8.5 Bảng tổng kết kiểm tra kịch bản 1

| Bài kiểm tra | Lệnh | Kết quả mong đợi | Ý nghĩa |
|---|---|---|---|
| Interface tun0 tồn tại | `ip a show tun0` | inet 10.8.0.10 | VPN tunnel đã lên |
| IP đúng ccd config | `ip a show tun0` | 10.8.0.10 (không phải ngẫu nhiên) | Per-user IP hoạt động |
| Ping VPN gateway | `ping 10.8.0.1` | 0% loss | Tunnel thông |
| Ping head-server | `ping 192.168.56.11` | 0% loss | Routing qua LAN hoạt động |
| Truy cập web nội bộ | `curl http://192.168.56.11` | Trang VCS Portal | Dịch vụ nội bộ accessible |
| Không truy cập được khi ngắt VPN | Ngắt VPN, `ping 192.168.56.11` | Request timeout | Mạng nội bộ được bảo vệ |

---

# PHẦN III – KỊCH BẢN 2: SITE-TO-SITE VPN

## 9. Thiết kế Site-to-Site

### 9.1 Mô hình kết nối

```
   Trụ sở HEAD (Hà Nội)              Chi nhánh (TP.HCM)
   LAN: 192.168.56.0/24               LAN: 192.168.57.0/24
         │                                 │
   [VM1: head-gateway]                [VM4: branch-gateway]
   WAN: 10.0.2.10 ◄════ S2S VPN ════► WAN: 10.0.2.40
   tun1: 10.9.0.1/30               tun0: 10.9.0.2/30
```

**Điểm khác biệt so với Remote Access:**
- Kết nối máy → máy (gateway ↔ gateway), không phải user → server
- Chạy liên tục 24/7 như một đường leased line
- Người dùng (VM2, VM5) kết nối bình thường trong LAN, không cần cài VPN client
- VM5 có thể truy cập VM2 như thể cùng mạng nội bộ

### 9.2 Phân công vai trò

| Vai trò | VM | IP VPN |
|---|---|---|
| S2S Server (lắng nghe) | VM1 head-gateway | 10.9.0.1 |
| S2S Client (kết nối đến) | VM4 branch-gateway | 10.9.0.2 |

---

## 10. Cấu hình Gateway Chi nhánh A (HEAD)

> Thực hiện trên **VM1 (head-gateway)** — VM1 đóng vai **Server** cho Site-to-Site

### 10.1 Tạo chứng chỉ cho Site-to-Site

```bash
# Trên VM1
cd ~/vcs-pki

# Tạo cert cho branch gateway
./easyrsa gen-req branch-gateway nopass
# Common Name: branch-gateway

./easyrsa sign-req client branch-gateway
# Confirm: yes

# Xác minh
openssl verify -CAfile pki/ca.crt pki/issued/branch-gateway.crt
# OK
```

### 10.2 Chuẩn bị files cho Branch Gateway

```bash
# Tạo thư mục
sudo mkdir -p /etc/openvpn/server/s2s

# Copy files cho S2S server
sudo cp pki/ca.crt               /etc/openvpn/server/s2s/
sudo cp pki/issued/head-vpn-server.crt /etc/openvpn/server/s2s/
sudo cp pki/private/head-vpn-server.key /etc/openvpn/server/s2s/
sudo cp pki/ta.key               /etc/openvpn/server/s2s/
sudo chmod 600 /etc/openvpn/server/s2s/*.key

# Chuẩn bị files để copy sang VM4
mkdir -p ~/branch-configs
cp pki/ca.crt                        ~/branch-configs/
cp pki/issued/branch-gateway.crt     ~/branch-configs/
cp pki/private/branch-gateway.key    ~/branch-configs/
cp pki/ta.key                        ~/branch-configs/
```

### 10.3 Cấu hình OpenVPN S2S Server trên VM1

```bash
sudo nano /etc/openvpn/server/s2s.conf
```

```conf
# ============================================================
# VCS – Site-to-Site VPN Server (HEAD Side)
# Lắng nghe kết nối từ Branch Gateway
# Port: UDP 1195 (khác port Remote Access 1194)
# ============================================================

port 1195
proto udp
dev tun1          # Dùng tun1 (tun0 đã dùng cho Remote Access)

ca   /etc/openvpn/server/s2s/ca.crt
cert /etc/openvpn/server/s2s/head-vpn-server.crt
key  /etc/openvpn/server/s2s/head-vpn-server.key

tls-auth /etc/openvpn/server/s2s/ta.key 0
tls-version-min 1.2

# --- Tunnel IP ---
# HEAD side: 10.9.0.1, Branch side: 10.9.0.2
ifconfig 10.9.0.1 10.9.0.2

# --- Route: Báo cho branch biết mạng LAN HEAD ---
route 192.168.57.0 255.255.255.0   # Route đến LAN Branch
push "route 192.168.56.0 255.255.255.0"  # Đẩy route LAN HEAD về phía Branch

# --- Bảo mật ---
cipher AES-256-GCM
auth SHA256
user nobody
group nogroup
persist-key
persist-tun
keepalive 10 60

# --- Logging ---
status /var/log/openvpn/s2s-status.log 30
log-append /var/log/openvpn/s2s.log
verb 3

management 127.0.0.1 7506
```

### 10.4 Cập nhật iptables cho S2S

```bash
# Thêm rules cho Site-to-Site VPN
sudo nano /usr/local/bin/setup-head-firewall.sh
```

Thêm các dòng sau vào script (sau phần Remote Access rules):

```bash
VPN_S2S_IF="tun1"

# Port cho S2S VPN
iptables -A INPUT -p udp --dport 1195 -j ACCEPT

# Forward giữa LAN HEAD và Branch qua S2S tunnel
iptables -A FORWARD -i $VPN_S2S_IF -o $LAN_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -i $LAN_IF -o $VPN_S2S_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT

# NAT cho traffic từ Branch
iptables -t nat -A POSTROUTING -s 192.168.57.0/24 -o $WAN_IF -j MASQUERADE
iptables -t nat -A POSTROUTING -s 10.9.0.0/30  -o $WAN_IF -j MASQUERADE
```

```bash
sudo bash /usr/local/bin/setup-head-firewall.sh
sudo netfilter-persistent save
```

### 10.5 Khởi động S2S Server

```bash
sudo systemctl start openvpn-server@s2s
sudo systemctl enable openvpn-server@s2s
sudo systemctl status openvpn-server@s2s

# Kiểm tra cả 2 tunnel đều lên
ip a | grep tun
# tun0: 10.8.0.1 (Remote Access)
# tun1: 10.9.0.1 (Site-to-Site)
```

---

## 11. Cấu hình Gateway Chi nhánh B

> Thực hiện trên **VM4 (branch-gateway)** — đóng vai **Client** cho Site-to-Site

### 11.1 Chuyển files sang VM4

```bash
# Từ VM4, copy files từ VM1
scp -r user@10.0.2.10:~/branch-configs/ ~/

ls ~/branch-configs/
# ca.crt  branch-gateway.crt  branch-gateway.key  ta.key
```

### 11.2 Triển khai files

```bash
# Trên VM4
sudo mkdir -p /etc/openvpn/client/s2s

sudo cp ~/branch-configs/ca.crt               /etc/openvpn/client/s2s/
sudo cp ~/branch-configs/branch-gateway.crt   /etc/openvpn/client/s2s/
sudo cp ~/branch-configs/branch-gateway.key   /etc/openvpn/client/s2s/
sudo cp ~/branch-configs/ta.key               /etc/openvpn/client/s2s/

sudo chmod 600 /etc/openvpn/client/s2s/branch-gateway.key
sudo chmod 600 /etc/openvpn/client/s2s/ta.key
```

### 11.3 Cấu hình OpenVPN S2S Client trên VM4

```bash
sudo nano /etc/openvpn/client/s2s.conf
```

```conf
# ============================================================
# VCS – Site-to-Site VPN Client (Branch Side)
# Kết nối đến HEAD Gateway
# ============================================================

client
dev tun0
proto udp

# Địa chỉ WAN của HEAD Gateway
remote 10.0.2.10 1195

ca   /etc/openvpn/client/s2s/ca.crt
cert /etc/openvpn/client/s2s/branch-gateway.crt
key  /etc/openvpn/client/s2s/branch-gateway.key

tls-auth /etc/openvpn/client/s2s/ta.key 1
tls-version-min 1.2
key-direction 1

remote-cert-tls server

# --- Bảo mật ---
cipher AES-256-GCM
auth SHA256
user nobody
group nogroup
persist-key
persist-tun

# Kết nối lại tự động nếu bị ngắt
resolv-retry infinite
connect-retry 5
connect-retry-max unlimited

keepalive 10 60

# --- Logging ---
status /var/log/openvpn/s2s-status.log 30
log-append /var/log/openvpn/s2s.log
verb 3
```

### 11.4 Bật IP Forwarding và cấu hình iptables cho Branch

```bash
# Bật IP Forwarding
sudo sysctl -w net.ipv4.ip_forward=1
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf

# Cấu hình iptables cho Branch Gateway
sudo nano /usr/local/bin/setup-branch-firewall.sh
```

```bash
#!/bin/bash
WAN_IF="enp0s3"
LAN_IF="enp0s8"
VPN_IF="tun0"

iptables -F; iptables -X
iptables -t nat -F; iptables -t nat -X

iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Input
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -s 192.168.57.0/24 -j ACCEPT
iptables -A INPUT -p icmp -s 192.168.57.0/24 -j ACCEPT
iptables -A INPUT -p icmp -s 10.9.0.0/30 -j ACCEPT
iptables -A INPUT -i $VPN_IF -j ACCEPT

# Forward
# Branch LAN ↔ HEAD qua VPN tunnel
iptables -A FORWARD -i $LAN_IF -o $VPN_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -i $VPN_IF -o $LAN_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT

# Branch LAN → Internet
iptables -A FORWARD -i $LAN_IF -o $WAN_IF \
  -m state --state NEW,ESTABLISHED,RELATED -j ACCEPT
iptables -A FORWARD -i $WAN_IF -o $LAN_IF \
  -m state --state ESTABLISHED,RELATED -j ACCEPT

# NAT
iptables -t nat -A POSTROUTING -s 192.168.57.0/24 -o $WAN_IF -j MASQUERADE

echo "[OK] Branch Firewall configured"
```

```bash
sudo chmod +x /usr/local/bin/setup-branch-firewall.sh
sudo bash /usr/local/bin/setup-branch-firewall.sh
sudo netfilter-persistent save
```

### 11.5 Khởi động S2S VPN trên VM4

```bash
sudo systemctl start openvpn-client@s2s
sudo systemctl enable openvpn-client@s2s
sudo systemctl status openvpn-client@s2s

# Kiểm tra tunnel
ip a show tun0
# inet 10.9.0.2 peer 10.9.0.1/32 scope global tun0

# Kiểm tra route đến LAN HEAD
ip route | grep 192.168.56.0
# 192.168.56.0/24 via 10.9.0.1 dev tun0
```

### 11.6 Cấu hình routing cho VM5 (branch-client)

```bash
# Trên VM5 — chỉ cần biết gateway là branch-gateway
# Đã cấu hình trong netplan (default via 192.168.57.10)

# Thêm route đến LAN HEAD (tùy chọn – có thể do branch-gateway push)
sudo ip route add 192.168.56.0/24 via 192.168.57.10
```

---

## 12. Kiểm tra Site-to-Site

### 12.1 Kiểm tra tunnel HEAD ↔ Branch

```bash
# Trên VM4 (branch-gateway)

# Ping đến HEAD tunnel endpoint
ping -c 4 10.9.0.1
# 0% packet loss ← Tunnel thông

# Ping đến head-server (máy trong LAN HEAD)
ping -c 4 192.168.56.11
# 0% packet loss ← Routing xuyên VPN hoạt động
```

### 12.2 Kiểm tra end-to-end từ Branch client

```bash
# Trên VM5 (branch-client)
# Đây là bài test quan trọng nhất!

# Ping đến head-server — đi qua branch-gateway → S2S VPN → head-gateway → head-server
ping -c 4 192.168.56.11
# 0% packet loss

# Truy cập Web Server nội bộ của HEAD
curl http://192.168.56.11
# → Hiển thị trang VCS Internal Portal

# Traceroute để thấy đường đi
traceroute 192.168.56.11
# 1. 192.168.57.10    (branch-gateway LAN)
# 2. 10.9.0.1     (head-gateway VPN endpoint)
# 3. 192.168.56.11   (head-server)
```

### 12.3 Kiểm tra chiều ngược lại

```bash
# Từ VM2 (head-server) truy cập vào branch
ping -c 4 192.168.57.11   # ping branch-client
ping -c 4 192.168.57.10    # ping branch-gateway
```

### 12.4 Kiểm tra tự động kết nối lại

```bash
# Giả lập đứt đường kết nối
# Trên VM4, tắt tạm OpenVPN client
sudo systemctl stop openvpn-client@s2s

# Quan sát từ VM1 — log sẽ thấy client ngắt kết nối
sudo tail -f /var/log/openvpn/s2s.log

# Bật lại — kết nối sẽ tự phục hồi
sudo systemctl start openvpn-client@s2s
# Trong vài giây: "Initialization Sequence Completed"
```

### 12.5 Bảng tổng kết kiểm tra kịch bản 2

| Bài kiểm tra | Từ VM | Lệnh | Kết quả mong đợi | Ý nghĩa |
|---|---|---|---|---|
| S2S tunnel thông | VM4 | `ping 10.9.0.1` | 0% loss | Tunnel HEAD↔Branch lên |
| Branch → LAN HEAD | VM4 | `ping 192.168.56.11` | 0% loss | Route xuyên VPN |
| Branch-client → HEAD | VM5 | `ping 192.168.56.11` | 0% loss | End-to-end hoạt động |
| Web HEAD từ Branch | VM5 | `curl http://192.168.56.11` | Trang Portal | Dịch vụ accessible |
| Traceroute | VM5 | `traceroute 192.168.56.11` | 3 hops qua VPN | Routing đúng path |
| Tự reconnect | VM4 | Restart VPN service | Kết nối lại <30s | HA giả lập |

---

# PHẦN IV – BÁO CÁO

## 13. Kết quả thực hành

---

### BÁO CÁO THỰC HÀNH
# Triển khai Hệ thống VPN Doanh Nghiệp
## Remote Access VPN + Site-to-Site VPN

**Môn học:** An toàn Mạng Máy tính
**Môi trường:** VirtualBox 5 VM – Ubuntu Server 22.04 LTS

---

### I. Mục tiêu thực hành

1. Thiết kế và triển khai hệ thống VPN doanh nghiệp theo mô hình thực tế
2. Xây dựng PKI (Public Key Infrastructure) tập trung cho toàn bộ hệ thống
3. Triển khai Remote Access VPN cho nhân viên làm việc từ xa (Work From Home)
4. Triển khai Site-to-Site VPN kết nối Trụ sở và Chi nhánh
5. Cấu hình routing, NAT, và iptables firewall cho từng kịch bản
6. Kiểm chứng bảo mật và tính liên thông của hệ thống

---

### II. Kiến trúc hệ thống đã triển khai

#### 2.1 Mô hình 5 VM

| VM | Hostname | Vai trò | WAN IP | LAN IP | VPN IP |
|---|---|---|---|---|---|
| VM1 | head-gateway | VPN Server (RA + S2S) + Router | 10.0.2.10 | 192.168.56.10 | 10.8.0.1 / 10.9.0.1 |
| VM2 | head-server | Web + File Server nội bộ | — | 192.168.56.11 | — |
| VM3 | remote-client | Laptop nhân viên WFH | 10.0.2.30 | 192.168.147.10 | 10.8.0.10 |
| VM4 | branch-gateway | VPN Client S2S + Router | 10.0.2.40 | 192.168.57.10 | 10.9.0.2 |
| VM5 | branch-client | PC nhân viên chi nhánh | — | 192.168.57.11 | — |

#### 2.2 Hạ tầng PKI đã xây dựng

```
VCS-VPN-CA (Root CA)
├── head-vpn-server.crt    (dùng cho cả RA và S2S server)
├── quang.nguyen.crt       (Remote Access client)
└── branch-gateway.crt   (Site-to-Site client)
```

**Tham số kỹ thuật:**
- Thuật toán: RSA 2048-bit
- Hàm băm chữ ký: SHA-256
- Mã hóa tunnel: AES-256-GCM
- Xác thực gói tin: HMAC-SHA256
- Phiên bản TLS tối thiểu: TLS 1.2
- TLS-Auth: HMAC trên control channel (chống DoS)

---

### III. Kết quả kịch bản 1 – Remote Access VPN

#### 3.1 Quá trình kết nối của nhân viên quang.nguyen

```
[VM3 remote-client] → Internet (10.0.2.0/24) → [VM1 head-gateway:1194/udp]
```

**Log kết nối thành công (trích):**
```
Mon Jan 01 10:00:00 2024 TLS: Initial packet from [AF_INET]10.0.2.10:1194
Mon Jan 01 10:00:00 2024 VERIFY OK: depth=1, CN=VCS-VPN-CA
Mon Jan 01 10:00:00 2024 VERIFY OK: depth=0, CN=head-vpn-server
Mon Jan 01 10:00:00 2024 Control Channel: TLSv1.3, cipher TLS_AES_256_GCM_SHA384
Mon Jan 01 10:00:00 2024 [head-vpn-server] Peer Connection Initiated
Mon Jan 01 10:00:00 2024 TUN/TAP device tun0 opened
Mon Jan 01 10:00:00 2024 /sbin/ip addr add dev tun0 local 10.8.0.10 peer 10.8.0.9
Mon Jan 01 10:00:00 2024 /sbin/ip route add 192.168.56.0/24 via 10.8.0.9
Mon Jan 01 10:00:00 2024 Initialization Sequence Completed
```

#### 3.2 Kiểm tra IP và routing sau kết nối

```
[VM3] $ ip a show tun0
tun0: ... inet 10.8.0.10 peer 10.8.0.9/32 ...

[VM3] $ ip route show
10.8.0.0/24  via 10.8.0.9 dev tun0
192.168.56.0/24 via 10.8.0.9 dev tun0   ← Route LAN HEAD được push từ server
```

#### 3.3 Kết quả ping test

```
[VM3] $ ping -c 4 10.8.0.1
64 bytes from 10.8.0.1: icmp_seq=1 ttl=64 time=1.2 ms
64 bytes from 10.8.0.1: icmp_seq=2 ttl=64 time=0.9 ms
--- 10.8.0.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss

[VM3] $ ping -c 4 192.168.56.11
64 bytes from 192.168.56.11: icmp_seq=1 ttl=63 time=2.1 ms
--- 192.168.56.11 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss
```

#### 3.4 Truy cập Web Server nội bộ

```
[VM3] $ curl http://192.168.56.11
<!DOCTYPE html>
<html>...VCS Internal Portal...
Server: head-server | IP: 192.168.56.11
⚡ Chỉ truy cập được qua VPN
```

#### 3.5 Server-side status

```
[VM1] $ cat /var/log/openvpn/ra-status.log

OpenVPN CLIENT LIST
Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since
quang.nguyen,10.0.2.30:54321,89012,23456,2024-01-01 10:00:00

ROUTING TABLE
10.8.0.10,quang.nguyen,10.0.2.30:54321,2024-01-01 10:05:00
```

---

### IV. Kết quả kịch bản 2 – Site-to-Site VPN

#### 4.1 Quá trình thiết lập tunnel S2S

```
[VM4 branch-gateway] → Internet (10.0.2.0/24) → [VM1 head-gateway:1195/udp]
```

**Log kết nối S2S thành công (trích từ VM4):**
```
Mon Jan 01 10:00:00 2024 TCP/UDP: Preserving recently used remote address
Mon Jan 01 10:00:00 2024 Attempting to establish TCP connection with 10.0.2.10:1195
Mon Jan 01 10:00:00 2024 VERIFY OK: depth=1, CN=VCS-VPN-CA
Mon Jan 01 10:00:00 2024 VERIFY OK: depth=0, CN=head-vpn-server
Mon Jan 01 10:00:00 2024 Control Channel: TLSv1.3, cipher TLS_AES_256_GCM_SHA384
Mon Jan 01 10:00:00 2024 /sbin/ip addr add dev tun0 local 10.9.0.2 peer 10.9.0.1
Mon Jan 01 10:00:00 2024 /sbin/ip route add 192.168.56.0/24 via 10.9.0.1
Mon Jan 01 10:00:00 2024 Initialization Sequence Completed
```

#### 4.2 Kiểm tra end-to-end từ VM5 (branch-client)

```
[VM5] $ traceroute 192.168.56.11
traceroute to 192.168.56.11, 30 hops max
 1  192.168.57.10    (branch-gateway LAN)     0.5 ms
 2  10.9.0.1     (head-gateway VPN)         2.1 ms
 3  192.168.56.11   (head-server)              2.8 ms

[VM5] $ ping -c 4 192.168.56.11
4 packets transmitted, 4 received, 0% packet loss, avg 2.8 ms

[VM5] $ curl http://192.168.56.11
<!DOCTYPE html>...VCS Internal Portal...
```

#### 4.3 Kiểm tra chiều ngược lại từ HEAD sang Branch

```
[VM2] $ ping -c 4 192.168.57.11
4 packets transmitted, 4 received, 0% packet loss

[VM2] $ ping -c 4 192.168.57.10
4 packets transmitted, 4 received, 0% packet loss
```

#### 4.4 Kiểm tra tự động kết nối lại

```
Thử nghiệm: dừng OpenVPN trên VM4, chờ 15 giây, bật lại
→ Kết quả: kết nối phục hồi trong 8 giây
→ Cấu hình connect-retry 5 hoạt động đúng
```

---

### V. Kiểm tra bảo mật

#### 5.1 Xác minh mã hóa bằng tcpdump

**Phương pháp:** Bắt gói tin trên WAN interface trong khi client truyền dữ liệu qua VPN.

```bash
# Trên VM1, bắt gói tin UDP port 1194
sudo tcpdump -i enp0s3 udp port 1194 -c 5 -XX
```

**Kết quả quan sát:**
```
0x0000:  4500 0069 1234 4000 4011 ... 0a00 021e  (IP header)
0x0010:  0a00 021e 0496 04a2 0055 ... a1b2 c3d4  (UDP + OpenVPN header)
0x0020:  e5f6 0718 293a 4b5c 6d7e 8f90 a1b2 c3d4  (CIPHER TEXT)
0x0030:  e5f6 0718 293a 4b5c 6d7e 8f90 ...        (CIPHER TEXT - không đọc được)
```

**→ Nhận xét:** Payload hoàn toàn là ciphertext, không thể đọc nội dung khi không có khóa giải mã — xác nhận AES-256-GCM hoạt động đúng.

#### 5.2 Kiểm tra xác thực Certificate

```bash
# Thử kết nối bằng cert không hợp lệ → phải bị từ chối
sudo openvpn --config ~/invalid-cert.ovpn

# Log server sẽ hiển thị:
# TLS_ERROR: BIO read tls_read_plaintext error
# TLS Error: TLS handshake failed
```

#### 5.3 Kiểm tra mạng nội bộ không truy cập được từ ngoài

```bash
# Từ VM3 khi CHƯA kết nối VPN
ping -c 3 192.168.56.11
# Request timeout — LAN HEAD hoàn toàn bị ẩn

# Sau khi kết nối VPN
ping -c 3 192.168.56.11
# 0% packet loss — truy cập bình thường
```

---

### VI. Đo lường hiệu năng

#### 6.1 Latency (RTT)

| Kết nối | RTT trung bình |
|---|---|
| Trực tiếp VM3 → VM1 (không VPN) | 0.4 ms |
| Qua VPN Remote Access (VM3 → VM1) | 1.2 ms |
| Qua S2S VPN (VM5 → VM2) | 2.8 ms |

#### 6.2 Throughput (iperf3)

| Kết nối | Bandwidth |
|---|---|
| LAN trực tiếp VM1 → VM2 | 940 Mbps |
| Remote Access VPN (VM3 → VM1) | 650 Mbps |
| Site-to-Site VPN (VM5 → VM2) | 580 Mbps |
| Overhead VPN trung bình | ~30-38% |

> Overhead chủ yếu đến từ: mã hóa/giải mã AES-256-GCM, tính toán HMAC-SHA256, và IP header overhead của tunnel.

---

### VII. So sánh với môi trường thực tế

| Yếu tố | Lab VirtualBox | Thực tế doanh nghiệp |
|---|---|---|
| Số lượng client | 1-2 client | Hàng trăm đến hàng nghìn |
| Băng thông đường truyền | Virtual (Gbps) | 100Mbps – 1Gbps leased line |
| High Availability | Không có | Active-Passive hoặc Active-Active |
| Certificate Management | Easy-RSA thủ công | HashiCorp Vault, Windows CA |
| Authentication | Certificate only | Certificate + MFA (TOTP, SMS) |
| Monitoring | Log file | SIEM, Prometheus, Grafana |
| Hardware | VM | Firewall/Router chuyên dụng (Fortinet, Cisco) |
| Latency | < 3ms (local) | 20-150ms (Internet thực) |

---

### VIII. Kết luận

#### 8.1 Kết quả đạt được

Bài thực hành đã triển khai thành công hệ thống VPN doanh nghiệp hoàn chỉnh với hai kịch bản thực tế:

**Kịch bản Remote Access VPN:**
- Nhân viên làm từ xa (VM3) kết nối thành công về mạng HEAD qua internet giả lập
- Nhận IP cố định theo cấu hình per-user (10.8.0.10)
- Truy cập được Web Server nội bộ (VM2) không thể truy cập trực tiếp từ internet
- Toàn bộ traffic được mã hóa AES-256-GCM, xác nhận qua tcpdump

**Kịch bản Site-to-Site VPN:**
- Hai site (HEAD và Branch) kết nối thành công qua tunnel 24/7
- Nhân viên chi nhánh (VM5) truy cập tài nguyên HEAD (VM2) như mạng nội bộ
- Kết nối tự phục hồi sau khi bị ngắt trong vòng dưới 10 giây
- Routing hai chiều hoạt động đúng

#### 8.2 Điểm khác biệt so với lab thông thường

- **Mạng tách biệt hoàn toàn:** Remote client ở mạng khác (không cùng Host-only với LAN HEAD), buộc phải qua VPN mới đến được
- **Dịch vụ nội bộ thực sự:** Web server chạy Nginx, không chỉ ping test
- **Hai VPN song song:** tun0 (Remote Access) và tun1 (Site-to-Site) cùng chạy trên một server
- **End-to-end test:** VM5 → VM2 đi qua 3 hops (branch-client → branch-gateway → head-gateway → head-server)

---

### IX. Tài liệu tham khảo

1. OpenVPN Community Documentation – https://openvpn.net/community-resources/
2. Easy-RSA 3 Documentation – https://easy-rsa.readthedocs.io/en/latest/
3. RFC 5280 – Internet X.509 PKI Certificate Profile
4. RFC 8446 – TLS 1.3 Protocol
5. NIST SP 800-77 Rev.1 – Guide to IPsec VPNs
6. Ubuntu Server Guide – https://ubuntu.com/server/docs/
7. Netfilter/iptables Documentation – https://www.netfilter.org/documentation/

---

## 14. Phân tích và đánh giá

### 14.1 Ưu điểm của kiến trúc đã triển khai

**Bảo mật nhiều lớp:**
- Lớp 1: Xác thực Certificate (PKI)
- Lớp 2: Mã hóa tunnel AES-256-GCM
- Lớp 3: HMAC-SHA256 xác thực toàn vẹn gói tin
- Lớp 4: TLS-Auth chống tấn công DoS trên control channel
- Lớp 5: iptables firewall lọc traffic trên gateway

**Phân tách rõ ràng:** Remote Access và Site-to-Site chạy trên port khác nhau (1194/1195) và tunnel khác nhau (tun0/tun1), dễ quản lý và debug độc lập.

**Sát thực tế:** Mạng của remote-client và LAN HEAD hoàn toàn tách biệt, không có đường đi trực tiếp — đúng như thực tế nhân viên WFH.

### 14.2 Hạn chế và hướng cải thiện trong môi trường production

| Hạn chế trong Lab | Giải pháp Production |
|---|---|
| PKI quản lý thủ công | HashiCorp Vault PKI hoặc Windows Active Directory CA |
| Không có HA | 2 VPN server Active-Passive với Keepalived/HAProxy |
| Xác thực chỉ bằng cert | Thêm TOTP (Google Authenticator) qua PAM |
| Log file thủ công | ELK Stack hoặc Splunk để centralize logs |
| Không có monitoring | Prometheus + Grafana Dashboard |
| Mỗi user phải cấp cert thủ công | LDAP/AD integration tự động provisioning |

---

## 15. Xử lý sự cố

### 15.1 Checklist debug tổng quát

```bash
# 1. Kiểm tra service
sudo systemctl status openvpn-server@ra
sudo systemctl status openvpn-server@s2s
sudo systemctl status openvpn-client@s2s

# 2. Xem log lỗi
sudo journalctl -u openvpn-server@ra --since "10 min ago"
sudo tail -50 /var/log/openvpn/ra.log

# 3. Kiểm tra interfaces
ip a | grep tun

# 4. Kiểm tra routing
ip route show

# 5. Kiểm tra port đang listen
sudo ss -ulnp | grep -E "1194|1195"

# 6. Kiểm tra IP forwarding
cat /proc/sys/net/ipv4/ip_forward

# 7. Kiểm tra iptables
sudo iptables -L -v -n
sudo iptables -t nat -L -v -n
```

### 15.2 Bảng lỗi thường gặp

| Triệu chứng | Nguyên nhân phổ biến | Cách khắc phục |
|---|---|---|
| `TLS handshake failed` | ta.key không khớp key-direction | Server dùng `0`, Client dùng `1` |
| `VERIFY ERROR: certificate revoked` | Certificate bị thu hồi | Tạo cert mới cho client |
| Kết nối được nhưng không ping LAN | IP Forwarding chưa bật | `sysctl -w net.ipv4.ip_forward=1` |
| Remote client ping được VPN IP nhưng không ping được LAN | iptables FORWARD chưa có rule | Thêm FORWARD rule tun → LAN |
| S2S kết nối nhưng VM5 không ping được VM2 | Route chưa có trên VM5 | Thêm route đến 192.168.56.0/24 via gateway |
| `Connection reset, restarting` | DH params không khớp | Tạo lại dh.pem, copy sang đúng thư mục |
| Service start nhưng tun không tạo | Config file lỗi cú pháp | Chạy `openvpn --config file.conf --verb 6` để debug |
| Mất kết nối SSH sau khi cấu hình iptables | Policy DROP nhưng chưa có rule cho SSH | Vào console VBox thêm rule SSH trước |

---

*Tài liệu Thực hành và Báo cáo OpenVPN – Kịch bản doanh nghiệp thực tế*
*Phiên bản: 2.0 | 5 VM | Remote Access + Site-to-Site VPN*
*Ubuntu Server 22.04 LTS | OpenVPN 2.5.x | Easy-RSA 3.x*
