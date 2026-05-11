# 📘 Tổng Hợp Kiến Thức Cốt Lõi Về iptables (Lý Thuyết & Thực Hành)

## Phần 1: Lý Thuyết Nền Tảng

### 1. Bản chất của iptables là gì?
Về bản chất, **`iptables` không phải là bộ lọc gói tin**. Bộ xử lý chặn/lọc gói tin thực sự nằm sâu bên trong nhân Linux (Linux Kernel) và được gọi là **`Netfilter`**.
`iptables` chỉ là một công cụ giao diện dòng lệnh (User-space utility) giúp quản trị viên hệ thống viết ra các "luật" (Rules) và đẩy các luật đó vào cho `Netfilter` thực thi. Dù vậy, người ta vẫn quen gọi chung toàn bộ hệ thống này là tường lửa `iptables`.

---

### 2. Kiến trúc cốt lõi: Tables, Chains và Targets
Kiến trúc của `iptables` phân tầng như một hệ thống hải quan, bao gồm:

#### A. Tables (Bảng) - "Phòng ban chức năng"
Các luật được phân chia vào các bảng tùy theo mục đích:
1.  **Filter Table (Mặc định):** Quyết định xem gói tin có được phép đi tiếp hay bị chặn lại (Allow/Deny).
2.  **NAT Table (Network Address Translation):** Dùng để sửa đổi địa chỉ IP nguồn (SNAT) hoặc IP đích (DNAT). Chuyên dùng cho Port Forwarding hoặc chia sẻ kết nối Internet (Masquerade).
3.  **Mangle Table:** Can thiệp sâu, chỉnh sửa thông số đặc biệt trong Header của gói tin IP (TTL, QoS, TOS).
4.  **Raw Table:** Hoạt động sớm nhất, dùng để đánh dấu các gói tin **không** cần theo dõi trạng thái (bypass Connection Tracking), tối ưu chặn DDoS.

#### B. Chains (Chuỗi) - "Các trạm kiểm soát"
Một Chain đại diện cho một thời điểm cụ thể trong vòng đời gói tin khi đi qua máy chủ. Có 5 chuỗi chính:
1.  **PREROUTING:** Trạm đầu tiên ngay khi gói tin vừa chạm tới card mạng (Chưa định tuyến).
2.  **INPUT:** Trạm chặn luồng đi vào chính máy chủ Linux này (Ví dụ: SSH vào server).
3.  **FORWARD:** Trạm kiểm soát các gói tin "đi mượn đường" xuyên qua server (Server làm Router).
4.  **OUTPUT:** Trạm kiểm tra các gói tin do chính máy chủ Linux này tạo ra và đẩy ra ngoài.
5.  **POSTROUTING:** Trạm cuối cùng trước khi gói tin rời khỏi card mạng máy chủ.

#### C. Targets (Mục tiêu/Hành động)
Khi gói tin khớp quy tắc, nó sẽ chịu một trong các hành động:
*   **ACCEPT:** Cho gói tin đi qua.
*   **DROP:** Vứt bỏ gói tin ngay lập tức (Im lặng, không phản hồi - chống Scan Port).
*   **REJECT:** Chặn gói tin nhưng báo lại lỗi lịch sự cho người gửi ("ICMP port unreachable").
*   **LOG:** Ghi chú vào nhật ký (syslog) và cho chạy xuống luật tiếp theo.
*   **SNAT / DNAT / MASQUERADE:** Thay đổi địa chỉ IP đích/nguồn.

---

### 3. Connection Tracking (Tường lửa Stateful)
Tường lửa `iptables` ghi nhớ trạng thái của các kết nối, giúp không cần mở port 2 chiều (vào và ra) một cách thủ công. Các trạng thái gồm:
*   **NEW:** Gói tin tạo kết nối đầu tiên (VD: TCP SYN).
*   **ESTABLISHED:** Gói tin thuộc kết nối đã được thiết lập thành công.
*   **RELATED:** Gói tin tạo kết nối mới nhưng liên đới tới một kết nối đã có (VD: FTP Data).
*   **INVALID:** Gói tin rác/không hợp lệ, thường là nỗ lực tấn công mạng.

---

### 4. Sức mạnh và Use Cases (Các ứng dụng thực tế)
Iptables được ví như "con dao Thụy Sĩ" vì có thể làm được các việc sau:

1.  **Stateful Firewall:** Chặn mọi truy cập từ ngoài vào, nhưng vẫn cho phép dữ liệu trả về từ các yêu cầu do mạng nội bộ chủ động gửi ra.
2.  **NAT Router & Port Forwarding:** Biến PC thành bộ định tuyến chia sẻ Internet cho LAN, hoặc Mở Port cấu hình IP tĩnh bên trong kết nối ra mạng Public.
3.  **Load Balancer (Lớp 4):** Cân bằng tải hiệu năng cao chuyển tiếp các Request web vào các server backend dựa trên thuật toán Round-Robin hoặc tỷ lệ phần trăm (module `nth`, `random`).
4.  **Anti-DDoS:** Dùng module `connlimit` và `hashlimit` để giới hạn số lượng request trên mỗi giây từ một IP, dập tắt các cuộc tấn công rác lớp mạng.

