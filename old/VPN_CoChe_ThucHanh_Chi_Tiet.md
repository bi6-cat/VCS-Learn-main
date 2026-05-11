# 2.3 & 2.4 Cơ Chế Hoạt Động Mật Mã Và Thực Hành OpenVPN Chuyên Sâu

Việc hiểu rõ lớp vỏ bọc bảo mật bên dưới VPN và cách cấu hình thực tế một hệ thống OpenVPN là yếu tố then chốt để quản trị một mạng an toàn. Dưới đây là phân tích chi tiết và hướng dẫn cấu hình chuyên sâu.

---

## 2.3 Cơ Chế Mật Mã, Chế Độ và Quá Trình Bắt Tay (Handshake)

### 2.3.1 Sự Kết Hợp Mật Mã Hoàn Hảo (Hybrid Encryption)

Trong thực tế, VPN không bao giờ chỉ dùng 1 loại mã hóa (Symmetric hay Asymmetric) vì mỗi loại đều có tử huyệt riêng. VPN kết hợp cả 3 trường phái mật mã để triệt tiêu nhược điểm của nhau:

1. **Khởi tạo và Thỏa thuận (Asymmetric / RSA):**
   - Rất chậm (tốn CPU) nhưng an toàn để "gửi chìa khóa qua mạng không bảo mật".
   - Máy A và B dùng khóa công khai/bí mật của nhau để chứng minh nhân thân (Authentication) và thỏa thuận xem sẽ dùng thuật toán gì tiếp theo.
2. **Sinh Khóa Phiên (Diffie-Hellman - DH):**
   - DH cho phép hai bên tính toán ra cùng một Khóa Đối Xứng (Symmetric Key) mà KHÔNG cần gửi khóa đó trực tiếp qua đường truyền.
   - Nhờ DH, kể cả khi dùng RSA để bọc, nếu hacker lưu lại toàn bộ gói tin trong 10 năm và sau đó phá được RSA, họ vẫn không thể dịch được dữ liệu vì mỗi phiên DH tạo ra một mớ khóa hoàn toàn ngẫu nhiên và biến mất khi ngắt kết nối (Perfect Forward Secrecy - PFS).
3. **Mã Hóa Dữ Liệu Thực Tế (Symmetric / AES-GCM):**
   - Dùng khóa đối xứng sinh ra từ DH để mã hóa luồng dữ liệu thật (File, Video, Database). 
   - Tốc độ cực nhanh, không gây nghẽn mạng. Phổ biến nhất hiện nay là chuẩn **AES-256-GCM** (GCM vượt trội hơn CBC vì nó vừa mã hóa vừa kiêm luôn tính năng băm xác thực tính toàn vẹn).

### 2.3.2 Các Chế Độ Hoạt Động (Modes)

**A. IPSec Modes:** Quyết định vỏ bọc IP Header.
- **Transport Mode (Host-to-Host):** 
  - Chỉ mã hóa "cái ruột" (Payload) TCP/UDP. Giữ nguyên cái "vỏ" IP Header gốc.
  - *Cấu trúc:* `[IP Header Cũ] + [Tiêu đề IPsec (ESP)] + [DỮ LIỆU ĐÃ MÃ HÓA]`
  - *Ứng dụng:* Rất nhẹ, dùng để Client nội bộ nói chuyện trực tiếp với Server mã hóa nội bộ (End-to-End).
- **Tunnel Mode (Site-to-Site LAN-to-LAN):**
  - Đóng gói toàn bộ *cái gói tin cũ* (Cả IP gốc lẫn Data) vào một cái hộp mới hoàn toàn.
  - *Cấu trúc:* `[IP Header Mới (IP của Firewall/Gateway)] + [ESP] + [IP Header Cũ & DỮ LIỆU ĐÃ MÃ HÓA]`
  - *Ứng dụng:* Dùng nối 2 trụ sở làm việc. Internet chỉ nhìn thấy 2 cục Firewall đang giao tiếp với nhau, hoàn toàn mù tịt việc IP thực sự bên trong là PC nào đang gửi Data cho PC nào nhánh bên kia.

