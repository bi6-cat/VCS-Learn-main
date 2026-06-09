# 🧱 PHẦN 1 — NỀN TẢNG HTTP & MẠNG

> **Tại sao phải học phần này trước?**  
> Nginx, HAProxy, Load Balancer đều hoạt động trên nền HTTP và TCP.  
> Nếu không hiểu HTTP/TCP, bạn chỉ đang **copy config mà không biết mình đang làm gì**.

---

## 1.1 HTTP Protocol

### HTTP là gì?

**HTTP (HyperText Transfer Protocol)** là giao thức tầng ứng dụng (Application Layer) dùng để trao đổi dữ liệu giữa client và server trên web.

**Mô hình hoạt động: Client-Server**

```
CLIENT (Browser/curl/app)          SERVER (Nginx/Apache/App)
         │                                    │
         │──── HTTP Request ────────────────→ │
         │                                    │  (xử lý request)
         │ ←─── HTTP Response ───────────── ──│
         │                                    │
```

- **Client** luôn là bên **khởi tạo** request
- **Server** luôn là bên **lắng nghe** và trả response
- Giao thức này là **request-response** — mỗi request có đúng 1 response
- HTTP chạy trên **TCP** (thường là port 80 cho HTTP, 443 cho HTTPS)

---

### Anatomy của HTTP Request

Khi bạn gõ `curl -v http://example.com/api/users` trong terminal:

```
GET /api/users HTTP/1.1          ← Request Line: [METHOD] [PATH] [HTTP version]
Host: example.com                ← Headers (key: value)
User-Agent: curl/7.81.0
Accept: */*
Connection: keep-alive
                                 ← Dòng trống (CRLF) = kết thúc headers
[body - thường rỗng với GET]     ← Body (chỉ có với POST, PUT, PATCH)
```

**Các HTTP Methods quan trọng:**

| Method | Dùng để | Idempotent? | Có body? |
|--------|---------|-------------|----------|
| GET    | Lấy data | ✅ Có | ❌ Không |
| POST   | Tạo mới | ❌ Không | ✅ Có |
| PUT    | Thay thế toàn bộ | ✅ Có | ✅ Có |
| PATCH  | Cập nhật một phần | ❌ Không | ✅ Có |
| DELETE | Xóa | ✅ Có | ❌ Không |
| HEAD   | Như GET nhưng không trả body | ✅ Có | ❌ Không |

> **Idempotent** = gọi nhiều lần cho kết quả giống nhau. Quan trọng khi retry.

---

### Anatomy của HTTP Response

```
HTTP/1.1 200 OK                  ← Status Line: [version] [status code] [reason]
Content-Type: application/json
Content-Length: 42
Date: Fri, 09 May 2026 15:00:00 GMT
Connection: keep-alive
                                 ← Dòng trống
{"id": 1, "name": "Quang"}       ← Body
```

**HTTP Status Codes — phân loại:**

| Range | Ý nghĩa | Ví dụ quan trọng |
|-------|---------|-----------------|
| 1xx | Informational | 101 Switching Protocols (WebSocket) |
| 2xx | Success | 200 OK, 201 Created, 204 No Content |
| 3xx | Redirect | 301 Permanent, 302 Temporary, 304 Not Modified |
| 4xx | Client Error | 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found |
| 5xx | Server Error | 500 Internal Error, 502 Bad Gateway, 503 Unavailable, 504 Timeout |

> **Với Load Balancer:** 502 = LB không kết nối được backend. 504 = backend trả lời quá chậm.

---

### HTTP/1.0 vs HTTP/1.1 vs HTTP/2 vs HTTP/3

#### HTTP/1.0 (1996)
- Mỗi request = **mở 1 TCP connection mới** → request xong là **đóng ngay**
- Rất chậm vì TCP handshake tốn thời gian

```
Client          Server
  │──SYN──────→│
  │←──SYN-ACK──│    ← TCP Handshake (3 bước)
  │──ACK───────→│
  │──GET /──────→│
  │←──200 OK────│
  │             │  ← Connection đóng ngay
```

