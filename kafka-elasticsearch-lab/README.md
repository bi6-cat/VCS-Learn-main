# Lab Kafka và Elasticsearch bằng Docker Compose

Tài liệu này gồm ba phần có thể thực hành độc lập:

1. Lab riêng các tính năng và cơ chế cốt lõi của Apache Kafka.
2. Lab riêng các tính năng và cơ chế cốt lõi của Elasticsearch.
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

Với máy ít RAM, có thể đổi `ES_JAVA_OPTS` dùng chung trong `docker-compose.yml` thành `-Xms512m -Xmx512m`; không giảm dưới mức này và không chạy các bài tải lớn. Không nên bỏ node vì các bài failover cần đủ quorum/replica thật.

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

Các khối lệnh lab ở phần A–C dùng cú pháp Bash để tránh lặp lại mỗi thao tác hai lần. Trên Windows, có thể dùng WSL terminal đã bật Docker Desktop integration:

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

## A0. Khởi động lab Kafka độc lập

Phần A không cần Elasticsearch, API, indexer hoặc web. Khởi động đúng ba broker/controller và job tạo topic:

```bash
docker compose up -d kafka1 kafka2 kafka3
docker compose up kafka-init
docker compose ps kafka1 kafka2 kafka3 kafka-init
```

`kafka-init` kết thúc với exit code 0 là bình thường. Ba broker dùng chung KRaft quorum nhưng mỗi broker có named volume riêng. Các lệnh CLI bên dưới chạy từ `kafka1`; bootstrap list chứa cả ba broker để client vẫn lấy metadata nếu một broker lỗi.

```bash
export KAFKA_BOOTSTRAP='kafka1:19092,kafka2:19092,kafka3:19092'
```

Biến trên tồn tại ở shell host; trong từng lệnh `docker compose exec`, tài liệu vẫn ghi bootstrap list đầy đủ để dễ copy độc lập.

> 📸 **BÁO CÁO A0:** Chụp ba broker healthy và `kafka-init` exit 0. Ghi node ID, host port và volume của từng broker từ `docker compose config`.

## A1. Kiến thức nền

Kafka là nền tảng event streaming phân tán. Producer append record vào topic; consumer tự đọc record theo offset. Khác queue xóa message sau khi nhận, Kafka giữ record theo retention nên nhiều consumer group có thể đọc độc lập và có thể replay.

| Khái niệm | Ý nghĩa trong lab |
|---|---|
| Broker | Ba server `kafka1`, `kafka2`, `kafka3` lưu log partition |
| KRaft controller | Ba controller tạo quorum; mỗi container chạy combined `broker,controller` |
| Topic | Luồng logic `customer-events` |
| Partition | Sáu log append-only; đơn vị song song và thứ tự |
| Record | Key, value, timestamp, headers và offset |
| Offset | Vị trí tăng dần, chỉ có nghĩa bên trong một partition |
| Producer | API hoặc console producer ghi record |
| Consumer group | `elasticsearch-indexers`; mỗi partition chỉ giao cho một member trong group |
| Retention | `customer-events` giữ record 7 ngày trong lab |
| Replication factor | Topic chính dùng RF=3: leader và hai follower trên ba broker |

KRaft dùng quorum controller và metadata log thay cho ZooKeeper. Lab có quorum thật 3 controller, chịu được mất 1 controller. Combined mode (`broker,controller`) phù hợp lab và cluster nhỏ; hệ thống lớn thường tách controller khỏi broker để cô lập tải.

## A2. Lab topic, partition và replication factor

Liệt kê và mô tả topic:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 --list

docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --topic customer-events
```

Cần thấy `PartitionCount: 6`, `ReplicationFactor: 3`, `min.insync.replicas=2` và partition `0–5`. Mỗi dòng có ba `Replicas`; khi cluster khỏe, `Isr` cũng có ba broker. `Leader: 1` nghĩa broker node ID 1 đang làm leader, không phải partition 1.

Tạo topic độc lập để thử lệnh quản trị:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --create --topic kafka-feature-lab \
  --partitions 6 --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config unclean.leader.election.enable=false \
  --config retention.ms=604800000
```

Thử yêu cầu RF lớn hơn số broker:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --create --topic should-fail \
  --partitions 1 --replication-factor 4
```

Lệnh cuối phải thất bại vì cluster chỉ có ba broker. Replica của cùng partition luôn được đặt trên broker khác nhau; RF=3 tạo ba bản dữ liệu chứ không phải “ba replica cộng thêm leader”.

> 📸 **BÁO CÁO A2:** Chụp describe thể hiện 6 partition, RF=3 và ISR đủ ba broker; chụp lỗi RF=4. Phân biệt leader, replica và ISR.

## A3. Lab producer, key, partition, offset và thứ tự

Mở Terminal 1, chạy consumer in key, partition, offset:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-feature-lab \
  --from-beginning \
  --formatter-property print.key=true \
  --formatter-property print.partition=true \
  --formatter-property print.offset=true \
  --formatter-property key.separator=' | '
```

Mở Terminal 2, chạy producer nhận `key:value`:

```bash
docker compose exec -it kafka1 /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-feature-lab \
  --reader-property parse.key=true \
  --reader-property key.separator=: \
  --command-property acks=all \
  --command-property enable.idempotence=true
```

Nhập lần lượt:

```text
user-001:view-product-A
user-002:view-product-B
user-001:add-product-A-to-cart
user-003:purchase-product-C
user-001:purchase-product-A
```

Nhấn `Ctrl+C`. Quan sát:

- Các record có key `user-001` vào cùng partition.
- Offset tăng độc lập trong từng partition.
- Kafka đảm bảo thứ tự trong **một partition**, không đảm bảo thứ tự toàn topic.
- Không có key thì producer có thể phân phối batch theo partitioner; không nên dựa vào một thứ tự toàn cục.

> 📸 **BÁO CÁO A3:** Chụp producer và consumer, đánh dấu ba record `user-001`, partition và offset. Giải thích vì sao chọn `userId` làm key trong project.

