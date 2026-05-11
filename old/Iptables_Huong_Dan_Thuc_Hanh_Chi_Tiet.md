# Hướng Dẫn Thực Hành iptables Chi Tiết (Từ Cơ Bản Đến Nâng Cao)

`iptables` là một công cụ tường lửa (firewall) mạnh mẽ trên hệ điều hành Linux, hoạt động dựa trên Netfilter. Bài viết này hướng dẫn chi tiết các lệnh thực hành từ mức độ cơ bản đến nâng cao.

---

## Phần 1: Kiến thức nền tảng (Cần nắm vững)

`iptables` hoạt động dựa trên 3 khái niệm chính: **Tables (Bảng)**, **Chains (Chuỗi)**, và **Rules (Quy tắc)**.

1. **Tables (Bảng)**: Phân loại mục đích của rule.
   - `filter`: (Mặc định) Dùng để lọc gói tin (cho phép chạy qua hay chặn lại).
   - `nat`: Dùng để chuyển đổi địa chỉ mạng (Network Address Translation - Forward port, chia sẻ internet).
   - `mangle`: Dùng để thay đổi/đánh dấu gói tin.
   - `raw`: Tương tác với gói tin trước khi nó được theo dõi bởi connection tracking.

2. **Chains (Chuỗi)**: Thời điểm/vị trí gói tin được xử lý.
   - `INPUT`: Gói tin đi vào máy chủ (đích đến là máy chủ).
   - `OUTPUT`: Gói tin đi ra từ máy chủ (xuất phát từ máy chủ).
   - `FORWARD`: Gói tin đi qua máy chủ (định tuyến sang máy khác).
   - `PREROUTING`: Xử lý gói tin ngay khi vừa vào interface (trước lúc định tuyến).
   - `POSTROUTING`: Xử lý gói tin trước khi nó rời interface (sau lúc định tuyến).

3. **Targets (Hành động)**: Điều sẽ xảy ra nếu gói tin khớp với quy tắc.
   - `ACCEPT`: Chấp nhận gói tin.
   - `DROP`: Hủy bỏ gói tin (không phản hồi gì lại cho nguồn, giống như tàng hình).
   - `REJECT`: Từ chối gói tin (có gửi thông báo lỗi ngược lại cho nguồn).
   - `LOG`: Ghi lại log để phân tích.

---

## 🌟 Chuẩn Bị Mô Hình Lab Thực Hành Trên VirtualBox

Để thực hành đầy đủ các kịch bản của iptables (đặc biệt là NAT và Port Forwarding), bạn không thể chỉ dùng 1 máy ảo. Dưới đây là hướng dẫn setup mô hình 2 hoặc 3 VMs chuẩn nhất:

### 1. Mô hình đề xuất (Nên dùng mô hình 2 VMs hoặc 3 VMs)

**Mô hình 2 VMs (Dành cho thực hành Cơ bản & Trung cấp):**
*   **VM1 (Firewall / Web Server):** 
    *   Card mạng 1: NAT (Để tải các gói cài đặt từ Internet).
    *   Card mạng 2: **Host-only Adapter** (Để bạn dùng máy thật SSH vào hoặc làm Client tấn công) HOẶC **Internal Network** (Tên: `lab-net`).
*   **VM2 (Client / Attacker):**
    *   Card mạng 1: **Host-only Adapter** hoặc **Internal Network** (`lab-net`) cùng dải mạng với VM1.
    *   *Mục đích:* Dùng VM2 để ping, ssh, hoặc giả lập tấn công flood sang VM1 để kiểm tra iptables chặn có đúng không.

**Mô hình 3 VMs (Dành cho thực hành Nâng cao - NAT / Router):**
*   **VM1 (Iptables Router / Gateway):** Đóng vai trò là cửa ngõ.
    *   Card mạng 1 (WAN): NAT hoặc Bridged (Có Internet).
    *   Card mạng 2 (LAN): **Internal Network** (Tên: `quang-vbox`, IP tĩnh ví dụ: 192.168.10.1).
