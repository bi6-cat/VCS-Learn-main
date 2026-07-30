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
| Kafka 4.3.1 | Broker và KRaft controller kết hợp trong một node | `9092` |
| Elasticsearch 8.19.19 | Lưu và tìm kiếm event | `9200` |
| API Node.js | Producer Kafka và Search API | `3000` |
| Indexer Node.js | Consumer group, validate, index và DLQ | không publish |
| Nginx | Web UI và reverse proxy `/api` | `8080` |

Các image đã được pin phiên bản để kết quả lab có thể lặp lại. Phiên bản tham khảo tại thời điểm viết tài liệu; khi nâng phiên bản cần đọc breaking changes trước.

```text
Trình duyệt / curl
       |
       v
  Nginx :8080
       |
       v
 API :3000 -- produce(key=userId) --> Kafka topic: customer-events
       |                                      | 3 partitions
       | search                               v
       +-------------------------- Indexer consumer group
                                      |  PUT _doc/{event.id}
                                      v
                           Elasticsearch: customer-events-v1
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

- CPU 64-bit, bật hardware virtualization nếu Docker Desktop yêu cầu.
- Tối thiểu 6 GB RAM trống cho Docker; khuyến nghị máy có tổng RAM từ 8 GB.
- Tối thiểu 15 GB đĩa trống để tải image, build application và giữ volume.
- Các cổng `8080`, `3000`, `9092`, `9200` chưa bị chương trình khác chiếm.

Kiểm tra cổng trên Windows PowerShell:

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -In 8080,3000,9092,9200 |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Kiểm tra trên Linux/macOS:

```bash
ss -lnt 2>/dev/null | grep -E ':(3000|8080|9092|9200)\b' || true
```

Nếu có xung đột, dừng ứng dụng đang dùng cổng hoặc sửa các biến `APP_PORT`, `WEB_PORT`, `ES_PORT` trong `.env`. Cổng Kafka host `9092` đang gắn với advertised listener nên không đổi riêng nó nếu chưa sửa đồng thời cấu hình Kafka.

Với máy ít RAM, có thể đổi `ES_JAVA_OPTS` trong `docker-compose.yml` thành `-Xms512m -Xmx512m`; tốc độ khởi động và truy vấn sẽ chậm hơn.

> 📸 **BÁO CÁO 01:** Chụp thông tin CPU/RAM của máy và kết quả kiểm tra bốn cổng. Ghi hệ điều hành đang dùng.

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
docker compose pull kafka elasticsearch web
docker compose build api indexer
docker compose up -d
docker compose ps
```

Lần đầu có thể mất vài phút để tải image. Chờ tất cả dịch vụ chính ở trạng thái `healthy` hoặc `running`:

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

> 📸 **BÁO CÁO 04:** Chụp `docker compose ps`, JSON health và trang `http://localhost:8080`. Ảnh phải thể hiện Kafka connected và Elasticsearch green/yellow.

---

# Phần A — Lab riêng Apache Kafka

## A1. Kiến thức nền

Kafka là nền tảng event streaming phân tán. Producer append record vào topic; consumer tự đọc record theo offset. Khác queue xóa message sau khi nhận, Kafka giữ record theo retention nên nhiều consumer group có thể đọc độc lập và có thể replay.

| Khái niệm | Ý nghĩa trong lab |
|---|---|
| Broker | Server Kafka `lab-kafka` lưu log partition |
| KRaft controller | Quản lý metadata, election; chạy chung process với broker trong lab |
| Topic | Luồng logic `customer-events` |
| Partition | Ba log append-only; đơn vị song song và thứ tự |
| Record | Key, value, timestamp, headers và offset |
| Offset | Vị trí tăng dần, chỉ có nghĩa bên trong một partition |
| Producer | API hoặc console producer ghi record |
| Consumer group | `elasticsearch-indexers`; mỗi partition chỉ giao cho một member trong group |
| Retention | `customer-events` giữ record 7 ngày trong lab |
| Replication factor | Số bản sao partition; lab một broker nên bằng 1 |

KRaft dùng quorum controller và metadata log thay cho ZooKeeper. Lab dùng combined mode (`broker,controller`) để tiết kiệm RAM. Production nên tách vai trò phù hợp và dùng ít nhất ba controller để có quorum.

## A2. Lab topic, partition và replication factor

Liệt kê và mô tả topic:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:19092 --list

docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:19092 \
  --describe --topic customer-events
```

Cần thấy `PartitionCount: 3`, `ReplicationFactor: 1` và partition `0, 1, 2`. `Leader: 1` nghĩa broker node ID 1 đang làm leader cho partition, không phải partition 1.

Tạo topic độc lập để thử lệnh quản trị:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:19092 \
  --create --topic kafka-feature-lab \
  --partitions 3 --replication-factor 1
```

Thử tạo replication factor 2 trên cluster chỉ có một broker:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:19092 \
  --create --topic should-fail \
  --partitions 1 --replication-factor 2
```

Lệnh cuối phải thất bại vì không đủ broker. Replica chỉ có ý nghĩa khi bản sao nằm trên broker khác.

> 📸 **BÁO CÁO A1:** Chụp kết quả describe có đủ ba partition và lỗi khi yêu cầu replication factor 2. Ghi quan hệ giữa số broker và replication factor.

## A3. Lab producer, key, partition, offset và thứ tự

Mở Terminal 1, chạy consumer in key, partition, offset:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:19092 \
  --topic kafka-feature-lab \
  --from-beginning \
  --property print.key=true \
  --property print.partition=true \
  --property print.offset=true \
  --property key.separator=' | '
```

Mở Terminal 2, chạy producer nhận `key:value`:

```bash
docker compose exec -it kafka /opt/kafka/bin/kafka-console-producer.sh \
  --bootstrap-server kafka:19092 \
  --topic kafka-feature-lab \
  --property parse.key=true \
  --property key.separator=:
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

> 📸 **BÁO CÁO A2:** Chụp producer và consumer, đánh dấu ba record `user-001`, partition và offset. Giải thích vì sao chọn `userId` làm key trong project.

## A4. Lab consumer group và phân phối tải

Mở hai terminal, chạy cùng lệnh nhưng giữ cả hai hoạt động:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:19092 \
  --topic kafka-feature-lab \
  --group demo-workers \
  --property print.partition=true \
  --property print.offset=true
```

Gửi thêm nhiều record bằng console producer ở A3. Sau đó xem group:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 --describe --group demo-workers
```

Các cột quan trọng:

- `CURRENT-OFFSET`: offset kế tiếp group sẽ đọc.
- `LOG-END-OFFSET`: cuối log hiện tại.
- `LAG = LOG-END-OFFSET - CURRENT-OFFSET`.
- `CONSUMER-ID`, `HOST`, `CLIENT-ID`: member đang giữ partition.

Với 3 partition và 2 consumer, một consumer thường giữ 2 partition, consumer còn lại giữ 1. Nếu chạy 4 consumer, ít nhất 1 consumer rảnh vì không thể chia một partition cho hai member cùng group tại cùng thời điểm.

Dừng một consumer bằng `Ctrl+C`, quan sát terminal còn lại nhận partition sau rebalance. Chạy lại lệnh describe để chứng minh assignment thay đổi.

> 📸 **BÁO CÁO A3:** Chụp hai consumer nhận dữ liệu và bảng consumer group trước/sau khi dừng một member. Ghi định nghĩa rebalance.

## A5. Lab commit offset và replay

Dừng toàn bộ consumer thuộc `demo-workers`, kiểm tra group ở trạng thái không active rồi reset về đầu:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 \
  --group demo-workers --topic kafka-feature-lab \
  --reset-offsets --to-earliest --dry-run

docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 \
  --group demo-workers --topic kafka-feature-lab \
  --reset-offsets --to-earliest --execute
```

Chạy lại consumer cùng group, record cũ xuất hiện lại:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:19092 \
  --topic kafka-feature-lab --group demo-workers \
  --property print.partition=true --property print.offset=true
```

Replay không copy record và không đổi offset của record; nó đổi committed offset của group. Group khác không bị ảnh hưởng.

> 📸 **BÁO CÁO A4:** Chụp dry-run, execute và các record được đọc lại. Ghi hai trường hợp thực tế cần replay.

## A6. Lab retention và log bất biến

Xem cấu hình topic project:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka:19092 \
  --entity-type topics --entity-name customer-events --describe
```

`retention.ms=604800000` tương đương 7 ngày. Consumer đọc xong không xóa record. Broker chia partition log thành segment; tiến trình dọn dữ liệu xóa segment đã hết hạn, không xóa riêng từng message ngay khi consumer xử lý.

