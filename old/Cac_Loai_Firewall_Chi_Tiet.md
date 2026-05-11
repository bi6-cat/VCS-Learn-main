# 1.3 Các Loại Firewall - Phân Tích Chuyên Sâu

Sự phát triển của công nghệ mạng và các mối đe dọa an ninh đã thúc đẩy sự tiến hóa của Firewall qua nhiều thế hệ. Dưới đây là phân tích chi tiết về kiến trúc, cơ chế hoạt động, ưu nhược điểm của từng loại tường lửa phổ biến hiện nay.

---

## 1. Packet Filtering Firewall (Stateless Firewall - Tường lửa thế hệ 1)

Đây là hình thức tường lửa cơ bản và lâu đời nhất. Nó hoạt động như một trạm kiểm soát giao thông ở mức độ thấp.

### Mô hình hoạt động
- **Tầng OSI:** Hoạt động chủ yếu ở Tầng 3 (Network Layer) và Tầng 4 (Transport Layer).
- **Cơ chế:** Kiểm tra phần Header của các gói tin độc lập (Packet-by-packet) chạy qua thiết bị định tuyến (router) hoặc switch.
- **Tiêu chí lọc:** 
  - Địa chỉ IP nguồn (Source IP) và IP đích (Destination IP).
  - Cổng nguồn (Source Port) và Cổng đích (Destination Port).
  - Giao thức mạng (Protocol: TCP, UDP, ICMP, GRE...).

### Đặc điểm nổi bật
- **Không có bộ nhớ trạng thái:** Nó xử lý mỗi gói tin như một phần tử riêng biệt. Khi gói tin A đi ra, nó không nhớ để tự động cho phép gói tin phản hồi B đi vào. Quản trị viên phải cấu hình Rule 2 chiều (Inbound & Outbound) cho mỗi luồng dữ liệu.

### Ưu điểm & Nhược điểm
- **Ưu điểm:**
  - Tốc độ xử lý cực kỳ nhanh, độ trễ (latency) gần như bằng không.
  - Ít tiêu tốn tài nguyên phần cứng (CPU, RAM).
  - Rất hiệu quả khi dùng để chặn các dải IP đen (Blacklist) hoặc chống DDoS (tầng mạng) quy mô lớn ở vòng ngoài cùng.
- **Nhược điểm:**
  - Dễ bị qua mặt (bypass) bằng kỹ thuật giả mạo địa chỉ IP (IP Spoofing).
  - Không biết được gói tin chứa gì bên trong (Payload), do đó không thể chặn malware.
  - Phải mở nhiều cổng (ví dụ cổng cao cho nhận HTTP response) dẫn đến nguy cơ bảo mật.

---

## 2. Stateful Inspection Firewall (Tường lửa thế hệ 2)

Được phát triển để khắc phục điểm yếu của Packet Filtering, Stateful Firewall hiện là tiêu chuẩn tối thiểu cho bất kỳ hệ thống mạng nào.

### Mô hình hoạt động
- **Tầng OSI:** Tầng 3, 4 và có thể theo dõi một phần thông tin giao thức.
- **Cơ chế:** Lưu trữ "Trạng thái" (State) của toàn bộ các kết nối từ lúc bắt đầu (bắt tay 3 bước của TCP) đến khi kết thúc (FIN/RST) vào một bảng gọi là **State Table** (Bảng trạng thái).

### Quá trình xử lý
1. Gói tin đầu tiên (TCP SYN) đến -> Firewall kiểm tra Rule (ACL).
2. Nếu được phép (ALLOW) -> Firewall cho qua và tạo 1 mục (entry) trong State Table đánh dấu trạng thái `NEW`.
3. Khi gói tin phản hồi (TCP SYN-ACK) hoặc các gói tin dữ liệu tiếp theo quay lại -> Firewall tra cứu State Table.
4. Nhận thấy gói tin thuộc một phiên hợp lệ (`ESTABLISHED` hoặc `RELATED`), firewall tự động cho qua mà không cần quét lại Rule từ đầu mút.

