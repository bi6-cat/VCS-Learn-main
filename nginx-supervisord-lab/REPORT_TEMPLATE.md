# BÁO CÁO LAB NGINX + SUPERVISORD

## 1. Môi trường

- Họ tên:
- Hệ điều hành:
- Docker version:

## 2. Cấu trúc và kiến trúc

Chèn cây thư mục rút gọn, sơ đồ Client → Nginx → `app_00`/`app_01`, và nêu vai trò của `nginx.conf`, `supervisord.conf`, `app.py`.

## 3. Kết quả Nginx

| Yêu cầu | Cấu hình/lệnh | Kết quả | Ảnh |
|---|---|---|---|
| File log | | | |
| Port listen | | | |
| Certificate path | | | |
| Allow method | | | |
| Add header | | | |
| Expose file/directory | | | |

Giải thích ngắn: cấu hình này làm gì và vì sao cần dùng.

## 4. Kết quả Supervisord

| Yêu cầu | Lệnh/cấu hình | Kết quả | Ảnh |
|---|---|---|---|
| Multi-worker | `numprocs=2` | | |
| Log path | stdout/stderr từng worker | | |
| Add service | `reread`, `update` | | |
| Remove service | stop, xóa file, `reread`, `update` | | |

## 5. Bảng kiểm thử

| Test | Kỳ vọng | Thực tế | Đạt/Không |
|---|---|---|---|
| HTTP 8080 | 301 sang HTTPS | | |
| HTTPS 8443 | 200 | | |
| GET/POST `/api/` | 200 | | |
| DELETE `/api/` | 405 | | |
| `/downloads/` | Hiện sample.txt | | |
| `supervisorctl status` | Hai worker và Nginx RUNNING | | |
| Add `clock` | clock RUNNING | | |
| Remove `clock` | clock biến mất | | |

## 6. Kết luận

Nêu các yêu cầu đạt được, vấn đề gặp phải và cách xử lý.

## 7. Ảnh cần chụp

1. Build/run container và `supervisorctl status`.
2. HTTP redirect, HTTPS/certificate, response header.
3. GET/POST/DELETE API.
4. Static file và directory listing.
5. Nginx log và log của hai worker.
6. Add/remove service `clock`.

Mỗi ảnh cần có caption và 1–2 câu giải thích. Không chụp private key.