Thử trên topic lab với retention 60 giây:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka:19092 \
  --entity-type topics --entity-name kafka-feature-lab \
  --alter --add-config retention.ms=60000,segment.ms=60000
```

Việc xóa diễn ra nền nên không cam kết đúng giây thứ 60. Sau khi quan sát, trả retention về 7 ngày:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-configs.sh \
  --bootstrap-server kafka:19092 \
  --entity-type topics --entity-name kafka-feature-lab \
  --alter --add-config retention.ms=604800000
```

> 📝 **BÁO CÁO A5:** Ghi khác biệt giữa retention theo thời gian, retention theo dung lượng và log compaction. Project này dùng retention theo thời gian, không dùng compact.

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

---

# Phần B — Lab riêng Elasticsearch

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
curl -s 'localhost:9200/_cat/nodes?v'
curl -s 'localhost:9200/_cat/indices?v'
curl -s 'localhost:9200/_cat/shards/customer-events-v1?v'
```

Index project có 3 primary shard và 0 replica để cluster một node có thể `green`. Nếu đặt 1 replica trên một node, Elasticsearch không đặt primary và replica cùng node nên cluster sẽ `yellow`.

Thử và hoàn tác:

```bash
curl -s -X PUT localhost:9200/customer-events-v1/_settings \
  -H 'Content-Type: application/json' \
  -d '{"index":{"number_of_replicas":1}}' | jq
curl -s localhost:9200/_cluster/health | jq '{status,unassigned_shards}'

curl -s -X PUT localhost:9200/customer-events-v1/_settings \
  -H 'Content-Type: application/json' \
  -d '{"index":{"number_of_replicas":0}}' | jq
```

> 📸 **BÁO CÁO B1:** Chụp `_cat/shards` và health `yellow` khi replica=1, sau đó health `green` khi hoàn tác. Giải thích vì sao replica unassigned.

## B3. Lab mapping: `text`, `keyword`, kiểu số và date

Xem mapping project:

```bash
curl -s localhost:9200/customer-events-v1/_mapping | jq
```

- `title` là `text`: analyzer tách thành term để full-text search; có subfield `title.raw` kiểu `keyword` để sort/aggregation chính xác.
- `eventType`, `category`, `userId` là `keyword`: giữ nguyên giá trị để term filter và aggregation.
- `amount` là `scaled_float`: lưu tiền với hệ số 100.
- `timestamp`, `indexedAt` là `date`.
- `dynamic: strict`: field lạ làm request bị từ chối, giúp phát hiện schema drift.

Thử đưa field không khai báo:

```bash
curl -s -X POST 'localhost:9200/customer-events-v1/_doc?refresh=true' \
  -H 'Content-Type: application/json' \
  -d '{"id":"bad-1","unknownField":"should fail"}' | jq
```

Request phải trả lỗi `strict_dynamic_mapping_exception`.

> 📸 **BÁO CÁO B2:** Chụp một phần mapping `title`, `category`, `amount` và lỗi strict mapping. Ghi vì sao không dùng `text` cho aggregation category.

## B4. Lab analyzer và inverted index

Analyzer `lab_text` dùng standard tokenizer, lowercase và asciifolding. Kiểm tra token:

```bash
curl -s -X POST localhost:9200/customer-events-v1/_analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "analyzer":"lab_text",
    "text":"Tai Nghe Bluetooth Chống Ồn!"
  }' | jq '.tokens[] | {token,position}'
```

Các token đã viết thường; asciifolding giúp query không dấu như `chong on` khớp dữ liệu có dấu trong phạm vi analyzer đơn giản của lab. Inverted index ánh xạ term → danh sách document chứa term, nhờ đó không phải quét toàn bộ `_source`.

So sánh `text` và `keyword`:

```bash
curl -s -X POST localhost:9200/customer-events-v1/_analyze \
  -H 'Content-Type: application/json' \
  -d '{"analyzer":"keyword","text":"Tai Nghe Chống Ồn"}' \
  | jq '.tokens[].token'
```

Keyword analyzer tạo đúng một token giữ nguyên chuỗi.

> 📸 **BÁO CÁO B3:** Chụp token của hai analyzer và mô tả inverted index bằng một ví dụ 2 document, 3 term.

## B5. Lab CRUD và near real-time

Tạo index riêng để không ảnh hưởng project:

```bash
curl -s -X PUT localhost:9200/books-lab \
  -H 'Content-Type: application/json' \
  -d '{
    "settings":{"number_of_shards":1,"number_of_replicas":0,"refresh_interval":"30s"},
    "mappings":{"properties":{
      "title":{"type":"text"},
      "category":{"type":"keyword"},
      "price":{"type":"integer"}
    }}
  }' | jq