## A4. Lab consumer group và phân phối tải

Mở hai terminal, chạy cùng lệnh nhưng giữ cả hai hoạt động:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-feature-lab \
  --group demo-workers \
  --formatter-property print.partition=true \
  --formatter-property print.offset=true
```

Gửi thêm nhiều record bằng console producer ở A3. Sau đó xem group:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 --describe --group demo-workers
```

Các cột quan trọng:

- `CURRENT-OFFSET`: offset kế tiếp group sẽ đọc.
- `LOG-END-OFFSET`: cuối log hiện tại.
- `LAG = LOG-END-OFFSET - CURRENT-OFFSET`.
- `CONSUMER-ID`, `HOST`, `CLIENT-ID`: member đang giữ partition.

Với 6 partition và 2 consumer, mỗi consumer thường giữ 3 partition. Nếu chạy 7 consumer, ít nhất 1 consumer rảnh vì không thể chia một partition cho hai member cùng group tại cùng thời điểm.

Dừng một consumer bằng `Ctrl+C`, quan sát terminal còn lại nhận partition sau rebalance. Chạy lại lệnh describe để chứng minh assignment thay đổi.

> 📸 **BÁO CÁO A4:** Chụp hai consumer nhận dữ liệu và bảng consumer group trước/sau khi dừng một member. Ghi định nghĩa rebalance.

## A5. Lab commit offset và replay

Dừng toàn bộ consumer thuộc `demo-workers`, kiểm tra group ở trạng thái không active rồi reset về đầu:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --group demo-workers --topic kafka-feature-lab \
  --reset-offsets --to-earliest --dry-run

docker compose exec kafka1 /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --group demo-workers --topic kafka-feature-lab \
  --reset-offsets --to-earliest --execute
```

Chạy lại consumer cùng group, record cũ xuất hiện lại:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-feature-lab --group demo-workers \
  --formatter-property print.partition=true --formatter-property print.offset=true
```

Replay không copy record và không đổi offset của record; nó đổi committed offset của group. Group khác không bị ảnh hưởng.

> 📸 **BÁO CÁO A5:** Chụp dry-run, execute và các record được đọc lại. Ghi hai trường hợp thực tế cần replay.

## A6. Lab retention và log bất biến

Xem cấu hình topic project:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --entity-type topics --entity-name customer-events --describe
```

`retention.ms=604800000` tương đương 7 ngày. Consumer đọc xong không xóa record. Broker chia partition log thành segment; tiến trình dọn dữ liệu xóa segment đã hết hạn, không xóa riêng từng message ngay khi consumer xử lý.

Thử trên topic riêng một partition để dễ quan sát. Topic vẫn có RF=3; Kafka xóa theo **segment**, vì vậy cần tạo segment mới và chờ background retention scan (`10s` trong Compose):

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --create --if-not-exists --topic kafka-retention-lab \
  --partitions 1 --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config cleanup.policy=delete \
  --config retention.ms=30000 \
  --config segment.ms=10000 \
  --config file.delete.delay.ms=1000

printf 'old-0\nold-1\n' \
  | docker compose exec -T kafka1 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
      --topic kafka-retention-lab --command-property acks=all

docker compose exec kafka1 /opt/kafka/bin/kafka-get-offsets.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-retention-lab --time earliest
docker compose exec kafka1 /opt/kafka/bin/kafka-get-offsets.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-retention-lab --time latest

sleep 12
printf 'retention-roll\n' \
  | docker compose exec -T kafka1 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
      --topic kafka-retention-lab --command-property acks=all
sleep 45

docker compose exec kafka1 /opt/kafka/bin/kafka-get-offsets.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic kafka-retention-lab --time earliest
```

Earliest offset có thể tiến lên và xuất hiện khoảng trống; offset không được đánh số lại. Thời gian vẫn là eventual vì retention scan chạy nền.

> 📸 **BÁO CÁO A6:** Chụp earliest/latest trước và earliest sau cleanup. Ghi khác biệt giữa retention theo thời gian, retention theo dung lượng và log compaction.

## A7. Delivery semantics trong project

API gửi với:

```text
acks = -1 (all in cách gọi KafkaJS)
idempotent producer = true
key = userId
```

Indexer dùng `autoCommit: false`; chỉ commit offset kế tiếp sau khi Elasticsearch ghi thành công. Các tình huống:

| Trình tự | Kết quả |
|---|---|
| Ghi ES thành công, commit thành công | Xử lý đúng một lần trong lần chạy đó |
| Ghi ES lỗi | Không commit; record được thử lại |
| Ghi ES thành công, process chết trước commit | Kafka giao lại; `_id=event.id` ngăn document trùng |
| JSON/schema sai | Đưa sang DLQ rồi commit để không chặn partition |

Đây là **at-least-once + idempotent sink**, không phải transaction exactly-once xuyên Kafka và Elasticsearch. Kafka transaction không thể tự biến thao tác HTTP đến Elasticsearch thành một transaction phân tán nguyên tử.

## A8. Lab KRaft quorum và trạng thái replication

Kiểm tra leader của metadata quorum và độ trễ follower:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-metadata-quorum.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  describe --status

docker compose exec kafka1 /opt/kafka/bin/kafka-metadata-quorum.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  describe --replication
```

Đọc các trường `LeaderId`, `CurrentVoters`, `HighWatermark`, `LogEndOffset` và `Lag`. Controller leader quản lý metadata; partition leader quản lý read/write của một data partition. Đây là hai loại leader khác nhau.

> 📸 **BÁO CÁO A8:** Chụp quorum status và replication. Xác định controller leader hiện tại và chứng minh đủ ba voter.

## A9. Lab broker failure, leader election và ISR

Mô tả topic trước sự cố:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --topic kafka-feature-lab
```

Dừng một broker. Chọn `kafka1` vì các lệnh CLI sau có thể chạy từ `kafka2`:

```bash
docker compose stop kafka1
docker compose ps kafka1 kafka2 kafka3

docker compose exec kafka2 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka2:19092,kafka3:19092 \
  --describe --topic kafka-feature-lab
```

Quan sát:

- Partition từng có leader 1 được bầu leader mới từ ISR.
- `Replicas` vẫn liệt kê ba bản được phân công; `Isr` chỉ còn broker sống.
- Topic vẫn đọc/ghi vì còn 2 ISR, đúng `min.insync.replicas=2`.
- KRaft còn 2/3 voter nên metadata quorum vẫn hoạt động.

Gửi và đọc record khi một broker dừng:

```bash
printf 'ha-user:event-while-kafka1-down\n' \
  | docker compose exec -T kafka2 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka2:19092,kafka3:19092 \
      --topic kafka-feature-lab \
      --reader-property parse.key=true --reader-property key.separator=: \
      --command-property acks=all

docker compose exec kafka2 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka2:19092,kafka3:19092 \
  --topic kafka-feature-lab --from-beginning --timeout-ms 10000 \
  | grep 'event-while-kafka1-down'
```

Khôi phục broker và chờ nó bắt kịp ISR:

```bash
docker compose start kafka1
until docker compose exec -T kafka1 /opt/kafka/bin/kafka-broker-api-versions.sh \
  --bootstrap-server kafka1:19092 >/dev/null 2>&1; do sleep 3; done
sleep 5

docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --topic kafka-feature-lab
```

> 📸 **BÁO CÁO A9:** Chụp leader/ISR trước, trong và sau sự cố; kèm record được produce khi `kafka1` dừng. Không dùng `docker compose down -v` trong bài vì sẽ xóa log cần recovery.

## A10. Lab `acks=all` và `min.insync.replicas`

Đây là cách chứng minh durability policy, không cần dừng hai controller làm mất quorum. Tạm nâng min ISR của topic lab lên 3:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --entity-type topics --entity-name kafka-feature-lab \
  --alter --add-config min.insync.replicas=3

docker compose stop kafka3
```

Producer yêu cầu tất cả ISR xác nhận sẽ thất bại vì chỉ còn hai ISR:

```bash
printf 'durability-user:must-fail\n' \
  | docker compose exec -T kafka1 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka1:19092,kafka2:19092 \
      --topic kafka-feature-lab \
      --reader-property parse.key=true --reader-property key.separator=: \
      --command-property acks=all \
      --command-property request.timeout.ms=5000 \
      --command-property delivery.timeout.ms=10000
```

Cần thấy lỗi kiểu `NotEnoughReplicas` hoặc timeout liên quan số ISR. Khôi phục ngay:

```bash
docker compose start kafka3
sleep 8
docker compose exec kafka1 /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --entity-type topics --entity-name kafka-feature-lab \
  --alter --add-config min.insync.replicas=2
docker compose exec kafka1 /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --entity-type topics --entity-name kafka-feature-lab --describe
```

`acks=all` một mình không nói được cần bao nhiêu bản sao; `min.insync.replicas` đặt ngưỡng. Cặp cấu hình phổ biến RF=3, min ISR=2 cho phép mất một broker mà vẫn ghi an toàn.

> 📸 **BÁO CÁO A10:** Chụp min ISR=3, broker dừng, lỗi producer và cấu hình đã trả về 2. Giải thích lựa chọn availability–durability.

## A11. Lab mở rộng partition và ảnh hưởng partition key

Kafka cho phép tăng nhưng không cho giảm số partition:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --alter --topic kafka-feature-lab --partitions 9

docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --describe --topic kafka-feature-lab
```

Partition mới được replica trên ba broker. Với partitioner dạng hash, phép chia theo số partition thay đổi nên cùng key có thể vào partition khác đối với record **mới** sau khi tăng. Thứ tự lịch sử của key trên toàn bộ thời gian vì thế không còn nằm trong duy nhất một partition. Chỉ tăng partition sau khi đánh giá ordering contract và năng lực consumer.

Thử giảm để thấy Kafka từ chối:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --alter --topic kafka-feature-lab --partitions 6
```

> 📸 **BÁO CÁO A11:** Chụp 9 partition và lỗi khi giảm. Ghi rủi ro tăng partition đối với ordering theo key.

## A12. Lab log compaction và tombstone

Tạo topic trạng thái khách hàng. Key đại diện entity; compact giữ giá trị mới nhất theo key:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --create --if-not-exists --topic customer-state-lab \
  --partitions 1 --replication-factor 3 \
  --config min.insync.replicas=2 \
  --config cleanup.policy=compact \
  --config segment.ms=10000 \
  --config min.compaction.lag.ms=0 \
  --config max.compaction.lag.ms=30000 \
  --config delete.retention.ms=60000 \
  --config min.cleanable.dirty.ratio=0.01

printf '%s\n' \
  'user-001:{"tier":"silver"}' \
  'user-002:{"tier":"gold"}' \
  'user-001:{"tier":"gold"}' \
  'user-002:NULL' \
  | docker compose exec -T kafka1 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
      --topic customer-state-lab \
      --reader-property parse.key=true \
      --reader-property key.separator=: \
      --reader-property null.marker=NULL \
      --command-property acks=all

docker compose exec kafka1 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic customer-state-lab --from-beginning --max-messages 4 \
  --formatter-property print.key=true \
  --formatter-property print.offset=true \
  --formatter-property null.literal='<NULL>'
```

`user-002:NULL` tạo tombstone thật: key có value null. Compaction chạy nền theo segment, không xóa bản cũ ngay lập tức và không thay thế database. Có thể ép roll segment rồi chờ cleaner để quan sát eventual result:

```bash
sleep 12
printf 'roll:trigger\n' \
  | docker compose exec -T kafka1 /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
      --topic customer-state-lab \
      --reader-property parse.key=true --reader-property key.separator=: \
      --command-property acks=all
sleep 45

docker compose exec kafka1 /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --topic customer-state-lab --from-beginning --timeout-ms 5000 \
  --formatter-property print.key=true \
  --formatter-property print.offset=true \
  --formatter-property null.literal='<NULL>'
```