#### HTTP/1.1 (1997) — Tiêu chuẩn lâu dài nhất
- **Keep-Alive mặc định**: TCP connection được **tái sử dụng** cho nhiều request
- **Pipelining**: Gửi nhiều request mà không cần chờ response (nhưng response phải theo thứ tự — **Head-of-Line Blocking**)
- **Chunked Transfer Encoding**: Trả data theo từng chunk, không cần biết Content-Length trước
- **Virtual Hosting**: Header `Host` bắt buộc → 1 IP có thể host nhiều domain

```
Client          Server
  │──TCP Handshake──│
  │──GET /index──→  │
  │←── 200 OK ──── │  ← Connection KHÔNG đóng
  │──GET /logo.png→ │  ← Tái sử dụng connection
  │←── 200 OK ──── │
  │──GET /style.css→│
  │←── 200 OK ──── │
```

#### HTTP/2 (2015)
- **Multiplexing**: Nhiều request/response **song song** trên **cùng 1 TCP connection**
- **Binary protocol**: Không phải text như HTTP/1.1 → parse nhanh hơn
- **Header Compression (HPACK)**: Headers được nén
- **Server Push**: Server chủ động gửi resource trước khi client hỏi
- **Vẫn dùng TCP** → vẫn có Head-of-Line Blocking ở TCP layer

#### HTTP/3 (2022)
- Dùng **QUIC** thay TCP (chạy trên UDP)
- **Loại bỏ Head-of-Line Blocking** hoàn toàn
- **0-RTT connection**: Kết nối nhanh hơn (không cần full handshake nếu đã biết server)
- Quan trọng cho **mobile** và mạng không ổn định

**Tóm tắt tại sao quan trọng với LB:**
> HTTP/2 multiplexing thay đổi cách LB đếm "connections". 1 HTTP/2 connection có thể chứa **hàng trăm stream** → LB "least connections" có thể không chính xác.

---

### Keep-Alive Connection

**Vấn đề với HTTP/1.0:** Mỗi request mở/đóng TCP connection → overhead lớn

**Keep-Alive giải quyết:**
```
Connection: keep-alive          ← Client yêu cầu giữ connection
Keep-Alive: timeout=5, max=100  ← Giữ 5 giây, tối đa 100 requests
```

**Tại sao quan trọng với Load Balancer?**
```
Client ──→ [LB] ──→ Backend-1
                ──→ Backend-2

Nếu Client dùng Keep-Alive với LB:
- Client mở 1 connection tới LB
- LB có thể route các request trong connection đó tới các backends khác nhau
- LB cũng cần quản lý connection pool tới backends

Nếu LB dùng Keep-Alive với backends:
- LB tái sử dụng TCP connection đến backends
- Giảm overhead TCP handshake
- Backends không bị "connection flood"
```

---

### HTTP Headers quan trọng với LB/Proxy

```
Host: example.com
```
→ Bắt buộc trong HTTP/1.1. LB dùng để route đến đúng virtual host/backend.

```
X-Forwarded-For: 203.0.113.1, 10.0.0.1
```
→ Chain các IP proxy đã đi qua. Backend dùng để biết IP thật của client.  
→ Format: `[original client IP], [proxy1 IP], [proxy2 IP]`

```
X-Real-IP: 203.0.113.1
```
→ Chỉ IP gốc của client (do Nginx set). Đơn giản hơn `X-Forwarded-For`.

```
Connection: keep-alive / close
```
→ Kiểm soát việc giữ hay đóng connection sau response.

```
Upgrade: websocket
Connection: Upgrade
```
→ Protocol upgrade (ví dụ từ HTTP lên WebSocket). LB phải hỗ trợ để proxy WebSocket.

---

### Lab 1.1