---

## Phần 2: Thực Hành Lệnh iptables Cơ Bản

### 1. Cú pháp tổng quát
```bash
iptables [-t table] COMMAND [chain] [matches] [target]
```
*(Nếu không chỉ định `-t`, iptables mặc định sẽ tương tác với bảng `filter`).*

### 2. Các lệnh quản lý Luật (Rules)
*   **Xem các luật đang có (chi tiết, hiển thị IP số):**
    ```bash
    iptables -L -n -v
    ```
*   **Xem các luật ở bảng NAT:**
    ```bash
    iptables -t nat -L -n -v
    ```
*   **Xem các luật kèm theo số thứ tự dòng (Line numbers):**
    ```bash
    iptables -L --line-numbers
    ```
*   **Xóa (Delete) luật ở dòng số 2 thuộc chuỗi INPUT:**
    ```bash
    iptables -D INPUT 2
    ```
*   **Xóa trắng toàn bộ luật (Flush):** *(Cẩn thận, sẽ làm rớt mạng nếu không cẩn trọng)*
    ```bash
    iptables -F
    ```

### 3. Thiết lập Chính sách mặc định (Default Policy)
Thường được áp dụng để tạo mô hình Zero-Trust: "Chặn tất cả, chỉ mở cái cần thiết".
```bash
iptables -P INPUT DROP        # Mặc định chặn dòng vào
iptables -P FORWARD DROP      # Mặc định chặn dòng đi mượn đường
iptables -P OUTPUT ACCEPT     # Mặc định cho phép dòng đi ra từ server
```

### 4. Các kịch bản mở Port và Cấu hình thông dụng

*   **Cho phép giao tiếp qua lại bằng card loopback (localhost - 127.0.0.1)** *(Rất quan trọng cho dịch vụ local)*:
    ```bash
    iptables -A INPUT -i lo -j ACCEPT
    ```

*   **Chấp nhận dữ liệu trả về từ các kết nối đã khởi tạo từ trước (Stateful rule):**
    ```bash
    iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
    # Hoặc cú pháp mới hơn bằng conntrack:
    # iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    ```

*   **Cho phép SSH (Port 22 TCP) từ mọi nơi:**
    ```bash
    iptables -A INPUT -p tcp --dport 22 -j ACCEPT
    ```

*   **Chỉ cho phép SSH từ một IP cụ thể (VD: 192.168.1.100) nhằm tăng bảo mật:**
    ```bash
    iptables -A INPUT -p tcp -s 192.168.1.100 --dport 22 -j ACCEPT
    ```

*   **Mở port cho Web Server (HTTP: 80, HTTPS: 443):**
    ```bash
    iptables -A INPUT -p tcp --dport 80 -j ACCEPT
    iptables -A INPUT -p tcp --dport 443 -j ACCEPT
    ```

*   **Cho phép Ping (ICMP Echo Request):**
    ```bash
    iptables -A INPUT -p icmp --icmp-type echo-request -j ACCEPT
    ```

*   **Bock/Chặn hoàn toàn thư từ một IP quấy rối (VD: 10.0.0.5):**
    ```bash
    iptables -A INPUT -s 10.0.0.5 -j DROP
    ```

### 5. Kịch bản VPN / Chia sẻ NAT mạng
Khi thiết lập một máy chủ OpenVPN hay WireGuard, bạn cần cho phép dải IP VPN được đi ra ngoài Internet thông qua card mạng của máy chủ (`eth0`).

*   **Cấu hình MASQUERADE (SNAT động) cho subnet VPN (Ví dụ: 10.8.0.0/24):**
    ```bash
    iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE
    ```
*   *(Đừng quên kích hoạt tính năng Forwarding trong Kernel Linux bằng lệnh `sysctl -w net.ipv4.ip_forward=1`)*

### 6. Lưu và Khôi phục cấu hình iptables
Các Rule tạo trực tiếp trên CLI sẽ bị **mất hoàn toàn sau khi khởi động lại máy chủ**. Bạn cần lưu chúng lại:

*   **Trên Ubuntu/Debian:** Dùng gói `iptables-persistent`
    ```bash
    # Lưu cấu hình:
    iptables-save > /etc/iptables/rules.v4
    # Khôi phục (Thường tự động load khi boot nếu chạy dịch vụ netfilter-persistent):
    iptables-restore < /etc/iptables/rules.v4
    ```

*   **Trên CentOS/RHEL/Rockylinux:**
    ```bash
    # Lưu cấu hình:
    service iptables save
    # Hoặc:
    iptables-save > /etc/sysconfig/iptables
    ```
