# PHẦN 2: VPN (Tự Mạng Riêng Ảo) - Lý Thuyết Chuyên Sâu

Virtual Private Network (VPN) là xương sống của việc làm việc từ xa và kết nối hạ tầng phân tán trong môi trường doanh nghiệp hiện đại. Phần này đi sâu vào bản chất các giao thức, cơ chế mật mã, và kiến trúc của các loại VPN phổ biến.

---

## 2.1 Khái Niệm Phân Tích Sâu (Deep Dive into VPN)

### Bản Chất Của VPN (VPN Tunnel tunneling)
Mạng Internet công cộng (WAN) giống như một đại lộ không có vách ngăn: bất kỳ ai dùng phần mềm bắt gói tin (Packet Sniffer / Wireshark) cũng có thể đọc được dữ liệu truyền qua nếu nó không được mã hóa (Plaintext như HTTP, Telnet).

**VPN hoạt động dựa trên kỹ thuật Tunneling (Đóng gói xuyên hầm):**
- Lấy gói tin gốc (Bao gồm IP nguồn, IP đích nội bộ và Dữ liệu).
- Mã hóa toàn bộ ruột gói tin đó.
- Đóng gói nó vào một lớp vỏ IP mới (IP Header bên ngoài) với địa chỉ nguồn/đích là các điểm cuối của VPN (VPN Gateway).
- Đi qua "Đại lộ Internet" an toàn. Đến đích, lớp vỏ ngoài bị lột bỏ, dữ liệu được giải mã và trả lại trạng thái ban đầu.

> **💡 Ví dụ cho người mới (Tunneling là gì?):** Hãy tưởng tượng bạn muốn gửi một lá thư mật cho sếp. Nếu bạn đưa phong bì trong suốt cho bưu tá (Internet), ai cũng đọc được dòng chữ Mật. Hạt hạt Tunneling giống như việc bạn nhét lá thư vào một **két sắt mini** rồi khóa lại (Mã hóa), sau đó bỏ két chứa thư đó vào một **thùng các-tông giao hàng bình thường** (Vỏ IP mới) và giao cho bưu tá. Người bưu tá (Router) chỉ nhìn thấy cái thùng ghi địa chỉ công ty giao hàng, hoàn toàn không biết bên trong đang chở nguyên một két sắt khóa kín chứa thư.

### 4 Mục Tiêu Cốt Lõi Của VPN (CIA Triad + N)

1. **Confidentiality (Tính Bảo Mật / Bí mật):** Dữ liệu truyền đi bị xáo trộn thành Ciphertext. Dù hacker chặn được gói dữ liệu, họ chỉ thấy chuỗi ký tự vô nghĩa vì không có Key xả mã (AES, 3DES).
2. **Integrity (Tính Toàn Vẹn):** Đảm bảo dữ liệu không bị ai đó chèn thêm mã độc hay thay đổi nội dung ở giữa đường truyền (Man-in-the-Middle). Thực hiện bằng kỹ thuật băm (Hashing) như SHA-256, HMAC.
3. **Authentication (Tính Xác Thực):** Khẳng định chắc chắn định danh của thiết bị hoặc người dùng đang kết nối ở đầu kia. Đảm bảo "Người gửi đúng là người mình nghĩ tới" (Dùng PKI Certificates hoặc Pre-Shared Key).
4. **Non-repudiation (Chống Phủ Nhận):** Bằng chứng kỹ thuật số chứng minh một giao dịch/dữ liệu thực sự đã được gửi từ phía Client, không thể chối cãi được (Sử dụng Chữ ký số / Digital Signatures).

---

## 2.2 Các Loại Mô Hình VPN

Sự lựa chọn loại VPN phụ thuộc hoàn toàn vào ngữ cảnh và đối tượng cần kết nối.

### 1. Site-to-Site VPN (VPN Kết Nối Điểm - Điểm)
- **Bản chất:** Giống như nối một sợi cáp LAN vô hình thật dài giữa 2 văn phòng (Trụ sở - Chi nhánh).
- **Hoạt động:** Tường lửa hoặc Router ở mỗi văn phòng (Gateway) đóng vai trò là điểm kết thúc đường hầm (VPN Terminator).
- **Hành vi người dùng:** Nhân viên trong văn phòng không cần biết (và không cẩn cài phần mềm) về VPN. Gói tin đi ra đến Gateway sẽ được thiết bị mạng tự động đẩy vào Tunnel nếu đích đến là văn phòng đối diện.
- **Giao thức tiêu chuẩn:** IPsec (Cực kỳ mạnh và phổ biến ở tầng 3 L3).

