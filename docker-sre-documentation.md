# Tài liệu Docker – Thực tập SRE

> **Phiên bản:** 1.0  
> **Hệ điều hành khuyến nghị:** Ubuntu 22.04 LTS  
> **Docker Engine:** ≥ 24.x | **Docker Compose:** v2.x

---

## Mục lục

- [Phần 1 – Tìm hiểu về Docker](#phần-1--tìm-hiểu-về-docker)
  - [1.1 Tổng quan](#11-tổng-quan)
  - [1.2 Docker Image](#12-docker-image)
  - [1.3 Docker Container](#13-docker-container)
  - [1.4 Docker Client](#14-docker-client)
  - [1.5 Docker Volume](#15-docker-volume)
  - [1.6 Docker Network](#16-docker-network)
  - [1.7 So sánh Virtual Machine và Docker Container](#17-so-sánh-virtual-machine-và-docker-container)
  - [1.8 So sánh chương trình trong Container và trên máy thật](#18-so-sánh-chương-trình-trong-container-và-trên-máy-thật)
  - [1.9 Container giao tiếp với mạng bên ngoài](#19-container-giao-tiếp-với-mạng-bên-ngoài)
- [Phần 2 – Triển khai hệ thống bằng Docker](#phần-2--triển-khai-hệ-thống-bằng-docker)
  - [2.1 Dockerfile – Nginx web tĩnh](#21-dockerfile--nginx-web-tĩnh)
  - [2.2 Mô hình hệ thống HAProxy + Keepalived + Nginx](#22-mô-hình-hệ-thống-haproxy--keepalived--nginx)
  - [2.3 Cấu hình HAProxy](#23-cấu-hình-haproxy)
  - [2.4 Cấu hình Keepalived](#24-cấu-hình-keepalived)
  - [2.5 Docker Compose – Toàn bộ stack](#25-docker-compose--toàn-bộ-stack)
  - [2.6 Hướng dẫn triển khai chi tiết](#26-hướng-dẫn-triển-khai-chi-tiết)
- [Phần 3 – Cấu hình service chạy Docker Container](#phần-3--cấu-hình-service-chạy-docker-container)
  - [3.1 Docker Container và Image nâng cao](#31-docker-container-và-image-nâng-cao)
  - [3.2 Docker Compose – Cấu hình chi tiết](#32-docker-compose--cấu-hình-chi-tiết)
  - [3.3 Docker Swarm](#33-docker-swarm)
  - [3.4 Docker Stack](#34-docker-stack)
  - [3.5 So sánh các phương thức triển khai](#35-so-sánh-các-phương-thức-triển-khai)

---

## Phần 1 – Tìm hiểu về Docker

### 1.1 Tổng quan

Docker là nền tảng container hóa ứng dụng mã nguồn mở, cho phép đóng gói ứng dụng cùng toàn bộ dependency (thư viện, runtime, biến môi trường, file cấu hình) vào một đơn vị gọi là **container**. Container chạy nhất quán trên mọi môi trường: laptop, server vật lý, cloud, CI/CD pipeline.

Kiến trúc Docker gồm ba thành phần chính giao tiếp với nhau:

```
┌─────────────────────────────────────────────────────────┐
│                        Docker Host                       │
│                                                          │
│   ┌──────────────┐        ┌──────────────────────────┐  │
│   │ Docker Client│──REST──│      Docker Daemon        │  │
│   │  (docker CLI)│        │  (dockerd / containerd)   │  │
│   └──────────────┘        └────────────┬─────────────┘  │
│                                        │                  │
│                            ┌───────────▼──────────┐      │
│                            │  Container Runtime    │      │
│                            │  (runc via containerd)│      │
│                            └───────────────────────┘      │
└─────────────────────────────────────────────────────────┘
           │ docker pull/push
           ▼
   ┌───────────────┐
   │ Docker Registry│  (Docker Hub / private registry)
   └───────────────┘
```

**Luồng hoạt động cơ bản:**

1. Người dùng gõ lệnh `docker run nginx` ở terminal (Docker Client)
2. Client gửi yêu cầu đến Docker Daemon qua Unix socket `/var/run/docker.sock`
3. Daemon kiểm tra image `nginx` cục bộ; nếu chưa có thì pull từ Docker Hub
4. Daemon tạo container từ image và khởi chạy thông qua `containerd` → `runc`
5. Container chạy như một process được cô lập trên kernel host

---

### 1.2 Docker Image

**Docker Image** là một template read-only chứa filesystem và metadata để tạo ra container. Image được xây dựng theo mô hình **layer** (tầng): mỗi lệnh trong Dockerfile tạo ra một layer mới chồng lên layer trước.

#### Cấu trúc layer

```
Layer 4 (R/W) ─── Container Layer  ← thay đổi runtime ghi vào đây
Layer 3 (RO)  ─── COPY ./app /app
Layer 2 (RO)  ─── RUN apt-get install -y curl
Layer 1 (RO)  ─── FROM ubuntu:22.04           ← base image
```

Các layer read-only được **chia sẻ** giữa nhiều container, giúp tiết kiệm dung lượng đĩa. Khi container cần sửa file ở layer bên dưới, Docker dùng cơ chế **Copy-on-Write (CoW)**: sao chép file lên container layer trước khi chỉnh sửa.

#### Các lệnh thao tác với Image

```bash
# Tải image từ registry
docker pull nginx:alpine

# Liệt kê image đang có
docker images

# Xem chi tiết các layer của image
docker history nginx:alpine

# Inspect metadata (entrypoint, env, expose...)
docker inspect nginx:alpine

# Xóa image
docker rmi nginx:alpine

# Tag image
docker tag my-app:latest registry.example.com/my-app:v1.0
```

#### Dockerfile – các chỉ thị quan trọng

| Chỉ thị | Mục đích |
|---|---|
| `FROM` | Chỉ định base image |
| `RUN` | Chạy lệnh shell trong quá trình build (tạo layer mới) |
| `COPY` | Sao chép file từ host vào image |
| `ADD` | Như COPY nhưng hỗ trợ URL và tự giải nén tar |
| `ENV` | Khai báo biến môi trường |
| `EXPOSE` | Khai báo cổng (chỉ là metadata, không tự publish) |
| `VOLUME` | Khai báo mount point |
| `WORKDIR` | Đặt thư mục làm việc |
| `CMD` | Lệnh mặc định khi container chạy (có thể override) |
| `ENTRYPOINT` | Lệnh chính của container (khó override hơn CMD) |
| `USER` | Đặt user chạy process (best practice: không dùng root) |

---

### 1.3 Docker Container

**Docker Container** là instance đang chạy (hoặc đã dừng) của một Docker Image. Container cung cấp môi trường cô lập thông qua các tính năng của Linux kernel: **namespaces** và **cgroups**.

#### Vòng đời container

```
docker create   docker start    docker stop / kill
     │               │                │
     ▼               ▼                ▼
 [created] ──── [running] ──── [stopped/exited]
                    │                  │
              docker pause       docker rm
                    │
               [paused]
```

#### Các lệnh thao tác với Container

```bash
# Tạo và chạy container (kết hợp create + start)
docker run -d --name webserver -p 8080:80 nginx:alpine

# Liệt kê container đang chạy
docker ps

# Liệt kê tất cả container (gồm cả stopped)
docker ps -a

# Xem log
docker logs -f webserver

# Truy cập shell bên trong container
docker exec -it webserver /bin/sh

# Dừng và xóa
docker stop webserver
docker rm webserver

# Xem thống kê tài nguyên realtime
docker stats webserver

# Xem thông tin chi tiết
docker inspect webserver
```

---

### 1.4 Docker Client

**Docker Client** là giao diện dòng lệnh (`docker`) mà người dùng tương tác trực tiếp. Mỗi lệnh Docker Client thực hiện đều được chuyển thành HTTP request gửi đến Docker Daemon thông qua:

- **Unix socket** `/var/run/docker.sock` (mặc định, giao tiếp cục bộ)
- **TCP socket** `tcp://host:2376` (khi kết nối remote daemon, nên dùng TLS)

```
User Terminal
     │
     │  docker run nginx
     ▼
Docker CLI (docker)
     │
     │  POST /containers/create   (HTTP over Unix socket)
     │  POST /containers/{id}/start
     ▼
Docker Daemon (dockerd)
     │
     │  Gọi containerd API
     ▼
containerd → runc → Container Process
```

Docker Client và Docker Daemon không nhất thiết phải trên cùng một máy. Biến môi trường `DOCKER_HOST` cho phép chỉ định daemon từ xa:

```bash
export DOCKER_HOST=tcp://192.168.1.100:2376
docker ps   # liệt kê container trên máy remote
```

---

### 1.5 Docker Volume

**Docker Volume** là cơ chế lưu trữ dữ liệu bền vững (persistent storage) tách biệt khỏi vòng đời của container. Khi container bị xóa, dữ liệu trong volume vẫn còn nguyên.

#### Ba loại mount

```
Host Machine
├── /home/user/data/        ◄── Bind Mount: ánh xạ thư mục host trực tiếp
│
└── /var/lib/docker/volumes/
    └── my_volume/_data/    ◄── Named Volume: Docker quản lý

                            ◄── tmpfs Mount: lưu trong RAM, mất khi container stop
```

| Đặc điểm | Bind Mount | Named Volume | tmpfs |
|---|---|---|---|
| Vị trí lưu | Do user chỉ định | Docker quản lý | RAM |
| Dùng cho | Config, source code | Database, persistent data | Dữ liệu nhạy cảm tạm thời |
| Chia sẻ giữa containers | Có (phải cùng path) | Có (dùng volume name) | Không |
| Backup dễ | Dễ | Cần `docker volume` CLI | Không cần |
| Hiệu năng | Phụ thuộc OS | Tốt hơn bind mount | Nhanh nhất |

#### Các lệnh quản lý Volume

```bash
# Tạo named volume
docker volume create my_data

# Liệt kê volume
docker volume ls

# Xem thông tin
docker volume inspect my_data

# Chạy container với volume
docker run -d \
  -v my_data:/var/lib/mysql \         # named volume
  -v ./config:/etc/mysql/conf.d:ro \  # bind mount, read-only
  mysql:8.0

# Xóa volume (không xóa được nếu đang dùng)
docker volume rm my_data

# Dọn dẹp volume không dùng
docker volume prune
```

---

### 1.6 Docker Network

**Docker Network** cho phép các container giao tiếp với nhau và với thế giới bên ngoài. Docker cung cấp sẵn nhiều driver network:

#### Các loại network driver

```
bridge (mặc định)
│
├── Tạo virtual switch docker0 trên host
├── Mỗi container nhận một veth interface nối vào docker0
├── Container giao tiếp nhau qua bridge IP
└── Giao tiếp ra ngoài qua NAT (iptables MASQUERADE)

host
├── Container dùng trực tiếp network stack của host
├── Không có network isolation
└── Port container = port host (không cần -p)

none
├── Container hoàn toàn cô lập network
└── Dùng cho container xử lý dữ liệu offline

overlay
├── Kết nối container trên nhiều Docker host
└── Dùng trong Docker Swarm / Kubernetes
```

#### Các lệnh quản lý Network

```bash
# Liệt kê network
docker network ls

# Tạo custom bridge network
docker network create --driver bridge my_net

# Tạo network với subnet chỉ định
docker network create \
  --driver bridge \
  --subnet 172.20.0.0/16 \
  --gateway 172.20.0.1 \
  backend_net

# Gán container vào network
docker network connect my_net webserver

# Kiểm tra network
docker network inspect my_net

# Xóa network
docker network rm my_net
```

**Lưu ý quan trọng:** Các container trong cùng một **user-defined bridge network** có thể giao tiếp với nhau qua **tên container** (DNS nội bộ), thay vì phải dùng IP. Đây là điểm khác biệt so với default bridge network.

```bash
# Container "app" có thể kết nối đến container "db" bằng hostname "db"
docker run -d --network my_net --name db postgres:16
docker run -d --network my_net --name app \
  -e DATABASE_URL=postgresql://db:5432/mydb \
  my-app:latest
```

---

### 1.7 So sánh Virtual Machine và Docker Container

#### Sơ đồ kiến trúc

```
┌─────────────────────────────┐    ┌─────────────────────────────┐
│      Virtual Machine        │    │     Docker Container         │
├─────────────────────────────┤    ├─────────────────────────────┤
│  App A  │  App B  │  App C  │    │  App A  │  App B  │  App C  │
├─────────┼─────────┼─────────┤    ├─────────┼─────────┼─────────┤
│Guest OS │Guest OS │Guest OS │    │  Libs   │  Libs   │  Libs   │
├─────────┴─────────┴─────────┤    ├─────────────────────────────┤
│       Hypervisor            │    │      Container Runtime       │
│  (VMware / KVM / VirtualBox)│    │  (Docker Engine / containerd)│
├─────────────────────────────┤    ├─────────────────────────────┤
│         Host OS             │    │         Host OS             │
├─────────────────────────────┤    ├─────────────────────────────┤
│      Hardware / Cloud       │    │      Hardware / Cloud       │
└─────────────────────────────┘    └─────────────────────────────┘
```

#### Bảng so sánh chi tiết

| Tiêu chí | Virtual Machine | Docker Container |
|---|---|---|
| **Isolation** | Hoàn toàn (kernel riêng) | Namespace-level (dùng chung kernel host) |
| **Kernel** | Guest OS kernel riêng | Dùng kernel của host |
| **Boot time** | 30 giây – vài phút | Dưới 1 giây |
| **Dung lượng** | Hàng chục GB (bao gồm cả OS) | Vài MB – vài trăm MB |
| **RAM overhead** | Cao (Guest OS chiếm RAM) | Thấp (chỉ process + libs) |
| **CPU overhead** | Trung bình (hypervisor layer) | Gần như zero (near-native) |
| **Portable** | Phụ thuộc hypervisor | Chạy mọi nơi có Docker Engine |
| **Security** | Cao hơn (kernel riêng biệt) | Thấp hơn một chút (kernel chung) |
| **Persistent storage** | Virtual disk (VMDK, QCOW2) | Volume / Bind mount |
| **Use case** | Cần OS khác nhau, bảo mật cao | Microservice, CI/CD, scale nhanh |

**Khi nào dùng VM:**
- Cần chạy Windows và Linux trên cùng host
- Yêu cầu bảo mật/cô lập tuyệt đối (PCI-DSS, môi trường đa tenant)
- Ứng dụng legacy không thể container hóa

**Khi nào dùng Container:**
- Microservices, ứng dụng cloud-native
- CI/CD pipeline cần môi trường nhất quán
- Scale nhanh, deploy thường xuyên
- Tiết kiệm tài nguyên trên cùng host

---

### 1.8 So sánh chương trình trong Container và trên máy thật

Về bản chất, một container chỉ là **một process Linux bình thường** được cô lập bởi các tính năng kernel: **Namespaces** và **cgroups**.

#### Linux Namespaces – tạo "thế giới riêng" cho container

| Namespace | Cô lập cái gì | Ví dụ |
|---|---|---|
| **PID** | Process IDs | Process đầu tiên trong container có PID=1; ngoài host thấy PID khác |
| **Network** | Interface, routing, port | Container có eth0 riêng, IP riêng |
| **Mount** | Filesystem mounts | Container thấy `/` khác hoàn toàn với host |
| **UTS** | Hostname, domainname | Container có hostname riêng |
| **IPC** | Message queue, shared memory | Cô lập IPC với container khác |
| **User** | UID/GID mapping | root trong container ≠ root trên host |

```bash
# Kiểm tra: process bên trong container
docker exec webserver ps aux
# PID 1: nginx master
# PID 8: nginx worker

# Kiểm tra process đó trên host (PID khác hoàn toàn)
ps aux | grep nginx
# host PID 12345: nginx master
```

#### cgroups – giới hạn tài nguyên

```bash
# Giới hạn container chỉ dùng tối đa 0.5 CPU và 256MB RAM
docker run -d \
  --cpus="0.5" \
  --memory="256m" \
  --memory-swap="256m" \
  nginx:alpine

# Xem thông số giới hạn
docker inspect --format='{{.HostConfig.Memory}}' webserver
```

#### So sánh hiệu năng

| Tiêu chí | Container | Máy thật |
|---|---|---|
| **CPU** | Near-native (overhead < 1%) | Native |
| **RAM** | Near-native | Native |
| **Disk I/O** | Nhẹ hơn do OverlayFS | Native |
| **Network** | Có latency nhỏ qua veth/bridge | Native |
| **System calls** | Qua kernel host trực tiếp | Trực tiếp |

**Điểm khác biệt thực tế quan trọng:**

- **Filesystem:** Container dùng OverlayFS (UnionFS). File ghi vào container layer theo cơ chế Copy-on-Write — lần đọc đầu tiên sau khi copy có thể chậm hơn một chút.
- **PID 1 vấn đề:** Trong container, process đầu tiên (PID 1) không có sẵn signal handler như `init`. Nếu dùng shell script làm entrypoint mà không `exec`, zombie process có thể xảy ra.
- **Signal handling:** `docker stop` gửi SIGTERM đến PID 1; sau 10 giây gửi SIGKILL. Ứng dụng cần xử lý SIGTERM để graceful shutdown.
- **Không có systemd:** Container không chạy init system. Chỉ chạy một process chính, quản lý vòng đời qua Docker.

---

### 1.9 Container giao tiếp với mạng bên ngoài

#### Luồng packet từ container ra internet (Bridge network)

```
Container (eth0: 172.17.0.2)
        │
        │ veth pair (virtual ethernet cable)
        ▼
docker0 bridge (172.17.0.1) – virtual switch trên host
        │
        │ iptables MASQUERADE (NAT)
        │ Source IP: 172.17.0.2 → thành IP host (e.g. 192.168.1.10)
        ▼
  eth0 host (192.168.1.10)
        │
        ▼
     Router → Internet
```

#### Port Mapping (-p): từ ngoài vào container

```
Client (Internet)
        │
        │ TCP → 192.168.1.10:8080
        ▼
  Host eth0 (192.168.1.10)
        │
        │ iptables DNAT rule:
        │ dst 0.0.0.0:8080 → 172.17.0.2:80
        ▼
docker0 bridge
        │
        ▼
Container eth0 (172.17.0.2:80)  ← nginx đang lắng nghe
```

```bash
# Kiểm tra iptables rule Docker tạo ra
sudo iptables -t nat -L DOCKER -n --line-numbers

# Port mapping: host:8080 → container:80
docker run -d -p 8080:80 nginx:alpine

# Bind vào interface cụ thể (chỉ cho phép localhost)
docker run -d -p 127.0.0.1:8080:80 nginx:alpine

# Publish tất cả EXPOSE port tự động
docker run -d -P nginx:alpine
```

#### DNS nội bộ (Container-to-Container)

```bash
# Tạo network và các container
docker network create app_net
docker run -d --network app_net --name api my-api:latest
docker run -d --network app_net --name db postgres:16

# Container "api" resolve được hostname "db" qua DNS nội bộ 127.0.0.11
docker exec api ping db
# PING db (172.20.0.3): 56 data bytes ...
```

Docker chạy một DNS resolver nhúng tại `127.0.0.11` bên trong mỗi container trên user-defined network. Container tự động đăng ký tên của mình vào DNS này khi join network.

#### Network mode Host

```bash
# Container dùng trực tiếp network của host, không cần -p
docker run -d --network host nginx:alpine
# Nginx lắng nghe cổng 80 trực tiếp trên host
# Dùng cho keepalived, performance-critical apps
```

---

## Phần 2 – Triển khai hệ thống bằng Docker

### 2.1 Dockerfile – Nginx web tĩnh

#### Cấu trúc thư mục dự án

```
nginx-static/
├── Dockerfile
├── nginx.conf              ← cấu hình nginx tùy chỉnh
├── html/
│   └── index.html          ← nội dung web tĩnh
├── logs/                   ← thư mục log (mount ra host)
└── config/                 ← thư mục config nginx (mount ra host)
    └── nginx.conf
```

#### Dockerfile

```dockerfile
# Dùng nginx alpine để image nhỏ gọn (~25MB)
FROM nginx:1.25-alpine

# Metadata
LABEL maintainer="sre-intern@company.com"
LABEL version="1.0"

# Xóa default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy nội dung web tĩnh
COPY html/ /usr/share/nginx/html/

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Khai báo port (chỉ là metadata)
EXPOSE 80

# Healthcheck: kiểm tra nginx còn sống mỗi 30 giây
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1

# Chạy nginx ở foreground (không dùng daemon mode)
CMD ["nginx", "-g", "daemon off;"]
```

#### nginx.conf

```nginx
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
                      '$status $body_bytes_sent "$http_referer" '
                      '"$http_user_agent"';

    access_log  /var/log/nginx/access.log  main;
    sendfile        on;
    keepalive_timeout  65;

    server {
        listen       80;
        server_name  localhost;
        root   /usr/share/nginx/html;
        index  index.html;

        # Health check endpoint
        location /health {
            access_log off;
            return 200 "OK\n";
            add_header Content-Type text/plain;
        }

        location / {
            try_files $uri $uri/ =404;
        }
    }
}
```

#### html/index.html

```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>SRE Intern – Docker Demo</title>
</head>
<body>
    <h1>Hello from Docker Container!</h1>
    <p>Nginx web tĩnh chạy trong container.</p>
</body>
</html>
```

#### Build và Run

```bash
# Build image
docker build -t my-nginx:v1 .

# Kiểm tra image đã build
docker images my-nginx

# Tạo thư mục trên host để mount
mkdir -p ./logs ./config

# Run container:
#   -d          : chạy background (detached)
#   -p 8080:80  : expose port 80 ra cổng 8080 trên host
#   -v ./logs   : mount thư mục log ra host
#   -v ./config : mount cấu hình nginx từ host (read-only)
docker run -d \
  --name my-nginx \
  -p 8080:80 \
  -v "$(pwd)/logs":/var/log/nginx \
  -v "$(pwd)/config/nginx.conf":/etc/nginx/nginx.conf:ro \
  --restart unless-stopped \
  my-nginx:v1

# Kiểm tra container đang chạy
docker ps

# Kiểm tra web
curl http://localhost:8080

# Xem log trực tiếp trên host
tail -f ./logs/access.log

# Kiểm tra health
docker inspect --format='{{.State.Health.Status}}' my-nginx
```

---

### 2.2 Mô hình hệ thống HAProxy + Keepalived + Nginx

#### Sơ đồ kiến trúc

```
                     Internet / Client
                           │
                           │ request đến VIP: 192.168.1.100:80
                           ▼
          ┌────────────────────────────────┐
          │   Virtual IP (VIP)             │
          │   192.168.1.100 (Keepalived)   │
          └────────────┬───────────────────┘
                       │  
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
  ┌───────────────┐         ┌───────────────┐
  │  HAProxy      │ MASTER  │  HAProxy      │ BACKUP
  │  Master       │◄──────► │  Backup       │
  │  192.168.1.10 │         │  192.168.1.11 │
  └───────┬───────┘         └───────────────┘
          │ Load Balance (Round Robin)
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
┌───────┐┌───────┐┌───────┐
│Nginx-1││Nginx-2││Nginx-3│
│web1   ││web2   ││web3   │
└───────┘└───────┘└───────┘
```

**Nguyên lý hoạt động:**

1. Keepalived chạy giao thức **VRRP** (Virtual Router Redundancy Protocol) giữa HAProxy Master và Backup
2. Master giữ VIP `192.168.1.100`. Khi Master down, Backup chiếm VIP sau ~2 giây
3. HAProxy nhận request từ VIP và phân phối đến các Nginx backend theo thuật toán Round Robin
4. Nginx phục vụ nội dung web tĩnh

#### Cấu trúc thư mục

```
docker-stack/
├── docker-compose.yml
├── .env
├── haproxy/
│   ├── master/
│   │   ├── haproxy.cfg
│   │   └── keepalived.conf
│   ├── backup/
│   │   ├── haproxy.cfg
│   │   └── keepalived.conf
│   └── check_haproxy.sh        ← script kiểm tra HAProxy
├── nginx/
│   ├── nginx.conf
│   └── html/
│       ├── index.html
│       ├── node1/index.html
│       ├── node2/index.html
│       └── node3/index.html
└── volumes/                    ← thư mục mount dữ liệu ra host
    ├── haproxy-master-log/
    ├── haproxy-backup-log/
    ├── nginx1-log/
    ├── nginx2-log/
    └── nginx3-log/
```

---

### 2.3 Cấu hình HAProxy

#### haproxy/master/haproxy.cfg

```
global
    log         /dev/log local0
    log         /dev/log local1 notice
    maxconn     50000
    daemon
    stats socket /var/run/haproxy/admin.sock mode 660 level admin

defaults
    log     global
    mode    http
    option  httplog
    option  dontlognull
    option  forwardfor
    option  http-server-close
    timeout connect  5s
    timeout client   30s
    timeout server   30s
    retries 3

# Trang thống kê HAProxy
frontend stats
    bind *:8404
    stats enable
    stats uri /stats
    stats refresh 10s
    stats auth admin:admin123
    stats show-legends

# Frontend: nhận request từ client
frontend http_in
    bind *:80
    default_backend nginx_backend

# Backend: phân phối đến các Nginx
backend nginx_backend
    balance     roundrobin
    option      httpchk GET /health
    http-check  expect status 200
    
    server nginx1 nginx1:80 check inter 2s rise 2 fall 3
    server nginx2 nginx2:80 check inter 2s rise 2 fall 3
    server nginx3 nginx3:80 check inter 2s rise 2 fall 3
```

#### haproxy/check_haproxy.sh

```bash
#!/bin/bash
# Script kiểm tra HAProxy còn sống
# Keepalived gọi script này để quyết định có giữ VIP hay không

HAPROXY_PID=$(pidof haproxy)

if [ -z "$HAPROXY_PID" ]; then
    # HAProxy không chạy → trả về 1 để keepalived nhường VIP
    exit 1
fi

# Kiểm tra HAProxy respond
if ! curl -sf http://127.0.0.1:8404/stats -o /dev/null; then
    exit 1
fi

exit 0
```

```bash
chmod +x haproxy/check_haproxy.sh
```

---

### 2.4 Cấu hình Keepalived

#### haproxy/master/keepalived.conf

```
global_defs {
    router_id HAProxy_Master
    script_user root
}

# Script kiểm tra HAProxy còn sống
vrrp_script check_haproxy {
    script "/etc/keepalived/check_haproxy.sh"
    interval 2          # kiểm tra mỗi 2 giây
    weight   -20        # nếu fail, giảm priority đi 20
    fall     2          # fail 2 lần liên tiếp → coi là down
    rise     2          # pass 2 lần liên tiếp → coi là up
}

vrrp_instance VI_1 {
    state  MASTER           # MASTER trên node này
    interface eth0          # interface mạng (trong container = eth0)
    virtual_router_id 51    # ID VRRP, phải giống nhau trên cả 2 node
    priority  100           # Master có priority cao hơn Backup (80)
    advert_int 1            # gửi VRRP advertisement mỗi 1 giây
    
    authentication {
        auth_type PASS
        auth_pass secret123
    }
    
    virtual_ipaddress {
        192.168.1.100/24    # VIP sẽ được gán vào interface eth0
    }
    
    track_script {
        check_haproxy       # theo dõi script trên
    }
}
```

#### haproxy/backup/keepalived.conf

```
global_defs {
    router_id HAProxy_Backup
    script_user root
}

vrrp_script check_haproxy {
    script "/etc/keepalived/check_haproxy.sh"
    interval 2
    weight   -20
    fall     2
    rise     2
}

vrrp_instance VI_1 {
    state  BACKUP           # BACKUP trên node này
    interface eth0
    virtual_router_id 51    # phải giống MASTER
    priority  80            # Backup có priority thấp hơn
    advert_int 1
    
    authentication {
        auth_type PASS
        auth_pass secret123
    }
    
    virtual_ipaddress {
        192.168.1.100/24
    }
    
    track_script {
        check_haproxy
    }
}
```

---

### 2.5 Docker Compose – Toàn bộ stack

#### .env

```bash
# Virtual IP – phải thuộc cùng subnet với host
VIP=192.168.1.100

# Interface mạng của host (kiểm tra bằng: ip addr show)
IFACE=eth0

# Phiên bản image
NGINX_VERSION=1.25-alpine
HAPROXY_VERSION=2.9-alpine
KEEPALIVED_VERSION=latest
```

#### docker-compose.yml

```yaml
version: "3.9"

networks:
  frontend:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24
  backend:
    driver: bridge
    ipam:
      config:
        - subnet: 172.21.0.0/24

services:

  # ─── Nginx Backends ───────────────────────────────────
  nginx1:
    image: nginx:${NGINX_VERSION}
    container_name: nginx1
    restart: unless-stopped
    networks:
      - backend
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/html/node1:/usr/share/nginx/html:ro
      - ./volumes/nginx1-log:/var/log/nginx
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/health"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s

  nginx2:
    image: nginx:${NGINX_VERSION}
    container_name: nginx2
    restart: unless-stopped
    networks:
      - backend
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/html/node2:/usr/share/nginx/html:ro
      - ./volumes/nginx2-log:/var/log/nginx
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/health"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s

  nginx3:
    image: nginx:${NGINX_VERSION}
    container_name: nginx3
    restart: unless-stopped
    networks:
      - backend
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/html/node3:/usr/share/nginx/html:ro
      - ./volumes/nginx3-log:/var/log/nginx
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost/health"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 5s

  # ─── HAProxy Master ────────────────────────────────────
  haproxy-master:
    image: haproxytech/haproxy-alpine:${HAPROXY_VERSION:-2.9}
    container_name: haproxy-master
    restart: unless-stopped
    # Dùng host network để keepalived có thể gán VIP vào interface thật
    network_mode: host
    cap_add:
      - NET_ADMIN       # cần để keepalived thêm/xóa VIP
      - NET_BROADCAST   # cần cho VRRP multicast
    volumes:
      - ./haproxy/master/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
      - ./haproxy/master/keepalived.conf:/etc/keepalived/keepalived.conf:ro
      - ./haproxy/check_haproxy.sh:/etc/keepalived/check_haproxy.sh:ro
      - ./volumes/haproxy-master-log:/var/log/haproxy
    depends_on:
      nginx1:
        condition: service_healthy
      nginx2:
        condition: service_healthy
      nginx3:
        condition: service_healthy
    # Chạy cả HAProxy và Keepalived trong cùng container
    command: >
      sh -c "keepalived --dont-fork --log-console &
             haproxy -f /usr/local/etc/haproxy/haproxy.cfg -W"
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:8404/stats"]
      interval: 10s
      timeout: 5s
      retries: 3

  # ─── HAProxy Backup ────────────────────────────────────
  haproxy-backup:
    image: haproxytech/haproxy-alpine:${HAPROXY_VERSION:-2.9}
    container_name: haproxy-backup
    restart: unless-stopped
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_BROADCAST
    volumes:
      - ./haproxy/backup/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
      - ./haproxy/backup/keepalived.conf:/etc/keepalived/keepalived.conf:ro
      - ./haproxy/check_haproxy.sh:/etc/keepalived/check_haproxy.sh:ro
      - ./volumes/haproxy-backup-log:/var/log/haproxy
    depends_on:
      - haproxy-master
    command: >
      sh -c "keepalived --dont-fork --log-console &
             haproxy -f /usr/local/etc/haproxy/haproxy.cfg -W"
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://127.0.0.1:8404/stats"]
      interval: 10s
      timeout: 5s
      retries: 3
```

---

### 2.6 Hướng dẫn triển khai chi tiết

#### Yêu cầu tài nguyên

| Thành phần | CPU | RAM | Disk |
|---|---|---|---|
| HAProxy Master | 0.5 core | 128 MB | 1 GB (log) |
| HAProxy Backup | 0.5 core | 128 MB | 1 GB (log) |
| Nginx x3 | 0.25 core mỗi node | 64 MB mỗi node | 5 GB (data + log) |
| **Tổng cộng** | **~2 core** | **~512 MB** | **~10 GB** |

#### Yêu cầu hệ điều hành

| Mục | Yêu cầu |
|---|---|
| OS | Ubuntu 22.04 LTS (khuyến nghị) hoặc Debian 12 |
| Kernel | ≥ 5.15 (hỗ trợ OverlayFS, cgroups v2) |
| Docker Engine | ≥ 24.0 |
| Docker Compose | v2.x (`docker compose` thay vì `docker-compose`) |
| Mạng | Host phải có IP tĩnh; VIP phải cùng subnet với host |
| User | Có quyền sudo hoặc thuộc group `docker` |

#### Bước 1 – Cài đặt Docker Engine

```bash
# Gỡ phiên bản cũ nếu có
sudo apt-get remove docker docker-engine docker.io containerd runc

# Cài dependencies
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Thêm GPG key của Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Thêm Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Cài đặt
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Thêm user hiện tại vào group docker (không cần sudo mỗi lần)
sudo usermod -aG docker $USER
newgrp docker

# Kiểm tra
docker --version
docker compose version
```

#### Bước 2 – Chuẩn bị source code

```bash
# Clone hoặc tạo mới thư mục dự án
git clone https://github.com/your-org/docker-stack.git
cd docker-stack

# Tạo toàn bộ thư mục cần thiết
mkdir -p \
  haproxy/master \
  haproxy/backup \
  nginx/html/{node1,node2,node3} \
  volumes/{haproxy-master-log,haproxy-backup-log,nginx1-log,nginx2-log,nginx3-log}

# Phân quyền thư mục log
chmod 755 volumes/*/
```

#### Bước 3 – Cấu hình biến môi trường

```bash
# Tạo file .env
cp .env.example .env

# Xác định interface mạng của host
ip addr show
# ví dụ: eth0, ens3, enp0s3...

# Chỉnh sửa .env
nano .env
# VIP=192.168.1.100    ← IP ảo, chưa dùng trong mạng
# IFACE=eth0           ← interface thật của host
```

#### Bước 4 – Copy file cấu hình

```bash
# Copy haproxy.cfg và keepalived.conf theo cấu trúc ở mục 2.3 và 2.4
# (sao chép nội dung từ tài liệu này)

# Cấp quyền thực thi cho script keepalived
chmod +x haproxy/check_haproxy.sh
```

#### Bước 5 – Tạo nội dung web cho từng node

```bash
# Node 1
cat > nginx/html/node1/index.html << 'EOF'
<h1>Backend Node 1</h1><p>Served by nginx1</p>
EOF

# Node 2
cat > nginx/html/node2/index.html << 'EOF'
<h1>Backend Node 2</h1><p>Served by nginx2</p>
EOF

# Node 3
cat > nginx/html/node3/index.html << 'EOF'
<h1>Backend Node 3</h1><p>Served by nginx3</p>
EOF
```

#### Bước 6 – Khởi động stack

```bash
# Kéo tất cả image về trước (không cần internet sau bước này)
docker compose pull

# Khởi động toàn bộ stack ở background
docker compose up -d

# Theo dõi quá trình khởi động
docker compose ps
docker compose logs -f
```

#### Bước 7 – Kiểm tra sau triển khai

```bash
# 1. Kiểm tra tất cả container đang running
docker compose ps
# Expected: tất cả Status = running, Health = healthy

# 2. Kiểm tra VIP đã được gán chưa
ip addr show eth0 | grep "192.168.1.100"
# Expected: inet 192.168.1.100/24

# 3. Curl đến VIP
curl http://192.168.1.100
# Expected: trả về HTML từ một trong các nginx backend

# 4. Kiểm tra load balancing (chạy nhiều lần)
for i in {1..6}; do curl -s http://192.168.1.100 | grep "Node"; done
# Expected: xoay vòng Node 1, 2, 3

# 5. Kiểm tra trang stats HAProxy
curl http://192.168.1.100:8404/stats
# Hoặc mở browser: http://192.168.1.100:8404/stats (admin/admin123)

# 6. Xem log realtime
tail -f volumes/haproxy-master-log/*.log
tail -f volumes/nginx1-log/access.log
```

#### Bước 8 – Kiểm tra Failover

```bash
# Terminal 1: theo dõi VIP liên tục
watch -n1 "ip addr show eth0 | grep 192.168.1.100"

# Terminal 2: gửi request liên tục
while true; do curl -s http://192.168.1.100 -o /dev/null -w "%{http_code}\n"; sleep 0.5; done

# Terminal 3: dừng haproxy-master để test failover
docker compose stop haproxy-master

# Quan sát:
# - VIP chuyển sang haproxy-backup (< 3 giây)
# - Request vẫn trả về 200 OK (không bị gián đoạn)

# Khởi động lại haproxy-master
docker compose start haproxy-master
# VIP sẽ trở về master vì priority cao hơn
```

#### Rollback

```bash
# Dừng toàn bộ stack (giữ nguyên volume)
docker compose down

# Dừng và xóa volume (CẢNH BÁO: mất dữ liệu log)
docker compose down -v

# Cập nhật lên phiên bản mới
git pull
docker compose pull
docker compose up -d

# Rollback về image cũ
# Sửa NGINX_VERSION hoặc HAPROXY_VERSION trong .env
docker compose up -d --force-recreate
```

#### Troubleshooting

```bash
# Container không start được
docker compose logs haproxy-master

# Kiểm tra health của container cụ thể
docker inspect --format='{{json .State.Health}}' haproxy-master | python3 -m json.tool

# VIP không được gán
docker exec haproxy-master ip addr show
docker exec haproxy-master keepalived --version

# HAProxy không forward được đến nginx
docker exec haproxy-master curl http://nginx1/health
docker exec haproxy-master curl http://nginx2/health

# Xem iptables rules (trên host)
sudo iptables -t nat -L -n -v

# Kiểm tra port đang listen
sudo ss -tlnp | grep -E "80|8404"

# Reset container bị stuck
docker compose restart haproxy-master
```

---

## Phần 3 – Cấu hình service chạy Docker Container

### 3.1 Docker Container và Image nâng cao

Phần này đi sâu vào các kỹ thuật vận hành container và quản lý image ở cấp độ production, bổ sung cho kiến thức cơ bản ở Phần 1.

#### Multi-stage Build – tối ưu Image size

Multi-stage build cho phép dùng nhiều `FROM` trong một Dockerfile. Mỗi stage có thể copy artifact từ stage trước, giúp image cuối cùng chỉ chứa những gì cần thiết để chạy (không bao gồm compiler, build tool).

```dockerfile
# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build          # tạo ra thư mục dist/

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM nginx:1.25-alpine AS runtime
# Chỉ copy kết quả build, không copy node_modules hay source code
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

```bash
docker build -t my-app:prod .
docker images my-app
# my-app:prod   ~25MB  (thay vì ~400MB nếu dùng node image)
```

#### Image Tagging và Registry workflow

```bash
# Build với nhiều tag
docker build \
  -t registry.example.com/team/app:latest \
  -t registry.example.com/team/app:v2.1.0 \
  -t registry.example.com/team/app:v2.1 \
  .

# Login private registry
docker login registry.example.com

# Push lên registry
docker push registry.example.com/team/app:v2.1.0
docker push registry.example.com/team/app:latest

# Pull về và chạy
docker pull registry.example.com/team/app:v2.1.0
docker run -d registry.example.com/team/app:v2.1.0
```

#### Container Resource Constraints

```bash
# Giới hạn CPU và RAM
docker run -d \
  --name api-server \
  --cpus="1.5" \               # tối đa 1.5 CPU core
  --memory="512m" \            # tối đa 512MB RAM
  --memory-swap="512m" \       # tắt swap (= memory, không dùng swap)
  --memory-reservation="256m" \# soft limit (cảnh báo khi vượt)
  --restart unless-stopped \
  my-api:latest

# Kiểm tra giới hạn đang áp dụng
docker stats api-server
docker inspect api-server | grep -A5 '"Memory"'
```

#### Restart Policy

| Policy | Hành vi |
|---|---|
| `no` (mặc định) | Không tự khởi động lại |
| `on-failure[:max]` | Restart khi exit code ≠ 0; `max` là số lần tối đa |
| `always` | Luôn restart, kể cả sau `docker stop` rồi reboot host |
| `unless-stopped` | Như `always` nhưng không restart nếu user chủ động `docker stop` |

```bash
# Production service
docker run -d --restart unless-stopped nginx:alpine

# Job có thể fail, thử lại tối đa 3 lần
docker run --restart on-failure:3 my-job:latest
```

#### Healthcheck nâng cao

```dockerfile
# Trong Dockerfile
HEALTHCHECK \
  --interval=30s \    # kiểm tra mỗi 30 giây
  --timeout=5s \      # timeout mỗi lần kiểm tra
  --start-period=10s \# bỏ qua kết quả unhealthy trong 10s đầu
  --retries=3 \       # 3 lần unhealthy liên tiếp → trạng thái unhealthy
  CMD curl -f http://localhost/health || exit 1
```

```bash
# Override healthcheck khi chạy
docker run -d \
  --health-cmd="pg_isready -U postgres" \
  --health-interval=10s \
  --health-retries=5 \
  postgres:16

# Xem kết quả healthcheck
docker inspect --format='{{json .State.Health}}' my-container | python3 -m json.tool
```

#### Prune – dọn dẹp tài nguyên

```bash
# Xóa container stopped
docker container prune

# Xóa image không dùng (dangling)
docker image prune

# Xóa image không có container nào dùng
docker image prune -a

# Xóa toàn bộ: container stopped, network, image, build cache
docker system prune -a --volumes

# Xem dung lượng Docker đang chiếm
docker system df
```

---

### 3.2 Docker Compose – Cấu hình chi tiết

**Docker Compose** là công cụ định nghĩa và chạy multi-container application bằng một file YAML duy nhất (`docker-compose.yml` hoặc `compose.yml`). Thay vì gõ nhiều lệnh `docker run`, mọi thứ được khai báo declarative và khởi động bằng `docker compose up`.

#### Cấu trúc file Compose

```
compose.yml
├── version          ← (tuỳ chọn, bỏ qua với Compose v2)
├── services         ← định nghĩa các container
│   ├── <tên-service>
│   │   ├── image / build
│   │   ├── ports, environment, volumes
│   │   ├── networks, depends_on
│   │   └── healthcheck, restart, deploy
├── networks         ← khai báo custom network
└── volumes          ← khai báo named volume
```

#### Ví dụ: Stack Web App đầy đủ

```yaml
# compose.yml
services:

  # ── Database ──────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-appdb}
      POSTGRES_USER: ${DB_USER:-appuser}
      POSTGRES_PASSWORD: ${DB_PASSWORD}    # lấy từ .env
    volumes:
      - pg_data:/var/lib/postgresql/data   # persistent data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-appuser}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Redis Cache ───────────────────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: cache
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    networks:
      - backend
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  # ── Backend API ───────────────────────────────────────────
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: runtime           # chỉ dùng stage "runtime" (multi-stage)
    image: my-api:latest
    container_name: api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      NODE_ENV: production
    ports:
      - "3000:3000"
    volumes:
      - ./backend/uploads:/app/uploads     # user-uploaded files
    networks:
      - backend
      - frontend
    depends_on:
      postgres:
        condition: service_healthy         # chờ postgres healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # ── Frontend (Nginx) ──────────────────────────────────────
  web:
    build:
      context: ./frontend
    image: my-web:latest
    container_name: web
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    networks:
      - frontend
    depends_on:
      api:
        condition: service_healthy

networks:
  backend:
    driver: bridge
    internal: true              # không ra internet trực tiếp
  frontend:
    driver: bridge

volumes:
  pg_data:
    driver: local
```

#### File .env

```bash
# .env  (không commit lên git – thêm vào .gitignore)
DB_NAME=appdb
DB_USER=appuser
DB_PASSWORD=super_secret_pass
REDIS_PASSWORD=redis_secret
```

#### Các lệnh Docker Compose thường dùng

```bash
# Khởi động toàn bộ stack (background)
docker compose up -d

# Chỉ build lại image (không restart container đang chạy)
docker compose build

# Build và khởi động lại service cụ thể
docker compose up -d --build api

# Scale một service lên nhiều instance
docker compose up -d --scale api=3

# Xem trạng thái
docker compose ps

# Xem log của toàn bộ stack (follow)
docker compose logs -f

# Xem log của service cụ thể
docker compose logs -f api

# Chạy lệnh bên trong service đang chạy
docker compose exec api sh

# Chạy lệnh one-off (tạo container mới, chạy xong xóa)
docker compose run --rm api python manage.py migrate

# Dừng toàn bộ stack (giữ container và volume)
docker compose stop

# Dừng và xóa container, network (giữ volume)
docker compose down

# Dừng, xóa container, network VÀ volume
docker compose down -v

# Kéo image mới nhất cho tất cả service
docker compose pull

# Khởi động lại một service
docker compose restart api

# Xem config đã merge (bao gồm cả .env)
docker compose config
```

#### Compose Override – cấu hình theo môi trường

Docker Compose hỗ trợ merge nhiều file, dùng để tách cấu hình giữa dev và production:

```
compose.yml          ← config chung (base)
compose.override.yml ← tự động load khi chạy compose (dev)
compose.prod.yml     ← production overrides (load thủ công)
```

```yaml
# compose.override.yml (development)
services:
  api:
    volumes:
      - ./backend:/app   # mount source code để hot-reload
    environment:
      NODE_ENV: development
    ports:
      - "9229:9229"      # Node.js debug port
  postgres:
    ports:
      - "5432:5432"      # expose DB ra host để dùng GUI tool
```

```yaml
# compose.prod.yml (production)
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

```bash
# Development (tự động load compose.override.yml)
docker compose up -d

# Production (chỉ định file rõ ràng)
docker compose -f compose.yml -f compose.prod.yml up -d
```

---

### 3.3 Docker Swarm

**Docker Swarm** là công cụ container orchestration tích hợp sẵn trong Docker Engine, cho phép quản lý một **cluster** (cụm) nhiều máy chủ Docker như một đơn vị duy nhất. Swarm cung cấp tính năng: scheduling (lên lịch container), load balancing, service discovery, rolling update và self-healing.

#### Kiến trúc Swarm

```
┌──────────────────────────────────────────────────────────────────┐
│                        Docker Swarm Cluster                       │
│                                                                    │
│  ┌──────────────────────┐    ┌─────────────┐  ┌─────────────┐   │
│  │     Manager Node      │    │ Worker Node │  │ Worker Node │   │
│  │                       │    │             │  │             │   │
│  │  ┌─────────────────┐  │    │  container  │  │  container  │   │
│  │  │  Raft Consensus  │  │    │  container  │  │  container  │   │
│  │  │  (quorum vote)   │  │    └─────────────┘  └─────────────┘  │
│  │  └─────────────────┘  │                                        │
│  │  Scheduler / Dispatcher│◄──── docker service create           │
│  └──────────────────────┘                                        │
│                                                                    │
│  Overlay Network (tự động mã hóa giữa các node)                 │
└──────────────────────────────────────────────────────────────────┘
```

**Manager Node:** chứa trạng thái cluster (Raft log), lên lịch task cho worker, xử lý API. Nên có số lẻ manager (1, 3, 5) để đảm bảo quorum.

**Worker Node:** chạy container theo lệnh từ manager. Không tham gia quyết định cluster.

**Quorum:** với N manager, cluster cần ít nhất `⌊N/2⌋ + 1` manager online để hoạt động.

| Số Manager | Quorum tối thiểu | Chịu mất tối đa |
|---|---|---|
| 1 | 1 | 0 (không HA) |
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

#### Khởi tạo Swarm Cluster

```bash
# ── Trên máy Manager (IP: 192.168.1.10) ──────────────────────

# Khởi tạo Swarm, chỉ định IP advertise ra các node khác
docker swarm init --advertise-addr 192.168.1.10

# Output:
# Swarm initialized: current node (xxx) is now a manager.
# To add a worker to this swarm, run the following command:
#   docker swarm join --token SWMTKN-1-xxx... 192.168.1.10:2377

# Lấy token để add thêm worker
docker swarm join-token worker

# Lấy token để add thêm manager (cho HA setup)
docker swarm join-token manager

# ── Trên máy Worker (IP: 192.168.1.11, 192.168.1.12) ─────────

docker swarm join \
  --token SWMTKN-1-xxx... \
  192.168.1.10:2377

# ── Kiểm tra cluster ──────────────────────────────────────────

# Xem danh sách node (chỉ chạy trên manager)
docker node ls
# ID          HOSTNAME    STATUS  AVAILABILITY  MANAGER STATUS
# abc123 *    manager-1   Ready   Active        Leader
# def456      worker-1    Ready   Active
# ghi789      worker-2    Ready   Active

# Xem thông tin node cụ thể
docker node inspect manager-1 --pretty

# Promote worker lên manager
docker node promote worker-1

# Demote manager xuống worker
docker node demote worker-2

# Drain node (đưa container sang node khác, chuẩn bị bảo trì)
docker node update --availability drain worker-1

# Xóa node khỏi cluster (node phải leave trước)
# -- Trên node cần xóa:
docker swarm leave
# -- Trên manager:
docker node rm worker-1
```

#### Docker Service – đơn vị triển khai trong Swarm

**Service** là cách khai báo "tôi muốn chạy X replica của image Y với cấu hình Z". Swarm tự động đảm bảo số lượng replica luôn đúng (self-healing).

```bash
# Tạo service nginx với 3 replica
docker service create \
  --name web \
  --replicas 3 \
  --publish published=80,target=80 \
  nginx:alpine

# Xem danh sách service
docker service ls

# Xem các task (container) của service và node chúng đang chạy
docker service ps web

# Xem log của service
docker service logs -f web

# Scale service
docker service scale web=5

# Update image (rolling update)
docker service update \
  --image nginx:1.25-alpine \
  --update-parallelism 1 \    # cập nhật 1 replica mỗi lần
  --update-delay 10s \        # chờ 10s giữa các bước
  web

# Rollback về version trước
docker service rollback web

# Xóa service
docker service rm web
```

#### Overlay Network trong Swarm

```bash
# Tạo overlay network (span qua nhiều host)
docker network create \
  --driver overlay \
  --attachable \              # cho phép container standalone join
  --subnet 10.10.0.0/16 \
  my_overlay

# Service dùng overlay network
docker service create \
  --name api \
  --network my_overlay \
  --replicas 2 \
  my-api:latest

# Service tự động discover nhau qua tên service
# Container "web" có thể ping "api" qua overlay DNS
```

#### Swarm Routing Mesh

Docker Swarm có cơ chế **Routing Mesh** tích hợp: khi publish port của service, mọi node trong cluster đều lắng nghe port đó, và tự động forward request đến node đang chạy replica.

```
Client → port 80 của BẤT KỲ node nào trong cluster
           ↓
       Routing Mesh (IPVS / iptables)
           ↓
  Replica đang chạy trên node bất kỳ
```

```bash
# Service với routing mesh: port 80 trên tất cả node đều hoạt động
docker service create \
  --name web \
  --publish 80:80 \
  --replicas 3 \
  nginx:alpine

# Kiểm tra: curl bất kỳ node nào cũng được
curl http://192.168.1.10   # manager
curl http://192.168.1.11   # worker-1
curl http://192.168.1.12   # worker-2
# Tất cả đều trả về response từ một trong 3 replica
```

#### Secrets và Configs trong Swarm

```bash
# Tạo secret từ stdin
echo "super_secret_password" | docker secret create db_password -

# Tạo secret từ file
docker secret create ssl_cert ./certs/server.crt

# Liệt kê secret
docker secret ls

# Service dùng secret (mount tại /run/secrets/<name>)
docker service create \
  --name api \
  --secret db_password \
  --secret ssl_cert \
  my-api:latest

# Trong container, đọc secret:
# cat /run/secrets/db_password

# Tạo config (cho file cấu hình không nhạy cảm)
docker config create nginx_conf ./nginx/nginx.conf

# Service dùng config
docker service create \
  --name web \
  --config source=nginx_conf,target=/etc/nginx/nginx.conf \
  nginx:alpine

# Xóa secret / config (phải remove khỏi service trước)
docker secret rm db_password
docker config rm nginx_conf
```

---

### 3.4 Docker Stack

**Docker Stack** là cách triển khai multi-service application lên Docker Swarm bằng file `docker-compose.yml` (với section `deploy` mở rộng). Stack = Docker Compose dành cho môi trường production cluster.

```
Docker Compose  ──→  1 host, development, docker compose up
Docker Stack    ──→  Swarm cluster, production, docker stack deploy
```

#### Cấu trúc file Stack (Compose với deploy)

```yaml
# stack.yml
services:

  # ── Database ──────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
      POSTGRES_DB: appdb
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks:
      - backend
    secrets:
      - db_password
    deploy:
      replicas: 1                       # DB thường chỉ 1 replica
      placement:
        constraints:
          - node.role == worker
          - node.labels.db == "true"    # chỉ chạy trên node có label này
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M

  # ── Redis ─────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    networks:
      - backend
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker

  # ── API Backend ───────────────────────────────────────────
  api:
    image: registry.example.com/team/api:${API_VERSION:-latest}
    networks:
      - backend
      - frontend
    secrets:
      - db_password
    environment:
      DATABASE_URL: postgresql://appuser@postgres:5432/appdb
    deploy:
      replicas: 3
      update_config:
        parallelism: 1                  # update từng replica một
        delay: 15s                      # chờ 15s sau mỗi bước
        failure_action: rollback        # tự rollback nếu update fail
        monitor: 30s                    # monitor 30s sau khi update
        order: start-first              # start mới trước, stop cũ sau
      rollback_config:
        parallelism: 2
        delay: 5s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s
      resources:
        limits:
          cpus: '0.5'
          memory: 256M

  # ── Frontend (Nginx) ──────────────────────────────────────
  web:
    image: registry.example.com/team/web:${WEB_VERSION:-latest}
    ports:
      - "80:80"
      - "443:443"
    networks:
      - frontend
    configs:
      - source: nginx_conf
        target: /etc/nginx/nginx.conf
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.role == worker
      update_config:
        parallelism: 1
        delay: 10s
        failure_action: rollback
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.web.rule=Host(`example.com`)"

networks:
  backend:
    driver: overlay
    internal: true
  frontend:
    driver: overlay

volumes:
  pg_data:
    driver: local

secrets:
  db_password:
    external: true              # đã tạo trước bằng docker secret create

configs:
  nginx_conf:
    external: true              # đã tạo trước bằng docker config create
```

#### Triển khai Docker Stack

```bash
# ─── Chuẩn bị ────────────────────────────────────────────────

# Bước 1: Đảm bảo đang trên manager node
docker node ls

# Bước 2: Tạo secret trước khi deploy
echo "my_db_password" | docker secret create db_password -

# Bước 3: Tạo config
docker config create nginx_conf ./nginx/nginx.conf

# Bước 4: Thêm label cho node DB (nếu dùng placement constraint)
docker node update --label-add db=true worker-1

# ─── Deploy ──────────────────────────────────────────────────

# Deploy stack lần đầu (hoặc update)
docker stack deploy \
  -c stack.yml \
  --with-registry-auth \        # gửi registry credentials đến worker
  myapp

# ─── Theo dõi ─────────────────────────────────────────────────

# Xem tất cả stack đang chạy
docker stack ls

# Xem các service trong stack
docker stack services myapp

# Xem tasks (container) của stack
docker stack ps myapp

# Xem tasks đang running (bỏ qua shutdown)
docker stack ps myapp --filter "desired-state=running"

# Xem log của service trong stack
docker service logs -f myapp_api

# ─── Update ──────────────────────────────────────────────────

# Update image (sửa API_VERSION trong .env rồi deploy lại)
export API_VERSION=v2.1.0
docker stack deploy -c stack.yml --with-registry-auth myapp
# Swarm tự thực hiện rolling update theo update_config

# Rollback service về version trước
docker service rollback myapp_api

# Scale service thủ công
docker service scale myapp_api=5

# ─── Cleanup ─────────────────────────────────────────────────

# Xóa toàn bộ stack (giữ volume và secret)
docker stack rm myapp

# Xóa secret và config sau khi stack đã down
docker secret rm db_password
docker config rm nginx_conf
```

#### Visualizer – theo dõi Swarm cluster

```bash
# Chạy Swarm Visualizer (công cụ debug trực quan)
docker service create \
  --name visualizer \
  --publish 8080:8080 \
  --constraint node.role==manager \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  dockersamples/visualizer:stable

# Mở browser: http://<manager-ip>:8080
# Hiển thị map các container đang chạy trên từng node
```

#### Ví dụ thực tế: Migrate từ Compose lên Stack

```bash
# Bước 1: Bắt đầu với compose.yml (môi trường dev đã có)
# Bước 2: Init Swarm
docker swarm init --advertise-addr $(hostname -I | awk '{print $1}')

# Bước 3: Thêm section "deploy" vào từng service trong compose.yml
# (giữ nguyên phần còn lại, Compose bỏ qua "deploy" khi dùng compose up)

# Bước 4: Deploy lên Swarm
docker stack deploy -c compose.yml myapp

# Kết quả: cùng 1 file, dùng được cho cả dev (compose up) và prod (stack deploy)
```

---

### 3.5 So sánh các phương thức triển khai

| Tiêu chí | `docker run` | `docker compose` | `docker stack` (Swarm) |
|---|---|---|---|
| **Phạm vi** | 1 container | Multi-container, 1 host | Multi-container, multi-host |
| **File config** | CLI flags | `compose.yml` | `compose.yml` + `deploy` section |
| **Scaling** | Thủ công (nhiều lệnh) | `--scale` (cùng host) | Tự động, across nodes |
| **Rolling update** | Không hỗ trợ | Không hỗ trợ | Có (update_config) |
| **Self-healing** | Chỉ restart policy | Chỉ restart policy | Có (reschedule container trên node khác) |
| **Load balancing** | Không | Không | Có (Routing Mesh + VIP) |
| **Secret management** | `-e` env var | `.env` file | `docker secret` (mã hóa Raft) |
| **Service discovery** | Thủ công | DNS trong network | DNS overlay tự động |
| **Use case** | Test, debug | Dev, CI/CD, nhỏ | Production, HA |
| **Độ phức tạp** | Thấp | Trung bình | Cao |

#### Khi nào dùng gì

```
Môi trường dev / local testing
        → docker compose up

CI/CD pipeline (build, test, integration)
        → docker compose (ephemeral, dễ cleanup)

Production – 1 server, ứng dụng nhỏ
        → docker compose up -d (với restart policy)

Production – nhiều server, cần HA / scaling
        → Docker Stack trên Swarm

Production – lớn, phức tạp, cần nhiều tính năng
        → Kubernetes (bước tiếp theo sau Swarm)
```

---

*Tài liệu được tạo bởi SRE Intern – Docker Infrastructure Documentation v1.0*
