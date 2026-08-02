# Lab Kafka và Elasticsearch bằng Docker Compose

Tài liệu này gồm ba phần có thể thực hành độc lập:

1. [Lab riêng Apache Kafka bằng Docker Compose](./KAFKA-LAB.md), gồm cấu hình KRaft và các cơ chế cốt lõi.
2. [Lab riêng Elasticsearch bằng Docker Compose](./ELASTICSEARCH-LAB.md), từ REST API cơ bản đến shard, failover và backup.
3. Project `Customer Event Search`: nhận sự kiện khách hàng, truyền qua Kafka, index vào Elasticsearch và cung cấp giao diện tìm kiếm gần thời gian thực.

> Phạm vi: môi trường học tập chạy trực tiếp bằng **Docker Compose trên một máy**, không phải cấu hình production. Lab cố ý tắt authentication/TLS của Elasticsearch và dùng Kafka `PLAINTEXT`. Không mở các cổng này ra Internet.

## 1. Kết quả cần đạt

Sau khi hoàn thành, người học phải giải thích và chứng minh được:

- Kafka lưu event theo `topic → partition → offset`; key ảnh hưởng đến partition và thứ tự.
- Consumer group chia partition cho các consumer, commit offset và tạo consumer lag.
- Ý nghĩa của `acks`, idempotent producer, retention, replay, at-least-once và DLQ.
- KRaft quản lý metadata Kafka mà không cần ZooKeeper.
- Elasticsearch lưu JSON document trong index, dùng mapping, analyzer và inverted index.
- Khác biệt giữa `text` và `keyword`, query và filter, full-text score và aggregation.
- Cơ chế near real-time, shard, replica, translog, refresh, flush và idempotent indexing.
- Luồng tích hợp bất đồng bộ Kafka → consumer → Elasticsearch và cách hệ thống phục hồi khi một dịch vụ gián đoạn.

## 2. Thành phần project

| Thành phần | Vai trò | Cổng trên host |
|---|---|---:|
| Kafka 4.3.1 | Ba broker kiêm KRaft controller, quorum 3 node | `9092–9094` |
| Elasticsearch 8.19.19 | Ba node master/data, mỗi shard có ba bản dữ liệu | `9200–9202` |
| API Node.js | Producer Kafka và Search API | `3000` |
| Indexer Node.js | Consumer group, validate, index và DLQ | không publish |
| Nginx | Web UI và reverse proxy `/api` | `8080` |

Các image đã được pin phiên bản để kết quả lab có thể lặp lại. Phiên bản tham khảo tại thời điểm viết tài liệu; khi nâng phiên bản cần đọc breaking changes trước.

Ba container không đồng nghĩa ba máy vật lý: lab chứng minh process/node failure, election, replication và recovery, nhưng cả cluster vẫn chung một Docker host, ổ đĩa và nguồn điện. `cluster.initial_master_nodes` được giữ để có thể bootstrap lại sau `down -v`; production chỉ dùng thiết lập này khi bootstrap cluster lần đầu và không tự ý thay danh sách trên cluster đã có dữ liệu.

```text
Trình duyệt / curl
       |
       v
  Nginx :8080
       |
       v
 API :3000 -- produce(key=userId) --> Kafka topic: customer-events
       |                                      | 6 partitions, RF=3, min ISR=2
       | search                               v
       +-------------------------- Indexer consumer group
                                      |  PUT _doc/{event.id}
                                      v
                           Elasticsearch cluster: customer-events-v1
                                      ^
                                      |
                              full-text + filter + agg

Record sai schema ------> topic customer-events-dlq
Elasticsearch tạm lỗi --> KHÔNG commit offset; container restart và đọc lại
```

Project dùng `event.id` làm Elasticsearch `_id`. Nếu Kafka giao lại cùng một event theo cơ chế at-least-once, lệnh `PUT _doc/{event.id}` ghi đè document cũ thay vì tạo bản sao. Đây là idempotent consumer ở mức ứng dụng.

## 3. Chuẩn bị máy chạy Docker Compose

### 3.1. Tài nguyên và cổng

Máy học tập nên có:

- CPU 64-bit, tối thiểu 4 logical CPU; bật hardware virtualization nếu Docker Desktop yêu cầu.
- Cấp tối thiểu 10 GB RAM cho Docker; khuyến nghị máy có tổng RAM từ 16 GB.
- Tối thiểu 25 GB đĩa trống để tải image, build application, Kafka log và Elasticsearch shard.
- Các cổng `8080`, `3000`, `9092–9094`, `9200–9202` chưa bị chương trình khác chiếm.

Kiểm tra cổng trên Windows PowerShell:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -In 8080,3000,9092,9093,9094,9200,9201,9202 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Kiểm tra trên Linux/macOS:

```bash
ss -lnt 2>/dev/null | grep -E ':(3000|8080|9092|9093|9094|9200|9201|9202)\b' || true
```

Nếu có xung đột, dừng ứng dụng đang dùng cổng hoặc sửa các biến `APP_PORT`, `WEB_PORT`, `ES_PORT`, `ES_PORT_2`, `ES_PORT_3` trong `.env`. Các cổng Kafka host gắn với `advertised.listeners`; không đổi riêng port mapping nếu chưa sửa đồng thời advertised listener tương ứng.

Với máy ít RAM, có thể đổi `ES_JAVA_OPTS` trong `docker-compose.yml` khi chạy project hoặc trong `docker-compose.elasticsearch.yml` khi chạy lab thành `-Xms512m -Xmx512m`; không giảm dưới mức này và không chạy các bài tải lớn. Không nên bỏ node vì các bài failover cần đủ quorum/replica thật.

> 📸 **BÁO CÁO 01:** Chụp thông tin CPU/RAM của máy và kết quả kiểm tra tám cổng. Ghi hệ điều hành đang dùng.

### 3.2. Cài Docker Compose

#### Windows hoặc macOS

Cài Docker Desktop, chọn backend WSL 2 trên Windows, sau đó mở Docker Desktop và chờ Engine ở trạng thái `Running`. Trong Docker Desktop, cấp đủ RAM/CPU tại phần Resources nếu phiên bản đang dùng hiển thị mục này.

Kiểm tra bằng PowerShell hoặc Terminal:

```powershell
docker --version
docker compose version
docker info --format '{{.ServerVersion}}'
```

#### Ubuntu/Debian

Cài Docker Engine từ repository chính thức:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git jq
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
```

Kiểm tra:

```bash
docker --version
docker compose version
docker info --format '{{.ServerVersion}}'
```

Kết quả mong đợi: cả client, Compose plugin và Docker Engine đều trả về phiên bản; lệnh `docker info` không báo lỗi kết nối daemon.

> 📸 **BÁO CÁO 02:** Chụp ba kết quả kiểm tra. Ghi rõ đang dùng Docker Desktop hay Docker Engine native.

### 3.3. Thiết lập kernel cho Elasticsearch

Trên Linux native, đặt `vm.max_map_count` vĩnh viễn:

```bash
echo 'vm.max_map_count=1048576' \
  | sudo tee /etc/sysctl.d/99-elasticsearch.conf