Kết quả không có deadline tuyệt đối: cuối cùng `user-001` chỉ còn version gold; tombstone `user-002` được giữ ít nhất theo delete retention trước khi cả key bị loại. Offset có thể có khoảng trống.

> 📸 **BÁO CÁO A12:** Chụp lịch sử trước cleaner và kết quả sau cleaner nếu đã xảy ra. So sánh `delete` với `compact`; nêu ý nghĩa tombstone và tính eventual.

## A13. Checklist sự cố Kafka thường gặp

| Hiện tượng | Kiểm tra đầu tiên | Nguyên nhân thường gặp |
|---|---|---|
| Producer timeout | `kafka-topics --describe`, ISR, min ISR | Thiếu ISR, leader election, network/listener |
| Client nhận địa chỉ không kết nối được | `advertised.listeners` | Nhầm hostname container với `localhost` host |
| Consumer không nhận record | group, committed offset, `auto.offset.reset` | Đã đọc hết, sai group/topic, consumer rảnh |
| Lag tăng | `kafka-consumer-groups --describe` | Consumer chậm/chết, downstream lỗi, ít partition |
| Rebalance liên tục | member/log heartbeat | Process restart, timeout, xử lý batch quá lâu |
| Under-replicated partition | `Replicas` so với `Isr` | Broker chết, disk/network chậm, replica chưa bắt kịp |
| Disk tăng nhanh | retention/segment/topic volume | Retention quá dài, throughput cao, consumer không liên quan việc xóa |
| Duplicate event | producer retry/consumer xử lý lại | At-least-once; sink chưa idempotent |

Dọn riêng dữ liệu lab Kafka sau khi đã chụp báo cáo:

```bash
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --delete --topic kafka-feature-lab
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --delete --topic customer-state-lab
docker compose exec kafka1 /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka1:19092,kafka2:19092,kafka3:19092 \
  --delete --topic kafka-retention-lab
```

---

# Phần B — Lab riêng Elasticsearch

## B0. Khởi động lab Elasticsearch độc lập

Phần B không cần Kafka hoặc application:

```bash
docker compose up -d es-setup es01 es02 es03
docker compose ps es-setup es01 es02 es03

until curl -fsS 'localhost:9200/_cluster/health?wait_for_status=green&timeout=90s' \
  | jq; do sleep 5; done
```

`es-setup` chỉ sửa quyền shared snapshot volume rồi exit 0. Ba node còn lại đều master-eligible, data, ingest và coordinating để mô phỏng cluster nhỏ thực tế. Host có thể gọi từng node qua `9200`, `9201`, `9202`.

> 📸 **BÁO CÁO B0:** Chụp ba node healthy và cluster health green. Ghi tên cluster `customer-events-es` cùng port từng node.

## B1. Kiến thức nền

Elasticsearch là search và analytics engine phân tán dựa trên Apache Lucene. Dữ liệu là JSON document. Các khái niệm chính:

| Khái niệm | Vai trò |
|---|---|
| Cluster / node | Cụm và một tiến trình Elasticsearch |
| Index | Không gian logic chứa các document cùng mapping |
| Mapping | Schema và cách index từng field |
| Primary shard | Một Lucene index độc lập, chứa một phần document |
| Replica shard | Bản sao primary để chịu lỗi và tăng năng lực đọc |
| Segment | Cấu trúc Lucene bất biến chứa inverted index |
| Translog | Nhật ký phục hồi thao tác chưa được Lucene commit |
| Refresh | Mở segment mới cho search, tạo tính near real-time |
| Flush | Lucene commit và tạo translog generation mới |

Luồng ghi rút gọn:

```text
request → primary shard → translog + indexing buffer → replica
                                  |
                               refresh
                                  v
                         Lucene segment searchable
                                  |
                                merge
```

Luồng search phân tán là scatter/gather: coordinating node gửi query đến một bản sao của mỗi shard, gom top kết quả, sau đó fetch `_source` của các document cần trả.

## B2. Lab cluster health, node và shard

```bash
curl -s localhost:9200/_cluster/health | jq
curl -s 'localhost:9200/_cat/nodes?v&h=name,ip,node.role,master,heap.percent,ram.percent,cpu'
curl -s 'localhost:9200/_cat/indices?v'
```

Ký hiệu `*` trong cột `master` là elected master hiện tại; hai node còn lại vẫn master-eligible. Tạo index riêng, không phụ thuộc project:

```bash
curl -s -X PUT localhost:9200/products-lab-v1 \
  -H 'Content-Type: application/json' \
  -d '{
    "settings":{
      "number_of_shards":3,
      "number_of_replicas":2,
      "index.write.wait_for_active_shards":"2",
      "refresh_interval":"30s",
      "analysis":{"analyzer":{"lab_text":{
        "type":"custom","tokenizer":"standard",
        "filter":["lowercase","asciifolding"]
      }}}
    },
    "mappings":{
      "dynamic":"strict",
      "properties":{
        "productId":{"type":"keyword"},
        "name":{"type":"text","analyzer":"lab_text","fields":{"raw":{"type":"keyword"}}},
        "description":{"type":"text","analyzer":"lab_text"},
        "category":{"type":"keyword"},
        "price":{"type":"scaled_float","scaling_factor":100},
        "stock":{"type":"integer"},
        "createdAt":{"type":"date"}
      }
    }
  }' | jq
```

Kiểm tra phân bổ:

```bash
curl -s 'localhost:9200/_cat/indices/products-lab-v1?v'
curl -s 'localhost:9200/_cat/shards/products-lab-v1?v&h=index,shard,prirep,state,node'
curl -s localhost:9200/_cluster/health/products-lab-v1 \
  | jq '{status,number_of_nodes,active_primary_shards,active_shards,unassigned_shards}'
```

Ba primary × (1 primary + 2 replica) = 9 shard copy. Cùng shard ID phải nằm trên ba node khác nhau. `number_of_replicas=2` nghĩa hai replica **ngoài** primary.

