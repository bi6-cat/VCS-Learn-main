# RabbitMQ — Cấu Hình & Cluster (Bổ Sung Weekly Report)

> Tài liệu bổ sung cho phần yêu cầu: cấu hình user/pass quản trị, cấu hình port listen, file log, cấu hình cluster, triển khai trong Docker Compose, và demo minh chứng.

---

## Mục Lục

1. [Cấu Hình User & Password Quản Trị](#1-cấu-hình-user--password-quản-trị)
2. [Cấu Hình Port Listen](#2-cấu-hình-port-listen)
3. [File Log](#3-file-log)
4. [Cấu Hình Cluster](#4-cấu-hình-cluster)
5. [Triển Khai Toàn Bộ Trong Docker Compose](#5-triển-khai-toàn-bộ-trong-docker-compose)
6. [Demo — Checklist Minh Chứng](#6-demo--checklist-minh-chứng)

---

## 1. Cấu Hình User & Password Quản Trị

### 1.1. Vấn đề với user mặc định

RabbitMQ image mặc định tạo sẵn user `guest`/`guest`, nhưng user này **chỉ được phép đăng nhập từ localhost** (giới hạn bảo mật cứng trong RabbitMQ, không phải do Docker). Khi expose ra ngoài hoặc dùng trong môi trường nhiều người truy cập, cần tạo user quản trị riêng và nên xóa `guest`.

### 1.2. Tạo user qua biến môi trường (lúc container khởi tạo lần đầu)

Đây là cách đơn giản nhất khi dùng Docker — chỉ áp dụng cho **lần khởi tạo đầu tiên** (khi chưa có data trong volume):

```yaml
environment:
  RABBITMQ_DEFAULT_USER: admin
  RABBITMQ_DEFAULT_PASS: Admin@123456
  RABBITMQ_DEFAULT_VHOST: /
```

> Lưu ý: nếu volume đã có dữ liệu cũ (đã từng khởi tạo trước đó), 2 biến này **không có tác dụng** nữa — vì RabbitMQ chỉ đọc biến này khi Mnesia database (nơi lưu user/permission) còn trống.

### 1.3. Tạo/sửa user bằng `rabbitmqctl` (áp dụng mọi lúc, kể cả sau khi đã chạy)

```bash
# Tạo user mới
docker exec -it rabbitmq rabbitmqctl add_user admin Admin@123456

# Gán quyền administrator (full quyền quản trị qua Management UI + CLI)
docker exec -it rabbitmq rabbitmqctl set_user_tags admin administrator

# Cấp quyền truy cập vhost "/" — 3 tham số là regex cho: configure, write, read
docker exec -it rabbitmq rabbitmqctl set_permissions -p / admin ".*" ".*" ".*"

# Đổi password user đã tồn tại
docker exec -it rabbitmq rabbitmqctl change_password admin NewPass@123

# Xóa user guest mặc định (khuyến nghị khi expose ra production)
docker exec -it rabbitmq rabbitmqctl delete_user guest
```

### 1.4. Các loại tag (quyền) quan trọng

| Tag | Quyền |
|---|---|
| `administrator` | Toàn quyền: tạo user, vhost, xem mọi node, mọi cấu hình |
| `monitoring` | Chỉ xem metrics, không sửa được cấu hình |
| `management` | Đăng nhập Management UI, quản lý queue/exchange của vhost được cấp quyền, không quản lý được user/node |
| (không tag) | Chỉ dùng được qua AMQP client (code), không đăng nhập được Management UI |

### 1.5. Kiểm tra user đã tạo

```bash
docker exec -it rabbitmq rabbitmqctl list_users
docker exec -it rabbitmq rabbitmqctl list_permissions -p /
```

---

## 2. Cấu Hình Port Listen

### 2.1. Bảng port quan trọng của RabbitMQ

| Port | Chức năng | Bắt buộc expose? |
|---|---|---|
| `5672` | AMQP — port chính cho producer/consumer kết nối publish/consume | Có (port chính dùng để giao tiếp) |
| `5671` | AMQP qua TLS (AMQPS) | Chỉ khi dùng SSL/TLS |
| `15672` | Management UI (HTTP) + HTTP API | Có nếu cần dùng giao diện web quản trị |
| `15671` | Management UI qua HTTPS | Chỉ khi dùng SSL/TLS |
| `25672` | Giao tiếp nội bộ giữa các node trong Cluster (Erlang distribution) | Chỉ cần mở **nội bộ giữa các node**, KHÔNG expose ra internet |
| `4369` | `epmd` (Erlang Port Mapper Daemon) — giúp các node Erlang tìm thấy nhau khi join cluster | Chỉ cần mở nội bộ giữa các node |
| `35672-35682` | Dải port dùng cho CLI tool (`rabbitmqctl`) kết nối tới node qua Erlang khi debug từ xa | Tùy nhu cầu, thường không cần mở ra ngoài |
| `1883` / `8883` | MQTT plugin (nếu bật) | Chỉ khi dùng MQTT |
| `61613` / `61614` | STOMP plugin (nếu bật) | Chỉ khi dùng STOMP |

### 2.2. Cấu hình đổi port qua `rabbitmq.conf`

Mặc định RabbitMQ dùng các port ở bảng trên. Muốn đổi (ví dụ tránh trùng port với service khác trên host), tạo file `rabbitmq.conf`:

```ini
# rabbitmq.conf
listeners.tcp.default = 5672
management.tcp.port = 15672

# Nếu muốn chỉ định rõ địa chỉ IP lắng nghe (mặc định 0.0.0.0 - mọi interface)
listeners.tcp.local = 127.0.0.1:5672
```

### 2.3. Mount file config vào container

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    volumes:
      - ./rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
```

### 2.4. Map port ra host trong Docker Compose

```yaml
ports:
  - "5672:5672"      # AMQP
  - "15672:15672"    # Management UI
  # KHÔNG map 25672 và 4369 ra host nếu không cần truy cập từ ngoài — chỉ cần cùng network nội bộ giữa các node cluster
```

### 2.5. Kiểm tra port đang listen

```bash
docker exec -it rabbitmq rabbitmq-diagnostics listeners
# hoặc kiểm tra từ host
netstat -tulnp | grep -E '5672|15672'
ss -tulnp | grep -E '5672|15672'
```

---

## 3. File Log

### 3.1. Vị trí log mặc định trong container

```
/var/log/rabbitmq/rabbit@<hostname>.log         # log chính (startup, error, warning)
/var/log/rabbitmq/rabbit@<hostname>_upgrade.log # log liên quan upgrade version
```

### 3.2. Xem log nhanh qua Docker

```bash
docker logs -f rabbitmq                    # log stdout (RabbitMQ mặc định cũng ghi ra console)
docker exec -it rabbitmq cat /var/log/rabbitmq/rabbit@$(hostname).log
```

### 3.3. Cấu hình log qua `rabbitmq.conf`

```ini
# rabbitmq.conf

# Ghi log ra cả file và console (mặc định image Docker đã bật console)
log.console = true
log.console.level = info        # debug | info | warning | error

# Ghi log ra file riêng
log.file = /var/log/rabbitmq/rabbit.log
log.file.level = info

# Xoay vòng log (tránh phình file vô hạn)
log.file.rotation.date = $D0
log.file.rotation.size = 10485760    # 10MB
log.file.rotation.count = 5
```

### 3.4. Mount volume để log không mất khi container bị xóa

```yaml
services:
  rabbitmq:
    volumes:
      - rabbitmq_logs:/var/log/rabbitmq

volumes:
  rabbitmq_logs:
```

### 3.5. Đẩy log ra ngoài để xem trực tiếp trên host (bind mount)

```yaml
volumes:
  - ./logs/rabbitmq:/var/log/rabbitmq
```

```bash
tail -f ./logs/rabbitmq/rabbit@*.log
```

### 3.6. Cấu hình mức log (log level) phù hợp môi trường

| Level | Khi dùng |
|---|---|
| `debug` | Môi trường dev, đang troubleshoot lỗi chi tiết |
| `info` | Mặc định khuyến nghị — đủ thông tin vận hành, không quá nhiều |
| `warning` | Production ổn định, chỉ muốn thấy cảnh báo + lỗi |
| `error` | Chỉ log lỗi nghiêm trọng (ít dùng vì bỏ lỡ nhiều thông tin vận hành hữu ích) |

---

## 4. Cấu Hình Cluster

### 4.1. Khái niệm cluster (nhắc lại ngắn gọn)

Nhiều node RabbitMQ liên kết với nhau, chia sẻ metadata (exchange, binding, user, permission, vhost) — giúp hệ thống chịu lỗi (chết 1 node, node khác vẫn phục vụ) và tăng khả năng xử lý.

> **Điều kiện bắt buộc để join cluster:** tất cả node phải dùng **cùng 1 file `.erlang.cookie`** — đây là "chìa khóa" để các node Erlang VM (RabbitMQ chạy trên nền Erlang) tin tưởng và giao tiếp với nhau.

### 4.2. Các bước cấu hình cluster (tổng quát, áp dụng cho cả VM thật và Docker)

```bash
# Bước 1: Đảm bảo file cookie giống nhau trên mọi node
cat /var/lib/rabbitmq/.erlang.cookie     # phải in ra cùng 1 giá trị trên mọi node

# Bước 2: Trên node thứ 2, 3... — dừng app, join vào node đầu tiên, khởi động lại app
rabbitmqctl stop_app
rabbitmqctl join_cluster rabbit@<hostname_node_dau_tien>
rabbitmqctl start_app

# Bước 3: Kiểm tra trạng thái cluster
rabbitmqctl cluster_status
```

### 4.3. Cấu hình Quorum Queue (khuyến nghị cho HA thật trong cluster)

Quorum Queue dùng thuật toán Raft để replicate dữ liệu queue qua nhiều node — nếu node đang giữ queue chết, node khác tự bầu lên thay thế, **không mất message**.

```python
channel.queue_declare(
    queue='orders',
    durable=True,
    arguments={'x-queue-type': 'quorum'}
)
```

```bash
# Kiểm tra queue đang có leader ở node nào, replicate tới những node nào
rabbitmqctl list_queues name type leader members
```

### 4.4. Cấu hình tự động join cluster (`cluster_formation`) — không cần chạy tay từng lệnh

Thay vì `join_cluster` thủ công, có thể cấu hình tự động qua `rabbitmq.conf`:

```ini
# rabbitmq.conf (trên node thứ 2, 3...)
cluster_formation.peer_discovery_backend = classic_config
cluster_formation.classic_config.nodes.1 = rabbit@rabbit1
cluster_formation.classic_config.nodes.2 = rabbit@rabbit2
cluster_formation.classic_config.nodes.3 = rabbit@rabbit3
```

> Với môi trường Kubernetes/cloud, thường dùng `peer_discovery_backend = k8s` hoặc `aws` — tự động tìm node qua API platform, không cần khai báo tay từng hostname.

---

## 5. Triển Khai Toàn Bộ Trong Docker Compose

### 5.1. Cấu trúc thư mục

```
rabbitmq-deploy/
├── compose.yaml
├── .erlang.cookie
├── rabbit1/
│   └── rabbitmq.conf
├── rabbit2/
│   └── rabbitmq.conf
├── rabbit3/
│   └── rabbitmq.conf
└── logs/
    ├── rabbit1/
    ├── rabbit2/
    └── rabbit3/
```

### 5.2. `.erlang.cookie` — dùng chung cho cả 3 node

```
WEEKLYREPORTCLUSTERCOOKIE2026
```

### 5.3. `rabbit1/rabbitmq.conf` (node đầu tiên — node khởi tạo cluster)

```ini
# ===== Port listen =====
listeners.tcp.default = 5672
management.tcp.port = 15672

# ===== Log =====
log.console = true
log.console.level = info
log.file = /var/log/rabbitmq/rabbit.log
log.file.level = info
log.file.rotation.size = 10485760
log.file.rotation.count = 5
```

### 5.4. `rabbit2/rabbitmq.conf` và `rabbit3/rabbitmq.conf` — giống `rabbit1` + thêm auto-join cluster

```ini
# ===== Port listen =====
listeners.tcp.default = 5672
management.tcp.port = 15672

# ===== Log =====
log.console = true
log.console.level = info
log.file = /var/log/rabbitmq/rabbit.log
log.file.level = info
log.file.rotation.size = 10485760
log.file.rotation.count = 5

# ===== Auto join cluster vào rabbit1 =====
cluster_formation.peer_discovery_backend = classic_config
cluster_formation.classic_config.nodes.1 = rabbit@rabbit1
```

### 5.5. `compose.yaml` — đầy đủ user/pass, port, log, cluster 3 node

```yaml
services:
  rabbit1:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit1
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: Admin@123456
      RABBITMQ_DEFAULT_VHOST: /
      RABBITMQ_ERLANG_COOKIE: "WEEKLYREPORTCLUSTERCOOKIE2026"
    volumes:
      - ./rabbit1/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./.erlang.cookie:/var/lib/rabbitmq/.erlang.cookie:ro
      - rabbit1_data:/var/lib/rabbitmq
      - ./logs/rabbit1:/var/log/rabbitmq
    ports:
      - "5672:5672"      # AMQP
      - "15672:15672"    # Management UI
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - rabbitmq_cluster_net

  rabbit2:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit2
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: Admin@123456
      RABBITMQ_ERLANG_COOKIE: "WEEKLYREPORTCLUSTERCOOKIE2026"
    volumes:
      - ./rabbit2/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./.erlang.cookie:/var/lib/rabbitmq/.erlang.cookie:ro
      - rabbit2_data:/var/lib/rabbitmq
      - ./logs/rabbit2:/var/log/rabbitmq
    ports:
      - "5673:5672"
      - "15673:15672"
    depends_on:
      rabbit1:
        condition: service_healthy
    networks:
      - rabbitmq_cluster_net

  rabbit3:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit3
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: Admin@123456
      RABBITMQ_ERLANG_COOKIE: "WEEKLYREPORTCLUSTERCOOKIE2026"
    volumes:
      - ./rabbit3/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./.erlang.cookie:/var/lib/rabbitmq/.erlang.cookie:ro
      - rabbit3_data:/var/lib/rabbitmq
      - ./logs/rabbit3:/var/log/rabbitmq
    ports:
      - "5674:5672"
      - "15674:15672"
    depends_on:
      rabbit1:
        condition: service_healthy
    networks:
      - rabbitmq_cluster_net

volumes:
  rabbit1_data:
  rabbit2_data:
  rabbit3_data:

networks:
  rabbitmq_cluster_net:
    driver: bridge
```

> **Lưu ý quan trọng về file `.erlang.cookie`:** trên Linux, file này cần permission `400` (chỉ owner đọc được) để RabbitMQ chấp nhận. Trước khi chạy `docker compose up`, nên chạy:
> ```bash
> chmod 400 .erlang.cookie
> ```

### 5.6. Chạy & join cluster

```bash
cd rabbitmq-deploy
chmod 400 .erlang.cookie
docker compose up -d

# Đợi rabbit1 healthy, rabbit2/rabbit3 tự join qua cluster_formation đã cấu hình trong rabbitmq.conf
sleep 15

# Kiểm tra cluster đã join đủ 3 node
docker exec -it rabbit1 rabbitmqctl cluster_status
```

Nếu `cluster_formation` tự động không join (do thứ tự start hoặc timing), join thủ công:

```bash
docker exec -it rabbit2 rabbitmqctl stop_app
docker exec -it rabbit2 rabbitmqctl join_cluster rabbit@rabbit1
docker exec -it rabbit2 rabbitmqctl start_app

docker exec -it rabbit3 rabbitmqctl stop_app
docker exec -it rabbit3 rabbitmqctl join_cluster rabbit@rabbit1
docker exec -it rabbit3 rabbitmqctl start_app
```

---

## 6. Demo — Checklist Minh Chứng

Dùng checklist này để chụp màn hình/log làm minh chứng demo theo đúng yêu cầu báo cáo ("Cấu được port listen/user pass", "Cluster, đóng hóa, thực hiện cấu hình cluster"):

### 6.1. Minh chứng cấu hình User/Pass

```bash
docker exec -it rabbit1 rabbitmqctl list_users
# Kỳ vọng thấy: admin    [administrator]
#               guest    [administrator]  (có thể đã xóa nếu làm theo mục 1.3)

docker exec -it rabbit1 rabbitmqctl delete_user guest
docker exec -it rabbit1 rabbitmqctl list_users
# Kỳ vọng: chỉ còn admin
```

Đăng nhập Management UI tại `http://localhost:15672` bằng `admin` / `Admin@123456` → chụp màn hình giao diện đăng nhập thành công.

### 6.2. Minh chứng cấu hình Port Listen

```bash
docker exec -it rabbit1 rabbitmq-diagnostics listeners
```

Kỳ vọng output liệt kê rõ port `5672` (AMQP) và `15672` (Management HTTP) đang lắng nghe — chụp màn hình kết quả lệnh này.

### 6.3. Minh chứng File Log

```bash
ls -la ./logs/rabbit1/
cat ./logs/rabbit1/rabbit@rabbit1.log | tail -30
```

Chụp màn hình thấy file log thực tế tồn tại trên host (nhờ bind mount) và có nội dung log startup/connection.

### 6.4. Minh chứng Cluster

```bash
docker exec -it rabbit1 rabbitmqctl cluster_status
```

Kỳ vọng output có dạng:

```
Disk Nodes
rabbit@rabbit1
rabbit@rabbit2
rabbit@rabbit3

Running Nodes
rabbit@rabbit1
rabbit@rabbit2
rabbit@rabbit3
```

→ Chụp màn hình phần `Running Nodes` đủ 3 node.

Mở Management UI (`http://localhost:15672`) → tab **Overview** hoặc **Nodes** → thấy đủ 3 node với trạng thái xanh (running) → chụp màn hình.

### 6.5. Minh chứng Cluster hoạt động thật (failover) — phần "đóng hóa"/demo nâng cao

```bash
# Tạo 1 quorum queue, publish vài message qua rabbit1
docker exec -it rabbit1 rabbitmqctl list_queues name type leader members

# Dừng rabbit1 (giả lập node chết)
docker compose stop rabbit1

# Kiểm tra cluster còn hoạt động qua rabbit2
docker exec -it rabbit2 rabbitmqctl cluster_status
# Kỳ vọng: rabbit1 chuyển sang "không Running" nhưng rabbit2, rabbit3 vẫn Running

# Khởi động lại rabbit1, xác nhận tự rejoin
docker compose start rabbit1
sleep 10
docker exec -it rabbit1 rabbitmqctl cluster_status
```

→ Chụp lại toàn bộ log của 3 bước trên — đây là minh chứng mạnh nhất cho "đã thực hiện cấu hình cluster" thay vì chỉ join xong rồi để đó.

### 6.6. Bảng tổng hợp checklist nộp báo cáo

| Mục yêu cầu | Lệnh/cách kiểm tra | Đã làm |
|---|---|---|
| Cấu hình user, pass quản trị | `rabbitmqctl list_users`, đăng nhập UI thành công | ☐ |
| Cấu hình port listen | `rabbitmq-diagnostics listeners` | ☐ |
| File log | `ls`/`cat` file log trên host qua bind mount | ☐ |
| Cấu hình cluster | `rabbitmqctl cluster_status` đủ 3 node Running | ☐ |
| Triển khai trong Docker Compose | File `compose.yaml` chạy `docker compose up -d` thành công | ☐ |
| Demo cluster hoạt động (failover) | Dừng/khởi động lại 1 node, cluster vẫn còn 2 node Running | ☐ |

---

*Hết tài liệu bổ sung — ghép phần này vào sau Phần 4.1 (Work Queue) trong file Weekly Report chính để hoàn thiện đầy đủ yêu cầu.*
