# Hướng Dẫn Thực Hành OpenVPN Từ Cơ Bản Đến Nâng Cao
## Môi trường: VirtualBox (Ubuntu Server)

---

## MỤC LỤC

1. [Giới thiệu OpenVPN](#1-giới-thiệu-openvpn)
2. [Chuẩn bị môi trường VirtualBox](#2-chuẩn-bị-môi-trường-virtualbox)
   - 2.4 [Nâng cấp: Topology Thực Tế Hơn (2 Host-only Network)](#24-nâng-cấp-topology-thực-tế-hơn-2-host-only-network)
3. [Kiến trúc OpenVPN](#3-kiến-trúc-openvpn)
4. [Cài đặt và cấu hình PKI (Easy-RSA)](#4-cài-đặt-và-cấu-hình-pki-easy-rsa)
5. [Thực hành cơ bản - Cấu hình Server](#5-thực-hành-cơ-bản---cấu-hình-server)
6. [Thực hành trung cấp - Cấu hình Client](#6-thực-hành-trung-cấp---cấu-hình-client)
7. [Thực hành nâng cao](#7-thực-hành-nâng-cao)
8. [Quản lý và bảo trì](#8-quản-lý-và-bảo-trì)
9. [Bài tập tổng hợp](#9-bài-tập-tổng-hợp)
10. [Tổng kết](#10-tổng-kết)

---

## 1. Giới thiệu OpenVPN

**OpenVPN** là giải pháp VPN (Virtual Private Network) mã nguồn mở, cho phép tạo các kênh truyền thông được mã hóa an toàn qua mạng công cộng (Internet). OpenVPN hoạt động trên lớp ứng dụng (User Space), sử dụng **TLS/SSL** để bảo mật kênh truyền và giao thức **tun/tap** để tạo giao diện mạng ảo.

### 1.1 Vai trò của OpenVPN

- Tạo tunnel VPN an toàn giữa client và server
- Mã hóa toàn bộ traffic với TLS 1.2/1.3
- Xác thực hai chiều bằng PKI (Public Key Infrastructure)
- Cho phép remote access vào mạng nội bộ
- Site-to-site VPN giữa các văn phòng/datacenter

### 1.2 So sánh các giải pháp VPN phổ biến

| Tiêu chí | OpenVPN | WireGuard | IPSec | L2TP |
|---|---|---|---|---|
| Bảo mật | Cao (TLS) | Rất cao | Cao | Trung bình |
| Tốc độ | Trung bình | Rất nhanh | Nhanh | Chậm |
| Cấu hình | Phức tạp | Đơn giản | Rất phức tạp | Trung bình |
| Firewall traversal | Rất tốt (TCP 443) | Kém hơn (UDP) | Kém | Kém |
| Nền tảng hỗ trợ | Rộng nhất | Ngày càng rộng | Rộng | Rộng |

> **Ghi chú:** OpenVPN dùng UDP 1194 mặc định nhưng có thể chuyển sang TCP 443 để vượt qua hầu hết các firewall doanh nghiệp.

### 1.3 Chế độ hoạt động

| Chế độ | Mô tả | Use case |
|---|---|---|
| **tun** (Layer 3) | Tạo interface IP, chỉ forward IP packets | Remote access, site-to-site |
| **tap** (Layer 2) | Tạo interface Ethernet, forward toàn bộ frame | Bridging, game LAN |

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
| VM1 | `vpn-server` | OpenVPN Server | NAT + Host-only |
| VM2 | `vpn-client` | OpenVPN Client | NAT + Host-only |

> **Lưu ý:** Cả 2 VM đều cần NAT adapter để cài đặt package qua internet (`apt install`). Host-only dùng để giao tiếp trực tiếp giữa 2 VM trong lab.

#### Bước 1: Tạo VM1 (vpn-server)

1. Mở VirtualBox → **New**
2. Name: `vpn-server`, Type: Linux, Version: Ubuntu (64-bit)
3. RAM: 1024 MB, Disk: 10 GB
4. Cài Ubuntu Server 22.04

#### Bước 2: Cấu hình network cho VM1

```
VirtualBox → vpn-server → Settings → Network

Adapter 1:
  - Attached to: NAT
  - (Dùng để truy cập internet, cài package)

Adapter 2:
  - Attached to: Host-only Adapter
  - Name: vboxnet0
  - (Dùng để giao tiếp với client VM và host)
```

#### Bước 3: Tạo VM2 (vpn-client)

Tương tự VM1, cấu hình **2 adapter giống VM1**:

```
VirtualBox → vpn-client → Settings → Network

Adapter 1:
  - Attached to: NAT
  - (Dùng để cài đặt package: apt install openvpn)

Adapter 2:
  - Attached to: Host-only Adapter
  - Name: vboxnet0
  - (Dùng để kết nối đến vpn-server qua Host-only network)
```

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
    enp0s3:           # Card NAT (internet để cài package)
      dhcp4: true
    enp0s8:           # Card Host-only (giao tiếp với vpn-server)
      addresses:
        - 192.168.56.20/24
```

```bash
sudo netplan apply
```

> **Giải thích thiết kế lab:**
> - VM2 dùng **NAT (enp0s3)** để `apt install` và truy cập internet bình thường.
> - VM2 dùng **Host-only (enp0s8)** để kết nối đến vpn-server (`192.168.56.10`).
> - Trong thực tế, client VPN sẽ kết nối đến server qua **internet public**. Trong lab này, Host-only network đóng vai trò mô phỏng đường kết nối đó.
> - Sau khi VPN tunnel thiết lập thành công, traffic từ VM2 đến `192.168.56.0/24` sẽ đi **qua tunnel** thay vì đi trực tiếp.

#### Bước 6: Kiểm tra kết nối

```bash
# Trên VM2, ping đến VM1
ping 192.168.56.10

# Trên VM1, ping đến VM2
ping 192.168.56.20
```

### 2.3 Cài đặt OpenVPN và Easy-RSA

```bash
# === Thực hiện trên CẢ HAI VM ===

# Cập nhật hệ thống
sudo apt update && sudo apt upgrade -y

# Cài OpenVPN
sudo apt install openvpn -y

# Kiểm tra phiên bản
openvpn --version

# === Chỉ trên VM1 (vpn-server) ===
# Cài Easy-RSA để quản lý PKI
sudo apt install easy-rsa -y
```

### 2.4 Nâng cấp: Topology Thực Tế Hơn (2 Host-only Network)

> **Mục tiêu:** Mô phỏng client ở sau NAT router (như ở nhà/công ty) kết nối VPN đến server qua "internet" — không thấy server trực tiếp, phải đi qua router trung gian.

#### So sánh lab cơ bản vs lab nâng cao

| | Lab cơ bản | Lab nâng cao |
|---|---|---|
| Host-only network | 1 (vboxnet0) | 2 (vboxnet0 + vboxnet1) |
| Client thấy Server trực tiếp | ✅ Có | ❌ Không |
| Phải đi qua router | ❌ | ✅ Windows Host |
| Mô phỏng NAT thật | ❌ | ✅ |
| Số VM cần | 2 | 2 (Windows Host làm router) |

#### Topology mới

```
                  Windows Host (đóng vai ISP/Router)
                  ┌──────────────────────────────────┐
[vpn-server]      │  vboxnet0: 192.168.56.1           │     [vpn-client]
192.168.56.10 ────┤                                   ├──── 192.168.57.20
   (enp0s8)       │  vboxnet1: 192.168.57.1           │        (enp0s8)
                  └──────────────────────────────────┘
                          ↑ IP Routing bật trên Windows
```

**Điểm mấu chốt:**
- `vpn-client` (192.168.57.20) **không có đường trực tiếp** đến `vpn-server` (192.168.56.10)
- Mọi traffic phải đi qua Windows Host — đóng vai ISP/router
- Tương đương thực tế: `192.168.57.x` = mạng nhà, `192.168.56.10` = IP public của server

#### Bước 1: Tạo Host-only Network thứ 2 trong VirtualBox

```
VirtualBox → File → Host Network Manager (Ctrl+H)
→ Create → vboxnet1
→ Tab Adapter:
    IPv4 Address: 192.168.57.1
    IPv4 Mask:    255.255.255.0
→ Tab DHCP Server: BỎ TICK "Enable Server"
→ Apply
```

#### Bước 2: Điều chỉnh Network Adapter cho vpn-client (VM2)

```
VirtualBox → vpn-client → Settings → Network

Adapter 1: NAT          (giữ nguyên - để apt install)
Adapter 2: Host-only → ĐỔI từ vboxnet0 sang vboxnet1
```

> **Lưu ý:** `vpn-server` (VM1) giữ nguyên Adapter 2 là `vboxnet0`. Client và server giờ ở 2 mạng khác nhau, không thấy nhau trực tiếp.

#### Bước 3: Cập nhật IP tĩnh trên vpn-client (VM2)

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp0s3:           # Card NAT (apt install)
      dhcp4: true
    enp0s8:           # Card Host-only vboxnet1 (client-side LAN)
      addresses:
        - 192.168.57.20/24
      routes:
        - to: 192.168.56.0/24    # Route đến mạng server
          via: 192.168.57.1      # Qua Windows Host (đóng vai router)
      nameservers:
        addresses: [8.8.8.8]
```

```bash
sudo netplan apply
```

#### Bước 4: Thêm route ngược trên vpn-server (VM1)

Server cần biết đường trả lời về mạng client:

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp0s3:
      dhcp4: true
    enp0s8:           # Card Host-only vboxnet0 (server-side LAN)
      addresses:
        - 192.168.56.10/24
      routes:
        - to: 192.168.57.0/24    # Route về mạng client
          via: 192.168.56.1      # Qua Windows Host
      nameservers:
        addresses: [8.8.8.8]
```

```bash
sudo netplan apply
```

#### Bước 5: Bật IP Routing trên Windows Host

> Mở **PowerShell với quyền Administrator** trên máy Windows:

```powershell
# Bật IP Routing (cho phép Windows chuyển tiếp packet giữa 2 mạng)
Set-ItemProperty `
  -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters" `
  -Name "IPEnableRouter" `
  -Value 1

# Xác nhận đã bật
Get-ItemProperty `
  -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters" `
  -Name "IPEnableRouter"
# Output: IPEnableRouter : 1
```

> **Khởi động lại Windows** để IP Routing có hiệu lực.

#### Bước 6: Kiểm tra kết nối qua router (trước khi cài VPN)

```bash
# === Từ VM2 (vpn-client) ===

# Ping đến Windows Host (gateway)
ping 192.168.57.1
# Phải thành công - đây là "router" trung gian

# Ping đến vpn-server (đi qua Windows Host, không đi thẳng)
ping 192.168.56.10
# Phải thành công

# Xem rõ đường đi - phải thấy hop qua Windows Host
traceroute 192.168.56.10
# Output mong đợi:
#  1  192.168.57.1  <1ms   ← Windows Host (router)
#  2  192.168.56.10 <1ms   ← vpn-server
```

> **Đây chính là điểm thực tế:** Client phải đi qua 1 hop (router) để đến server, giống như đi qua ISP ngoài internet thật.

#### Bước 7: Luồng packet khi VPN hoạt động

```
[Trước VPN - routing thuần túy, không mã hóa]
VM2 (57.20) ──► Windows Host (57.1 → 56.1) ──► VM1 (56.10)

[Sau khi VPN kết nối - mã hóa xuyên qua router]
VM2 App → tun0 (10.8.0.2) → [mã hóa AES-256] → enp0s8 (57.20)
        → Windows Host (57.1 → 56.1) → VM1 enp0s8 (56.10)
        → [giải mã] → tun0 (10.8.0.1) → ứng dụng server
```

> **Lưu ý:** Phần còn lại của hướng dẫn (từ Section 3 trở đi) **không thay đổi**. File `.ovpn` và `client.conf` vẫn dùng `remote 192.168.56.10 1194` — chính xác như khi client kết nối đến server qua internet thật.

---

## 3. Kiến trúc OpenVPN

### 3.1 Tổng quan mô hình kết nối

```
                  ┌─────────────────────────────────────┐
[VPN Client]      │             Internet                 │     [VPN Server]
192.168.56.20 ──► │  ══════ Encrypted TLS Tunnel ══════ │ ──► 192.168.56.10
10.8.0.2 (tun0)   │         UDP/TCP port 1194            │     10.8.0.1 (tun0)
                  └─────────────────────────────────────┘
                                                               │
                                                     ┌─────────▼──────────┐
                                                     │  Private Network   │
                                                     │  192.168.56.0/24   │
                                                     └────────────────────┘
```

### 3.2 Các thành phần chính

| Thành phần | Mô tả | File/Vị trí |
|---|---|---|
| **CA Certificate** | Chứng chỉ gốc ký tất cả certs | `ca.crt` |
| **Server Certificate** | Chứng chỉ xác thực server | `server.crt` |
| **Server Key** | Khóa riêng của server | `server.key` |
| **Client Certificate** | Chứng chỉ xác thực client | `client.crt` |
| **Client Key** | Khóa riêng của client | `client.key` |
| **DH Parameters** | Tham số Diffie-Hellman | `dh.pem` |
| **TLS Auth Key** | Bảo vệ thêm tầng TLS | `ta.key` |

### 3.3 Quá trình kết nối TLS Handshake

```
Client                                          Server
  │                                               │
  │──── 1. ClientHello (TLS) ───────────────────►│
  │                                               │
  │◄─── 2. ServerHello + Server Certificate ─────│
  │                                               │
  │──── 3. Client Certificate + Verify ─────────►│
  │                                               │
  │◄──►  4. Key Exchange (DH) ──────────────────►│
  │                                               │
  │◄════ 5. Encrypted VPN Tunnel Established ════►│
  │                                               │
  │──── 6. Assign VPN IP (10.8.0.2) ────────────►│
  │                                               │
```

### 3.4 VPN Tunnel Interface

```
Không có VPN:
  Client App → eth0 (192.168.56.20) → Network → Server

Với VPN (tun mode):
  Client App → tun0 (10.8.0.2) → [Encrypt] → eth0 → Network → eth0 → [Decrypt] → tun0 (10.8.0.1) → Server App
```

---

## 4. Cài đặt và cấu hình PKI (Easy-RSA)

> **Thực hiện trên VM1 (vpn-server)**

### Lab 1: Khởi tạo PKI

```bash
# Tạo thư mục Easy-RSA
mkdir ~/easy-rsa
cp -r /usr/share/easy-rsa/* ~/easy-rsa/
cd ~/easy-rsa

# Khởi tạo PKI
./easyrsa init-pki

# Kết quả:
# init-pki complete; you may now create a CA or requests.
# Your newly created PKI dir is: /home/user/easy-rsa/pki
```

### Lab 2: Tạo Certificate Authority (CA)

```bash
cd ~/easy-rsa

# Tạo CA (sẽ yêu cầu nhập passphrase và Common Name)
./easyrsa build-ca

# Nhập:
#   CA Key Passphrase: (nhập passphrase bảo vệ CA key - ghi nhớ lại!)
#   Common Name: VCS-VPN-CA  (hoặc tên tùy ý)

# Kiểm tra CA certificate vừa tạo
ls -la pki/ca.crt
openssl x509 -in pki/ca.crt -text -noout | grep -E "Subject:|Validity"
```

**Output mẫu:**
```
        Subject: CN=VCS-VPN-CA
        Validity
            Not Before: Apr 27 00:00:00 2026 GMT
            Not After : Apr 25 00:00:00 2036 GMT
```

### Lab 3: Tạo chứng chỉ Server

```bash
cd ~/easy-rsa

# Tạo request và ký chứng chỉ server (nopass = không cần passphrase cho server key)
./easyrsa build-server-full server nopass

# Kiểm tra chứng chỉ vừa tạo
ls -la pki/issued/server.crt
ls -la pki/private/server.key

# Xem nội dung chứng chỉ
openssl x509 -in pki/issued/server.crt -text -noout | grep -E "Subject:|Extended Key"
```

### Lab 4: Tạo chứng chỉ Client

```bash
cd ~/easy-rsa

# Tạo chứng chỉ cho client (nopass = không cần passphrase)
./easyrsa build-client-full client1 nopass

# Tạo nhiều client cùng lúc
./easyrsa build-client-full client2 nopass
./easyrsa build-client-full client3 nopass

# Kiểm tra
ls pki/issued/
ls pki/private/
```

### Lab 5: Tạo DH Parameters và TLS Auth Key

```bash
cd ~/easy-rsa

# Tạo Diffie-Hellman parameters (có thể mất vài phút)
./easyrsa gen-dh

# Tạo TLS Auth key (thêm lớp bảo vệ HMAC)
openvpn --genkey secret pki/ta.key

# Kiểm tra
ls -la pki/dh.pem
ls -la pki/ta.key

echo "PKI Setup hoàn tất!"
ls pki/ca.crt pki/dh.pem pki/ta.key pki/issued/server.crt pki/private/server.key
```

### Lab 6: Copy files cấu hình vào /etc/openvpn

```bash
# Copy tất cả files cần thiết cho server
sudo cp pki/ca.crt /etc/openvpn/server/
sudo cp pki/issued/server.crt /etc/openvpn/server/
sudo cp pki/private/server.key /etc/openvpn/server/
sudo cp pki/dh.pem /etc/openvpn/server/
sudo cp pki/ta.key /etc/openvpn/server/

# Phân quyền bảo mật
sudo chmod 600 /etc/openvpn/server/server.key
sudo chmod 600 /etc/openvpn/server/ta.key

# Kiểm tra
ls -la /etc/openvpn/server/
```

---

## 5. Thực hành cơ bản - Cấu hình Server

> **Thực hiện trên VM1 (vpn-server)**

### Lab 7: Tạo file cấu hình Server

```bash
sudo nano /etc/openvpn/server/server.conf
```

```conf
# ===== NETWORK =====
# Lắng nghe trên port 1194 UDP
port 1194
proto udp

# Chế độ tun (Layer 3 - IP routing)
dev tun

# ===== CERTIFICATES =====
ca   /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key  /etc/openvpn/server/server.key
dh   /etc/openvpn/server/dh.pem

# TLS Authentication key (hướng 0 = server)
tls-auth /etc/openvpn/server/ta.key 0

# ===== VPN SUBNET =====
# Dải IP VPN sẽ cấp cho clients
server 10.8.0.0 255.255.255.0

# Lưu trạng thái IP đã cấp
ifconfig-pool-persist /var/log/openvpn/ipp.txt

# ===== ROUTING =====
# Push route nội bộ đến client (client có thể truy cập 192.168.56.0/24)
push "route 192.168.56.0 255.255.255.0"

# Push DNS server đến client
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"

# ===== SECURITY =====
# Cipher mã hóa
cipher AES-256-GCM
auth SHA256

# TLS version tối thiểu
tls-version-min 1.2

# Giảm quyền chạy sau khi khởi động
user nobody
group nogroup

# ===== KEEP-ALIVE =====
# Gửi ping mỗi 10s, restart nếu không phản hồi trong 120s
keepalive 10 120

# ===== LOGGING =====
status /var/log/openvpn/openvpn-status.log
log-append /var/log/openvpn/openvpn.log
verb 3

# Cho phép nhiều client cùng chứng chỉ (KHÔNG dùng trong production)
# duplicate-cn
```

```bash
# Tạo thư mục log
sudo mkdir -p /var/log/openvpn
```

### Lab 8: Bật IP Forwarding và cấu hình tường lửa

```bash
# Bật IP Forwarding tạm thời
sudo sysctl -w net.ipv4.ip_forward=1

# Bật vĩnh viễn
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Kiểm tra
cat /proc/sys/net/ipv4/ip_forward
# Output: 1

# === Cấu hình iptables để cho phép VPN traffic ===

# Tìm tên card NAT (interface kết nối internet)
ip route | grep default
# Ví dụ output: default via 10.0.2.2 dev enp0s3 ...
# → Card NAT là enp0s3

# Cho phép OpenVPN port
sudo iptables -A INPUT -p udp --dport 1194 -j ACCEPT

# Cho phép forward traffic từ tun0
sudo iptables -A FORWARD -i tun0 -j ACCEPT
sudo iptables -A FORWARD -o tun0 -j ACCEPT

# NAT cho traffic từ VPN ra internet
sudo iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o enp0s3 -j MASQUERADE

# Lưu iptables rules
sudo apt install iptables-persistent -y
sudo netfilter-persistent save
```

### Lab 9: Khởi động OpenVPN Server

```bash
# Khởi động OpenVPN server
sudo systemctl start openvpn-server@server

# Bật tự động khởi động khi boot
sudo systemctl enable openvpn-server@server

# Kiểm tra trạng thái
sudo systemctl status openvpn-server@server

# Kiểm tra interface tun0 đã tạo
ip addr show tun0

# Kiểm tra log
sudo tail -f /var/log/openvpn/openvpn.log
```

**Output mẫu khi server khởi động thành công:**
```
● openvpn-server@server.service - OpenVPN service for server
     Loaded: loaded (/lib/systemd/system/openvpn-server@.service; enabled)
     Active: active (running)

Apr 27 21:00:00 vpn-server openvpn[1234]: OpenVPN 2.5.9 x86_64-pc-linux-gnu
Apr 27 21:00:00 vpn-server openvpn[1234]: TUN/TAP device tun0 opened
Apr 27 21:00:00 vpn-server openvpn[1234]: Initialization Sequence Completed
```

```bash
# Kiểm tra port đang listen
sudo ss -ulnp | grep 1194
# Output: udp   UNCONN  0  0  0.0.0.0:1194  0.0.0.0:*  users:(("openvpn",pid=...))
```

---

## 6. Thực hành trung cấp - Cấu hình Client

### Lab 10: Copy files về máy Client

```bash
# === Trên VM1 (vpn-server): Chuẩn bị files cho client ===

# Tạo thư mục chứa client files
mkdir ~/client-configs

# Copy các files cần thiết
cp ~/easy-rsa/pki/ca.crt ~/client-configs/
cp ~/easy-rsa/pki/issued/client1.crt ~/client-configs/
cp ~/easy-rsa/pki/private/client1.key ~/client-configs/
cp ~/easy-rsa/pki/ta.key ~/client-configs/

ls -la ~/client-configs/
```

```bash
# === Từ VM2 (vpn-client): Copy files từ server về ===

# Dùng scp để copy (thay 'user' bằng username trên VM1)
scp user@192.168.56.10:~/client-configs/* ~/

# Kiểm tra
ls -la ~/ca.crt ~/client1.crt ~/client1.key ~/ta.key
```

### Lab 11: Tạo file cấu hình Client

```bash
# === Trên VM2 (vpn-client) ===
sudo nano /etc/openvpn/client/client.conf
```

```conf
# ===== NETWORK =====
client
dev tun
proto udp

# Địa chỉ server VPN (IP của VM1)
remote 192.168.56.10 1194

# Tự động kết nối lại khi mất kết nối
resolv-retry infinite
nobind

# ===== CERTIFICATES =====
ca   /home/user/ca.crt
cert /home/user/client1.crt
key  /home/user/client1.key

# TLS Authentication key (hướng 1 = client)
tls-auth /home/user/ta.key 1

# ===== SECURITY =====
cipher AES-256-GCM
auth SHA256
tls-version-min 1.2

# Giảm quyền sau khi kết nối
user nobody
group nogroup

# Tồn tại qua restart nhẹ
persist-key
persist-tun

# ===== LOGGING =====
verb 3
```

> **Lưu ý:** Thay `/home/user/` bằng đường dẫn thực tế nơi bạn đặt file certs.

### Lab 12: Kết nối VPN từ Client

```bash
# === Trên VM2 (vpn-client) ===

# Kết nối VPN
sudo openvpn --config /etc/openvpn/client/client.conf

# Hoặc chạy nền với systemd
sudo systemctl start openvpn-client@client
sudo systemctl enable openvpn-client@client

# Kiểm tra trạng thái
sudo systemctl status openvpn-client@client
```

**Output kết nối thành công:**
```
Apr 27 21:05:00 vpn-client openvpn[5678]: TUN/TAP device tun0 opened
Apr 27 21:05:00 vpn-client openvpn[5678]: /sbin/ip addr add dev tun0 10.8.0.2/24
Apr 27 21:05:00 vpn-client openvpn[5678]: Initialization Sequence Completed
```

```bash
# Kiểm tra IP VPN đã được cấp
ip addr show tun0
# Output: inet 10.8.0.2/24 scope global tun0

# Kiểm tra bảng routing
ip route
# Output bao gồm: 10.8.0.0/24 dev tun0 ...
#                 192.168.56.0/24 via 10.8.0.1 dev tun0 ...

# Ping đến server qua VPN tunnel
ping 10.8.0.1

# Ping đến máy trong mạng nội bộ server
ping 192.168.56.10
```

### Lab 13: Tạo file .ovpn (All-in-One Client Config)

Thay vì copy nhiều file, ta có thể đóng gói tất cả vào **một file .ovpn duy nhất**:

```bash
# === Trên VM1 (vpn-server) ===
# Tạo script tự động tạo file .ovpn

cat > ~/make-ovpn.sh << 'EOF'
#!/bin/bash
# Sử dụng: ./make-ovpn.sh <tên-client>

CLIENT=$1
EASY_RSA=~/easy-rsa
OUTPUT=~/${CLIENT}.ovpn

cat > $OUTPUT << OVPN
client
dev tun
proto udp
remote 192.168.56.10 1194
resolv-retry infinite
nobind
persist-key
persist-tun
cipher AES-256-GCM
auth SHA256
tls-version-min 1.2
verb 3
key-direction 1
OVPN

echo "<ca>" >> $OUTPUT
cat ${EASY_RSA}/pki/ca.crt >> $OUTPUT
echo "</ca>" >> $OUTPUT

echo "<cert>" >> $OUTPUT
openssl x509 -in ${EASY_RSA}/pki/issued/${CLIENT}.crt >> $OUTPUT
echo "</cert>" >> $OUTPUT

echo "<key>" >> $OUTPUT
cat ${EASY_RSA}/pki/private/${CLIENT}.key >> $OUTPUT
echo "</key>" >> $OUTPUT

echo "<tls-auth>" >> $OUTPUT
cat ${EASY_RSA}/pki/ta.key >> $OUTPUT
echo "</tls-auth>" >> $OUTPUT

echo "Tạo thành công: $OUTPUT"
EOF

chmod +x ~/make-ovpn.sh

# Tạo file .ovpn cho client1
~/make-ovpn.sh client1

# Kiểm tra
ls -la ~/client1.ovpn
head -20 ~/client1.ovpn
```

```bash
# === Trên VM2 (vpn-client) ===
# Copy file .ovpn về
scp user@192.168.56.10:~/client1.ovpn ~/

# Kết nối bằng file .ovpn
sudo openvpn --config ~/client1.ovpn
```

---

## 7. Thực hành nâng cao

### Lab 14: Cấu hình Route All Traffic qua VPN (Full Tunnel)

Mặc định OpenVPN chỉ route traffic đến VPN subnet (Split Tunnel). Để route **toàn bộ traffic** qua VPN:

```bash
# === Thêm vào /etc/openvpn/server/server.conf ===
sudo nano /etc/openvpn/server/server.conf
```

```conf
# Push default gateway - buộc mọi traffic đi qua VPN
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"
```

```bash
# Cập nhật iptables để NAT traffic internet từ VPN
sudo iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o enp0s3 -j MASQUERADE

# Restart server
sudo systemctl restart openvpn-server@server

# === Từ VM2 (vpn-client): Kiểm tra ===
curl https://api.ipify.org
# IP trả về phải là IP của VM1 (server), không phải VM2
```

### Lab 15: Xác thực bằng Username và Password

```bash
# === Trên VM1 (vpn-server) ===
# Tạo script xác thực
sudo nano /etc/openvpn/checkpasswd.sh
```

```bash
#!/bin/bash
# Script xác thực username/password đơn giản
USERNAME=$1
PASSWORD=$2
PASSWD_FILE="/etc/openvpn/users.db"

if grep -q "^${USERNAME}:${PASSWORD}$" "$PASSWD_FILE"; then
    exit 0  # Xác thực thành công
else
    exit 1  # Xác thực thất bại
fi
```

```bash
sudo chmod 700 /etc/openvpn/checkpasswd.sh

# Tạo file user database
echo "vpnuser1:password123" | sudo tee /etc/openvpn/users.db
echo "vpnuser2:securepass" | sudo tee -a /etc/openvpn/users.db
sudo chmod 600 /etc/openvpn/users.db

# Thêm vào server.conf
echo 'auth-user-pass-verify /etc/openvpn/checkpasswd.sh via-env' | sudo tee -a /etc/openvpn/server/server.conf
echo 'script-security 2' | sudo tee -a /etc/openvpn/server/server.conf
echo 'username-as-common-name' | sudo tee -a /etc/openvpn/server/server.conf

# Restart server
sudo systemctl restart openvpn-server@server
```

```conf
# === Thêm vào file client.conf ===
# Yêu cầu nhập username/password khi kết nối
auth-user-pass
```

### Lab 16: Cấu hình IP cố định cho Client

```bash
# === Trên VM1 (vpn-server) ===

# Tạo thư mục client config
sudo mkdir -p /etc/openvpn/server/ccd

# Tạo file config cho client1 (tên file = Common Name của client cert)
sudo nano /etc/openvpn/server/ccd/client1
```

```conf
# Cấp IP cố định cho client1
ifconfig-push 10.8.0.10 255.255.255.0

# Push route bổ sung chỉ cho client này
push "route 192.168.56.0 255.255.0.0"
```

```bash
# Thêm vào server.conf
echo 'client-config-dir /etc/openvpn/server/ccd' | sudo tee -a /etc/openvpn/server/server.conf

# Restart server
sudo systemctl restart openvpn-server@server

# === Từ VM2: Kết nối lại và kiểm tra ===
# ip addr show tun0 → phải thấy 10.8.0.10
```

### Lab 17: Thu hồi chứng chỉ Client (Revoke Certificate)

```bash
# === Trên VM1 (vpn-server) ===
cd ~/easy-rsa

# Thu hồi chứng chỉ của client2
./easyrsa revoke client2

# Nhập "yes" để xác nhận
# Nhập CA passphrase

# Tạo lại CRL (Certificate Revocation List)
./easyrsa gen-crl

# Copy CRL vào thư mục OpenVPN
sudo cp pki/crl.pem /etc/openvpn/server/

# Thêm vào server.conf (chỉ cần thêm 1 lần)
grep -q "crl-verify" /etc/openvpn/server/server.conf || \
    echo "crl-verify /etc/openvpn/server/crl.pem" | sudo tee -a /etc/openvpn/server/server.conf

# Restart server
sudo systemctl restart openvpn-server@server

# Test: Thử kết nối lại với client2 → phải bị từ chối
```

### Lab 18: Monitoring và Logging nâng cao

```bash
# === Theo dõi clients đang kết nối ===
sudo cat /var/log/openvpn/openvpn-status.log

# Output mẫu:
# CLIENT LIST
# Common Name,Real Address,Bytes Received,Bytes Sent,Connected Since
# client1,192.168.56.20:51234,12345,67890,Mon Apr 27 21:00:00 2026
#
# ROUTING TABLE
# Virtual Address,Common Name,Real Address,Last Ref
# 10.8.0.2,client1,192.168.56.20:51234,Mon Apr 27 21:10:00 2026

# Theo dõi log realtime
sudo tail -f /var/log/openvpn/openvpn.log

# Lọc các kết nối thành công
sudo grep "Peer Connection Initiated" /var/log/openvpn/openvpn.log

# Lọc các kết nối bị từ chối
sudo grep "TLS Error\|VERIFY ERROR\|AUTH_FAILED" /var/log/openvpn/openvpn.log

# Xem thống kê với journalctl
sudo journalctl -u openvpn-server@server --since "1 hour ago"
```

### Lab 19: Site-to-Site VPN

> **Mục tiêu:** Kết nối 2 mạng nội bộ với nhau qua VPN

```
Mạng A (VM1 - Server): 10.10.1.0/24
Mạng B (VM2 - Client): 10.10.2.0/24
VPN Tunnel: 10.8.0.0/24
```

```bash
# === Trên VM1 (vpn-server) ===
# Thêm route cho mạng của client vào server.conf

# Tạo file ccd cho client (site-to-site)
sudo nano /etc/openvpn/server/ccd/client1
```

```conf
# Khai báo subnet phía client
iroute 10.10.2.0 255.255.255.0
```

```bash
# Thêm vào server.conf
sudo nano /etc/openvpn/server/server.conf
```

```conf
# Push route cho server để biết đường đến mạng client
route 10.10.2.0 255.255.255.0
```

```bash
# === Trên VM2 (vpn-client) ===
# Thêm vào client.conf
sudo nano /etc/openvpn/client/client.conf
```

```conf
# Khai báo subnet phía server (để server push ngược lại)
# Server sẽ tự push route 10.10.1.0/24
```

---

## 8. Quản lý và bảo trì

### 8.1 Quản lý service OpenVPN

```bash
# Xem trạng thái
sudo systemctl status openvpn-server@server

# Khởi động / Tắt / Restart
sudo systemctl start openvpn-server@server
sudo systemctl stop openvpn-server@server
sudo systemctl restart openvpn-server@server

# Reload cấu hình (không ngắt kết nối hiện tại)
sudo systemctl reload openvpn-server@server

# Xem log service
sudo journalctl -u openvpn-server@server -n 50
```

### 8.2 Quản lý certificates

```bash
cd ~/easy-rsa

# Xem danh sách certificates
cat pki/index.txt

# Format: Status | Expire date | Revoke date | Serial | filename | Subject
# V       = Valid (còn hiệu lực)
# R       = Revoked (đã thu hồi)
# E       = Expired (hết hạn)

# Tạo thêm client mới
./easyrsa build-client-full new-client nopass
~/make-ovpn.sh new-client

# Thu hồi certificate
./easyrsa revoke client-name
./easyrsa gen-crl
sudo cp pki/crl.pem /etc/openvpn/server/
sudo systemctl reload openvpn-server@server
```

### 8.3 Backup và phục hồi

```bash
# === Backup toàn bộ PKI và cấu hình ===
BACKUP_DATE=$(date +%Y%m%d-%H%M%S)

# Backup PKI
sudo tar -czf ~/openvpn-pki-backup-${BACKUP_DATE}.tar.gz ~/easy-rsa/pki/

# Backup cấu hình server
sudo tar -czf ~/openvpn-config-backup-${BACKUP_DATE}.tar.gz /etc/openvpn/

# Liệt kê backups
ls ~/openvpn-*.tar.gz

# Phục hồi PKI
tar -xzf ~/openvpn-pki-backup-20260427-210000.tar.gz -C ~/

# Phục hồi cấu hình
sudo tar -xzf ~/openvpn-config-backup-20260427-210000.tar.gz -C /
```

### 8.4 Kiểm tra hiệu năng VPN

```bash
# Đo băng thông qua VPN tunnel (cần cài iperf3)
sudo apt install iperf3 -y

# Trên VM1 (server): Chạy iperf3 server
iperf3 -s

# Trên VM2 (client): Test qua VPN
iperf3 -c 10.8.0.1    # qua tunnel VPN
iperf3 -c 192.168.56.10  # trực tiếp (để so sánh)

# Kiểm tra độ trễ
ping -c 10 10.8.0.1

# Xem traffic trên tunnel
ip -s link show tun0

# Capture traffic VPN (gói tin đã mã hóa)
sudo tcpdump -i enp0s8 -n port 1194

# Capture traffic trong tunnel (đã giải mã)
sudo tcpdump -i tun0 -n
```

---

## 9. Bài tập tổng hợp

### Bài tập 1: Thiết lập VPN cơ bản

**Yêu cầu:** Thiết lập OpenVPN server trên VM1 và kết nối client từ VM2 với các điều kiện:
- Sử dụng giao thức UDP port 1194
- Mã hóa AES-256-GCM
- Client nhận IP trong dải 10.8.0.0/24
- Client có thể ping đến 192.168.56.10 qua VPN

**Kiểm tra thành công:**
```bash
# Từ VM2 sau khi kết nối VPN
ip addr show tun0     # Phải có IP 10.8.0.x
ping 10.8.0.1         # Ping đến server qua tunnel
ping 192.168.56.10    # Ping đến mạng nội bộ server
```

### Bài tập 2: Quản lý nhiều Clients

**Yêu cầu:**
- Tạo chứng chỉ cho 3 clients: `alice`, `bob`, `charlie`
- Cấp IP cố định: alice=10.8.0.10, bob=10.8.0.20, charlie=10.8.0.30
- Tạo file .ovpn riêng cho từng người

**Gợi ý:**
```bash
cd ~/easy-rsa
./easyrsa build-client-full alice nopass
./easyrsa build-client-full bob nopass
./easyrsa build-client-full charlie nopass

# Tạo CCD cho mỗi client
sudo nano /etc/openvpn/server/ccd/alice
# ifconfig-push 10.8.0.10 255.255.255.0
```

### Bài tập 3: Thu hồi và kiểm tra Certificate

**Yêu cầu:**
- Thu hồi chứng chỉ của `charlie`
- Kích hoạt CRL trên server
- Kiểm tra rằng `charlie` không thể kết nối VPN nữa
- Đảm bảo `alice` và `bob` vẫn kết nối bình thường

**Kiểm tra thành công:**
```bash
# Kết nối với charlie → phải thấy lỗi
# TLS Error: certificate verify failed
```

### Bài tập 4: Monitoring và Troubleshooting

```bash
# 1. Xem các client đang kết nối realtime
watch -n 5 'cat /var/log/openvpn/openvpn-status.log'

# 2. Đếm số kết nối trong ngày
grep "Peer Connection Initiated" /var/log/openvpn/openvpn.log | wc -l

# 3. Tìm các lỗi xác thực
grep -i "error\|failed\|refused" /var/log/openvpn/openvpn.log

# 4. Phân tích traffic
sudo tcpdump -i tun0 -n -c 50
```

---

## 10. Tổng kết

### 10.1 Checklist thiết lập VPN an toàn

- [ ] PKI được khởi tạo đúng cách với CA passphrase mạnh
- [ ] Mỗi client có chứng chỉ riêng biệt
- [ ] Sử dụng cipher mạnh: AES-256-GCM
- [ ] TLS Auth key được cấu hình (chống DoS)
- [ ] TLS version tối thiểu là 1.2
- [ ] IP Forwarding được bật trên server
- [ ] iptables cấu hình đúng để forward VPN traffic
- [ ] CRL được kích hoạt và cập nhật khi revoke cert
- [ ] Log được cấu hình và theo dõi
- [ ] Backup PKI định kỳ

### 10.2 Các lệnh hay dùng nhất

```bash
# Kiểm tra trạng thái server
sudo systemctl status openvpn-server@server

# Xem clients đang kết nối
sudo cat /var/log/openvpn/openvpn-status.log

# Theo dõi log realtime
sudo tail -f /var/log/openvpn/openvpn.log

# Kiểm tra interface VPN
ip addr show tun0
ip route | grep tun0

# Tạo client mới
cd ~/easy-rsa && ./easyrsa build-client-full <tên> nopass
~/make-ovpn.sh <tên>

# Thu hồi certificate
cd ~/easy-rsa
./easyrsa revoke <tên>
./easyrsa gen-crl
sudo cp pki/crl.pem /etc/openvpn/server/
sudo systemctl reload openvpn-server@server
```

### 10.3 Troubleshooting phổ biến

| Vấn đề | Nguyên nhân | Giải pháp |
|---|---|---|
| `TLS handshake failed` | Chứng chỉ sai hoặc hết hạn | Kiểm tra ca.crt, cert, key khớp nhau |
| `AUTH_FAILED` | Username/password sai (nếu dùng) | Kiểm tra file users.db |
| Client không nhận được IP | DHCP pool hết | Kiểm tra `server 10.8.0.0 255.255.255.0` |
| Không ping được mạng nội bộ | Thiếu route hoặc ip_forward=0 | Bật ip_forward, kiểm tra `push "route ..."` |
| Kết nối bị ngắt liên tục | keepalive quá ngắn | Tăng `keepalive 10 120` |
| Client bị Block sau khi revoke không có tác dụng | Server chưa load CRL | Copy crl.pem mới và reload server |
| Không kết nối được qua Firewall doanh nghiệp | UDP 1194 bị chặn | Đổi sang `proto tcp` và `port 443` |

### 10.4 So sánh Split Tunnel vs Full Tunnel

| | Split Tunnel | Full Tunnel |
|---|---|---|
| **Cấu hình server** | `push "route 192.168.56.0 ..."` | `push "redirect-gateway def1"` |
| **Traffic qua VPN** | Chỉ traffic đến mạng nội bộ | Toàn bộ traffic |
| **Tốc độ** | Nhanh hơn | Chậm hơn (server là bottleneck) |
| **Bảo mật** | Thấp hơn | Cao hơn |
| **Use case** | Truy cập tài nguyên công ty | Ẩn danh, bypass censorship |

### 10.5 Tài liệu tham khảo

- **OpenVPN docs:** https://openvpn.net/community-resources/
- **Man page:** `man openvpn`
- **Easy-RSA:** https://github.com/OpenVPN/easy-rsa
- **Ubuntu Guide:** https://ubuntu.com/server/docs/service-openvpn
- **ArchLinux Wiki:** https://wiki.archlinux.org/title/OpenVPN

---

*Tài liệu này được biên soạn phục vụ mục đích học tập và thực hành trong môi trường lab VirtualBox.*  
*Phiên bản: 1.0 | Hệ điều hành: Ubuntu Server 22.04 LTS*