> 📸 **BÁO CÁO B2:** Chụp `_cat/nodes`, 9 dòng `_cat/shards` và health green. Đánh dấu một shard ID với primary cùng hai replica trên ba node.

## B3. Lab mapping: `text`, `keyword`, kiểu số và date

Xem mapping lab:

```bash
curl -s localhost:9200/products-lab-v1/_mapping | jq
```

- `name` là `text`: analyzer tách thành term để full-text search; subfield `name.raw` là `keyword` để sort/aggregation chính xác.
- `category`, `productId` là `keyword`: giữ nguyên giá trị để term filter và aggregation.
- `price` là `scaled_float`: lưu số thập phân với hệ số 100.
- `stock` là integer; `createdAt` là date.
- `dynamic: strict`: field lạ làm request bị từ chối, giúp phát hiện schema drift.

Thử đưa field không khai báo:

```bash
curl -s -X POST 'localhost:9200/products-lab-v1/_doc?refresh=true' \
  -H 'Content-Type: application/json' \
  -d '{"id":"bad-1","unknownField":"should fail"}' | jq
```

Request phải trả lỗi `strict_dynamic_mapping_exception`.

> 📸 **BÁO CÁO B3:** Chụp mapping `name`, `category`, `price` và lỗi strict mapping. Ghi vì sao không dùng `text` cho aggregation category.

## B4. Lab analyzer và inverted index

Analyzer `lab_text` dùng standard tokenizer, lowercase và asciifolding. Kiểm tra token:

```bash
curl -s -X POST localhost:9200/products-lab-v1/_analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "analyzer":"lab_text",
    "text":"Tai Nghe Bluetooth Chống Ồn!"
  }' | jq '.tokens[] | {token,position}'
```

Các token đã viết thường; asciifolding giúp query không dấu như `chong on` khớp dữ liệu có dấu trong phạm vi analyzer đơn giản của lab. Inverted index ánh xạ term → danh sách document chứa term, nhờ đó không phải quét toàn bộ `_source`.

So sánh `text` và `keyword`:

```bash
curl -s -X POST localhost:9200/products-lab-v1/_analyze \
  -H 'Content-Type: application/json' \
  -d '{"analyzer":"keyword","text":"Tai Nghe Chống Ồn"}' \
  | jq '.tokens[].token'
```

Keyword analyzer tạo đúng một token giữ nguyên chuỗi.

> 📸 **BÁO CÁO B4:** Chụp token của hai analyzer và mô tả inverted index bằng một ví dụ 2 document, 3 term.

## B5. Lab CRUD và near real-time

Index document nhưng chưa ép refresh:

```bash
curl -s -X PUT localhost:9200/products-lab-v1/_settings \
  -H 'Content-Type: application/json' \
  -d '{"index":{"refresh_interval":"-1"}}' | jq

curl -s -X PUT localhost:9200/products-lab-v1/_doc/p-nrt-001 \
  -H 'Content-Type: application/json' \
  -d '{
    "productId":"p-nrt-001",
    "name":"Tai nghe chống ồn",
    "description":"Sản phẩm dùng kiểm tra near real-time",
    "category":"electronics",
    "price":2390000,
    "stock":12,
    "createdAt":"2026-07-30T10:00:00Z"
  }' | jq

curl -s localhost:9200/products-lab-v1/_doc/p-nrt-001 | jq '._source'
curl -s -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"ids":{"values":["p-nrt-001"]}}}' | jq '.hits.total'
```

GET theo ID có thể thấy document ngay nhờ real-time GET, trong khi search chưa thấy do refresh tự động đang tắt (`refresh_interval=-1`). Ép refresh rồi tìm lại:

```bash
curl -s -X POST localhost:9200/products-lab-v1/_refresh | jq
curl -s -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"ids":{"values":["p-nrt-001"]}}}' | jq '.hits'
```

Update và delete:

```bash
curl -s -X POST localhost:9200/products-lab-v1/_update/p-nrt-001 \
  -H 'Content-Type: application/json' \
  -d '{"doc":{"price":2290000,"stock":11}}' | jq

curl -s -X DELETE 'localhost:9200/products-lab-v1/_doc/p-nrt-001?refresh=true' | jq
curl -s -X PUT localhost:9200/products-lab-v1/_settings \
  -H 'Content-Type: application/json' \
  -d '{"index":{"refresh_interval":"30s"}}' | jq
```

Không dùng `refresh=true` cho mọi write trong production vì tạo nhiều segment nhỏ và tăng chi phí merge.

> 📸 **BÁO CÁO B5:** Chụp GET thấy document nhưng search có 0 hit trước refresh, rồi search có hit sau refresh. Đây là bằng chứng near real-time.

## B6. Lab full-text query, filter và relevance score

Nạp dữ liệu độc lập bằng Bulk API. NDJSON bắt buộc có newline cuối và mỗi action/source nằm trên một dòng riêng:

```bash
curl -s -X POST 'localhost:9200/products-lab-v1/_bulk?refresh=wait_for' \
  -H 'Content-Type: application/x-ndjson' --data-binary @- <<'NDJSON' | jq
{"index":{"_id":"p-001"}}
{"productId":"p-001","name":"Tai nghe chống ồn cao cấp","description":"Tai nghe bluetooth âm thanh rõ","category":"electronics","price":2390000,"stock":15,"createdAt":"2026-07-30T10:00:00Z"}
{"index":{"_id":"p-002"}}
{"productId":"p-002","name":"Bàn phím cơ không dây","description":"Bàn phím cơ switch brown","category":"electronics","price":1450000,"stock":8,"createdAt":"2026-07-30T10:01:00Z"}
{"index":{"_id":"p-003"}}
{"productId":"p-003","name":"Sách Kafka căn bản","description":"Event streaming và hệ thống phân tán","category":"books","price":320000,"stock":30,"createdAt":"2026-07-30T10:02:00Z"}
{"index":{"_id":"p-004"}}
{"productId":"p-004","name":"Sách thiết kế hệ thống","description":"Kiến trúc phần mềm thực hành","category":"books","price":410000,"stock":20,"createdAt":"2026-07-30T10:03:00Z"}
{"index":{"_id":"p-005"}}
{"productId":"p-005","name":"Máy pha cà phê tự động","description":"Máy pha cà phê cho gia đình","category":"home","price":5200000,"stock":4,"createdAt":"2026-07-30T10:04:00Z"}
{"index":{"_id":"p-006"}}
{"productId":"p-006","name":"Tai nghe thể thao","description":"Tai nghe chống nước cho chạy bộ","category":"electronics","price":890000,"stock":0,"createdAt":"2026-07-30T10:05:00Z"}
NDJSON
```

