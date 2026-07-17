# Lab Nginx chuyên sâu trên Ubuntu

Tài liệu này tiếp nối lab cơ bản trong `README.md`. Mục tiêu không chỉ là làm cho Nginx trả về `200`, mà là quan sát được cách Nginx chọn `location`, biến đổi URI, cân bằng tải, retry, timeout, giới hạn tải, cache, nén, ghi log và reload không gián đoạn.

## Kiến trúc lab

```text
Client Ubuntu
    │
    ├── HTTP :8080 ──► redirect HTTPS
    │
    └── HTTPS :8443
            │
            ▼
        Nginx master
            │
            ├── static file / downloads
            ├── rate limit / cache / TLS / access log
            └── upstream backend (least_conn)
                    ├── worker_00 :9000
                    └── worker_01 :9001
```

Hai backend được Supervisord quản lý. Backend chỉ là công cụ tạo dữ liệu để quan sát Nginx; trọng tâm của tài liệu vẫn là Nginx.

## Kết quả cần đạt

Sau khi hoàn thành, bạn cần giải thích được:

- Master process và worker process khác nhau như thế nào.
- Thứ tự Nginx chọn `server` và `location`.
- Dấu `/` cuối `proxy_pass` ảnh hưởng URI ra sao.
- `least_conn`, round-robin, weight, backup và passive health check hoạt động thế nào.
- Phân biệt `502`, `503`, `504`, connect timeout và read timeout.
- Vì sao GET có thể retry nhưng POST thường không nên retry.
- Cách `limit_req`, `limit_conn`, proxy cache và cache lock hoạt động.
- Cách đọc structured log để tìm latency nằm ở Nginx hay backend.
- Vì sao `nginx -t && nginx -s reload` có thể cập nhật cấu hình không downtime.

---

## 0. Chuẩn bị môi trường

### 0.1 Công cụ trên Ubuntu

```bash
sudo apt update
sudo apt install -y curl jq openssl apache2-utils
docker --version
```

Nếu Docker yêu cầu quyền root, thêm `sudo` trước các lệnh `docker`, hoặc cấu hình tài khoản vào group `docker`.

### 0.2 Build image

Đứng trong thư mục lab:

```bash
cd nginx-supervisord-lab
docker build -t nginx-supervisor-lab .
```

File `app.py` có thêm các endpoint phục vụ thí nghiệm:

| Endpoint backend | Tác dụng |
|---|---|
| `/slow?seconds=3` | Chờ rồi mới trả response |
| `/status/503` | Chủ động trả status chỉ định |
| `/unstable` | Port 9000 trả 503, port 9001 trả 200 |
| `/large?kb=512` | Sinh response JSON lớn |
| Đường dẫn bất kỳ | Trả worker, port, request ID và forwarded header |

### 0.3 Chạy bằng cấu hình nâng cao

```bash
mkdir -p logs/nginx logs/supervisor
docker rm -f nginx-supervisor-lab 2>/dev/null || true

docker run -d \
  --name nginx-supervisor-lab \
  -p 8080:80 \
  -p 8443:443 \
  -v "$(pwd)/nginx.advanced.conf.example:/etc/nginx/nginx.conf:ro" \
  -v "$(pwd)/logs/nginx:/var/log/nginx" \
  -v "$(pwd)/logs/supervisor:/var/log/supervisor" \
  nginx-supervisor-lab
```

Kiểm tra ban đầu:

```bash
docker exec nginx-supervisor-lab nginx -t
docker exec nginx-supervisor-lab supervisorctl status
curl -sk https://localhost:8443/healthz
```

Kết quả mong đợi:

```text
nginx is healthy
```

Tạo hàm reload để dùng trong các bài sau:

```bash
reload_nginx() {
  docker exec nginx-supervisor-lab nginx -t &&
  docker exec nginx-supervisor-lab nginx -s reload
}
```