*   **VM2 (Web Server Nội Bộ):**
    *   Card mạng 1: **Internal Network** (Tên: `quang-vbox`, IP tĩnh: 192.168.10.10, Gateway trỏ về 192.168.10.1 của VM1).
    *   *Mục đích:* KHÔNG tự ra được Internet. Phải nhờ VM1 cấu hình SNAT (Masquerade) mới ra được mạng.
*   **VM3 (External Client / Attacker):** (Tùy chọn, có thể dùng luôn máy thật Host).
    *   Nằm khác dải mạng với VM2, dùng để test tính năng Port Forwarding (DNAT) - truy cập IP của VM1 nhưng lại vào được Web Server VM2.

### 2. Các Lưu Ý Tránh Nhầm Lẫn Trên VBox

1. **Tên Card Mạng (Network Interface):** Các tài liệu mặc định thường dùng `eth0`. Tuy nhiên trên máy ảo VirtualBox (và các bản Linux hiện đại), tên card mạng thường là `enp0s3`, `enp0s8`... Hãy gõ lệnh `ip a` hoặc `ifconfig` để kiểm tra tên card mạng thực tế của bạn và sửa đổi trong các lệnh iptables (ví dụ: đổi `-i eth0` thành `-i enp0s3`).
2. **Ping Không Lên:** Nếu bạn set 2 máy dùng *Internal Network* mà chưa đặt IP tĩnh tương thích cùng một Subnet (ví dụ cùng dải 192.168.x.x), 2 máy ảo sẽ không thể giao tiếp với nhau. Hãy dùng lệnh `nmtui` hoặc chỉnh file `/etc/network/interfaces` (hoặc netplan) để set IP tĩnh trước khi cấu hình iptables.
3. **Phao Cứu Sinh:** Điểm rất sướng khi Dùng VirtualBox là nếu lỡ gõ sai lệnh `DROP` làm ngắt kết nối SSH, bạn chỉ cần mở thẳng cửa sổ màn hình đen của VirtualBox để sửa (vì giao diện cục bộ `lo` không đi qua card mạng nên không bị khóa bởi iptables).

---

## Phần 2: Thực Hành Căn Bản

### 1. Xem danh sách quy tắc hiện tại
```bash
# Xem các rule của bảng filter (mặc định)
sudo iptables -L

# Xem chi tiết hơn kèm địa chỉ IP và port số học (không phân giải tên miền)
sudo iptables -L -n -v

# Xem kèm theo dòng số (Line numbers) để dễ dàng xóa hoặc chèn rule
sudo iptables -L -n -v --line-numbers
```
*Giải thích: `-L` (List), `-n` (Numeric), `-v` (Verbose).*

### 2. Xóa các quy tắc hiện có (Flush)
```bash
# Xóa toàn bộ rule ở bảng filter
sudo iptables -F

# Xóa toàn bộ rule ở bảng nat
sudo iptables -t nat -F
```
*Lưu ý: Nếu bạn đang ssh từ xa, hãy cẩn thận với lệnh này vì nó có thể làm ngắt kết nối SSH nếu chính sách mặc định là DROP.*

### 3. Thiết lập Policy (Chính sách mặc định)
Policy là hành động mặc định nếu một gói tin không khớp với bất kỳ rule nào ở trên.
Một firewall an toàn thường sẽ chặn tất cả, chỉ cho phép những thứ cần thiết.

```bash
# Từ chối mọi lưu lượng đi vào
sudo iptables -P INPUT DROP

# Từ chối lưu lượng forward
sudo iptables -P FORWARD DROP

# Cho phép lưu lượng đi ra (Để server có thể tải gói từ internet về)
sudo iptables -P OUTPUT ACCEPT
```

### 4. Các Rule bắt buộc để server hoạt động bình thường
Dù policy mặc định có là DROP, bạn vẫn phải mở vài kết nối thiết yếu.

**a. Cho phép giao tiếp nội bộ (Loopback - 127.0.0.1)**
```bash
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A OUTPUT -o lo -j ACCEPT
```
*Giải thích: `-A` (Append - Thêm vào cuối), `-i` (In-interface - Giao diện vào), `-o` (Out-interface - Giao diện ra)*

