# LAB 1 (Nâng Cấp) — Work Queue Trên RabbitMQ Cluster HA

> Phiên bản nâng cấp từ Lab 1 — Work Queue gốc. Thay vì 1 RabbitMQ instance đơn lẻ, lab này triển khai **cluster 3 node + Quorum Queue + HAProxy + user/pass riêng + log/port đầy đủ**, và **demo failover thật khi worker đang xử lý task** — minh chứng toàn bộ kiến thức cấu hình + cluster đã học vào đúng 1 bài toán thực tế.

---

## Mục Tiêu Nâng Cấp

So với bản gốc (1 RabbitMQ container), bản này bổ sung:

| Hạng mục | Bản gốc | Bản nâng cấp |
|---|---|---|
| Số node RabbitMQ | 1 | 3 (`rabbit1`, `rabbit2`, `rabbit3`) — cluster thật |
| Loại queue | Classic (`durable=True`) | **Quorum Queue** — replicate qua Raft, sống sót khi mất node |
| Điểm kết nối của app | Trực tiếp `host='rabbitmq'` | Qua **HAProxy** — 1 endpoint duy nhất, tự route tới node còn sống |
| User/pass | `admin/admin123` hardcode | User riêng, tạo qua `rabbitmqctl`, xóa `guest` |
| Port | Mặc định | Khai báo rõ qua `rabbitmq.conf`, kèm `25672`/`4369` cho giao tiếp cluster nội bộ |
| Log | Không cấu hình | Bind mount ra host, xem trực tiếp |
| Demo | Không có | **Tắt 1 node giữa lúc đang xử lý task — chứng minh message không mất, hệ thống không downtime** |

---

## Mục Lục