Do file cấu hình được bind mount, bạn sửa `nginx.advanced.conf.example` trên Ubuntu rồi chạy `reload_nginx`; không cần build lại image. Nếu `nginx -t` lỗi thì lệnh reload phía sau không chạy.

---

## Bài 1. Đọc cấu hình hiệu lực và kiến trúc process

### Mục tiêu

Phân biệt file cấu hình bạn viết với cấu hình thực tế Nginx đã load, đồng thời quan sát master/worker.

### Thực hành

Xem phiên bản, compiler options và module:

```bash
docker exec nginx-supervisor-lab nginx -V 2>&1
```

In toàn bộ cấu hình hiệu lực, bao gồm các file `include`:

```bash
docker exec nginx-supervisor-lab nginx -T
```

Quan sát process:

```bash
docker exec nginx-supervisor-lab ps -ef | grep '[n]ginx'
```

Kỳ vọng có một master và một hoặc nhiều worker:

```text
root        ... nginx: master process ...
www-data    ... nginx: worker process
```

### Giải thích

- Master thường chạy bằng root để bind port, mở log/certificate rồi sinh worker.
- Worker chuyển sang user `www-data` và trực tiếp xử lý request.
- `worker_processes auto` thường tạo số worker tương ứng CPU mà container nhìn thấy.
- `worker_connections 4096` là giới hạn connection trên mỗi worker, không đồng nghĩa chính xác với 4096 client proxy đồng thời. Một request proxy thường dùng cả connection phía client và connection phía upstream.
- `nginx -T` hữu ích hơn chỉ đọc một file khi hệ thống dùng nhiều `include`.

### Câu hỏi báo cáo

1. Container của bạn có bao nhiêu worker?
2. Master và worker chạy bằng user nào?
3. Vì sao không nên cho worker chạy bằng root?

---

## Bài 2. Thuật toán chọn `location`

### Mục tiêu

Quan sát exact match, prefix, `^~` và regex thay vì đoán route theo thứ tự viết.

### Thực hành

```bash
for path in \
  /match \
  /match/abc \
  /match/file.txt \
  /match/static/file.txt; do
  echo "===== $path"
  curl -sk "https://localhost:8443$path"
done
```

Kết quả:

| URI | Location được chọn |
|---|---|
| `/match` | `location = /match` |
| `/match/abc` | `location /match/` |
| `/match/file.txt` | Regex `location ~* \.(txt\|jpg)$` |
| `/match/static/file.txt` | `location ^~ /match/static/` |

### Cơ chế chọn location rút gọn

1. Exact match `=` thắng ngay nếu khớp.
2. Nginx ghi nhớ prefix dài nhất.
3. Nếu prefix dài nhất có `^~`, Nginx dùng nó và bỏ qua regex.
4. Nếu không có `^~`, Nginx kiểm tra regex theo thứ tự xuất hiện trong config.
5. Không regex nào khớp thì dùng prefix đã ghi nhớ.

### Thí nghiệm thêm

Xóa `^~` khỏi `/match/static/`, reload rồi gọi lại:

```bash
curl -sk https://localhost:8443/match/static/file.txt
```

Regex extension sẽ có cơ hội thắng prefix. Sau thí nghiệm, thêm lại `^~` và reload.

### Ý nghĩa thực tế

Sai thứ tự/loại `location` có thể làm request tĩnh đi vào PHP/app backend, hoặc làm rule chặn file bí mật bị bỏ qua. Khi debug route, luôn dùng `nginx -T` để chắc chắn config nào đang hiệu lực.

---

## Bài 3. `proxy_pass`, URI và forwarded header

### Mục tiêu

Hiểu chính xác request mà backend nhận được và cách bảo toàn thông tin client qua reverse proxy.

### 3.1 Dấu `/` cuối `proxy_pass`

Gọi:

```bash
curl -sk 'https://localhost:8443/api/users?id=42' | jq
```

Với cấu hình:

```nginx
location /api/ {
    proxy_pass http://backend/;
}
```

Backend nhận:

```text
/users?id=42
```

