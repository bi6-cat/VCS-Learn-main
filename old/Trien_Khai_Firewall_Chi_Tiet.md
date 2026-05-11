# 1.5 Triển Khai Firewall Trong Thực Tế (Phân Zone & Policy) - Tùy Chỉnh Chuyên Sâu

Quá trình triển khai Firewall không chỉ đơn thuần là cắm điện và cắm cáp mạng. Trọng tâm của việc triển khai nằm ở cách người quản trị quy hoạch mạng (Network Segmentation) và định nghĩa các bộ quy tắc (Policy/Ruleset). Một thiết kế lỏng lẻo sẽ tạo ra vô số lỗ hổng bảo mật, trong khi một thiết kế quá khắt khe sẽ làm gián đoạn công việc kinh doanh (Business Interruption).

---

## 1. Phân Vùng Mạng (Network Zones / Segmentation)

Nguyên lý cơ bản nhất của Firewall là **không tin tưởng bất kỳ ai**. Để quản lý sự "không tin tưởng" này, mạng được chia thành các **Zone (Vùng)**. Mỗi Zone đại diện cho một mức độ tin cậy (Trust Level) nhất định.

### Các Zone Tiêu Chuẩn Trong Doanh Nghiệp

| Tên Zone | Mức Độ Tin Cậy (0-100) | Mô Tả & Chức Năng |
| :--- | :---: | :--- |
| **UNTRUST (WAN / Internet)** | 0 | Vùng kết nối trực tiếp ra mạng công cộng (Internet). Hoàn toàn không đáng tin cậy. Mọi luồng đi từ đây vào mặc định bị DROP. |
| **DMZ (Demilitarized Zone)** | 50 | Vùng phi quân sự. Chứa các cụm máy chủ Public (Web Server, Mail Gateway, DNS External). Máy ở đây rủi ro bị tấn công rất cao nên bị cách ly gắt gao với LAN. |
| **GUEST (Mạng Khách)** | 20 | Vùng cung cấp Wi-Fi cho khách vãng lai hoặc thiết bị cá nhân (BYOD). Chỉ được phép chọc thẳng ra Internet, cấm tuyệt đối truy cập dịch vụ nội bộ. |
| **TRUST (LAN / Nội bộ)** | 80 - 100 | Vùng mạng dành cho máy tính nhân viên, máy in. Có đặc quyền kết nối ra Internet và DMZ theo nhu cầu công việc. |
| **SERVER_LAN (DC/Database)**| 100 | Vùng lõi trung tâm dữ liệu. Chứa các hệ thống tối quan trọng: Active Directory, Database Server, ERP. Ngay cả mạng Trust cũng chỉ được vào vùng này bằng các cổng (Port) cụ thể. |
| **MANAGEMENT (MGT)** | 100 | Vùng mạng băng tần ngoài (Out-of-band). Chỉ Ban Giám Đốc/IT Admin mới được vào để kết nối SSH/HTTPS quản trị các thiết bị Switch, Router, Firewall. |

*Lưu ý: Mức độ tin cậy càng cao (VD: 100) thì càng được bảo vệ nghiêm ngặt. Phân zone giúp thu hẹp phạm vi ảnh hưởng (Blast Radius) nếu một thiết bị trong mạng bị nhiễm mã độc.*

---

## 2. Nguyên Tắc Thiết Kế Bộ Quy Tắc (Firewall Policy / Ruleset)

Tường lửa xử lý gói tin dựa trên danh sách các Rule. Việc viết Rule cần tuân thủ 3 nguyên tắc bất di bất dịch:

### A. Quá Trình Xử Lý Từ Trên Xuống Dưới (Top-Down / First-Match)
Firewall đọc các quy tắc từ Rule #1 trở xuống. 
- Khi gói tin thỏa mãn với một Rule nào đó (Action là ALLOW hoặc DROP), Firewall sẽ **dừng lại ngay lập tức** và áp dụng hành động đó. Nó **không đọc tiếp** các rule bên dưới nữa.
- Lỗi phổ biến nhất: Đặt rule chặn (Block) phía dưới một rule cho phép Rộng (Allow Any). Gói tin đã lọt qua mất rồi mới đến rule chặn. Do đó, quy tắc cụ thể (Specific) phải ưu tiên nằm phía trên quy tắc chung (General).

### B. Mặc Định Từ Chối Tất Cả (Implicit/Default Deny)
Tất cả các hệ thống Firewall tiêu chuẩn luôn có một Rule ẩn nằm ở dòng **cuối cùng** của cấu hình:
`Rule cuối: TỪ MỌI ĐỊA CHỈ -> ĐẾN MỌI ĐỊA CHỈ -> ACTION: DROP`
Nghĩa là: Bất cứ lưu lượng nào không khớp với các quy tắc bạn đã cho phép một cách rõ ràng ở phía trên, nó sẽ tự động bị quăng vào sọt rác và ghi Log.

### C. Nguyên Tắc Đặc Quyền Tối Thiểu (Principle of Least Privilege)
- Không bao giờ sử dụng từ khóa `ANY` (Bất kỳ) một cách lười biếng.
- Ví dụ sai: *Cho phép PC Giám Đốc truy cập MỌI CỔNG (Port Any) tới máy chủ Kế toán.*
- Ví dụ đúng: *Chỉ cho phép PC Giám Đốc truy cập CỔNG 80 (HTTP) để xem báo cáo trên máy chủ Kế toán.* Nếu máy giám đốc bị nhiễm Ransomware SMB/RDP (Cổng 445/3389), máy chủ Kế toán vẫn an toàn.

---

## 3. Quy Trình 6 Bước Triển Khai Firewall Thực Tế

Việc bật Firewall lên và cấu hình mù quáng sẽ dẫn đến thảm họa đứt mạng diện rộng. Quy trình chuyên nghiệp bao gồm:

1. **Khảo Sát & Thu Thập Yêu Cầu (Requirement Gathering):** Phỏng vấn các phòng ban xem họ xài ứng dụng gì, từ IP nào qua IP nào.
2. **Quy Hoạch Vùng (Zone Design) & Phân Bổ IP:** Nhóm các phòng ban thành các Zone VLAN riêng. Tránh để 1 lớp mạng phẳng (Flat Network) 192.168.1.0/24 cho toàn bộ công ty.
3. **Lập Ma Trận Luồng (Traffic Matrix):** Lập bảng Excel đánh dấu luồng từ Zone A sang Zone B với Port tương ứng (VD: LAN đi DMZ cổng 80).
4. **Tạo Đối Tượng (Object-based Rule Writing):** Tại màn hình Firewall, thay vì gõ IP chay như `192.168.1.10`, hãy tạo các biến đối tượng (Object) như `obj_server_ketoan` hoặc nhóm `grp_ban_giam_doc`. Khi cấu hình IP thay đổi, chỉ cần sửa Object, toàn bộ Rule tự động cập nhật.
5. **Đưa Vào Môi Trường Chạy Thử (Staging/Permissive Mode):** Trước tiên, viết Rule DROP, nhưng cấu hình bật chế độ "Simulate - Chỉ ghi Log chứ không chặn thật". Đợi 1 tuần để lấy log xem có chặn nhầm luồng làm việc hợp lệ nào không.
6. **Go-Live (Lockdown) & Giám Sát:** Kích hoạt chế độ Chặn chặn hẳn (Enforce block). Hàng ngày kiểm tra Traffic Monitor và Threat Log.

---

## 4. Xây Dựng Policy Matrix Và Ví Dụ Cấu Hình

Ma trận luồng giúp hình dung nhanh chóng điều gì được phép và điều gì bị nghiêm cấm trong cơ quan.

**Ma Trận Traffic (Theo cơ chế Default Deny):**