**B. SSL/TLS (OpenVPN) Routing Modes:** Quyết định đường đi của Internet.
- **Split Tunnel (Phân luồng):**
  - Chẳng hạn dải `10.0.0.0/8` là mạng công ty. Ai đi đến Web công ty mới bị chui vào đường hầm VPN.
  - Ai lướt Facebook, xem Youtube thì đi bằng đường mạng Wifi quán Cafe bình thường -> Tiết kiệm 80% băng thông cho Firewall công ty.
- **Full Tunnel (Gom tất cả):**
  - Toàn bộ MỌI giao dịch (từ LAN công ty đến Youtube, Facebook) đều bị bắt nhét hết vào VPN kéo về công ty rồi mới từ công ty đi ra Internet.
  - *Mục đích:* Quản lý bảo mật tuyệt đối. Nhân viên WFH không thể lây nhiễm Malware từ Wifi quán vỉa hè vào VPN công ty. Doanh nghiệp giám sát được 100% lịch sử duyệt Web của nhân viên làm việc từ xa.

> **💡 Ví dụ cho người mới (Split Tunnel vs Full Tunnel):** 
> Hãy hình dung bạn là nhân viên, đang ở trọ và có **hai cách** để bước khỏi nhà.  
> - Cách 1 (Split Tunnel): Bạn có cả **Cửa chính** (đi mớ việc riêng, Youtube, Siêu thị Internet) và một cái **Hầm ngầm** chuyên nối thẳng về văn phòng sếp. Bạn chỉ chui vào Hầm ngầm khi cần làm việc cho Sếp. Rất thoải mái và tiết kiệm xăng.
> - Cách 2 (Full Tunnel): Ông sếp đa nghi xây bít luôn **Cửa chính** của xóm trọ bạn lại. Lệnh: Bất luận chú ra đường đi đâu, mua rau hay gì, đều phải chạy qua Hầm ngầm về trình diện văn phòng, rồi mới được phát cái thẻ đi qua cửa văn phòng xuống phố Internet. Công ty kiểm soát hoàn toàn, nhưng công ty phải gánh cước xe cho tất cả việc của bạn.

### 2.3.3 Mổ Xẻ Quá Trình Bắt Tay OpenVPN (TLS Handshake)

Khác với IPSec chạy ở hạ tầng nhân Kernel (Layer 3), OpenVPN chạy ở không gian người dùng (User-space Layer 4-7) dựa trên chuẩn OpenSSL (giống hệt lướt Web HTTPS).

1. **TLS ClientHello & ServerHello:**
   - Client gởi lời chào, đề xuất bộ mã hóa (Cipher Suite).
   - Server đáp lại "Chào chú, a chọn xài AES-256-GCM. Đây là Chứng chỉ (Certificate) của anh!".
2. **Mutual Certificate Verification (Xác thực 2 chiều PKI):**
   - Cực kỳ bảo mật, không chỉ Server phải trình Certificate mà Client cũng phải nộp Certificate của riêng mình đã được cấp (Sign) bởi bộ máy cấp phát CA nội bộ. Điều này chặn đứng kẻ gian biết User/Pass nhưng không có file Cert `.ovpn`.
3. **Key Exchange & HMAC Authentication (`tls-auth` / `tls-crypt`):**
   - Sinh khóa mã hóa phiên.
   - Server và Client xác nhận thêm 1 tầng chữ ký bằng khóa tĩnh (ta.key). Tầng này gạt bỏ mọi gói tin "thăm dò" hay DoS từ kẻ tấn công ngay từ "ngoài cổng" mà chưa cần tốn CPU giải mã.
4. **Push Configuration & Routing:**
   - Server tạo cổng mạng ảo (TUN ảo), gán IP nội dải `10.8.0.x` cho Client.
   - Đẩy (Push) luật định tuyến `route 192.168.1.0` xuống máy Client để ép Win/Mac của Client biết đường chui vào hầm.
5. **Data Transfer:** Giao dịch an toàn được thiết lập.

---

## 2.4 Hướng Dẫn Thực Hành Cấu Hình OpenVPN Mức Độ System Admin

Phần này phân tích *LÝ DO TẠI SAO* ta lại gõ những dòng lệnh đó khi cấp quyền cho Server và Client.