sudo sysctl --system
sysctl vm.max_map_count
```

Trên Docker Desktop, hãy thử chạy stack trước vì môi trường Linux nội bộ thường đã có giá trị phù hợp. Nếu Elasticsearch log lỗi `vm.max_map_count`, chạy trên Windows PowerShell:

```powershell
wsl -d docker-desktop -u root sysctl -w vm.max_map_count=1048576
```

Sau khi Docker Desktop khởi động lại, có thể cần áp dụng lại tùy phiên bản. Trên macOS Docker Desktop, dùng cơ chế cấu hình kernel tương ứng của phiên bản đang cài hoặc xem hướng dẫn Elastic được liên kết cuối tài liệu.

> 📸 **BÁO CÁO 03:** Chụp giá trị `vm.max_map_count`. Ghi lý do phải tăng: Lucene sử dụng nhiều vùng ánh xạ bộ nhớ cho các segment.

### 3.4. Lấy source và tạo cấu hình môi trường

Nếu chưa có source:

```bash
git clone <URL_REPOSITORY>
cd VCS-Learn-main/kafka-elasticsearch-lab
cp .env.example .env
```

Nếu đang dùng PowerShell trong repo hiện tại:

```powershell
Set-Location F:\VCS-Learn-main\kafka-elasticsearch-lab
Copy-Item .env.example .env
```

Mở `.env` và giữ cấu hình mặc định cho lần chạy đầu:

```dotenv
KAFKA_VERSION=4.3.1
ELASTIC_VERSION=8.19.19
APP_PORT=3000
WEB_PORT=8080
ES_PORT=9200
ES_PORT_2=9201
ES_PORT_3=9202
```

Dữ liệu Kafka và Elasticsearch được giữ trong Docker named volume, không ghi trực tiếp vào thư mục source.

Các khối lệnh trong [lab Kafka riêng](./KAFKA-LAB.md), [lab Elasticsearch riêng](./ELASTICSEARCH-LAB.md) và phần C dùng cú pháp Bash để tránh lặp lại mỗi thao tác hai lần. Trên Windows, có thể dùng WSL terminal đã bật Docker Desktop integration:

```bash
sudo apt-get update && sudo apt-get install -y curl jq
cd /mnt/f/VCS-Learn-main/kafka-elasticsearch-lab
```

Lệnh quản lý stack cơ bản (`docker compose up`, `ps`, `logs`, `down`) chạy giống nhau trong PowerShell. Riêng thao tác nạp dữ liệu mẫu đã có cả hai phiên bản:

```bash
bash scripts/seed-events.sh
```

```powershell
.\scripts\seed-events.ps1
```

## 4. Khởi động nền tảng lab

Tại thư mục `kafka-elasticsearch-lab` trên máy đang chạy Docker:

```bash
docker compose config --quiet
docker compose pull
docker compose build api indexer
docker compose up -d
docker compose ps
```

Lần đầu có thể mất vài phút để tải image và bầu quorum. Chờ ba Kafka, ba Elasticsearch, API, indexer và web ở trạng thái `healthy` hoặc `running`; `kafka-init` phải `Exited (0)`:

```bash
watch -n 2 'docker compose ps'
```

Nhấn `Ctrl+C` để thoát `watch`, rồi kiểm tra:

```bash
curl -s http://localhost:8080/api/health | jq
curl -s http://localhost:9200 | jq '{name,cluster_name,version:.version.number}'
docker compose logs --tail=30 indexer
```

Trên PowerShell không có `watch`, chạy lại `docker compose ps` sau vài giây và kiểm tra JSON bằng:

```powershell
docker compose ps
Invoke-RestMethod http://localhost:8080/api/health | ConvertTo-Json
Invoke-RestMethod http://localhost:9200 |
  Select-Object name,cluster_name,@{Name='version';Expression={$_.version.number}}
docker compose logs --tail=30 indexer
```

Mở giao diện tại:

```text
http://localhost:8080
```

> 📸 **BÁO CÁO 04:** Chụp `docker compose ps`, JSON health và trang `http://localhost:8080`. Khi đủ ba node, ảnh phải thể hiện Kafka connected và Elasticsearch green.

---

# Phần A — Lab riêng Apache Kafka

Phần lab Kafka đã được tách thành tài liệu độc lập: [KAFKA-LAB.md](./KAFKA-LAB.md).

Tài liệu riêng dùng [docker-compose.kafka.yml](./docker-compose.kafka.yml), bao gồm cụm Kafka/KRaft, profile Kafka–ZooKeeper tương thích, giải thích setting và toàn bộ bài thực hành A0–A14.

Trong lab Kafka, chỉ khởi động broker và tự tạo topic bằng Kafka CLI. Service `kafka-init` chỉ thuộc luồng chạy project tích hợp bên dưới, nơi API/indexer cần các topic ứng dụng được bootstrap tự động.

---

# Phần B — Lab riêng Elasticsearch

Phần lab Elasticsearch đã được tách thành tài liệu độc lập: [ELASTICSEARCH-LAB.md](./ELASTICSEARCH-LAB.md).

Tài liệu riêng dùng [docker-compose.elasticsearch.yml](./docker-compose.elasticsearch.yml), bao gồm cluster ba node, giải thích setting, sơ đồ khái quát và toàn bộ bài B0–B16 từ cơ bản đến trung cấp.

