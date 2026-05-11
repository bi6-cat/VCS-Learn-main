# Firewall & VPN – Lý Thuyết và Thực Hành Chuyên Sâu

---

## PHẦN 1: FIREWALL

---

## 1.1 Khái Niệm Firewall

### Định nghĩa
**Firewall** (tường lửa) là một hệ thống bảo mật mạng – có thể là phần cứng, phần mềm, hoặc kết hợp cả hai – được đặt giữa mạng nội bộ (trusted network) và mạng bên ngoài (untrusted network, thường là Internet) nhằm kiểm soát và lọc luồng lưu lượng mạng dựa trên tập hợp các quy tắc bảo mật (security rules/policies).

> **Mục tiêu cốt lõi**: Cho phép hoặc từ chối lưu lượng mạng dựa trên policy được định nghĩa trước, nhằm bảo vệ tài nguyên nội bộ khỏi các truy cập trái phép.

### Chức năng chính
| Chức năng | Mô tả |
|---|---|
| **Packet Filtering** | Kiểm tra header của gói tin và cho phép/từ chối |
| **Stateful Inspection** | Theo dõi trạng thái kết nối (connection state) |
| **NAT/PAT** | Chuyển đổi địa chỉ IP, ẩn topology nội bộ |
| **Application Control** | Kiểm soát ứng dụng ở Layer 7 |
| **Logging & Monitoring** | Ghi nhật ký, cảnh báo sự kiện bảo mật |
| **VPN Termination** | Kết thúc các tunnel VPN |

### Vị trí trong mô hình OSI
- **Layer 3 (Network)**: Lọc theo IP nguồn/đích
- **Layer 4 (Transport)**: Lọc theo port, giao thức TCP/UDP
- **Layer 7 (Application)**: Kiểm tra nội dung, phân tích giao thức ứng dụng (Next-Gen Firewall)

---

## 1.2 Hoạt Động Cơ Bản Của Firewall

### Nguyên tắc xử lý gói tin

```
Gói tin đến
      │
      ▼
┌─────────────────┐
│  Kiểm tra Rule  │──► Khớp Rule 1? ──► ALLOW / DENY
│   (Top-Down)    │
│                 │──► Khớp Rule 2? ──► ALLOW / DENY
│                 │
│                 │──► ... (tiếp tục)
│                 │
│                 │──► Không khớp    ──► Default Policy
└─────────────────┘
```

**Nguyên tắc quan trọng**:
- Rules được đánh giá **từ trên xuống dưới** (top-down)
- Rule đầu tiên khớp sẽ được áp dụng, các rule sau bị bỏ qua
- **Default policy** (implicit deny) áp dụng khi không có rule nào khớp

### Stateful vs Stateless

#### Stateless Firewall
- Xem xét từng gói tin **độc lập**, không nhớ trạng thái kết nối
- Nhanh nhưng kém linh hoạt
- Dễ bị bypass bằng các kỹ thuật như IP spoofing

```
Gói tin A (SYN)  → Kiểm tra rule → ALLOW
Gói tin B (ACK)  → Kiểm tra rule → ALLOW (độc lập, không biết SYN trước đó)
```

#### Stateful Firewall (State Table / Connection Tracking)
- Duy trì **bảng trạng thái** (state table) cho mỗi kết nối
- Theo dõi toàn bộ phiên TCP/UDP
- Chỉ cần cho phép kết nối chiều đi, chiều về tự động được phép

```
Connection Table:
┌────────────────┬──────────────┬──────┬──────┬────────┐
│ Src IP:Port    │ Dst IP:Port  │ Proto│ State│ Timeout│
├────────────────┼──────────────┼──────┼──────┼────────┤
│ 192.168.1.10:  │ 8.8.8.8:80  │ TCP  │ ESTAB│ 3600s  │
│   45231        │              │      │      │        │
└────────────────┴──────────────┴──────┴──────┴────────┘
```

**Các trạng thái kết nối** (trong iptables/netfilter):
- `NEW` – Gói tin bắt đầu một kết nối mới
- `ESTABLISHED` – Gói tin thuộc kết nối đã được thiết lập
- `RELATED` – Gói tin liên quan đến kết nối (vd: FTP data)
- `INVALID` – Gói tin không thuộc kết nối nào

---

## 1.3 Các Loại Firewall

### 1. Packet Filtering Firewall (Thế hệ 1)
- Hoạt động ở **Layer 3 & 4**
- Lọc dựa vào: IP nguồn, IP đích, Port nguồn, Port đích, Protocol
- **Ưu điểm**: Hiệu năng cao, đơn giản
- **Nhược điểm**: Không kiểm tra nội dung, không nhớ trạng thái

### 2. Stateful Inspection Firewall (Thế hệ 2)
- Theo dõi **trạng thái kết nối** TCP/UDP
- Kiểm tra tính hợp lệ của gói tin trong bối cảnh toàn phiên
- **Ưu điểm**: Bảo mật hơn, chống được nhiều loại tấn công hơn
- **Nhược điểm**: Tốn tài nguyên hơn stateless

