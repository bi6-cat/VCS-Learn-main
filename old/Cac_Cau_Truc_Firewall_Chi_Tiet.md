# 1.4 Các Cấu Trúc Firewall (Kiến Trúc Tường Lửa) - Phân Tích Chuyên Sâu

Việc lựa chọn loại tường lửa (Packet Filtering, Stateful, NGFW...) là quan trọng, nhưng việc đặt tường lửa đó ở đâu và thiết kế sơ đồ luồng dữ liệu như thế nào (Kiến trúc) cũng quan trọng không kém. Một kiến trúc tồi có thể khiến tường lửa đắt tiền nhất trở nên vô dụng.

Dưới đây là các mô hình cấu trúc Firewall từ cơ bản đến nâng cao thường được áp dụng trong thực tế.

---

## 1. Screening Router (Kiến trúc Bộ định tuyến lọc gói)

Đây là kiến trúc cơ bản và sơ khai nhất, thường áp dụng cho các văn phòng rất nhỏ hoặc mạng gia đình.

### Sơ đồ mô hình
```text
[Internet] ═══════ [Screening Router] ═══════ [Mạng nội bộ - LAN]
```

### Cách thức hoạt động
- Không dùng thiết bị Firewall chuyên dụng. Thay vào đó, nó sử dụng ngay thiết bị định tuyến (Router) kết nối với Internet.
- Quản trị viên cấu hình các danh sách kiểm soát truy cập (Access Control List - ACL) trực tiếp trên Router này để đóng/mở các cổng hoặc cấm/cho phép IP. 
- Nó đóng vai trò như một **Packet Filtering Firewall** (Tường lửa lọc gói tin).

### Đánh giá
- **Ưu điểm:** Tiết kiệm chi phí tối đa vì tận dụng luôn Router có sẵn, tốc độ xử lý nhanh, mạng gọn nhẹ.
- **Nhược điểm:** Mức độ bảo mật thấp (không có khả năng chống giả mạo IP, không theo dõi trạng thái Stateful). Cấu hình ACL trên Router rất nhọc nhằn, dễ nhầm lẫn. Nếu Router bị xâm nhập, toàn bộ mạng LAN sẽ mở toang.

---

## 2. Dual-Homed Host (Kiến trúc máy chủ đa homed / Bastion Host)

Kiến trúc này sử dụng một máy tính (hoặc server) chuyên dụng làm bức tường chắn duy nhất, được gọi là **Bastion Host** (Lô cốt bảo vệ).

### Sơ đồ mô hình
```text
           ┌───────── Card mạng WAN (Public IP)
           │
[Internet] ┼─────── [Bastion Host / Điểm làm Proxy]
           │                  │ (Chuyển tiếp trung gian)
           └───────── Card mạng LAN (Private IP) ───────── [Mạng nội bộ]
```

### Cách thức hoạt động
- **Máy chủ trang bị 2 Card mạng (NIC):** Một cắm thẳng ra Internet, một cắm vào mạng LAN nội bộ.
- **Cấm định tuyến trực tiếp:** Tính năng IP Forwarding của máy chủ này bị **vô hiệu hóa**. Gói tin không thể đi trực tiếp từ Internet vào LAN.
- Mọi luồng dữ liệu muốn ra hay vào đều phải thông qua các phần mềm Proxy (như Squid) hoặc Application Firewall cài trên máy chủ Bastion này. Proxy sẽ đọc, "thanh lọc" nội dung và tự tạo kết nối mới tới đích.

### Đánh giá
- **Ưu điểm:** Bảo mật ở tầng ứng dụng rất cao. Mạng nội bộ hoàn toàn vô hình với bên ngoài.
- **Nhược điểm:** Hiệu năng mạng phụ thuộc hoàn toàn vào sức mạnh CPU/RAM của máy Bastion. Trở thành nút thắt cổ chai (Bottleneck). Nếu Hacker nắm được quyền điều khiển (Root) của Bastion Host này, họ sẽ xâm nhập được vào LAN.

---

## 3. Screened Host Architecture (Kiến trúc máy chủ được che chắn)

Để khắc phục nhược điểm của 2 kiến trúc trên, Screened Host kết hợp cả Screening Router và Bastion Host vào cùng một mô hình.

### Sơ đồ mô hình
```text
                                (Chỉ cho phép traffic đến Bastion)
[Internet] ════ [Screening Router] ════════╦════════ [Mạng nội bộ]
                                           ║
                                     [Bastion Host]
```

### Cách thức hoạt động
Có hai lớp bảo vệ độc lập:
1. **Lớp 1 (Screening Router):** Giao tiếp Internet, chặn ngay các gói tin rõ ràng là độc hại. Điều quan trọng nhất: Nó cấu hình **chỉ cho phép** các kết nối bên ngoài đi tới máy Bastion Host, mọi yêu cầu đi thẳng vào LAN đều bị rụng (Drop).
2. **Lớp 2 (Bastion Host):** Kiểm tra nội dung ở tầng ứng dụng sâu hơn. User từ mạng LAN muốn ra Internet cũng phải đẩy traffic về Bastion Host này.

### Đánh giá
- **Ưu điểm:** Khó bị thâm nhập hơn nhiều. Kẻ tấn công phải vượt qua cả Router và Bastion Host mới phá được hệ thống. Bộ định tuyến chặn bớt tải rác, giúp máy Bastion hoạt động hiệu quả hơn.
- **Nhược điểm:** Máy Bastion Host vẫn nằm cùng lớp mạng LAN nội bộ. Nếu hacker chiếm được Bastion bằng kỹ thuật tinh vi (ví dụ qua lỗi phần mềm Proxy), lằn ranh cuối cùng với mạng LAN sẽ biến mất.