### Ưu điểm & Nhược điểm
- **Ưu điểm:**
  - Bảo mật tốt hơn rất nhiều so với Stateless vì nó chặn được các luồng dữ liệu "bất ngờ" không có yêu cầu từ mạng nội bộ.
  - Giảm thiểu việc phải viết Rule phản hồi (chỉ cần viết Rule chiều đi, chiều về tự động được phép).
  - Chống giả mạo kết nối hiệu quả.
- **Nhược điểm:**
  - Tốn tài nguyên RAM để duy trì bảng State Table.
  - Dễ trở thành nạn nhân của tấn công State Exhaustion (Làm cạn kiệt bảng trạng thái) như TCP SYN Flood.

---

## 3. Application Layer / Proxy Firewall (Tường lửa thế hệ 3)

Proxy Firewall không cho phép thiết bị bên trong và bên ngoài kết nối trực tiếp với nhau. Nó đứng ở giữa, đóng vai trò "người đóng thế" (Middleman).

### Mô hình hoạt động
- **Tầng OSI:** Hoạt động tại Tầng 7 (Application Layer).
- **Cơ chế (Reverse Proxy / Forward Proxy):**
  - Khi Client muốn tải trang Web, Client kết nối với Proxy.
  - Proxy tiếp nhận, thẩm định yêu cầu, "bóc" gói dữ liệu ra để xem nội dung ở tầng ứng dụng (HTTP GET/POST, FTP commands...).
  - Nếu nội dung an toàn, Proxy tự khởi tạo một kết nối mới tới Server đích.

### Đặc điểm nổi bật
- Có khả năng hiểu các "Lệnh" (Command) của từng giao thức cụ thể. Ví dụ: Cho phép dùng FTP để xem thư mục (LIST, GET) nhưng không cho phép đăng tải file (chặn lệnh PUT/STOR).

### Ưu điểm & Nhược điểm
- **Ưu điểm:**
  - An toàn cực cao, do luồng mạng (Network layer) đã bị cắt đứt hoàn toàn ở giữa (máy chủ ngoài không bao giờ biết được IP thật của máy trạm).
  - Khả năng kiểm tra nội dung (Payload) siêu sâu, chặn được các lệnh ứng dụng bất hợp pháp.
  - Lọc nội dung Web (URL Filtering), caching dữ liệu tốt.
- **Nhược điểm:**
  - Chậm, gây độ trễ đáng kể cho mạng do phải tháo dỡ gói tin, phân tích đoạn mã và đóng gói lại.
  - Cấu hình phức tạp, thường làm sụp đổ các ứng dụng thời gian thực hoặc các giao thức không theo chuẩn.

---

## 4. Next-Generation Firewall - NGFW (Tường lửa thế hệ 4)

Đây là chuẩn mực Firewall cho doanh nghiệp hiện đại, kết hợp tất cả các ưu điểm của các thế hệ trước và bổ sung thêm các bộ lọc an ninh tinh vi. (Ví dụ: Palo Alto, Fortinet, Cisco Firepower, Check Point).

### Các tính năng cốt lõi bổ sung:
1. **Deep Packet Inspection (DPI):** Kiểm tra sâu vào "lõi" dữ liệu của mọi gói tin chứ không chỉ dừng ở cổng (port) hay giao thức.
2. **Application Awareness (Nhận diện ứng dụng):** 
   - Firewall truyền thống chỉ biết Cổng 80/443 là Web.
   - NGFW biết được Cổng 443 đó đang chạy *Facebook*, *YouTube*, hay *Google Drive* nhờ chữ ký số của luồng dữ liệu. Từ đó có thể ra lệnh: "Cho phép dùng Facebook nhưng cấm chat trên Facebook".
3. **Intrusion Prevention System (IPS):** Tích hợp hệ thống ngăn chặn xâm nhập dựa trên các dâu hiệu (Signature-based) của các lỗ hổng đã biết, tự động chặn ngắt các loại Malware, exploit.
4. **User Identity Awareness:** Tích hợp với Active Directory/LDAP để tạo Rule dựa trên **Tên người dùng** (ví dụ: `User_Nam` được ra mạng) chứ không chỉ dựa trên địa chỉ IP.
5. **SSL/TLS Inspection:** Khả năng "giải mã" (Decrypt) luồng HTTPS để soi bên trong xem có chứa virus không, sau đó mã hóa lại và đẩy đi.