### 3. Application Layer Firewall / Proxy Firewall (Thế hệ 3)
- Hoạt động ở **Layer 7**
- Đứng làm trung gian (proxy) giữa client và server
- Phân tích nội dung HTTP, FTP, DNS, SMTP...
- **Ưu điểm**: Kiểm soát chi tiết đến mức ứng dụng
- **Nhược điểm**: Latency cao, tốn tài nguyên

### 4. Next-Generation Firewall – NGFW (Thế hệ 4)
- Tích hợp **tất cả các thế hệ trước** + thêm:
  - **IDS/IPS** tích hợp
  - **Deep Packet Inspection (DPI)**
  - **Application Awareness** (nhận diện ứng dụng không phụ thuộc port)
  - **User Identity Awareness** (kiểm soát theo user, không chỉ IP)
  - **SSL/TLS Inspection**
  - **Threat Intelligence** tích hợp
- Ví dụ: Palo Alto, Fortinet FortiGate, Cisco Firepower, Check Point

### 5. Web Application Firewall – WAF
- Chuyên bảo vệ **ứng dụng web**
- Chống: SQL Injection, XSS, CSRF, Path Traversal, OWASP Top 10
- Ví dụ: ModSecurity, AWS WAF, Cloudflare WAF

### 6. Cloud Firewall / Firewall-as-a-Service (FWaaS)
- Triển khai trên nền tảng cloud
- Bảo vệ workload cloud-native
- Ví dụ: AWS Security Groups, Azure Firewall, GCP Cloud Armor

---

## 1.4 Các Cấu Trúc Firewall

### 1. Screening Router (Packet Filtering Router)
```
Internet ──── [Router/Firewall] ──── LAN nội bộ
```
- Đơn giản nhất
- Router kiêm luôn chức năng lọc gói
- Phù hợp mạng nhỏ, ngân sách thấp

### 2. Dual-Homed Host (Bastion Host)
```
Internet ──── [Bastion Host] ──── LAN nội bộ
                (2 NIC)
```
- Máy chủ có 2 card mạng, đứng ở giữa
- IP forwarding bị tắt, buộc tất cả traffic đi qua proxy
- Nếu bastion host bị compromise → toàn bộ mạng nội bộ bị lộ

### 3. Screened Host
```
Internet ──── [Screening Router] ──── [Bastion Host] ──── LAN
```
- Kết hợp packet filtering router + bastion host
- Hai lớp bảo vệ
- Traffic từ Internet chỉ được phép đến Bastion Host

### 4. Screened Subnet / DMZ Architecture (Phổ biến nhất)
```
Internet ──── [Outer FW] ──── DMZ ──── [Inner FW] ──── LAN
                               │
                    [Web Server, Mail Server, DNS]
```
- **DMZ** (Demilitarized Zone): vùng trung gian chứa server public
- **Outer Firewall**: lọc traffic từ Internet vào DMZ
- **Inner Firewall**: bảo vệ LAN nội bộ khỏi DMZ
- Kẻ tấn công phải vượt qua 2 tường lửa để tiếp cận LAN

### 5. High Availability Firewall (Active-Passive / Active-Active)
```
                      ┌─[FW-Active]─┐
Internet ─────────────┤             ├──── LAN
                      └─[FW-Passive]┘
                         (Standby)
```
- **Active-Passive**: FW chính xử lý traffic, FW dự phòng failover tự động
- **Active-Active**: Cả hai FW đều xử lý traffic, cân bằng tải
- Sử dụng giao thức VRRP/HSRP để failover

---

## 1.5 Triển Khai Firewall Trong Thực Tế (Phân Zone, Policy)

### Phân vùng mạng (Network Zones/Segmentation)

| Zone | Mức độ tin cậy | Mô tả |
|---|---|---|
| **Untrust** (WAN) | 0 | Internet, hoàn toàn không tin cậy |
| **DMZ** | 50 | Vùng máy chủ công khai |
| **Trust** (LAN) | 100 | Mạng nội bộ, tin cậy cao |
| **Management** | 100 | Vùng quản trị thiết bị |

### Nguyên tắc thiết kế Policy

**1. Principle of Least Privilege (Đặc quyền tối thiểu)**
- Chỉ cho phép những gì thực sự cần thiết
- Mặc định từ chối tất cả (`deny all`)

**2. Default Deny**
```
# Tất cả policy đều kết thúc bằng implicit deny
allow specific_rule_1
allow specific_rule_2
DENY ALL (implicit)
```

**3. Policy Matrix điển hình**

| Từ → Đến | Untrust | DMZ | Trust |
|---|---|---|---|
| **Untrust** | - | HTTP/HTTPS, SMTP | ❌ |
| **DMZ** | ❌ | - | DB queries (giới hạn) |
| **Trust** | HTTP/HTTPS | SSH, RDP (quản trị) | - |

### Quy trình triển khai thực tế

```
1. Xác định yêu cầu bảo mật (Security Requirements)
   ↓
2. Thiết kế sơ đồ mạng & phân vùng zone
   ↓
3. Xác định traffic flow cần thiết
   ↓
4. Viết firewall policy (least privilege)
   ↓
5. Kiểm tra & test policy (staging)
   ↓
6. Triển khai lên production
   ↓
7. Giám sát log và tinh chỉnh
```