Luôn kiểm tra `.errors`; Bulk API có thể trả HTTP 200 nhưng một vài item bên trong thất bại:

```bash
curl -s localhost:9200/products-lab-v1/_count | jq
```

Full-text `match` sử dụng analyzer và tính `_score`:

```bash
curl -s -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{"match":{"name":{"query":"chong on","fuzziness":"AUTO"}}},
    "_source":["name","category","price"]
  }' | jq '.hits.hits[] | {_score,source:._source}'
```

Kết hợp query và filter:

```bash
curl -s -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{"bool":{
      "must":[{"multi_match":{"query":"tai nghe","fields":["name^3","description"]}}],
      "filter":[{"term":{"category":"electronics"}}]
    }}
  }' | jq '.hits.hits[] | {_score,name:._source.name}'
```

`must` đóng góp vào relevance score; `filter` kiểm tra chính xác, không tính score và có khả năng cache. `name^3` boost tên cao hơn description. Elasticsearch mặc định dùng BM25, xét tần suất term, độ hiếm term và độ dài field.

> 📸 **BÁO CÁO B6:** Chụp Bulk response không lỗi và kết quả có `_score`; giải thích `match` khác `term` và tác dụng của boost `^3`.

## B7. Lab aggregation

```bash
curl -s -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "size":0,
    "aggs":{
      "products_by_category":{"terms":{"field":"category"}},
      "inventory_value":{"sum":{"script":{"source":"doc.price.value * doc.stock.value"}}},
      "average_price":{"avg":{"field":"price"}},
      "price_ranges":{"range":{"field":"price","ranges":[{"to":1000000},{"from":1000000,"to":3000000},{"from":3000000}]}}
    }
  }' | jq '.aggregations'
```

`size: 0` bỏ phần hits khi chỉ cần thống kê. Terms aggregation dùng dữ liệu chính xác của keyword/doc values, không dùng chuỗi text đã tách token.

> 📸 **BÁO CÁO B7:** Chụp bucket category, khoảng giá và inventory value. Giải thích vì sao script aggregation tốn CPU hơn field aggregation.

## B8. Segment, translog, flush và merge

```bash
curl -s 'localhost:9200/_cat/segments/products-lab-v1?v'
curl -s -X POST localhost:9200/products-lab-v1/_flush | jq
curl -s 'localhost:9200/_cat/segments/products-lab-v1?v'
```

- Refresh làm segment có thể search nhưng không đồng nghĩa một Lucene commit hoàn chỉnh.
- Translog được fsync để phục hồi các operation được xác nhận nhưng chưa flush.
- Flush tạo Lucene commit và bắt đầu translog generation mới.
- Segment bất biến; update/delete tạo phiên bản mới hoặc đánh dấu xóa. Merge nền gộp segment và dọn document đã xóa.
- Không chạy force merge thường xuyên trên index đang ghi.

> 📝 **BÁO CÁO B8:** Vẽ write path từ HTTP request đến translog, buffer, refresh, segment và flush; phân biệt durability với search visibility.

## B9. Lab master election, primary promotion và node failure

Xác định elected master, sau đó dừng đúng node đó:

```bash
MASTER=$(curl -fsS 'localhost:9200/_cat/master?h=node')
echo "Elected master before failure: $MASTER"
docker compose stop "$MASTER"
docker compose ps es01 es02 es03
```

Chọn endpoint còn sống và chờ cluster ổn định:

```bash
for port in 9200 9201 9202; do
  if curl -fsS "localhost:${port}" >/dev/null 2>&1; then
    ES_SURVIVOR="http://localhost:${port}"
    break
  fi
done
echo "$ES_SURVIVOR"

curl -s "$ES_SURVIVOR/_cluster/health?wait_for_status=yellow&timeout=60s" \
  | jq '{status,number_of_nodes,active_primary_shards,active_shards,unassigned_shards}'
curl -s "$ES_SURVIVOR/_cat/master?v"
curl -s "$ES_SURVIVOR/_cat/shards/products-lab-v1?v&h=shard,prirep,state,node"
```

Kết quả đúng:

- Một trong hai master-eligible node còn lại được bầu làm master.
- Replica trên node sống được promote nếu primary cũ nằm trên node đã dừng.
- Tất cả primary vẫn active nên đọc/ghi được; health `yellow` vì mỗi shard thiếu bản sao thứ ba.
- `number_of_replicas=2` không buộc cluster ngừng chỉ vì tạm thiếu một replica.

Ghi thử qua node sống:

```bash
curl -s -X PUT "$ES_SURVIVOR/products-lab-v1/_doc/p-failover?refresh=wait_for" \
  -H 'Content-Type: application/json' \
  -d '{
    "productId":"p-failover","name":"Sản phẩm khi một node dừng",
    "description":"primary promotion test","category":"lab",
    "price":100000,"stock":1,"createdAt":"2026-07-30T11:00:00Z"
  }' | jq
```

Khôi phục node và chờ replica recovery:

```bash
docker compose start "$MASTER"
curl -s 'localhost:9200/_cluster/health?wait_for_status=green&timeout=90s' \
  | jq '{status,number_of_nodes,active_shards,relocating_shards,initializing_shards}'
```

> 📸 **BÁO CÁO B9:** Chụp master trước/sau, health yellow, shard promotion và health green sau recovery. Ghi rõ node failover khác host failover: cả ba container vẫn nằm trên một Docker host.

