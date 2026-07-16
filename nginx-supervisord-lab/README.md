# Lab demo Nginx + Supervisord

Lab chạy local bằng Docker, không dùng Docker Compose, không cần domain hay Let’s Encrypt. Dockerfile tự tạo certificate self-signed cho `localhost` để demo HTTPS.

```text
nginx-supervisord-lab/
├── Dockerfile
├── nginx.conf
├── supervisord.conf
├── app.py
├── index.html
├── extra-service.conf.example
├── downloads/
├── logs/
└── report-images/
```

## 1. Build và chạy

```bash
docker build -t nginx-supervisor-lab .
docker run -d --name nginx-supervisor-lab \
  -p 8080:80 -p 8443:443 \
  -v "${PWD}/logs/nginx:/var/log/nginx" \
  -v "${PWD}/logs/supervisor:/var/log/supervisor" \
  nginx-supervisor-lab
```

Trên PowerShell thay `${PWD}` bằng `$(Get-Location)`.

```bash
docker exec nginx-supervisor-lab supervisorctl status
```

Kỳ vọng:

```text
app:app_00   RUNNING
app:app_01   RUNNING
nginx        RUNNING
```

## 2. Nginx

### Port và certificate

```nginx
listen 80;
listen 443 ssl;
ssl_certificate /etc/nginx/ssl/lab.crt;
ssl_certificate_key /etc/nginx/ssl/lab.key;
```

```bash
curl -I http://localhost:8080/
curl -Ik https://localhost:8443/
```

HTTP trả `301` sang HTTPS. Certificate là self-signed nên dùng `-k` để bỏ qua cảnh báo xác thực trong demo.

### File log và header

```bash
curl -Ik https://localhost:8443/
curl -sk https://localhost:8443/api/
docker exec nginx-supervisor-lab tail -n 5 /var/log/nginx/lab_access.log
```

Kiểm tra header `X-Lab-Server`, `X-Content-Type-Options`, `X-Frame-Options`. Log xuất hiện ở `logs/nginx/` trên host.

### Allow method

```bash
curl -sk -o /dev/null -w '%{http_code}\n' -X GET https://localhost:8443/api/
curl -sk -o /dev/null -w '%{http_code}\n' -X POST https://localhost:8443/api/
curl -sk -o /dev/null -w '%{http_code}\n' -X DELETE https://localhost:8443/api/
```

Kết quả lần lượt: `200`, `200`, `405`.

### Expose file và directory

```bash
curl -sk https://localhost:8443/
curl -sk https://localhost:8443/downloads/
curl -sk https://localhost:8443/downloads/sample.txt
```

- `/` phục vụ `index.html` bằng `root`.
- `/downloads/` dùng `alias` và `autoindex on` để hiện `sample.txt`.

## 3. Supervisord

### Multi-worker và log path

`numprocs=2` tạo hai process `app:app_00`, `app:app_01`, chạy ở port 9000 và 9001.

```bash
curl -sk https://localhost:8443/api/
curl -sk https://localhost:8443/api/
docker exec nginx-supervisor-lab tail -n 5 /var/log/supervisor/app_00_stdout.log
```

### Add/remove service

```bash
docker cp extra-service.conf.example nginx-supervisor-lab:/etc/supervisor/conf.d/clock.conf
docker exec nginx-supervisor-lab supervisorctl reread
docker exec nginx-supervisor-lab supervisorctl update
docker exec nginx-supervisor-lab supervisorctl status
```

Xóa service:

```bash
docker exec nginx-supervisor-lab supervisorctl stop clock
docker exec nginx-supervisor-lab rm /etc/supervisor/conf.d/clock.conf
docker exec nginx-supervisor-lab supervisorctl reread
docker exec nginx-supervisor-lab supervisorctl update
```

## 4. Reload Nginx

Sau khi sửa `nginx.conf` và build lại image, hoặc khi mount file config vào container, luôn kiểm tra:

```bash
docker exec nginx-supervisor-lab nginx -t
docker exec nginx-supervisor-lab nginx -s reload
```

## 5. Dọn lab

```bash
docker stop nginx-supervisor-lab
docker rm nginx-supervisor-lab
```