---

# Phần C — Project Customer Event Search

## C1. Đọc source trước khi chạy bài

| File | Nội dung cần đọc |
|---|---|
| `docker-compose.yml` | Cụm 3 Kafka, cụm 3 Elasticsearch, topic init, replica, volume và healthcheck |
| `service/src/api.js` | Validate request, producer key/acks và Elasticsearch Query DSL |
| `service/src/indexer.js` | Mapping, consumer group, manual commit, retry và DLQ |
| `service/src/lib.js` | Kafka config và wrapper Elasticsearch REST |
| `web/` | UI và Nginx reverse proxy |
| `scripts/seed-events.sh` | Bộ dữ liệu kiểm thử |

## C2. Kịch bản 1 — Luồng end-to-end

Gửi một event qua API:

```bash
curl -s -X POST localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -d '{
    "userId":"report-user-01",
    "eventType":"purchase",
    "title":"Mua tai nghe chống ồn",
    "description":"Thanh toán đơn hàng trong phòng lab",
    "category":"electronics",
    "amount":1990000
  }' | tee /tmp/published-event.json | jq
```

Lưu ý `partition`, `baseOffset` và `event.id`. Đợi refresh rồi tìm:

```bash
sleep 2
curl -s 'localhost:8080/api/search?q=tai%20nghe&userId=report-user-01' \
  | jq '{total,took,items}'
```

Theo dõi indexer:

```bash
docker compose logs --tail=50 indexer
```

Đường đi cần trình bày: HTTP 202 chỉ xác nhận Kafka đã nhận event; nó không đồng nghĩa Elasticsearch đã index. Consumer xử lý bất đồng bộ, nên search có độ trễ nhỏ.

> 📸 **BÁO CÁO C2:** Chụp JSON publish có partition/offset, log indexer cùng offset và search result có metadata Kafka tương ứng.

## C3. Kịch bản 2 — Chứng minh key quyết định partition

Gửi nhiều event cho hai user:

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST localhost:8080/api/events \
    -H 'Content-Type: application/json' \
    -d "{\"userId\":\"same-user\",\"eventType\":\"view\",\"title\":\"Event $i cùng user\",\"description\":\"partition test\",\"category\":\"lab\",\"amount\":0}" \
    | jq '{partition:.kafka.partition,offset:.kafka.baseOffset}'
done
```

Tất cả event `same-user` phải cùng partition; offset tăng dần trong partition đó. Nếu muốn quan sát phân bố đủ sáu partition, gửi thêm nhiều user ID khác nhau.

> 📸 **BÁO CÁO C3:** Chụp 5 kết quả và khoanh cùng partition/các offset tăng. Ghi Kafka chỉ giữ thứ tự theo partition.

## C4. Kịch bản 3 — Tạo backlog và quan sát consumer lag

Tạm dừng indexer nhưng giữ Kafka/API:

```bash
docker compose stop indexer
bash scripts/seed-events.sh

docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --group elasticsearch-indexers
```

Nếu dùng PowerShell, thay dòng chạy seed bằng `.\scripts\seed-events.ps1`; các lệnh Kafka chi tiết tiếp tục chạy trong WSL/Bash như ghi ở mục 3.4.

`LAG` phải tăng. Khởi động lại indexer:

```bash
docker compose start indexer
docker compose logs -f indexer
```

Khi log đã xử lý xong, nhấn `Ctrl+C` rồi kiểm tra group; lag trở về 0:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --group elasticsearch-indexers
```

> 📸 **BÁO CÁO C4:** Chụp hai bảng cùng group: lag > 0 khi indexer dừng và lag = 0 sau phục hồi. Giải thích Kafka tạo buffer chống gián đoạn như thế nào.

## C5. Kịch bản 4 — Scale consumer group và rebalance

Compose mặc định chạy ba indexer cho sáu partition. Xem assignment ban đầu:

```bash
docker compose ps indexer
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --group elasticsearch-indexers
```

Mỗi member thường giữ hai partition. Tăng lên sáu indexer để đạt parallelism tối đa:

```bash
docker compose up -d --scale indexer=6 indexer
docker compose ps indexer
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --group elasticsearch-indexers
```