```bash
# Xem raw HTTP request/response
curl -v http://httpbin.org/get

# Xem chỉ headers
curl -I http://httpbin.org/get

# Xem HTTP version
curl -v --http1.1 http://httpbin.org/get
curl -v --http2 http://httpbin.org/get

# Gửi custom header
curl -H "X-Custom-Header: test" http://httpbin.org/headers

# POST với body
curl -X POST -H "Content-Type: application/json" \
  -d '{"name": "quang"}' http://httpbin.org/post
```

**Câu hỏi tự kiểm tra:**
1. Mở `curl -v` output, chỉ được phần nào là request header, response header, body?
2. Status code 304 có body không? Tại sao?
3. Header `Date` trong response dùng để làm gì?

---

## 1.2 TCP/IP Cơ Bản

### TCP 3-Way Handshake

**TCP (Transmission Control Protocol)** là giao thức **đảm bảo** (reliable) việc truyền dữ liệu. HTTP chạy trên TCP.

```
CLIENT                    SERVER
  │                          │
  │──── SYN (seq=x) ────────→│    Bước 1: Client gửi SYN
  │                          │           (muốn kết nối)
  │←─── SYN-ACK (seq=y, ack=x+1) ──│    Bước 2: Server đồng ý
  │                          │           (gửi SYN + ACK xác nhận)
  │──── ACK (ack=y+1) ──────→│    Bước 3: Client xác nhận
  │                          │
  │   ← Connection Established →   │
  │                          │
  │──── HTTP Request ────────→│    Bây giờ mới bắt đầu gửi data
  │←─── HTTP Response ────── │
```

**SYN** = Synchronize (muốn đồng bộ sequence number)  
**ACK** = Acknowledge (xác nhận đã nhận)  
**seq** = sequence number (đánh số thứ tự bytes)

> **Tại sao cần 3 bước?** Để đảm bảo **cả 2 phía** đều có khả năng gửi và nhận.

**Chi phí của TCP Handshake:**
- Tốn **1.5 RTT** (Round-Trip Time) trước khi gửi data
- Với mạng latency cao (ví dụ: Việt Nam ↔ US ~250ms), handshake tốn ~375ms
- HTTP Keep-Alive giúp tránh handshake lặp lại

---

### TCP Connection States

```bash
# Xem tất cả TCP connections
ss -tnp
netstat -tnp   # cũ hơn nhưng vẫn dùng được
```

| State | Ý nghĩa |
|-------|---------|
| `LISTEN` | Server đang chờ connection (port đang mở) |
| `SYN_SENT` | Client đã gửi SYN, chờ SYN-ACK |
| `SYN_RECV` | Server nhận SYN, đã gửi SYN-ACK, chờ ACK |
| `ESTABLISHED` | Connection đang hoạt động |
| `FIN_WAIT_1` | Bên gửi FIN (muốn đóng connection) |
| `FIN_WAIT_2` | Đã nhận ACK, chờ FIN từ phía kia |
| `TIME_WAIT` | Chờ đảm bảo ACK cuối cùng đến nơi (2 × MSL) |
| `CLOSE_WAIT` | Nhận FIN từ remote, chờ local app đóng |
| `CLOSED` | Connection đã đóng hoàn toàn |

**TIME_WAIT — quan trọng với LB:**
```
TIME_WAIT tồn tại 60-120 giây sau khi đóng connection.
Mỗi connection đang TIME_WAIT chiếm 1 ephemeral port.
Range ephemeral port: 32768 - 60999 (~28000 ports)

→ LB xử lý traffic cao → hàng ngàn connections TIME_WAIT
→ Hết port → không thể tạo connection mới!

Giải pháp:
  sysctl -w net.ipv4.tcp_tw_reuse=1    # Tái sử dụng TIME_WAIT sockets
  sysctl -w net.ipv4.ip_local_port_range="1024 65535"  # Mở rộng port range
```

---

### Socket là gì?

**Socket** = điểm cuối của 1 network connection, được xác định bởi:

```
Protocol + Local IP + Local Port + Remote IP + Remote Port
```