### Ưu điểm & Nhược điểm
- **Ưu điểm:** Khả năng bảo mật toàn diện "All-in-one" chống lại các mối đe dọa tinh vi (APT, Zero-day - nếu có hộp cát Sandbox). Quản trị tập trung, log phong phú.
- **Nhược điểm:** Chi phí đầu tư (Capex) và phí gia hạn bản quyền (Opex) hàng năm rất đắt. Quản trị viên cần kiến thức chuyên sâu để vận hành tối ưu thiết bị này.

---

## 5. Web Application Firewall (WAF)

WAF không được sinh ra để thay thế Network Firewall, nó là một mảng chuyên biệt dùng để bảo vệ riêng cho **Các ứng dụng Web**.

### Mô hình hoạt động
- **Vị trí:** Đứng ngay trước các Web Server (như Nginx, Apache, IIS).
- **Cơ chế:** Kiểm tra toàn bộ cấu trúc HTTP/HTTPS request. Phân tích tham số (Parameters), Cookies, Headers để tìm kiếm mẫu tấn công.

### Mục tiêu chặn đứng (OWASP Top 10):
- SQL Injection (Kẻ tấn công chèn mã SQL vào khung đăng nhập).
- Cross-Site Scripting - XSS (Chèn mã JavaScript độc hại vào trang web).
- Local File Inclusion / Path Traversal (Đọc trộm tệp tin hệ thống của máy chủ `/etc/passwd`).

### Ưu điểm & Nhược điểm
- **Ưu điểm:** Hiểu ngôn ngữ Web một cách tuyệt đối (hiểu được JSON, XML, REST API). Phản ứng rất tốt với các lỗ hổng cấp ứng dụng.
- **Nhược điểm:** Chỉ bảo vệ được môi trường Web (không bảo vệ được luồng SSH, FTP, hay mail SMTP v.v.). Thường gặp hiện tượng False-Positive (nhận diện nhầm người dùng hợp lệ thành bot tấn công).

---

## 6. Cloud Firewall (Firewall as a Service - FWaaS)

Sự chuyển dịch lên môi trường Đám mây (Cloud) kéo theo sự dịch chuyển của hệ thống Tường lửa ảo.

- **Đặc điểm:** Không phải là một cục sắt (Appliance) đặt trong tủ Rack, mà là một hệ thống phân tán được lưu trữ trên môi trường Cloud (AWS, Azure, GCP...).
- **Cơ chế bảo vệ:** 
  - Bảo vệ trực tiếp các "Workload", VPS, Container nằm trên Cloud.
  - Các chi nhánh hoặc người dùng WFH kết nối một đường VPN lên Cloud, lưu lượng mạng sẽ được lọc tại Cloud trước khi đổ vào Internet hoặc mạng trung tâm (Mô hình SASE / Zero Trust).
- **Ưu điểm:** Gần như đạt tính sẵn sàng 99.99%, tự động mở rộng (auto-scaling) không sợ nghẽn cổ chai phần cứng. 
- **Nhược điểm:** Dữ liệu bắt buộc phải route lên một bên thứ 3 (nhà cung cấp Cloud), yêu cầu quyền riêng tư và tuân thủ dữ liệu khắt khe hơn.

---

### Bảng So Sánh Tóm Tắt

| Loại Tường Lửa | Hoạt động tại tầng | Khả năng kiểm tra nội dung (Payload) | Hiệu suất | Độ phức tạp khi quản trị |
| :--- | :--- | :--- | :--- | :--- |
| **Packet Filtering** | Tầng 3, 4 | Không | Rất cao | Thấp |
| **Stateful Inspection**| Tầng 3, 4 | Không | Cao | Trung bình |
| **Proxy / App Layer**| Tầng 7 | Có (toàn diện chuyên sâu) | Thấp (Độ trễ cao)| Cao |
| **NGFW** | Tầng 3 đến 7 | Có (cộng thêm IPS/IDS) | Tùy phần cứng | Rất Cao |
| **WAF** | Tầng 7 (Chỉ Web) | Dành riêng cho HTTP/HTTPS | Trung bình | Rất Cao |