Theo dõi các member:

```bash
docker compose logs -f indexer
```

Gửi seed trong terminal khác. Thử scale lên bảy: member thứ bảy phải rảnh vì chỉ có sáu partition. Sau đó trả về ba instance:

```bash
docker compose up -d --scale indexer=7 indexer
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --group elasticsearch-indexers
docker compose up -d --scale indexer=3 indexer
```

Scale consumer cao hơn số partition không tăng parallelism. Muốn tăng song song phải cân nhắc tăng partition, nhưng Kafka không thể giảm partition và việc tăng có thể thay đổi ánh xạ key→partition cho record mới.

> 📸 **BÁO CÁO C5:** Chụp assignment khi có 3, 6 và 7 indexer; đánh dấu member rảnh. Ghi sự kiện rebalance quan sát trong log.

## C6. Kịch bản 5 — Dead Letter Queue

Gửi JSON hợp lệ về cú pháp nhưng thiếu schema bắt buộc trực tiếp vào Kafka:

```bash
printf '%s\n' '{"unexpected":"invalid-event"}' \
  | docker compose exec -T kafka1 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
      --topic customer-events
```

Xem log indexer và đọc DLQ:

```bash
docker compose logs --tail=40 indexer
docker compose exec kafka1 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic customer-events-dlq \
  --from-beginning --max-messages 1
```

DLQ chứa lỗi, topic/partition/offset nguồn, thời điểm lỗi và payload gốc. Record xấu đã được commit ở topic nguồn để không gây poison-pill loop.

> 📸 **BÁO CÁO C6:** Chụp log “Moving ... to DLQ” và nội dung DLQ. Nêu quy trình xử lý lại DLQ an toàn: sửa dữ liệu, phát sang topic nguồn với ID phù hợp, lưu audit.

## C7. Kịch bản 6 — Elasticsearch node failover và mất quorum

Ứng dụng được cấu hình pool `es01,es02,es03`. Dừng một node:

```bash
docker compose stop es01
curl -s localhost:9201/_cluster/health \
  | jq '{status,number_of_nodes,active_primary_shards,unassigned_shards}'

curl -s -X POST localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -d '{"userId":"failure-user-1","eventType":"view","title":"Event khi es01 dừng","description":"single node failover","category":"lab","amount":0}' | jq

sleep 2
curl -s 'localhost:8080/api/search?q=Event%20khi%20es01%20dung' | jq '.items'
curl -s localhost:8080/api/health | jq
```

Pipeline vẫn chạy qua hai node sống; cluster yellow vì thiếu một replica. Client wrapper round-robin và failover khi endpoint lỗi.

Tiếp tục dừng `es02`, chỉ còn một master-eligible node nên mất quorum. Event vẫn được Kafka nhận nhưng indexer không commit được offset:

```bash
docker compose stop es02

curl -s -X POST localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -d '{"userId":"failure-user-2","eventType":"view","title":"Event khi ES mất quorum","description":"backlog recovery test","category":"lab","amount":0}' | jq

docker compose logs --tail=120 indexer
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --group elasticsearch-indexers
```

Khôi phục hai node và chờ pipeline drain backlog:

```bash
docker compose start es01 es02
curl -s 'localhost:9200/_cluster/health?wait_for_status=green&timeout=120s' | jq
sleep 5
docker compose logs --tail=120 indexer
curl -s 'localhost:8080/api/search?q=Event%20khi%20ES%20mat%20quorum' | jq '.items'
```

> 📸 **BÁO CÁO C7:** Chụp lần lượt: một node mất nhưng pipeline còn chạy; mất quorum tạo retry/lag; document xuất hiện sau recovery. Giải thích vì sao lỗi hạ tầng không đưa ngay vào DLQ như lỗi schema.

## C8. Kịch bản 7 — Replay mà không nhân đôi document

Lấy số document trước replay:

```bash
curl -s localhost:9200/customer-events-v1/_count | jq
```

Dừng consumer group, reset toàn bộ offset và chạy lại:

```bash
docker compose stop indexer
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --group elasticsearch-indexers --topic customer-events \
  --reset-offsets --to-earliest --execute
docker compose start indexer
docker compose logs -f indexer
```