**b. Cho phép các kết nối đã thiết lập từ trước (Stateful Firewall)**
Nếu server chủ động gửi request đi (ví dụ ping google.com), gói tin trả về phải được ACCEPT.
```bash
sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
```
*Giải thích: `-m conntrack` sử dụng module theo dõi kết nối, `--ctstate` chỉ định các gói tin thuộc kết nối từ trước hoặc liên quan.*

### 5. Mở các Port thông dụng (SSH, HTTP, HTTPS)
```bash
# Cho phép kết nối SSH (Port 22)
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Cho phép Web HTTP (Port 80) / HTTPS (Port 443)
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```
*Giải thích: `-p tcp` (Protocol), `--dport` (Destination port).*

---

## Phần 3: Thực Hành Trung Cấp (Chặn và Hạn Chế)

*(Thực hành theo Mô hình 2 VMs: Cấu hình trên VM1, dùng dùng VM2 đóng vai trò Client/Attacker có IP giả định là `192.168.1.100` để test chặn).*

### 1. Chặn IP cụ thể hoặc dải IP
```bash
# Trên VM1: Chặn VM2 (Attacker IP 192.168.1.100) truy cập
sudo iptables -A INPUT -s 192.168.1.100 -j DROP

# Chặn nguyên một dải mạng (Subnet)
sudo iptables -A INPUT -s 192.168.1.0/24 -j DROP
```
*Lưu ý: Nếu dùng `-A`, rule này sẽ thêm vào cuối (nếu có rule ACCEPT trước đó, gói tin vẫn qua). Bạn nên dùng `-I` đê chèn lên đầu tiên.*

```bash
# Chèn quy tắc chặn VM2 lên vị trí số 1 của chuỗi INPUT
sudo iptables -I INPUT 1 -s 192.168.1.100 -j DROP
```

### 2. Ngăn chặn Ping (ICMP Echo-Request)
Từ chối lệnh Ping nhưng hiển thị phản hồi "Destination Port Unreachable":
```bash
sudo iptables -A INPUT -p icmp --icmp-type echo-request -j REJECT
```

### 3. Xóa một rule cụ thể
Sử dụng Line Number (cần list ra trước).
```bash
# Bước 1: Xem số thứ tự
sudo iptables -L INPUT -n --line-numbers

# Bước 2: Xóa rule số 2 trong chuỗi INPUT
sudo iptables -D INPUT 2
```

---

## Phần 4: Thực Hành Nâng Cao (NAT & Chống Tấn Công)

*(Thực hành theo Mô hình 3 VMs: VM1 là Gateway, VM2 là Web LAN `192.168.10.10`, VM3 là máy Client bên ngoài đóng vai trò truy cập hoặc tấn công).*

### 1. Port Forwarding (DNAT - Chuyển tiếp cổng)
*Kịch bản 1: Người dùng truy cập port 8080 trên VM1, tự động chuyển hướng nội bộ tới port 80 của chính VM1.*

```bash
# Bật chuyển gói (Kernel IP Forwarding) trong hệ điều hành (Bắt buộc cho Router)
sysctl net.ipv4.ip_forward=1

# Rule REDIRECT - Trong bảng nat (Chuyển local port)
sudo iptables -t nat -A PREROUTING -p tcp --dport 8080 -j REDIRECT --to-port 80
```

*Kịch bản 2 (Rất phổ biến): VM3 truy cập IP của VM1 ở port 80, VM1 chuyển tiếp gói tin đó sang Web Server nội bộ VM2 (`192.168.10.10`).*
```bash
# Trên VM1: DNAT toàn bộ request port 80 đẩy về VM2
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j DNAT --to-destination 192.168.10.10:80
```

### 2. Chia sẻ kết nối Internet (SNAT / Masquerading)
*Kịch bản: VM1 đóng vai trò Router cấp Internet cho mạng LAN phía sau. Ta muốn VM2 (`192.168.10.0/24`) ra được mạng thông qua card WAN (`enp0s3`) của VM1.*

