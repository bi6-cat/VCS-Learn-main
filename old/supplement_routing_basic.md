# BỔ SUNG BÁO CÁO: ROUTING BASIC

## 1. Subnet Calculation — Ví dụ thực hành

### Công thức cần nhớ

| Ký hiệu | Ý nghĩa |
|--------|---------|
| `n` | Số bit mượn từ phần Host để tạo subnet |
| `h` | Số bit Host còn lại |
| `2^n` | Số subnet tạo ra |
| `2^h` | Tổng số địa chỉ trong mỗi subnet |
| `2^h - 2` | Số host **khả dụng** (trừ Network + Broadcast) |

---

### Ví dụ 1: Chia `192.168.1.0/24` thành 4 subnet

**Bước 1 — Xác định số bit cần mượn:**
- Cần 4 subnet → `2^n ≥ 4` → `n = 2` bit
- Prefix mới: `/24 + 2 = /26`
- Subnet mask mới: `255.255.255.192`

**Bước 2 — Tính số host:**
- Bit host còn lại: `h = 32 - 26 = 6`
- Số host khả dụng: `2^6 - 2 = 62 host/subnet`

**Bước 3 — Liệt kê 4 subnet:**

| Subnet | Network Address | Host Range | Broadcast |
|--------|----------------|------------|-----------|
| 1 | 192.168.1.0/26 | .1 → .62 | 192.168.1.63 |
| 2 | 192.168.1.64/26 | .65 → .126 | 192.168.1.127 |
| 3 | 192.168.1.128/26 | .129 → .190 | 192.168.1.191 |
| 4 | 192.168.1.192/26 | .193 → .254 | 192.168.1.255 |

> **Mẹo nhớ:** Block size = `2^h = 64`. Mỗi subnet cách nhau đúng 64 địa chỉ.

---

### Ví dụ 2: Chia `10.0.0.0/8` thành 8 subnet

**Bước 1:** Cần 8 subnet → `2^n ≥ 8` → `n = 3` bit → prefix mới `/11`

**Bước 2:** `h = 32 - 11 = 21` → host khả dụng: `2^21 - 2 = 2,097,150 host/subnet`

**Bước 3 — 3 subnet đầu tiên (minh họa):**

| Subnet | Network Address | Broadcast |
|--------|----------------|-----------|
| 1 | 10.0.0.0/11 | 10.31.255.255 |
| 2 | 10.32.0.0/11 | 10.63.255.255 |
| 3 | 10.64.0.0/11 | 10.95.255.255 |

> Block size ở octet 2: `2^(11-8) = 2^3 ... ` → bước nhảy = 32 ở octet thứ 2.

---

### Ví dụ 3: Bài toán ngược — Cho host, tìm prefix

> **Đề:** Cần tối thiểu 50 host trong một subnet. Dùng prefix nào?

- `2^h - 2 ≥ 50` → `2^h ≥ 52` → `h = 6` (`2^6 = 64`)
- Prefix: `/32 - 6 = /26`
- Thực tế chứa được 62 host (≥ 50 ✓)

---

## 2. Distance Vector vs Link State — Bản chất khác biệt

### Tư duy cốt lõi

| | Distance Vector | Link State |
|---|---|---|
| **Biết gì?** | Chỉ biết **hướng + khoảng cách** đến đích qua hàng xóm | Biết **toàn bộ sơ đồ mạng** (topology) |
| **Học từ đâu?** | Nghe hàng xóm kể lại ("định tuyến theo tin đồn") | Tự thu thập từ toàn bộ mạng |
| **Thuật toán** | Bellman-Ford | Dijkstra (SPF) |
| **Đại diện** | RIP | OSPF |

---

### Distance Vector — "Định tuyến theo tin đồn"

**Ví dụ thực tế:**  
Router A không biết đường đến mạng X. Nó hỏi hàng xóm B: "Mày đến X mất bao nhiêu hop?"  
B trả lời: "3 hop." → A ghi vào bảng: *"Đến X: qua B, 4 hop"* (cộng thêm 1).

**Vấn đề:**
- A **không biết đường thực sự** trông như thế nào, chỉ tin vào lời B.
- Khi mạng thay đổi (link đứt), thông tin cập nhật lan chậm → **hội tụ chậm**.
- Có thể xảy ra **Routing Loop** (A nghĩ qua B, B nghĩ qua A).

```
[Cập nhật định kỳ mỗi 30 giây — gửi toàn bộ bảng định tuyến]
Router A ←——— "Tôi đến X mất 3 hop" ———— Router B
    ↓
A ghi: X = 4 hop, next-hop = B
```

---

### Link State — "Tự vẽ bản đồ"

**Ví dụ thực tế:**  
Mỗi router gửi cho **toàn bộ mạng** một bản tin LSA (Link State Advertisement): *"Tôi là Router A, tôi có kết nối đến B (cost 10) và C (cost 5)."*

Sau khi thu thập đủ LSA từ tất cả router, mỗi router tự xây dựng **bản đồ đầy đủ** (LSDB) rồi chạy thuật toán Dijkstra để tìm đường ngắn nhất.

**Ưu điểm:**
- Biết toàn bộ topology → **hội tụ cực nhanh** khi mạng thay đổi.
- Không xảy ra routing loop vì mỗi router tự tính toán độc lập.
- Chỉ gửi cập nhật khi có **thay đổi thực sự** (incremental update).

```
[Mỗi router quảng bá trạng thái link của mình cho toàn mạng]

      LSA: "A kết nối B(10), C(5)"
Router A ————————————————————→ Toàn mạng
      ←———————————————————————
      LSA: "B kết nối A(10), D(7)"  ← Router B

→ Mỗi router có LSDB đầy đủ → chạy Dijkstra → tìm đường tối ưu
```

---

### Tại sao quan trọng phải hiểu sự khác biệt này?

| Tình huống | Nên dùng |
|-----------|---------|
| Mạng nhỏ, đơn giản, ít thay đổi | Distance Vector (RIP) — cấu hình đơn giản |
| Mạng lớn, cần hội tụ nhanh, nhiều đường dự phòng | Link State (OSPF) — chính xác, mở rộng tốt |
| Link bị đứt | RIP mất ~90–180 giây để hội tụ; OSPF chỉ vài giây |

> **Bản chất:** Distance Vector "tin hàng xóm" nên dễ sai và chậm. Link State "tự biết tất cả" nên chính xác và nhanh — nhưng tốn RAM/CPU hơn để lưu và xử lý LSDB.

---

## 3. Sửa lỗi nhỏ trong báo cáo gốc — Mục 5.1 NAT (4 loại địa chỉ)

Báo cáo gốc bị lặp "Inside Global" hai lần. Bảng đúng:

| Thuật ngữ | Định nghĩa |
|----------|-----------|
| **Inside Local** | Địa chỉ IP Private thực tế gán cho thiết bị trong mạng nội bộ |
| **Inside Global** | Địa chỉ IP Public đại diện cho thiết bị nội bộ khi ra Internet |
| **Outside Local** | Địa chỉ của thiết bị bên ngoài mà thiết bị nội bộ "nhìn thấy" (thường = Outside Global) |
| **Outside Global** | Địa chỉ IP thực tế được gán cho thiết bị ở mạng bên ngoài Internet |