### Ví dụ Policy thực tế (Pseudo-code)

```
# Cho phép Internet truy cập Web Server trong DMZ
ALLOW  src=0.0.0.0/0     dst=203.0.113.10  port=80,443  proto=TCP

# Cho phép LAN truy cập Internet
ALLOW  src=192.168.1.0/24 dst=0.0.0.0/0   port=80,443  proto=TCP

# Cho phép LAN quản trị DMZ qua SSH
ALLOW  src=192.168.1.100  dst=DMZ_zone    port=22      proto=TCP

# Chặn DMZ truy cập LAN (bảo vệ lateral movement)
DENY   src=DMZ_zone      dst=192.168.1.0/24

# Mặc định: chặn tất cả
DENY   ALL
```

---

## 1.6 Thực Hành Trên iptables

### Kiến trúc Netfilter/iptables

```
                    ┌─────────────────────────────────┐
Gói tin đến ──────► │ PREROUTING                      │
                    │ (nat: DNAT)                      │
                    └───────────┬─────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Routing Decision    │
                    └──────┬────────┬───────┘
                           │        │
               ┌───────────▼──┐  ┌──▼──────────────┐
               │    INPUT     │  │    FORWARD       │
               │  (filter)    │  │   (filter)       │
               └───────┬──────┘  └──────┬───────────┘
                       │                │
               ┌───────▼──────┐  ┌──────▼───────────┐
               │  Local       │  │   POSTROUTING     │
               │  Process     │  │  (nat: SNAT/MASQ) │
               └───────┬──────┘  └──────────────────┘
                       │
               ┌───────▼──────┐
               │   OUTPUT     │
               │  (filter)    │
               └──────────────┘
```

### Các bảng (Tables) trong iptables

| Bảng | Mô tả | Chains |
|---|---|---|
| **filter** | Lọc gói tin (mặc định) | INPUT, FORWARD, OUTPUT |
| **nat** | Chuyển đổi địa chỉ | PREROUTING, POSTROUTING, OUTPUT |
| **mangle** | Chỉnh sửa header gói tin | Tất cả chains |
| **raw** | Xử lý trước connection tracking | PREROUTING, OUTPUT |

### Cú pháp cơ bản

```bash
iptables [-t table] COMMAND [chain] [matches] [target]
```

**Các COMMAND thông dụng**:
- `-A` : Append rule vào cuối chain
- `-I` : Insert rule vào đầu chain (hoặc vị trí chỉ định)
- `-D` : Xóa rule
- `-F` : Flush (xóa tất cả rule trong chain)
- `-L` : List các rule
- `-P` : Set default policy
- `-n` : Hiển thị dạng numeric (không resolve DNS)
- `-v` : Verbose (hiển thị chi tiết)

### Thực hành cơ bản

#### Bước 1: Xem trạng thái hiện tại
```bash
# Xem tất cả rule
iptables -L -n -v

# Xem table nat
iptables -t nat -L -n -v

# Xem với số thứ tự rule
iptables -L --line-numbers
```

#### Bước 2: Đặt Default Policy
```bash
# Chặn tất cả mặc định (sau khi đã có các rule allow)
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT
```

#### Bước 3: Cho phép loopback và established connections
```bash
# Loopback interface
iptables -A INPUT -i lo -j ACCEPT

# Kết nối đã established/related
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
```

#### Bước 4: Cho phép SSH (tránh bị lock out)
```bash
# Cho phép SSH từ mọi nơi
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Cho phép SSH chỉ từ IP cụ thể (an toàn hơn)
iptables -A INPUT -p tcp -s 192.168.1.100 --dport 22 -j ACCEPT
```

#### Bước 5: Cho phép HTTP/HTTPS
```bash
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

#### Bước 6: Cho phép ICMP (ping)
```bash
iptables -A INPUT -p icmp --icmp-type echo-request -j ACCEPT
```

#### Bước 7: Chặn IP cụ thể
```bash
# Chặn một IP
iptables -A INPUT -s 10.0.0.5 -j DROP

# Chặn một dải IP
iptables -A INPUT -s 10.0.0.0/8 -j DROP
```

#### Bước 8: Rate Limiting (chống brute force)
```bash
# Giới hạn SSH: tối đa 3 kết nối/phút, burst 5
iptables -A INPUT -p tcp --dport 22 -m state --state NEW \
  -m limit --limit 3/min --limit-burst 5 -j ACCEPT
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -j DROP
```

#### Bước 9: NAT – Masquerade (SNAT)
```bash
# Cho phép LAN ra Internet qua interface eth0
iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE

# Bật IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward
# Hoặc thêm vào /etc/sysctl.conf:
# net.ipv4.ip_forward = 1
```

#### Bước 10: Port Forwarding (DNAT)
```bash
# Chuyển hướng port 80 trên eth0 đến server nội bộ
iptables -t nat -A PREROUTING -i eth0 -p tcp --dport 80 \
  -j DNAT --to-destination 192.168.1.10:80
```

### Lưu và khôi phục rules

```bash
# Lưu rules (Debian/Ubuntu)
iptables-save > /etc/iptables/rules.v4