Nginx thay phần URI khớp `/api/` bằng URI `/` của `proxy_pass`.

Đổi tạm thành:

```nginx
proxy_pass http://backend;
```

Reload và gọi lại. Backend sẽ nhận:

```text
/api/users?id=42
```

Sau thí nghiệm, phục hồi dấu `/` cuối và reload.

### 3.2 Forwarded header

```bash
curl -sk \
  -H 'X-Request-ID: lab-request-001' \
  https://localhost:8443/api/headers | jq '.forwarded_headers'
```

Bạn sẽ thấy:

- `Host`: host gốc được Nginx chuyển tiếp.
- `X-Real-IP`: địa chỉ client mà Nginx nhìn thấy. Trong Docker thường là địa chỉ bridge, không nhất thiết là `127.0.0.1`.
- `X-Forwarded-For`: chuỗi các proxy/client đã đi qua.
- `X-Forwarded-Proto`: `https`.
- `X-Request-ID`: ID từ client hoặc ID do Nginx sinh nếu client không gửi.

### Cảnh báo tin cậy header

`$proxy_add_x_forwarded_for` nối `$remote_addr` vào header client gửi sẵn. Ứng dụng không nên tin mù quáng phần đầu `X-Forwarded-For` nếu Nginx trực tiếp exposed ra Internet. Khi Nginx đứng sau load balancer tin cậy, cần cấu hình Real IP module và danh sách proxy được tin cậy.

---

## Bài 4. Load balancing và upstream keepalive

### Mục tiêu

So sánh round-robin, `least_conn`, weight và backup; hiểu keepalive phía upstream là một pool riêng với keepalive phía client.

### 4.1 Quan sát `least_conn`

Gửi request tuần tự:

```bash
for i in {1..8}; do
  curl -sk https://localhost:8443/api/ | jq -r '.worker'
done
```

Khi các request đều rất nhanh, kết quả có thể trông gần giống round-robin vì số active connection thường trở lại bằng nhau trước request tiếp theo.

Giữ một connection backend bận trong 5 giây:

```bash
curl -sk 'https://localhost:8443/conn-api/slow?seconds=5' >/tmp/slow.json &
slow_pid=$!
sleep 1

for i in {1..5}; do
  curl -sk https://localhost:8443/api/ | jq -r '.worker'
done

wait "$slow_pid"
jq '{worker, port}' /tmp/slow.json
```

`least_conn` ưu tiên backend có ít active connection hơn. Nó không đo CPU, RAM hay thời gian phản hồi lịch sử.

### 4.2 Chuyển sang round-robin

Comment dòng:

```nginx
least_conn;
```

Reload và gửi lại 8 request. Round-robin là thuật toán mặc định.

### 4.3 Weighted round-robin

Đổi upstream thành:

```nginx
upstream backend {
    server 127.0.0.1:9000 weight=3;
    server 127.0.0.1:9001 weight=1;
    keepalive 16;
}
```

Reload và chạy:

```bash
for i in {1..40}; do
  curl -sk https://localhost:8443/api/ | jq -r '.port'
done | sort | uniq -c
```

Tỷ lệ sẽ xấp xỉ `3:1`. Với mẫu nhỏ, không nên kỳ vọng tỷ lệ tuyệt đối chính xác trong mọi tình huống.

### 4.4 Backup server

Thử:

```nginx
upstream backend {
    server 127.0.0.1:9000;
    server 127.0.0.1:9001 backup;
}
```

Sau reload, request bình thường chỉ tới 9000. Dừng worker 9000:

```bash
docker exec nginx-supervisor-lab supervisorctl stop app:app_00
curl -sk https://localhost:8443/api/ | jq '{worker, port}'
```

Request chuyển sang backup 9001. Khởi động lại:

```bash
docker exec nginx-supervisor-lab supervisorctl start app:app_00
```

Sau bài này, phục hồi upstream trong file example về `least_conn` với hai server thường.

### 4.5 Upstream keepalive