```

Index document nhưng chưa ép refresh:

```bash
curl -s -X PUT localhost:9200/books-lab/_doc/1 \
  -H 'Content-Type: application/json' \
  -d '{"title":"Kafka căn bản","category":"backend","price":250000}' | jq

curl -s localhost:9200/books-lab/_doc/1 | jq '._source'
curl -s localhost:9200/books-lab/_search | jq '.hits.total'
```

GET theo ID có thể thấy document ngay nhờ real-time GET, trong khi search chưa thấy do `refresh_interval=30s`. Ép refresh rồi tìm lại:

```bash
curl -s -X POST localhost:9200/books-lab/_refresh | jq
curl -s localhost:9200/books-lab/_search | jq '.hits'
```

Update và delete:

```bash
curl -s -X POST localhost:9200/books-lab/_update/1 \
  -H 'Content-Type: application/json' \
  -d '{"doc":{"price":230000}}' | jq

curl -s -X DELETE 'localhost:9200/books-lab/_doc/1?refresh=true' | jq
```

Không dùng `refresh=true` cho mọi write trong production vì tạo nhiều segment nhỏ và tăng chi phí merge.

> 📸 **BÁO CÁO B4:** Chụp GET thấy document nhưng search có 0 hit trước refresh, rồi search có hit sau refresh. Đây là bằng chứng near real-time.

## B6. Lab full-text query, filter và relevance score

Nạp dữ liệu project nếu chưa có:

```bash
bash scripts/seed-events.sh
sleep 2
```

Tương đương trong PowerShell:

```powershell
.\scripts\seed-events.ps1
Start-Sleep -Seconds 2
```

Full-text `match` sử dụng analyzer và tính `_score`:

```bash
curl -s -X POST localhost:9200/customer-events-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{"match":{"title":{"query":"chong on","fuzziness":"AUTO"}}},
    "_source":["title","category","eventType"]
  }' | jq '.hits.hits[] | {_score,source:._source}'
```

Kết hợp query và filter:

```bash
curl -s -X POST localhost:9200/customer-events-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "query":{"bool":{
      "must":[{"multi_match":{"query":"tai nghe","fields":["title^3","description"]}}],
      "filter":[{"term":{"category":"electronics"}}]
    }}
  }' | jq '.hits.hits[] | {_score,title:._source.title}'
```

`must` đóng góp vào relevance score; `filter` kiểm tra chính xác, không tính score và có khả năng cache. `title^3` boost title cao hơn description. Elasticsearch mặc định dùng BM25, xét tần suất term, độ hiếm term và độ dài field.

> 📸 **BÁO CÁO B5:** Chụp kết quả có `_score`; giải thích `match` khác `term` và tác dụng của boost `^3`.

## B7. Lab aggregation

```bash
curl -s -X POST localhost:9200/customer-events-v1/_search \
  -H 'Content-Type: application/json' \
  -d '{
    "size":0,
    "aggs":{
      "events_by_category":{"terms":{"field":"category"}},
      "events_by_type":{"terms":{"field":"eventType"}},
      "revenue":{"sum":{"field":"amount"}},
      "avg_order":{"avg":{"field":"amount"}}
    }
  }' | jq '.aggregations'