# Lưu rules (CentOS/RHEL)
service iptables save
# hoặc
iptables-save > /etc/sysconfig/iptables

# Khôi phục rules
iptables-restore < /etc/iptables/rules.v4
```

### Script iptables hoàn chỉnh (ví dụ thực tế)

```bash
#!/bin/bash
# Simple Firewall Script

# Xóa tất cả rule cũ
iptables -F
iptables -X
iptables -t nat -F
iptables -t nat -X

# Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Loopback
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

# Established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# SSH (rate limited)
iptables -A INPUT -p tcp --dport 22 -m state --state NEW \
  -m limit --limit 3/min --limit-burst 5 -j ACCEPT

# HTTP/HTTPS
iptables -A INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT

# ICMP
iptables -A INPUT -p icmp --icmp-type echo-request \
  -m limit --limit 1/s -j ACCEPT

# Log và drop những gì còn lại
iptables -A INPUT -m limit --limit 5/min -j LOG \
  --log-prefix "iptables DROP: " --log-level 7
iptables -A INPUT -j DROP

echo "Firewall rules applied!"
```

---

## 1.7 Kiểm Thử, Giám Sát và Xử Lý Sự Cố (Troubleshooting)

### Kiểm thử (Testing)
Sau khi triển khai firewall, việc kiểm thử là bắt buộc trước khi đưa vào hoạt động chính thức (Production).
- **Kiểm tra kết nối (Connectivity Test):** Sử dụng `ping`, `traceroute`, `telnet`, `nc` (netcat) hoặc `curl` để đảm bảo luồng traffic hợp lệ có thể đi qua và luồng không hợp lệ bị chặn đúng như cấu hình (ví dụ: truy cập web server từ ngoài vào OK, nhưng SSH từ ngoài vào thì DROP).
- **Quét lỗ hổng (Vulnerability Scanning):** Dùng các công cụ như Nmap để quét các port đang mở, đảm bảo không có port nào bị lộ một cách không mong muốn.

### Giám sát (Monitoring & Logging)
- Firewall phải luôn cấu hình tính năng ghi nhật ký (logging) cho các hành động quan trọng (đặc biệt là các gói tin bị DROP/REJECT), nhưng cần có cơ chế giới hạn (rate limiting) để tránh bị tràn bộ nhớ (buffer).
- Thông qua các công cụ giám sát (SIEM, syslog), quản trị viên hệ thống có thể theo dõi lượng lưu lượng (bandwidth), phát hiện sớm các dấu hiệu quá tải, hoặc phát hiện các kiểu quét mạng đang nhắm vào hệ thống.

### Xử lý sự cố chung (Troubleshooting Workflow)
1. **Kiểm tra Rule:** Soát lại toàn bộ các Rule từ trên xuống dưới (Top-down) đảm bảo luồng mong muốn chưa bị match bởi một rule DENY/DROP nào đó chặn ngang trước.
2. **Kiểm tra NAT (nếu có):** Hầu hết các lỗi truy cập mạng liên quan đến dịch vụ nội bộ (LAN) ra Internet là do cấu hình SNAT (Masquerade) sai, hoặc cấu hình DNAT (Port Forwarding) sai interface.
3. **Phân tích Log/Traffic Capture:** Đọc file log tương ứng (`/var/log/syslog` hoặc kern.log) hoặc dùng `tcpdump`/`wireshark` tại interface để xem gói tin có đi đến firewall và được firewall xử lý đúng hay chưa.

---

## 1.8 Ưu Nhược Điểm Và Khi Nào Sử Dụng Từng Loại Firewall

| Loại Firewall | Ưu điểm | Nhược điểm | Use case (Khi nào dùng) |
|---|---|---|---|
| **Packet Filtering (Stateless)** | Xử lý cực nhanh, tốn ít tài nguyên. | Bảo mật yếu, không kiểm soát được phiên kết nối. | Dùng làm lớp bảo vệ ngoài cùng cho hệ thống có lưu lượng siêu cường, danh sách đen (Blacklist IP/Port). |
| **Stateful Inspection** | Đảm bảo an toàn cơ bản, ruleset đơn giản, phòng chống spoofing tốt. | Không phân tích nội dung bên trong gói tin, rủi ro đầy bảng trạng thái. | Bảo vệ vòng ngoài cấp cơ bản tại biên mạng (LAN-Internet) các doanh nghiệp nhỏ / cá nhân. |
| **Application Layer / Proxy** | Kiểm soát nội dung sâu ở tầng trên cùng (ngăn user vô web độc, chặn app... cực chính xác). | Gây ra độ trễ cao, bóp băng thông lớn, xử lý cồng kềnh. | Bảo vệ, soi duyệt traffic truy cập các dịch vụ rủi ro cao hoặc môi trường cần quản lý lướt web (proxy cơ quan). |
| **NGFW** | Đa lớp "All in one" (có IPS, nhận dạng app, kiểm duyệt payload mã độc). Giao diện quản trị thông minh. | Tốn nhiều chi phí (vận hành, thiết bị, license), phức tạp để build chuẩn rulesystem. | Doanh nghiệp lớn, ngân hàng, khối Data Center có ngân sách và cần kiểm soát tối đa các nguy cơ hiện đại. |
| **WAF** | Hiểu chuyên sâu ngôn ngữ protocol Web (HTTP/HTTPS), cực tốt trong phòng thủ web vulnerabilities (XSS, SQLi). | Chỉ phục vụ riêng được mỗi web application, không làm Firewall đa dụng được. | Đặt trực tiếp trước máy chủ Web, Portal doanh nghiệp, hoặc thuê từ CDN (Cloudflare WAF). |

---

## PHẦN 2: VPN (Virtual Private Network)

---

## 2.1 Tìm Hiểu Về VPN

### Định nghĩa
**VPN (Virtual Private Network)** là công nghệ tạo ra một kênh kết nối mạng riêng tư (private) và bảo mật thông qua một mạng công cộng (thường là Internet), bằng cách sử dụng **mã hóa** và **xác thực** để đảm bảo tính bảo mật, toàn vẹn và riêng tư của dữ liệu.

```
[User/Site A] ══════════════════════════════ [User/Site B]
               ████ Encrypted Tunnel ████
               ──────────────────────────
                      Internet (Public)
