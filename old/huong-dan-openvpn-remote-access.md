# Hướng Dẫn OpenVPN: Remote Access (Home Office → Văn Phòng)
## Mô hình thực tế: Nhân viên làm việc tại nhà kết nối VPN về công ty

---

## MỤC LỤC

1. [Giới thiệu mô hình](#1-giới-thiệu-mô-hình)
2. [Chuẩn bị môi trường Lab](#2-chuẩn-bị-môi-trường-lab)
3. [Cài đặt và cấu hình PKI](#3-cài-đặt-và-cấu-hình-pki)
4. [Cấu hình VPN Server](#4-cấu-hình-vpn-server)
5. [Cấu hình VPN Client](#5-cấu-hình-vpn-client)
6. [Kiểm tra và xác nhận](#6-kiểm-tra-và-xác-nhận)
7. [Quản lý Client](#7-quản-lý-client)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Giới thiệu mô hình

### 1.1 Bối cảnh thực tế

Nhân viên làm việc **tại nhà (Home Office)** cần truy cập tài nguyên nội bộ công ty (file server, database, máy in, v.v.) một cách an toàn qua internet. OpenVPN tạo một **đường hầm mã hóa** giữa máy nhân viên và cổng VPN của văn phòng.

```
[Nhà nhân viên]                  Internet                 [Văn phòng công ty]
                                                        ┌─────────────────────┐
Laptop (10.0.2.15)  ══UDP 1194══════════════════════►  │ VPN Gateway         │
[Sau NAT router]     Encrypted Tunnel                  │ 192.168.1.15        │
                                                        │                     │
                                                        │ Mạng nội bộ:        │
                                                        │ 192.168.1.0/24      │
                                                        │ (máy in, server...) │
                                                        └─────────────────────┘
```

### 1.2 Mô hình Lab mô phỏng

| Vai trò | VM | Network Adapter | IP |
|---|---|---|---|
| **VPN Server** (Gateway công ty) | Ubuntu Server | Bridged Adapter | 192.168.1.15 (LAN nhà = giả lập WAN) |
| **VPN Client** (Máy nhân viên tại nhà) | Ubuntu/Windows | NAT | 10.0.2.15 (VirtualBox NAT) |

> **Tại sao setup này thực tế?**
> - Server dùng **Bridged** → có IP thật trên mạng LAN → giả lập server có Public IP
> - Client dùng **NAT** → ẩn sau NAT của VirtualBox → giả lập máy nhân viên sau router nhà
> - Client **không cần port forwarding** để kết nối ra — NAT tự cho phép outbound
> - Client kết nối đến **IP thật của server** (192.168.1.15), giống kết nối đến Public IP

### 1.3 Luồng traffic

```
Trước VPN:
  Client (10.0.2.15) → VirtualBox NAT → Home Router → Server (192.168.1.15)
  [Không mã hóa, không an toàn]

Sau khi VPN kết nối:
  Client App → tun0 (10.8.0.2) → [AES-256 Encrypt] → eth0 (10.0.2.15)
             → VirtualBox NAT → Home Router → Server eth0 (192.168.1.15)
             → [Decrypt] → tun0 (10.8.0.1) → Mạng nội bộ văn phòng
```

---

## 2. Chuẩn bị môi trường Lab

### 2.1 Yêu cầu

- VirtualBox ≥ 6.1
- 2 VM Ubuntu Server 22.04
- RAM: 512 MB mỗi VM
- Disk: 10 GB mỗi VM

### 2.2 Cấu hình VM1 — vpn-server (Gateway văn phòng)

```
VirtualBox → vpn-server → Settings → Network

Adapter 1: Bridged Adapter
  → Name: [chọn card mạng vật lý đang dùng của máy bạn]
  → Promiscuous Mode: Allow VMs
```

> **Lưu ý:** Bridged Adapter sẽ cho VM lấy IP từ router nhà của bạn qua DHCP. Ta sẽ đặt IP tĩnh ở bước tiếp theo.

### 2.3 Cấu hình VM2 — vpn-client (Máy nhân viên tại nhà)

```
VirtualBox → vpn-client → Settings → Network

Adapter 1: NAT
  (Mặc định, không cần thay đổi gì)
```

> VirtualBox NAT tự động cấp IP `10.0.2.15` và gateway `10.0.2.2` cho VM.

### 2.4 Đặt IP tĩnh cho vpn-server

```bash
# === Trên VM1 (vpn-server) ===

# Xem tên card mạng Bridged
ip a
# Thường là enp0s3 hoặc eth0

# Kiểm tra IP hiện tại (DHCP từ router nhà)
ip addr show enp0s3
# Ghi nhớ dải IP (ví dụ: 192.168.1.x)

# Đặt IP tĩnh
sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp0s3:                    # Card Bridged (WAN/Public IP giả lập)
      addresses:
        - 192.168.1.15/24      # Đổi theo dải IP mạng nhà bạn
      routes:
        - to: default
          via: 192.168.1.1     # Gateway = IP router nhà bạn
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

```bash
sudo netplan apply

# Kiểm tra
ip addr show enp0s3
ping 8.8.8.8    # Phải có internet
```

### 2.5 Cài đặt OpenVPN và Easy-RSA

```bash
# === Trên CẢ HAI VM ===
sudo apt update && sudo apt upgrade -y
sudo apt install openvpn -y
openvpn --version

# === Chỉ trên VM1 (vpn-server) ===
sudo apt install easy-rsa -y
```

### 2.6 Kiểm tra kết nối Client → Server

```bash
# === Từ VM2 (vpn-client) ===
ping 192.168.1.15
# Phải thành công — Client đến được Server qua VirtualBox NAT
```

---

## 3. Cài đặt và cấu hình PKI

> **Thực hiện toàn bộ phần này trên VM1 (vpn-server)**

### Lab 1: Khởi tạo PKI

```bash
mkdir ~/easy-rsa
cp -r /usr/share/easy-rsa/* ~/easy-rsa/
cd ~/easy-rsa

./easyrsa init-pki
# Output: init-pki complete
```

### Lab 2: Tạo Certificate Authority (CA)

```bash
cd ~/easy-rsa
./easyrsa build-ca

# Nhập:
#   CA Key Passphrase: (đặt passphrase mạnh, ghi nhớ lại)
#   Common Name: VCS-VPN-CA

# Kiểm tra
openssl x509 -in pki/ca.crt -text -noout | grep -E "Subject:|Not After"
```

### Lab 3: Tạo chứng chỉ Server

```bash
cd ~/easy-rsa
./easyrsa build-server-full server nopass

ls pki/issued/server.crt
ls pki/private/server.key
```

### Lab 4: Tạo chứng chỉ Client

```bash
cd ~/easy-rsa

# Tạo cert cho từng nhân viên
./easyrsa build-client-full nhanvien1 nopass
./easyrsa build-client-full nhanvien2 nopass

ls pki/issued/
```

### Lab 5: Tạo DH Parameters và TLS Auth Key

```bash
cd ~/easy-rsa

# Tạo DH params (vài phút)
./easyrsa gen-dh

# Tạo TLS Auth key
openvpn --genkey secret pki/ta.key

# Kiểm tra tất cả files cần thiết
ls pki/ca.crt pki/dh.pem pki/ta.key \
   pki/issued/server.crt pki/private/server.key
echo "PKI hoàn tất!"
```

### Lab 6: Copy files vào /etc/openvpn/server

```bash
sudo mkdir -p /etc/openvpn/server
sudo cp pki/ca.crt          /etc/openvpn/server/
sudo cp pki/issued/server.crt /etc/openvpn/server/
sudo cp pki/private/server.key /etc/openvpn/server/
sudo cp pki/dh.pem          /etc/openvpn/server/
sudo cp pki/ta.key          /etc/openvpn/server/

# Bảo mật key files
sudo chmod 600 /etc/openvpn/server/server.key
sudo chmod 600 /etc/openvpn/server/ta.key

ls -la /etc/openvpn/server/
```

---

## 4. Cấu hình VPN Server

> **Thực hiện trên VM1 (vpn-server)**

### Lab 7: Tạo file cấu hình server

```bash
sudo nano /etc/openvpn/server/server.conf
```

```conf
# ===== NETWORK =====
port 1194
proto udp
dev tun

# ===== CERTIFICATES =====
ca   /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key  /etc/openvpn/server/server.key
dh   /etc/openvpn/server/dh.pem
tls-auth /etc/openvpn/server/ta.key 0

# ===== VPN SUBNET =====
# Dải IP VPN cấp cho nhân viên khi kết nối
server 10.8.0.0 255.255.255.0
ifconfig-pool-persist /var/log/openvpn/ipp.txt

# ===== ROUTING (đẩy route về văn phòng cho client) =====
# Client sẽ thấy được mạng nội bộ văn phòng (192.168.1.0/24)
push "route 192.168.1.0 255.255.255.0"

# Push DNS server
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"

# ===== SECURITY =====
cipher AES-256-GCM
auth SHA256
tls-version-min 1.2
user nobody
group nogroup

# ===== KEEP-ALIVE =====
keepalive 10 120
persist-key
persist-tun

# ===== LOGGING =====
status /var/log/openvpn/openvpn-status.log
log-append /var/log/openvpn/openvpn.log
verb 3
```

### Lab 8: Bật IP Forwarding và cấu hình iptables

```bash
# Bật IP Forwarding vĩnh viễn
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Kiểm tra
cat /proc/sys/net/ipv4/ip_forward   # Output: 1

# Tìm tên card mạng Bridged
ip route | grep default
# Ví dụ: default via 192.168.1.1 dev enp0s3
# → Card Bridged là enp0s3

# Cho phép VPN traffic vào
sudo iptables -A INPUT -p udp --dport 1194 -j ACCEPT

# Forward traffic qua tunnel
sudo iptables -A FORWARD -i tun0 -j ACCEPT
sudo iptables -A FORWARD -o tun0 -j ACCEPT

# NAT: traffic từ VPN (10.8.0.x) ra ngoài qua card Bridged (enp0s3)
sudo iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o enp0s3 -j MASQUERADE

# Lưu iptables rules
sudo apt install iptables-persistent -y
sudo netfilter-persistent save
```

### Lab 9: Khởi động VPN Server

```bash
sudo mkdir -p /var/log/openvpn

# Khởi động
sudo systemctl start openvpn-server@server
sudo systemctl enable openvpn-server@server

# Kiểm tra trạng thái
sudo systemctl status openvpn-server@server

# Kiểm tra interface tun0
ip addr show tun0
# Output: inet 10.8.0.1/24

# Kiểm tra port đang lắng nghe
sudo ss -ulnp | grep 1194
# Output: udp UNCONN 0 0 0.0.0.0:1194

# Xem log
sudo tail -20 /var/log/openvpn/openvpn.log
```

**Output thành công:**
```
Apr 28 20:00:00 vpn-server openvpn[1234]: TUN/TAP device tun0 opened
Apr 28 20:00:00 vpn-server openvpn[1234]: Initialization Sequence Completed
```

---

## 5. Cấu hình VPN Client

### Lab 10: Tạo file .ovpn trên Server

Script tạo file `.ovpn` all-in-one cho nhân viên:

```bash
# === Trên VM1 (vpn-server) ===
cat > ~/make-ovpn.sh << 'EOF'
#!/bin/bash
CLIENT=$1
EASY_RSA=~/easy-rsa
SERVER_IP="192.168.1.15"    # IP Bridged của server
OUTPUT=~/${CLIENT}.ovpn

cat > $OUTPUT << OVPN
client
dev tun
proto udp
remote ${SERVER_IP} 1194
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

# Tạo file .ovpn cho nhanvien1
~/make-ovpn.sh nhanvien1
ls -la ~/nhanvien1.ovpn
```

### Lab 11: Copy file .ovpn về Client

```bash
# === Từ VM2 (vpn-client) ===
# Client NAT có thể scp về vì VirtualBox NAT cho phép outbound

scp user@192.168.1.15:~/nhanvien1.ovpn ~/

# Kiểm tra
ls -la ~/nhanvien1.ovpn
head -5 ~/nhanvien1.ovpn
```

> **Giải thích:** `scp` từ client NAT (10.0.2.15) đến server Bridged (192.168.1.15) hoạt động được vì VirtualBox NAT cho phép VM kết nối **ra ngoài** tự do — giống như bạn SSH từ nhà vào máy chủ công ty.

### Lab 12: Kết nối VPN từ Client

```bash
# === Trên VM2 (vpn-client) ===

# Kết nối VPN (foreground để xem log)
sudo openvpn --config ~/nhanvien1.ovpn

# Hoặc chạy nền với systemd
sudo mkdir -p /etc/openvpn/client
sudo cp ~/nhanvien1.ovpn /etc/openvpn/client/nhanvien1.conf
sudo systemctl start openvpn-client@nhanvien1
sudo systemctl enable openvpn-client@nhanvien1

# Kiểm tra trạng thái
sudo systemctl status openvpn-client@nhanvien1
```

**Output kết nối thành công:**
```
TUN/TAP device tun0 opened
/sbin/ip addr add dev tun0 10.8.0.2/24
Initialization Sequence Completed
```

---

## 6. Kiểm tra và xác nhận

### Lab 13: Xác nhận VPN hoạt động

```bash
# === Từ VM2 (vpn-client) sau khi kết nối VPN ===

# 1. Kiểm tra IP VPN đã được cấp
ip addr show tun0
# Output: inet 10.8.0.2/24 scope global tun0

# 2. Kiểm tra bảng routing
ip route
# Phải thấy:
#   10.8.0.0/24 dev tun0          ← VPN subnet
#   192.168.1.0/24 via 10.8.0.1  ← Mạng văn phòng qua VPN

# 3. Ping đến VPN server qua tunnel
ping 10.8.0.1
# Phải thành công — đây là IP tunnel của server

# 4. Ping đến mạng văn phòng (192.168.1.x) qua VPN
ping 192.168.1.15
# Traffic đi QUA tunnel, không đi trực tiếp

# 5. Kiểm tra traffic có thực sự đi qua tunnel không
traceroute 192.168.1.15
# Output phải thấy: 10.8.0.1 (tunnel) trước, rồi mới đến 192.168.1.15
```

### Lab 14: Quan sát traffic thực tế (tcpdump)

```bash
# === Mở 2 terminal trên VM2 ===

# Terminal 1: Bắt traffic trên card vật lý (thấy gói tin MÃ HÓA)
sudo tcpdump -i eth0 -n port 1194
# Output: UDP packets đến 192.168.1.15:1194 — không đọc được nội dung

# Terminal 2: Bắt traffic trên tunnel (thấy gói tin GỐC)
sudo tcpdump -i tun0 -n
# Output: ICMP, TCP... traffic bình thường — đây là nội dung thật trong tunnel

# Thử ping từ terminal khác và quan sát sự khác biệt
ping 10.8.0.1
```

> **Điểm học quan trọng:**
> - `tcpdump -i eth0 port 1194` → thấy gói UDP mã hóa → **kẻ tấn công nhìn thấy cái này**
> - `tcpdump -i tun0` → thấy data thật → **chỉ có client và server biết**

### Lab 15: Test Full Tunnel (toàn bộ traffic qua VPN)

Thêm vào `server.conf` để **tất cả traffic internet** của nhân viên đi qua VPN:

```bash
# === Trên VM1 (vpn-server) ===
sudo nano /etc/openvpn/server/server.conf
```

```conf
# Thêm dòng này: route toàn bộ internet traffic qua VPN
push "redirect-gateway def1 bypass-dhcp"
```

```bash
sudo systemctl restart openvpn-server@server

# === Từ VM2 (vpn-client): Kiểm tra sau khi kết nối lại ===
# IP public bây giờ phải là IP của server (192.168.1.15)
curl https://api.ipify.org
# Hoặc
curl ifconfig.me
```

---

## 7. Quản lý Client

### 7.1 Thêm nhân viên mới

```bash
# === Trên VM1 (vpn-server) ===
cd ~/easy-rsa

# Tạo chứng chỉ
./easyrsa build-client-full nhanvien3 nopass

# Tạo file .ovpn
~/make-ovpn.sh nhanvien3

# Gửi file cho nhân viên (qua email, SCP, USB...)
ls ~/nhanvien3.ovpn
```

### 7.2 Cấp IP cố định cho nhân viên

```bash
# Tạo thư mục CCD (Client Config Directory)
sudo mkdir -p /etc/openvpn/server/ccd

# Cấp IP cố định cho nhanvien1
sudo nano /etc/openvpn/server/ccd/nhanvien1
```

```conf
ifconfig-push 10.8.0.10 255.255.255.0
```

```bash
# Thêm vào server.conf
echo "client-config-dir /etc/openvpn/server/ccd" | \
  sudo tee -a /etc/openvpn/server/server.conf

sudo systemctl restart openvpn-server@server
```

### 7.3 Thu hồi quyền nhân viên nghỉ việc

```bash
cd ~/easy-rsa

# Thu hồi chứng chỉ
./easyrsa revoke nhanvien2
# Nhập "yes" + CA passphrase

# Cập nhật CRL
./easyrsa gen-crl
sudo cp pki/crl.pem /etc/openvpn/server/

# Kích hoạt CRL trên server (chỉ làm 1 lần)
grep -q "crl-verify" /etc/openvpn/server/server.conf || \
  echo "crl-verify /etc/openvpn/server/crl.pem" | \
  sudo tee -a /etc/openvpn/server/server.conf

sudo systemctl reload openvpn-server@server

# Kiểm tra: nhanvien2 kết nối lại sẽ bị từ chối
# Log: TLS Error: certificate verify failed
```

### 7.4 Theo dõi nhân viên đang kết nối

```bash
# Xem ai đang kết nối VPN
sudo cat /var/log/openvpn/openvpn-status.log

# Output mẫu:
# CLIENT LIST
# nhanvien1,192.168.1.5:51234,12345,67890,Mon Apr 28 20:00:00 2026
#
# ROUTING TABLE
# 10.8.0.10,nhanvien1,192.168.1.5:51234,...

# Theo dõi realtime
watch -n 5 'sudo cat /var/log/openvpn/openvpn-status.log'

# Xem log kết nối/ngắt kết nối
sudo grep "Peer Connection\|SIGTERM" /var/log/openvpn/openvpn.log
```

---

## 8. Troubleshooting

### 8.1 Các lỗi thường gặp

| Lỗi | Nguyên nhân | Giải pháp |
|---|---|---|
| `TLS handshake failed` | Cert sai hoặc ta.key không khớp | Kiểm tra `key-direction` trong .ovpn |
| `Connection refused` | Server chưa chạy hoặc sai IP/port | Kiểm tra `systemctl status openvpn-server@server` |
| Client không ping được 192.168.1.x | Thiếu `push "route ..."` hoặc ip_forward=0 | Kiểm tra server.conf và `/proc/sys/net/ipv4/ip_forward` |
| `Certificate verify failed` | Cert đã bị revoke | Tạo cert mới cho client |
| scp từ client không được | Client chưa cài openssh-client | `sudo apt install openssh-client` |
| Bridged VM không có internet | Sai gateway trong netplan | Đảm bảo `via` đúng IP router nhà |

### 8.2 Checklist debug

```bash
# === Trên VM1 (vpn-server) ===

# 1. Server có đang chạy không?
sudo systemctl status openvpn-server@server

# 2. Port 1194 có đang mở không?
sudo ss -ulnp | grep 1194

# 3. Interface tun0 có tồn tại không?
ip addr show tun0

# 4. IP Forwarding có bật không?
cat /proc/sys/net/ipv4/ip_forward   # Phải là 1

# 5. iptables có đúng không?
sudo iptables -L FORWARD -n
sudo iptables -t nat -L POSTROUTING -n

# 6. Xem log lỗi
sudo tail -50 /var/log/openvpn/openvpn.log | grep -i "error\|warn"
```

```bash
# === Trên VM2 (vpn-client) ===

# 1. Client có đến được server không? (trước khi kết nối VPN)
ping 192.168.1.15

# 2. VPN đang chạy không?
sudo systemctl status openvpn-client@nhanvien1

# 3. Interface tun0 có tồn tại không?
ip addr show tun0

# 4. Route có đúng không?
ip route | grep -E "tun0|10.8"

# 5. Xem log kết nối
sudo journalctl -u openvpn-client@nhanvien1 -n 30
```

### 8.3 Các lệnh hay dùng

```bash
# Xem trạng thái server
sudo systemctl status openvpn-server@server

# Xem nhân viên đang kết nối
sudo cat /var/log/openvpn/openvpn-status.log

# Theo dõi log realtime
sudo tail -f /var/log/openvpn/openvpn.log

# Đo băng thông qua VPN
sudo apt install iperf3 -y
# Server: iperf3 -s
# Client: iperf3 -c 10.8.0.1

# Backup toàn bộ PKI
BACKUP_DATE=$(date +%Y%m%d)
sudo tar -czf ~/vpn-backup-${BACKUP_DATE}.tar.gz ~/easy-rsa/pki/ /etc/openvpn/
```

---

## Tổng kết

### Kiến trúc đã xây dựng

```
[Nhân viên tại nhà]              [Internet/WAN]           [Văn phòng - VPN Gateway]
vpn-client (VM NAT)                                        vpn-server (VM Bridged)
10.0.2.15                                                  192.168.1.15
tun0: 10.8.0.2                                             tun0: 10.8.0.1
    │                                                           │
    └─────── UDP 1194 (AES-256-GCM encrypted) ─────────────────┘
                                                               │
                                                    Mạng văn phòng: 192.168.1.0/24
```

### Checklist hoàn thành

- [ ] Server Bridged có IP tĩnh 192.168.1.15
- [ ] PKI khởi tạo đầy đủ (CA, server cert, client cert, DH, TLS key)
- [ ] Server lắng nghe trên UDP 1194
- [ ] IP Forwarding = 1 trên server
- [ ] iptables MASQUERADE cho phép VPN traffic ra internet
- [ ] Client có file .ovpn hợp lệ
- [ ] Client kết nối thành công, nhận IP 10.8.0.x
- [ ] Client ping được 192.168.1.15 qua tunnel
- [ ] CRL kích hoạt để có thể revoke cert

---

*Phiên bản: 2.0 | Mô hình: Remote Access (Home Office → Văn phòng)*
*Hệ điều hành: Ubuntu Server 22.04 LTS | VirtualBox 6.1+*