**Ví dụ:**

```
TCP  10.0.0.1:54321  →  93.184.216.34:80
     [Client IP:Port]    [Server IP:Port]
```

```bash
# Xem các socket đang LISTEN (server đang chờ)
ss -tlnp
# Output:
# State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port
# LISTEN  0       128     0.0.0.0:80           0.0.0.0:*         users:(("nginx",pid=123))

# 0.0.0.0:80  = lắng nghe trên TẤT CẢ interfaces, port 80
# 127.0.0.1:80 = chỉ lắng nghe trên localhost
# :::80 = lắng nghe IPv6 (và IPv4 nếu dual-stack)
```

**Binding:**
- Một process **bind** vào 1 `IP:Port` để nhận connections
- Không thể có 2 process cùng bind vào `0.0.0.0:80`
- Có thể bind vào `127.0.0.1:80` và `10.0.0.1:80` trên cùng máy (khác IP)

---

### TCP vs UDP

| Đặc điểm | TCP | UDP |
|----------|-----|-----|
| Kết nối | Connection-oriented (handshake) | Connectionless |
| Đảm bảo delivery | ✅ Có (retransmit nếu mất) | ❌ Không |
| Thứ tự | ✅ Đảm bảo | ❌ Không |
| Tốc độ | Chậm hơn | Nhanh hơn |
| Overhead | Header 20-60 bytes | Header 8 bytes |
| Use cases | HTTP, HTTPS, SSH, FTP, database | DNS, DHCP, video streaming, gaming, VoIP |

**Khi nào dùng UDP?**
- Khi mất packet không phải vấn đề (video: 1 frame mờ chấp nhận được)
- Khi latency quan trọng hơn reliability
- **DNS** dùng UDP (query nhỏ, 1 packet, fast)
- **QUIC** (HTTP/3) xây trên UDP nhưng tự implement reliability

---

### Port Numbers

```
Well-Known Ports (0-1023):   Cần root/admin để bind
  22   = SSH
  25   = SMTP
  53   = DNS
  80   = HTTP
  443  = HTTPS
  3306 = MySQL
  5432 = PostgreSQL
  6379 = Redis

Registered Ports (1024-49151): Không cần root
  8080 = HTTP alternate
  8443 = HTTPS alternate
  3000 = Node.js dev server thường dùng

Dynamic/Ephemeral Ports (49152-65535):
  OS tự gán cho client khi tạo outbound connection
  Linux thực tế: 32768-60999
```

```bash
# Xem ephemeral port range trên Linux
cat /proc/sys/net/ipv4/ip_local_port_range

# Xem port nào đang được dùng
ss -tlnp | grep :80
lsof -i :80
```

---

### Tools debug TCP

```bash
# Kiểm tra port có mở không
telnet example.com 80
nc -zv example.com 80      # netcat - nhanh hơn
nmap -p 80 example.com

# Xem connections đang active
ss -tnp
ss -tnp state established

# Count connections by state
ss -tn | awk '{print $1}' | sort | uniq -c

# Capture traffic trên interface (cần root)
tcpdump -i eth0 port 80
tcpdump -i eth0 port 80 -w capture.pcap    # Lưu file để mở bằng Wireshark
tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0'  # Chỉ xem SYN packets
```

---

## 1.3 DNS Cơ Bản

### DNS Resolution Flow

**DNS (Domain Name System)** = "Danh bạ điện thoại" của internet. Chuyển đổi domain → IP.

```
Browser gõ: http://example.com

Bước 1: Check browser cache
Bước 2: Check OS cache (/etc/hosts trên Linux)
Bước 3: Query DNS Resolver (thường là router hoặc 8.8.8.8)
Bước 4: Resolver hỏi Root Nameserver → biết .com nameserver
Bước 5: Resolver hỏi .com TLD Nameserver → biết example.com nameserver
Bước 6: Resolver hỏi example.com Nameserver → trả về IP
Bước 7: Resolver cache kết quả (theo TTL), trả về cho browser
Bước 8: Browser kết nối tới IP đó

Toàn bộ quá trình: 10-200ms lần đầu, <1ms nếu đã cache
```