Cấu hình lab dùng:

```nginx
keepalive 16;
proxy_http_version 1.1;
proxy_set_header Connection "";
```

`keepalive 16` là tối đa 16 connection upstream đang idle được giữ trong cache của mỗi Nginx worker, không phải giới hạn tổng connection và không phải 16 request tối đa.

Đo tham khảo:

```bash
ab -n 1000 -c 20 -k https://localhost:8443/api/
```

`ab` với certificate self-signed có thể không hoạt động tùy bản build. Khi đó dùng HTTP trực tiếp bên trong container hoặc chỉ so sánh bằng một công cụ load test hỗ trợ bỏ qua xác thực. Kết quả benchmark trong máy lab chỉ mang tính tương đối.

---

## Bài 5. Passive health check, retry và lỗi 502/503/504

### Mục tiêu

Phân biệt lỗi do không kết nối được backend, lỗi do backend chủ động trả về và lỗi do backend quá chậm.

### 5.1 Backend chủ động trả 503

```bash
curl -sk -o /dev/null -w '%{http_code}\n' \
  https://localhost:8443/api/status/503
```

Backend trả `503`. Cấu hình `proxy_next_upstream` cho phép thử backend tiếp theo khi gặp `http_503`, nhưng nếu cả hai backend đều trả 503 thì kết quả cuối vẫn là 503.

### 5.2 Một worker lỗi, một worker tốt

Endpoint `/unstable` có hành vi:

- Worker 9000 trả 503.
- Worker 9001 trả 200.

```bash
for i in {1..6}; do
  curl -sk -o /dev/null -w '%{http_code}\n' \
    https://localhost:8443/api/unstable
done
```

Đọc log:

```bash
tail -n 10 logs/nginx/lab_access_json.log | jq
```

Một request được retry có thể hiện:

```json
{
  "status": 200,
  "upstream_addr": "127.0.0.1:9000, 127.0.0.1:9001",
  "upstream_status": "503, 200"
}
```

Dấu phẩy cho biết một client request đã đi qua nhiều upstream attempt.

### 5.3 Vì sao POST không nên retry tùy tiện

Thử vài lần:

```bash
for i in {1..6}; do
  curl -sk -X POST -o /dev/null -w '%{http_code}\n' \
    https://localhost:8443/api/unstable
done
```

Mặc định, sau khi request không-idempotent đã được gửi tới upstream, Nginx không tùy tiện chuyển nó sang backend khác. Nếu một lệnh tạo đơn hàng được thực thi nhưng response bị mất, retry có thể tạo hai đơn hàng.

Nginx có tùy chọn `non_idempotent` cho `proxy_next_upstream`, nhưng chỉ dùng khi ứng dụng có idempotency key hoặc cơ chế chống thực thi lặp.

### 5.4 Tạo 502

Dừng cả hai backend:

```bash
docker exec nginx-supervisor-lab supervisorctl stop 'app:*'

curl -sk -o /dev/null -w '%{http_code}\n' \
  https://localhost:8443/api/
```

Kỳ vọng `502`: Nginx không thiết lập được kết nối hợp lệ tới upstream.

```bash
docker exec nginx-supervisor-lab supervisorctl start 'app:*'
```

### 5.5 Tạo 504 read timeout

```bash
time curl -sk -o /dev/null -w '%{http_code}\n' \
  'https://localhost:8443/api/slow?seconds=3'
```

`proxy_read_timeout 2s` nghĩa là Nginx không nhận được dữ liệu từ upstream trong khoảng cho phép. Nó có thể thử upstream tiếp theo, nên tổng thời gian client thấy có thể lớn hơn 2 giây. Cuối cùng thường trả `504` nếu các attempt đều timeout.

Phân biệt:

| Tình huống | Thường gặp |
|---|---|
| Không connect được tới port/backend | 502 |
| Backend trả Service Unavailable | 503 |
| Connect được nhưng quá lâu không có response | 504 |

