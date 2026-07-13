# Docker Compose — Lý Thuyết & Lab Thực Tế Chi Tiết

> Tài liệu tổng hợp từ lý thuyết nền tảng đến các bài lab kịch bản thực tế (multi-service, networking, volume, scaling, production-ready) sử dụng Docker Compose.

---

## Mục Lục

1. [Tổng Quan Về Docker Compose](#1-tổng-quan-về-docker-compose)
2. [Cấu Trúc File `compose.yaml`](#2-cấu-trúc-file-composeyaml)
3. [Services — Trái Tim Của Compose](#3-services--trái-tim-của-compose)
4. [Networking Trong Compose](#4-networking-trong-compose)
5. [Volumes & Persistent Data](#5-volumes--persistent-data)
6. [Environment Variables & Secrets](#6-environment-variables--secrets)
7. [Dependency & Healthcheck](#7-dependency--healthcheck)
8. [Build vs Image](#8-build-vs-image)
9. [Scaling & Resource Limits](#9-scaling--resource-limits)
10. [Compose CLI — Các Lệnh Quan Trọng](#10-compose-cli--các-lệnh-quan-trọng)
11. [Override Files & Multi-Environment](#11-override-files--multi-environment)
12. [Best Practices Production](#12-best-practices-production)
13. [LAB 1 — Web App + Database (LAMP-like)](#lab-1--web-app--database-lamp-like)
14. [LAB 2 — Reverse Proxy + Multi-Service (Nginx + 2 API)](#lab-2--reverse-proxy--multi-service-nginx--2-api)
15. [LAB 3 — Full Stack: Frontend + Backend + DB + Cache + Queue](#lab-3--full-stack-frontend--backend--db--cache--queue)
16. [LAB 4 — Microservices với Message Broker (Kafka/RabbitMQ)](#lab-4--microservices-với-message-broker-kafkarabbitmq)
17. [LAB 5 — Monitoring Stack (Prometheus + Grafana)](#lab-5--monitoring-stack-prometheus--grafana)
18. [LAB 6 — CI/CD Local: Multi-Stage Build + Healthcheck + Scale](#lab-6--cicd-local-multi-stage-build--healthcheck--scale)
19. [Troubleshooting Thường Gặp](#19-troubleshooting-thường-gặp)
20. [Cheat Sheet Tổng Hợp](#20-cheat-sheet-tổng-hợp)

---

## 1. Tổng Quan Về Docker Compose

### 1.1. Compose là gì?

Docker Compose là công cụ để **định nghĩa và chạy nhiều container Docker cùng lúc** thông qua một file YAML duy nhất (`compose.yaml` hoặc `docker-compose.yml`). Thay vì phải gõ hàng chục lệnh `docker run` với hàng loạt flag (`-p`, `-v`, `-e`, `--network`...), bạn khai báo toàn bộ "kiến trúc" hệ thống trong 1 file, rồi chỉ cần:

```bash
docker compose up
```

### 1.2. Tại sao cần Compose?

| Vấn đề khi dùng `docker run` thủ công | Compose giải quyết thế nào |
|---|---|
| Phải nhớ và gõ lại nhiều lệnh dài | Khai báo 1 lần trong YAML |
| Khó quản lý network giữa nhiều container | Tự tạo network riêng, các service thấy nhau qua tên |
| Khó replay lại đúng môi trường cho người khác | Chỉ cần `git clone` + `docker compose up` |
| Không có thứ tự khởi động rõ ràng | `depends_on`, `healthcheck` |
| Khó scale nhiều instance | `docker compose up --scale` |

### 1.3. Compose V1 vs V2

- **Compose V1**: viết bằng Python, gọi là `docker-compose` (có dấu gạch ngang), cần cài riêng.
- **Compose V2**: viết bằng Go, tích hợp luôn vào Docker CLI dưới dạng plugin, gọi bằng `docker compose` (có khoảng trắng, không gạch ngang). Đây là chuẩn hiện tại — **nên dùng `docker compose`**.

> Từ Compose Specification (2020), từ khóa `version:` ở đầu file **không còn cần thiết** và đã bị deprecated. Docker tự nhận diện cấu trúc.

### 1.4. Compose dùng để làm gì trong thực tế?

- **Local development**: dựng môi trường dev giống production (DB, cache, queue...) chỉ với 1 lệnh.
- **Testing/CI**: spin up môi trường test tạm, chạy test, teardown.
- **Demo/POC**: triển khai nhanh stack nhiều service để demo.
- **Small-scale production**: với hệ thống nhỏ/vừa, không cần Kubernetes, Compose vẫn chạy production tốt (kết hợp Swarm mode nếu cần HA).

---

## 2. Cấu Trúc File `compose.yaml`

### 2.1. Khung tổng thể

```yaml
# compose.yaml
services:        # Bắt buộc — định nghĩa các container
  service_a:
    image: ...
  service_b:
    build: ...

networks:         # Tùy chọn — định nghĩa network tùy chỉnh
  my_network:
    driver: bridge

volumes:          # Tùy chọn — định nghĩa volume đặt tên
  my_data:

configs:          # Tùy chọn — config file chia sẻ (Swarm/Compose mới)
  my_config:
    file: ./config.txt

secrets:          # Tùy chọn — secret nhạy cảm (password, token)
  db_password:
    file: ./secrets/db_password.txt
```

### 2.2. Tên file & thứ tự ưu tiên

Docker Compose tự động tìm file theo thứ tự:
1. `compose.yaml`
2. `compose.yml`
3. `docker-compose.yaml`
4. `docker-compose.yml`

Có thể chỉ định file khác bằng `-f`:
```bash
docker compose -f my-custom-file.yml up
```

### 2.3. Validate cấu trúc

```bash
docker compose config        # In ra cấu hình đã merge & resolve biến môi trường
docker compose config --quiet  # Chỉ kiểm tra lỗi cú pháp, không in gì
```

---

## 3. Services — Trái Tim Của Compose

Mỗi `service` tương ứng với **một loại container** (có thể chạy nhiều replica).

### 3.1. Các thuộc tính quan trọng nhất

```yaml
services:
  web:
    image: nginx:1.27-alpine        # Image có sẵn
    build:                          # HOẶC build từ Dockerfile
      context: ./web
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
    container_name: my_web          # Tên cố định (cẩn thận khi scale)
    restart: unless-stopped         # Chính sách khởi động lại
    ports:
      - "8080:80"                   # host:container
    expose:
      - "3000"                      # chỉ expose nội bộ network, không bind host
    environment:                    # Biến môi trường
      - NODE_ENV=production
      - API_URL=http://api:4000
    env_file:
      - .env
    volumes:
      - ./src:/app/src               # bind mount
      - web_data:/app/data           # named volume
    depends_on:
      api:
        condition: service_healthy
    networks:
      - frontend
      - backend
    command: ["npm", "start"]        # override CMD
    entrypoint: ["/entrypoint.sh"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
        reservations:
          memory: 128M
      replicas: 2
    labels:
      - "com.example.description=Web frontend"
```

### 3.2. Giải thích các trường quan trọng

| Trường | Ý nghĩa |
|---|---|
| `image` | Image lấy từ registry (Docker Hub, GHCR...) |
| `build` | Build image từ Dockerfile cục bộ |
| `ports` | Map cổng **host:container**, container truy cập được từ bên ngoài |
| `expose` | Chỉ mở cổng trong nội bộ Docker network, không lộ ra host |
| `volumes` | Gắn dữ liệu — bind mount (đường dẫn host) hoặc named volume (Docker quản lý) |
| `environment` / `env_file` | Truyền biến môi trường vào container |
| `depends_on` | Thứ tự khởi động (không đảm bảo app đã "sẵn sàng", chỉ đảm bảo container đã start) |
| `networks` | Gắn service vào network nào |
| `restart` | `no` \| `always` \| `on-failure` \| `unless-stopped` |
| `healthcheck` | Định nghĩa cách kiểm tra container có "sống" và "khỏe" hay không |
| `deploy` | Giới hạn resource, số replicas (đầy đủ chức năng khi dùng Swarm; khi dùng `docker compose` thường, chỉ một phần được hỗ trợ — xem mục 9) |

---

## 4. Networking Trong Compose

### 4.1. Network ngầm định

Khi chạy `docker compose up`, Compose **tự tạo một bridge network riêng** cho project (tên dạng `<project>_default`). Mọi service trong file đều tự động nằm trong network này.

**Điểm quan trọng nhất:** các service có thể gọi nhau **bằng tên service** như một hostname (DNS nội bộ), không cần biết IP:

```yaml
services:
  api:
    build: ./api
  db:
    image: postgres:16
```

Trong code của `api`, connection string trỏ tới `db:5432` — Docker tự phân giải DNS sang IP nội bộ của container `db`.

### 4.2. Custom networks

```yaml
services:
  web:
    networks: [frontend]
  api:
    networks: [frontend, backend]
  db:
    networks: [backend]

networks:
  frontend:
  backend:
```

→ `web` không thể nói chuyện trực tiếp với `db` (cách ly tầng) — mô hình bảo mật 3 lớp kinh điển.

### 4.3. Network driver phổ biến

| Driver | Dùng khi |
|---|---|
| `bridge` (mặc định) | Single host, đa số trường hợp |
| `host` | Container dùng trực tiếp network của host (hiệu năng cao, ít cách ly) |
| `overlay` | Multi-host (Swarm mode) |
| `none` | Không cần network |

### 4.4. Alias & external network

```yaml
services:
  db:
    networks:
      backend:
        aliases:
          - database
          - sql-server

networks:
  backend:
    external: true       # Network đã tồn tại từ trước (tạo bằng `docker network create`)
    name: shared_net
```

---

## 5. Volumes & Persistent Data

### 5.1. Ba loại mount

| Loại | Cú pháp | Đặc điểm |
|---|---|---|
| **Named volume** | `db_data:/var/lib/mysql` | Docker quản lý, lưu ở `/var/lib/docker/volumes/...`, tồn tại độc lập với container |
| **Bind mount** | `./src:/app/src` | Map trực tiếp 1 thư mục/file trên host, dùng nhiều cho dev (hot reload code) |
| **tmpfs** | `tmpfs: /app/tmp` | Lưu trong RAM, mất khi container dừng, dùng cho dữ liệu nhạy cảm tạm thời |

### 5.2. Khai báo named volume

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - db_data:/var/lib/postgresql/data

volumes:
  db_data:
    driver: local
```

### 5.3. Volume read-only

```yaml
volumes:
  - ./config:/app/config:ro    # :ro = read-only, :rw = read-write (default)
```

### 5.4. External volume (đã tồn tại sẵn)

```yaml
volumes:
  db_data:
    external: true
    name: my_existing_volume
```

### 5.5. Lệnh quản lý volume

```bash
docker volume ls
docker volume inspect db_data
docker compose down -v        # Xóa cả volume khi down (cẩn thận — mất data!)
```

---

## 6. Environment Variables & Secrets

### 6.1. Thứ tự ưu tiên biến môi trường (cao → thấp)

1. `docker compose run -e VAR=value`
2. Shell environment (biến export trong terminal)
3. File `.env` ở cùng thư mục `compose.yaml` (biến hệ thống cho Compose, dùng để interpolate `${VAR}` trong YAML)
4. `environment:` trong service
5. `env_file:` trong service
6. Giá trị mặc định (`ENV` trong Dockerfile)

> **Lưu ý phân biệt:** file `.env` mặc định dùng để **thay thế biến trong cú pháp `${VAR}` của file compose.yaml**, KHÁC với `env_file:` (dùng để load biến **vào trong container**). Hai cái có thể trùng tên file nhưng mục đích khác nhau.

### 6.2. Interpolation trong file YAML

```yaml
services:
  db:
    image: postgres:${POSTGRES_VERSION:-16}
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
```

```bash
# .env
POSTGRES_VERSION=16
DB_PASSWORD=supersecret
```

### 6.3. Secrets (an toàn hơn environment cho dữ liệu nhạy cảm)

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

→ Secret được mount vào `/run/secrets/<name>` trong container, **không xuất hiện** trong `docker inspect` hay biến môi trường (an toàn hơn `environment:` vốn lộ trong process list / inspect).

---

## 7. Dependency & Healthcheck

### 7.1. Vấn đề kinh điển: "container chạy nhưng app chưa sẵn sàng"

`depends_on` mặc định chỉ đảm bảo **thứ tự start container**, KHÔNG đảm bảo service bên trong đã sẵn sàng nhận kết nối (ví dụ MySQL container start trong 1s nhưng MySQL daemon cần 10-15s mới nhận query).

### 7.2. Giải pháp: `depends_on` + `condition`

```yaml
services:
  api:
    build: ./api
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started

  db:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

  cache:
    image: redis:7-alpine
```

| Condition | Ý nghĩa |
|---|---|
| `service_started` | Container đã start (default, không chờ healthy) |
| `service_healthy` | Chờ tới khi healthcheck trả "healthy" |
| `service_completed_successfully` | Chờ container chạy xong và exit code = 0 (dùng cho init/migration container) |

### 7.3. Pattern container "init job" chạy 1 lần rồi exit

```yaml
services:
  migrate:
    build: ./api
    command: ["npm", "run", "migrate"]
    depends_on:
      db:
        condition: service_healthy

  api:
    build: ./api
    depends_on:
      migrate:
        condition: service_completed_successfully
```

---

## 8. Build vs Image

### 8.1. Khi nào dùng `image`, khi nào dùng `build`

- `image:` → khi bạn dùng image có sẵn (Postgres, Redis, Nginx chính chủ...) hoặc image đã build & push lên registry.
- `build:` → khi bạn có Dockerfile riêng cho code của mình.

### 8.2. Build context & nhiều Dockerfile

```yaml
services:
  api:
    build:
      context: .
      dockerfile: docker/Dockerfile.api
      target: production         # multi-stage build — chọn stage
      args:
        BUILD_ENV: production
      cache_from:
        - myapp:cache
```

### 8.3. Vừa build, vừa đặt tên & push

```yaml
services:
  api:
    build: ./api
    image: myregistry.com/myapp-api:1.0.0   # build xong gắn tag này, dùng `docker compose push` để đẩy lên
```

```bash
docker compose build
docker compose push
```

---

## 9. Scaling & Resource Limits

### 9.1. Scale nhiều instance của 1 service

```bash
docker compose up --scale api=3 -d
```

> Khi scale > 1, **không thể dùng `container_name`** cố định và **không thể map cổng host cố định** (`ports: "8080:80"` sẽ conflict) — nên dùng `expose` và đặt 1 load balancer (Nginx/Traefik) phía trước, hoặc để Docker tự chọn cổng ngẫu nhiên.

### 9.2. Resource limits (giới hạn CPU/RAM)

Với Compose chuẩn (không Swarm), dùng cú pháp ngắn hơn `deploy.resources` (vẫn hỗ trợ từ Compose v2 mới — nếu không hoạt động, cần chạy với Swarm hoặc dùng cú pháp cũ hơn):

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 128M
```

> Với `docker compose` (không Swarm) phiên bản mới đã hỗ trợ `deploy.resources.limits` áp dụng trực tiếp (tương đương `--cpus`, `--memory` của `docker run`). Một số field khác trong `deploy` (như `placement`, `update_config`) chỉ có ý nghĩa khi deploy lên **Swarm** (`docker stack deploy`).

---

## 10. Compose CLI — Các Lệnh Quan Trọng

```bash
# Khởi động toàn bộ stack (foreground)
docker compose up

# Khởi động ở background (detached)
docker compose up -d

# Build lại image trước khi up
docker compose up --build

# Xem log realtime của tất cả service
docker compose logs -f

# Xem log của 1 service
docker compose logs -f api

# Liệt kê container đang chạy trong project
docker compose ps

# Dừng (giữ container, không xóa)
docker compose stop

# Dừng & xóa container, network (giữ volume)
docker compose down

# Dừng & xóa luôn volume (MẤT DATA)
docker compose down -v

# Dừng & xóa luôn image đã build
docker compose down --rmi local

# Vào shell trong 1 container đang chạy
docker compose exec api sh

# Chạy lệnh 1 lần (tạo container mới, không liên quan container đang chạy)
docker compose run --rm api npm test

# Restart 1 service
docker compose restart api

# Xem cấu hình đã merge/resolve
docker compose config

# Pull image mới nhất cho các service dùng image:
docker compose pull

# Kiểm tra resource usage
docker compose top
docker stats
```

---

## 11. Override Files & Multi-Environment

### 11.1. Cơ chế override

Compose tự động merge `compose.yaml` + `compose.override.yaml` (nếu tồn tại) khi chạy `docker compose up` mà không cần `-f`.

```
compose.yaml              # base, dùng chung mọi môi trường
compose.override.yaml     # override mặc định (thường để cho dev)
compose.prod.yaml         # override riêng cho production
```

```bash
# Dev (tự động dùng override.yaml)
docker compose up

# Production (chỉ định rõ, KHÔNG dùng override.yaml mặc định)
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

### 11.2. Ví dụ override

`compose.yaml` (base):
```yaml
services:
  api:
    build: ./api
    environment:
      NODE_ENV: production
```

`compose.override.yaml` (dev — tự động áp dụng):
```yaml
services:
  api:
    volumes:
      - ./api/src:/app/src      # hot reload code
    environment:
      NODE_ENV: development
    ports:
      - "9229:9229"             # debug port
```

### 11.3. `extends` (tái sử dụng cấu hình — ít dùng hơn override files nhưng vẫn hợp lệ)

```yaml
services:
  api:
    extends:
      file: common-services.yaml
      service: base-api
```

---

## 12. Best Practices Production

1. **Không dùng `latest` tag** → luôn pin version cụ thể (`postgres:16.4-alpine`) để build reproducible.
2. **Luôn có `healthcheck`** cho mọi service quan trọng, kết hợp `depends_on.condition`.
3. **Không bao giờ commit secret thật vào `.env`** → dùng `.env.example`, thêm `.env` vào `.gitignore`, dùng Docker secrets hoặc vault cho production thật.
4. **Dùng multi-stage build** trong Dockerfile để image production nhỏ, không chứa dev dependencies.
5. **Giới hạn resource** (`deploy.resources.limits`) để 1 service lỗi không "ăn" hết RAM/CPU của host.
6. **Named volumes cho data, bind mount chỉ cho code/dev** — production không nên bind mount source code.
7. **Network segmentation**: tách `frontend`/`backend` network, database không nên expose port ra host.
8. **`restart: unless-stopped`** cho production thay vì `always` (để admin có thể chủ động `docker compose stop` mà không bị tự khởi động lại).
9. **Log rotation**: cấu hình `logging.driver` + `options` tránh log file phình to ổ cứng.
   ```yaml
   services:
     api:
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"
   ```
10. **Dùng `.dockerignore`** để build context nhỏ, build nhanh, không leak file nhạy cảm vào image.

---

## LAB 1 — Web App + Database (LAMP-like)

### Mục tiêu
Dựng 1 ứng dụng PHP/Node + MySQL + phpMyAdmin, hiểu cách: build image, networking ngầm định, named volume, environment, healthcheck.

### Kịch bản
Bạn là dev cần dựng nhanh môi trường blog đơn giản: **Node.js (Express) + MySQL + Adminer (quản lý DB qua web)**.

### Cấu trúc thư mục

```
lab1-webapp-db/
├── compose.yaml
├── .env
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── init-db/
    └── 01-schema.sql
```

### `api/package.json`

```json
{
  "name": "lab1-api",
  "version": "1.0.0",
  "main": "server.js",
  "dependencies": {
    "express": "^4.19.2",
    "mysql2": "^3.10.0"
  },
  "scripts": {
    "start": "node server.js"
  }
}
```

### `api/server.js`

```javascript
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

app.get('/', (req, res) => {
  res.send('Lab 1 API is running');
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/posts', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM posts');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
```

### `api/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### `init-db/01-schema.sql`

```sql
CREATE TABLE IF NOT EXISTS posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO posts (title, content) VALUES
  ('Bai viet dau tien', 'Noi dung demo cho lab Docker Compose'),
  ('Hoc Docker Compose', 'Compose giup quan ly multi-container de dang');
```

### `.env`

```dotenv
MYSQL_ROOT_PASSWORD=rootpass123
MYSQL_DATABASE=blogdb
MYSQL_USER=bloguser
MYSQL_PASSWORD=blogpass123
API_PORT=3000
ADMINER_PORT=8081
```

### `compose.yaml`

```yaml
services:
  db:
    image: mysql:8.4
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - db_data:/var/lib/mysql
      - ./init-db:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${MYSQL_ROOT_PASSWORD}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 20s
    networks:
      - backend

  api:
    build: ./api
    restart: unless-stopped
    environment:
      DB_HOST: db
      DB_USER: ${MYSQL_USER}
      DB_PASSWORD: ${MYSQL_PASSWORD}
      DB_NAME: ${MYSQL_DATABASE}
      PORT: 3000
    ports:
      - "${API_PORT}:3000"
    depends_on:
      db:
        condition: service_healthy
    networks:
      - backend
      - frontend

  adminer:
    image: adminer:4
    restart: unless-stopped
    ports:
      - "${ADMINER_PORT}:8080"
    depends_on:
      - db
    networks:
      - backend

volumes:
  db_data:

networks:
  frontend:
  backend:
```

### Chạy lab

```bash
cd lab1-webapp-db
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

### Kiểm tra

```bash
curl http://localhost:3000/health
curl http://localhost:3000/posts
# Mở http://localhost:8081 -> đăng nhập Adminer: System=MySQL, Server=db, User=bloguser, Password=blogpass123, DB=blogdb
```

### Bài tập mở rộng
1. Thêm endpoint `POST /posts` để insert bài viết mới.
2. Đổi `db` sang dùng named volume khác và quan sát data có mất không khi `docker compose down` (không `-v`).
3. Thử xóa `condition: service_healthy` rồi `docker compose up` — quan sát API log lỗi connect vì MySQL chưa sẵn sàng.

---

## LAB 2 — Reverse Proxy + Multi-Service (Nginx + 2 API)

### Mục tiêu
Hiểu cách dùng Nginx làm reverse proxy/load balancer trước nhiều backend service, network segmentation, `expose` vs `ports`.

### Kịch bản
Công ty có 2 API: **Orders Service** và **Users Service**. Cần 1 Nginx đứng trước, route theo path: `/api/orders/*` → orders-service, `/api/users/*` → users-service. Cả 2 backend **không** được truy cập trực tiếp từ ngoài.

### Cấu trúc thư mục

```
lab2-reverse-proxy/
├── compose.yaml
├── nginx/
│   └── default.conf
├── orders-service/
│   ├── Dockerfile
│   └── app.py
└── users-service/
    ├── Dockerfile
    └── app.py
```

### `orders-service/app.py` (Flask đơn giản)

```python
from flask import Flask, jsonify
app = Flask(__name__)

@app.route("/api/orders/health")
def health():
    return jsonify(status="ok", service="orders")

@app.route("/api/orders")
def orders():
    return jsonify(orders=[{"id": 1, "item": "Laptop"}, {"id": 2, "item": "Mouse"}])

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

### `users-service/app.py`

```python
from flask import Flask, jsonify
app = Flask(__name__)

@app.route("/api/users/health")
def health():
    return jsonify(status="ok", service="users")

@app.route("/api/users")
def users():
    return jsonify(users=[{"id": 1, "name": "An"}, {"id": 2, "name": "Binh"}])

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

### Dockerfile chung cho 2 service (đặt riêng mỗi thư mục)

```dockerfile
FROM python:3.12-alpine
WORKDIR /app
RUN pip install flask
COPY app.py .
EXPOSE 5000
CMD ["python", "app.py"]
```

### `nginx/default.conf`

```nginx
upstream orders_upstream {
    server orders-service:5000;
}

upstream users_upstream {
    server users-service:5000;
}

server {
    listen 80;

    location /api/orders {
        proxy_pass http://orders_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/users {
        proxy_pass http://users_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        return 404;
    }
}
```

### `compose.yaml`

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      - "80:80"          # CHỈ Nginx mới expose ra host
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - orders-service
      - users-service
    networks:
      - public
      - internal

  orders-service:
    build: ./orders-service
    restart: unless-stopped
    expose:
      - "5000"            # Chỉ nội bộ network, KHÔNG bind ra host
    networks:
      - internal

  users-service:
    build: ./users-service
    restart: unless-stopped
    expose:
      - "5000"
    networks:
      - internal

networks:
  public:
  internal:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
curl http://localhost/api/orders
curl http://localhost/api/users
curl http://localhost:5000           # phải FAIL — port không expose ra host (đúng theo thiết kế bảo mật)
```

### Bài tập mở rộng
1. Thêm `upstream` với 2 server cho `orders-service` (scale `--scale orders-service=2`) và quan sát Nginx load balance round-robin.
2. Thêm location `/api/orders/health` riêng để health-check không qua proxy buffer.
3. Thêm rate limiting trong Nginx (`limit_req_zone`).

---

## LAB 3 — Full Stack: Frontend + Backend + DB + Cache + Queue

### Mục tiêu
Dựng kiến trúc thực tế gần với production: **React (build tĩnh, serve bằng Nginx) + Node API + PostgreSQL + Redis cache + BullMQ-style background worker**, dùng `depends_on` đầy đủ điều kiện, multi-stage Dockerfile, override file cho dev.

### Kịch bản
Hệ thống "Task Manager": người dùng tạo task qua API, API lưu Postgres, cache danh sách task vào Redis để giảm tải DB, có 1 worker chạy ngầm xử lý task nặng (gửi email giả lập) lấy từ Redis queue.

### Cấu trúc thư mục

```
lab3-fullstack/
├── compose.yaml
├── compose.override.yaml
├── .env
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/index.html
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── src/server.js
└── worker/
    ├── Dockerfile
    ├── package.json
    └── src/worker.js
```

### `.env`

```dotenv
POSTGRES_DB=taskdb
POSTGRES_USER=taskuser
POSTGRES_PASSWORD=taskpass
API_PORT=4000
FRONTEND_PORT=8080
REDIS_PORT=6379
```

### `api/src/server.js`

```javascript
const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: 'db',
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
});

const redisClient = createClient({ url: 'redis://cache:6379' });
redisClient.connect().catch(console.error);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/tasks', async (req, res) => {
  const cached = await redisClient.get('tasks:all');
  if (cached) {
    return res.json({ source: 'cache', data: JSON.parse(cached) });
  }
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id DESC');
  await redisClient.setEx('tasks:all', 30, JSON.stringify(rows));
  res.json({ source: 'db', data: rows });
});

app.post('/tasks', async (req, res) => {
  const { title } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO tasks (title, status) VALUES ($1, $2) RETURNING *',
    [title, 'pending']
  );
  await redisClient.del('tasks:all');
  await redisClient.lPush('task_queue', JSON.stringify(rows[0]));
  res.status(201).json(rows[0]);
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

init().then(() => {
  app.listen(4000, () => console.log('API listening on 4000'));
});
```

### `api/package.json`

```json
{
  "name": "lab3-api",
  "version": "1.0.0",
  "main": "src/server.js",
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.11.5",
    "redis": "^4.6.13"
  },
  "scripts": { "start": "node src/server.js" }
}
```

### `api/Dockerfile` (multi-stage)

```dockerfile
# ---- Stage 1: dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --production

# ---- Stage 2: production runtime ----
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["node", "src/server.js"]
```

### `worker/src/worker.js`

```javascript
const { createClient } = require('redis');

const client = createClient({ url: 'redis://cache:6379' });

async function processQueue() {
  await client.connect();
  console.log('Worker started, waiting for tasks...');
  while (true) {
    const result = await client.brPop('task_queue', 5);
    if (result) {
      const task = JSON.parse(result.element);
      console.log(`Processing task #${task.id}: ${task.title}`);
      // Giả lập xử lý nặng (gửi email, render báo cáo, v.v.)
      await new Promise((r) => setTimeout(r, 2000));
      console.log(`Task #${task.id} done.`);
    }
  }
}

processQueue().catch(console.error);
```

### `worker/package.json` & `worker/Dockerfile`

```json
{
  "name": "lab3-worker",
  "version": "1.0.0",
  "main": "src/worker.js",
  "dependencies": { "redis": "^4.6.13" },
  "scripts": { "start": "node src/worker.js" }
}
```

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "src/worker.js"]
```

### `frontend/Dockerfile` (multi-stage build + Nginx serve)

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

> Ghi chú: trong lab demo này, để đơn giản bạn có thể thay `frontend` bằng 1 file `index.html` tĩnh + Nginx thay vì React thật — phần quan trọng là **kỹ thuật multi-stage build**, không phải framework cụ thể.

### `compose.yaml` (base — dùng cho production-like)

```yaml
services:
  frontend:
    build:
      context: ./frontend
      target: production
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT}:80"
    depends_on:
      - api
    networks:
      - frontend_net

  api:
    build:
      context: ./api
      target: production
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    ports:
      - "${API_PORT}:4000"
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    networks:
      - frontend_net
      - backend_net
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M

  worker:
    build: ./worker
    restart: unless-stopped
    depends_on:
      cache:
        condition: service_started
    networks:
      - backend_net

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks:
      - backend_net

  cache:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
    networks:
      - backend_net

volumes:
  pg_data:
  redis_data:

networks:
  frontend_net:
  backend_net:
```

### `compose.override.yaml` (tự động áp dụng khi dev local)

```yaml
services:
  api:
    build:
      target: deps          # dùng stage chưa optimize, có devDependencies
    volumes:
      - ./api/src:/app/src
    environment:
      NODE_ENV: development
    command: ["node", "--watch", "src/server.js"]

  frontend:
    build:
      target: build
    volumes:
      - ./frontend/src:/app/src
    ports:
      - "5173:5173"
    command: ["npm", "run", "dev", "--", "--host"]
```

### Chạy lab

```bash
# Dev (override tự áp dụng)
docker compose up -d --build

# "Production-like" (bỏ override)
docker compose -f compose.yaml up -d --build
```

### Kiểm tra luồng end-to-end

```bash
curl -X POST http://localhost:4000/tasks -H "Content-Type: application/json" -d '{"title":"Hoc Docker Compose"}'
curl http://localhost:4000/tasks          # lần 1: source=db
curl http://localhost:4000/tasks          # lần 2 (trong 30s): source=cache
docker compose logs -f worker             # xem worker xử lý task
```

### Bài tập mở rộng
1. Thêm `DELETE /tasks/:id`, nhớ xóa cache liên quan.
2. Thêm retry logic khi Redis mất kết nối.
3. Thêm `pgAdmin` hoặc `Adminer` để xem dữ liệu Postgres trực quan.

---

## LAB 4 — Microservices với Message Broker (Kafka/RabbitMQ)

### Mục tiêu
Hiểu kiến trúc event-driven: Producer service publish event, Consumer service subscribe và xử lý, dùng RabbitMQ (đơn giản hơn Kafka để học, vẫn đúng tinh thần message broker).

### Kịch bản
Hệ thống e-commerce: khi có **order mới**, `order-service` publish message vào queue `orders`, `notification-service` consume và "gửi email" giả lập.

### Cấu trúc thư mục

```
lab4-message-broker/
├── compose.yaml
├── order-service/
│   ├── Dockerfile
│   ├── package.json
│   └── index.js
└── notification-service/
    ├── Dockerfile
    ├── package.json
    └── index.js
```

### `order-service/index.js`

```javascript
const express = require('express');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

let channel;

async function connectQueue() {
  let retries = 10;
  while (retries) {
    try {
      const conn = await amqp.connect('amqp://rabbitmq:5672');
      channel = await conn.createChannel();
      await channel.assertQueue('orders', { durable: true });
      console.log('Connected to RabbitMQ');
      return;
    } catch (err) {
      console.log('RabbitMQ not ready, retrying...', err.message);
      retries--;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('Could not connect to RabbitMQ');
}

app.post('/orders', (req, res) => {
  const order = { id: Date.now(), ...req.body };
  channel.sendToQueue('orders', Buffer.from(JSON.stringify(order)), { persistent: true });
  res.status(201).json({ message: 'Order created', order });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

connectQueue().then(() => {
  app.listen(3001, () => console.log('order-service listening on 3001'));
});
```

### `notification-service/index.js`

```javascript
const amqp = require('amqplib');

async function consume() {
  let retries = 10;
  let conn;
  while (retries) {
    try {
      conn = await amqp.connect('amqp://rabbitmq:5672');
      break;
    } catch (err) {
      console.log('Waiting for RabbitMQ...');
      retries--;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const channel = await conn.createChannel();
  await channel.assertQueue('orders', { durable: true });

  console.log('notification-service waiting for orders...');
  channel.consume('orders', (msg) => {
    const order = JSON.parse(msg.content.toString());
    console.log(`[EMAIL SIMULATION] Sending confirmation for order #${order.id}`);
    channel.ack(msg);
  });
}

consume().catch(console.error);
```

### `package.json` chung (mỗi service)

```json
{
  "name": "service",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.19.2",
    "amqplib": "^0.10.4"
  }
}
```

### Dockerfile chung

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "index.js"]
```

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    ports:
      - "15672:15672"     # Management UI
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - broker_net

  order-service:
    build: ./order-service
    restart: unless-stopped
    ports:
      - "3001:3001"
    depends_on:
      rabbitmq:
        condition: service_healthy
    networks:
      - broker_net

  notification-service:
    build: ./notification-service
    restart: unless-stopped
    depends_on:
      rabbitmq:
        condition: service_healthy
    networks:
      - broker_net

networks:
  broker_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
curl -X POST http://localhost:3001/orders -H "Content-Type: application/json" -d '{"product":"Laptop","qty":1}'
docker compose logs -f notification-service
# Mở http://localhost:15672 (user/pass mặc định: guest/guest) để xem queue "orders"
```

### Bài tập mở rộng
1. Scale `notification-service` lên 3 instance — quan sát RabbitMQ chia message theo round-robin (competing consumers).
2. Thêm Dead Letter Queue (DLQ) khi message xử lý lỗi quá 3 lần.
3. Đổi sang Kafka (`confluentinc/cp-kafka` + `cp-zookeeper`) để thấy sự khác biệt mô hình partition/consumer-group.

---

## LAB 5 — Monitoring Stack (Prometheus + Grafana)

### Mục tiêu
Giám sát một API thực tế bằng Prometheus (scrape metrics) + Grafana (dashboard visualize) — kiến trúc observability tiêu chuẩn.

### Cấu trúc thư mục

```
lab5-monitoring/
├── compose.yaml
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   └── provisioning/
│       └── datasources/
│           └── datasource.yml
└── api/
    ├── Dockerfile
    ├── package.json
    └── server.js
```

### `api/server.js` (expose metrics theo chuẩn Prometheus)

```javascript
const express = require('express');
const client = require('prom-client');

const app = express();
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
register.registerMetric(httpRequestCounter);

app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
  });
  next();
});

app.get('/', (req, res) => res.json({ message: 'Hello from monitored API' }));
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(3000, () => console.log('API on 3000'));
```

### `api/package.json` & Dockerfile

```json
{
  "name": "lab5-api",
  "dependencies": { "express": "^4.19.2", "prom-client": "^15.1.2" }
}
```

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "server.js"]
```

### `prometheus/prometheus.yml`

```yaml
global:
  scrape_interval: 5s

scrape_configs:
  - job_name: 'api'
    static_configs:
      - targets: ['api:3000']

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
```

### `grafana/provisioning/datasources/datasource.yml`

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
```

### `compose.yaml`

```yaml
services:
  api:
    build: ./api
    restart: unless-stopped
    networks:
      - monitor_net

  prometheus:
    image: prom/prometheus:v2.53.0
    restart: unless-stopped
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prom_data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - monitor_net

  grafana:
    image: grafana/grafana:11.1.0
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin123
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
    ports:
      - "3001:3000"
    depends_on:
      - prometheus
    networks:
      - monitor_net

volumes:
  prom_data:
  grafana_data:

networks:
  monitor_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
curl http://localhost:3000/metrics      # xem raw metrics
# Mở http://localhost:9090 -> Prometheus UI, thử query: http_requests_total
# Mở http://localhost:3001 -> Grafana (user: admin / pass: admin123), datasource Prometheus đã tự cấu hình
```

### Bài tập mở rộng
1. Tạo dashboard Grafana hiển thị request rate theo route.
2. Thêm `node-exporter` để giám sát CPU/RAM của host.
3. Thêm Alertmanager khi `http_requests_total{status="500"}` vượt ngưỡng.

---

## LAB 6 — CI/CD Local: Multi-Stage Build + Healthcheck + Scale

### Mục tiêu
Mô phỏng pipeline CI/CD cục bộ: build → test → deploy stack với load balancer, dùng `docker compose run` để chạy test trong container riêng (không ảnh hưởng container chạy thật), rồi scale service production.

### Cấu trúc thư mục

```
lab6-cicd-local/
├── compose.yaml
├── compose.test.yaml
├── app/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── server.test.js
└── nginx-lb/
    └── nginx.conf
```

### `app/server.js`

```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello', instance: process.env.HOSTNAME });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

if (require.main === module) {
  app.listen(3000, () => console.log('Listening on 3000'));
}

module.exports = app;
```

### `app/server.test.js` (test đơn giản bằng Jest + supertest)

```javascript
const request = require('supertest');
const app = require('./server');

test('GET / returns 200', async () => {
  const res = await request(app).get('/');
  expect(res.statusCode).toBe(200);
});

test('GET /health returns OK', async () => {
  const res = await request(app).get('/health');
  expect(res.text).toBe('OK');
});
```

### `app/package.json`

```json
{
  "name": "lab6-app",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "test": "jest"
  },
  "dependencies": { "express": "^4.19.2" },
  "devDependencies": { "jest": "^29.7.0", "supertest": "^7.0.0" }
}
```

### `app/Dockerfile` (multi-stage: test stage riêng + production stage)

```dockerfile
# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---- Test stage: chứa devDependencies, dùng để chạy CI test ----
FROM base AS test
RUN npm install
COPY . .
CMD ["npm", "test"]

# ---- Production stage: chỉ deps production, image nhỏ ----
FROM base AS production
RUN npm install --production
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

### `nginx-lb/nginx.conf`

```nginx
events {}
http {
    upstream app_cluster {
        server app:3000;
    }
    server {
        listen 80;
        location / {
            proxy_pass http://app_cluster;
        }
    }
}
```

### `compose.yaml` (production-like, dùng để deploy thật)

```yaml
services:
  app:
    build:
      context: ./app
      target: production
    restart: unless-stopped
    expose:
      - "3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 3
    networks:
      - app_net

  lb:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      - "8080:80"
    volumes:
      - ./nginx-lb/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      app:
        condition: service_healthy
    networks:
      - app_net

networks:
  app_net:
```

### `compose.test.yaml` (chỉ dùng riêng cho bước test trong CI)

```yaml
services:
  app-test:
    build:
      context: ./app
      target: test
    networks:
      - app_net

networks:
  app_net:
```

### Quy trình CI/CD mô phỏng (chạy tay từng bước)

```bash
# Bước 1: Build & chạy test trong container riêng (tự huỷ sau khi xong)
docker compose -f compose.test.yaml run --rm app-test

# Bước 2: Nếu test pass (`run` trả exit code 0) -> build production image
docker compose build

# Bước 3: Deploy với 3 instance app phía sau load balancer
docker compose up -d --scale app=3

# Bước 4: Kiểm tra cluster
docker compose ps
for i in 1 2 3 4 5; do curl -s http://localhost:8080/ | python3 -c "import sys,json;print(json.load(sys.stdin)['instance'])"; done
```

### Script gói gọn pipeline (`ci.sh`)

```bash
#!/usr/bin/env bash
set -e

echo "== STEP 1: Run tests =="
docker compose -f compose.test.yaml run --rm app-test

echo "== STEP 2: Build production image =="
docker compose build

echo "== STEP 3: Deploy with 3 replicas =="
docker compose up -d --scale app=3

echo "== STEP 4: Health check =="
sleep 5
curl -f http://localhost:8080/health && echo "Deploy OK"
```

```bash
chmod +x ci.sh
./ci.sh
```

### Bài tập mở rộng
1. Thêm bước "rollback" nếu healthcheck thất bại (`docker compose down` rồi deploy lại image cũ).
2. Tích hợp `ci.sh` vào GitHub Actions / GitLab CI thật (job gọi script này trên runner có Docker).
3. Thêm `docker compose logs --since 1m app` vào script để debug khi deploy fail.

---

## 19. Troubleshooting Thường Gặp

| Vấn đề | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `port is already allocated` | Cổng host đã bị process/container khác chiếm | `docker ps`, đổi cổng trong `ports:`, hoặc `lsof -i :<port>` |
| Service A không connect được Service B bằng tên | Hai service không cùng `networks` | Kiểm tra `networks:` của từng service, đảm bảo cùng network |
| `depends_on` không đủ — app vẫn lỗi "connection refused" lúc đầu | `depends_on` chỉ chờ container start, không chờ app sẵn sàng | Thêm `healthcheck` + `condition: service_healthy` |
| Sửa code nhưng container không cập nhật | Image cũ được cache, hoặc dùng `image:` thay vì bind mount khi dev | `docker compose up --build`, hoặc bind mount source code khi dev |
| `docker compose down` xong mất hết data | Dùng `-v` (xóa volume) hoặc dùng bind mount sai đường dẫn | Bỏ `-v` nếu không cố ý; luôn dùng named volume cho data quan trọng |
| Container liên tục restart loop | App crash ngay khi start (thiếu env, sai config) | `docker compose logs <service>` xem traceback; tạm bỏ `restart` để debug |
| `.env` không có hiệu lực trong YAML (`${VAR}` không thay) | File `.env` không cùng thư mục với `compose.yaml`, hoặc sai tên biến | Đặt `.env` cùng cấp `compose.yaml`; `docker compose config` để debug |
| Build rất chậm | Build context quá lớn (gồm `node_modules`, `.git`...) | Thêm `.dockerignore` loại trừ thư mục không cần |
| `docker compose up --scale` báo lỗi port conflict | Cố định `ports:` host khi scale > 1 instance | Dùng `expose` + load balancer (Nginx/Traefik) thay vì map port cố định |
| Healthcheck luôn "unhealthy" dù app chạy bình thường | Container không có `curl`/`wget` (image alpine tối giản) | Dùng `CMD-SHELL` với tool có sẵn, hoặc cài thêm, hoặc dùng cách check khác (TCP probe) |

---

## 20. Cheat Sheet Tổng Hợp

```bash
# === LIFECYCLE ===
docker compose up -d              # Start (detached)
docker compose up -d --build      # Build lại rồi start
docker compose down               # Stop + xóa container/network (giữ volume)
docker compose down -v            # Stop + xóa luôn volume (mất data)
docker compose restart <svc>      # Restart 1 service
docker compose stop / start       # Dừng/khởi động lại (giữ container)

# === DEBUG ===
docker compose ps                 # Danh sách container trong project
docker compose logs -f <svc>      # Log realtime
docker compose top                # Process đang chạy trong container
docker compose exec <svc> sh      # Vào shell container đang chạy
docker compose config             # Xem YAML đã merge & resolve biến

# === BUILD / IMAGE ===
docker compose build              # Build tất cả service có "build:"
docker compose build --no-cache   # Build lại từ đầu, bỏ cache
docker compose pull               # Pull image mới cho service dùng "image:"
docker compose push               # Push image đã build lên registry

# === SCALE & RESOURCE ===
docker compose up -d --scale api=3
docker stats                      # Theo dõi resource usage live

# === RUN MỘT LẦN (không phải container chính) ===
docker compose run --rm api npm test
docker compose run --rm db psql -U postgres

# === MULTI-FILE ===
docker compose -f compose.yaml -f compose.prod.yaml up -d
docker compose -f compose.test.yaml run --rm app-test

# === VOLUME / NETWORK ===
docker volume ls
docker network ls
docker volume inspect <name>
docker network inspect <name>
```

### Quy tắc vàng cần nhớ

1. **`docker compose` (có khoảng trắng)**, không phải `docker-compose` (cú pháp cũ V1).
2. Service nói chuyện với nhau bằng **tên service** làm hostname — không cần IP.
3. `depends_on` đảm bảo **thứ tự**, `healthcheck` đảm bảo **sẵn sàng thật**.
4. Data quan trọng → **named volume**. Code khi dev → **bind mount**.
5. Production: pin version, giới hạn resource, không bind mount source code, không lộ secret qua `environment:` trần.
6. Khi scale, **bỏ port cố định, bỏ container_name**, để load balancer phía trước.

---

*Hết tài liệu — chúc bạn thực hành Docker Compose hiệu quả!*