```bash
# Trên VM1: Dùng Masquerade cho địa chỉ IP động đi ra từ card enp0s3
sudo iptables -t nat -A POSTROUTING -s 192.168.10.0/24 -o enp0s3 -j MASQUERADE
```
*(Từ VM2 bạn có thể ping 8.8.8.8 để test, gói tin sẽ được đổi thành IP của VM1 trước khi ra Internet).*

### 3. Hạn chế số lượng kết nối (Chống DDoS / Brute Force)
*Kịch bản: Chống tình trạng VM3 cố block brute force dò mật khẩu SSH vào VM1. Giới hạn IP chỉ được SSH tối đa 4 kết nối mới trong 1 phút.*

```bash
sudo iptables -A INPUT -p tcp --dport 22 -m recent --name ssh --set -m rsouce
sudo iptables -A INPUT -p tcp --dport 22 -m recent --name ssh --update --seconds 60 --hitcount 4 -j DROP
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
```

*Kịch bản: Chống Ping Flood (giới hạn 1 ping/giây)*
```bash
sudo iptables -A INPUT -p icmp --icmp-type echo-request -m limit --limit 1/s -j ACCEPT
sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP
```

### 4. Lập Log (Ghi chú lại) các gói bị DROP
Lập log rất có ích cho việc Troubleshoot. (Logs thường được ghi vào `/var/log/syslog` hoặc `/var/log/messages`).

```bash
# Ghi lại những cái kết nối SSH mới bị chặn
sudo iptables -A INPUT -p tcp --dport 22 -m state --state NEW -j LOG --log-prefix "SSH-DROP: "
```
*Quy tắc chuẩn: Bạn phải đặt rule LOG trước rule DROP, nếu gói tin bị DROP rồi thì nó sẽ không kịp được LOG tới.*

---

## Phần 5: Lưu trữ lại các Rule (Persistent)

Khi khởi động lại Server, toàn bộ iptables rules trên RAM sẽ bị mất. Cần phải lưu lại.

**Trên Ubuntu/Debian:**
```bash
sudo apt-get install iptables-persistent

# Lưu cấu hình:
sudo netfilter-persistent save
```

**Trên CentOS/RHEL/Rockylinux:**
```bash
sudo yum install iptables-services
sudo systemctl enable iptables

# Lưu cấu hình:
sudo iptables-save > /etc/sysconfig/iptables
```

---

## Phần 6: Các Tình Huống Thực Tế Thường Gặp (Troubleshooting) & Cách Xử Lý

### Tình huống 1: Bị mất kết nối SSH sau khi áp dụng Policy (Locked out)
**Vấn đề:** Đang cấu hình iptables từ xa qua SSH, bạn gõ lệnh `iptables -P INPUT DROP` và ngay lập tức giao diện SSH bị đơ, văng kết nối và không thể vào lại.
**Nguyên nhân:** Lệnh DROP mặc định tất cả đã có hiệu lực nhưng bạn lại chưa mở port 22 (SSH) hoặc chưa thêm rule cho các kết nối đang duy trì (`ESTABLISHED`).
**Cách khắc phục:**
- **Cách cứu hộ:** Đăng nhập vào Server thông qua Terminal/Console của nhà cung cấp Server (như AWS EC2 Serial Console, VNC của VPS, v.v.). Đây là giao diện nội bộ nên không bị ảnh hưởng bởi firewall bên ngoài. Sau đó gõ `iptables -F` để xả toàn bộ rule.
- **Cách phòng chống:** Khi thử nghiệm các rule nguy hiểm từ xa, bạn nên hẹn giờ thiết lập lại. Bạn có thể dùng lệnh `echo "iptables -F" | at now + 5 min`. Nếu rule cấu hình đúng, bạn chỉ cần báo hủy lệnh at. Nếu bạn bị kích ra ngoài, 5 phút sau iptables sẽ tự reset và bạn có thể đăng nhập lại.