Không nên giải quyết mọi 504 bằng cách tăng timeout. Trước tiên xem `request_time` và `upstream_response_time`, sau đó tìm nguyên nhân backend chậm.

---

## Bài 6. Rate limit và connection limit

### Mục tiêu

Bảo vệ backend khỏi burst request và số request chậm đồng thời quá lớn.

### 6.1 Request rate limiting

Cấu hình:

```nginx
limit_req_zone $binary_remote_addr zone=api_rate:10m rate=5r/s;

location /limited-api/ {
    limit_req zone=api_rate burst=2 nodelay;
    limit_req_status 429;
    # proxy...
}
```

Bắn 20 request đồng thời:

```bash
seq 1 20 | xargs -I{} -P20 sh -c \
  "curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:8443/limited-api/" \
  | sort | uniq -c
```

Bạn sẽ thấy cả `200` và `429`.

Giải thích:

- `rate=5r/s`: tốc độ trung bình cho mỗi key, ở đây key là địa chỉ IP.
- `burst=2`: cho phép hàng đợi/burst vượt tốc độ một lượng nhỏ.
- `nodelay`: request trong burst hợp lệ được xử lý ngay thay vì bị trì hoãn.
- Zone `10m` chứa trạng thái key, không phải buffer body 10 MB.

### 6.2 Connection limiting

```bash
for i in 1 2 3; do
  curl -sk -o /dev/null -w "request $i -> %{http_code}\n" \
    'https://localhost:8443/conn-api/slow?seconds=3' &
done
wait
```

Với `limit_conn per_ip_conn 1`, chỉ một request chậm được phép hoạt động tại location đó; request đồng thời còn lại thường nhận `429`.

### Khác biệt

- `limit_req`: giới hạn tốc độ request theo thời gian.
- `limit_conn`: giới hạn số connection/request đang hoạt động đồng thời.

Trong production, key có thể là IP, API key hoặc tenant ID. Rate limit theo IP có thể gây bất công khi nhiều người dùng chung NAT.

---

## Bài 7. Proxy cache và cache lock

### Mục tiêu

Quan sát `MISS`, `HIT`, `EXPIRED`, cache key và cách tránh cache stampede.

### 7.1 MISS rồi HIT

```bash
curl -sk -D /tmp/cache-h1 -o /tmp/cache-b1 \
  'https://localhost:8443/cached-api/cache?key=a'

curl -sk -D /tmp/cache-h2 -o /tmp/cache-b2 \
  'https://localhost:8443/cached-api/cache?key=a'

grep -i x-cache-status /tmp/cache-h1 /tmp/cache-h2
jq '.generated_at, .worker' /tmp/cache-b1
jq '.generated_at, .worker' /tmp/cache-b2
```

Kỳ vọng:

```text
X-Cache-Status: MISS
X-Cache-Status: HIT
```

Hai response có cùng `generated_at`, chứng minh lần hai đến từ cache thay vì chạy backend.

### 7.2 Query string là một phần cache key

```bash
curl -skI 'https://localhost:8443/cached-api/cache?key=b' |
  grep -i x-cache-status
```

`key=b` khác `key=a`, nên tạo cache entry khác.

### 7.3 Bypass cache có chủ đích

```bash
curl -sk \
  -H 'X-Bypass-Cache: 1' \
  -D - \
  'https://localhost:8443/cached-api/cache?key=a' \
  -o /dev/null | grep -i x-cache-status
```

Kỳ vọng `BYPASS`. Trong production không nên cho client Internet tự do điều khiển header bypass; đây chỉ là cơ chế lab/admin.

### 7.4 Hết hạn cache

```bash
sleep 11
curl -skI 'https://localhost:8443/cached-api/cache?key=a' |
  grep -i x-cache-status
```

Vì `proxy_cache_valid 200 10s`, entry đã hết freshness và request tiếp theo thường có trạng thái `EXPIRED` trước khi cache được cập nhật.

### 7.5 Cache lock

Xóa các cache file lab:

```bash
docker exec nginx-supervisor-lab sh -c \
  'find /var/cache/nginx/lab_cache -type f -delete'
```

Bắn nhiều request cùng cache key:

```bash
seq 1 10 | xargs -I{} -P10 sh -c \
  "curl -sk -o /dev/null https://localhost:8443/cached-api/same-key"
```

Kiểm tra log backend:

```bash
grep 'same-key' logs/supervisor/app_*_stdout.log
```

`proxy_cache_lock on` giúp chỉ một request đi lấy nội dung mới; các request cùng key chờ kết quả đó, giảm cache stampede.

### Lưu ý production

Không cache response cá nhân hóa, có `Authorization`, cookie phiên hoặc dữ liệu nhạy cảm nếu chưa thiết kế cache key/rule phù hợp. Cache sai có thể làm dữ liệu của người A được trả cho người B.

---

## Bài 8. Gzip, response lớn và buffering

### Mục tiêu

Quan sát content negotiation và ảnh hưởng của nén đối với payload lớn.

Không yêu cầu gzip:

```bash
curl -sk \
  -H 'Accept-Encoding: identity' \
  -o /dev/null \
  -w 'download=%{size_download} bytes\n' \
  'https://localhost:8443/api/large?kb=512'
```

Yêu cầu gzip:

```bash
curl -sk --compressed \
  -D /tmp/gzip-headers \
  -o /dev/null \
  -w 'download=%{size_download} bytes\n' \
  'https://localhost:8443/api/large?kb=512'

grep -i content-encoding /tmp/gzip-headers
```

Kỳ vọng có:

```text
Content-Encoding: gzip
```

Payload lab chứa nhiều ký tự lặp nên tỷ lệ nén rất cao. Dữ liệu ảnh JPEG/PNG/ZIP thường đã nén, bật gzip thêm ít hiệu quả nhưng tốn CPU.

`proxy_buffering` mặc định cho phép Nginx đọc response upstream vào buffer rồi gửi tới client. Điều này giúp giải phóng backend nhanh hơn khi client chậm, nhưng streaming/SSE thường cần:

```nginx
proxy_buffering off;
```

Không tắt buffering toàn cục chỉ vì một endpoint streaming; hãy cấu hình ở location cụ thể.

---

## Bài 9. TLS và security boundary

### Mục tiêu

Xác minh protocol được phép, certificate, security header, method và file ẩn.

### 9.1 Certificate

```bash
echo | openssl s_client \
  -connect localhost:8443 \
  -servername localhost 2>/dev/null |
  openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

Certificate lab là self-signed nên `curl` cần `-k`. Không dùng `-k` trong kiểm thử certificate production.

### 9.2 TLS version

TLS 1.2 phải kết nối được:

```bash
echo | openssl s_client \
  -connect localhost:8443 \
  -servername localhost \
  -tls1_2 2>/dev/null | grep Protocol
```

TLS 1.1 phải thất bại vì config chỉ cho TLS 1.2/1.3:

```bash
echo | openssl s_client \
  -connect localhost:8443 \
  -servername localhost \
  -tls1_1
```

### 9.3 Security header trên cả error response

```bash
curl -skI https://localhost:8443/not-found
```

Nhờ `always`, header vẫn có trên response 404.

Một quy tắc Nginx quan trọng: nếu block con khai báo bất kỳ `add_header`, nó không cộng dồn tự động với `add_header` từ block cha. Vì `/cached-api/` thêm `X-Cache-Status`, cấu hình lab chủ động lặp lại các security header trong location đó.

### 9.4 Method restriction

```bash
for method in GET POST HEAD PUT DELETE; do
  curl -sk -X "$method" -o /dev/null \
    -w "$method -> %{http_code}\n" \
    https://localhost:8443/api/