### 1. Kiến Trúc Interface: TUN và TAP
- Cấu hình OpenVPN luôn phải chọn thiết bị trung gian (`dev tun` hay `dev tap`).
- **TUN (Network Tunnel):** Đóng gói IP. Hoạt động trên Layer 3 (Mạng). Cắt gọt các gói tin linh tinh (Broadcast, ARP) khiến hầm VPN chạy cực kỳ ổn định và ít tốn băng thông. Hỗ trợ cho điện thoại iOS/Android. -> *Luôn là lựa chọn ưu tiên.*
- **TAP (Network Tap):** Nối dây diện ảo. Hoạt động trên Layer 2 (Data Link). Cho phép chạy mọi giao thức phi IP. Máy Client lấy chung dải IP LAN với máy chủ (kiểu Bridge). Rất gây lag do gánh traffic Broadcast.

### 2. UDP vs TCP cho VPN (Protocol)
- Nên chọn `proto udp` (Cổng mặc định UDP 1194).
- Giao thức nền của TCP đã có tính năng kiển tra toàn vẹn và gói tin phản hồi (ACK). Chạy một kết nối TCP "nằm bên trong" một đường hầm VPN cũng là TCP sẽ dẫn đến họa "TCP Meltdown" (Kết nối tự chết ngạt do chờ phản hồi lồng chéo nhau khi nghẽn mạng).
- UDP bắn đi không đợi chờ, tốc độ VPN nhanh hơn bội phần. (Chỉ dùng TCP 443 khi bị Firewall nhà nước/ký túc xá cấm cổng 1194).

> **💡 Ví dụ cho người mới (TCP Meltdown):** 
> Tưởng tượng gửi 1 kiện hàng có gắn mã định vị (TCP gốc). Người nhân viên VPN lại bọc nó trong một thùng carton khác cũng đòi phải có chữ ký nhận thu tiền hộ (TCP bọc ngoài TCP). Khi thùng hàng nhỡ qua một cây cầu đang kẹt xe (mạng lag), nhân viên bên gốc cuống lên la lối: "Ủa sao hàng chậm giao thế, tau phải đem kiện khác gửi lại phòng hờ". Người nhân viên VPN ở vòng ngoài cũng quát: "Nhân viên trạm bên kia chậm phản hồi, tau phải gởi cái nguyên cái thùng này lại 1 lần nữa". Kết quả hai ông lồng ghép thay nhau gởi lại kiện hàng, làm cây cầu kẹt cứng toàn tập rồi tịt mạng luôn. Dùng UDP ở vỏ ngoài giống như bưu tá quăng đại thùng hàng rồi chạy trốn, lỡ kiện mất thật thì nhờ một và chỉ một "nhân viên TCP gốc bên trong" đòi bảo hành mà thôi.

### 3. Setup PKI - Trái tim của sự tin tưởng (Easy-RSA)
- **Hạ tầng khóa công khai (PKI):**
  - Khởi tạo CA (`build-ca`): Root CA giống như "Lãnh Sự Quán" quyền năng nhất. File `ca.key` (Khóa riêng của CA) dùng để đóng dấu giáp lai (Sign) cấp hộ chiếu cho tất cả Server và Client. Tuyệt đối không để lộ file này.
  - File `server.crt`: Là Passport của VPNGateway.
  - File `client1.crt`: Là Passport của PC Nhân viên.

### 4. Giải Nghĩa Cấu Hình Server (`server.conf`)