```

`size: 0` bỏ phần hits khi chỉ cần thống kê. Terms aggregation dùng dữ liệu chính xác của keyword/doc values, không dùng chuỗi text đã tách token.

> 📸 **BÁO CÁO B6:** Chụp bucket category, event type và tổng amount. Đối chiếu với ba thẻ metric trên web.

## B8. Segment, translog, flush và merge

```bash
curl -s 'localhost:9200/_cat/segments/customer-events-v1?v'
curl -s -X POST localhost:9200/customer-events-v1/_flush | jq
curl -s 'localhost:9200/_cat/segments/customer-events-v1?v'
```

- Refresh làm segment có thể search nhưng không đồng nghĩa một Lucene commit hoàn chỉnh.
- Translog được fsync để phục hồi các operation được xác nhận nhưng chưa flush.
- Flush tạo Lucene commit và bắt đầu translog generation mới.
- Segment bất biến; update/delete tạo phiên bản mới hoặc đánh dấu xóa. Merge nền gộp segment và dọn document đã xóa.
- Không chạy force merge thường xuyên trên index đang ghi.

> 📝 **BÁO CÁO B7:** Vẽ write path từ HTTP request đến translog, buffer, refresh, segment và flush; phân biệt durability với search visibility.

Dọn index lab riêng:

```bash
curl -s -X DELETE localhost:9200/books-lab | jq
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:19092 --delete --topic kafka-feature-lab
```

---

# Phần C — Project Customer Event Search

## C1. Đọc source trước khi chạy bài

| File | Nội dung cần đọc |
|---|---|
| `docker-compose.yml` | KRaft listener, topic init, volume, healthcheck và dependency |
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

> 📸 **BÁO CÁO C1:** Chụp JSON publish có partition/offset, log indexer cùng offset và search result có metadata Kafka tương ứng.

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

Tất cả event `same-user` phải cùng partition; offset tăng dần trong partition đó. Nếu muốn quan sát phân bố đủ ba partition, gửi thêm nhiều user ID khác nhau.

> 📸 **BÁO CÁO C2:** Chụp 5 kết quả và khoanh cùng partition/các offset tăng. Ghi Kafka chỉ giữ thứ tự theo partition.

## C4. Kịch bản 3 — Tạo backlog và quan sát consumer lag

Tạm dừng indexer nhưng giữ Kafka/API:

```bash
docker compose stop indexer
bash scripts/seed-events.sh

docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 \
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
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 \
  --describe --group elasticsearch-indexers
```

> 📸 **BÁO CÁO C3:** Chụp hai bảng cùng group: lag > 0 khi indexer dừng và lag = 0 sau phục hồi. Giải thích Kafka tạo buffer chống gián đoạn như thế nào.

## C5. Kịch bản 4 — Scale consumer group và rebalance

Tăng thành hai instance indexer:

```bash
docker compose up -d --scale indexer=2 indexer
docker compose ps indexer
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 \
  --describe --group elasticsearch-indexers
```

Ba partition được chia cho hai member. Theo dõi cả hai:

```bash
docker compose logs -f indexer
```

Gửi seed trong terminal khác. Sau đó giảm lại một instance:

```bash
docker compose up -d --scale indexer=1 indexer
```

Scale consumer cao hơn số partition không tăng parallelism. Muốn tăng song song phải cân nhắc tăng partition, nhưng Kafka không thể giảm partition và việc tăng có thể thay đổi ánh xạ key→partition cho record mới.

> 📸 **BÁO CÁO C4:** Chụp hai container indexer và assignment ba partition giữa hai consumer ID. Ghi sự kiện rebalance quan sát trong log.

## C6. Kịch bản 5 — Dead Letter Queue

Gửi JSON hợp lệ về cú pháp nhưng thiếu schema bắt buộc trực tiếp vào Kafka:

```bash
printf '%s\n' '{"unexpected":"invalid-event"}' \
  | docker compose exec -T kafka /opt/kafka/bin/kafka-console-producer.sh \
      --bootstrap-server kafka:19092 --topic customer-events
```

Xem log indexer và đọc DLQ:

```bash
docker compose logs --tail=40 indexer
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:19092 \
  --topic customer-events-dlq \
  --from-beginning --max-messages 1
```

DLQ chứa lỗi, topic/partition/offset nguồn, thời điểm lỗi và payload gốc. Record xấu đã được commit ở topic nguồn để không gây poison-pill loop.

> 📸 **BÁO CÁO C5:** Chụp log “Moving ... to DLQ” và nội dung DLQ. Nêu quy trình xử lý lại DLQ an toàn: sửa dữ liệu, phát sang topic nguồn với ID phù hợp, lưu audit.

## C7. Kịch bản 6 — Elasticsearch lỗi tạm thời

Dừng Elasticsearch, gửi event rồi quan sát:

```bash
docker compose stop elasticsearch

curl -s -X POST localhost:8080/api/events \
  -H 'Content-Type: application/json' \
  -d '{"userId":"failure-user","eventType":"view","title":"Event khi ES dừng","description":"recovery test","category":"lab","amount":0}' | jq