done
```

Kỳ vọng GET/POST/HEAD được phép; PUT/DELETE trả 405.

Trong `/downloads/`, `limit_except GET { deny all; }` thường trả 403 cho method bị chặn vì đây là access control. Nếu API contract yêu cầu đúng semantic `405 Method Not Allowed`, dùng rule trả 405 như location `/api/` và cân nhắc thêm header `Allow`.

### 9.5 Chặn file ẩn

```bash
docker exec nginx-supervisor-lab sh -c \
  'printf secret > /var/www/lab/downloads/.secret'

curl -sk -o /dev/null -w '%{http_code}\n' \
  https://localhost:8443/downloads/.secret
```

Kỳ vọng `403` do regex location chặn URI chứa `/.`.

Không bật HSTS trên localhost trong lab nếu chưa hiểu tác động trình duyệt. Trình duyệt có thể ghi nhớ HSTS và ép HTTPS cho những lần truy cập sau. Production chỉ bật sau khi toàn bộ domain/subdomain thực sự sẵn sàng HTTPS.

---

## Bài 10. Structured log và phân tích latency

### Mục tiêu

Dùng log để lần theo một request và xác định thời gian nằm ở Nginx hay upstream.

### 10.1 Correlation ID

```bash
curl -sk \
  -H 'X-Request-ID: report-demo-001' \
  https://localhost:8443/api/orders | jq

grep 'report-demo-001' logs/nginx/lab_access_json.log | jq
```

Nếu client không gửi `X-Request-ID`, Nginx dùng `$request_id` tự sinh. ID được chuyển cho backend và ghi vào access log.

### 10.2 Đọc các biến thời gian

```bash
curl -sk -o /dev/null \
  'https://localhost:8443/api/slow?seconds=1'

tail -n 1 logs/nginx/lab_access_json.log | jq
```

- `request_time`: tổng thời gian Nginx xử lý request từ khi đọc request đến khi ghi log.
- `upstream_connect_time`: thời gian kết nối upstream.
- `upstream_response_time`: thời gian nhận response từ upstream; có thể là danh sách nếu retry.
- `upstream_status`: status của từng attempt.
- `upstream_addr`: backend nào đã được thử.

Diễn giải mẫu:

- `request_time` cao và `upstream_response_time` cao: backend chậm hoặc upstream network chậm.
- `request_time` cao nhưng upstream nhanh: client tải chậm, Nginx buffering/queueing hoặc xử lý khác cần điều tra.
- `upstream_connect_time` cao: vấn đề mở kết nối, network hoặc backlog.
- Nhiều upstream address trong một dòng: đã có retry/failover.

### 10.3 Thống kê status nhanh

```bash
jq -r '.status' logs/nginx/lab_access_json.log |
  sort | uniq -c | sort -nr
```

Thống kê backend:

```bash
jq -r '.upstream_addr' logs/nginx/lab_access_json.log |
  sort | uniq -c | sort -nr
```

Structured JSON thuận tiện cho Loki, Elasticsearch, Fluent Bit hoặc công cụ phân tích khác. Cần kiểm soát dữ liệu nhạy cảm: không log token, cookie, mật khẩu hay toàn bộ query string nếu query có secret.

---

## Bài 11. Graceful reload không downtime

### Mục tiêu

Quan sát worker cũ hoàn tất request đang xử lý trong khi worker mới nhận request mới.

Chạy một request 5 giây ở background:

```bash
curl -sk \
  -o /tmp/reload-result.json \
  -w '%{http_code}\n' \
  'https://localhost:8443/conn-api/slow?seconds=5' &
request_pid=$!

sleep 1
reload_nginx

docker exec nginx-supervisor-lab ps -ef | grep '[n]ginx'