---

## 4. Screened Subnet Architecture / DMZ (Kiến trúc vùng phi quân sự DMZ)

Đây là **tiêu chuẩn vàng** và phổ biến nhất trong mọi thiết kế bảo mật mạng của doanh nghiệp hiện đại. Mục tiêu tối thượng của nó là cô lập các máy chủ công cộng ra khỏi mạng LAN.

### Sơ đồ mô hình
Có thể dùng 1 Firewall đa cổng, hoặc 2 Firewall xếp chồng. Dưới đây là mô hình 2 Firewall (mức siêu an toàn):
```text
[Internet] 
    │
[Outer Firewall] ── (Tường lửa ngoài: Bứng dội các cuộc tấn công mặt ngoài)
    │
├── VÙNG DMZ ─── [Web Server] / [Mail Server] / [DNS Server]
│   (Vùng cách ly chứa các server bắt buộc public cho Internet truy cập)
│
[Inner Firewall] ── (Tường lửa trong: Rất khắt khe, chỉ cho phép luồng sạch)
    │
[Mạng Nội Bộ - LAN] ── (Vùng Trust: Chứa PC người dùng, Database nhạy cảm, AD Server)
```

### Cách thức hoạt động
- **DMZ (Demilitarized Zone):** Là vùng mạng con thứ 3 đứng ở giữa Internet và mạng Nội bộ. Tại đây đặt các Server như Web, Mail (những máy chủ mà người ngoài bắt buộc phải chọc vào).
- **Phân tách luồng:**
  - Internet chỉ có quyền đi vào vùng DMZ (cổng 80/443).
  - Internet **tuyệt đối không được** đi vào LAN.
  - Các Server trong DMZ **bị cấm** tự ý khởi tạo kết nối vào LAN (Nếu Web bị hack, hacker không thể từ Web server nhảy sang Database server trong LAN dễ dàng).
  - Người dùng LAN được phép truy cập Internet và quét quản trị DMZ.

### Đánh giá
- **Ưu điểm:** Khả năng phòng thủ theo chiều sâu (Defense-in-depth) hoàn hảo. Dù Web server có bị đánh sập và hacker làm chủ máy chủ đó, chúng vẫn bị nhốt trong khu vực DMZ bởi hệ thống Tường lửa bên trong (Inner Firewall).
- **Nhược điểm:** Cấu hình phức tạp. Tốn kém chi phí cực lớn vì phải duy trì nhiều thiết bị tường lửa mạnh mẽ, hệ thống cáp mạng, switch riêng biệt.

---

## 5. High Availability (HA) Firewall (Kiến trúc dự phòng độ sẵn sàng cao)

Với các thiết kế trên, nếu "cục" Firewall hỏng phần cứng hoặc mất điện nguồn, toàn bộ công ty không thể ra Internet hoặc Website sập. Kiến trúc HA giải quyết bài toán cốt lõi đó: **Tránh điểm chết duy nhất (SPOF - Single Point of Failure)**.

### Sơ đồ mô hình
```text
                      ┌─── [Firewall A (Primary)] ────┐
[Internet / WAN Switch]                               ├──── [LAN Switch]
                      └─── [Firewall B (Standby)] ────┘
                         (Kênh Heartbeat đồng bộ trạng thái)
```

### Các chế độ vận hành:
1. **Active/Passive (Hoạt động/Dự phòng):** 
   - Firewall A ở trạng thái "Active", gánh 100% traffic.
   - Firewall B "Ngủ đông" nghe ngóng qua cáp Heartbeat. 
   - Nếu A chết, B lập tức thức dậy, chiếm lấy IP và MAC của A để gánh hạ tầng mạng trong vài mili-giây. Kết nối của users không bị đứt.
2. **Active/Active (Cân bằng tải kép):**
   - Cả A và B đều sống và chia nhau xử lý traffic (giúp x2 băng thông mạng).
   - Nếu một con đứt, con còn lại sẽ phải gánh 100% tải mạng.
   
### Đánh giá
- **Ưu điểm:** SLA hệ thống đạt 99.999%. Rất đáng tin cậy. Nếu Firewall chính cần nâng cấp Firmware chờ reboot mất 5 phút, Firewall phụ sẽ gánh mà Business không hề hay biết.
- **Nhược điểm:** Phải mua 2 thiết bị Tường lửa y hệt nhau, License tốn gấp đôi (hoặc gấp 1.5 lần tuỳ hãng). Đòi hỏi hệ thống Switch kết nối 2 đầu cũng phải là mô hình HA (có Spanning Tree, vPC, VSS...).

---

### Tổng Kết Lựa Chọn Kiến Trúc

| Quy mô tổ chức | Kiến trúc đề xuất | Mức chi phí | Độ an toàn |
| :--- | :--- | :--- | :--- |
| **Cá nhân, SOHO** (Cửa hàng nhỏ) | Screening Router (Dùng Modem/Router ISP cấp) | Cực Thấp | Thấp |
| **Văn phòng vừa (SME)** (Chỉ có máy trạm) | Tường lửa tích hợp (Stateful) đặt tại biên | Trung bình | Tốt |
| **Cơ quan có hệ thống Web/Mail riêng** | Screened Subnet (DMZ) Architecture | Cao | Rất Tốt |
| **Doanh nghiệp lớn, Data Center, Ngân hàng**| DMZ kết hợp NGFW HA (Active/Passive) nhiều lớp | Vô cùng cao | Gần như Tuyệt Đối |