```

### Mục tiêu của VPN

| Mục tiêu | Mô tả |
|---|---|
| **Confidentiality** | Mã hóa dữ liệu, kẻ tấn công không đọc được |
| **Integrity** | Đảm bảo dữ liệu không bị sửa đổi trong quá trình truyền |
| **Authentication** | Xác thực danh tính hai đầu kết nối |
| **Non-repudiation** | Không thể phủ nhận đã gửi/nhận dữ liệu |

### Các thành phần cơ bản của VPN

- **VPN Client**: Thiết bị/phần mềm khởi tạo kết nối VPN
- **VPN Gateway/Server**: Điểm kết thúc VPN tunnel
- **Tunnel**: Kênh mã hóa giữa hai đầu
- **Encryption Protocol**: Giao thức mã hóa (AES, 3DES...)
- **Authentication**: Xác thực (PSK, Certificate, OTP...)

---

## 2.2 Các Loại VPN

### 1. Site-to-Site VPN (LAN-to-LAN VPN)

```
┌────────────┐                              ┌────────────┐
│  Văn phòng │                              │  Văn phòng │
│   Hà Nội   │──[GW]──══Internet══──[GW]───│  HCM       │
│ 10.1.0.0/24│                              │10.2.0.0/24 │
└────────────┘                              └────────────┘
              ◄──────── VPN Tunnel ──────────►
```

**Đặc điểm:**
- Kết nối **cố định** giữa hai hoặc nhiều site
- Thiết lập ở cấp **gateway**, không cần cài phần mềm trên từng máy
- Toàn bộ traffic giữa các site đi qua tunnel
- **Use case**: Kết nối chi nhánh với trụ sở, kết nối datacenter

**Giao thức phổ biến**: IPSec, GRE over IPSec, OpenVPN

### 2. Remote Access VPN (Client-to-Site VPN)

```
┌──────────┐                            ┌────────────────┐
│ Nhân viên│──══Internet══──────────────│ VPN Gateway    │
│ WFH      │                            │ (HEAD Network)   │
│ (Client) │                            │ 192.168.1.0/24 │
└──────────┘                            └────────────────┘
            ◄──────── VPN Tunnel ──────►
```

**Đặc điểm:**
- Kết nối **theo yêu cầu** (on-demand) từ từng người dùng
- Cần cài **VPN client** trên thiết bị người dùng
- Người dùng được cấp IP thuộc dải mạng nội bộ
- **Use case**: Work from Home, truy cập tài nguyên nội bộ từ xa

**Giao thức phổ biến**: OpenVPN, SSL VPN, L2TP/IPSec, IKEv2

### 3. MPLS VPN (Multiprotocol Label Switching VPN)

```
┌──────┐    ┌─────┐  MPLS Core  ┌─────┐    ┌──────┐
│Site A│────│ PE  │─────────────│ PE  │────│Site B│
│      │    │     │   P─────P   │     │    │      │
└──────┘    └─────┘             └─────┘    └──────┘
            CE-PE link           PE-CE link