| TỪ ZONE (Source) \ ĐẾN (Destination) | UNTRUST (Internet) | DMZ (Web Server) | TRUST (Nhân viên) | MGT (Vùng quản trị) |
|---|---|---|---|---|
| **UNTRUST (Internet)** | Không xét | Chỉ mở Port `80, 443` (HTTP/S) | `❌ DENY Xuyên thấu` | `❌ DENY Cấm rà quét` |
| **DMZ (Web Server)** | `✅ ALLOW` Cập nhật Linux/Bản vá | Không xét | `❌ DENY` (Ngăn lây nhiễm ngược) | `❌ DENY` |
| **TRUST (Nhân viên)** | `✅ ALLOW` Lướt web (Trừ trang cấm) | `✅ ALLOW` Test Web nội bộ | Không xét | `✅ ALLOW` (SSH nội bộ) |

### Pseudo-code: Cấu hình ví dụ cho Ma trận trên

```bash
# [CỤM QUY TẮC #1 - CHO PHÉP TRUST ZONE: Bắt buộc lướt Web hoặc làm việc]
RULE 10: Tên: Lan_To_Internet
         Khu vực Nguồn: TRUST      (Mạng 10.0.1.0/24)
         Khu vực Đích: UNTRUST    (Bất kỳ/0.0.0.0)
         Cổng dịch vụ: Cổng 80, 443, 53 (HTTP, HTTPS, DNS)
         Hành động: ALLOW (Đồng thời bật NAT/PAT)

RULE 11: Tên: Admin_To_Management
         Khu vực Nguồn: TRUST (Chỉ IP 10.0.1.250 - PC IT)
         Khu vực Đích: MGT_ZONE (Mạng 172.16.0.0/24)
         Cổng dịch vụ: Cổng 22, 443 (SSH, WebGUI)
         Hành động: ALLOW 

# [CỤM QUY TẮC #2 - BẢO VỆ DMZ ZONE TỪ NGOÀI VÀO]
RULE 20: Tên: Internet_To_DMZ_Web
         Khu vực Nguồn: UNTRUST    (Bất kỳ IP Pubilc)
         Khu vực Đích: DMZ        (IP Web Server: 192.168.10.50)
         Cổng dịch vụ: Cổng 80, 443
         Hành động: ALLOW (Kèm tính năng DPI soi mã độc XSS)

RULE 21: Tên: Ping_Monitor_DMZ
         Khu vực Nguồn: Bất kỳ
         Khu vực Đích: DMZ
         Cổng dịch vụ: ICMP (Echo Request)
         Hành động: ALLOW (Giới hạn tối đa 5 ping/giây để chống Flood)

# [CỤM QUY TẮC #3 - CHỐNG LÂY NHIỄM CHÉO DMZ -> TRUST]
RULE 30: Tên: Block_DMZ_to_LAN
         Khu vực Nguồn: DMZ        (Mạng 192.168.10.0/24)
         Khu vực Đích: TRUST      (Mạng 10.0.1.0/24)
         Cổng dịch vụ: ANY
         Hành động: DROP và LƯU LOG cảnh báo rủi ro lây nhiễm.

# [CUỐI CÙNG LÀ CLEAN-UP RULE Tự động của Hệ thống]
RULE 999: Tên: Deny_All
         Khu vực Nguồn: ANY
         Khu vực Đích: ANY
         Cổng dịch vụ: ANY
         Hành động: DROP & LOG
```

---

*Lưu ý cho việc vận hành: Firewall Rule giống như những chiếc lưới. Theo thời gian, một công ty 5 năm tuổi có thể tích lũy hàng ngàn Rule (do nhân sự IT cũ tạo ra rồi nghỉ việc để lại di sản). Cần tiến hành **Rule Optimization / Rule Review** mỗi 6 tháng để xóa bỏ các Rule rác (Shadow/Unused Rules).*