---

### DNS Record Types

```
A Record:     example.com.    300   IN  A      93.184.216.34
              [domain]        [TTL] [class] [type] [value]

AAAA Record:  example.com.    300   IN  AAAA   2606:2800:220:1:248:1893:25c8:1946
              (IPv6)

CNAME:        www.example.com. 300  IN  CNAME  example.com.
              (alias, không trỏ trực tiếp vào IP)

MX:           example.com.    300   IN  MX     10 mail.example.com.
              (mail server, số là priority)

TXT:          (dùng cho SPF, DKIM, domain verification)

NS:           example.com.    3600  IN  NS     ns1.example.com.
              (nameserver của domain)
```

**TTL (Time To Live):**
- Đơn vị: giây
- TTL=300 → cache 5 phút
- TTL thấp → DNS thay đổi nhanh hơn nhưng tốn nhiều query hơn
- TTL cao → ít query hơn nhưng thay đổi IP lâu có hiệu lực

---

### /etc/hosts — Override DNS

```bash
# File /etc/hosts (Linux/Mac) hoặc C:\Windows\System32\drivers\etc\hosts (Windows)
127.0.0.1   localhost
10.0.0.100  myapp.local web.local
10.0.0.101  api.local

# Được check TRƯỚC DNS resolver
# Hữu ích để:
# - Test local development
# - Trỏ domain vào LB đang phát triển
# - Bypass DNS khi debug
```

```bash
# Check DNS resolution
dig example.com
dig example.com A        # Chỉ hỏi A record
dig @8.8.8.8 example.com # Hỏi specific DNS server

nslookup example.com
host example.com

# Xem /etc/resolv.conf — DNS server đang dùng
cat /etc/resolv.conf
```

---

### DNS và Load Balancing

**DNS Round Robin:** Trả về nhiều A records → client tự chọn

```
example.com.  60  IN  A  10.0.0.1
example.com.  60  IN  A  10.0.0.2
example.com.  60  IN  A  10.0.0.3
```

**Vấn đề của DNS LB:**
- Client cache → không phân phối đều (vì TTL)
- Không health check → vẫn trả về IP của server chết
- Không sticky session
- Không xét đến capacity của server

→ DNS LB chỉ dùng ở tầng sơ khai, không thay thế được real LB (Nginx/HAProxy).

---

### Lab 1.3

```bash
# Xem DNS resolution step-by-step
dig +trace example.com

# Kiểm tra reverse DNS (IP → domain)
dig -x 93.184.216.34

# Test /etc/hosts override
echo "10.0.0.100 test.local" | sudo tee -a /etc/hosts
curl http://test.local   # Sẽ kết nối tới 10.0.0.100

# Xem DNS cache đang có
# (Linux với systemd-resolved)
resolvectl statistics
```

---

## ✅ Checkpoint Phần 1

Sau khi học xong phần này, bạn phải trả lời được:

1. **HTTP:** Nếu browser gửi `GET /` tới `example.com`, hãy viết raw HTTP request đó ra.
2. **Status codes:** LB trả về 502 nghĩa là gì? Nguyên nhân có thể là gì?
3. **TCP:** Vẽ TCP 3-way handshake. Bước nào client làm, bước nào server làm?
4. **Keep-Alive:** Tại sao HTTP Keep-Alive quan trọng? Điều gì xảy ra nếu tắt nó?
5. **TIME_WAIT:** Tại sao server có quá nhiều TIME_WAIT connections có thể bị lỗi?
6. **DNS:** `curl http://api.local` tìm địa chỉ IP của `api.local` theo thứ tự nào?
7. **Port:** Tại sao cần quyền root để listen trên port 80 nhưng không cần với port 8080?

> 🔴 **Không trả lời được → Phải học lại trước khi qua Phần 2**