```ini
port 1194            # Chạy cổng UDP tiêu chuẩn.
proto udp            # Không bắt tay ACK, tối ưu băng thông.
dev tun              # Sử dụng mode Layer 3 Routing (Không xài TAP).

ca ca.crt            # Khai báo CA để kiểm định Client kết nối tới.
cert server.crt      # Chứng chỉ để nhúng vào gói tin đáp trả Client.
key server.key       # Khóa bí mật (Chỉ mình Server cầm).
dh dh.pem            # Tham số để chạy thuật toán sinh khóa DH.

server 10.8.0.0 255.255.255.0 # Khi máy vãng lai chui vào hầm, Server sẽ cấp DHCP giải IP ảo này ngẫu nhiên.
ifconfig-pool-persist ipp.txt # File lưu tĩnh địa chỉ IP. Ông A ngắt kết nối vào lại vẫn được giữ nguyên IP cũ tránh trùng lặp.

# Phân Routing
push "route 192.168.10.0 255.255.255.0"   # Ra lệnh cho máy User: Mày muốn đi vô Server 192.168.10.x, chui vào hầm VPN! (Split Tunnel)
push "redirect-gateway def1 bypass-dhcp" # Ra lệnh: Chui TẤT CẢ mọi IP lướt net vào hầm (Full Tunnel). Chỉ dùng 1 trong 2 cái push này.

cipher AES-256-GCM   # Yêu cầu chuẩn mã hóa bảo an mạnh nhất (Data Channel).
auth SHA256          # Checksum toàn vẹn gói tin.
tls-auth ta.key 0    # Lớp phòng hộ tĩnh chặn chập mạch/DDoS cổng UDP. (Control Channel). Khách ko có file 'ta.key' thì 1 byte tin cũng ko lọt vào đc OpenSSL.
```

### 5. NAT Xuyên Thấu (IPTables) - Lót gạch kết nối
Dù OpenVPN có chạy ngon trơn tru, Client có được IP `10.8.0.2`, nhưng Router công ty (192.168.10.1) lại MÙ tịt không hề biết dải mạng ảo 10.8 là từ đâu chui ra. Gói tin đi thì qua nhưng phản hồi lại thì sẽ bị Rớt lạc đường (Drop)!

Ta phải cấu hình NAT (Source NAT/Masquerade) trên máy chủ Ubuntu chạy OpenVPN:
```bash
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o eth0 -j MASQUERADE
```
> **Ý nghĩa câu lệnh:** Mọi gói tin xuất phát từ những đứa chui hầm `10.8.0.x`, trước khi chui khỏi máy chủ (interface vật lý `eth0`) để đi vô LAN hay lướt Internet, đều phải BỊ XÓA IP gốc VÀ THAY BẰNG IP LAN vật lý của máy chủ này. Lúc đó luồng IP trở nên bình thường và thông suốt toàn mạng.

> **💡 Ví dụ cho người mới (Cơ chế NAT Xuyên Thấu - Masquerade):** 
> Lấy ví dụ bạn dẫn "gấu" về nhà ngoại. Trượt VPN, người đi theo bạn dùng cái tên giả lạ hoắc xóm (`10.8.0.2`). Đến nhà ngoại (`192.168.10.x`), người lạ hoắc này xin một ly nước từ Tủ lạnh. Bà ngoại không quen người `10.8` nên không cho nước. 
> Giải pháp "Masquerade": Mỗi khi người bạn này đưa ly không, trước khi thò tay lấy nước từ tủ lạnh, Mẹ bạn là người **thay mặt** cầm ly đưa cho Bà ngoại lấy nước, mượn cớ mẹ xin (mọi gói tin bị thay mặt IP bằng máy OpenVPN). Mẹ rọc ly nước rồi lén chuyền tay lại cho bạn (`10.8.0.2`). Lúc đó, bà ngoại không phải quan tâm ông lạ hoắc kia là ai. Mọi chuyện suôn sẻ. Bà ngoại (Máy chủ File/LAN công ty) tưởng bà đáp lại nước cho một người xóm mình (Mẹ - Máy cài OpenVPN Server).

### 6. Cơ chế Thu Hồi Quyền Truy Cập (Revoke Certificate & CRL)
Khi nhân viên nghỉ việc hoặc Laptop bị mất cắp, việc thay Password là chưa đủ (vì họ cắm sẵn file `.ovpn`). Bước bắt buộc là **Revoke (Thu hồi)** cái Certificate của máy đó.

1. Chạy lệnh `./easyrsa revoke client_laptop_BiMat`
2. Xuất bảng danh sách phong tỏa: `./easyrsa gen-crl`
3. Cập nhật file danh sách đen (`crl.pem`) vào OpenVPN Server và thêm dòng: `crl-verify crl.pem` vào config.
Bất kỳ ai cầm Passport "client_laptop_BiMat" lao vào hệ thống đều bị Reject Handshake ngay lập tức, vô hiệu hóa hoàn toàn truy cập.