1. [Sơ Đồ Kiến Trúc](#1-sơ-đồ-kiến-trúc)
2. [Cấu Trúc Thư Mục](#2-cấu-trúc-thư-mục)
3. [Cấu Hình Cluster (rabbitmq.conf + cookie)](#3-cấu-hình-cluster-rabbitmqconf--cookie)
4. [Cấu Hình HAProxy](#4-cấu-hình-haproxy)
5. [Producer & Worker — Nâng Cấp Dùng Quorum Queue](#5-producer--worker--nâng-cấp-dùng-quorum-queue)
6. [compose.yaml Đầy Đủ](#6-composeyaml-đầy-đủ)
7. [Chạy Lab — Từng Bước](#7-chạy-lab--từng-bước)
8. [Demo Failover — Tắt Node Giữa Lúc Đang Xử Lý](#8-demo-failover--tắt-node-giữa-lúc-đang-xử-lý)
9. [Checklist Minh Chứng (Nộp Báo Cáo)](#9-checklist-minh-chứng-nộp-báo-cáo)
10. [Bài Tập Mở Rộng](#10-bài-tập-mở-rộng)

---

## 1. Sơ Đồ Kiến Trúc

```
                         ┌─────────────┐
        producer ───────►│             │
                         │   HAProxy   │  (port 5672 -> round-robin 3 node)
        worker  ◄────────│  (1 entry)  │  (port 15672 -> Management UI bất kỳ node nào)
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ rabbit1  │◄────►│ rabbit2  │◄────►│ rabbit3  │   (cluster, Raft, Quorum Queue
        │ (cookie  │      │ (cookie  │      │ (cookie  │    replicate qua cả 3 node)
        │  chung)  │      │  chung)  │      │  chung)  │
        └──────────┘      └──────────┘      └──────────┘
```

**Điểm mấu chốt:** producer/worker **không biết** và **không cần biết** đang nói chuyện với node nào — chỉ biết `host='haproxy'`. Khi 1 node chết, HAProxy tự loại nó khỏi danh sách healthy backend, traffic dồn sang 2 node còn lại — message vẫn an toàn nhờ Quorum Queue đã replicate.

---

## 2. Cấu Trúc Thư Mục

```
lab1-work-queue-cluster/
├── compose.yaml
├── .erlang.cookie
├── haproxy/
│   └── haproxy.cfg
├── rabbit1/
│   └── rabbitmq.conf
├── rabbit2/
│   └── rabbitmq.conf
├── rabbit3/
│   └── rabbitmq.conf
├── logs/
│   ├── rabbit1/
│   ├── rabbit2/
│   └── rabbit3/
├── producer/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── producer.py
└── worker/
    ├── Dockerfile
    ├── requirements.txt
    └── worker.py
```

```bash
mkdir -p lab1-work-queue-cluster/{haproxy,rabbit1,rabbit2,rabbit3,logs/rabbit1,logs/rabbit2,logs/rabbit3,producer,worker}
```

---

## 3. Cấu Hình Cluster (rabbitmq.conf + cookie)

### `.erlang.cookie` — bắt buộc giống hệt nhau trên cả 3 node

```
WORKQUEUECLUSTERCOOKIE2026
```

```bash
chmod 400 .erlang.cookie
```

### `rabbit1/rabbitmq.conf` — node khởi tạo cluster

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

### `rabbit2/rabbitmq.conf` — tự join vào rabbit1

```ini
listeners.tcp.default = 5672
management.tcp.port = 15672

log.console = true
log.console.level = info
log.file = /var/log/rabbitmq/rabbit.log
log.file.level = info
log.file.rotation.size = 10485760
log.file.rotation.count = 5

cluster_formation.peer_discovery_backend = classic_config
cluster_formation.classic_config.nodes.1 = rabbit@rabbit1
```

### `rabbit3/rabbitmq.conf` — tự join vào rabbit1

```ini
listeners.tcp.default = 5672
management.tcp.port = 15672

log.console = true
log.console.level = info
log.file = /var/log/rabbitmq/rabbit.log
log.file.level = info
log.file.rotation.size = 10485760
log.file.rotation.count = 5

cluster_formation.peer_discovery_backend = classic_config
cluster_formation.classic_config.nodes.1 = rabbit@rabbit1
```

---

## 4. Cấu Hình HAProxy

### `haproxy/haproxy.cfg`

```cfg
global
    log stdout format raw local0
    maxconn 4096

defaults
    log global
    mode tcp
    timeout connect 5s
    timeout client 50s
    timeout server 50s

# ===== AMQP traffic (producer/worker connect vào đây) =====
frontend amqp_front
    bind *:5672
    default_backend amqp_back

backend amqp_back
    balance roundrobin
    option tcp-check
    tcp-check connect port 5672
    server rabbit1 rabbit1:5672 check inter 3s fall 2 rise 2
    server rabbit2 rabbit2:5672 check inter 3s fall 2 rise 2
    server rabbit3 rabbit3:5672 check inter 3s fall 2 rise 2

# ===== Management UI (truy cập web bất kỳ node nào còn sống) =====
frontend mgmt_front
    bind *:15672
    default_backend mgmt_back

backend mgmt_back
    balance roundrobin
    option tcp-check
    tcp-check connect port 15672
    server rabbit1 rabbit1:15672 check inter 3s fall 2 rise 2
    server rabbit2 rabbit2:15672 check inter 3s fall 2 rise 2
    server rabbit3 rabbit3:15672 check inter 3s fall 2 rise 2

# ===== HAProxy Stats — xem trực quan node nào đang UP/DOWN =====
listen stats
    bind *:8404
    mode http
    stats enable
    stats uri /
    stats refresh 5s
```

> **Điểm quan trọng:** `fall 2 rise 2` nghĩa là HAProxy cần 2 lần check liên tiếp thất bại mới đánh dấu node DOWN (tránh false positive do mạng giật), và cần 2 lần check thành công liên tiếp mới đưa node trở lại UP. `inter 3s` = kiểm tra mỗi 3 giây — đây là lý do khi demo failover, có độ trễ vài giây trước khi HAProxy nhận ra node đã chết.

---

## 5. Producer & Worker — Nâng Cấp Dùng Quorum Queue

### `producer/producer.py`

```python
import pika
import json
import time
import random

RABBIT_HOST = 'haproxy'          # <-- thay đổi quan trọng nhất: connect qua HAProxy, không qua node cụ thể
RABBIT_USER = 'imguser'
RABBIT_PASS = 'ImgQueue@2026'

def get_connection():
    """Kết nối có retry — vì lúc HAProxy vừa chuyển backend, có thể mất vài trăm ms gián đoạn."""
    while True:
        try:
            return pika.BlockingConnection(
                pika.ConnectionParameters(
                    host=RABBIT_HOST,
                    credentials=pika.PlainCredentials(RABBIT_USER, RABBIT_PASS),
                    heartbeat=10,
                    blocked_connection_timeout=30,
                )
            )
        except pika.exceptions.AMQPConnectionError:
            print("[Producer] Connect failed, retry in 2s...")
            time.sleep(2)

def declare_quorum_queue(channel):
    # QUORUM QUEUE — thay vì durable=True thường (classic), dùng x-queue-type=quorum
    # để Raft replicate dữ liệu qua cả 3 node, sống sót khi 1 node chết
    channel.queue_declare(
        queue='image_tasks',
        durable=True,
        arguments={'x-queue-type': 'quorum'}
    )

def main():
    connection = get_connection()
    channel = connection.channel()
    declare_quorum_queue(channel)

    task_id = 0
    while True:
        try:
            task_id += 1
            task = {
                "task_id": task_id,
                "image": f"photo_{task_id}.jpg",
                "operation": random.choice(["resize", "thumbnail", "watermark"])
            }
            body = json.dumps(task)

            channel.basic_publish(
                exchange='',
                routing_key='image_tasks',
                body=body,
                properties=pika.BasicProperties(
                    delivery_mode=2,
                    content_type='application/json'
                )
            )
            print(f"[x] Sent task #{task_id}: {task['operation']} on {task['image']}")
            time.sleep(1)

        except (pika.exceptions.ConnectionClosed, pika.exceptions.StreamLostError, pika.exceptions.AMQPConnectionError):
            print("[Producer] Connection lost (likely a node failed over) — reconnecting...")
            connection = get_connection()
            channel = connection.channel()
            declare_quorum_queue(channel)

if __name__ == '__main__':
    main()
```

### `worker/worker.py`

```python
import pika
import json
import time
import os
import random

WORKER_NAME = os.environ.get('WORKER_NAME', 'worker')
RABBIT_HOST = 'haproxy'
RABBIT_USER = 'imguser'
RABBIT_PASS = 'ImgQueue@2026'

def get_connection():
    while True:
        try:
            return pika.BlockingConnection(
                pika.ConnectionParameters(
                    host=RABBIT_HOST,
                    credentials=pika.PlainCredentials(RABBIT_USER, RABBIT_PASS),
                    heartbeat=10,
                    blocked_connection_timeout=30,
                )
            )
        except pika.exceptions.AMQPConnectionError:
            print(f"[{WORKER_NAME}] Connect failed, retry in 2s...")
            time.sleep(2)

def declare_quorum_queue(channel):
    channel.queue_declare(
        queue='image_tasks',
        durable=True,
        arguments={'x-queue-type': 'quorum'}
    )

def callback(ch, method, properties, body):
    task = json.loads(body)
    print(f"[{WORKER_NAME}] Received task #{task['task_id']}: {task['operation']} on {task['image']}")

    processing_time = random.uniform(2, 6)   # kéo dài thời gian xử lý để dễ demo "tắt node giữa chừng"
    time.sleep(processing_time)

    print(f"[{WORKER_NAME}] Done task #{task['task_id']} in {processing_time:.1f}s")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    while True:
        connection = get_connection()
        channel = connection.channel()
        declare_quorum_queue(channel)
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(queue='image_tasks', on_message_callback=callback, auto_ack=False)

        print(f'[{WORKER_NAME}] Waiting for tasks...')
        try:
            channel.start_consuming()
        except (pika.exceptions.ConnectionClosed, pika.exceptions.StreamLostError, pika.exceptions.AMQPConnectionError):
            print(f"[{WORKER_NAME}] Connection lost (likely a node failed over) — reconnecting...")
            time.sleep(1)

if __name__ == '__main__':
    main()
```

> **Vì sao thêm retry/reconnect logic?** Đây chính là phần nâng cấp quan trọng nhất so với bản gốc. Khi 1 node RabbitMQ chết, connection TCP hiện tại của producer/worker tới node đó sẽ bị đứt (dù HAProxy route sang node khác, **connection cũ vẫn chết theo node cũ** — TCP/AMQP connection không tự "nhảy" sang node khác). Code phải tự bắt exception và **kết nối lại** (lúc này HAProxy sẽ đưa connection mới tới node còn sống) — đây là pattern bắt buộc khi làm việc với cluster HA thật.

### `requirements.txt` (dùng chung)

```
pika==1.3.2
```

### `Dockerfile` (chung cấu trúc, đổi `CMD` theo từng service)

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "producer.py"]
```

(`worker/Dockerfile` đổi dòng cuối thành `CMD ["python", "worker.py"]`)

---

## 6. compose.yaml Đầy Đủ

```yaml
services:
  # ============ RABBITMQ CLUSTER 3 NODE ============
  rabbit1:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit1
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: imguser
      RABBITMQ_DEFAULT_PASS: ImgQueue@2026
      RABBITMQ_DEFAULT_VHOST: /
      RABBITMQ_ERLANG_COOKIE: "WORKQUEUECLUSTERCOOKIE2026"
    volumes:
      - ./rabbit1/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./.erlang.cookie:/var/lib/rabbitmq/.erlang.cookie:ro
      - rabbit1_data:/var/lib/rabbitmq
      - ./logs/rabbit1:/var/log/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - mq_net

  rabbit2:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit2
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: imguser
      RABBITMQ_DEFAULT_PASS: ImgQueue@2026
      RABBITMQ_ERLANG_COOKIE: "WORKQUEUECLUSTERCOOKIE2026"
    volumes:
      - ./rabbit2/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./.erlang.cookie:/var/lib/rabbitmq/.erlang.cookie:ro
      - rabbit2_data:/var/lib/rabbitmq
      - ./logs/rabbit2:/var/log/rabbitmq
    depends_on:
      rabbit1:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - mq_net

  rabbit3:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit3
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: imguser
      RABBITMQ_DEFAULT_PASS: ImgQueue@2026
      RABBITMQ_ERLANG_COOKIE: "WORKQUEUECLUSTERCOOKIE2026"
    volumes:
      - ./rabbit3/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./.erlang.cookie:/var/lib/rabbitmq/.erlang.cookie:ro
      - rabbit3_data:/var/lib/rabbitmq
      - ./logs/rabbit3:/var/log/rabbitmq
    depends_on:
      rabbit1:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - mq_net

  # ============ HAPROXY — SINGLE ENTRYPOINT ============
  haproxy:
    image: haproxy:2.9-alpine
    restart: unless-stopped
    volumes:
      - ./haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    ports:
      - "5672:5672"        # AMQP — producer/worker connect vào đây
      - "15672:15672"      # Management UI
      - "8404:8404"        # HAProxy Stats dashboard
    depends_on:
      rabbit1:
        condition: service_healthy
      rabbit2:
        condition: service_healthy
      rabbit3:
        condition: service_healthy
    networks:
      - mq_net

  # ============ APP: PRODUCER / WORKER ============
  producer:
    build: ./producer
    restart: unless-stopped
    depends_on:
      - haproxy
    networks:
      - mq_net

  worker:
    build: ./worker
    restart: unless-stopped
    environment:
      WORKER_NAME: worker
    depends_on:
      - haproxy
    networks:
      - mq_net
    deploy:
      replicas: 3

volumes:
  rabbit1_data:
  rabbit2_data:
  rabbit3_data:

networks:
  mq_net:
    driver: bridge
```

---

## 7. Chạy Lab — Từng Bước

```bash
cd lab1-work-queue-cluster
chmod 400 .erlang.cookie

# 1. Dựng cluster RabbitMQ trước, đợi join xong
docker compose up -d rabbit1 rabbit2 rabbit3
sleep 20
docker exec -it rabbit1 rabbitmqctl cluster_status
```

Nếu `cluster_formation` tự động chưa join kịp (do timing), join thủ công:

```bash
docker exec -it rabbit2 rabbitmqctl stop_app
docker exec -it rabbit2 rabbitmqctl join_cluster rabbit@rabbit1
docker exec -it rabbit2 rabbitmqctl start_app

docker exec -it rabbit3 rabbitmqctl stop_app
docker exec -it rabbit3 rabbitmqctl join_cluster rabbit@rabbit1
docker exec -it rabbit3 rabbitmqctl start_app

docker exec -it rabbit1 rabbitmqctl cluster_status   # xác nhận đủ 3 node Running
```

```bash
# 2. Dựng HAProxy + producer + worker
docker compose up -d --build --scale worker=3

# 3. Theo dõi log
docker compose logs -f producer worker
```

### Kiểm tra qua giao diện web

- Management UI: `http://localhost:15672` (đăng nhập `imguser` / `ImgQueue@2026`) → tab **Queues** → `image_tasks` → kiểm tra **Type = quorum**, **Online = 3** (3 node đang giữ bản replicate).
- HAProxy Stats: `http://localhost:8404` → xem 3 backend `rabbit1/rabbit2/rabbit3` đều màu xanh (UP).

---

## 8. Demo Failover — Tắt Node Giữa Lúc Đang Xử Lý

Đây là phần chứng minh giá trị thật của cluster — không chỉ "join xong rồi để đó".

### Bước 1 — Quan sát trạng thái ban đầu

```bash
docker compose logs -f worker
# Để 1 cửa sổ terminal riêng theo dõi liên tục log worker trong suốt quá trình demo
```

Mở song song HAProxy Stats `http://localhost:8404` để quan sát trực quan node nào UP/DOWN theo thời gian thực.

### Bước 2 — Xác định node nào đang là leader của queue `image_tasks`

```bash
docker exec -it rabbit1 rabbitmqctl list_queues name type leader members
```

Output ví dụ:
```
name           type      leader    members
image_tasks    quorum    rabbit@rabbit2    [rabbit@rabbit1, rabbit@rabbit2, rabbit@rabbit3]
```

### Bước 3 — Tắt ĐÚNG node đang là leader (kịch bản khắc nghiệt nhất)

```bash
# Giả sử leader là rabbit2 theo output trên
docker compose stop rabbit2
```

### Bước 4 — Quan sát ngay lập tức trong log worker/producer

Kỳ vọng thấy trong vài giây:
- `producer`/`worker` log dòng `"Connection lost (likely a node failed over) — reconnecting..."`.
- Sau 1-3 giây, log tiếp tục bình thường (`Sent task #...`, `Received task #...`) — **không bị dừng hẳn, không mất task đang dở**.
- HAProxy Stats dashboard: backend `rabbit2` chuyển đỏ (DOWN).

### Bước 5 — Xác nhận Quorum Queue đã tự bầu leader mới

```bash
docker exec -it rabbit1 rabbitmqctl list_queues name type leader members
```

Kỳ vọng: `leader` đã đổi sang `rabbit@rabbit1` hoặc `rabbit@rabbit3` (1 trong 2 node còn sống), `members` vẫn còn đủ 3 (kể cả `rabbit2` dù đang chết — sẽ tự đồng bộ lại khi sống lại).

### Bước 6 — Khởi động lại node đã tắt, xác nhận tự rejoin và đồng bộ lại

```bash
docker compose start rabbit2
sleep 15
docker exec -it rabbit1 rabbitmqctl cluster_status     # rabbit2 trở lại "Running"
```

HAProxy Stats: backend `rabbit2` chuyển xanh (UP) trở lại sau vài lần health check thành công liên tiếp.

### Bước 7 — Đối chiếu: thử lại với queue KHÔNG phải Quorum (so sánh để thấy rõ giá trị)

Để thấy rõ sự khác biệt, có thể tạo thêm 1 service test phụ dùng `arguments={}` (Classic Queue, không quorum) thay vì `x-queue-type: quorum`, lặp lại bước tắt node đang giữ queue đó — quan sát **queue/message biến mất hoàn toàn** nếu node đó không tự hồi phục ngay, khác hẳn hành vi của Quorum Queue ở trên.

---

## 9. Checklist Minh Chứng (Nộp Báo Cáo)

| Hạng mục | Lệnh/cách kiểm tra | Kỳ vọng |
|---|---|---|
| Cluster đủ 3 node | `rabbitmqctl cluster_status` | 3 node trong "Running Nodes" |
| User/pass riêng | `rabbitmqctl list_users`, đăng nhập UI | Thấy `imguser`, không còn `guest` |
| Port listen | `rabbitmq-diagnostics listeners` trên từng node | 5672, 15672 đang listen |
| File log | `cat ./logs/rabbit1/rabbit@rabbit1.log` | Có nội dung log thật |
| Quorum Queue | Management UI → Queues → `image_tasks` → Type | `quorum`, Online = 3 |
| HAProxy hoạt động | `http://localhost:8404` | 3 backend màu xanh khi cluster khỏe |
| **Failover khi đang xử lý** | Log `worker` lúc `docker compose stop rabbit2` | Có dòng reconnect, KHÔNG có task nào bị mất (so log task_id liên tục không nhảy cóc bất thường) |
| Leader tự bầu lại | `rabbitmqctl list_queues name type leader members` trước/sau khi tắt node | Leader đổi sang node còn sống |
| Tự phục hồi | `cluster_status` sau khi `docker compose start rabbit2` | rabbit2 trở lại Running |

> **Mẹo chụp minh chứng thuyết phục nhất:** chụp 2 cửa sổ terminal cạnh nhau — 1 bên `docker compose logs -f worker` đang chạy liên tục, 1 bên gõ lệnh `docker compose stop rabbit2` — để thấy rõ log KHÔNG bị gián đoạn dù 1 node chết ngay giữa lúc demo.

---

## 10. Bài Tập Mở Rộng

1. **Đo thời gian gián đoạn thực tế**: thêm timestamp vào log producer/worker, tính khoảng thời gian từ lúc connection lost tới lúc reconnect thành công — so sánh với `inter 3s, fall 2` đã cấu hình ở HAProxy để hiểu rõ mối liên hệ.
2. **Test tắt 2/3 node cùng lúc** (`docker compose stop rabbit2 rabbit3`) — quan sát cluster mất quorum, Quorum Queue **không còn ghi/đọc được** (vì Raft cần đa số node sống) dù `rabbit1` vẫn chạy — minh chứng rõ khái niệm Quorum đã học ở phần lý thuyết Swarm/Cluster.
3. **So sánh hiệu năng**: đo throughput (số task/giây xử lý xong) giữa bản Classic Queue gốc (1 node) và bản Quorum Queue cluster (3 node) — Quorum Queue có overhead replicate nên chậm hơn, đánh đổi lấy độ tin cậy, cần biết rõ trade-off này khi áp dụng thực tế.
4. **Thêm Prometheus + Grafana** giám sát cluster (dùng plugin `rabbitmq_prometheus` có sẵn từ RabbitMQ 3.8+) để theo dõi trực quan hơn HAProxy Stats thuần TCP.

---

*Lab này là phiên bản nâng cấp của "LAB 1 — Work Queue (Task Distribution)" gốc, bổ sung đầy đủ Cluster + Quorum Queue + HAProxy + User/Pass + Port/Log theo yêu cầu cấu hình RabbitMQ.*