### Tình huống 2: Người dùng mở website từ Internet không được nhưng Server tự dùng thì được
**Vấn đề:** Server ping được, bạn ssh vào và chạy lệnh `curl localhost:80` thì đọc được website, nhưng lấy điện thoại truy cập IP lại thông báo từ chối. Bạn đã chạy lệnh `iptables -A INPUT -p tcp --dport 80 -j ACCEPT`.
**Nguyên nhân:** Sai lầm kinh điển về **thứ tự đọc rule** của iptables. iptables đọc từ trên xuống dưới. Tham số `-A` (Append) sẽ thêm rule xuống cuối cùng. Rất có thể trên bảng INPUT hiện tại đang có một rule `-A INPUT -j REJECT` hoặc `-j DROP` nào đó. Khi gói tin chạy tới cái rule DROP ở trên, nó bị hủy ngay lập tức và không bao giờ chạy đến dòng mở Port 80 nằm dưới cùng của bạn.
**Cách xử lý:** 
- Bạn cần kiểm tra lại đúng thứ tự các rule bằng `iptables -L INPUT -n --line-numbers`.
- Xóa rule ACCEPT bị sai số lượng.
- Sử dụng `-I` (Insert) thay vì `-A` để chèn rule ưu tiên cao, ví dụ chèn lên vị trí số 1: `iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT`.

### Tình huống 3: Tính năng Port Forwarding (DNAT) hoặc chia sẻ mạng NAT không thành công
**Vấn đề:** Bạn đã cấu hình các chuỗi PREROUTING và POSTROUTING ở bảng `nat` chuẩn như bài cấu hình chuyển port 8080 thành 80. Nhưng kết nối vẫn fail.
**Nguyên nhân:** Nhân lõi (Kernel) của các hệ điều hành Linux mặc định sẽ vô hiệu hóa khả năng định tuyến gói tin từ thiết bị này sang thiết bị khác nhằm đảm bảo an ninh (IP Forwarding Disabled). Do đó gói tin bị nghẽn lại ở bước FORWARD.
**Cách xử lý:**
- Mở IP Forwarding tạm thời ngay lập tức: `echo 1 > /proc/sys/net/ipv4/ip_forward` hoặc `sysctl net.ipv4.ip_forward=1`
- Mở vĩnh viễn để khi reboot không bị mất: Sửa file `/etc/sysctl.conf`, tìm dòng `net.ipv4.ip_forward=1` và xóa dấu `#` ở đầu dòng. Sau đó cập nhật bằng `sysctl -p`.

### Tình huống 4: Server cảnh báo đầy ổ cứng (Disk Full) do Log iptables quá lớn
**Vấn đề:** Bạn muốn lập Log tất cả các gói tin bị lỗi và chạy quy tắc: `iptables -A INPUT -j LOG`. Đột nhiên vài ngày sau server tắt hẳn dịch vụ vì phân vùng `/var/log` đầy dung lượng, mở ra thấy hàng trăm ngàn cuộc tấn công quét mạng tự động.
**Nguyên nhân:** Các hệ thống bots Internet quét các IP server 24/7. Việc LOG trực tiếp mà không có phễu độ trễ sẽ khiến log file dài siêu nhanh.
**Cách xử lý:**
- Luôn kết hợp module `limit` vào rule LOG để chặn số lượng ghi log sinh ra mỗi giây/phút.
- Sửa lại rule ghi log chặn với độ trễ (ví dụ tối đa 5 log mỗi phút):
  `iptables -A INPUT -p tcp -m limit --limit 5/m -j LOG --log-prefix "DROP-Firewall: "`

---

## Tổng Kết Workflow tốt nhất để bảo mật Server bằng iptables
1. Khôi phục trắng: `iptables -F`
2. Mở kết nối hiện hành: `iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`
3. Mở Loopback: `iptables -A INPUT -i lo -j ACCEPT`
4. Mở SSH: `iptables -A INPUT -p tcp --dport 22 -j ACCEPT` (Thêm giới hạn IP nếu cần).
5. Mở Web/Các dịch vụ khác...
6. Cuối cùng đóng Default Policy bằng `iptables -P INPUT DROP`
7. Lưu lại file cấu hình.