## B10. Lab mất quorum Elasticsearch

Ba master-eligible node chỉ chịu được **một** node lỗi. Dừng hai node:

```bash
docker compose stop es02 es03
curl --max-time 8 -sS -i \
  'localhost:9200/_cluster/health?master_timeout=5s'
docker compose logs --tail=40 es01
```

Node còn lại có thể vẫn giữ local shard nhưng không có majority để bầu master, nên cluster từ chối phần lớn thao tác. Hai replica không đồng nghĩa có thể vận hành cluster với một trong ba master node.

Khôi phục ngay và chờ green:

```bash
docker compose start es02 es03
curl -s 'localhost:9200/_cluster/health?wait_for_status=green&timeout=120s' | jq
```

> 📸 **BÁO CÁO B10:** Chụp lỗi/no-master khi còn một node và health green sau phục hồi. Giải thích quorum `floor(N/2)+1`.

## B11. Lab unassigned shard và Allocation Explain

Cố ý yêu cầu ba replica trên cluster ba node. Một shard sẽ cần bốn node khác nhau nên không thể phân bổ đủ:

```bash
curl -s -X PUT localhost:9200/products-lab-v1/_settings \
  -H 'Content-Type: application/json' \
  -d '{"index":{"number_of_replicas":3}}' | jq

curl -s localhost:9200/_cluster/health/products-lab-v1 \
  | jq '{status,active_primary_shards,active_shards,unassigned_shards}'
curl -s -X POST localhost:9200/_cluster/allocation/explain \
  -H 'Content-Type: application/json' \
  -d '{"index":"products-lab-v1","shard":0,"primary":false}' \
  | jq '{index,shard,primary,current_state,allocate_explanation,node_allocation_decisions}'
```

Allocation decider phải cho biết không được đặt hai bản của cùng shard trên một node. Trả về hai replica:

```bash
curl -s -X PUT localhost:9200/products-lab-v1/_settings \
  -H 'Content-Type: application/json' \
  -d '{"index":{"number_of_replicas":2}}' | jq
curl -s 'localhost:9200/_cluster/health?wait_for_status=green&timeout=60s' | jq '.status'
```

> 📸 **BÁO CÁO B11:** Chụp health yellow, allocation explanation và health green sau khi sửa. Đây là quy trình đầu tiên khi gặp unassigned shard thực tế.

## B12. Lab Bulk partial failure và optimistic concurrency

Bulk API trả HTTP 200 không đảm bảo mọi item thành công. Gửi một document đúng và một document có field lạ trong mapping strict:

```bash
curl -s -X POST 'localhost:9200/products-lab-v1/_bulk?refresh=wait_for' \
  -H 'Content-Type: application/x-ndjson' --data-binary @- <<'NDJSON' \
  | tee /tmp/bulk-result.json | jq '{errors,items}'
{"index":{"_id":"bulk-ok"}}
{"productId":"bulk-ok","name":"Bulk hợp lệ","description":"ok","category":"lab","price":1000,"stock":1,"createdAt":"2026-07-30T12:00:00Z"}
{"index":{"_id":"bulk-bad"}}
{"productId":"bulk-bad","name":"Bulk lỗi","description":"bad","category":"lab","price":1000,"stock":1,"createdAt":"2026-07-30T12:00:00Z","unexpected":"field"}
NDJSON
```

Phải kiểm tra `errors=true` và status từng item để retry **chỉ item lỗi**, không gửi lại mù toàn batch.

Tiếp theo lấy sequence number và primary term của `p-001`:

```bash
DOC=$(curl -fsS localhost:9200/products-lab-v1/_doc/p-001)
SEQ_NO=$(echo "$DOC" | jq -r '._seq_no')
PRIMARY_TERM=$(echo "$DOC" | jq -r '._primary_term')
echo "seq_no=$SEQ_NO primary_term=$PRIMARY_TERM"

curl -s -X POST \
  "localhost:9200/products-lab-v1/_update/p-001?if_seq_no=${SEQ_NO}&if_primary_term=${PRIMARY_TERM}" \
  -H 'Content-Type: application/json' -d '{"doc":{"stock":14}}' | jq
```

Gửi lại chính request với sequence number cũ sẽ nhận HTTP 409 `version_conflict_engine_exception`:

```bash
curl -s -X POST \
  "localhost:9200/products-lab-v1/_update/p-001?if_seq_no=${SEQ_NO}&if_primary_term=${PRIMARY_TERM}" \
  -H 'Content-Type: application/json' -d '{"doc":{"stock":13}}' | jq
```

> 📸 **BÁO CÁO B12:** Chụp Bulk partial failure và lỗi 409. Giải thích lost update và cách client đọc lại rồi retry có kiểm soát.

## B13. Lab pagination an toàn với `search_after`

`from + size` phù hợp trang nông; mặc định không vượt `index.max_result_window=10000`. Với trang sâu, dùng sort ổn định và `search_after`:

```bash
FIRST_PAGE=$(curl -fsS -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "size":2,
    "query":{"match_all":{}},
    "sort":[{"createdAt":"asc"},{"productId":"asc"}]
  }')
echo "$FIRST_PAGE" | jq '.hits.hits[] | {_id,sort,_source}'

SEARCH_AFTER=$(echo "$FIRST_PAGE" | jq -c '.hits.hits[-1].sort')
curl -s -X POST localhost:9200/products-lab-v1/_search \
  -H 'Content-Type: application/json' \
  -d "{
    \"size\":2,
    \"query\":{\"match_all\":{}},
    \"sort\":[{\"createdAt\":\"asc\"},{\"productId\":\"asc\"}],
    \"search_after\":${SEARCH_AFTER}
  }" | jq '.hits.hits[] | {_id,sort,_source}'
```

Khi dữ liệu thay đổi liên tục và cần snapshot nhất quán qua nhiều trang, kết hợp Point in Time (PIT) với `search_after`. Không tăng `max_result_window` vô hạn vì mỗi shard phải giữ nhiều kết quả trung gian trong heap.