### 2. Remote Access VPN (VPN Truy Cập Từ Xa)
- **Bản chất:** Một nhân viên ngồi tại quán cà phê hoặc ở nhà (WFH) muốn truy cập vào File Server của công ty một cách an toàn.
- **Hoạt động:** Nhân viên phải cài đặt một đoạn mã/ứng dụng (VPN Client) trên laptop/điện thoại: OpenVPN Client, Cisco AnyConnect, FortiClient.
- **Quy trình:** Người dùng gõ Username/Password hoặc dùng OTP sinh mã. Khi xác thực thành công, máy tính cá nhân sẽ được cấp phát 1 địa chỉ IP ảo (Virtual IP) như thể đang ngồi trực tiếp tại văn phòng.
- **Giao thức tiêu chuẩn:** SSL/TLS VPN (Ở tầng 4-7, vượt qua firewall tĩnh dễ hơn) hoặc IPsec IKEv2.

### 3. MPLS VPN (VPN Khách Hàng Do ISP Cung Cấp)
- Khác với 2 loại trên chạy trên hạ tầng mạng Internet đầy rẫy rủi ro. MPLS chạy trên hạ tầng đường truyền trục (Backbone) riêng của nhà mạng viễn thông.
- **Layer 2.5:** Không mã hóa nặng nề như IPsec mà phân tách dữ liệu các tập đoàn bằng Nhãn (Label VRF). Doanh nghiệp thuê MPLS từ ISP sẽ có đường truyền tốc độ cao, cam kết SLA, độ trễ cực thấp để chạy các dịch thuật thời gian thực (Voice/Video Call).
- Điểm yếu là chi phí thuê bao duy trì hàng tháng cực kỳ đắt đỏ.

---

## 2.3 Cơ Chế Mã Hóa, Trao Đổi Khóa & Xác Thực (Tim Cốt Của VPN)

Để đường hầm VPN thực sự an toàn, nó buộc phải chạy qua một chuỗi các thuật toán mật mã đan xen nhau.

### A. Bài toán Trao đổi khóa (Diffie-Hellman Key Exchange)
Làm sao để 2 điểm kết nối ở xa nhau (Hà Nội - HCM) có thể **sinh ra cùng một chìa khóa bí mật** để mã hóa dữ liệu, mà không bao giờ phải gửi chiếc chìa khóa đó qua mạng Internet?

Thuật toán **Diffie-Hellman (DH)** sinh ra để giải quyết việc này thông qua toán học logarit rời rạc.
1. Client A và Server B thỏa thuận một cặp số nguyên tố công khai.
2. A trộn số công khai với 1 số bí mật của riêng A. B làm tương tự với số bí mật của B.
3. A và B gửi "kết quả đã trộn" cho nhau (hacker bắt được cũng không tạc ngược lại được số bí mật).
4. A và B lấy kết quả nhận được, đem pha với số bí mật của mình lần nữa. Phép màu toán học khiến cả A và B **cùng đạt được một chuỗi Key giống hệt nhau**. Đây chính là Session Key để bắt đầu mã hóa.

> **💡 Ví dụ cho người mới (Sự kỳ diệu của Diffie-Hellman bằng cách "Trộn sơn"):** 
> - Bạn (A) và máy chủ VPN (B) đồng ý dùng chung một xô sơn rỗng và chọn màu **Vàng** (Màu công khai).
> - Bạn đổ vào đó một lọ sơn bí mật của mình (màu **Đỏ**) tạo thành sơn **Cam**, rồi gửi cho B qua bưu điện.
> - Máy B đổ vào xô vàng một lọ bí mật của hắn (màu **Xanh dương**) tạo thành sơn **Lục**, rồi gửi lại cho bạn.
> - Suốt dọc đường đi, hacker ăn cắp được các thùng sơn **Cam** và **Lục**, nhưng tên hacker KHÔNG thể bóc được sơn Đỏ hay Xanh dương trong đó ra.
> - Kế tiếp, khi nhận con sơn Lục của B, bạn lôi màu **Đỏ** bí mật của bạn ra trộn tiếp -> Kết quả nảy ra **Nâu sẫm**.
> - Ngược lại, máy B nhận con sơn Cam của bạn, nó lấy nốt màu **Xanh** bí mật của nó đổ vào -> Cũng ra màu **Nâu sẫm**.
> Cả hai thế là làm ra chiếc chìa khóa "Nâu sẫm" kỳ diệu mà không hề phải gửi một cái chìa khóa "Nâu sẫm" nào qua mạng!

