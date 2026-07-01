# RabbitMQ — Lý Thuyết & Lab Thực Tế Chi Tiết

> Tài liệu tổng hợp từ lý thuyết nền tảng (AMQP, Exchange, Queue, Binding, Routing) đến các bài lab kịch bản thực tế (work queue, pub/sub, routing, RPC, dead-letter, cluster) sử dụng RabbitMQ + Docker Compose.

---

## Mục Lục

1. [Tổng Quan Về RabbitMQ](#1-tổng-quan-về-rabbitmq)
2. [Kiến Trúc & Khái Niệm Cốt Lõi](#2-kiến-trúc--khái-niệm-cốt-lõi)
3. [Exchange Types — Trái Tim Của Routing](#3-exchange-types--trái-tim-của-routing)
4. [Queue — Thuộc Tính & Vòng Đời](#4-queue--thuộc-tính--vòng-đời)
5. [Message — Cấu Trúc & Thuộc Tính](#5-message--cấu-trúc--thuộc-tính)
6. [Acknowledgement & Độ Tin Cậy](#6-acknowledgement--độ-tin-cậy)
7. [Dead Letter Exchange (DLX) & Retry](#7-dead-letter-exchange-dlx--retry)
8. [Publisher Confirms & Transactions](#8-publisher-confirms--transactions)
9. [Prefetch & Quality of Service (QoS)](#9-prefetch--quality-of-service-qos)
10. [Clustering & High Availability](#10-clustering--high-availability)
11. [Management UI & CLI](#11-management-ui--cli)
12. [Best Practices Production](#12-best-practices-production)
13. [LAB 1 — Work Queue (Task Distribution)](#lab-1--work-queue-task-distribution)
14. [LAB 2 — Publish/Subscribe (Fanout Exchange)](#lab-2--publishsubscribe-fanout-exchange)
15. [LAB 3 — Routing có chọn lọc (Direct Exchange)](#lab-3--routing-có-chọn-lọc-direct-exchange)
16. [LAB 4 — Topic Exchange (Routing theo Pattern)](#lab-4--topic-exchange-routing-theo-pattern)
17. [LAB 5 — RPC Pattern (Request/Reply)](#lab-5--rpc-pattern-requestreply)
18. [LAB 6 — Dead Letter Queue + Retry với Delay](#lab-6--dead-letter-queue--retry-với-delay)
19. [LAB 7 — Microservices thực tế: Order → Inventory → Notification](#lab-7--microservices-thực-tế-order--inventory--notification)
20. [LAB 8 — Cluster RabbitMQ 3 node + HA Queue](#lab-8--cluster-rabbitmq-3-node--ha-queue)
21. [Troubleshooting Thường Gặp](#21-troubleshooting-thường-gặp)
22. [Cheat Sheet Tổng Hợp](#22-cheat-sheet-tổng-hợp)

---

## 1. Tổng Quan Về RabbitMQ

### 1.1. RabbitMQ là gì?

RabbitMQ là một **message broker** (phần mềm trung gian truyền message) mã nguồn mở, hiện thực hóa chuẩn giao thức **AMQP 0-9-1** (Advanced Message Queuing Protocol). Nhiệm vụ chính: nhận message từ **producer**, lưu trữ tạm, rồi chuyển tới **consumer** một cách tin cậy — giúp các thành phần trong hệ thống giao tiếp **bất đồng bộ (asynchronous)** mà không cần biết nhau trực tiếp.

### 1.2. Tại sao cần Message Broker?

| Vấn đề khi gọi trực tiếp (HTTP REST đồng bộ) | RabbitMQ giải quyết thế nào |
|---|---|
| Service B sập → Service A cũng lỗi theo (tight coupling) | A chỉ cần gửi message vào queue, B đọc khi sẵn sàng (decoupling) |
| A phải chờ B xử lý xong mới tiếp tục (blocking) | A gửi xong là xong ngay (asynchronous, fire-and-forget) |
| B bị quá tải khi traffic tăng đột biến | Queue đóng vai trò buffer, B xử lý theo tốc độ riêng (load leveling) |
| Khó nhân bản nhiều consumer xử lý song song | Nhiều consumer  cùng đọc 1 queue → tự động load balance |
| Khó phát 1 sự kiện cho nhiều bên quan tâm | Pub/Sub qua exchange — 1 message tới N consumer |

### 1.3. RabbitMQ vs Kafka — khi nào dùng cái nào?

| Tiêu chí | RabbitMQ | Kafka |
|---|---|---|
| Mô hình | Message broker truyền thống (push tới consumer) | Distributed log (consumer tự kéo/pull, lưu lâu dài) |
| Routing phức tạp | Rất mạnh (direct, topic, fanout, headers) | Đơn giản hơn (chủ yếu theo partition key) |
| Throughput cực lớn (triệu msg/s, streaming) | Tốt nhưng không phải sở trường | Rất mạnh — sinh ra cho việc này |
| Lưu trữ lại để replay message cũ | Không phải mục đích chính (message bị xóa sau khi ack) | Có thể giữ log lâu dài, replay từ offset |
| Use case điển hình | Task queue, RPC, routing event nghiệp vụ phức tạp | Event streaming, log aggregation, analytics pipeline |
| Độ phức tạp vận hành | Tương đối đơn giản | Phức tạp hơn (cần Zookeeper/KRaft, partition...) |

→ **RabbitMQ** phù hợp cho: task queue, microservices giao tiếp theo sự kiện, RPC nội bộ, độ trễ thấp, logic routing phức tạp.
→ **Kafka** phù hợp cho: streaming dữ liệu khối lượng lớn, event sourcing, cần replay lịch sử.

### 1.4. Use case thực tế phổ biến

- Xử lý task nặng ngầm (gửi email, render PDF, resize ảnh) — **Work Queue**
- Thông báo sự kiện cho nhiều service cùng lúc (order created → inventory, billing, notification) — **Pub/Sub**
- Định tuyến log theo mức độ nghiêm trọng (error → Slack, info → file) — **Routing**
- Giao tiếp request/reply giữa service mà không qua HTTP trực tiếp — **RPC**
- Retry tự động khi xử lý lỗi, delay trước khi thử lại — **Dead Letter + TTL**

---

## 2. Kiến Trúc & Khái Niệm Cốt Lõi

### 2.1. Sơ đồ luồng dữ liệu

```
Producer --(publish)--> Exchange --(routing dựa trên binding)--> Queue --(consume)--> Consumer
```

**Điểm quan trọng nhất cần nhớ:** Producer **KHÔNG BAO GIỜ** gửi message trực tiếp vào Queue. Producer luôn gửi tới **Exchange**, Exchange dựa vào **Binding** (quy tắc liên kết) và **Routing Key** để quyết định message đi vào Queue nào (có thể 0, 1, hoặc nhiều Queue).

### 2.2. Các thành phần chính

| Thành phần | Vai trò |
|---|---|
| **Producer** | Ứng dụng gửi (publish) message |
| **Exchange** | "Trạm phân loại" — nhận message từ producer, định tuyến tới queue theo routing key + binding |
| **Binding** | Quy tắc liên kết Exchange ↔ Queue (kèm routing key/pattern) |
| **Queue** | Bộ đệm lưu message, FIFO theo mặc định, tồn tại tới khi được consume + ack |
| **Consumer** | Ứng dụng nhận (subscribe) và xử lý message từ queue |
| **Virtual Host (vhost)** | Không gian cách ly logic (giống "database" trong RDBMS) — mỗi vhost có exchange/queue/permission riêng |
| **Connection** | Kết nối TCP giữa client và broker (thường 1 connection/process) |
| **Channel** | "Kênh ảo" trong 1 connection — thao tác thực tế (publish, consume...) diễn ra trên channel, không phải connection trực tiếp (tiết kiệm tài nguyên TCP) |

### 2.3. Tại sao có Channel mà không dùng Connection trực tiếp?

Mở/đóng TCP connection rất tốn kém (cần TCP handshake, TLS negotiation...). RabbitMQ cho phép **1 connection chứa nhiều channel độc lập** — mỗi thread/task trong app dùng riêng 1 channel, nhưng share chung 1 connection TCP. Đây là pattern bắt buộc trong production.

```
Connection (1 TCP socket)
 ├── Channel 1 (publish order events)
 ├── Channel 2 (consume notification queue)
 └── Channel 3 (RPC calls)
```

> **Lưu ý:** Channel **không thread-safe** — không share 1 channel giữa nhiều thread cùng lúc.

---

## 3. Exchange Types — Trái Tim Của Routing

RabbitMQ có 4 loại exchange chính, mỗi loại có chiến lược routing khác nhau:

### 3.1. Direct Exchange

Routing dựa trên **routing key khớp chính xác (exact match)**.

```
Producer --routing_key="error"--> [Direct Exchange] --> Queue đã bind với "error"
```

```
Binding: queue_error  <--- routing_key "error" ---  exchange "logs_direct"
Binding: queue_info   <--- routing_key "info"  ---  exchange "logs_direct"
```

→ Message gửi với `routing_key="error"` chỉ tới `queue_error`, không tới `queue_info`.

### 3.2. Fanout Exchange

**Bỏ qua routing key hoàn toàn** — broadcast message tới **TẤT CẢ** queue đã bind với exchange này.

```
                    ┌──> Queue A (email service)
Producer --> [Fanout] ──> Queue B (sms service)
                    └──> Queue C (log service)
```

→ Dùng cho Pub/Sub kinh điển: 1 event, nhiều bên cùng nhận.

### 3.3. Topic Exchange

Routing dựa trên **pattern matching** với routing key dạng `word1.word2.word3`, dùng wildcard:
- `*` (star) = khớp đúng **1 từ**
- `#` (hash) = khớp **0 hoặc nhiều từ**

```
Routing key thực tế: "order.created.vip"

Binding pattern "order.*"      -> KHÔNG khớp (chỉ khớp "order.X" — đúng 2 phần)
Binding pattern "order.#"      -> KHỚP (order + bất kỳ phần sau)
Binding pattern "*.created.*"  -> KHỚP
Binding pattern "order.created.vip" -> KHỚP (exact)
```

→ Dùng khi cần routing linh hoạt theo nhiều chiều: loại event + mức độ + khu vực...

### 3.4. Headers Exchange

Routing dựa trên **header của message** (key-value tùy ý) thay vì routing key, hỗ trợ so khớp `x-match: all` (AND) hoặc `x-match: any` (OR). Ít dùng hơn 3 loại trên, phù hợp khi điều kiện routing phức tạp không biểu diễn được bằng chuỗi.

### 3.5. Default Exchange (nameless)

Exchange tên rỗng `""` có sẵn — mọi queue mới tạo tự động được bind vào exchange này với routing key = tên queue. Đây là lý do khi làm Lab cơ bản nhất, ta có thể "publish trực tiếp vào queue" (thực chất vẫn qua default exchange).

### 3.6. Bảng tổng hợp lựa chọn Exchange

| Exchange | Routing key cần gì | Use case |
|---|---|---|
| `direct` | Khớp chính xác | Phân loại theo loại cố định (vd: theo mức độ log) |
| `fanout` | Không quan tâm | Broadcast — mọi consumer đều cần biết |
| `topic` | Pattern với `.`, `*`, `#` | Routing đa chiều, linh hoạt |
| `headers` | Không dùng key, dùng metadata | Điều kiện phức tạp, nhiều thuộc tính |

---

## 4. Queue — Thuộc Tính & Vòng Đời

### 4.1. Thuộc tính khi khai báo queue

```python
channel.queue_declare(
    queue='task_queue',
    durable=True,          # Queue tồn tại sau khi broker restart (KHÔNG bao gồm message, xem mục 4.2)
    exclusive=False,       # True = chỉ connection hiện tại dùng được, tự xóa khi disconnect
    auto_delete=False,     # True = tự xóa khi consumer cuối cùng disconnect
    arguments={
        'x-message-ttl': 60000,                  # Message tự hết hạn sau 60s
        'x-max-length': 10000,                   # Giới hạn số message tối đa
        'x-dead-letter-exchange': 'dlx_exchange', # Exchange nhận message bị reject/expired
        'x-max-priority': 10,                    # Cho phép priority queue
    }
)
```

### 4.2. Durable Queue vs Persistent Message — PHÂN BIỆT QUAN TRỌNG

Đây là nhầm lẫn phổ biến nhất khi học RabbitMQ:

| | Durable Queue | Persistent Message |
|---|---|---|
| Khai báo ở đâu | `queue_declare(durable=True)` | `properties=pika.BasicProperties(delivery_mode=2)` lúc publish |
| Ý nghĩa | **Queue** (cấu trúc) tồn tại sau khi broker restart | **Message** được ghi xuống đĩa, không mất khi broker restart |
| Nếu chỉ có 1 trong 2 | Queue còn nhưng rỗng (mất hết message cũ) hoặc message ghi đĩa nhưng queue mất theo | Cả 2 đều cần để đảm bảo "không mất message" hoàn toàn |

> **Quy tắc vàng:** muốn message KHÔNG MẤT khi RabbitMQ restart → cần **CẢ HAI**: `durable=True` (queue) **VÀ** `delivery_mode=2` (message persistent).

### 4.3. Exclusive & Auto-delete — dùng khi nào?

- **Exclusive queue**: dùng cho RPC reply queue (mỗi request cần 1 queue riêng, tự dọn khi xong) hoặc queue tạm của 1 consumer cụ thể.
- **Auto-delete queue**: dùng cho Pub/Sub tạm thời — khi consumer ngắt kết nối, queue tự xóa, không rác lại trên broker.

---

## 5. Message — Cấu Trúc & Thuộc Tính

### 5.1. Properties quan trọng của message (AMQP Basic Properties)

| Property | Ý nghĩa |
|---|---|
| `delivery_mode` | `1` = transient (mất khi restart), `2` = persistent (ghi đĩa) |
| `content_type` | Vd: `application/json` |
| `correlation_id` | Dùng để khớp request-response trong RPC |
| `reply_to` | Tên queue mà consumer phải gửi reply về (RPC pattern) |
| `expiration` | TTL riêng cho message này (ms), khác với TTL ở mức queue |
| `priority` | Độ ưu tiên xử lý (cần `x-max-priority` ở queue) |
| `headers` | Metadata tùy ý dạng key-value |
| `message_id` | ID định danh message (tùy ứng dụng tự gán) |
| `timestamp` | Thời điểm publish |

### 5.2. Body — luôn là bytes

RabbitMQ không quan tâm nội dung message là gì — body luôn được truyền dưới dạng **byte string**. Ứng dụng tự serialize/deserialize (thường dùng JSON).

```python
import json
body = json.dumps({"order_id": 123, "amount": 99.5}).encode('utf-8')
```

---

## 6. Acknowledgement & Độ Tin Cậy

### 6.1. Vấn đề: làm sao biết consumer đã xử lý xong message?

Nếu consumer crash giữa lúc xử lý mà chưa kịp báo "xong" cho broker, message đó **không được mất** — RabbitMQ cần requeue lại để consumer khác xử lý tiếp.

### 6.2. Cơ chế Acknowledgement (ack)

```
1. Broker gửi message tới Consumer
2. Consumer xử lý xong
3. Consumer gửi "ack" về Broker
4. Broker mới XÓA message khỏi queue
```

Nếu Consumer **disconnect mà chưa ack** → Broker tự động **requeue** message đó cho consumer khác.

### 6.3. Auto-ack vs Manual-ack

```python
# Auto-ack = True (NGUY HIỂM cho production)
# Broker coi như message đã xử lý xong NGAY KHI gửi đi, bất kể consumer có crash hay không
channel.basic_consume(queue='task_queue', on_message_callback=callback, auto_ack=True)

# Manual-ack (KHUYẾN NGHỊ — kiểm soát hoàn toàn)
def callback(ch, method, properties, body):
    process(body)
    ch.basic_ack(delivery_tag=method.delivery_tag)   # chỉ ack SAU KHI xử lý xong

channel.basic_consume(queue='task_queue', on_message_callback=callback, auto_ack=False)
```

> **Quy tắc vàng:** Production luôn dùng `auto_ack=False` + ack thủ công sau khi xử lý thành công. `auto_ack=True` chỉ phù hợp cho dữ liệu không quan trọng, mất cũng không sao (vd: metric tạm).

### 6.4. Nack & Reject

```python
# Từ chối message, KHÔNG requeue (thường dùng khi message lỗi không thể xử lý — gửi sang DLX)
ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

# Từ chối nhưng requeue lại để xử lý lại (cẩn thận — dễ gây vòng lặp vô hạn nếu lỗi do code, không do dữ liệu)
ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
```

---

## 7. Dead Letter Exchange (DLX) & Retry

### 7.1. DLX là gì?

Khi 1 message bị:
- `nack`/`reject` với `requeue=False`, hoặc
- Hết TTL (message-level hoặc queue-level), hoặc
- Queue đạt `x-max-length` (message cũ nhất bị loại)

→ Nếu queue có cấu hình `x-dead-letter-exchange`, message đó **không bị xóa vĩnh viễn** mà được chuyển tới Dead Letter Exchange — từ đó route tới 1 "queue lỗi" (Dead Letter Queue) để xử lý riêng (log lại, alert, retry sau...).

### 7.2. Sơ đồ retry pattern phổ biến: Delay + DLX

```
[Main Queue] --(xử lý lỗi, nack requeue=False)--> [DLX] --> [Retry Queue có TTL]
                                                                    │
                                          (hết TTL = hết thời gian chờ)
                                                                    ▼
                                                          [DLX khác] --> [Main Queue] (thử lại)
```

Đây là kỹ thuật kinh điển để có **"delay queue"** trong RabbitMQ — vì RabbitMQ thuần (không có plugin) **không hỗ trợ delay message trực tiếp**, phải lách qua TTL + DLX.

> Có plugin `rabbitmq_delayed_message_exchange` hỗ trợ delay trực tiếp, nhưng pattern TTL + DLX vẫn là cách chuẩn, không cần cài thêm gì.

---

## 8. Publisher Confirms & Transactions

### 8.1. Vấn đề: làm sao Producer biết Broker đã nhận message thành công?

Mặc định, `basic_publish` là **fire-and-forget** — không có gì đảm bảo message đã tới broker (có thể mất nếu lỗi network giữa đường).

### 8.2. Publisher Confirms (khuyến nghị — nhanh, hiệu quả)

```python
channel.confirm_delivery()
try:
    channel.basic_publish(exchange='', routing_key='task_queue', body=msg)
    print("Message confirmed by broker")
except pika.exceptions.UnroutableError:
    print("Message was returned (không route được tới queue nào)")
```

### 8.3. AMQP Transactions (chậm hơn, ít dùng trong thực tế)

`tx_select` / `tx_commit` / `tx_rollback` — đảm bảo nhiều publish cùng thành công hoặc cùng rollback, nhưng làm giảm throughput đáng kể. **Publisher Confirms** gần như luôn là lựa chọn tốt hơn trong production.

---

## 9. Prefetch & Quality of Service (QoS)

### 9.1. Vấn đề: 1 consumer nhanh "ăn hết" message, consumer khác đói

Mặc định RabbitMQ gửi message theo kiểu round-robin đơn giản — không quan tâm consumer nào đang xử lý nhanh/chậm. Nếu không cấu hình, có thể dồn hết việc cho 1 consumer trong khi consumer khác rảnh.

### 9.2. `basic_qos` — giới hạn số message chưa-ack mỗi consumer

```python
channel.basic_qos(prefetch_count=1)   # Consumer chỉ nhận 1 message mới SAU KHI đã ack message trước
```

→ Đây là cách triển khai **"fair dispatch"** — việc nặng/nhẹ tự nhiên được cân bằng vì consumer chỉ lấy message mới khi đã rảnh tay.

| `prefetch_count` | Hiệu ứng |
|---|---|
| `1` | Round-robin công bằng tuyệt đối, nhưng có thể giảm throughput nếu network latency cao |
| Cao (vd: 50-100) | Throughput cao hơn, nhưng dễ mất cân bằng nếu task có độ khó khác nhau |
| Cần benchmark thực tế để chọn số phù hợp với workload |

---

## 10. Clustering & High Availability

### 10.1. Cluster RabbitMQ là gì?

Nhiều node RabbitMQ kết nối với nhau, chia sẻ metadata (exchange, binding, user, permission...) — nhưng **mặc định, queue chỉ nằm trên 1 node** ("queue master/leader"), các node khác chỉ biết "queue này ở đâu" để forward request.

### 10.2. Quorum Queues (khuyến nghị từ RabbitMQ 3.8+, thay thế Mirrored/Classic HA Queue cũ)

```python
channel.queue_declare(
    queue='orders',
    durable=True,
    arguments={'x-queue-type': 'quorum'}
)
```

Quorum Queue dùng giao thức **Raft consensus** — dữ liệu được replicate tới nhiều node, nếu node leader chết, node khác tự động được bầu làm leader mới, **không mất message** (miễn là còn quorum — đa số node sống).

| | Classic Queue | Quorum Queue |
|---|---|---|
| Replication | Không có (hoặc qua plugin Mirrored Queue cũ — deprecated) | Có sẵn, dùng Raft |
| Độ tin cậy khi node chết | Thấp (mất queue nếu node đó chết) | Cao — tự động failover |
| Khuyến nghị dùng | Dev/test, hoặc khi không cần HA | **Production cần độ tin cậy cao** |

### 10.3. Load balancer trước cluster

Trong thực tế, đặt 1 load balancer (HAProxy/Nginx) trước cluster RabbitMQ để client connect qua 1 endpoint duy nhất, tự động route tới node còn sống.

---

## 11. Management UI & CLI

### 11.1. Management Plugin

RabbitMQ có sẵn plugin `rabbitmq_management` cung cấp **Web UI** (cổng `15672`) để xem queue, exchange, connection, message rate, và **HTTP API** để tự động hóa.

```bash
rabbitmq-plugins enable rabbitmq_management
```

### 11.2. `rabbitmqctl` — CLI quản trị quan trọng

```bash
rabbitmqctl status                          # Trạng thái node
rabbitmqctl list_queues name messages consumers
rabbitmqctl list_exchanges
rabbitmqctl list_bindings
rabbitmqctl add_user myuser mypass
rabbitmqctl set_permissions -p / myuser ".*" ".*" ".*"
rabbitmqctl set_user_tags myuser administrator
rabbitmqctl cluster_status
```

### 11.3. `rabbitmqadmin` — CLI dựa trên HTTP API (cần Python, hoặc tải script riêng)

```bash
rabbitmqadmin list queues
rabbitmqadmin declare queue name=test durable=true
rabbitmqadmin publish exchange=amq.default routing_key=test payload="hello"
```

---

## 12. Best Practices Production

1. **Luôn dùng `durable=True` + `delivery_mode=2`** cho message quan trọng (đơn hàng, thanh toán...).
2. **Luôn manual ack**, không dùng `auto_ack=True` ngoại trừ dữ liệu không quan trọng.
3. **Luôn cấu hình DLX** cho mọi queue chính — không để message lỗi biến mất âm thầm.
4. **Dùng Quorum Queue** cho production cần HA, tránh Classic Mirrored Queue (deprecated).
5. **Set `prefetch_count` hợp lý**, không để mặc định không giới hạn (dễ gây 1 consumer ngợp message rồi crash mất hết chưa-ack).
6. **Connection pooling**: 1 connection/process, nhiều channel — không tạo connection mới cho mỗi message (rất tốn kém).
7. **Publisher Confirms** cho message quan trọng để đảm bảo broker đã nhận.
8. **Giới hạn `x-max-length` / `x-message-ttl`** để tránh queue phình vô hạn khi consumer chết lâu ngày.
9. **Theo dõi qua Prometheus exporter** (`rabbitmq_prometheus` plugin có sẵn từ 3.8+) thay vì chỉ nhìn Management UI.
10. **Không bao giờ để Management UI port (15672) mở public không bảo vệ** — đổi user/pass mặc định `guest/guest` (mặc định chỉ cho phép login từ localhost, nhưng vẫn cần đổi khi expose ra ngoài).
11. **Phân vhost theo môi trường/tenant** nếu nhiều team/dự án dùng chung 1 cluster.

---

## LAB 1 — Work Queue (Task Distribution)

### Mục tiêu
Hiểu pattern cơ bản nhất: nhiều consumer cùng đọc 1 queue, RabbitMQ tự chia việc (round-robin có `prefetch_count`), default exchange, manual ack, durable queue + persistent message.

### Kịch bản
Hệ thống xử lý ảnh: producer nhận yêu cầu "resize ảnh" và đẩy vào queue, nhiều worker cùng xử lý song song để tăng throughput.

### Cấu trúc thư mục

```
lab1-work-queue/
├── compose.yaml
├── producer/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── producer.py
└── worker/
    ├── Dockerfile
    ├── requirements.txt
    └── worker.py
```

### `producer/producer.py`

```python
import pika
import json
import time
import random
import sys

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()

    # Durable queue: tồn tại sau khi broker restart
    channel.queue_declare(queue='image_tasks', durable=True)

    task_id = 0
    while True:
        task_id += 1
        task = {
            "task_id": task_id,
            "image": f"photo_{task_id}.jpg",
            "operation": random.choice(["resize", "thumbnail", "watermark"])
        }
        body = json.dumps(task)

        channel.basic_publish(
            exchange='',                 # default exchange
            routing_key='image_tasks',   # = tên queue khi dùng default exchange
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,         # PERSISTENT message — bắt buộc để không mất khi broker restart
                content_type='application/json'
            )
        )
        print(f"[x] Sent task #{task_id}: {task['operation']} on {task['image']}")
        time.sleep(1)

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

def callback(ch, method, properties, body):
    task = json.loads(body)
    print(f"[{WORKER_NAME}] Received task #{task['task_id']}: {task['operation']} on {task['image']}")

    # Giả lập xử lý nặng — thời gian xử lý tỉ lệ với độ phức tạp giả định
    processing_time = random.uniform(1, 4)
    time.sleep(processing_time)

    print(f"[{WORKER_NAME}] Done task #{task['task_id']} in {processing_time:.1f}s")

    # CHỈ ack sau khi xử lý xong — nếu worker crash giữa chừng, message tự requeue
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.queue_declare(queue='image_tasks', durable=True)

    # Fair dispatch: mỗi worker chỉ nhận 1 task mới sau khi đã ack task trước
    channel.basic_qos(prefetch_count=1)

    channel.basic_consume(queue='image_tasks', on_message_callback=callback, auto_ack=False)

    print(f'[{WORKER_NAME}] Waiting for tasks...')
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `requirements.txt` (chung cho cả 2)

```
pika==1.3.2
```

### Dockerfile chung

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "producer.py"]
```

(worker dùng `CMD ["python", "worker.py"]` tương tự — sửa lại trong `worker/Dockerfile`)

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "5672:5672"      # AMQP port
      - "15672:15672"    # Management UI
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - mq_net

  producer:
    build: ./producer
    restart: unless-stopped
    depends_on:
      rabbitmq:
        condition: service_healthy
    networks:
      - mq_net

  worker:
    build: ./worker
    restart: unless-stopped
    environment:
      WORKER_NAME: worker
    depends_on:
      rabbitmq:
        condition: service_healthy
    networks:
      - mq_net
    deploy:
      replicas: 3        # chạy sẵn 3 worker (dùng `docker compose up --scale worker=3` nếu không hỗ trợ deploy.replicas trực tiếp)

networks:
  mq_net:
```

### Chạy lab

```bash
cd lab1-work-queue
docker compose up -d --build --scale worker=3
docker compose logs -f worker producer
```

### Kiểm tra qua Management UI

Mở `http://localhost:15672` (admin/admin123) → tab **Queues** → xem `image_tasks`, theo dõi message rate, số consumer đang attach.

### Bài tập mở rộng
1. Tắt 1 worker (`docker compose stop worker`) giữa lúc đang xử lý — quan sát message có bị mất không (phải KHÔNG mất nhờ manual ack).
2. So sánh `prefetch_count=1` vs `prefetch_count=50` khi có 3 worker tốc độ khác nhau (thêm `time.sleep` khác nhau mỗi worker) — quan sát độ công bằng phân việc.
3. Thử đổi `delivery_mode=2` thành `1`, restart RabbitMQ (`docker compose restart rabbitmq`) khi queue còn message chưa xử lý — quan sát message có mất không.

---

## LAB 2 — Publish/Subscribe (Fanout Exchange)

### Mục tiêu
Hiểu cách 1 message được **broadcast** tới nhiều consumer độc lập, mỗi consumer có queue riêng (thường là `exclusive` + `auto_delete`), dùng Fanout Exchange.

### Kịch bản
Hệ thống logging tập trung: mọi service gửi log vào 1 exchange, có 3 subscriber độc lập: **console logger** (in ra màn hình), **file logger** (ghi file), **alert service** (chỉ quan tâm xử lý cảnh báo — sẽ mở rộng ở Lab 3 dùng Direct Exchange).

### Cấu trúc thư mục

```
lab2-pubsub-fanout/
├── compose.yaml
├── publisher/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── publisher.py
├── console-logger/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── subscriber.py
└── file-logger/
    ├── Dockerfile
    ├── requirements.txt
    └── subscriber.py
```

### `publisher/publisher.py`

```python
import pika
import json
import time
import random

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()

    # Fanout exchange: bỏ qua routing key, broadcast tới TẤT CẢ queue đã bind
    channel.exchange_declare(exchange='logs_fanout', exchange_type='fanout', durable=True)

    levels = ["INFO", "WARNING", "ERROR"]
    counter = 0
    while True:
        counter += 1
        log = {
            "id": counter,
            "level": random.choice(levels),
            "message": f"Event number {counter} occurred",
            "timestamp": time.time()
        }
        channel.basic_publish(
            exchange='logs_fanout',
            routing_key='',          # KHÔNG quan trọng với fanout — broker bỏ qua giá trị này
            body=json.dumps(log)
        )
        print(f"[Publisher] Sent: {log}")
        time.sleep(2)

if __name__ == '__main__':
    main()
```

### `console-logger/subscriber.py`

```python
import pika
import json

def callback(ch, method, properties, body):
    log = json.loads(body)
    print(f"[Console] [{log['level']}] {log['message']}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='logs_fanout', exchange_type='fanout', durable=True)

    # Queue tạm: exclusive=True (chỉ connection này dùng), tên rỗng để broker tự sinh tên ngẫu nhiên
    result = channel.queue_declare(queue='', exclusive=True)
    queue_name = result.method.queue

    channel.queue_bind(exchange='logs_fanout', queue=queue_name)

    print('[Console Logger] Waiting for logs...')
    channel.basic_consume(queue=queue_name, on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `file-logger/subscriber.py`

```python
import pika
import json

LOG_FILE = "/app/logs/all_logs.txt"

def callback(ch, method, properties, body):
    log = json.loads(body)
    line = f"[{log['level']}] id={log['id']} msg={log['message']}\n"
    with open(LOG_FILE, "a") as f:
        f.write(line)
    print(f"[FileLogger] Wrote log #{log['id']} to file")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='logs_fanout', exchange_type='fanout', durable=True)

    result = channel.queue_declare(queue='', exclusive=True)
    queue_name = result.method.queue
    channel.queue_bind(exchange='logs_fanout', queue=queue_name)

    print('[File Logger] Waiting for logs...')
    channel.basic_consume(queue=queue_name, on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks:
      - mq_net

  publisher:
    build: ./publisher
    depends_on:
      rabbitmq:
        condition: service_healthy
    networks:
      - mq_net

  console-logger:
    build: ./console-logger
    depends_on:
      rabbitmq:
        condition: service_healthy
    networks:
      - mq_net

  file-logger:
    build: ./file-logger
    depends_on:
      rabbitmq:
        condition: service_healthy
    volumes:
      - file_logs:/app/logs
    networks:
      - mq_net

volumes:
  file_logs:

networks:
  mq_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
docker compose logs -f console-logger file-logger
docker compose exec file-logger cat /app/logs/all_logs.txt
```

### Bài tập mở rộng
1. Thêm subscriber thứ 3 chỉ in ra log có `level == ERROR` (vẫn nhận hết từ fanout rồi tự filter ở code — minh chứng fanout không filter được, cần chuyển sang Topic/Direct ở Lab 3-4).
2. Tắt `console-logger`, gửi vài message, rồi mở lại — quan sát các message gửi lúc tắt **có bị mất không** (queue `exclusive` tự xóa khi disconnect → mất hết, đây là đặc điểm cần lưu ý của exclusive queue).
3. Đổi `exclusive=True` thành `durable=True, exclusive=False` với tên cố định — quan sát message **không mất** dù subscriber offline tạm thời.

---

## LAB 3 — Routing có chọn lọc (Direct Exchange)

### Mục tiêu
Hiểu cách dùng Direct Exchange để **chỉ những consumer quan tâm** mới nhận message tương ứng, dựa trên routing key khớp chính xác.

### Kịch bản
Hệ thống log nâng cấp từ Lab 2: muốn **alert-service chỉ nhận log mức ERROR**, **console-logger nhận tất cả**, **file-logger chỉ ghi WARNING + ERROR** (không ghi INFO để giảm dung lượng).

### Cấu trúc thư mục

```
lab3-direct-routing/
├── compose.yaml
├── publisher/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── publisher.py
├── alert-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── subscriber.py
├── console-logger/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── subscriber.py
└── file-logger/
    ├── Dockerfile
    ├── requirements.txt
    └── subscriber.py
```

### `publisher/publisher.py`

```python
import pika
import json
import time
import random

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='logs_direct', exchange_type='direct', durable=True)

    levels = ["info", "warning", "error"]
    counter = 0
    while True:
        counter += 1
        level = random.choice(levels)
        log = {"id": counter, "level": level, "message": f"Event {counter}"}

        channel.basic_publish(
            exchange='logs_direct',
            routing_key=level,        # routing key = chính level — đây là chìa khóa của Direct Exchange
            body=json.dumps(log)
        )
        print(f"[Publisher] Sent [{level}]: {log}")
        time.sleep(1.5)

if __name__ == '__main__':
    main()
```

### `alert-service/subscriber.py` (chỉ bind với "error")

```python
import pika
import json

def callback(ch, method, properties, body):
    log = json.loads(body)
    print(f"🚨 [ALERT] Critical error #{log['id']}: {log['message']} -- Sending page to on-call!")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='logs_direct', exchange_type='direct', durable=True)

    channel.queue_declare(queue='alert_queue', durable=True)
    channel.queue_bind(exchange='logs_direct', queue='alert_queue', routing_key='error')

    print('[Alert Service] Waiting for ERROR logs only...')
    channel.basic_consume(queue='alert_queue', on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `file-logger/subscriber.py` (bind với cả "warning" và "error")

```python
import pika
import json

def callback(ch, method, properties, body):
    log = json.loads(body)
    with open("/app/logs/important.txt", "a") as f:
        f.write(f"[{log['level'].upper()}] {log['message']}\n")
    print(f"[FileLogger] Logged: {log}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='logs_direct', exchange_type='direct', durable=True)

    channel.queue_declare(queue='file_log_queue', durable=True)
    # 1 queue có thể bind NHIỀU routing key khác nhau
    channel.queue_bind(exchange='logs_direct', queue='file_log_queue', routing_key='warning')
    channel.queue_bind(exchange='logs_direct', queue='file_log_queue', routing_key='error')

    print('[File Logger] Waiting for WARNING + ERROR logs...')
    channel.basic_consume(queue='file_log_queue', on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `console-logger/subscriber.py` (bind cả 3 mức)

```python
import pika
import json

def callback(ch, method, properties, body):
    log = json.loads(body)
    print(f"[Console][{log['level'].upper()}] {log['message']}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='logs_direct', exchange_type='direct', durable=True)

    channel.queue_declare(queue='console_queue', durable=True)
    for level in ['info', 'warning', 'error']:
        channel.queue_bind(exchange='logs_direct', queue='console_queue', routing_key=level)

    print('[Console] Waiting for ALL logs...')
    channel.basic_consume(queue='console_queue', on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks: [mq_net]

  publisher:
    build: ./publisher
    depends_on:
      rabbitmq: { condition: service_healthy }
    networks: [mq_net]

  alert-service:
    build: ./alert-service
    depends_on:
      rabbitmq: { condition: service_healthy }
    networks: [mq_net]

  console-logger:
    build: ./console-logger
    depends_on:
      rabbitmq: { condition: service_healthy }
    networks: [mq_net]

  file-logger:
    build: ./file-logger
    depends_on:
      rabbitmq: { condition: service_healthy }
    volumes:
      - file_logs:/app/logs
    networks: [mq_net]

volumes:
  file_logs:

networks:
  mq_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
docker compose logs -f alert-service     # CHỈ thấy log error
docker compose logs -f file-logger       # thấy warning + error
docker compose logs -f console-logger    # thấy cả 3 loại
```

### Bài tập mở rộng
1. Thêm routing key mới `"critical"` cho lỗi nghiêm trọng hơn `"error"`, chỉ `alert-service` bind thêm key này.
2. Quan sát trong Management UI tab **Exchanges → logs_direct → Bindings** để thấy rõ sơ đồ binding.
3. Thử bind 2 queue khác nhau cùng 1 routing key — quan sát **cả 2 đều nhận được message** (Direct Exchange không giới hạn 1-queue-1-key).

---

## LAB 4 — Topic Exchange (Routing theo Pattern)

### Mục tiêu
Hiểu cách dùng wildcard `*` và `#` để định tuyến linh hoạt theo nhiều chiều — ví dụ điển hình nhất khi học RabbitMQ.

### Kịch bản
Hệ thống sự kiện e-commerce với routing key dạng `<domain>.<action>.<region>`, ví dụ: `order.created.vn`, `order.cancelled.us`, `payment.completed.vn`. Có 3 consumer:
- **VN Ops team**: quan tâm mọi sự kiện xảy ra ở `vn` (bất kể domain/action).
- **Order Audit**: quan tâm mọi sự kiện thuộc domain `order` (bất kể action/region).
- **Payment Monitor**: chỉ quan tâm `payment.completed.*` (mọi region).

### Cấu trúc thư mục

```
lab4-topic-exchange/
├── compose.yaml
├── publisher/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── publisher.py
├── vn-ops/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── subscriber.py
├── order-audit/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── subscriber.py
└── payment-monitor/
    ├── Dockerfile
    ├── requirements.txt
    └── subscriber.py
```

### `publisher/publisher.py`

```python
import pika
import json
import time
import random

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='events_topic', exchange_type='topic', durable=True)

    domains = ["order", "payment", "shipping"]
    actions = ["created", "completed", "cancelled"]
    regions = ["vn", "us", "sg"]

    counter = 0
    while True:
        counter += 1
        domain = random.choice(domains)
        action = random.choice(actions)
        region = random.choice(regions)
        routing_key = f"{domain}.{action}.{region}"

        event = {"id": counter, "routing_key": routing_key, "data": f"Event detail #{counter}"}
        channel.basic_publish(
            exchange='events_topic',
            routing_key=routing_key,
            body=json.dumps(event)
        )
        print(f"[Publisher] Sent [{routing_key}]: {event}")
        time.sleep(1)

if __name__ == '__main__':
    main()
```

### `vn-ops/subscriber.py` — bind pattern `#.vn` (mọi domain, mọi action, region=vn)

```python
import pika, json

def callback(ch, method, properties, body):
    event = json.loads(body)
    print(f"[VN-Ops] Matched '{method.routing_key}': {event}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='events_topic', exchange_type='topic', durable=True)
    channel.queue_declare(queue='vn_ops_queue', durable=True)
    channel.queue_bind(exchange='events_topic', queue='vn_ops_queue', routing_key='*.*.vn')

    print('[VN-Ops] Listening for *.*.vn ...')
    channel.basic_consume(queue='vn_ops_queue', on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `order-audit/subscriber.py` — bind pattern `order.#` (mọi action, mọi region, domain=order)

```python
import pika, json

def callback(ch, method, properties, body):
    event = json.loads(body)
    print(f"[Order-Audit] Matched '{method.routing_key}': {event}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='events_topic', exchange_type='topic', durable=True)
    channel.queue_declare(queue='order_audit_queue', durable=True)
    channel.queue_bind(exchange='events_topic', queue='order_audit_queue', routing_key='order.#')

    print('[Order-Audit] Listening for order.# ...')
    channel.basic_consume(queue='order_audit_queue', on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `payment-monitor/subscriber.py` — bind pattern `payment.completed.*`

```python
import pika, json

def callback(ch, method, properties, body):
    event = json.loads(body)
    print(f"[Payment-Monitor] Matched '{method.routing_key}': {event}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='events_topic', exchange_type='topic', durable=True)
    channel.queue_declare(queue='payment_monitor_queue', durable=True)
    channel.queue_bind(exchange='events_topic', queue='payment_monitor_queue', routing_key='payment.completed.*')

    print('[Payment-Monitor] Listening for payment.completed.* ...')
    channel.basic_consume(queue='payment_monitor_queue', on_message_callback=callback, auto_ack=False)
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks: [mq_net]

  publisher:
    build: ./publisher
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

  vn-ops:
    build: ./vn-ops
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

  order-audit:
    build: ./order-audit
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

  payment-monitor:
    build: ./payment-monitor
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

networks:
  mq_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
docker compose logs -f vn-ops order-audit payment-monitor
```

Quan sát: 1 event `order.created.vn` sẽ được **CẢ vn-ops VÀ order-audit** nhận (match cả 2 pattern), trong khi `payment.completed.us` chỉ `payment-monitor` nhận.

### Bài tập mở rộng
1. Thêm domain mới `shipping` với pattern riêng `shipping.*.sg`.
2. Viết 1 consumer "catch-all" bind pattern `#` — nhận tất cả mọi message, dùng để debug toàn hệ thống.
3. Thử bind pattern sai (`order.*.*.vn` — 4 phần trong khi key chỉ có 3) — quan sát không match được gì, hiểu rõ wildcard match đúng SỐ LƯỢNG từ.

---

## LAB 5 — RPC Pattern (Request/Reply)

### Mục tiêu
Hiểu cách dùng RabbitMQ để giao tiếp **đồng bộ giả lập** (request → chờ → response) giữa 2 service, dùng `correlation_id` + `reply_to` + exclusive callback queue.

### Kịch bản
Client cần gọi "Fibonacci Calculator Service" qua RabbitMQ thay vì HTTP — minh họa pattern RPC qua message broker (hữu ích khi muốn giữ toàn bộ giao tiếp nội bộ qua 1 kênh queue thống nhất, hoặc khi server không có địa chỉ mạng cố định).

### Cấu trúc thư mục

```
lab5-rpc-pattern/
├── compose.yaml
├── rpc-server/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── server.py
└── rpc-client/
    ├── Dockerfile
    ├── requirements.txt
    └── client.py
```

### `rpc-server/server.py`

```python
import pika
import json

def fib(n):
    if n == 0:
        return 0
    elif n == 1:
        return 1
    a, b = 0, 1
    for _ in range(n - 1):
        a, b = b, a + b
    return b

def on_request(ch, method, props, body):
    n = json.loads(body)['n']
    print(f"[Server] Computing fib({n})")
    result = fib(n)

    # Trả lời vào queue chỉ định bởi "reply_to", giữ nguyên correlation_id để client khớp đúng request
    ch.basic_publish(
        exchange='',
        routing_key=props.reply_to,
        properties=pika.BasicProperties(correlation_id=props.correlation_id),
        body=json.dumps({"n": n, "result": result})
    )
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.queue_declare(queue='rpc_fib_queue')

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue='rpc_fib_queue', on_message_callback=on_request)

    print("[Server] Awaiting RPC requests...")
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `rpc-client/client.py`

```python
import pika
import json
import uuid
import time

class FibonacciRpcClient:
    def __init__(self):
        self.connection = pika.BlockingConnection(
            pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
        )
        self.channel = self.connection.channel()

        # Exclusive callback queue: mỗi client instance có 1 queue riêng để nhận reply
        result = self.channel.queue_declare(queue='', exclusive=True)
        self.callback_queue = result.method.queue

        self.channel.basic_consume(
            queue=self.callback_queue,
            on_message_callback=self.on_response,
            auto_ack=True
        )

        self.response = None
        self.corr_id = None

    def on_response(self, ch, method, props, body):
        if self.corr_id == props.correlation_id:
            self.response = json.loads(body)

    def call(self, n):
        self.response = None
        self.corr_id = str(uuid.uuid4())

        self.channel.basic_publish(
            exchange='',
            routing_key='rpc_fib_queue',
            properties=pika.BasicProperties(
                reply_to=self.callback_queue,
                correlation_id=self.corr_id,
            ),
            body=json.dumps({"n": n})
        )

        # Chờ phản hồi (blocking, có timeout đơn giản qua process_data_events)
        timeout = time.time() + 10
        while self.response is None:
            self.connection.process_data_events()
            if time.time() > timeout:
                raise TimeoutError("RPC call timed out")
        return self.response

def main():
    client = FibonacciRpcClient()
    for n in [10, 20, 30]:
        print(f"[Client] Requesting fib({n})...")
        response = client.call(n)
        print(f"[Client] fib({response['n']}) = {response['result']}")
        time.sleep(2)

if __name__ == '__main__':
    main()
```

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks: [mq_net]

  rpc-server:
    build: ./rpc-server
    restart: unless-stopped
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]
    deploy:
      replicas: 2     # nhiều server cùng xử lý — RabbitMQ tự chia request (giống Work Queue)

  rpc-client:
    build: ./rpc-client
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

networks:
  mq_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build --scale rpc-server=2
docker compose logs -f rpc-client rpc-server
```

### Bài tập mở rộng
1. Thêm timeout & retry phía client khi server không phản hồi kịp.
2. Đo thời gian round-trip (`time.time()` trước/sau `call()`) và so sánh với gọi HTTP REST trực tiếp.
3. Thử nghiệm: khi có 2 `rpc-server`, gửi nhiều request liên tiếp — quan sát qua log xem request được chia đều cho 2 server như thế nào (giống Work Queue vì về bản chất RPC pattern = Work Queue + reply queue).

---

## LAB 6 — Dead Letter Queue + Retry với Delay

### Mục tiêu
Xây dựng pattern **retry tự động có độ trễ tăng dần (exponential backoff)** dùng TTL + DLX — kỹ thuật bắt buộc phải biết khi làm hệ thống xử lý lỗi trong thực tế production.

### Kịch bản
Service gọi API bên thứ 3 không ổn định (giả lập random fail 50%). Khi lỗi, message phải được **thử lại sau 5 giây**, tối đa 3 lần, nếu vẫn lỗi → đưa vào "queue lỗi cuối cùng" (final DLQ) để con người can thiệp.

### Sơ đồ luồng

```
[main_queue] --(xử lý lỗi: nack requeue=False)--> [retry_dlx] --> [retry_queue, TTL=5s]
                                                                          │
                                                          (hết TTL, KHÔNG có consumer trên retry_queue)
                                                                          ▼
                                                          [retry_dlx_back] --> [main_queue] (thử lại)

Nếu số lần retry > 3 (đếm qua header "x-retry-count") --> [final_dlq] (dừng retry, cần người xử lý)
```

### Cấu trúc thư mục

```
lab6-dlx-retry/
├── compose.yaml
├── setup/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── setup_topology.py
├── producer/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── producer.py
└── consumer/
    ├── Dockerfile
    ├── requirements.txt
    └── consumer.py
```

### `setup/setup_topology.py` (khai báo toàn bộ exchange/queue/binding 1 lần)

```python
import pika
import time

def main():
    # Chờ RabbitMQ sẵn sàng (dù đã có healthcheck, thêm retry cho chắc)
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()

    # ===== Main exchange & queue =====
    channel.exchange_declare(exchange='main_exchange', exchange_type='direct', durable=True)
    channel.queue_declare(
        queue='main_queue',
        durable=True,
        arguments={
            'x-dead-letter-exchange': 'retry_exchange',   # message bị nack -> sang đây
            'x-dead-letter-routing-key': 'retry'
        }
    )
    channel.queue_bind(exchange='main_exchange', queue='main_queue', routing_key='task')

    # ===== Retry exchange & queue (có TTL = thời gian delay trước khi thử lại) =====
    channel.exchange_declare(exchange='retry_exchange', exchange_type='direct', durable=True)
    channel.queue_declare(
        queue='retry_queue',
        durable=True,
        arguments={
            'x-message-ttl': 5000,                         # 5 giây delay
            'x-dead-letter-exchange': 'main_exchange',      # hết TTL -> quay lại main_exchange
            'x-dead-letter-routing-key': 'task'
        }
    )
    channel.queue_bind(exchange='retry_exchange', queue='retry_queue', routing_key='retry')

    # ===== Final DLQ — nơi message "bỏ cuộc" sau quá nhiều lần retry =====
    channel.exchange_declare(exchange='final_dlx', exchange_type='direct', durable=True)
    channel.queue_declare(queue='final_dlq', durable=True)
    channel.queue_bind(exchange='final_dlx', queue='final_dlq', routing_key='failed')

    print("Topology setup completed.")
    connection.close()

if __name__ == '__main__':
    main()
```

### `producer/producer.py`

```python
import pika
import json
import time

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()

    task_id = 0
    while True:
        task_id += 1
        body = json.dumps({"task_id": task_id, "payload": f"call-external-api-{task_id}"})
        channel.basic_publish(
            exchange='main_exchange',
            routing_key='task',
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,
                headers={'x-retry-count': 0}   # đếm số lần đã retry
            )
        )
        print(f"[Producer] Sent task #{task_id}")
        time.sleep(3)

if __name__ == '__main__':
    main()
```

### `consumer/consumer.py`

```python
import pika
import json
import random

MAX_RETRIES = 3

def callback(ch, method, properties, body):
    task = json.loads(body)
    headers = properties.headers or {}
    retry_count = headers.get('x-retry-count', 0)

    print(f"[Consumer] Processing task #{task['task_id']} (attempt {retry_count + 1})")

    # Giả lập gọi external API không ổn định
    success = random.random() > 0.5

    if success:
        print(f"[Consumer] Task #{task['task_id']} SUCCESS")
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    if retry_count >= MAX_RETRIES:
        print(f"[Consumer] Task #{task['task_id']} FAILED after {retry_count} retries -> final_dlq")
        # Publish thủ công vào final DLQ (vì DLX mặc định không tự đếm số lần)
        ch.basic_publish(
            exchange='final_dlx',
            routing_key='failed',
            body=body,
            properties=pika.BasicProperties(headers={'x-retry-count': retry_count})
        )
        ch.basic_ack(delivery_tag=method.delivery_tag)  # ack để xóa khỏi main_queue, đã chuyển sang final_dlq
        return

    print(f"[Consumer] Task #{task['task_id']} FAILED, will retry in 5s (attempt {retry_count + 1}/{MAX_RETRIES})")
    # Tăng retry_count rồi publish thủ công vào main_exchange với header mới
    # (Cách đơn giản nhất để "tăng" x-retry-count, vì DLX không tự cộng dồn header tùy biến)
    ch.basic_publish(
        exchange='',
        routing_key='retry_queue',
        body=body,
        properties=pika.BasicProperties(
            delivery_mode=2,
            headers={'x-retry-count': retry_count + 1}
        )
    )
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue='main_queue', on_message_callback=callback, auto_ack=False)

    print('[Consumer] Waiting for tasks...')
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

> **Lưu ý kỹ thuật quan trọng:** Cách đơn giản và tường minh nhất để tự kiểm soát số lần retry là **consumer tự publish lại** với header `x-retry-count` cập nhật (như code trên), thay vì hoàn toàn dựa vào cơ chế DLX tự động (DLX tự động rất tốt cho retry KHÔNG cần đếm số lần, nhưng để đếm + giới hạn số lần retry, cần logic ở application level như trên).

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks: [mq_net]

  setup:
    build: ./setup
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]
    restart: "no"     # chỉ chạy 1 lần để khai báo topology rồi exit

  producer:
    build: ./producer
    depends_on:
      rabbitmq: { condition: service_healthy }
      setup: { condition: service_completed_successfully }
    networks: [mq_net]

  consumer:
    build: ./consumer
    depends_on:
      rabbitmq: { condition: service_healthy }
      setup: { condition: service_completed_successfully }
    networks: [mq_net]

networks:
  mq_net:
```

### Chạy & kiểm tra

```bash
docker compose up -d --build
docker compose logs -f consumer
```

Mở Management UI (`http://localhost:15672`) → Queues → quan sát `main_queue`, `retry_queue`, `final_dlq` — thấy message "di chuyển" qua các queue theo thời gian thực.

### Bài tập mở rộng
1. Đổi delay từ cố định 5s thành **exponential backoff**: tạo 3 retry queue với TTL khác nhau (5s, 15s, 45s) tương ứng từng lần retry.
2. Viết 1 script riêng "drain final_dlq" — đọc message lỗi cuối cùng và gửi cảnh báo qua webhook/email.
3. Thêm giới hạn `x-max-length` cho `final_dlq` để tránh phình vô hạn nếu hệ thống lỗi kéo dài.

---

## LAB 7 — Microservices thực tế: Order → Inventory → Notification

### Mục tiêu
Kết hợp toàn bộ kiến thức (Topic Exchange, DLX, Publisher Confirms, healthcheck) vào 1 kịch bản microservices đầy đủ — gần nhất với hệ thống production thật.

### Kịch bản

```
[order-service] --publish "order.created"--> [Topic Exchange: ecommerce_events]
                                                       │
                          ┌────────────────────────────┼────────────────────────────┐
                          ▼                            ▼                            ▼
              [inventory_queue]              [notification_queue]          [analytics_queue]
              (bind: order.created)          (bind: order.*)               (bind: #)
                          │                            │                            │
              [inventory-service]          [notification-service]         [analytics-service]
              kiểm tra & trừ kho           gửi email xác nhận             ghi lại mọi event
                          │
              publish "inventory.reserved" hoặc "inventory.out_of_stock"
                          │
                          ▼
              [notification_queue] (bind thêm: inventory.*)
```

### Cấu trúc thư mục

```
lab7-microservices/
├── compose.yaml
├── order-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py
├── inventory-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py
├── notification-service/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py
└── analytics-service/
    ├── Dockerfile
    ├── requirements.txt
    └── app.py
```

### `order-service/app.py` (Flask API + publish event với Publisher Confirms)

```python
from flask import Flask, request, jsonify
import pika
import json
import threading

app = Flask(__name__)

def get_channel():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='ecommerce_events', exchange_type='topic', durable=True)
    channel.confirm_delivery()   # Publisher Confirms — đảm bảo broker nhận được
    return connection, channel

orders_db = {}
order_counter = 0
lock = threading.Lock()

@app.route('/health')
def health():
    return jsonify(status='ok')

@app.route('/orders', methods=['POST'])
def create_order():
    global order_counter
    data = request.json
    with lock:
        order_counter += 1
        order_id = order_counter

    order = {
        "order_id": order_id,
        "product": data.get('product'),
        "quantity": data.get('quantity', 1),
        "customer_email": data.get('customer_email')
    }
    orders_db[order_id] = order

    connection, channel = get_channel()
    try:
        channel.basic_publish(
            exchange='ecommerce_events',
            routing_key='order.created',
            body=json.dumps(order),
            properties=pika.BasicProperties(delivery_mode=2, content_type='application/json'),
            mandatory=True
        )
        print(f"[OrderService] Published order.created for order #{order_id}")
    except pika.exceptions.UnroutableError:
        return jsonify(error="Message could not be routed"), 500
    finally:
        connection.close()

    return jsonify(order), 201

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

### `inventory-service/app.py`

```python
import pika
import json
import random

def callback(ch, method, properties, body):
    order = json.loads(body)
    print(f"[Inventory] Checking stock for order #{order['order_id']}: {order['product']} x{order['quantity']}")

    in_stock = random.random() > 0.2   # giả lập 80% có hàng

    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    publish_channel = connection.channel()
    publish_channel.exchange_declare(exchange='ecommerce_events', exchange_type='topic', durable=True)

    if in_stock:
        routing_key = 'inventory.reserved'
        result = {**order, "status": "reserved"}
        print(f"[Inventory] Order #{order['order_id']} -> RESERVED")
    else:
        routing_key = 'inventory.out_of_stock'
        result = {**order, "status": "out_of_stock"}
        print(f"[Inventory] Order #{order['order_id']} -> OUT OF STOCK")

    publish_channel.basic_publish(
        exchange='ecommerce_events',
        routing_key=routing_key,
        body=json.dumps(result),
        properties=pika.BasicProperties(delivery_mode=2)
    )
    connection.close()

    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='ecommerce_events', exchange_type='topic', durable=True)
    channel.queue_declare(queue='inventory_queue', durable=True)
    channel.queue_bind(exchange='ecommerce_events', queue='inventory_queue', routing_key='order.created')

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue='inventory_queue', on_message_callback=callback, auto_ack=False)

    print('[Inventory Service] Waiting for order.created events...')
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `notification-service/app.py`

```python
import pika
import json

def callback(ch, method, properties, body):
    event = json.loads(body)
    rk = method.routing_key

    if rk == 'order.created':
        print(f"[Notification] 📧 Email to {event.get('customer_email')}: Order #{event['order_id']} received, processing...")
    elif rk == 'inventory.reserved':
        print(f"[Notification] 📧 Email: Order #{event['order_id']} confirmed, preparing shipment!")
    elif rk == 'inventory.out_of_stock':
        print(f"[Notification] 📧 Email: Sorry, order #{event['order_id']} is out of stock.")

    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='ecommerce_events', exchange_type='topic', durable=True)
    channel.queue_declare(queue='notification_queue', durable=True)

    # Bind nhiều pattern — quan tâm cả order.* và inventory.*
    channel.queue_bind(exchange='ecommerce_events', queue='notification_queue', routing_key='order.*')
    channel.queue_bind(exchange='ecommerce_events', queue='notification_queue', routing_key='inventory.*')

    channel.basic_consume(queue='notification_queue', on_message_callback=callback, auto_ack=False)
    print('[Notification Service] Waiting for order.* and inventory.* events...')
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `analytics-service/app.py` (catch-all, ghi lại mọi event)

```python
import pika
import json

def callback(ch, method, properties, body):
    event = json.loads(body)
    print(f"[Analytics] Logged event '{method.routing_key}': {event}")
    ch.basic_ack(delivery_tag=method.delivery_tag)

def main():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('admin', 'admin123'))
    )
    channel = connection.channel()
    channel.exchange_declare(exchange='ecommerce_events', exchange_type='topic', durable=True)
    channel.queue_declare(queue='analytics_queue', durable=True)
    channel.queue_bind(exchange='ecommerce_events', queue='analytics_queue', routing_key='#')

    channel.basic_consume(queue='analytics_queue', on_message_callback=callback, auto_ack=False)
    print('[Analytics Service] Logging ALL events (#)...')
    channel.start_consuming()

if __name__ == '__main__':
    main()
```

### `compose.yaml`

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
    ports:
      - "5672:5672"
      - "15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    networks: [mq_net]

  order-service:
    build: ./order-service
    restart: unless-stopped
    ports:
      - "5000:5000"
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

  inventory-service:
    build: ./inventory-service
    restart: unless-stopped
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

  notification-service:
    build: ./notification-service
    restart: unless-stopped
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

  analytics-service:
    build: ./analytics-service
    restart: unless-stopped
    depends_on: { rabbitmq: { condition: service_healthy } }
    networks: [mq_net]

networks:
  mq_net:
```

### Chạy & kiểm tra end-to-end

```bash
docker compose up -d --build
docker compose logs -f inventory-service notification-service analytics-service

curl -X POST http://localhost:5000/orders \
  -H "Content-Type: application/json" \
  -d '{"product":"Laptop Dell XPS","quantity":1,"customer_email":"customer@example.com"}'
```

Quan sát log: `order-service` publish → `inventory-service` nhận và publish tiếp → `notification-service` nhận **2 lần** (lúc tạo order, lúc inventory phản hồi) → `analytics-service` nhận **mọi event**.

### Bài tập mở rộng
1. Thêm `payment-service` lắng nghe `inventory.reserved` để giả lập trừ tiền, publish `payment.completed`.
2. Thêm DLX cho `inventory_queue` — nếu inventory-service crash giữa lúc xử lý, đảm bảo order không bị mất.
3. Viết script load test gửi 100 order liên tiếp, scale `inventory-service` lên 3 replicas, đo thời gian xử lý hết toàn bộ.

---

## LAB 8 — Cluster RabbitMQ 3 node + HA Queue

### Mục tiêu
Dựng cluster RabbitMQ 3 node bằng Docker Compose, dùng Quorum Queue để đảm bảo dữ liệu vẫn an toàn khi 1 node chết — mô phỏng kiến trúc HA thực tế.

### Kịch bản
3 node RabbitMQ (`rabbit1`, `rabbit2`, `rabbit3`) join thành 1 cluster, queue khai báo kiểu `quorum` (replicate qua Raft). Producer/consumer kết nối qua node bất kỳ vẫn thấy chung dữ liệu.

### Cấu trúc thư mục

```
lab8-cluster-ha/
├── compose.yaml
├── .erlang.cookie          # Bắt buộc: PHẢI giống nhau trên mọi node để join cluster
├── client/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── test_client.py
```

### `.erlang.cookie`

```
SECRETCOOKIESTRINGFORCLUSTERAUTH123
```

> File này đóng vai trò "chìa khóa bí mật" để các node Erlang (RabbitMQ chạy trên Erlang VM) tin tưởng lẫn nhau. **Phải giống bit-for-bit trên mọi node** và **permission 400** (chỉ owner đọc được) trên Linux thật — trong Docker dùng bind mount để đảm bảo đồng nhất.

### `client/test_client.py` — script test publish/consume + kiểm tra failover

```python
import pika
import json
import time
import sys

def get_connection(host):
    return pika.BlockingConnection(
        pika.ConnectionParameters(host=host, credentials=pika.PlainCredentials('admin', 'admin123'))
    )

def setup_and_publish(host, count=20):
    connection = get_connection(host)
    channel = connection.channel()
    channel.queue_declare(
        queue='ha_test_queue',
        durable=True,
        arguments={'x-queue-type': 'quorum'}   # QUORUM QUEUE — replicate qua Raft, sống sót khi mất node
    )
    for i in range(count):
        channel.basic_publish(
            exchange='',
            routing_key='ha_test_queue',
            body=json.dumps({"seq": i}),
            properties=pika.BasicProperties(delivery_mode=2)
        )
    print(f"Published {count} messages via {host}")
    connection.close()

def consume_all(host):
    connection = get_connection(host)
    channel = connection.channel()
    channel.queue_declare(queue='ha_test_queue', durable=True, arguments={'x-queue-type': 'quorum'})

    received = []
    def callback(ch, method, properties, body):
        received.append(json.loads(body))
        ch.basic_ack(delivery_tag=method.delivery_tag)
        if len(received) >= 20:
            ch.stop_consuming()

    channel.basic_consume(queue='ha_test_queue', on_message_callback=callback, auto_ack=False)
    print(f"Consuming via {host} ...")
    channel.start_consuming()
    print(f"Received {len(received)} messages: {received}")
    connection.close()

if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else 'publish'
    host = sys.argv[2] if len(sys.argv) > 2 else 'rabbit1'

    if action == 'publish':
        setup_and_publish(host)
    elif action == 'consume':
        consume_all(host)
```

### `compose.yaml`

```yaml
services:
  rabbit1:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit1
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
      RABBITMQ_ERLANG_COOKIE: "SECRETCOOKIESTRINGFORCLUSTERAUTH123"
    volumes:
      - rabbit1_data:/var/lib/rabbitmq
    ports:
      - "15672:15672"
    networks:
      cluster_net:
        aliases: [rabbit1]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  rabbit2:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit2
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
      RABBITMQ_ERLANG_COOKIE: "SECRETCOOKIESTRINGFORCLUSTERAUTH123"
    volumes:
      - rabbit2_data:/var/lib/rabbitmq
    ports:
      - "15673:15672"
    networks:
      cluster_net:
        aliases: [rabbit2]
    depends_on:
      rabbit1:
        condition: service_healthy
    command: >
      bash -c "
        (sleep 10 &&
         rabbitmqctl stop_app &&
         rabbitmqctl join_cluster rabbit@rabbit1 &&
         rabbitmqctl start_app) &
        rabbitmq-server
      "

  rabbit3:
    image: rabbitmq:3.13-management-alpine
    hostname: rabbit3
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
      RABBITMQ_ERLANG_COOKIE: "SECRETCOOKIESTRINGFORCLUSTERAUTH123"
    volumes:
      - rabbit3_data:/var/lib/rabbitmq
    ports:
      - "15674:15672"
    networks:
      cluster_net:
        aliases: [rabbit3]
    depends_on:
      rabbit1:
        condition: service_healthy
    command: >
      bash -c "
        (sleep 15 &&
         rabbitmqctl stop_app &&
         rabbitmqctl join_cluster rabbit@rabbit1 &&
         rabbitmqctl start_app) &
        rabbitmq-server
      "

  client:
    build: ./client
    depends_on:
      - rabbit1
      - rabbit2
      - rabbit3
    networks:
      cluster_net:

volumes:
  rabbit1_data:
  rabbit2_data:
  rabbit3_data:

networks:
  cluster_net:
```

> **Ghi chú quan trọng:** Cách join cluster qua `command:` với `sleep` là cách đơn giản để demo/lab. Trong production thật, nên dùng `rabbitmq-cluster-operator` (nếu chạy trên Kubernetes), hoặc cấu hình `definitions.json` + `cluster_formation` qua `rabbitmq.conf` để tự động join chuẩn hơn, không phụ thuộc `sleep`.

### Chạy lab

```bash
cd lab8-cluster-ha
docker compose up -d
sleep 25                          # đợi cluster join xong
docker compose exec rabbit1 rabbitmqctl cluster_status
```

### Test publish/consume qua cluster

```bash
docker compose exec client python test_client.py publish rabbit1
docker compose exec client python test_client.py consume rabbit2    # consume qua NODE KHÁC vẫn thấy data
```

### Test failover (mô phỏng mất node)

```bash
# Publish 20 message qua rabbit1
docker compose exec client python test_client.py publish rabbit1

# Giả lập rabbit1 chết (node đang giữ phần lớn leader của quorum queue)
docker compose stop rabbit1

# Vẫn consume được đầy đủ message qua rabbit2 (Quorum Queue đã replicate, tự bầu leader mới)
docker compose exec client python test_client.py consume rabbit2

# Khởi động lại rabbit1, kiểm tra nó tự rejoin cluster
docker compose start rabbit1
docker compose exec rabbit2 rabbitmqctl cluster_status
```

### Bài tập mở rộng
1. Thêm HAProxy đứng trước 3 node, cấu hình healthcheck để client chỉ cần connect 1 endpoint duy nhất.
2. So sánh hành vi khi dùng `x-queue-type: classic` (không replicate) vs `quorum` trong cùng bài test failover trên — quan sát classic queue **mất toàn bộ message** khi node giữ nó chết.
3. Tìm hiểu thêm `rabbitmqctl list_queues name type leader members` để xem queue đang có leader ở node nào.

---

## 21. Troubleshooting Thường Gặp

| Vấn đề | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `ConnectionRefusedError` lúc app start | RabbitMQ chưa kịp sẵn sàng khi container app start | Dùng `healthcheck` + `depends_on.condition: service_healthy`, hoặc retry connect trong code |
| Message "biến mất" không rõ lý do | Quên `durable=True` ở queue **hoặc** `delivery_mode=2` ở message (cần CẢ HAI) | Kiểm tra lại cả 2 phía, xem mục 4.2 |
| Consumer nhận message nhưng không xử lý gì (im lặng) | Quên gọi `channel.start_consuming()`, hoặc exception trong callback làm channel bị đóng ngầm | Bọc callback trong `try/except`, log lỗi rõ ràng, luôn ack/nack dù lỗi |
| Queue phình to liên tục, RAM tăng dần | Không có consumer, hoặc consumer xử lý chậm hơn tốc độ publish, không giới hạn `x-max-length` | Thêm consumer, scale worker, hoặc giới hạn `x-max-length` + DLX |
| `PRECONDITION_FAILED - inequivalent arg` khi `queue_declare` | Khai báo lại queue đã tồn tại với `arguments` khác trước (vd: đổi TTL) | Xóa queue cũ (`rabbitmqctl delete_queue` hoặc qua UI) rồi khai báo lại, hoặc đổi tên queue mới |
| 1 consumer "ăn hết" toàn bộ message, consumer khác rảnh | Không set `prefetch_count`, hoặc network latency cao khiến round-robin lệch | `channel.basic_qos(prefetch_count=1)` |
| Message bị requeue lặp vô hạn (consumer cứ nack rồi nhận lại ngay) | `basic_nack(requeue=True)` khi lỗi do CODE (không do dữ liệu) — message luôn lỗi lại | Đổi sang `requeue=False` + DLX, không retry vô hạn ngay tại chỗ |
| Không join được cluster (`rabbitmqctl join_cluster`) | `.erlang.cookie` không khớp giữa các node, hoặc hostname không phân giải được | Đảm bảo cookie giống nhau, dùng `hostname:` cố định + cùng network Docker |
| Management UI báo "blocked" trên connection | RabbitMQ kích hoạt **flow control** vì hết RAM/đĩa (memory/disk alarm) | Kiểm tra `rabbitmqctl status`, tăng resource hoặc giảm tải, dọn message tồn đọng |
| `UnroutableError` khi publish | Routing key không khớp với binding nào (message "rơi vào hư không") | Kiểm tra lại exchange type, routing key, binding; dùng `mandatory=True` để phát hiện sớm |

---

## 22. Cheat Sheet Tổng Hợp

```bash
# === QUẢN LÝ QUEUE/EXCHANGE QUA CLI (trong container) ===
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers
docker compose exec rabbitmq rabbitmqctl list_exchanges name type
docker compose exec rabbitmq rabbitmqctl list_bindings
docker compose exec rabbitmq rabbitmqctl list_connections
docker compose exec rabbitmq rabbitmqctl list_channels

# === USER & PERMISSION ===
docker compose exec rabbitmq rabbitmqctl add_user myuser mypass
docker compose exec rabbitmq rabbitmqctl set_user_tags myuser administrator
docker compose exec rabbitmq rabbitmqctl set_permissions -p / myuser ".*" ".*" ".*"
docker compose exec rabbitmq rabbitmqctl delete_user guest    # nên xóa user guest mặc định trên production

# === CLUSTER ===
docker compose exec rabbitmq rabbitmqctl cluster_status
docker compose exec rabbitmq rabbitmqctl join_cluster rabbit@rabbit1
docker compose exec rabbitmq rabbitmqctl list_queues name type leader members

# === XÓA / RESET ===
docker compose exec rabbitmq rabbitmqctl purge_queue my_queue       # xóa hết message, giữ queue
docker compose exec rabbitmq rabbitmqctl delete_queue my_queue      # xóa luôn queue

# === MANAGEMENT PLUGIN ===
docker compose exec rabbitmq rabbitmq-plugins list
docker compose exec rabbitmq rabbitmq-plugins enable rabbitmq_management
docker compose exec rabbitmq rabbitmq-plugins enable rabbitmq_prometheus
```

### Snippet pika (Python) hay dùng nhất

```python
# Kết nối cơ bản
import pika
connection = pika.BlockingConnection(
    pika.ConnectionParameters(host='rabbitmq', credentials=pika.PlainCredentials('user', 'pass'))
)
channel = connection.channel()

# Khai báo durable queue
channel.queue_declare(queue='q', durable=True)

# Publish persistent message
channel.basic_publish(
    exchange='', routing_key='q', body=b'hello',
    properties=pika.BasicProperties(delivery_mode=2)
)

# Consume với manual ack + fair dispatch
channel.basic_qos(prefetch_count=1)
def cb(ch, method, props, body):
    print(body)
    ch.basic_ack(delivery_tag=method.delivery_tag)
channel.basic_consume(queue='q', on_message_callback=cb, auto_ack=False)
channel.start_consuming()

# Publisher confirms
channel.confirm_delivery()
try:
    channel.basic_publish(exchange='ex', routing_key='rk', body=b'x', mandatory=True)
except pika.exceptions.UnroutableError:
    print("Message returned - không route được")
```

### Quy tắc vàng cần nhớ

1. Producer **không bao giờ** gửi trực tiếp vào Queue — luôn qua **Exchange**.
2. Muốn message **không mất** khi broker restart → cần **CẢ** `durable=True` (queue) **VÀ** `delivery_mode=2` (message).
3. Production **luôn** `auto_ack=False` + ack thủ công sau khi xử lý xong.
4. **Luôn** cấu hình DLX cho queue quan trọng — không để message lỗi biến mất âm thầm.
5. `prefetch_count` kiểm soát độ công bằng phân việc — đừng để mặc định không giới hạn.
6. HA thật cần **Quorum Queue**, không phải Classic Queue (Classic Mirrored Queue đã deprecated).
7. 1 Connection — nhiều Channel. Đừng tạo connection mới cho mỗi message.
8. Chọn đúng Exchange type theo nhu cầu routing: `direct` (exact) / `fanout` (broadcast) / `topic` (pattern) / `headers` (metadata phức tạp).

---

*Hết tài liệu — chúc bạn thực hành RabbitMQ hiệu quả!*