> 📸 **BÁO CÁO B13:** Chụp hai trang và sort token nối tiếp nhau. So sánh `from/size`, scroll và PIT + search_after.

## B14. Lab reindex và chuyển alias không downtime

Mapping của field đã tồn tại thường không đổi kiểu trực tiếp được. Quy trình thực tế là tạo index version mới, reindex rồi đổi alias nguyên tử.

Gắn alias đọc vào v1:

```bash
curl -s -X POST localhost:9200/_aliases \
  -H 'Content-Type: application/json' \
  -d '{"actions":[{"add":{"index":"products-lab-v1","alias":"products-read"}}]}' | jq
```

Tạo v2 có thêm field `brand`:

```bash
curl -s -X PUT localhost:9200/products-lab-v2 \
  -H 'Content-Type: application/json' \
  -d '{
    "settings":{"number_of_shards":3,"number_of_replicas":2},
    "mappings":{"dynamic":"strict","properties":{
      "productId":{"type":"keyword"},
      "name":{"type":"text","fields":{"raw":{"type":"keyword"}}},
      "description":{"type":"text"},
      "category":{"type":"keyword"},
      "brand":{"type":"keyword"},
      "price":{"type":"scaled_float","scaling_factor":100},
      "stock":{"type":"integer"},
      "createdAt":{"type":"date"}
    }}
  }' | jq

curl -s -X POST 'localhost:9200/_reindex?wait_for_completion=true' \
  -H 'Content-Type: application/json' \
  -d '{"source":{"index":"products-lab-v1"},"dest":{"index":"products-lab-v2"}}' \
  | jq '{took,total,created,updated,failures}'
```

Đổi alias trong **một** request cluster-state:

```bash
curl -s -X POST localhost:9200/_aliases \
  -H 'Content-Type: application/json' \
  -d '{"actions":[
    {"remove":{"index":"products-lab-v1","alias":"products-read"}},
    {"add":{"index":"products-lab-v2","alias":"products-read"}}
  ]}' | jq

curl -s localhost:9200/_alias/products-read | jq
curl -s localhost:9200/products-read/_count | jq
```

Trong production, xử lý cả các write phát sinh trong lúc reindex bằng dual-write, change-data-capture hoặc tạm dừng write ngắn; reindex một lần không tự đồng bộ thay đổi mới.

> 📸 **BÁO CÁO B14:** Chụp reindex không failure, alias trước/sau và count qua alias. Giải thích rollback bằng cách đổi alias ngược lại.

## B15. Lab snapshot và restore

Compose đã mount named volume `es_snapshots` chung vào `/snapshots` trên ba node. Đăng ký filesystem repository:

```bash
curl -s -X PUT localhost:9200/_snapshot/lab-repo \
  -H 'Content-Type: application/json' \
  -d '{"type":"fs","settings":{"location":"lab-backups","compress":true}}' | jq

curl -s -X POST localhost:9200/_snapshot/lab-repo/_verify | jq
```

Chụp snapshot v2:

```bash
curl -s -X PUT \
  'localhost:9200/_snapshot/lab-repo/products-snapshot-01?wait_for_completion=true' \
  -H 'Content-Type: application/json' \
  -d '{"indices":"products-lab-v2","include_global_state":false}' \
  | jq '.snapshot | {snapshot,state,indices,successful_shards,failed_shards}'
```

Restore sang tên khác để không đè index đang mở:

```bash
curl -s -X POST \
  'localhost:9200/_snapshot/lab-repo/products-snapshot-01/_restore?wait_for_completion=true' \
  -H 'Content-Type: application/json' \
  -d '{
    "indices":"products-lab-v2",
    "rename_pattern":"products-lab-v2",
    "rename_replacement":"products-lab-restored",
    "include_global_state":false
  }' | jq

curl -s localhost:9200/products-lab-restored/_count | jq
curl -s localhost:9200/_snapshot/lab-repo/_all | jq
```

Named volume chung chỉ mô phỏng shared filesystem trên **một Docker host**. Production dùng repository bền vững và độc lập cluster như S3/GCS/Azure/shared filesystem, kèm chính sách SLM và kiểm thử restore định kỳ.

> 📸 **BÁO CÁO B15:** Chụp verify repository, snapshot SUCCESS và count index restored. Nêu vì sao replica không thay thế backup.

## B16. Checklist sự cố Elasticsearch thường gặp

| Hiện tượng | API kiểm tra | Nguyên nhân thường gặp |
|---|---|---|
| Cluster red/yellow | `_cluster/health`, `_cat/shards` | Mất primary/replica, thiếu node |
| Shard unassigned | `_cluster/allocation/explain` | Cùng-shard rule, awareness, disk watermark, allocation filter |
| Write 429 | `_cat/thread_pool/write`, node stats | Queue đầy, bulk quá lớn, consumer nhanh hơn ES |
| Mapping exception | `_mapping`, item lỗi trong `_bulk` | Sai type, field lạ với strict mapping |
| Search chậm | `_search` profile, slow log, hot threads | Query đắt, shard quá nhiều, script/deep pagination |
| Heap cao | `_cat/nodes`, `_nodes/stats/jvm` | Aggregation cardinality cao, fielddata, shard/segment quá nhiều |
| Disk tăng | `_cat/allocation`, ILM, segment | Retention chưa có, replica nhiều, merge/snapshot hiểu sai |
| Version conflict | `_seq_no`, `_primary_term` | Concurrent update; cần OCC/retry có giới hạn |
| Snapshot fail | `_snapshot/.../_verify` | Quyền path, repository không chung, plugin/credential |

Dọn dữ liệu lab riêng sau khi hoàn thành:

```bash
curl -s -X DELETE \
  'localhost:9200/products-lab-v1,products-lab-v2,products-lab-restored?ignore_unavailable=true' | jq
curl -s -X DELETE localhost:9200/_snapshot/lab-repo | jq
```

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