```

**Thành phần:**
- **CE (Customer Edge)**: Router của khách hàng
- **PE (Provider Edge)**: Router biên của nhà mạng
- **P (Provider)**: Router lõi của nhà mạng

**Đặc điểm:**
- Hoạt động ở **Layer 2.5** (giữa L2 và L3)
- Sử dụng **label** thay vì routing bình thường → hiệu năng cao
- **Phân tách traffic** logic giữa các khách hàng qua VRF (Virtual Routing and Forwarding)
- Nhà mạng quản lý toàn bộ, khách hàng không cần cấu hình phức tạp
- **Use case**: Enterprise WAN với SLA cao, MPLS L2/L3 VPN của ISP

**Phân loại MPLS VPN:**
- **MPLS L3 VPN** (RFC 4364): Dùng BGP VPNv4, mỗi VRF riêng biệt
- **MPLS L2 VPN**: VPWS (point-to-point), VPLS (multipoint)

---

## 2.3 Cơ Chế và Quá Trình Hoạt Động

### 2.3.1 Mã Hóa (Encryption)

#### Symmetric Encryption (Mã hóa đối xứng)
- Cùng một **key** cho mã hóa và giải mã
- **Nhanh**, phù hợp mã hóa dữ liệu bulk
- **Vấn đề**: Làm sao trao đổi key an toàn?

```
Plaintext + Key → [Encrypt] → Ciphertext → [Decrypt] + Key → Plaintext
```

Thuật toán: **AES-128, AES-256, 3DES, ChaCha20**

#### Asymmetric Encryption (Mã hóa bất đối xứng)
- **Public Key** mã hóa, **Private Key** giải mã
- **Chậm** hơn, dùng để trao đổi key và xác thực
- Giải quyết vấn đề trao đổi key

```
Sender: Plaintext + Recipient's Public Key → Ciphertext
Receiver: Ciphertext + Private Key → Plaintext
```

Thuật toán: **RSA-2048/4096, ECDSA, DH (Diffie-Hellman)**

#### Hybrid Encryption (Thực tế VPN dùng cách này)
```
1. Dùng Asymmetric (RSA/DH) để trao đổi Symmetric Key an toàn
2. Dùng Symmetric Key (AES) để mã hóa dữ liệu thực tế
```

#### Diffie-Hellman Key Exchange
```
Alice và Bob muốn chia sẻ secret mà không cần gặp nhau:
1. Chọn public parameters: p (prime), g (generator)
2. Alice: a (private) → A = g^a mod p (public)
3. Bob:   b (private) → B = g^b mod p (public)
4. Trao đổi A và B qua mạng (public)
5. Alice: S = B^a mod p
   Bob:   S = A^b mod p
→ S giống nhau! → Shared secret
```

DH Groups phổ biến: **DH Group 14 (2048-bit), Group 19/20 (ECDH 256/384-bit)**

### 2.3.2 Xác Thực (Authentication)

#### Pre-Shared Key (PSK)
- Cả hai bên cấu hình cùng một **chuỗi bí mật**
- Đơn giản nhưng khó quản lý khi có nhiều site
- Rủi ro nếu PSK bị lộ

```bash
# Ví dụ cấu hình IPSec PSK
crypto isakmp key MySecretKey123! address 203.0.113.1
```

#### Certificate-Based Authentication (PKI)
- Sử dụng **X.509 certificates** từ CA (Certificate Authority)
- Mỗi device/user có **certificate riêng**
- Scalable hơn PSK, dễ revoke
- **Quy trình**: CSR → CA Sign → Certificate

```
[VPN Client] → Gửi Certificate → [VPN Server]
              ← Verify nếu CA tin cậy ←
              ← Gửi Certificate lại ←
[VPN Client] → Verify Server Certificate →
              ← Mutual Authentication hoàn tất ←
```

#### Username/Password + OTP (Two-Factor Authentication)
- Kết hợp với **RADIUS, LDAP, Active Directory**
- OTP (One-Time Password): Google Authenticator, RSA SecurID
- Phổ biến trong Remote Access VPN

### 2.3.3 Chế Độ Làm Việc (Modes)

#### IPSec Modes

**Transport Mode**:
- Chỉ mã hóa **payload (data)**, giữ nguyên IP header gốc
- Dùng cho **host-to-host** communication
- Ít overhead hơn

```
Original IP Header | Encrypted [TCP Header | Data]
```

**Tunnel Mode**:
- Mã hóa **toàn bộ gói tin gốc** (cả IP header)
- Thêm **IP header mới** bên ngoài
- Dùng cho **gateway-to-gateway** (Site-to-Site VPN)

```
New IP Header | IPSec Header | Encrypted [Original IP | TCP | Data]
```

#### SSL/TLS VPN Modes

**Full Tunnel**: Tất cả traffic (kể cả Internet) đi qua VPN
```
User → [VPN Tunnel] → VPN Server → Internet (và LAN nội bộ)
```

**Split Tunnel**: Chỉ traffic nội bộ đi qua VPN, Internet đi thẳng
```
User → [VPN Tunnel] → VPN Server → LAN nội bộ
User → Internet (trực tiếp, không qua VPN)
```

### 2.3.4 Quá Trình Thiết Lập Phiên Kết Nối

#### IPSec IKE (Internet Key Exchange) - Hai Phase

**Phase 1: IKE SA (ISAKMP SA)**
```
Mục tiêu: Tạo kênh bảo mật để thương lượng IPSec SA

Bước 1: Negotiation
  - Two peers trao đổi proposals:
    * Encryption: AES-256
    * Hash: SHA-256
    * DH Group: 14
    * Authentication: PSK/Certificate
    * Lifetime: 86400 sec

Bước 2: DH Key Exchange
  - Tạo shared secret qua Diffie-Hellman

Bước 3: Authentication
  - Xác thực danh tính (PSK hoặc Certificate)

Kết quả: IKE SA được thiết lập (bidirectional)
```

**IKEv1 Modes:**
- **Main Mode** (6 messages): Bảo mật hơn, ẩn danh tính
- **Aggressive Mode** (3 messages): Nhanh hơn nhưng kém bảo mật

**Phase 2: IPSec SA (Quick Mode)**
```
Mục tiêu: Thương lượng IPSec SA (SA thực sự mang dữ liệu)