docker compose logs --tail=80 indexer
```

API vẫn có thể publish vì Kafka còn chạy, dù health endpoint/web search báo degraded. Indexer retry Elasticsearch; nếu vẫn lỗi nó thoát, Docker restart container. Offset chưa commit nên event vẫn ở Kafka.

Khởi động lại Elasticsearch và chờ health:

```bash
docker compose start elasticsearch
until curl -fsS localhost:9200/_cluster/health >/dev/null; do sleep 3; done
docker compose ps
docker compose logs --tail=80 indexer
sleep 2
curl -s 'localhost:8080/api/search?q=Event%20khi%20ES%20dung' | jq '.items'
```

> 📸 **BÁO CÁO C6:** Chụp retry/error, trạng thái restart và document xuất hiện sau khi ES trở lại. Ghi tại sao lỗi hạ tầng không nên đưa ngay vào DLQ như lỗi schema.

## C8. Kịch bản 7 — Replay mà không nhân đôi document

Lấy số document trước replay:

```bash
curl -s localhost:9200/customer-events-v1/_count | jq
```

Dừng consumer group, reset toàn bộ offset và chạy lại:

```bash
docker compose stop indexer
docker compose exec kafka /opt/kafka/bin/kafka-consumer-groups.sh \
  --bootstrap-server kafka:19092 \
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

> 📸 **BÁO CÁO C7:** Chụp count trước/sau và log replay. Giải thích idempotency, đồng thời nêu hạn chế nếu payload cũ ghi đè dữ liệu mới hơn.

## C9. Bài tập mở rộng

1. Thêm field `deviceType` vào form, event schema và mapping. Vì mapping đang strict, phải tạo index version mới hoặc cập nhật mapping trước khi gửi.
2. Thêm date histogram theo giờ/ngày vào `/api/search` và UI.
3. Thêm retry topic có thời gian chờ thay vì retry trong process.
4. Tạo cluster Kafka ba broker để chứng minh replication và leader failover.
5. Tạo Elasticsearch hai/ba node để chứng minh replica promotion; lưu ý máy chạy Docker cần thêm RAM.
6. Thêm authentication/TLS, secret và network policy cho mô hình gần production.

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
docker compose logs --tail=100 kafka api indexer elasticsearch
docker compose restart api indexer
```

### Kafka CLI báo sai broker/listener

- Từ container dùng `kafka:19092`.
- Từ chính máy host dùng `localhost:9092`.
- Application trong Compose luôn dùng listener nội bộ.

### Elasticsearch `yellow`

Kiểm tra replica unassigned:

```bash
curl -s localhost:9200/_cluster/allocation/explain \
  -H 'Content-Type: application/json' -d '{}' | jq
```

Trong lab một node, đặt replica về 0. Production không làm vậy; cần thêm data node.

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
3. Kafka: ảnh A1–A4, ghi chú A5 và trả lời câu hỏi cơ chế.
4. Elasticsearch: ảnh B1–B6, sơ đồ B7 và trả lời câu hỏi cơ chế.
5. Project: ảnh C1–C7; mỗi kịch bản ghi **lệnh → kết quả → nhận xét**.
6. Sự cố gặp phải và cách xử lý.
7. Kết luận, hạn chế của mô hình một node và hướng production.

### 7.3. Checklist ảnh bắt buộc

- [ ] 01–04: tài nguyên/cổng, Docker/Compose, sysctl, trạng thái stack/web.
- [ ] A1–A4: partition/RF, key/order, group/rebalance, replay.
- [ ] B1–B6: shard/replica, mapping, analyzer, NRT, score, aggregation.
- [ ] C1–C7: E2E, key, lag, scale, DLQ, recovery, idempotent replay.

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
9. Vì sao cluster một node không thể có replica shard được assign?
10. HTTP 202 từ API chứng minh được gì và chưa chứng minh được gì?

## 9. Tài liệu chính thức tham khảo

- [Apache Kafka 4.3 — Introduction](https://kafka.apache.org/43/getting-started/introduction/)
- [Apache Kafka 4.3 — Docker image](https://kafka.apache.org/43/getting-started/docker/)
- [Apache Kafka — Design](https://kafka.apache.org/43/design/design/)
- [Elasticsearch — Install with Docker](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/docker.html)
- [Elasticsearch — Mapping](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/mapping.html)
- [Elasticsearch — Near real-time search](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/near-real-time.html)
- [Elasticsearch — Query DSL](https://www.elastic.co/guide/en/elasticsearch/reference/8.19/query-dsl.html)
- [Docker Engine — Install on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