Khi lag về 0, nhấn `Ctrl+C` và đếm lại:

```bash
curl -s localhost:9200/customer-events-v1/_count | jq
```

Số document hợp lệ không tăng do `_id=event.id`; các event được replay cập nhật cùng document. `indexedAt` thay đổi vì project ghi lại thời điểm xử lý gần nhất.

> 📸 **BÁO CÁO C8:** Chụp count trước/sau và log replay. Giải thích idempotency, đồng thời nêu hạn chế nếu payload cũ ghi đè dữ liệu mới hơn.

## C9. Kịch bản 8 — Kafka broker failover trong pipeline

Dừng một broker. RF=3/min ISR=2 và KRaft quorum 2/3 cho phép pipeline tiếp tục:

```bash
docker compose stop kafka1

curl -s -X POST localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -d '{"userId":"kafka-failover-user","eventType":"purchase","title":"Event khi kafka1 dừng","description":"broker failover project test","category":"lab","amount":99000}' | jq

sleep 2
curl -s 'localhost:8080/api/search?q=Event%20khi%20kafka1%20dung' | jq '.items'
curl -s localhost:8080/api/health | jq

docker compose exec kafka2 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka2:19092,kafka3:19092 \
  --describe --topic customer-events
```

Khôi phục và chờ ISR đủ ba node:

```bash
docker compose start kafka1
sleep 10
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --topic customer-events
```

> 📸 **BÁO CÁO C9:** Chụp HTTP 202 và search thành công khi `kafka1` dừng, ISR còn hai rồi trở lại ba. Phân biệt broker failover với exactly-once.

## C10. Bài tập mở rộng

1. Thêm field `deviceType` vào form, event schema và mapping. Vì mapping đang strict, phải tạo index version mới hoặc cập nhật mapping trước khi gửi.
2. Thêm date histogram theo giờ/ngày vào `/api/search` và UI.
3. Thêm retry topic có thời gian chờ thay vì retry trong process.
4. Tách ba KRaft controller khỏi broker, thêm TLS/SASL và ACL.
5. Tách Elasticsearch role master/data/ingest, thêm TLS, user/role và ILM/data stream.
6. Đưa ba node lên ba host/AZ thật; dùng object storage cho snapshot và monitoring/alerting.

## 5. Xử lý lỗi thường gặp

### Elasticsearch thoát với `max virtual memory areas vm.max_map_count`

```bash
sudo sysctl -w vm.max_map_count=1048576
cat /etc/sysctl.d/99-elasticsearch.conf
```

### Container bị kill, exit code 137

Docker hoặc máy host thiếu RAM. Kiểm tra:

```bash
free -h
docker stats --no-stream
dmesg | tail -n 30
```

Tăng giới hạn RAM của Docker Desktop/tài nguyên máy hoặc giảm heap ES về 512 MB cho lab.

### Web chưa lên vì API/indexer kết nối Kafka chậm

```bash
docker compose ps
docker compose logs --tail=100 kafka1 kafka2 kafka3 api indexer es01 es02 es03
docker compose restart api indexer
```

### Kafka CLI báo sai broker/listener

- Từ container dùng `kafka1:19092,kafka2:19092,kafka3:19092`.
- Từ máy host dùng `localhost:9092,localhost:9093,localhost:9094`.
- Application trong Compose dùng listener nội bộ; CLI host dùng listener HOST.
- Nếu client nhận hostname container từ ngoài host hoặc nhận `localhost` từ trong container, kiểm tra lại `advertised.listeners`.

### Elasticsearch `yellow`

Kiểm tra replica unassigned:

```bash
curl -s localhost:9200/_cluster/allocation/explain \
  -H 'Content-Type: application/json' -d '{}' | jq
```

Trong lab ba node, yellow khi một node dừng là đúng vì mỗi shard thiếu một trong hai replica nhưng primary vẫn active. Kiểm tra allocation explain, phục hồi node và chờ green; không chữa triệu chứng bằng cách giảm replica nếu mục tiêu vẫn là HA.

### Dữ liệu chưa xuất hiện ngay

Chờ quá `refresh_interval` (project là 1 giây), xem indexer log và consumer lag. Không vội dùng `refresh=true` trong luồng ghi production.