- Negotiation IPSec parameters:
  * Protocol: ESP hoặc AH
  * Encryption: AES-256-GCM
  * Hash: SHA-256
  * Lifetime: 3600 sec
  * PFS (Perfect Forward Secrecy): nếu cần

Kết quả: Hai unidirectional IPSec SA
  - SA1: A → B (inbound của B)
  - SA2: B → A (inbound của A)
  (Mỗi SA có SPI – Security Parameter Index)
```

**Sơ đồ tổng quát:**
```
Initiator                          Responder
    │                                  │
    │──── IKE_SA_INIT (proposal) ─────►│
    │◄─── IKE_SA_INIT (response) ──────│
    │                                  │
    │──── IKE_AUTH (identity+auth) ───►│
    │◄─── IKE_AUTH (response) ─────────│
    │                                  │
    │═══════ IKE SA Established ═══════│
    │                                  │
    │──── CREATE_CHILD_SA ────────────►│
    │◄─── CREATE_CHILD_SA response ────│
    │                                  │
    │══════ IPSec SA Established ══════│
    │                                  │
    │████████ Encrypted Data ██████████│
```

#### OpenVPN Handshake Process

```
Client                              Server
  │                                   │
  │──── TLS ClientHello ─────────────►│
  │◄─── TLS ServerHello + Certificate─│
  │──── Verify Certificate ──────────►│
  │──── Client Certificate (nếu có) ─►│
  │◄─── TLS Finished ─────────────────│
  │                                   │
  │══════ TLS Channel Established ════│
  │                                   │
  │──── Auth (username/password) ────►│
  │◄─── Auth OK ──────────────────────│
  │                                   │
  │◄─── IP Assignment (ifconfig) ─────│
  │◄─── Push routes ──────────────────│
  │                                   │
  │═══════ VPN Tunnel Active ═════════│
  │████████ Encrypted Data ███████████│
```

---

## 2.4 Thực Hành VPN Trên OpenVPN

### Kiến trúc OpenVPN

```
Client (tun0: 10.8.0.x)    Server (tun0: 10.8.0.1)
          │                          │
          └────── Encrypted ─────────┘
                UDP/TCP 1194
```

- **TUN interface** (tun): Layer 3, dùng cho IP routing
- **TAP interface** (tap): Layer 2, dùng cho bridging (ít phổ biến)
- **Port mặc định**: UDP 1194 (UDP nhanh hơn, TCP để bypass firewall)

### Cài đặt OpenVPN Server (Debian/Ubuntu)

```bash
# Cài đặt
sudo apt update
sudo apt install openvpn easy-rsa -y

# Tạo thư mục PKI
make-cadir ~/openvpn-ca
cd ~/openvpn-ca
```

### Thiết lập PKI với Easy-RSA

```bash
# Khởi tạo PKI
./easyrsa init-pki

# Tạo CA
./easyrsa build-ca nopass
# → Nhập Common Name: "VPN-CA"

# Tạo certificate và key cho server
./easyrsa gen-req server nopass
./easyrsa sign-req server server
# → Xác nhận: "yes"

# Tạo Diffie-Hellman parameters
./easyrsa gen-dh
# (Quá trình này mất vài phút)

# Tạo TLS auth key (chống DoS/DDoS, tăng bảo mật)
openvpn --genkey --secret ta.key

# Tạo certificate cho client
./easyrsa gen-req client1 nopass
./easyrsa sign-req client client1
```

### Cấu hình Server (server.conf)

```bash
# Sao chép file mẫu
sudo cp /usr/share/doc/openvpn/examples/sample-config-files/server.conf.gz /etc/openvpn/
sudo gzip -d /etc/openvpn/server.conf.gz
```

```ini
# /etc/openvpn/server.conf

# Network
port 1194
proto udp
dev tun

# Certificates
ca      /etc/openvpn/ca.crt
cert    /etc/openvpn/server.crt
key     /etc/openvpn/server.key   # Keep secret!
dh      /etc/openvpn/dh.pem

# TLS Auth (chống replay attack)
tls-auth /etc/openvpn/ta.key 0
key-direction 0

# Network settings
server 10.8.0.0 255.255.255.0  # VPN subnet
ifconfig-pool-persist ipp.txt  # Giữ IP cho client

# Đẩy route cho client
push "route 192.168.1.0 255.255.255.0"    # LAN nội bộ
push "redirect-gateway def1 bypass-dhcp"  # Full tunnel
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"

# Security
cipher AES-256-GCM
auth SHA256
tls-version-min 1.2

# Keep-alive
keepalive 10 120

# Compression (disable để tránh VORACLE attack)
;comp-lzo

# User privilege drop (security)
user nobody
group nogroup
persist-key
persist-tun

# Logging
status openvpn-status.log
log-append /var/log/openvpn.log
verb 3
```

### Bật IP Forwarding và Cấu hình NAT

```bash
# Bật IP forwarding
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p

# Xác định interface kết nối Internet
ip route | grep default
# → ví dụ: default via 203.0.113.1 dev eth0

# NAT cho VPN clients ra Internet
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE

# Cho phép traffic VPN
iptables -A INPUT -i tun+ -j ACCEPT
iptables -A FORWARD -i tun+ -j ACCEPT
iptables -A FORWARD -i tun+ -o eth0 -m state --state RELATED,ESTABLISHED -j ACCEPT
iptables -A FORWARD -i eth0 -o tun+ -m state --state RELATED,ESTABLISHED -j ACCEPT

# Lưu iptables rules
iptables-save > /etc/iptables/rules.v4
```

### Khởi động OpenVPN Server

```bash
# Khởi động service
sudo systemctl start openvpn@server
sudo systemctl enable openvpn@server

# Kiểm tra trạng thái
sudo systemctl status openvpn@server

# Xem log
sudo journalctl -u openvpn@server -f

# Kiểm tra interface tun0
ip addr show tun0
```

### Tạo File Cấu hình Client (.ovpn)

```bash
# Tạo script tự động tạo file client.ovpn
cat > ~/make_client.sh << 'EOF'
#!/bin/bash
CLIENT=$1
CA=$(cat /etc/openvpn/ca.crt)
CERT=$(cat ~/openvpn-ca/pki/issued/${CLIENT}.crt)
KEY=$(cat ~/openvpn-ca/pki/private/${CLIENT}.key)
TA=$(cat /etc/openvpn/ta.key)

cat > ~/${CLIENT}.ovpn << OVPN
client
dev tun
proto udp
remote YOUR_SERVER_IP 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-GCM
auth SHA256
key-direction 1
verb 3

<ca>
${CA}
</ca>
<cert>
${CERT}
</cert>
<key>
${KEY}
</key>
<tls-auth>
${TA}
</tls-auth>
OVPN
echo "Created: ~/${CLIENT}.ovpn"
EOF

chmod +x ~/make_client.sh
~/make_client.sh client1
```

### Kết nối từ Client

**Linux:**
```bash
# Cài OpenVPN client
sudo apt install openvpn -y

# Kết nối
sudo openvpn --config client1.ovpn

# Kiểm tra kết nối
ip addr show tun0
ping 10.8.0.1    # Ping VPN Server
curl ifconfig.me # Kiểm tra IP public (phải là IP của server nếu full tunnel)
```

**Windows:**
1. Download OpenVPN GUI từ https://openvpn.net/community-downloads/
2. Copy file `client1.ovpn` vào `C:\Program Files\OpenVPN\config\`
3. Right-click OpenVPN GUI → Connect

### Kiểm tra và Debug

```bash
# Xem danh sách clients đang kết nối
cat /etc/openvpn/openvpn-status.log

# Monitor traffic
tcpdump -i tun0 -n

# Test connectivity từ client
traceroute 192.168.1.1  # Trace qua VPN tunnel

# Xem log chi tiết trên server
tail -f /var/log/openvpn.log
```

### Revoke Certificate (Thu hồi quyền truy cập client)

```bash
cd ~/openvpn-ca

# Revoke certificate
./easyrsa revoke client1

# Tạo Certificate Revocation List (CRL)
./easyrsa gen-crl

# Copy CRL vào OpenVPN
sudo cp pki/crl.pem /etc/openvpn/

# Thêm vào server.conf:
# crl-verify /etc/openvpn/crl.pem

# Restart OpenVPN
sudo systemctl restart openvpn@server
```

---

## Tổng Kết & So Sánh

### So sánh các loại VPN

| Tiêu chí | Site-to-Site | Remote Access | MPLS VPN |
|---|---|---|---|
| **Người dùng** | Kết nối site-site | Người dùng cá nhân | Doanh nghiệp lớn |
| **Thiết lập** | Trên gateway | Trên từng máy | ISP quản lý |
| **Độ phức tạp** | Trung bình | Thấp-Trung | Cao |
| **Hiệu năng** | Tốt | Phụ thuộc Internet | Rất tốt (SLA) |
| **Chi phí** | Thấp | Thấp | Cao (thuê ISP) |
| **Bảo mật** | Cao | Trung bình-Cao | Cao |

### So sánh Firewall và VPN

| Khía cạnh | Firewall | VPN |
|---|---|---|
| **Mục tiêu** | Kiểm soát truy cập | Kết nối bảo mật |
| **Vị trí** | Biên mạng | Giữa các điểm đầu cuối |
| **Chức năng** | Lọc, chặn traffic | Mã hóa, tunnel |
| **Kết hợp** | Thường triển khai cùng nhau trên một thiết bị |

### Mô hình bảo mật kết hợp hoàn chỉnh

```
Internet
    │
[NGFW/Firewall]  ← Lọc traffic, IPS, DPI
    │
[DMZ]            ← Web, Mail, DNS servers
    │
[Inner Firewall] ← Bảo vệ LAN
    │
[LAN nội bộ]
    │
[VPN Gateway]    ← Remote users kết nối về đây
    │
[Remote Users, Branch Sites]
```

---

*Tài liệu này được biên soạn để phục vụ báo cáo học thuật về Firewall và VPN. Các lệnh thực hành được thực hiện trên môi trường Linux (Ubuntu/Debian). Một số chi tiết cấu hình có thể khác nhau tùy phiên bản phần mềm.*
