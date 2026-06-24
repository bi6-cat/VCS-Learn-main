# Docker Orchestration – Lý thuyết & Thực hành

> **Nội dung:** Docker Compose · Docker Swarm · Docker Stack  
> **Hệ điều hành:** Ubuntu 22.04 LTS  
> **Docker Engine:** ≥ 24.x | **Docker Compose:** v2.x

---

## Mục lục

- [Phần 1 – Docker Compose](#phần-1--docker-compose)
  - [1.1 Tổng quan](#11-tổng-quan)
  - [1.2 Cấu trúc file Compose](#12-cấu-trúc-file-compose)
  - [1.3 Các directive quan trọng](#13-các-directive-quan-trọng)
  - [1.4 Ví dụ thực tế – Stack Web Application](#14-ví-dụ-thực-tế--stack-web-application)
  - [1.5 Các lệnh thường dùng](#15-các-lệnh-thường-dùng)
  - [1.6 Compose Override – Tách cấu hình Dev / Production](#16-compose-override--tách-cấu-hình-dev--production)
- [Phần 2 – Docker Swarm](#phần-2--docker-swarm)
  - [2.1 Tổng quan](#21-tổng-quan)
  - [2.2 Kiến trúc Swarm](#22-kiến-trúc-swarm)
  - [2.3 Khởi tạo Swarm Cluster](#23-khởi-tạo-swarm-cluster)
  - [2.4 Quản lý Node](#24-quản-lý-node)
  - [2.5 Docker Service](#25-docker-service)
  - [2.6 Routing Mesh](#26-routing-mesh)
  - [2.7 Overlay Network](#27-overlay-network)
  - [2.8 Secrets và Configs](#28-secrets-và-configs)
- [Phần 3 – Docker Stack](#phần-3--docker-stack)
  - [3.1 Tổng quan](#31-tổng-quan)
  - [3.2 File Stack (compose.yml với section deploy)](#32-file-stack-composeyml-với-section-deploy)
  - [3.3 Hướng dẫn triển khai từ A-Z](#33-hướng-dẫn-triển-khai-từ-a-z)
  - [3.4 Migrate từ Compose lên Stack](#34-migrate-từ-compose-lên-stack)
- [Phần 4 – So sánh tổng hợp & Quyết định](#phần-4--so-sánh-tổng-hợp--quyết-định)
  - [4.1 So sánh toàn diện](#41-so-sánh-toàn-diện)
  - [4.2 Khi nào dùng công cụ nào?](#42-khi-nào-dùng-công-cụ-nào)
  - [4.3 Checklist production](#43-checklist-production)
  - [4.4 Troubleshooting thường gặp](#44-troubleshooting-thường-gặp)

---

## Phần 1 – Docker Compose

### 1.1 Tổng quan

**Docker Compose** là công cụ định nghĩa và chạy multi-container application bằng một file YAML duy nhất (`compose.yml`). Thay vì gõ nhiều lệnh `docker run` riêng lẻ, toàn bộ stack được khai báo **declarative** và khởi động chỉ với một lệnh.

| Tiêu chí | `docker run` | `docker compose` |
|---|---|---|
| Số container | 1 container mỗi lệnh | Nhiều container cùng lúc |
| Cấu hình | CLI flags dài dòng | File YAML dễ đọc, lưu vết |
| Lặp lại | Phải gõ lại toàn bộ | `docker compose up` |
| Network tự động | Không | Có (tạo network riêng cho stack) |
| Phù hợp cho | Test, debug nhanh | Dev, CI/CD, staging |

---

### 1.2 Cấu trúc file Compose

```
compose.yml
├── services         ← định nghĩa các container (bắt buộc)
│   └── <tên-service>
│       ├── image / build
│       ├── ports, environment, volumes
│       ├── networks, depends_on
│       └── healthcheck, restart, deploy
├── networks         ← khai báo custom network
├── volumes          ← khai báo named volume
└── configs/secrets  ← chỉ dùng với Swarm
```

---

### 1.3 Các directive quan trọng

#### image vs build

```yaml
services:
  # Dùng image có sẵn từ registry
  db:
    image: postgres:16-alpine

  # Build từ Dockerfile
  api:
    build:
      context: ./backend        # thư mục chứa Dockerfile
      dockerfile: Dockerfile
      target: runtime           # chỉ dùng stage này (multi-stage build)
```

#### ports

```yaml
ports:
  - "8080:80"            # host:container
  - "127.0.0.1:5432:5432"  # chỉ bind trên localhost
  - "3000"               # container port, host port ngẫu nhiên
```

#### volumes

```yaml
volumes:
  - pg_data:/var/lib/postgresql/data    # named volume
  - ./nginx.conf:/etc/nginx/nginx.conf:ro  # bind mount, read-only
  - /var/log/app:/app/logs              # absolute path bind mount
```

#### environment

```yaml
environment:
  NODE_ENV: production
  DATABASE_URL: ${DB_URL}          # lấy từ .env
  DB_PASSWORD: ${DB_PASSWORD:-secret}  # fallback nếu không có
```

#### depends_on

```yaml
depends_on:
  # Chờ service khởi động (không đảm bảo sẵn sàng)
  - redis

  # Chờ healthcheck pass (khuyến nghị)
  postgres:
    condition: service_healthy
  redis:
    condition: service_healthy
```

#### restart policy

| Policy | Hành vi |
|---|---|
| `no` (mặc định) | Không tự khởi động lại |
| `on-failure[:max]` | Restart khi exit code ≠ 0 |
| `always` | Luôn restart, kể cả sau `docker stop` rồi reboot |
| `unless-stopped` | Như `always` nhưng không restart nếu user chủ động stop |

```yaml
restart: unless-stopped   # khuyến nghị cho production
```

#### healthcheck

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost/health"]
  interval: 30s      # kiểm tra mỗi 30s
  timeout: 5s        # timeout mỗi lần kiểm tra
  retries: 3         # 3 lần fail → trạng thái unhealthy
  start_period: 10s  # bỏ qua kết quả unhealthy trong 10s đầu
```

#### logging

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"   # rotate khi file đạt 10MB
    max-file: "3"     # giữ tối đa 3 file log
```

---

### 1.4 Ví dụ thực tế – Stack Web Application

Stack gồm 4 service: PostgreSQL + Redis + API Backend + Nginx Frontend.

#### compose.yml

```yaml
# compose.yml
services:

  # ── PostgreSQL Database ──────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-appdb}
      POSTGRES_USER: ${DB_USER:-appuser}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - backend
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-appuser}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Redis Cache ───────────────────────────────────────────────
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

  # ── Backend API ───────────────────────────────────────────────
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
      target: runtime
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
      - ./backend/uploads:/app/uploads
    networks:
      - backend
      - frontend
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ── Frontend Nginx ────────────────────────────────────────────
  web:
    image: nginx:1.25-alpine
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
    internal: true    # không ra internet trực tiếp
  frontend:
    driver: bridge

volumes:
  pg_data:
    driver: local
```

#### .env

```bash
# .env  — KHÔNG commit lên Git, thêm vào .gitignore
DB_NAME=appdb
DB_USER=appuser
DB_PASSWORD=super_secret_pass
REDIS_PASSWORD=redis_secret
```

---

### 1.5 Các lệnh thường dùng

```bash
# ─── Khởi động / Dừng ─────────────────────────────────────────
docker compose up -d                  # khởi động toàn bộ stack (background)
docker compose up -d --build api      # build lại image và restart service "api"
docker compose up -d --scale api=3   # scale service api lên 3 instance
docker compose stop                   # dừng container (giữ nguyên state)
docker compose down                   # dừng + xóa container, network (giữ volume)
docker compose down -v                # dừng + xóa cả volume (CẢNH BÁO: mất data)

# ─── Quan sát ─────────────────────────────────────────────────
docker compose ps                     # trạng thái các service
docker compose logs -f                # log toàn stack (follow)
docker compose logs -f api            # log của service "api"
docker compose top                    # process đang chạy trong các container

# ─── Thao tác với service ─────────────────────────────────────
docker compose exec api sh            # shell vào container đang chạy
docker compose run --rm api migrate   # chạy lệnh one-off (tạo container mới, xong xóa)
docker compose restart api            # restart service "api"
docker compose pull                   # kéo image mới nhất cho tất cả service
docker compose build                  # build lại tất cả image

# ─── Debug ────────────────────────────────────────────────────
docker compose config                 # xem config đã merge (bao gồm .env)
docker compose events                 # stream sự kiện real-time
```

---

### 1.6 Compose Override – Tách cấu hình Dev / Production

Docker Compose hỗ trợ merge nhiều file, cho phép tách biệt cấu hình theo môi trường:

```
compose.yml            ← config chung (base)
compose.override.yml   ← tự động load khi chạy (dành cho dev)
compose.prod.yml       ← production overrides (load thủ công)
```

#### compose.override.yml (Development)

```yaml
services:
  api:
    volumes:
      - ./backend:/app       # mount source code để hot-reload
    environment:
      NODE_ENV: development
    ports:
      - "9229:9229"          # Node.js debug port
  postgres:
    ports:
      - "5432:5432"          # expose DB ra host để dùng GUI tool
```

#### compose.prod.yml (Production)

```yaml
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
  web:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 128M
```

```bash
# Development – tự động load compose.override.yml
docker compose up -d

# Production – chỉ định file rõ ràng
docker compose -f compose.yml -f compose.prod.yml up -d
```

---

## Phần 2 – Docker Swarm

### 2.1 Tổng quan

**Docker Swarm** là công cụ container orchestration tích hợp sẵn trong Docker Engine, cho phép quản lý một **cluster** nhiều máy chủ Docker như một đơn vị duy nhất. Swarm cung cấp:

- **Scheduling** – tự động phân phối container đến node phù hợp
- **Load balancing** – Routing Mesh tích hợp sẵn
- **Service discovery** – DNS overlay tự động
- **Rolling update** – cập nhật không downtime
- **Self-healing** – tự tạo lại container khi node fail

---

### 2.2 Kiến trúc Swarm

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
│  Overlay Network (mã hóa TLS giữa các node)                     │
└──────────────────────────────────────────────────────────────────┘
```

#### Manager vs Worker

| | Manager Node | Worker Node |
|---|---|---|
| Vai trò | Quản lý cluster, lên lịch task | Thực thi container |
| Raft log | Có (lưu trạng thái cluster) | Không |
| Chạy container? | Có (mặc định) | Có (luôn luôn) |
| Số lượng nên có | Số lẻ: 1, 3, 5 | Không giới hạn |

#### Quorum – Fault Tolerance

| Số Manager | Quorum tối thiểu | Chịu mất tối đa |
|---|---|---|
| 1 | 1 | 0 (không HA) |
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

> **Quy tắc:** Với N manager, quorum = `⌊N/2⌋ + 1`. Mất quorum → cluster ngừng nhận lệnh mới nhưng container đang chạy vẫn tiếp tục hoạt động.

---

### 2.3 Khởi tạo Swarm Cluster

```bash
# ── Trên Manager Node (IP: 192.168.1.10) ──────────────────────

# Khởi tạo Swarm
docker swarm init --advertise-addr 192.168.1.10

# Output sẽ hiển thị lệnh để add worker:
# docker swarm join --token SWMTKN-1-xxx... 192.168.1.10:2377

# Lấy token để add worker
docker swarm join-token worker

# Lấy token để add thêm manager (HA setup)
docker swarm join-token manager

# ── Trên Worker Node ──────────────────────────────────────────

docker swarm join \
  --token SWMTKN-1-xxx... \
  192.168.1.10:2377

# ── Kiểm tra cluster (chạy trên manager) ─────────────────────

docker node ls
# ID        HOSTNAME    STATUS  AVAILABILITY  MANAGER STATUS
# abc123 *  manager-1   Ready   Active        Leader
# def456    worker-1    Ready   Active
# ghi789    worker-2    Ready   Active
```

#### Các port cần mở trên firewall

| Port | Protocol | Mục đích |
|---|---|---|
| 2377 | TCP | Cluster management |
| 7946 | TCP/UDP | Node-to-node communication |
| 4789 | UDP | Overlay network (VXLAN) |

---

### 2.4 Quản lý Node

```bash
# Xem thông tin chi tiết node
docker node inspect manager-1 --pretty

# Promote worker lên manager
docker node promote worker-1

# Demote manager xuống worker
docker node demote worker-2

# Drain node (đưa container sang node khác, chuẩn bị bảo trì)
docker node update --availability drain worker-1

# Reactivate node sau bảo trì
docker node update --availability active worker-1

# Gán label cho node (dùng với placement constraints)
docker node update --label-add db=true worker-1
docker node update --label-add zone=us-east worker-2

# Xóa node khỏi cluster
docker swarm leave           # chạy trên node cần xóa
docker node rm worker-1      # chạy trên manager (sau khi node đã leave)
```

---

### 2.5 Docker Service

**Service** là cách khai báo *"tôi muốn chạy X replica của image Y với cấu hình Z"*. Swarm tự động đảm bảo số lượng replica luôn đúng: nếu container crash, Swarm tạo lại trên node khác.

```bash
# Tạo service với 3 replica
docker service create \
  --name web \
  --replicas 3 \
  --publish published=80,target=80 \
  --constraint "node.role == worker" \
  --limit-cpu 0.5 \
  --limit-memory 256M \
  nginx:alpine

# Xem danh sách service
docker service ls

# Xem các task (container) của service và node chúng đang chạy
docker service ps web

# Xem log của service
docker service logs -f web

# Scale service
docker service scale web=5

# Rolling update image
docker service update \
  --image nginx:1.25-alpine \
  --update-parallelism 1 \    # update 1 replica mỗi lần
  --update-delay 10s \        # chờ 10s giữa mỗi bước
  --update-failure-action rollback \
  web

# Rollback về version trước
docker service rollback web

# Update biến môi trường
docker service update \
  --env-add NODE_ENV=production \
  web

# Xóa service
docker service rm web
```

#### Placement Constraints

```bash
# Chỉ chạy trên worker node
--constraint "node.role == worker"

# Chỉ chạy trên node có label "db=true"
--constraint "node.labels.db == true"

# Chạy trên node có hostname cụ thể
--constraint "node.hostname == worker-1"

# Spread: mỗi node chỉ chạy 1 replica (tránh SPOF)
--placement-pref "spread=node.labels.zone"
```

---

### 2.6 Routing Mesh

Docker Swarm có cơ chế **Routing Mesh** tích hợp: khi publish port của service, **mọi node** trong cluster đều lắng nghe port đó và tự động forward request đến replica đang chạy.

```
Client → port 80 của BẤT KỲ node nào trong cluster
           ↓
       Routing Mesh (IPVS / iptables)
           ↓
  Replica đang chạy trên node bất kỳ
```

```bash
# Service với routing mesh
docker service create \
  --name web \
  --publish 80:80 \
  --replicas 3 \
  nginx:alpine

# Tất cả node đều nhận request dù replica chỉ chạy trên 1 số node
curl http://192.168.1.10   # manager  → OK
curl http://192.168.1.11   # worker-1 → OK
curl http://192.168.1.12   # worker-2 → OK
```

---

### 2.7 Overlay Network

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

# Service tự discover nhau qua tên service (DNS overlay)
# Container trong service "web" có thể ping "api" bằng hostname
docker exec <container_id> ping api
```

---

### 2.8 Secrets và Configs

**Secret** được mã hóa trong Raft log, chỉ giải mã khi container cần dùng. An toàn hơn nhiều so với biến môi trường hoặc file `.env`.

```bash
# ── Secrets ────────────────────────────────────────────────────

# Tạo secret từ stdin
echo "super_secret_password" | docker secret create db_password -

# Tạo secret từ file
docker secret create ssl_cert ./certs/server.crt

# Liệt kê secret
docker secret ls

# Service dùng secret → mount tại /run/secrets/<name>
docker service create \
  --name api \
  --secret db_password \
  --secret ssl_cert \
  my-api:latest

# Trong container đọc secret:
# cat /run/secrets/db_password

# Xóa secret (phải remove khỏi service trước)
docker secret rm db_password

# ── Configs ────────────────────────────────────────────────────

# Tạo config (cho file cấu hình không nhạy cảm)
docker config create nginx_conf ./nginx/nginx.conf

# Service dùng config
docker service create \
  --name web \
  --config source=nginx_conf,target=/etc/nginx/nginx.conf \
  nginx:alpine

# Xóa config
docker config rm nginx_conf
```

---

## Phần 3 – Docker Stack

### 3.1 Tổng quan

**Docker Stack** là cách triển khai multi-service application lên Docker Swarm bằng file `compose.yml` (bổ sung section `deploy`). Ưu điểm lớn nhất: **dùng cùng một file** cho cả development và production.

```
Docker Compose  →  docker compose up -d     →  1 host, development
Docker Stack    →  docker stack deploy ...  →  Swarm cluster, production
```

| Tiêu chí | Docker Compose | Docker Stack |
|---|---|---|
| Phạm vi | Multi-container, 1 host | Multi-container, multi-host |
| Rolling update | Không | Có (`update_config`) |
| Self-healing | Chỉ restart policy | Reschedule trên node khác |
| Load balancing | Không | Routing Mesh tích hợp |
| Secret | `.env` file | `docker secret` (mã hóa Raft) |
| Lệnh | `docker compose up -d` | `docker stack deploy -c file.yml <name>` |

---

### 3.2 File Stack (compose.yml với section deploy)

```yaml
# stack.yml
services:

  # ── PostgreSQL ────────────────────────────────────────────────
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
      replicas: 1
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

  # ── Redis ─────────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    networks:
      - backend
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == worker
      resources:
        limits:
          cpus: '0.25'
          memory: 128M

  # ── API Backend ───────────────────────────────────────────────
  api:
    image: registry.example.com/team/api:${API_VERSION:-latest}
    networks:
      - backend
      - frontend
    secrets:
      - db_password
    environment:
      DATABASE_URL: postgresql://appuser@postgres:5432/appdb
      NODE_ENV: production
    deploy:
      replicas: 3
      update_config:
        parallelism: 1            # update từng replica một
        delay: 15s                # chờ 15s sau mỗi bước
        failure_action: rollback  # tự rollback nếu update fail
        monitor: 30s              # monitor 30s sau khi update xong
        order: start-first        # start replica mới trước, stop cũ sau
      rollback_config:
        parallelism: 2
        delay: 5s
        failure_action: pause
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
        window: 120s
      resources:
        limits:
          cpus: '0.5'
          memory: 256M

  # ── Frontend Nginx ────────────────────────────────────────────
  web:
    image: registry.example.com/team/web:latest
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

networks:
  backend:
    driver: overlay
    internal: true        # không ra internet trực tiếp
  frontend:
    driver: overlay

volumes:
  pg_data:
    driver: local

secrets:
  db_password:
    external: true        # đã tạo trước bằng docker secret create

configs:
  nginx_conf:
    external: true        # đã tạo trước bằng docker config create
```

#### Các tham số update_config

| Tham số | Ý nghĩa |
|---|---|
| `parallelism` | Số replica update song song mỗi lần |
| `delay` | Thời gian chờ giữa các batch |
| `failure_action` | `pause` (dừng lại) hoặc `rollback` (tự hoàn tác) |
| `monitor` | Thời gian theo dõi sau khi update mỗi batch |
| `order` | `start-first` (zero-downtime) hoặc `stop-first` |

---

### 3.3 Hướng dẫn triển khai từ A-Z

#### Bước 1 – Chuẩn bị Swarm

```bash
# Khởi tạo Swarm (nếu chưa có)
docker swarm init --advertise-addr 192.168.1.10

# Thêm worker node (chạy lệnh này trên worker)
docker swarm join --token SWMTKN-1-xxx... 192.168.1.10:2377

# Kiểm tra
docker node ls
```

#### Bước 2 – Tạo Secret và Config

```bash
# Secret database password
echo "my_db_password" | docker secret create db_password -

# Config nginx
docker config create nginx_conf ./nginx/nginx.conf

# Gán label cho node DB
docker node update --label-add db=true worker-1

# Kiểm tra
docker secret ls
docker config ls
```

#### Bước 3 – Deploy Stack

```bash
# Deploy lần đầu
docker stack deploy \
  -c stack.yml \
  --with-registry-auth \    # gửi registry credentials đến worker node
  myapp
```

#### Bước 4 – Theo dõi

```bash
# Xem tất cả stack đang chạy
docker stack ls

# Xem các service trong stack
docker stack services myapp

# Xem tasks (container) của stack
docker stack ps myapp

# Xem tasks đang running (bỏ qua shutdown)
docker stack ps myapp --filter "desired-state=running"

# Xem log của service
docker service logs -f myapp_api
```

#### Bước 5 – Update

```bash
# Cập nhật version image
export API_VERSION=v2.1.0
docker stack deploy -c stack.yml --with-registry-auth myapp
# Swarm tự thực hiện rolling update theo update_config

# Theo dõi quá trình update
watch docker stack ps myapp

# Rollback nếu có vấn đề
docker service rollback myapp_api

# Scale thủ công
docker service scale myapp_api=5
```

#### Bước 6 – Xóa Stack

```bash
# Xóa toàn bộ stack (giữ volume và secret)
docker stack rm myapp

# Xóa secret và config sau khi stack đã down
docker secret rm db_password
docker config rm nginx_conf
```

---

### 3.4 Migrate từ Compose lên Stack

Compose bỏ qua section `deploy` khi chạy `docker compose up`. Stack dùng section `deploy` khi deploy. Đây là lý do cùng một file hoạt động cho cả hai.

```bash
# Bước 1: Đã có compose.yml đang dùng cho dev

# Bước 2: Thêm section "deploy" vào từng service
#          (compose up vẫn hoạt động bình thường, bỏ qua deploy)

# Bước 3: Init Swarm
docker swarm init --advertise-addr $(hostname -I | awk '{print $1}')

# Bước 4: Deploy lên Swarm
docker stack deploy -c compose.yml myapp

# Kết quả: 1 file dùng được cho cả 2 môi trường
# Dev:  docker compose up -d
# Prod: docker stack deploy -c compose.yml myapp
```

#### Swarm Visualizer – debug cluster trực quan

```bash
docker service create \
  --name visualizer \
  --publish 8080:8080 \
  --constraint node.role==manager \
  --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  dockersamples/visualizer:stable

# Mở browser: http://<manager-ip>:8080
# Hiển thị map container đang chạy trên từng node
```

---

## Phần 4 – So sánh tổng hợp & Quyết định

### 4.1 So sánh toàn diện

| Tiêu chí | `docker run` | `docker compose` | `docker stack` (Swarm) |
|---|---|---|---|
| Phạm vi | 1 container | Multi-container, 1 host | Multi-container, multi-host |
| File config | CLI flags | `compose.yml` | `compose.yml` + `deploy` section |
| Scaling | Thủ công | `--scale` (cùng host) | Tự động, across nodes |
| Rolling update | Không | Không | Có (`update_config`) |
| Self-healing | Restart policy | Restart policy | Reschedule trên node khác |
| Load balancing | Không | Không | Routing Mesh tích hợp |
| Secret management | `-e` env var | `.env` file | `docker secret` (mã hóa Raft) |
| Service discovery | Thủ công | DNS trong network | DNS overlay tự động |
| Health-aware scheduling | Không | Không | Có |
| Use case | Test, debug | Dev, CI/CD | Production, HA |
| Độ phức tạp | Thấp | Trung bình | Cao |

---

### 4.2 Khi nào dùng công cụ nào?

```
Môi trường dev / local testing
        → docker compose up

CI/CD pipeline (build, test, integration test)
        → docker compose (ephemeral, dễ cleanup với compose down -v)

Production – 1 server, ứng dụng nhỏ / trung bình
        → docker compose up -d (với restart: unless-stopped)

Production – nhiều server, cần HA / auto-scaling
        → Docker Stack trên Swarm (3+ nodes)

Production – lớn, nhiều team, CI/CD phức tạp, hàng trăm service
        → Kubernetes (bước tiếp theo sau Swarm)
```

---

### 4.3 Checklist production

#### Docker Compose (1 server)

- [ ] Dùng `restart: unless-stopped` cho tất cả service
- [ ] Lưu credentials trong `.env`, thêm vào `.gitignore`
- [ ] Cấu hình `healthcheck` cho service quan trọng (DB, API)
- [ ] Dùng `depends_on` với `condition: service_healthy`
- [ ] Cấu hình `logging` với `max-size` và `max-file`
- [ ] Dùng **named volume** cho database (không bind mount)
- [ ] Giới hạn `resources` (CPU/RAM) để tránh container hog tài nguyên
- [ ] Dùng `network internal: true` cho backend network

#### Docker Stack / Swarm

- [ ] Số manager phải là số lẻ (1, 3, 5)
- [ ] Mở port 2377/TCP, 7946/TCP+UDP, 4789/UDP trên firewall
- [ ] Tạo `docker secret` trước khi deploy stack
- [ ] Cấu hình `update_config` với `failure_action: rollback`
- [ ] Dùng `placement constraints` để kiểm soát node cho DB
- [ ] Cấu hình `resources.limits` để tránh OOM
- [ ] Dùng `--with-registry-auth` khi pull từ private registry
- [ ] Test rollback procedure trước khi đưa vào production
- [ ] Monitor với `docker stack ps`, `docker service logs`

---

### 4.4 Troubleshooting thường gặp

| Triệu chứng | Kiểm tra | Giải pháp |
|---|---|---|
| Service không start | `docker service logs myapp_api` | Xem lý do container fail |
| Container liên tục restart | `docker inspect --format='{{json .State.Health}}' <id>` | Sửa healthcheck hoặc entrypoint |
| Swarm task không được schedule | `docker service ps myapp_api --no-trunc` | Xem lý do "Rejected" |
| Placement constraint không khớp | `docker node ls`, `docker node inspect <node>` | Kiểm tra label node |
| Secret không mount được | `docker secret ls` | Tạo secret trước khi deploy |
| Overlay network không thông | `docker network inspect <net>` | Mở port UDP 4789, TCP/UDP 7946 |
| Image không pull được trên worker | `docker stack deploy --with-registry-auth` | Thêm flag khi deploy |
| Rolling update bị stuck | `docker service rollback myapp_api` | Rollback về version trước |

```bash
# Debug service không schedule được
docker service ps myapp_api --no-trunc
# Cột "ERROR" sẽ giải thích lý do

# Kiểm tra log container bị crash
docker service logs myapp_api --tail 50

# Kiểm tra overlay network connectivity
docker exec $(docker ps -q -f name=myapp_api) ping postgres

# Xem toàn bộ sự kiện Swarm
docker events --filter scope=swarm
```

---

*Tài liệu SRE Intern – Docker Orchestration v1.0*  
*Docker Compose · Docker Swarm · Docker Stack*