### B. Mã hóa dữ liệu (Symmetric vs Asymmetric)
Sau khi có DH Key từ bước trên, VPN bắt đầu mã hóa dữ liệu:
- **Mã hóa đối xứng (Symmetric):** Dùng đúng 1 chìa khóa (Session Key DH) để khóa cửa và mở cửa (Mã hóa và Giải mã). Thuật toán: **AES-256**. Rất nhanh, lý tưởng để mã hóa các luồng video dung lượng Gigabyte.
- **Mã hóa bất đối xứng (Asymmetric/PKI):** Dùng 1 cặp Cặp khóa (Public Key / Private Key). Khóa công khai dùng để khóa, chỉ Khóa bí mật mới mở được (Thuật toán RSA). Rất chậm, do đó VPN **chỉ dùng** mã hóa bất đối xứng trong giai đoạn khởi tạo ban đầu để ký chữ ký số xác thực nhân thân. Thực tế dùng **Hybrid** (kết hợp cả hai: Dùng RSA để xác thực 2 đầu, dùng DH sinh key, dùng AES mã hóa tệp).

### C. Tính Toàn Vẹn Data (Hashing - Message Authentication Code)
Khi gói dữ liệu bay trên mạng, kẻ tấn công (MitM) có thể cắt 1 bit `0` thành `1` làm hỏng file.
- VPN dùng HMAC (Hash-based Message Authentication Code). Phổ biến là SHA-256.
- Client tính toán 1 bản mã Hash (băm) từ file gốc, đính kèm nó vào đuôi gói tin.
- Server nhận được, tự băm lại gói tin. Nếu 2 chuỗi Hash khớp nhau hoàn toàn 100%, chứng tỏ tệp tin vô hại, không bị gãy rụng giữa đường. Nếu sai 1 ký tự, gói tin bị DROP ngay.

> **💡 Ví dụ cho người mới (Hashing – Tính toàn vẹn):**
> Tưởng tượng bạn đặt bánh ngọt online. Cửa hàng bọc hộp bánh, rồi dán lên nó một miếng **tem niêm phong**. Gã giao hàng muốn mở ra nếm thử một cái bánh thì hắn phải chọc thủng tem niêm phong đó. 
> Lúc bạn nhận bánh, chỉ cần xem vết rách, bạn lập tức hủy đơn nhận. Hashing là con tem niêm phong trong không gian kỹ thuật số (sử dụng mật mã để không làm giả được team gốc của cửa hàng).

---

## 2.4 Quá Trình Thiết Lập Phiên IPSEC (IPSec IKE Phases)

IPSec cực kỳ mạnh mẽ nhưng cũng vô cùng phức tạp. Nó kết nối qua 2 giai đoạn (Phase 1 và Phase 2).

### Phase 1: Tạo Bộ Xương Lồng Ấp (ISAKMP SA / IKE Phase 1)
Mục tiêu của Phase 1 không phải là gửi dữ liệu người dùng, mà là để hai bên Router tin tưởng nhau, tạo ra một Kênh giao tiếp bảo mật (Management Channel).

1. **Negotiation (Thoả thuận chính sách):** Cả 2 gửi đề xuất các thuật toán cho nhau:
   - "Dùng AES-256 mã hóa nhé? Dùng SHA-256 Hashing nhé? Dùng DH Group 14 nhé?"
   - Nếu hai bên không khớp cấu hình (Bên A chỉ hỗ trợ 3DES, bên B đòi AES) -> Đứt VPN ngay lập tức.
2. **Key Exchange (DH):** Chạy thuật toán Diffie-Hellman để sinh ra con Key chủ (Master Key).
3. **Authentication (Xác thực danh tính):** So khớp mật khẩu Pre-Shared Key (PSK) xem có đúng không.

-> Kết quả: Tạo ra một cái ống nhựa rỗng (Main Tunnel), chưa có nước chảy bên trong.

### Phase 2: Bơm Chạy Dữ Liệu (IPsec SA / Quick Mode)
Kênh Management chạy bên trong cấu trúc Phase 1 dùng để tiến hành thoả thuận Phase 2.

- **Thương lượng Thuật toán Data (ESP/AH):** Quyết định xem dữ liệu người dùng thực sự (Các file Word, luồng PING nội bộ) sẽ được bọc như thế nào (Encapsulating Security Payload - ESP).
- **Luồng kết nối (Unidirectional):** Phase 2 thiết lập 2 luồng 1 chiều: 1 chiều luồng Inbound, 1 chiều luồng Outbound (Mỗi luồng có 1 mã theo dõi gọi là SPI - Security Parameter Index).
- Bật tính năng **PFS (Perfect Forward Secrecy):** Đòi hỏi đổi chìa khóa liên tục. Định kỳ 60 phút sẽ chạy lại hàm thuật toán DH để sinh chìa khóa mới. Chống việc hacker ghi âm lại dữ liệu 5 năm trời, đến năm thứ 6 lụm được con Key thì dùng key đó mở khóa đọc đoạn mã âm từ quá khứ (Vì Key sinh liên tục đổi rồi bỏ).

-> Kết quả: Tạo ra 2 đường hầm dữ liệu thực sự (Data Tunnels) nằm ở bên trong ruột cái ống rỗng Phase 1. Dữ liệu mạng LAN bắt đầu truyền thông suốt qua lại.