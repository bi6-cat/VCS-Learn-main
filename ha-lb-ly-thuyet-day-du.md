# HA-LB: Keepalived & HAProxy — Lý thuyết đầy đủ

## Mục lục
1. [Tổng quan bài toán High Availability](#1-tổng-quan-bài-toán-high-availability)
2. [Load Balancer là gì và tại sao cần nó](#2-load-balancer-là-gì-và-tại-sao-cần-nó)
3. [HAProxy — kiến trúc & cơ chế hoạt động](#3-haproxy--kiến-trúc--cơ-chế-hoạt-động)
4. [Các thuật toán Load Balancing](#4-các-thuật-toán-load-balancing)
5. [Health Check trong HAProxy](#5-health-check-trong-haproxy)
6. [Session Persistence (Sticky Session)](#6-session-persistence-sticky-session)
7. [Layer 4 vs Layer 7 Load Balancing](#7-layer-4-vs-layer-7-load-balancing)
8. [Single Point of Failure & vì sao cần HA cho chính LB](#8-single-point-of-failure--vì-sao-cần-ha-cho-chính-lb)
9. [Khái niệm VIP (Virtual IP)](#9-khái-niệm-vip-virtual-ip)
10. [Keepalived & giao thức VRRP](#10-keepalived--giao-thức-vrrp)
11. [Cơ chế bầu chọn MASTER/BACKUP](#11-cơ-chế-bầu-chọn-masterbackup)
12. [Gratuitous ARP — cách VIP chuyển đổi trong suốt](#12-gratuitous-arp--cách-vip-chuyển-đổi-trong-suốt)
13. [vrrp_script — theo dõi tình trạng dịch vụ thực tế](#13-vrrp_script--theo-dõi-tình-trạng-dịch-vụ-thực-tế)
14. [Kiến trúc tổng thể HA-LB (Keepalived + HAProxy)](#14-kiến-trúc-tổng-thể-ha-lb-keepalived--haproxy)
15. [Keepalived kết hợp IPVS/LVS — phương án LB thuần Layer 4](#15-keepalived-kết-hợp-ipvslvs--phương-án-lb-thuần-layer-4)
16. [So sánh các phương án Load Balancer](#16-so-sánh-các-phương-án-load-balancer)
17. [Các mô hình HA phổ biến](#17-các-mô-hình-ha-phổ-biến)
18. [Giới hạn & rủi ro của Keepalived/HAProxy tự triển khai](#18-giới-hạn--rủi-ro-của-keepalivedhaproxy-tự-triển-khai)
19. [Xu hướng thực tế trong hạ tầng hiện đại](#19-xu-hướng-thực-tế-trong-hạ-tầng-hiện-đại)
20. [Tổng kết](#20-tổng-kết)

---

## 1. Tổng quan bài toán High Availability

**High Availability (HA)** là khả năng một hệ thống tiếp tục hoạt động (hoặc phục hồi cực nhanh) ngay cả khi một hoặc nhiều thành phần bên trong gặp sự cố. HA thường được đo bằng "số 9":

| Mức độ sẵn sàng | Downtime cho phép/năm |
|---|---|
| 99% (two nines) | ~3.65 ngày |
| 99.9% (three nines) | ~8.76 giờ |
| 99.99% (four nines) | ~52.6 phút |
| 99.999% (five nines) | ~5.26 phút |

Để đạt HA, nguyên tắc cốt lõi là: **loại bỏ Single Point of Failure (SPOF)** — bất kỳ thành phần nào mà khi nó chết, cả hệ thống chết theo. Với hệ thống web/backend, có 2 tầng SPOF cần xử lý:

1. **Tầng ứng dụng/backend**: giải quyết bằng cách chạy nhiều instance + Load Balancer phân phối traffic.
2. **Tầng Load Balancer**: chính LB cũng có thể là SPOF nếu chỉ có 1 instance → cần thêm cơ chế HA cho LB → đây là lý do ra đời mô hình **Keepalived + HAProxy**.

---

## 2. Load Balancer là gì và tại sao cần nó

**Load Balancer (LB)** là thành phần đứng giữa client và các backend server, có nhiệm vụ:

- **Phân phối tải**: chia đều (hoặc theo chiến lược nhất định) request đến nhiều backend, tránh 1 server bị quá tải trong khi các server khác nhàn rỗi.
- **Kiểm tra sức khỏe (health check)**: tự động phát hiện backend nào đang lỗi và loại nó khỏi vòng phân phối, khôi phục lại khi backend hồi phục.
- **Tăng khả năng mở rộng (scalability)**: cho phép thêm/bớt backend server linh hoạt mà client không cần biết.
- **Cải thiện độ sẵn sàng**: nếu 1 backend chết, các backend còn lại vẫn tiếp tục phục vụ, người dùng gần như không bị gián đoạn.
- **Một số LB còn làm thêm**: SSL/TLS termination (giải mã HTTPS tại LB để giảm tải CPU cho backend), nén dữ liệu, caching, rewrite URL, rate limiting...

---

## 3. HAProxy — kiến trúc & cơ chế hoạt động

**HAProxy** (High Availability Proxy) là phần mềm mã nguồn mở chuyên dụng cho load balancing và reverse proxy, nổi bật vì hiệu năng cao (xử lý hàng chục nghìn kết nối đồng thời), footprint nhẹ, và độ ổn định đã được kiểm chứng qua nhiều năm ở các hệ thống lớn.

**Các thành phần cấu hình chính:**

| Khối cấu hình | Vai trò |
|---|---|
| `global` | Cấu hình toàn cục: số kết nối tối đa, log, user chạy process... |
| `defaults` | Giá trị mặc định áp dụng cho các frontend/backend phía dưới (timeout, mode...) |
| `frontend` | Định nghĩa nơi HAProxy **lắng nghe** request từ client (IP, port, giao thức) |
| `backend` | Định nghĩa **danh sách server thực** phía sau và thuật toán phân phối |
| `listen` | Kết hợp frontend + backend trong 1 khối (dùng khi không cần tách biệt) |

**Cơ chế xử lý một request:**
1. Client gửi request đến địa chỉ mà `frontend` đang lắng nghe.
2. HAProxy đối chiếu các luật (ACL) nếu có (VD định tuyến theo domain, path...) để chọn `backend` phù hợp.
3. Trong `backend`, HAProxy áp dụng thuật toán cân bằng tải (`balance`) đã cấu hình để chọn 1 server cụ thể trong danh sách còn "khỏe" (đã pass health check).
4. Request được chuyển tiếp (proxy) đến server đó, response trả ngược lại qua HAProxy về client.
5. Toàn bộ tiến trình vận hành theo mô hình **event-driven, single-threaded per process** (từ bản 1.8+ hỗ trợ đa luồng), giúp xử lý số lượng kết nối cực lớn với tài nguyên tối thiểu.

---

## 4. Các thuật toán Load Balancing

| Thuật toán | Cơ chế | Ưu điểm | Nhược điểm | Phù hợp khi |
|---|---|---|---|---|
| **Round Robin** | Luân phiên tuần tự qua từng server | Đơn giản, phân phối đều số lượng request | Không tính đến tải thực tế hay năng lực server | Backend đồng nhất về cấu hình & thời gian xử lý |
| **Weighted Round Robin** | Round Robin có trọng số, server "weight" cao nhận nhiều request hơn | Tận dụng được server mạnh hơn | Cần tự ước lượng & duy trì weight hợp lý | Backend không đồng nhất phần cứng |
| **Least Connections** | Ưu tiên server đang có ít kết nối đang xử lý nhất | Cân bằng tốt khi thời gian xử lý request chênh lệch lớn | Cần theo dõi trạng thái kết nối liên tục (tốn tài nguyên hơn Round Robin) | Request có độ dài xử lý khác nhau nhiều (VD API nặng/nhẹ xen kẽ) |
| **Source (IP Hash)** | Băm theo địa chỉ IP nguồn, cùng client luôn về cùng backend | Đạt session persistence không cần cookie | Phân phối có thể lệch nếu nhiều client dùng chung 1 IP (NAT) | Cần "sticky session" đơn giản ở tầng TCP |
| **URI/URL Hash** | Băm theo URI của request | Hỗ trợ tốt cho cache theo tài nguyên | Không cân bằng tải tốt nếu 1 URI có traffic đột biến | Hệ thống cache/CDN phân tán |
| **Random / Random with weight** | Chọn ngẫu nhiên, có thể có trọng số | Đơn giản, phân tán đều về mặt thống kê ở quy mô lớn | Không đảm bảo cân bằng tức thời | Hệ thống lớn, nhiều LB tầng trước đã phân tán tải |

> **Ghi chú:** đây là các thuật toán đã được các LB (HAProxy, Nginx, cloud LB...) cài đặt sẵn — người vận hành chỉ cần **chọn** thuật toán phù hợp qua cấu hình (VD `balance roundrobin`), không cần tự lập trình lại thuật toán.

---

## 5. Health Check trong HAProxy

Health check là cơ chế HAProxy **chủ động kiểm tra** backend server còn hoạt động tốt hay không, để quyết định có tiếp tục gửi traffic đến hay không.

**Các kiểu health check phổ biến:**
- **TCP check**: chỉ kiểm tra port có mở/kết nối được không (đơn giản, ít thông tin).
- **HTTP check**: gửi request GET đến 1 endpoint cụ thể (VD `/health`), kiểm tra mã trạng thái trả về (VD phải là 200).
- **Custom check**: kiểm tra nội dung response, hoặc dùng script bên ngoài.

**Các tham số quan trọng:**
- `inter`: khoảng thời gian giữa các lần check.
- `rise`: số lần check thành công liên tiếp để coi server là "khỏe" trở lại.
- `fall`: số lần check thất bại liên tiếp để coi server là "chết", loại khỏi vòng phân phối.

Cơ chế `rise`/`fall` giúp tránh tình trạng "flapping" — server bị bật/tắt liên tục khỏi danh sách chỉ vì 1 lần lỗi tạm thời (network glitch).

---

## 6. Session Persistence (Sticky Session)

Trong các ứng dụng lưu **session state** tại bộ nhớ local của từng backend (không dùng session store tập trung như Redis), cần đảm bảo user luôn được định tuyến về **cùng 1 backend** trong suốt phiên làm việc. Có 2 cách chính:

1. **Dựa vào thuật toán LB** (Source/IP Hash): đơn giản nhưng kém chính xác nếu nhiều user chung 1 IP public (NAT), hoặc user đổi mạng giữa phiên.
2. **Dựa vào cookie** (`cookie` directive trong HAProxy): HAProxy chèn thêm 1 cookie định danh server vào response; các request sau đó của cùng client sẽ được đọc cookie để định tuyến về đúng backend — chính xác hơn IP Hash, không phụ thuộc mạng.

> Về lâu dài, giải pháp kiến trúc tốt hơn là làm cho backend **stateless** (đẩy session ra một store tập trung như Redis) để không phải phụ thuộc sticky session — giúp LB tự do phân phối tải mà không ràng buộc.

---

## 7. Layer 4 vs Layer 7 Load Balancing

| | Layer 4 (Transport) | Layer 7 (Application) |
|---|---|---|
| Dữ liệu LB nhìn thấy | Chỉ IP + port (TCP/UDP) | Toàn bộ nội dung HTTP: header, cookie, path, method... |
| Hiệu năng | Rất cao (ít xử lý, có thể chạy ở kernel-space qua IPVS) | Thấp hơn L4 (phải parse & hiểu giao thức ứng dụng) |
| Khả năng định tuyến thông minh | Không (chỉ dựa IP/port) | Có (route theo domain, path, header, A/B testing...) |
| SSL Termination | Không hỗ trợ trực tiếp | Có (giải mã HTTPS tại LB) |
| Ví dụ công cụ | IPVS/LVS, Keepalived (chế độ LB), cloud NLB | HAProxy (mode http), Nginx, cloud ALB |

HAProxy hỗ trợ **cả 2 chế độ**: `mode tcp` (Layer 4) và `mode http` (Layer 7) — tùy nhu cầu mà chọn.

---

## 8. Single Point of Failure & vì sao cần HA cho chính LB

Giả sử kiến trúc chỉ có **1 LB duy nhất** đứng trước nhiều backend:

```
Client → [ 1 LB duy nhất ] → Backend1, Backend2, Backend3...
```

Nếu LB này chết (crash, mất mạng, hết tài nguyên...) → **toàn bộ hệ thống mất khả năng truy cập**, dù tất cả backend phía sau vẫn hoạt động hoàn hảo. LB lúc này chính là SPOF mới, dù đã giải quyết được SPOF ở tầng backend.

**Giải pháp:** triển khai **≥2 instance LB** chạy song song, và cần thêm một cơ chế để:
1. Chỉ **1 địa chỉ IP duy nhất** được client biết đến, dù có nhiều LB phía sau (client không thể tự biết LB nào đang sống để đổi sang).
2. Khi LB đang phục vụ (MASTER) gặp sự cố, **tự động và nhanh chóng** chuyển địa chỉ đó sang LB còn lại — đây chính là vai trò của **Keepalived** với khái niệm **VIP** và giao thức **VRRP**.

---

## 9. Khái niệm VIP (Virtual IP)

**VIP (Virtual IP)** là một địa chỉ IP không gắn cố định vào 1 card mạng vật lý của riêng máy nào, mà được gán động cho node nào đang giữ vai trò **MASTER** tại thời điểm hiện tại.

**Đặc điểm của VIP:**
- Client/DNS/ứng dụng chỉ cần biết **một địa chỉ IP duy nhất** (VIP) để kết nối, không quan tâm phía sau có bao nhiêu node LB vật lý.
- VIP được "cộng thêm" (add) vào network interface của node MASTER (VD dưới dạng alias `eth0:0`, hoặc trực tiếp trên `eth0` với các bản Keepalived mới).
- Khi node giữ VIP gặp sự cố, node BACKUP phát hiện và **tự chiếm lấy VIP**, gán nó vào interface của chính mình.
- Quá trình chuyển đổi diễn ra trong **vài giây**, và gần như trong suốt (transparent) với client — client không cần đổi cấu hình, không cần biết có sự cố vừa xảy ra.

```
                Client
                  │
                  ▼
           VIP: 10.0.0.100  ◄── luôn trỏ đến node đang là MASTER
          ┌───────┴───────┐
          ▼               ▼
      Node A            Node B
     (MASTER)          (BACKUP)
```

---

## 10. Keepalived & giao thức VRRP

**Keepalived** là phần mềm hiện thực giao thức **VRRP (Virtual Router Redundancy Protocol — RFC 5798)**, vốn ban đầu được thiết kế để cung cấp HA cho **default gateway** của router, sau này được ứng dụng rộng rãi để cung cấp HA cho bất kỳ dịch vụ nào cần một VIP dùng chung (LB, database, DNS...).

**Cơ chế VRRP:**
- Các node tham gia cùng 1 **VRRP instance** (nhóm) liên tục gửi gói tin **VRRP Advertisement** (multicast, theo mặc định tới địa chỉ `224.0.0.18`) để thông báo "tôi vẫn còn sống", định kỳ theo `advert_int` (mặc định 1 giây).
- Node có **priority cao nhất** trong nhóm (và đang hoạt động bình thường) sẽ ở trạng thái **MASTER**, giữ VIP và chủ động gửi advertisement.
- Các node còn lại ở trạng thái **BACKUP**, chỉ lắng nghe advertisement từ MASTER.
- Nếu BACKUP không nhận được advertisement trong khoảng thời gian `Master_Down_Interval` (tính dựa trên `advert_int` và priority) → nó cho rằng MASTER đã chết → tự chuyển sang trạng thái MASTER, chiếm lấy VIP.

---

## 11. Cơ chế bầu chọn MASTER/BACKUP

Việc bầu chọn dựa trên tham số **`priority`** (giá trị từ 1–255, mặc định 100):

- Node có priority **cao nhất** trong nhóm VRRP sẽ trở thành MASTER khi cluster khởi động hoặc khi bầu lại.
- Khi MASTR hiện tại chết, node có priority cao nhất trong số các node **còn sống** sẽ được bầu làm MASTER mới.
- Cấu hình 2 node đơn giản: node chính đặt `priority 150`, node dự phòng đặt `priority 100` — đảm bảo node chính luôn được ưu tiên làm MASTER khi cả 2 cùng sống.
- Có thể mở rộng ra **nhiều hơn 2 node** trong cùng 1 nhóm VRRP (N+1 hoặc N+M redundancy), miễn là mỗi node có `priority` khác nhau để tránh xung đột bầu chọn.

---

## 12. Gratuitous ARP — cách VIP chuyển đổi trong suốt

Một câu hỏi quan trọng: khi VIP chuyển từ node A sang node B, làm sao switch/router trong mạng LAN biết cần gửi gói tin đến **địa chỉ MAC mới** (của node B) thay vì địa chỉ MAC cũ (của node A)?

**Cơ chế: Gratuitous ARP (GARP)**
- Ngay khi một node trở thành MASTER mới (chiếm VIP), Keepalived trên node đó **chủ động gửi gói tin ARP** thông báo "địa chỉ IP `VIP` giờ tương ứng với địa chỉ MAC của tôi" — dù không có ai hỏi (đây là lý do gọi là "gratuitous" — tự nguyện, không cần yêu cầu).
- Switch nhận gói GARP này sẽ **cập nhật lại bảng ARP/MAC table** ngay lập tức, chuyển hướng traffic đến VIP sang đúng cổng vật lý kết nối với node MASTER mới.
- Nhờ GARP, toàn bộ quá trình failover diễn ra mà **không cần client thực hiện bất kỳ thao tác nào** (không cần xóa ARP cache thủ công, không cần đổi DNS).

---

## 13. vrrp_script — theo dõi tình trạng dịch vụ thực tế

Một điểm dễ hiểu lầm: VRRP về bản chất chỉ theo dõi xem **node có còn "sống" về mặt mạng** hay không (còn gửi được advertisement hay không) — chứ **không** tự động biết được dịch vụ chạy trên đó (VD HAProxy) có đang hoạt động đúng hay không.

**Giải pháp: `vrrp_script`** — một cơ chế của Keepalived cho phép chạy 1 script/lệnh kiểm tra định kỳ (VD `curl` vào endpoint health-check của HAProxy, hoặc `killall -0 haproxy` để kiểm tra process còn tồn tại):

- Nếu script trả về lỗi (dịch vụ không khỏe) → Keepalived **tự giảm `priority`** của node đó đi một lượng (`weight`) → khiến node kia (nếu vẫn khỏe) có priority cao hơn → được bầu làm MASTER thay thế, dù bản thân node cũ vẫn "sống" về mặt mạng.
- Đây là cơ chế bắt buộc phải có trong thực tế, nếu không, sẽ xảy ra tình huống: node vẫn ping được, VRRP vẫn hoạt động bình thường, nhưng HAProxy bên trong đã crash từ lâu → VIP vẫn nằm ở node "chết dịch vụ" đó → toàn bộ traffic vào một ngõ cụt.

---

## 14. Kiến trúc tổng thể HA-LB (Keepalived + HAProxy)

```
                       Client
                          │
                          ▼
                VIP: 10.0.0.100 (dùng chung)
              ┌───────────┴───────────┐
              ▼                       ▼
        ┌───────────┐           ┌───────────┐
        │  Node LB1  │◄─VRRP───►│  Node LB2  │
        │ Keepalived │ heartbeat│ Keepalived │
        │  HAProxy   │           │  HAProxy   │
        │ (MASTER)   │           │ (BACKUP)   │
        └─────┬──────┘           └─────┬──────┘
              │                        │
              └───────────┬────────────┘
                           ▼
              ┌─────────────────────────┐
              │   Backend servers        │
              │  (App1, App2, App3...)   │
              └─────────────────────────┘
```

**Luồng xử lý:**
1. Client gửi request đến VIP.
2. Gói tin đến node đang giữ VIP (MASTER) nhờ ARP table đã được cập nhật.
3. **HAProxy** trên node MASTER áp dụng thuật toán LB, chọn backend phù hợp, forward request.
4. HAProxy liên tục health-check backend, tự loại backend lỗi khỏi vòng phân phối.
5. **Keepalived** trên cả 2 node liên tục trao đổi VRRP advertisement + tự kiểm tra HAProxy qua `vrrp_script`.
6. Nếu node MASTER (hoặc HAProxy trên đó) gặp sự cố → VIP tự động chuyển sang node BACKUP trong vài giây, kèm gói GARP để cập nhật routing tức thì.

---

## 15. Keepalived kết hợp IPVS/LVS — phương án LB thuần Layer 4

Ngoài việc chỉ dùng để tạo HA cho HAProxy, **Keepalived còn có thể tự làm Load Balancer** thông qua tích hợp với **IPVS (IP Virtual Server)** — một module cân bằng tải chạy ngay trong **kernel Linux** (còn gọi là LVS — Linux Virtual Server).

**Cơ chế:**
- Keepalived định nghĩa khối `virtual_server` (VIP + port) và danh sách `real_server` (các backend thật) phía sau.
- Việc phân phối traffic diễn ra ở **kernel-space** (không qua tầng ứng dụng như HAProxy) → hiệu năng cực cao, độ trễ cực thấp.
- Đổi lại, IPVS chỉ hoạt động ở **Layer 4** — không đọc được nội dung HTTP, không hỗ trợ SSL termination, không định tuyến theo URL/header/cookie.

**Khi nào chọn IPVS thay vì HAProxy:**
- Cần cân bằng tải cho giao thức thuần TCP/UDP (VD database, message queue) không cần logic Layer 7.
- Cần hiệu năng tối đa cho lưu lượng cực lớn, không cần các tính năng thông minh ở tầng ứng dụng.

---

## 16. So sánh các phương án Load Balancer

| Tiêu chí | HAProxy | Nginx (LB mode) | IPVS/LVS (qua Keepalived) | Cloud managed LB |
|---|---|---|---|---|
| Layer | 4 & 7 | 4 & 7 | 4 only | 4 & 7 (tùy dịch vụ) |
| Hiệu năng | Rất cao | Cao | Cực cao (kernel-space) | Cao, tự động scale |
| Tính năng L7 (routing, SSL...) | Rất mạnh | Mạnh | Không có | Tùy dịch vụ |
| Độ phức tạp vận hành | Trung bình | Trung bình | Thấp (nhưng cấu hình VRRP đi kèm phức tạp hơn) | Thấp (được quản lý sẵn) |
| Cần tự lo HA | Có (qua Keepalived) | Có (qua Keepalived) | Tự thân đã tích hợp Keepalived | Không (nhà cung cấp lo) |
| Chi phí | Miễn phí (mã nguồn mở) | Miễn phí (bản cơ bản) | Miễn phí | Trả phí theo dịch vụ |

---

## 17. Các mô hình HA phổ biến

- **Active-Passive (1 MASTER + 1 BACKUP đứng chờ)**: đơn giản nhất, dễ triển khai, nhưng lãng phí tài nguyên node BACKUP khi không có sự cố (nó không xử lý traffic).
- **Active-Active**: cả 2 node cùng xử lý traffic song song (VD dùng DNS round-robin trỏ đến 2 VIP khác nhau, hoặc ECMP), tận dụng tối đa tài nguyên, nhưng phức tạp hơn trong việc đảm bảo tính nhất quán trạng thái (nếu có sticky session).
- **N+1 / N+M Redundancy**: mở rộng ra nhiều hơn 2 node LB, trong đó 1 (hoặc M) node đóng vai trò dự phòng chung cho N node chính — tối ưu chi phí hơn so với việc nhân đôi 1-1.

---

## 18. Giới hạn & rủi ro của Keepalived/HAProxy tự triển khai

- **VRRP dùng multicast theo mặc định** — nhiều hạ tầng mạng hiện đại (đặc biệt là cloud VPC như AWS/GCP/Azure) **không hỗ trợ multicast**, buộc phải chuyển sang cấu hình `unicast_peer` (gửi advertisement dạng unicast trực tiếp giữa các node) mới hoạt động được.
- **Gán VIP tùy ý lên interface đòi hỏi quyền cao** (`NET_ADMIN`), nên khi container hóa, thành phần Keepalived phải chạy `network_mode: host` — làm giảm lợi ích cách ly (isolation) mà container mang lại, cần cân nhắc kỹ về bảo mật.
- **Chỉ theo dõi được "sống/chết" ở mức mạng (VRRP) nếu không cấu hình `vrrp_script`** — dễ dẫn đến tình huống VIP vẫn nằm ở node có dịch vụ đã chết nhưng network vẫn "sống".
- **Cấu hình sai `priority`/`advert_int` giữa các node có thể gây "split-brain"** (2 node cùng nghĩ mình là MASTER, cùng chiếm VIP) — cần đảm bảo mạng ổn định và giá trị cấu hình nhất quán.
- **Cần tự vận hành, giám sát, vá lỗi** toàn bộ stack (OS, HAProxy, Keepalived) — khác với dùng dịch vụ managed, nơi nhà cung cấp lo phần này.

---

## 19. Xu hướng thực tế trong hạ tầng hiện đại

Trong bối cảnh hạ tầng hiện nay, việc tự dựng Keepalived + HAProxy vẫn có chỗ đứng, nhưng không còn là lựa chọn mặc định cho mọi hệ thống:

- **Trên cloud (AWS/GCP/Azure)**: phần lớn dùng **managed Load Balancer** (Application/Network Load Balancer) — nhà cung cấp đã tích hợp sẵn HA đa vùng (multi-AZ), tự động scale, không cần tự quản lý VIP/VRRP.
- **Trên Kubernetes**: dùng **Ingress Controller** (Nginx Ingress, Traefik, HAProxy Ingress) kết hợp `Service type LoadBalancer`; với cụm on-premise không có cloud LB, dùng **MetalLB** — về bản chất vẫn dựa trên nguyên lý VRRP/ARP tương tự Keepalived, nhưng được Kubernetes quản lý vòng đời tự động.
- **Trên hạ tầng on-premise / bare-metal không dùng Kubernetes** (ngân hàng, data center riêng, hệ thống legacy): đây là nơi mô hình **Keepalived + HAProxy tự triển khai vẫn rất phổ biến**, thường được **cài trực tiếp lên OS của server/VM** (không qua container) vì bản chất Keepalived cần thao túng sâu vào network stack của host.

---

## 20. Tổng kết

| Thành phần | Vai trò chính |
|---|---|
| **Load Balancer (HAProxy)** | Phân phối traffic đến nhiều backend, health-check, tăng khả năng chịu tải & sẵn sàng cho tầng ứng dụng |
| **Keepalived (VRRP)** | Đảm bảo tính sẵn sàng cao cho chính tầng Load Balancer, thông qua cơ chế VIP dùng chung và failover tự động |
| **VIP** | Địa chỉ IP "ảo" duy nhất mà client biết đến, luôn trỏ về node LB đang hoạt động |
| **Gratuitous ARP** | Cơ chế giúp việc chuyển VIP diễn ra trong suốt, không cần can thiệp từ phía client |
| **vrrp_script** | Cầu nối để Keepalived biết được tình trạng thực sự của dịch vụ (HAProxy), không chỉ dựa vào "còn sống về mạng" |

Kết hợp lại, **Keepalived + HAProxy** giải quyết triệt để bài toán loại bỏ Single Point of Failure ở cả 2 tầng: tầng ứng dụng (nhờ HAProxy phân phối tải + health check) và tầng Load Balancer (nhờ Keepalived đảm bảo VIP luôn trỏ đến 1 node LB đang hoạt động tốt) — là nền tảng lý thuyết cho phần lớn các giải pháp HA-LB tự triển khai trên hạ tầng on-premise hiện nay.

---

## Tài liệu tham khảo

- HAProxy Documentation: https://docs.haproxy.org/
- Keepalived Documentation: https://www.keepalived.org/manpage.html
- VRRP — RFC 5798: https://www.rfc-editor.org/rfc/rfc5798
- IPVS/LVS Project: http://www.linuxvirtualserver.org/