wait "$request_pid"
jq '{worker, port}' /tmp/reload-result.json
```

Request đang chạy vẫn hoàn thành với 200. Trong thời gian chuyển giao, bạn có thể thấy cả worker mới và worker cũ đang shutdown.

### Cơ chế

1. Master kiểm tra/đọc lại config.
2. Master mở resource/socket/log mới và sinh worker mới.
3. Worker mới bắt đầu nhận connection.
4. Worker cũ ngừng nhận connection mới nhưng hoàn thành request hiện có.
5. Worker cũ thoát sau khi hoàn tất hoặc sau `worker_shutdown_timeout`.

Quy trình vận hành an toàn:

```bash
docker exec nginx-supervisor-lab nginx -t &&
docker exec nginx-supervisor-lab nginx -s reload
```

`restart` toàn process không tương đương graceful reload và có nguy cơ ngắt connection.

---

## Bài 12. Fault-injection và checklist điều tra sự cố

### Case A: sai port upstream

Đổi một server thành `127.0.0.1:9999`, reload, gọi `/api/`, sau đó đọc:

```bash
tail -n 20 logs/nginx/lab_error.log
tail -n 5 logs/nginx/lab_access_json.log | jq
```

Tìm `connect() failed` và upstream address tương ứng.

### Case B: cấu hình sai cú pháp

Tạm bỏ dấu `;` ở một directive rồi:

```bash
reload_nginx
```

`nginx -t` thất bại và Nginx cũ vẫn phục vụ bằng cấu hình cũ. Sửa lại dấu `;`, test và reload.

### Case C: permission static file

```bash
docker exec nginx-supervisor-lab chmod 000 \
  /var/www/lab/downloads/sample.txt

curl -sk -o /dev/null -w '%{http_code}\n' \
  https://localhost:8443/downloads/sample.txt

tail -n 10 logs/nginx/lab_error.log

docker exec nginx-supervisor-lab chmod 644 \
  /var/www/lab/downloads/sample.txt
```

Tìm `Permission denied` trong error log.

### Trình tự điều tra chuẩn

1. Xác định status và thời điểm request.
2. Dùng request ID tìm đúng access log.
3. Xem `upstream_addr`, `upstream_status`, các biến latency.
4. Xem error log cùng timestamp.
5. Kiểm tra `nginx -T`, không chỉ file bạn nghĩ đang dùng.
6. Kiểm tra backend trực tiếp từ cùng network namespace.
7. Chỉ sửa sau khi đã phân biệt lỗi route, TLS, Nginx, network hay backend.

---

## Bài tổng hợp cuối phần Nginx

Không nhìn đáp án, hãy cấu hình một endpoint `/production-api/` đáp ứng:

1. Chỉ cho GET, POST, HEAD; method khác trả 405.
2. Bảo toàn Host, client IP, scheme và request ID.
3. Dùng upstream keepalive.
4. Connect timeout 1 giây, read timeout 5 giây.
5. GET được retry khi backend timeout/502/503/504, tối đa hai attempt.
6. Rate limit 10 request/giây/IP, burst 5.
7. GET thành công được cache 30 giây, nhưng request có `Authorization` không được cache.
8. Response có các security header ngay cả khi lỗi.
9. Access log JSON chứa request ID, upstream, status và latency.
10. Reload không làm hỏng request chậm đang chạy.

### Tiêu chí chấm

| Nhóm | Điểm |
|---|---:|
| Config hợp lệ, route và URI đúng | 2 |
| Header/proxy/TLS hợp lý | 2 |
| Load balancing, timeout, retry đúng | 2 |
| Rate limit và cache không làm lộ dữ liệu | 2 |
| Log, fault test và graceful reload | 2 |

Không chỉ chụp màn hình response 200. Báo cáo tốt cần có config diff, lệnh test, output, access/error log tương ứng và phần giải thích vì sao kết quả xảy ra.

---

## Dọn lab

```bash
docker rm -f nginx-supervisor-lab
rm -f /tmp/cache-h1 /tmp/cache-h2 /tmp/cache-b1 /tmp/cache-b2
rm -f /tmp/gzip-headers /tmp/reload-result.json /tmp/slow.json
```

File cấu hình cơ bản `nginx.conf` không bị thay đổi. Muốn quay lại lab cơ bản, chạy container không mount `nginx.advanced.conf.example`, hoặc mount lại `nginx.conf`.
