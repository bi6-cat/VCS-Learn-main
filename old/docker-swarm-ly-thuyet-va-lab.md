# Docker Swarm — Lý Thuyết & Lab Thực Tế Chi Tiết

> Tài liệu tổng hợp từ lý thuyết nền tảng (Cluster, Node, Service, Stack, Networking, Storage) đến các bài lab thực tế cô đọng nhưng bao quát toàn bộ kỹ thuật cốt lõi của Docker Swarm.

---

## Mục Lục

1. [Tổng Quan Về Docker Swarm](#1-tổng-quan-về-docker-swarm)
2. [Kiến Trúc Cluster — Manager & Worker](#2-kiến-trúc-cluster--manager--worker)
3. [Raft Consensus & Quorum](#3-raft-consensus--quorum)
4. [Service — Đơn Vị Triển Khai Của Swarm](#4-service--đơn-vị-triển-khai-của-swarm)
5. [Replicated vs Global Service](#5-replicated-vs-global-service)
6. [Networking Trong Swarm](#6-networking-trong-swarm)
7. [Routing Mesh & Load Balancing](#7-routing-mesh--load-balancing)
8. [Storage & Volume Trong Swarm](#8-storage--volume-trong-swarm)
9. [Stack & Compose File trong Swarm](#9-stack--compose-file-trong-swarm)
10. [Rolling Update & Rollback](#10-rolling-update--rollback)
11. [Placement Constraints & Resource Scheduling](#11-placement-constraints--resource-scheduling)
12. [Secrets & Configs](#12-secrets--configs)
13. [Swarm CLI — Lệnh Quan Trọng](#13-swarm-cli--lệnh-quan-trọng)
14. [Best Practices Production](#14-best-practices-production)
15. [LAB 1 — Khởi Tạo Cluster & Service Cơ Bản (Single → Multi-node)](#lab-1--khởi-tạo-cluster--service-cơ-bản-single--multi-node)
16. [LAB 2 — Stack Full: Web + API + DB + Routing Mesh + Secrets](#lab-2--stack-full-web--api--db--routing-mesh--secrets)
17. [LAB 3 — Rolling Update, Rollback & Placement Constraints](#lab-3--rolling-update-rollback--placement-constraints)
18. [LAB 4 — High Availability: Mất Node, Failover & Visualizer](#lab-4--high-availability-mất-node-failover--visualizer)
19. [Troubleshooting Thường Gặp](#19-troubleshooting-thường-gặp)
20. [Cheat Sheet Tổng Hợp](#20-cheat-sheet-tổng-hợp)

---

## 1. Tổng Quan Về Docker Swarm

### 1.1. Docker Swarm là gì?

Docker Swarm là công cụ **orchestration** (điều phối container) **tích hợp sẵn trong Docker Engine** — biến nhiều máy Docker đơn lẻ thành **1 cluster thống nhất**, cho phép triển khai, scale, tự phục hồi (self-healing) các service trên nhiều node mà vẫn dùng cú pháp Compose quen thuộc.

```bash
docker swarm init      # Biến Docker Engine hiện tại thành Swarm manager đầu tiên
```

Không cần cài thêm gì — Swarm là 1 **mode** có sẵn trong Docker, chỉ cần "kích hoạt".

### 1.2. Tại sao cần Swarm khi đã có Compose?

| Compose thường (`docker compose up`) | Swarm |
|---|---|
| Chạy trên **1 máy duy nhất** | Chạy trên **nhiều máy (node)** thành 1 cluster |
| Container chết → phải tự restart thủ công (hoặc `restart:` đơn giản) | **Self-healing**: scheduler tự động khởi động lại container ở node khác còn sống |
| Không có khái niệm "service" phân tán | **Service** trừu tượng hóa: bạn khai báo "muốn 5 replica", Swarm tự rải đều qua các node |
| Load balancing giữa container phải tự dựng (Nginx...) | **Routing Mesh** tự động load-balance, có sẵn không cần cấu hình thêm |
| Update code → down/up lại, có downtime | **Rolling update** tự động, có thể zero-downtime |
| Không có cơ chế bầu lại "máy chủ chính" khi máy chính chết | **Raft consensus** tự bầu lại manager lãnh đạo |

### 1.3. Swarm vs Kubernetes — khi nào dùng cái nào?

| Tiêu chí | Docker Swarm | Kubernetes |
|---|---|---|
| Độ phức tạp cài đặt & vận hành | Rất đơn giản, có sẵn trong Docker | Phức tạp hơn nhiều, nhiều thành phần (etcd, kubelet, kube-proxy...) |
| Tốc độ học | Nhanh — dùng lại cú pháp Compose | Cần học YAML riêng (Deployment, Service, Ingress...) |
| Tính năng nâng cao (autoscaling theo metric, CRD, operator...) | Hạn chế | Rất mạnh, ecosystem khổng lồ |
| Quy mô cluster lớn (hàng nghìn node) | Khả năng hạn chế hơn | Được thiết kế cho quy mô rất lớn |
| Phù hợp | Team nhỏ/vừa, muốn đơn giản, không cần hết tính năng K8s | Hệ thống lớn, cần ecosystem phong phú, đa cloud |

→ Swarm là lựa chọn tốt khi: team nhỏ, muốn HA + scale cơ bản mà **không phải học cả hệ sinh thái Kubernetes**.

---

## 2. Kiến Trúc Cluster — Manager & Worker

### 2.1. Hai loại node

```
                    ┌─────────────────────────────┐
                    │      SWARM CLUSTER          │
                    │                              │
   ┌────────────┐   │   ┌──────────┐  ┌──────────┐ │
   │  Manager 1 │◄──┼──►│Manager 2 │  │Manager 3 │ │   (Raft consensus
   │ (Leader)   │   │   │(Follower)│  │(Follower)│ │    giữa managers)
   └─────┬──────┘   │   └──────────┘  └──────────┘ │
         │          │                              │
         │          │   ┌─────────┐ ┌─────────┐    │
         └──────────┼──►│Worker 1 │ │Worker 2 │    │
                    │   └─────────┘ └─────────┘    │
                    └─────────────────────────────┘
```

| Loại node | Vai trò |
|---|---|
| **Manager** | Quản lý trạng thái cluster, ra quyết định lập lịch (scheduling), tham gia Raft consensus để duy trì 1 nguồn sự thật chung (cluster state). Có thể vừa làm Manager vừa chạy container (mặc định) |
| **Worker** | Chỉ chạy container theo lệnh từ Manager, **không** tham gia quyết định, **không** có bản sao cluster state |

### 2.2. Vì sao cần nhiều Manager?

1 Manager duy nhất = **single point of failure** — máy đó chết, cả cluster không thể nhận lệnh mới (dù worker vẫn chạy container đang có). Nhiều Manager (lẻ: 3, 5, 7) cho phép:
- **Bầu lại Leader** tự động khi Leader hiện tại chết (qua Raft).
- Cluster vẫn nhận lệnh mới miễn còn **đa số (quorum)** Manager sống.

### 2.3. Quy tắc số lượng Manager

| Số Manager | Chịu được mất bao nhiêu Manager mà cluster vẫn hoạt động |
|---|---|
| 1 | 0 (không chịu được mất Manager nào) |
| 3 | 1 |
| 5 | 2 |
| 7 | 3 |

> **Luôn dùng số lẻ Manager.** Số chẵn (vd: 4) không tăng khả năng chịu lỗi so với số lẻ liền trước (3) nhưng lại tốn thêm 1 máy — vô nghĩa về mặt quorum.

---

## 3. Raft Consensus & Quorum

### 3.1. Raft là gì (ở mức hiểu để vận hành, không cần hiểu thuật toán chi tiết)?

Raft là thuật toán đồng thuận phân tán — đảm bảo **mọi Manager đều có cùng 1 bản ghi lịch sử quyết định** (cluster state: service nào, bao nhiêu replica, network nào...), dù có Manager chết/mất kết nối tạm thời.

### 3.2. Quorum — "đa số phải đồng ý"

Một quyết định (vd: tạo service mới) chỉ được xác nhận khi **đa số Manager (>50%)** đồng ý ghi vào log. Đây là lý do:
- Cluster còn **quorum** (đa số Manager sống) → mọi việc vẫn chạy bình thường, có thể tạo/sửa service mới.
- Cluster **mất quorum** (đa số Manager chết) → cluster vào trạng thái **read-only**: container đang chạy vẫn chạy tiếp, nhưng **không thể** tạo/sửa/scale service mới cho tới khi đủ quorum trở lại.

### 3.3. Manager vừa làm Worker được không?

Được — mặc định Manager **cũng nhận task chạy container** như Worker. Nhưng trong cluster lớn, có thể dùng `--availability drain` để Manager **chỉ làm việc quản lý**, không chạy container, tránh tải nặng ảnh hưởng tới quyết định Raft.

```bash
docker node update --availability drain manager1
```

---

## 4. Service — Đơn Vị Triển Khai Của Swarm

### 4.1. Service vs Container — sự khác biệt tư duy quan trọng nhất

Trong Swarm, bạn **không quản lý từng container riêng lẻ**. Bạn khai báo **Service** — một "mong muốn" (desired state): "tôi muốn image X chạy với N bản sao, cấu hình Y". Swarm scheduler tự lo phần còn lại: chọn node nào chạy, khởi động lại nếu chết, rải đều...

```bash
docker service create \
  --name my-web \
  --replicas 3 \
  --publish 8080:80 \
  nginx:1.27-alpine
```

→ Lệnh trên tạo **1 Service**, Swarm tự tạo **3 Task** (mỗi Task tương ứng 1 container), rải qua các node available.

### 4.2. Service ↔ Task ↔ Container

```
Service (my-web, desired replicas=3)
   ├── Task 1 --> Container trên Node A
   ├── Task 2 --> Container trên Node B
   └── Task 3 --> Container trên Node C

Nếu Container trên Node B chết:
   Swarm tạo Task MỚI (Task 4) --> Container mới trên node available
   (KHÔNG "sống lại" Task 2 cũ — Task là immutable, chết là tạo task mới thay thế)
```

### 4.3. Các thuộc tính quan trọng khi tạo Service

```bash
docker service create \
  --name api \
  --replicas 4 \
  --publish published=8080,target=3000,mode=ingress \
  --network my_overlay_net \
  --env NODE_ENV=production \
  --mount type=volume,source=api_data,target=/app/data \
  --limit-cpu 0.5 \
  --limit-memory 256M \
  --reserve-cpu 0.25 \
  --reserve-memory 128M \
  --restart-condition on-failure \
  --update-parallelism 2 \
  --update-delay 10s \
  --constraint node.role==worker \
  myregistry.com/api:1.2.0
```

---

## 5. Replicated vs Global Service

### 5.1. Replicated Mode (mặc định)

Bạn khai báo **số replica cụ thể** (vd: 5), Swarm rải đều N container đó qua các node available — không quan tâm số lượng node.

```bash
docker service create --name web --replicas 5 nginx
```

→ 3 node available → Swarm có thể rải 2-2-1 hoặc bất kỳ cách chia nào hợp lý.

### 5.2. Global Mode

**Mỗi node trong cluster chạy đúng 1 container** của service đó — không khai báo số lượng, số container = số node available.

```bash
docker service create --name node-exporter --mode global prom/node-exporter
```

→ Dùng cho: monitoring agent, log collector, security agent — **mọi node đều cần 1 bản** để thu thập dữ liệu tại chỗ. Thêm node mới vào cluster → Swarm tự động chạy thêm 1 container Global Service trên node đó.

| | Replicated | Global |
|---|---|---|
| Khai báo số lượng | Có (`--replicas N`) | Không — tự bằng số node |
| Use case | Web server, API — cần scale độc lập với số node | Monitoring agent, log shipper — cần đúng 1/node |

---

## 6. Networking Trong Swarm

### 6.1. Overlay Network — mạng vượt nhiều máy vật lý

Khác với `bridge` network của Compose thường (chỉ hoạt động trong 1 máy), Swarm dùng **Overlay Network** — tạo 1 mạng ảo **trải qua nhiều node vật lý**, container ở node A có thể gọi container ở node B bằng tên service, như thể chúng ở cùng 1 máy.

```bash
docker network create --driver overlay --attachable my_overlay_net
```

| Driver | Phạm vi |
|---|---|
| `bridge` | Chỉ 1 host (giống Compose thường) |
| `overlay` | Nhiều host trong cùng Swarm cluster — **bắt buộc dùng cho Swarm multi-node** |
| `host` | Container dùng network namespace của host trực tiếp |

### 6.2. Service Discovery qua DNS nội bộ

Giống Compose thường, các service trong cùng overlay network gọi nhau bằng **tên service** — Swarm có DNS server nội bộ tự phân giải tên service sang **Virtual IP (VIP)** đại diện cho toàn bộ replica của service đó (load balancing ở layer DNS/IP, không cần biết IP container cụ thể).

### 6.3. `--attachable` — cho container thường join vào overlay network

Mặc định, overlay network tạo bởi `docker service create` chỉ services Swarm dùng được. Thêm `--attachable` để cả container chạy bằng `docker run` thường (không qua Swarm) cũng join được — hữu ích khi debug.

---

## 7. Routing Mesh & Load Balancing

### 7.1. Vấn đề: client gọi vào node nào cũng phải tới đúng service

Routing Mesh là tính năng **tự động load-balance** built-in của Swarm — khi publish port ở `mode=ingress` (mặc định), **MỌI node trong cluster** đều lắng nghe port đó, dù node đó có chạy container của service hay không. Request tới bất kỳ node nào đều được route nội bộ tới 1 container khỏe mạnh của service tương ứng.

```
Client --> gọi tới Node B:8080 (Node B KHÔNG có container nào của service "web")
                  │
                  ▼ (Routing Mesh tự forward nội bộ)
          Container "web" đang chạy thật ở Node A
```

### 7.2. Hai chế độ publish port

```bash
# Ingress mode (mặc định) — Routing Mesh, mọi node đều nhận request rồi tự route
docker service create --publish published=8080,target=80,mode=ingress nginx

# Host mode — chỉ node ĐANG CHẠY container đó mới nhận request ở port này (không qua Routing Mesh)
docker service create --publish published=8080,target=80,mode=host --mode global nginx
```

| Mode | Khi dùng |
|---|---|
| `ingress` | Phổ biến nhất — không cần biết container chạy ở node nào, dùng kèm external LB (vd: HAProxy round-robin tất cả node) |
| `host` | Cần biết chính xác node nào chạy gì (thường kèm `--mode global`), hoặc cần hiệu năng cao nhất tránh thêm 1 lớp route nội bộ |

### 7.3. Load balancing nội bộ (giữa các replica)

Khi gọi tên service trong overlay network, Swarm tự **load-balance ở layer 4 (TCP/UDP)** qua VIP — phân chia tải giữa các replica đang chạy mà không cần Nginx/HAProxy riêng cho việc này (khác với Compose thường, vốn không có cơ chế này built-in).

---

## 8. Storage & Volume Trong Swarm

### 8.1. Vấn đề cố hữu: Volume mặc định chỉ tồn tại trên 1 node

Named volume (`local` driver) chỉ lưu trên node đang chạy container đó. Nếu Swarm scheduler **di chuyển** container đó sang node khác (do node cũ chết, hoặc rolling update), **dữ liệu cũ không tự theo qua** — đây là cái bẫy phổ biến nhất khi mới chuyển từ Compose sang Swarm.

### 8.2. 3 hướng giải quyết

| Giải pháp | Mô tả |
|---|---|
| **Placement constraint cố định node** | Ép service luôn chạy ở 1 node cụ thể (`--constraint node.hostname==dbnode1`) — đơn giản nhưng mất khả năng tự phục hồi nếu node đó chết |
| **Volume driver hỗ trợ network storage** | Dùng plugin volume driver như `local-persist`, NFS, GlusterFS, Portworx, hoặc cloud storage (EFS, Azure Files) — volume "theo" container tới node nào cũng được |
| **Shared network storage qua bind mount NFS** | Mount 1 NFS share giống nhau trên mọi node ở cùng đường dẫn, bind mount path đó vào container |

> Với **database** (Postgres, MySQL...), cách phổ biến và an toàn nhất trong Swarm thực tế vẫn là: **dùng placement constraint cố định node** + backup định kỳ, hoặc dùng managed database bên ngoài cluster Swarm (RDS, Cloud SQL...) — tránh việc Swarm tự "di chuyển" 1 database stateful không có replication thật.

### 8.3. Ví dụ Placement Constraint cho dữ liệu

```yaml
services:
  db:
    image: postgres:16
    volumes:
      - db_data:/var/lib/postgresql/data
    deploy:
      placement:
        constraints:
          - node.labels.db-node == true
```

```bash
docker node update --label-add db-node=true worker1
```

---

## 9. Stack & Compose File trong Swarm

### 9.1. Stack là gì?

**Stack** = một nhóm service liên quan, khai báo trong **1 file Compose** (giống Compose thường), deploy lên Swarm bằng `docker stack deploy`. Đây là cách thực tế nhất để triển khai nhiều service cùng lúc lên Swarm — tương đương "project" trong Compose thường.

```bash
docker stack deploy -c compose.yaml my_stack
```

### 9.2. Khác biệt quan trọng giữa Compose thường và Compose dùng cho Swarm Stack

| | `docker compose up` | `docker stack deploy` |
|---|---|---|
| `build:` | Hoạt động — tự build image | **KHÔNG hoạt động** — Swarm chỉ pull image có sẵn, phải build & push trước |
| `depends_on` | Có hiệu lực (thứ tự start) | **Bị bỏ qua hoàn toàn** — Swarm không đảm bảo thứ tự, phải tự xử lý retry connect trong code |
| `deploy:` (replicas, resources, placement, update_config...) | Chỉ 1 phần được hỗ trợ | **Hoạt động đầy đủ** — đây là lúc `deploy:` phát huy hết sức mạnh |
| Network mặc định | `bridge` | `overlay` |
| Healthcheck → restart container | Docker tự restart theo `restart:` | Swarm scheduler tự tạo Task mới theo `restart_policy` trong `deploy:` |

> **Hệ quả thực tế:** workflow chuẩn là **build & push image lên registry trước** (`docker build`, `docker push`), rồi file Compose dùng cho Stack chỉ cần khai báo `image:`, không cần `build:`.

### 9.3. Ví dụ file Stack đầy đủ

```yaml
services:
  web:
    image: myregistry.com/web:1.0.0
    ports:
      - "8080:80"
    networks:
      - app_net
    deploy:
      replicas: 3
      restart_policy:
        condition: on-failure
        max_attempts: 3
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      resources:
        limits:
          cpus: "0.5"
          memory: 256M

  api:
    image: myregistry.com/api:1.0.0
    networks:
      - app_net
    deploy:
      replicas: 4
      placement:
        constraints:
          - node.role == worker

networks:
  app_net:
    driver: overlay
```

---

## 10. Rolling Update & Rollback

### 10.1. Vấn đề: deploy version mới mà không downtime

Swarm hỗ trợ **rolling update** built-in — thay thế dần từng container cũ bằng container mới, theo tốc độ và thứ tự bạn cấu hình, không cần dừng toàn bộ service.

### 10.2. Cấu hình `update_config`

```yaml
deploy:
  update_config:
    parallelism: 2          # cập nhật 2 container 1 lúc (không phải tất cả cùng lúc)
    delay: 10s               # chờ 10s giữa mỗi batch
    order: start-first        # tạo container MỚI trước, healthy rồi mới xóa container CŨ (zero-downtime thật)
    failure_action: rollback  # nếu update lỗi, TỰ ĐỘNG rollback về version cũ
    monitor: 30s              # theo dõi 30s sau update để xác nhận "thành công"
    max_failure_ratio: 0.3    # cho phép tối đa 30% task lỗi trước khi coi là failed
```

| `order` | Hành vi |
|---|---|
| `stop-first` (mặc định) | Xóa container CŨ trước, rồi mới tạo MỚI — có khoảnh khắc thiếu container (downtime ngắn) |
| `start-first` | Tạo container MỚI trước, đợi healthy, rồi mới xóa CŨ — **zero-downtime thật**, nhưng cần đủ resource chạy tạm 2 bản song song |

### 10.3. Lệnh update thủ công (không cần sửa file, update ngay qua CLI)

```bash
docker service update --image myregistry.com/api:1.1.0 api
docker service update --replicas 6 api
docker service update --env-add LOG_LEVEL=debug api
```

### 10.4. Rollback

```bash
docker service rollback api          # quay lại version NGAY TRƯỚC update gần nhất
docker service ps api                 # xem lịch sử task, tìm version trước đó
```

> Swarm chỉ lưu lại **1 bước rollback gần nhất** trong bộ nhớ cluster — không có lịch sử nhiều version như Helm/K8s. Muốn quay lại version xa hơn, phải `docker service update --image <tag_cu>` thủ công.

---

## 11. Placement Constraints & Resource Scheduling

### 11.1. Constraint — ép service chạy ở node thỏa điều kiện

```yaml
deploy:
  placement:
    constraints:
      - node.role == worker             # chỉ chạy ở Worker, không chạy ở Manager
      - node.labels.zone == us-east     # chỉ chạy ở node có label zone=us-east
      - node.hostname != node3          # KHÔNG chạy ở node3
```

```bash
# Gắn label tùy chỉnh cho node
docker node update --label-add zone=us-east worker1
```

### 11.2. Preference — ưu tiên rải đều (không bắt buộc cứng như constraint)

```yaml
deploy:
  placement:
    preferences:
      - spread: node.labels.zone        # rải đều container qua các zone khác nhau (HA theo khu vực)
```

### 11.3. Resource limits & reservations

```yaml
deploy:
  resources:
    limits:
      cpus: "1.0"
      memory: 512M
    reservations:
      cpus: "0.25"
      memory: 128M
```

- **`limits`**: giới hạn TỐI ĐA container được dùng (vượt quá bị throttle/OOM-kill).
- **`reservations`**: tài nguyên TỐI THIỂU đảm bảo có sẵn — Swarm scheduler chỉ đặt container vào node còn đủ resource reservation này, tránh tình trạng "node quá tải vì đặt quá nhiều task".

---

## 12. Secrets & Configs

### 12.1. Swarm Secrets — quản lý dữ liệu nhạy cảm tập trung

Khác biệt với Compose thường (secret chỉ là file local), **Swarm Secrets được mã hóa, lưu trong Raft log, chỉ giải mã khi mount vào container** trên node đang chạy task đó — an toàn hơn nhiều so với để password trần trong `environment:`.

```bash
echo "my_secret_password" | docker secret create db_password -
docker secret ls
```

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
    external: true     # đã tạo từ trước bằng `docker secret create`
```

### 12.2. Configs — giống Secret nhưng cho dữ liệu KHÔNG nhạy cảm

Dùng cho file cấu hình (nginx.conf, app config...) cần đồng bộ qua nhiều node, không cần mã hóa như Secret nhưng vẫn quản lý tập trung qua Swarm.

```bash
docker config create nginx_conf ./nginx.conf
```

```yaml
services:
  web:
    image: nginx
    configs:
      - source: nginx_conf
        target: /etc/nginx/nginx.conf

configs:
  nginx_conf:
    external: true
```

### 12.3. Đặc điểm quan trọng: Secret/Config là **immutable**

Không thể "sửa" 1 secret/config đã tạo — phải tạo bản mới với tên khác (vd: `db_password_v2`), rồi update service để dùng bản mới, sau đó xóa bản cũ.

---

## 13. Swarm CLI — Lệnh Quan Trọng

```bash
# === CLUSTER LIFECYCLE ===
docker swarm init --advertise-addr <IP_MANAGER>      # Tạo cluster, máy hiện tại thành Manager đầu tiên
docker swarm join-token worker                        # Lấy lệnh join cho Worker
docker swarm join-token manager                        # Lấy lệnh join cho Manager
docker swarm leave                                      # Rời cluster (chạy trên node muốn rời)
docker swarm leave --force                              # Manager cuối cùng rời (phá cluster)

# === NODE MANAGEMENT ===
docker node ls                                          # Danh sách node trong cluster
docker node inspect self --pretty                        # Thông tin node hiện tại
docker node update --availability drain <node>            # Rút hết task khỏi node (để maintenance)
docker node update --availability active <node>           # Đưa node hoạt động trở lại
docker node update --label-add zone=us-east <node>         # Gắn label cho node
docker node promote <node>                                  # Worker -> Manager
docker node demote <node>                                    # Manager -> Worker
docker node rm <node>                                         # Xóa node đã leave khỏi danh sách

# === SERVICE MANAGEMENT ===
docker service create --name web --replicas 3 -p 8080:80 nginx
docker service ls
docker service ps web                  # Xem các Task của service, đang chạy ở node nào
docker service inspect web --pretty
docker service logs -f web
docker service scale web=5
docker service update --image nginx:1.27-alpine web
docker service update --force web      # Buộc tái tạo lại toàn bộ task (vd: để pick up secret mới)
docker service rollback web
docker service rm web

# === STACK MANAGEMENT ===
docker stack deploy -c compose.yaml mystack
docker stack ls
docker stack services mystack
docker stack ps mystack
docker stack rm mystack

# === SECRET / CONFIG ===
docker secret create db_pass -
docker secret ls
docker config create app_conf ./app.conf
docker config ls

# === NETWORK ===
docker network create --driver overlay --attachable my_net
docker network ls
docker network inspect my_net
```

---

## 14. Best Practices Production

1. **Luôn dùng số Manager lẻ** (3 hoặc 5), đặt ở các availability zone/datacenter khác nhau nếu có thể.
2. **Build & push image lên registry trước khi `stack deploy`** — `build:` không hoạt động trong Stack.
3. **Đừng chạy stateful service (DB) tự do trên Swarm** mà không có chiến lược storage rõ ràng (placement constraint cố định node, hoặc dùng managed DB ngoài cluster).
4. **Dùng `order: start-first`** cho update_config khi cần zero-downtime thật, đảm bảo có healthcheck để Swarm biết khi nào container mới "healthy" trước khi xóa container cũ.
5. **Luôn cấu hình `healthcheck`** trong Dockerfile/Compose — Swarm dựa vào đó để biết task có "sống" thật hay chỉ chạy nhưng app bên trong đã treo.
6. **Dùng Secret cho mọi dữ liệu nhạy cảm**, không dùng `environment:` trần.
7. **Gắn `resources.reservations`** cho mọi service quan trọng để scheduler không đặt quá tải 1 node.
8. **Drain node trước khi maintenance** (`node update --availability drain`) để Swarm tự di task sang node khác êm ái trước khi tắt máy.
9. **Theo dõi `docker service ps` thường xuyên** sau mỗi lần update để phát hiện task restart loop sớm.
10. **Không để Manager cũng làm Worker chạy hết tải** trong cluster lớn — tách riêng vai trò nếu cluster có nhiều service nặng.
11. **Backup Raft log định kỳ** (`/var/lib/docker/swarm`) trên Manager — đây là toàn bộ "não" của cluster.

---

## LAB 1 — Khởi Tạo Cluster & Service Cơ Bản (Single → Multi-node)

### Mục tiêu (bao quát)
Khởi tạo Swarm cluster nhiều node (mô phỏng bằng nhiều container Docker-in-Docker hoặc nhiều VM/máy thật), tạo Service ở cả 2 mode (Replicated & Global), quan sát Routing Mesh, self-healing khi container chết, scale, và export thông tin qua `docker service inspect`/`ps`.

### Kịch bản
Bạn có 3 máy (trong lab này mô phỏng bằng 3 VM hoặc 3 máy thật trong cùng mạng LAN — Swarm **không** mô phỏng tốt bằng nhiều container trên 1 máy do giới hạn network, nên lab dùng multipass/VM hoặc 3 máy thật là chính xác nhất). Nếu chỉ có 1 máy để học, vẫn thực hiện được toàn bộ phần `docker service` ở chế độ **single-node Swarm**.

### Bước 1 — Khởi tạo Manager đầu tiên

```bash
# Trên máy sẽ làm Manager
docker swarm init --advertise-addr <IP_CUA_MAY_NAY>

# Output sẽ có sẵn lệnh join cho Worker, ví dụ:
# docker swarm join --token SWMTKN-1-xxxxx <IP_MANAGER>:2377
```

### Bước 2 — Thêm Worker (nếu có nhiều máy)

```bash
# Lấy lại token join nếu cần
docker swarm join-token worker

# Chạy trên máy Worker
docker swarm join --token SWMTKN-1-xxxxx <IP_MANAGER>:2377
```

### Bước 3 — Thêm Manager thứ 2, thứ 3 (cho HA thật)

```bash
docker swarm join-token manager
# Chạy lệnh trả về trên 2 máy khác để có tổng 3 Manager
```

### Bước 4 — Kiểm tra cluster

```bash
docker node ls
# ID   HOSTNAME   STATUS   AVAILABILITY   MANAGER STATUS
# ...  manager1   Ready    Active         Leader
# ...  manager2   Ready    Active         Reachable
# ...  worker1    Ready    Active
```

### Bước 5 — Tạo Replicated Service + quan sát Routing Mesh

```bash
docker service create \
  --name web \
  --replicas 3 \
  --publish published=8080,target=80 \
  nginx:1.27-alpine

docker service ps web        # xem 3 task chạy ở node nào
```

Gọi thử **từ MỌI node** trong cluster (kể cả node không có container nào của `web`) — đều phải nhận được response 200 (đây chính là Routing Mesh):

```bash
curl http://<IP_MANAGER>:8080
curl http://<IP_WORKER1>:8080      # vẫn ra response dù worker1 không chạy container nào
```

### Bước 6 — Tạo Global Service (1 container/node)

```bash
docker service create --name agent --mode global alpine sleep infinity
docker service ps agent      # số task = số node trong cluster, tự động
```

### Bước 7 — Test Self-healing

```bash
# Tìm container ID của 1 task "web" đang chạy ở node nào đó, rồi giả lập crash
docker service ps web
# Trên node đang chạy task đó:
docker rm -f <container_id_cua_task>

# Quan sát Swarm TỰ TẠO task mới thay thế ngay lập tức
docker service ps web
```

### Bước 8 — Scale & inspect

```bash
docker service scale web=6
docker service inspect web --pretty
docker service logs web --tail 20
```

### Bài tập mở rộng
1. Drain 1 node (`docker node update --availability drain <node>`), quan sát toàn bộ task của node đó tự di chuyển sang node khác.
2. So sánh `--publish mode=ingress` (mặc định) vs `mode=host` — publish lại service với `mode=host` và quan sát chỉ node thật sự chạy container mới response.
3. Promote 1 Worker thành Manager (`docker node promote`), kiểm tra `docker node ls` thấy MANAGER STATUS mới xuất hiện.

---

## LAB 2 — Stack Full: Web + API + DB + Routing Mesh + Secrets

### Mục tiêu (bao quát)
Triển khai 1 Stack hoàn chỉnh (Nginx + API + Postgres) bằng `docker stack deploy`, dùng **Secrets** cho password DB, **Overlay network**, **Placement constraint** ép DB chạy đúng 1 node có label cố định, healthcheck, và resource limits — gói toàn bộ kỹ thuật cốt lõi của Swarm Stack vào 1 lab.

### Kịch bản
Hệ thống "Task API" — Nginx làm reverse proxy (3 replicas, routing mesh tự load-balance), API Node.js (4 replicas), Postgres (1 replica, cố định ở node có label `db-node=true` để dữ liệu không bị "thất lạc" khi container di chuyển).

### Cấu trúc thư mục

```
lab2-swarm-stack/
├── compose.yaml
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
└── nginx/
    └── default.conf
```

### `api/server.js`

```javascript
const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');

const app = express();
app.use(express.json());

// Đọc password từ Swarm Secret (file mount tại /run/secrets/)
const dbPassword = fs.readFileSync('/run/secrets/db_password', 'utf8').trim();

const pool = new Pool({
  host: 'db',
  user: 'taskuser',
  password: dbPassword,
  database: 'taskdb',
});

app.get('/health', (req, res) => res.json({ status: 'ok', hostname: process.env.HOSTNAME }));

app.get('/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id DESC');
    res.json({ served_by: process.env.HOSTNAME, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/tasks', async (req, res) => {
  const { title } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO tasks (title) VALUES ($1) RETURNING *', [title]
  );
  res.status(201).json(rows[0]);
});

async function init() {
  let retries = 15;
  while (retries) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY, title VARCHAR(255), created_at TIMESTAMP DEFAULT NOW()
      );`);
      console.log('DB ready');
      return;
    } catch (err) {
      console.log('Waiting for DB...', err.message);
      retries--;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw new Error('DB never became ready');
}

init().then(() => app.listen(3000, () => console.log('API on 3000')));
```

### `api/package.json` & `api/Dockerfile`

```json
{
  "name": "lab2-api",
  "dependencies": { "express": "^4.19.2", "pg": "^8.11.5" }
}
```

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### `nginx/default.conf`

```nginx
upstream api_upstream {
    server api:3000;     # "api" = tên service, Swarm DNS tự load-balance qua VIP
}
server {
    listen 80;
    location /api/ {
        rewrite ^/api/(.*)$ /$1 break;
        proxy_pass http://api_upstream;
    }
    location /lb-test {
        default_type text/plain;
        return 200 "Served by Nginx replica\n";
    }
}
```

### `compose.yaml` (dùng cho `docker stack deploy`)

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports:
      - "8080:80"
    configs:
      - source: nginx_conf
        target: /etc/nginx/conf.d/default.conf
    networks:
      - app_net
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 5s
        order: start-first
      restart_policy:
        condition: on-failure

  api:
    image: lab2-api:1.0.0          # image phải build & có sẵn local hoặc đã push registry TRƯỚC khi deploy
    networks:
      - app_net
    secrets:
      - db_password
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 10s
      timeout: 3s
      retries: 3
    deploy:
      replicas: 4
      update_config:
        parallelism: 2
        delay: 10s
        order: start-first
        failure_action: rollback
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
        reservations:
          memory: 128M
      restart_policy:
        condition: on-failure
        max_attempts: 3

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: taskdb
      POSTGRES_USER: taskuser
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - db_data:/var/lib/postgresql/data
    networks:
      - app_net
    deploy:
      replicas: 1                          # DB chỉ 1 bản — KHÔNG scale DB không có replication thật
      placement:
        constraints:
          - node.labels.db-node == true    # luôn chạy đúng node này -> volume không "thất lạc"
      restart_policy:
        condition: on-failure

networks:
  app_net:
    driver: overlay

volumes:
  db_data:

secrets:
  db_password:
    external: true     # tạo TRƯỚC bằng `docker secret create`

configs:
  nginx_conf:
    external: true      # tạo TRƯỚC bằng `docker config create`
```

### Chạy lab — quy trình đầy đủ (đây là điểm khác biệt lớn nhất so với Compose thường)

```bash
# 1. Build image trước (Stack KHÔNG tự build)
cd lab2-swarm-stack
docker build -t lab2-api:1.0.0 ./api

# 2. Gắn label cho node sẽ chạy DB
docker node update --label-add db-node=true $(docker node ls --format '{{.Hostname}}' | head -1)

# 3. Tạo Secret & Config TRƯỚC khi deploy stack (vì compose.yaml khai báo external: true)
echo "taskpass123" | docker secret create db_password -
docker config create nginx_conf ./nginx/default.conf

# 4. Deploy stack
docker stack deploy -c compose.yaml taskstack

# 5. Kiểm tra
docker stack services taskstack
docker stack ps taskstack
```

### Kiểm tra end-to-end

```bash
curl http://localhost:8080/lb-test
curl -X POST http://localhost:8080/api/tasks -H "Content-Type: application/json" -d '{"title":"Hoc Swarm"}'
curl http://localhost:8080/api/tasks
```

### Bài tập mở rộng
1. `docker service update --image lab2-api:1.1.0 taskstack_api` sau khi build version mới — quan sát rolling update theo `parallelism: 2, order: start-first`.
2. Thử xóa label `db-node` khỏi node đang chạy DB rồi `docker service update --force taskstack_db` — quan sát Swarm **không tìm được node hợp lệ** và task ở trạng thái "Pending" (minh chứng rõ vai trò Placement Constraint).
3. Đổi `db_password` Secret: tạo `db_password_v2`, update service `api` và `db` để dùng secret mới, sau đó xóa secret cũ — thực hành quy trình "immutable secret rotation".

---

## LAB 3 — Rolling Update, Rollback & Placement Constraints

### Mục tiêu (bao quát)
Tập trung sâu vào vòng đời update: deploy version có lỗi → tự rollback (`failure_action: rollback`), so sánh `stop-first` vs `start-first`, và dùng `preferences: spread` để rải container theo "zone" giả lập.

### Kịch bản
Service `app` có healthcheck nghiêm ngặt. Bạn cố tình deploy 1 version "lỗi" (health check luôn fail) để quan sát Swarm tự phát hiện và rollback, sau đó deploy version đúng và quan sát rolling update zero-downtime.

### `app/server.js` (dùng biến môi trường để giả lập version lỗi)

```javascript
const express = require('express');
const app = express();

const VERSION = process.env.APP_VERSION || '1.0.0';
const SIMULATE_BROKEN = process.env.SIMULATE_BROKEN === 'true';

app.get('/', (req, res) => {
  res.json({ version: VERSION, hostname: process.env.HOSTNAME });
});

app.get('/health', (req, res) => {
  if (SIMULATE_BROKEN) {
    return res.status(500).send('Unhealthy (simulated)');
  }
  res.status(200).send('OK');
});

app.listen(3000, () => console.log(`App v${VERSION} listening, broken=${SIMULATE_BROKEN}`));
```

### `app/Dockerfile`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### `compose.yaml`

```yaml
services:
  app:
    image: lab3-app:1.0.0
    environment:
      APP_VERSION: "1.0.0"
      SIMULATE_BROKEN: "false"
    ports:
      - "8081:3000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 5s
      timeout: 3s
      retries: 2
      start_period: 5s
    networks:
      - app_net
    deploy:
      replicas: 4
      placement:
        preferences:
          - spread: node.labels.zone     # rải đều theo zone (label giả lập dưới đây)
      update_config:
        parallelism: 1
        delay: 8s
        order: start-first
        failure_action: rollback
        monitor: 15s
        max_failure_ratio: 0.25
      restart_policy:
        condition: on-failure

networks:
  app_net:
    driver: overlay
```

### Chạy lab

```bash
# Giả lập zone cho từng node (chạy trên Manager, áp dụng cho node thật trong cluster bạn có)
docker node update --label-add zone=zone-a node1
docker node update --label-add zone=zone-b node2
docker node update --label-add zone=zone-a node3

# Build & deploy version đầu (lành mạnh)
docker build -t lab3-app:1.0.0 ./app
docker stack deploy -c compose.yaml updatestack
docker stack ps updatestack       # quan sát rải theo zone qua preference "spread"
```

### Test rolling update THÀNH CÔNG (start-first, zero-downtime)

```bash
# Sửa code, build version 1.1.0 (health check vẫn pass)
docker build -t lab3-app:1.1.0 ./app
docker service update --image lab3-app:1.1.0 --env-add APP_VERSION=1.1.0 updatestack_app

# Trong lúc update đang chạy, gọi liên tục để kiểm tra ZERO downtime:
while true; do curl -s http://localhost:8081/ | grep version; sleep 0.5; done
```

### Test rolling update THẤT BẠI → tự rollback

```bash
# Deploy version "lỗi" — health check luôn fail
docker service update --env-add SIMULATE_BROKEN=true --env-add APP_VERSION=1.2.0-broken updatestack_app

# Quan sát: Swarm cố update, phát hiện health check fail vượt max_failure_ratio,
# TỰ ĐỘNG rollback về version 1.1.0 lành mạnh
docker service ps updatestack_app     # xem cột "CURRENT STATE" / "ERROR"
docker service inspect updatestack_app --pretty | grep -A 5 "RollbackConfig\|Previous"
```

### Rollback thủ công (nếu auto-rollback không kích hoạt vì lỗi không liên quan healthcheck)

```bash
docker service rollback updatestack_app
```

### Bài tập mở rộng
1. Đổi `order: start-first` thành `order: stop-first`, lặp lại test rolling update lành mạnh — quan sát có khoảnh khắc số response giảm tạm thời (downtime ngắn) khác với `start-first`.
2. Tăng `max_failure_ratio` lên `1.0` (cho phép 100% fail) rồi deploy version lỗi — quan sát Swarm **không tự rollback** (vì điều kiện rollback không bị vi phạm) — hiểu rõ ý nghĩa thực sự của tham số này.
3. Thử `docker service update --rollback` (cú pháp cũ, tương đương `docker service rollback`) để so sánh.

---

## LAB 4 — High Availability: Mất Node, Failover & Visualizer

### Mục tiêu (bao quát)
Quan sát trực quan toàn bộ cluster bằng Visualizer (Swarmpit-style UI đơn giản), rồi thực hiện kịch bản **mất Manager** và **mất Worker** để hiểu rõ Quorum, self-healing, và giới hạn của Swarm khi mất quá nhiều Manager.

### Kịch bản
Cluster 3 Manager + 2 Worker, chạy 1 Service quan trọng (6 replicas). Bạn cố tình dừng lần lượt: 1 Worker, rồi 1 Manager (follower), rồi thử dừng tiếp Manager thứ 2 để **chứng kiến mất quorum**.

### Bước 1 — Deploy Visualizer (xem trực quan task chạy ở node nào)

```bash
docker service create \
  --name=viz \
  --publish=8000:8080 \
  --constraint=node.role==manager \
  --mount=type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
  dockersamples/visualizer
```

Mở `http://<IP_MANAGER>:8000` để xem sơ đồ node + container realtime trong suốt lab.

### Bước 2 — Deploy Service quan trọng để theo dõi

```bash
docker service create \
  --name critical-app \
  --replicas 6 \
  --publish published=9090,target=80 \
  --restart-condition on-failure \
  nginx:1.27-alpine

docker service ps critical-app
```

### Bước 3 — Kịch bản mất 1 Worker

```bash
# Trên Worker muốn dừng (mô phỏng máy chết đột ngột)
sudo systemctl stop docker      # hoặc tắt máy/VM thật

# Trên Manager — quan sát
docker node ls                  # node đó chuyển trạng thái "Down"
docker service ps critical-app  # task cũ ở node chết -> "Shutdown", task MỚI tự tạo ở node khác
```

→ **Kết quả mong đợi:** Service vẫn đủ 6 replica đang chạy (rải lại qua node còn sống), gần như không downtime vì còn dư node.

### Bước 4 — Kịch bản mất 1 Manager (follower, không phải Leader)

```bash
docker node ls       # xác định Manager nào là "Reachable" (follower), không phải "Leader"

# Dừng follower đó
sudo systemctl stop docker

docker node ls        # trên Manager còn sống: follower đó -> "Unreachable"
docker service ps critical-app   # container vẫn chạy bình thường — KHÔNG bị ảnh hưởng
```

→ **Kết quả mong đợi:** Vì còn 2/3 Manager sống = vẫn còn quorum (đa số) → cluster vẫn nhận lệnh mới bình thường.

```bash
# Thử tạo service mới để xác nhận cluster vẫn "ghi" được
docker service create --name test-after-1-manager-down --replicas 1 alpine sleep 3600
# -> THÀNH CÔNG
```

### Bước 5 — Kịch bản mất QUORUM (dừng tiếp Manager thứ 2 → chỉ còn 1/3 Manager)

```bash
# Dừng tiếp Manager thứ 2 (giờ chỉ còn 1 Manager sống / 3)
sudo systemctl stop docker     # trên Manager thứ 2

# Trên Manager còn sống cuối cùng:
docker node ls                  # vẫn xem được danh sách (read cache local)
docker service create --name test-no-quorum --replicas 1 alpine sleep 3600
# -> LỖI hoặc TREO: "Error response from daemon: rpc error: ... context deadline exceeded"
```

→ **Kết quả mong đợi:** **MẤT QUORUM** (chỉ 1/3 Manager, cần tối thiểu 2/3 để có đa số) — cluster vào trạng thái **read-only thật sự**: container đang chạy (`critical-app`) **vẫn tiếp tục chạy** (không bị kill), nhưng **không thể tạo/sửa service mới nào** cho tới khi khôi phục đủ quorum.

### Bước 6 — Khôi phục quorum

```bash
# Khởi động lại Docker trên các Manager đã dừng
sudo systemctl start docker
# Chúng tự rejoin cluster (Raft state vẫn còn nếu không xóa /var/lib/docker/swarm)

docker node ls       # xác nhận đủ 3 Manager "Reachable"/"Leader" trở lại
docker service create --name test-quorum-restored --replicas 1 alpine sleep 3600
# -> THÀNH CÔNG trở lại
```

### Dọn dẹp sau lab

```bash
docker service rm critical-app viz test-after-1-manager-down test-quorum-restored
```

### Bài tập mở rộng
1. Lặp lại Bước 4-5 nhưng với cluster 5 Manager — xác nhận chịu được mất **2** Manager (so với chỉ 1 ở cluster 3 Manager), minh chứng công thức quorum ở mục 2.3.
2. Trong lúc mất quorum (Bước 5), thử `docker service scale critical-app=10` — quan sát hành vi (treo/lỗi) khác gì so với chỉ "tạo service mới".
3. Tìm hiểu và thử khôi phục cluster từ tình huống **mất TẤT CẢ Manager** (`docker swarm init --force-new-cluster` chạy trên 1 node còn Raft data cũ) — đây là kịch bản disaster recovery thực tế cần biết.

---

## 19. Troubleshooting Thường Gặp

| Vấn đề | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `docker stack deploy` không build image, báo lỗi "image not found" | `build:` không hoạt động với Stack | Build & push image lên registry (hoặc build local + đảm bảo mọi node đều có image đó) trước khi deploy |
| Service mãi ở trạng thái "Pending", không bao giờ chạy | Không có node nào thỏa `placement.constraints`, hoặc thiếu `resources.reservations` | `docker service ps <svc> --no-trunc` xem lý do, `docker node ls` kiểm tra label/role |
| Task cứ bị tạo mới liên tục (restart loop) | Container crash ngay lúc start (thiếu env, sai healthcheck), hoặc `restart_policy` quá nhạy | `docker service logs <svc>`, tạm bỏ healthcheck để debug riêng container |
| Volume mất dữ liệu sau khi service "tự di chuyển" sang node khác | Named volume `local` driver không theo container qua node | Thêm `placement.constraints` cố định node, hoặc dùng volume driver hỗ trợ network storage |
| `docker service update` xong nhưng không thấy gì đổi | Image tag không đổi (Docker không pull lại nếu tag giống và đã có local) → dùng `--force` hoặc tag version mới | `docker service update --force <svc>`, hoặc luôn tag theo version cụ thể, không dùng `latest` |
| Không tạo được service mới / lệnh bị treo | Cluster mất quorum (đa số Manager chết) | Khôi phục đủ Manager sống, hoặc `--force-new-cluster` nếu mất hết Manager (disaster recovery) |
| `depends_on` trong Stack không có tác dụng | Swarm bỏ qua hoàn toàn `depends_on` | Tự viết retry-connect logic trong code app (kết nối DB/queue với retry loop) |
| Gọi vào 1 node cụ thể nhưng không ra response, dù `docker service ps` thấy task chạy | Publish ở `mode=host` mà gọi nhằm node không chạy container đó | Dùng `mode=ingress` (mặc định) nếu muốn gọi node bất kỳ đều route đúng |
| Secret/Config "external: true" báo lỗi không tìm thấy | Chưa `docker secret create`/`docker config create` trước khi `stack deploy` | Tạo secret/config trước, đúng thứ tự như Lab 2 |
| Node ở trạng thái "Down" mãi không hồi phục dù máy đã online lại | Daemon Docker trên node đó chưa start lại, hoặc node đã bị `docker node rm` | `systemctl start docker` trên node, hoặc `docker swarm join` lại nếu đã bị xóa khỏi cluster |

---

## 20. Cheat Sheet Tổng Hợp

```bash
# === CLUSTER ===
docker swarm init --advertise-addr <IP>
docker swarm join-token worker
docker swarm join-token manager
docker swarm leave / docker swarm leave --force
docker swarm init --force-new-cluster      # disaster recovery khi mất hết Manager

# === NODE ===
docker node ls
docker node update --availability drain|active|pause <node>
docker node update --label-add key=value <node>
docker node promote <node>   |   docker node demote <node>
docker node rm <node>

# === SERVICE ===
docker service create --name X --replicas N -p PUB:TARGET IMAGE
docker service create --name X --mode global IMAGE
docker service ls
docker service ps X --no-trunc
docker service inspect X --pretty
docker service logs -f X
docker service scale X=N
docker service update --image IMAGE:TAG X
docker service update --env-add K=V --force X
docker service rollback X
docker service rm X

# === STACK ===
docker stack deploy -c compose.yaml NAME
docker stack services NAME
docker stack ps NAME
docker stack rm NAME

# === SECRET / CONFIG ===
echo "value" | docker secret create NAME -
docker secret ls / docker secret rm NAME
docker config create NAME ./file
docker config ls / docker config rm NAME

# === NETWORK ===
docker network create --driver overlay --attachable NAME
docker network ls
```

### Quy tắc vàng cần nhớ

1. **Số Manager luôn là số lẻ** (3 hoặc 5) — chịu mất `(N-1)/2` Manager mà vẫn còn quorum.
2. **`build:` không hoạt động trong Stack** — luôn build & có sẵn image (registry hoặc mọi node) trước khi `stack deploy`.
3. **`depends_on` bị Swarm bỏ qua hoàn toàn** — tự viết retry-connect trong code.
4. **Service ≠ Container** — bạn khai báo "mong muốn", Swarm scheduler tự lo phần còn lại; Task chết thì tạo Task MỚI, không "hồi sinh" task cũ.
5. **Volume `local` không tự theo container qua node** — DB/dữ liệu quan trọng cần `placement.constraints` cố định hoặc network storage.
6. **Routing Mesh (`mode=ingress`)** cho phép gọi vào BẤT KỲ node nào trong cluster đều ra đúng service — không cần biết container chạy ở đâu.
7. **`order: start-first`** = zero-downtime thật (tạo mới trước, healthy rồi mới xóa cũ); **`stop-first`** = có khoảng downtime ngắn.
8. **Mất quorum** = cluster read-only (container cũ vẫn chạy, không tạo/sửa được gì mới) — KHÔNG phải toàn cluster sập.
9. Secret/Config là **immutable** — đổi giá trị phải tạo bản mới, update service dùng bản mới, rồi xóa bản cũ.

---

*Hết tài liệu — chúc bạn thực hành Docker Swarm hiệu quả!*