## 6. Dừng và dọn lab

Dừng nhưng giữ data trong named volume:

```bash
docker compose down
```

Chạy lại và dùng dữ liệu cũ:

```bash
docker compose up -d
```

Xóa toàn bộ container **và dữ liệu Kafka/Elasticsearch của riêng project này**:

```bash
docker compose down -v
```

> ⚠️ `-v` xóa named volume của project, không thể khôi phục nếu chưa backup. Chỉ chạy sau khi đã chụp đủ minh chứng.

## 7. Khung báo cáo đề nghị

### 7.1. Thông tin chung

- Họ tên / MSSV / lớp:
- Máy host, hệ điều hành và phiên bản Docker:
- Ubuntu, Docker, Kafka, Elasticsearch:
- CPU, RAM cấp cho Docker và các cổng sử dụng:
- Ngày thực hiện:

### 7.2. Nội dung

1. Mục tiêu và kiến trúc: vẽ lại pipeline, mô tả vai trò từng service.
2. Chuẩn bị Docker Compose: ảnh 01–04 và giải thích tài nguyên/cổng/`vm.max_map_count`.
3. Kafka: ảnh A0, A2–A6, A8–A12 và trả lời câu hỏi cơ chế/failover.
4. Elasticsearch: ảnh B0, B2–B15 (B8 là sơ đồ) và trả lời câu hỏi cơ chế/failover.
5. Project: ảnh C2–C9; mỗi kịch bản ghi **lệnh → kết quả → nhận xét → trạng thái đã phục hồi**.
6. Sự cố gặp phải và cách xử lý.
7. Kết luận, hạn chế của cluster nhiều container trên cùng một host và hướng multi-host/production.

### 7.3. Checklist ảnh bắt buộc

- [ ] 01–04: tài nguyên/cổng, Docker/Compose, sysctl, trạng thái stack/web.
- [ ] A0, A2–A6, A8–A12: quorum, partition/RF/ISR, key/order, group, replay, failover, min ISR, partition expansion, compaction.
- [ ] B0, B2–B15: topology/shard, mapping/analyzer, NRT, query/agg, failover/quorum, allocation, bulk/OCC, pagination, alias/reindex, snapshot.
- [ ] C2–C9: E2E, key, lag, scale, DLQ, ES recovery, idempotent replay, Kafka failover.

Mỗi ảnh nên có caption, số thứ tự, lệnh đầy đủ và phần output liên quan. Không chụp toàn màn hình quá nhỏ; không đưa password/token vào ảnh.

## 8. Câu hỏi tự kiểm tra

1. Vì sao tăng số consumer cao hơn số partition không tăng throughput?
2. Cùng key có đảm bảo thứ tự giữa hai topic không?
3. Committed offset khác log end offset thế nào?
4. Tại sao consumer project commit `offset + 1`?
5. At-least-once tạo bản ghi trùng trong tình huống nào và project khử trùng ra sao?
6. Khi nào đưa record vào DLQ, khi nào không commit để retry?
7. Vì sao `term` không phù hợp cho full-text title?
8. Refresh khác flush thế nào?
9. Vì sao cluster ba node với 2 replica chuyển yellow khi mất một node nhưng vẫn đọc/ghi được?
10. HTTP 202 từ API chứng minh được gì và chưa chứng minh được gì?
11. Vì sao RF=3/min ISR=2 chịu được một broker lỗi nhưng không chịu được hai combined controller/broker lỗi?
12. Replica Elasticsearch khác snapshot/backup ở điểm nào?

## 9. Tài liệu chính thức tham khảo

- [Apache Kafka 4.3 — Introduction](https://kafka.apache.org/43/getting-started/introduction/)
- [Apache Kafka 4.3 — Docker image](https://kafka.apache.org/43/getting-started/docker/)
- [Apache Kafka — Design](https://kafka.apache.org/43/design/design/)
- [Elasticsearch — Install with Docker](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/docker.html)
- [Elasticsearch — Mapping](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/mapping.html)
- [Elasticsearch — Near real-time search](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/near-real-time.html)
- [Elasticsearch — Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/query-dsl.html)
- [Docker Engine — Install on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
