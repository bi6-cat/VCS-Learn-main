# BÀI LAB: ELASTICSEARCH + KIBANA DEV TOOLS (CLUSTER 3 NODE)

> Phiên bản tham khảo: Elasticsearch 8.19.x / 9.4.x (docker.elastic.co) — cập nhật 08/2026.
> Bản này gồm đầy đủ các nội dung nhập môn (kiến trúc, CRUD, Query DSL, Aggregation, Analyzer...) và các tình huống vận hành nâng cao: **mất quorum, ép lỗi unassigned shard, snapshot/restore, zero-downtime reindex + cutover alias**.
> Các chủ đề còn lại (optimistic concurrency control chi tiết, deep pagination `search_after`/PIT) vẫn chỉ ghi chú ngắn ở phần **"Mở rộng"** cuối bài do nằm ngoài phạm vi cơ chế cốt lõi của Elasticsearch.

> **Quy ước thực hành:** các Elasticsearch REST API được chạy chủ yếu trong **Kibana → Dev Tools → Console**. Terminal chỉ dùng cho Docker và các tình huống Kibana không thể hoạt động như chờ khởi động, dừng node hoặc mất quorum; các khối Terminal dùng cú pháp Bash/WSL/Git Bash. Các khối **Đầu ra mẫu** chỉ giữ những trường quan trọng; các giá trị như `cluster_uuid`, node ID, `took`, `_version`, `_seq_no`, `_score` và thứ tự shard có thể khác trên máy của bạn.

---

## MỤC 1. MỤC TIÊU VÀ PHẠM VI BÀI LAB

### 1.1 Mục tiêu
- Hiểu kiến trúc phân tán của Elasticsearch (Cluster – Node – Shard – Replica).
- Hiểu cơ chế lưu trữ dựa trên **Inverted Index** và **Lucene Segment**.
- Thực hành cài đặt cluster nhiều node bằng Docker Compose, thao tác CRUD, Query DSL, Aggregation.
- Sử dụng Kibana Dev Tools để viết, chạy và quan sát Elasticsearch REST API.
- Hiểu cơ chế Analyzer/Tokenizer trong xử lý full-text search.
- Hiểu cơ chế Near Real-time Search (Refresh, Flush, Translog, Merge).
- Thực hành các tình huống vận hành thực tế: cluster health, node failure, **mất quorum**, **unassigned shard**, mapping conflict, bulk insert, **reindex + cutover không downtime**, **snapshot/restore**.

### 1.2 Công cụ sử dụng
- Docker & Docker Compose (≥ 4 GB RAM trống)
- Elasticsearch 8.19.x / 9.4.x — 3 node trong cùng một cluster
- Kibana cùng phiên bản Elasticsearch — giao diện Dev Tools chính của bài lab
- `curl` dùng dự phòng cho kiểm tra hạ tầng và mô phỏng sự cố

### 1.3 Phạm vi và lưu ý an toàn
- Môi trường học tập trên một Docker host, chạy trên `127.0.0.1`, **không mở port ra Internet**.
- Tắt `xpack.security.enabled` để tập trung vào cơ chế lõi — **không áp dụng cấu hình này cho production**.

### 📸 Cần chụp lại cho báo cáo
- Trang bìa mục tiêu bài lab + sơ đồ tổng quan các bước sẽ thực hiện.

---

## MỤC 2. KIẾN TRÚC TỔNG QUAN ELASTICSEARCH

### 2.1 Các khái niệm nền tảng
| Khái niệm | Giải thích |
|---|---|
| **Cluster** | Tập hợp nhiều node cùng `cluster.name`, lưu trữ toàn bộ dữ liệu và cung cấp khả năng index/search hợp nhất. |
| **Node** | Một instance chạy Elasticsearch (một tiến trình JVM), có thể đóng vai trò master, data, ingest, coordinating. |
| **Index** | Tập hợp các document có cấu trúc tương tự nhau. |
| **Shard** | Một index được chia thành nhiều **primary shard** để phân tán dữ liệu và tải xử lý. |
| **Replica** | Bản sao của primary shard, dùng cho high availability và tăng throughput đọc. |
| **Document** | Đơn vị dữ liệu cơ bản, dạng JSON. |
| **Mapping** | Schema định nghĩa kiểu dữ liệu của các field trong index. |

### 2.2 Vai trò của Node
- **Master-eligible node**: quản lý cluster state, phân bổ shard, tham gia bầu **elected master**.
- **Data node**: lưu trữ dữ liệu, thực hiện CRUD và search.
- **Ingest node**: xử lý pipeline trước khi index.
- **Coordinating node**: định tuyến request, gộp kết quả trả về từ nhiều shard (mô hình **scatter/gather**).

Trong bài lab này, cả 3 node đều cấu hình là **master-eligible + data node** để đơn giản hoá triển khai — cluster tự bầu 1 elected master, request đọc/ghi có thể gửi tới bất kỳ node nào.

### 2.3 Vai trò của Kibana trong bài lab

```text
Trình duyệt → Kibana :5601 → Elasticsearch REST API :9200 trên es01/es02/es03
```

Kibana không phải Elasticsearch node và không giữ primary/replica shard. Dev Tools là REST client chạy trong giao diện web: Console gửi request thay người dùng, còn dữ liệu và cluster state vẫn do Elasticsearch xử lý. Vì Kibana được cấu hình nhiều Elasticsearch host, việc dừng một node không nhất thiết làm Dev Tools ngừng hoạt động.

### 📸 Cần chụp lại cho báo cáo
- Sơ đồ: trình duyệt → Kibana → 3 node (es01, es02, es03) ↔ elected master ↔ primary/replica shard.

---

## MỤC 3. CÀI ĐẶT MÔI TRƯỜNG — CLUSTER 3 NODE (DOCKER COMPOSE)

> **Mục tiêu:** triển khai được cluster Elasticsearch gồm ba node cùng Kibana, mở Dev Tools và xác nhận toàn bộ dịch vụ sẵn sàng phục vụ request.
>
> **Lý do thực hiện:** các bài sau cần một môi trường nhiều node để quan sát đúng cơ chế bầu master, phân bổ replica, chịu lỗi và quorum; cluster một node không thể hiện đầy đủ các cơ chế này.

### 3.1 File `docker-compose.elasticsearch.yml`
```yaml
services:
  es-setup:
    image: busybox
    command: sh -c "chown -R 1000:1000 /snapshots || true"
    volumes:
      - es_snapshots:/snapshots

  es01:
    image: docker.elastic.co/elasticsearch/elasticsearch:${ELASTIC_VERSION:-8.19.19}
    container_name: es01
    environment:
      - node.name=es01
      - cluster.name=elasticsearch-lab
      - discovery.seed_hosts=es01,es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - ES_JAVA_OPTS=-Xms768m -Xmx768m
      - xpack.security.enabled=false
      - path.repo=/snapshots
    volumes:
      - es01_data:/usr/share/elasticsearch/data
      - es_snapshots:/snapshots
    ports:
      - "127.0.0.1:9200:9200"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9200 >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    depends_on:
      es-setup:
        condition: service_completed_successfully

  es02:
    image: docker.elastic.co/elasticsearch/elasticsearch:${ELASTIC_VERSION:-8.19.19}
    container_name: es02
    environment:
      - node.name=es02
      - cluster.name=elasticsearch-lab
      - discovery.seed_hosts=es01,es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - ES_JAVA_OPTS=-Xms768m -Xmx768m
      - xpack.security.enabled=false
      - path.repo=/snapshots
    volumes:
      - es02_data:/usr/share/elasticsearch/data
      - es_snapshots:/snapshots
    ports:
      - "127.0.0.1:9201:9200"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9200 >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    depends_on:
      es-setup:
        condition: service_completed_successfully

  es03:
    image: docker.elastic.co/elasticsearch/elasticsearch:${ELASTIC_VERSION:-8.19.19}
    container_name: es03
    environment:
      - node.name=es03
      - cluster.name=elasticsearch-lab
      - discovery.seed_hosts=es01,es02,es03
      - cluster.initial_master_nodes=es01,es02,es03
      - ES_JAVA_OPTS=-Xms768m -Xmx768m
      - xpack.security.enabled=false
      - path.repo=/snapshots
    volumes:
      - es03_data:/usr/share/elasticsearch/data
      - es_snapshots:/snapshots
    ports:
      - "127.0.0.1:9202:9200"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:9200 >/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s
    depends_on:
      es-setup:
        condition: service_completed_successfully

  kibana:
    image: docker.elastic.co/kibana/kibana:${ELASTIC_VERSION:-8.19.19}
    container_name: kibana
    environment:
      ELASTICSEARCH_HOSTS: '["http://es01:9200","http://es02:9200","http://es03:9200"]'
      SERVER_NAME: kibana-lab
    ports:
      - "127.0.0.1:5601:5601"
    depends_on:
      es01:
        condition: service_healthy
      es02:
        condition: service_healthy
      es03:
        condition: service_healthy

volumes:
  es01_data:
  es02_data:
  es03_data:
  es_snapshots:
```

> Ghi chú: `cluster.initial_master_nodes` chỉ dùng cho lần bootstrap cluster đầu tiên. Với cluster production đã hình thành, cần bỏ setting này để tránh nguy cơ bootstrap nhầm cluster mới khi tái khởi động.
> Volume `es_snapshots` được 3 node dùng chung — cần thiết cho phần Snapshot & Restore ở Mục 15.
> Kibana được cấu hình với cả ba địa chỉ Elasticsearch. Vì vậy Dev Tools vẫn có thể kết nối khi một node bị dừng; khi cluster mất quorum, Console có thể báo lỗi hoặc mất kết nối đúng như tình huống cần quan sát.

### 3.2 Kiểm tra cấu hình và khởi động
Mở Terminal tại thư mục chứa `docker-compose.elasticsearch.yml`, sau đó chạy:
```bash
docker compose -f docker-compose.elasticsearch.yml config --quiet
docker compose -f docker-compose.elasticsearch.yml up -d
docker compose -f docker-compose.elasticsearch.yml ps
```

**Đầu ra mẫu (rút gọn):**
```text
NAME   IMAGE                                                  SERVICE   STATUS
es01   docker.elastic.co/elasticsearch/elasticsearch:8.19.19  es01      Up (healthy)
es02   docker.elastic.co/elasticsearch/elasticsearch:8.19.19  es02      Up (healthy)
es03   docker.elastic.co/elasticsearch/elasticsearch:8.19.19  es03      Up (healthy)
kibana docker.elastic.co/kibana/kibana:8.19.19                 kibana    Up
```

**Giải thích:** `config --quiet` không in gì khi file Compose hợp lệ. Ngay sau `up -d`, health có thể tạm là `starting`; chạy lại `docker compose ... ps` sau Mục 3.3 sẽ thấy ba dòng `Up (healthy)`. Container `es-setup` có thể hiện `Exited (0)` khi dùng `ps --all`, vì nhiệm vụ cấp quyền thư mục snapshot đã hoàn thành.

### 3.3 Chờ cluster sẵn sàng
```bash
until curl -fsS 'localhost:9200/_cluster/health?wait_for_status=green&timeout=90s' >/dev/null; do
  sleep 5
done

until curl -fsS 'localhost:5601/api/status' >/dev/null; do
  sleep 5
done

curl -fsS 'localhost:9200/_cluster/health'
```

**Đầu ra mẫu:**
```json
{
  "cluster_name": "elasticsearch-lab",
  "status": "green",
  "number_of_nodes": 3,
  "number_of_data_nodes": 3,
  "active_primary_shards": 0,
  "active_shards": 0,
  "unassigned_shards": 0
}
```

**Giải thích:** lúc này chưa tạo index người dùng nên số shard có thể bằng `0`. `green` và `number_of_nodes: 3` xác nhận cluster đã bầu master và cả ba node đã tham gia. Vòng lặp thứ hai chỉ kết thúc khi Kibana trả HTTP thành công.

### 3.4 Mở Kibana Dev Tools và sử dụng Console

Mở `http://localhost:5601`, chọn **Management → Dev Tools → Console**. Đặt con trỏ trong một request rồi nhấn nút **▶** hoặc `Ctrl+Enter` để chạy. Dev Tools gọi thẳng Elasticsearch API nên không cần tạo Data View/Index Pattern trước.

| Thành phần | Tác dụng |
|---|---|
| `GET`, `PUT`, `POST`, `DELETE` | HTTP method đứng trước API path. |
| Khối JSON dưới API path | Request body; Console tự đặt `Content-Type`. |
| `filter_path=a,b` | Chỉ trả các field cần quan sát, thay cho lọc bằng `jq`. |
| `format=json` | Yêu cầu CAT API trả JSON thay vì bảng text. |
| `Ctrl+Space` | Hiện gợi ý API, field và tham số. |
| `Ctrl+Enter` | Chạy request đang đặt con trỏ. |

Ví dụ nhanh:
```http
GET _cluster/health

GET _cat/nodes?v=true
```

### 📸 Cần chụp lại cho báo cáo
- Kết quả `docker compose ... ps` cho thấy 3 node đang chạy (healthy).
- Trang Kibana Dev Tools và kết quả `_cluster/health` với `status: green`, `number_of_nodes: 3`.

---

## MỤC 4. KIỂM TRA TÌNH TRẠNG CLUSTER VÀ CÁC NODE

> **Mục tiêu:** đọc được cluster health, danh sách node, role và xác định elected master hiện tại bằng REST API.
>
> **Lý do thực hiện:** kiểm tra trạng thái là bước đầu tiên trước khi tạo dữ liệu hoặc xử lý sự cố; nếu cluster chưa ổn định, kết quả của các bài tiếp theo có thể sai hoặc không nhất quán.

### 4.1 Cluster health
```http
GET _cluster/health
```

**Đầu ra mẫu:**
```json
{
  "cluster_name": "elasticsearch-lab",
  "status": "green",
  "number_of_nodes": 3,
  "number_of_data_nodes": 3,
  "active_primary_shards": 0,
  "active_shards": 0,
  "unassigned_shards": 0
}
```

**Giải thích:** `active_primary_shards` và `active_shards` sẽ tăng sau khi tạo index. `unassigned_shards: 0` nghĩa là không có bản primary/replica nào đang chờ phân bổ.

### 4.2 Ý nghĩa trạng thái
| Trạng thái | Ý nghĩa |
|---|---|
| **Green** | Tất cả primary và replica shard đều hoạt động (allocated). |
| **Yellow** | Tất cả primary shard hoạt động nhưng thiếu ít nhất 1 replica. |
| **Red** | Có ít nhất 1 primary shard không hoạt động → mất dữ liệu tạm thời hoặc vĩnh viễn. |

### 4.3 Xem danh sách node và elected master
```http
GET _cat/nodes?v=true&h=name,ip,node.role,master,heap.percent,ram.percent,cpu

GET _cat/master?v=true
```
Ký hiệu `*` ở cột `master` trong `_cat/nodes` chính là elected master hiện tại; hai node còn lại vẫn master-eligible nhưng chưa được bầu.

**Đầu ra mẫu:**
```text
name ip         node.role master heap.percent ram.percent cpu
es01 172.20.0.2 cdfhilmrstw *                32          71   3
es02 172.20.0.3 cdfhilmrstw -                29          70   2
es03 172.20.0.4 cdfhilmrstw -                30          70   2

id                     host         ip           node
R7m...                 172.20.0.2   172.20.0.2   es01
```

**Giải thích:** `*` và dòng `_cat/master` cùng chỉ ra `es01` đang là elected master trong lần chạy minh họa. Việc node nào được bầu là động, vì vậy kết quả của bạn có thể là `es02` hoặc `es03`. `node.role` là chuỗi viết tắt các role được node đảm nhiệm.

### 📸 Cần chụp lại cho báo cáo
- Kết quả `_cluster/health`, `_cat/nodes` (chú ý cột `master`), `_cat/master`.

---

## MỤC 5. TẠO INDEX VÀ MAPPING

> **Mục tiêu:** tạo index với số shard/replica xác định, khai báo mapping tường minh và kiểm chứng cơ chế từ chối field không hợp lệ.
>
> **Lý do thực hiện:** mapping quyết định cách Elasticsearch lưu trữ, phân tích và truy vấn dữ liệu. Thiết kế sai mapping có thể gây kết quả search sai, aggregation không chạy hoặc dữ liệu có kiểu không nhất quán.

### 5.1 Tạo index với shard/replica và mapping cụ thể
```http
PUT products-lab
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 2,
    "refresh_interval": "30s",
    "analysis": {
      "analyzer": {
        "lab_text": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "productId":   { "type": "keyword" },
      "name":        { "type": "text", "analyzer": "lab_text", "fields": { "raw": { "type": "keyword" } } },
      "description": { "type": "text", "analyzer": "lab_text" },
      "category":    { "type": "keyword" },
      "price":       { "type": "scaled_float", "scaling_factor": 100 },
      "stock":       { "type": "integer" },
      "createdAt":   { "type": "date" }
    }
  }
}
```

**Đầu ra mẫu:**
```json
{
  "acknowledged": true,
  "shards_acknowledged": true,
  "index": "products-lab"
}
```

Kiểm tra settings, mapping và cách Elasticsearch đã phân bổ 9 bản shard:
```http
GET products-lab/_mapping?filter_path=*.mappings.dynamic,*.mappings.properties.name,*.mappings.properties.category,*.mappings.properties.price

GET _cat/shards/products-lab?v=true&h=index,shard,prirep,state,node
```

**Đầu ra mapping mẫu (rút gọn):**
```json
{
  "products-lab": {
    "mappings": {
      "dynamic": "strict",
      "properties": {
        "name": { "type": "text", "analyzer": "lab_text", "fields": { "raw": { "type": "keyword" } } },
        "category": { "type": "keyword" },
        "price": { "type": "scaled_float", "scaling_factor": 100 }
      }
    }
  }
}
```

**Đầu ra mẫu của `_cat/shards`:**
```text
index        shard prirep state   node
products-lab 0     p      STARTED es01
products-lab 0     r      STARTED es02
products-lab 0     r      STARTED es03
products-lab 1     p      STARTED es02
products-lab 1     r      STARTED es03
products-lab 1     r      STARTED es01
products-lab 2     p      STARTED es03
products-lab 2     r      STARTED es01
products-lab 2     r      STARTED es02
```

**Giải thích:** `acknowledged` xác nhận cluster state đã nhận định nghĩa index; `shards_acknowledged` xác nhận các bản primary cần thiết đã khởi động trước khi hết timeout. Ba primary, mỗi primary có hai replica, tạo tổng cộng `3 × (1 + 2) = 9` dòng shard. Node thực tế và thứ tự dòng có thể khác.

### 5.2 Giải thích các lựa chọn mapping
- **text vs keyword**: `text` được phân tích (dùng cho full-text search); `keyword` giữ nguyên chuỗi (dùng cho filter, sort, aggregation chính xác).
- **multi-field** (`name.raw`): cùng một field vừa search full-text (`name`) vừa lọc/aggregation chính xác (`name.raw`).
- **scaled_float**: lưu số thập phân (giá tiền) hiệu quả hơn `float` khi chỉ cần độ chính xác cố định.
- **dynamic: strict**: từ chối document có field lạ không khai báo trong mapping → giúp phát hiện sai schema ngay từ đầu.

### 5.3 Kiểm tra mapping conflict (tình huống thực tế)
```http
POST products-lab/_doc?refresh=true
{
  "productId": "bad-1",
  "unknownField": "should fail"
}
```
Request phải trả lỗi `strict_dynamic_mapping_exception` — đây là ví dụ thực tế cho tình huống "mapping conflict" được tổng hợp lại ở Mục 16.

**Đầu ra mẫu (rút gọn):**
```json
{
  "error": {
    "type": "strict_dynamic_mapping_exception",
    "reason": "mapping set to strict, dynamic introduction of [unknownField] within [_doc] is not allowed"
  },
  "status": 400
}
```

**Giải thích:** HTTP `400` cho biết request sai schema, không phải Elasticsearch bị lỗi dịch vụ. Do `dynamic: strict`, document `bad-1` bị từ chối hoàn toàn và không xuất hiện trong index.

### 📸 Cần chụp lại cho báo cáo
- Kết quả tạo index thành công (`"acknowledged": true"`).
- Kết quả `GET /products-lab/_mapping`.
- Lỗi `strict_dynamic_mapping_exception` khi gửi field lạ.

---

## MỤC 6. CƠ CHẾ INVERTED INDEX, ANALYZER VÀ LUCENE SEGMENT

> **Mục tiêu:** quan sát token do analyzer tạo ra và nhận biết document được lưu trong các Lucene segment thuộc từng bản shard.
>
> **Lý do thực hiện:** hiểu analyzer giúp giải thích vì sao một từ khóa có hoặc không khớp; hiểu segment giúp liên hệ thao tác ghi với refresh, merge và hiệu năng tìm kiếm.

### 6.1 Inverted Index là gì?
Thay vì lưu "document → danh sách từ" (forward index), Elasticsearch lưu **"từ → danh sách document chứa từ đó"**:
```
elastic  -> [Doc1]
search   -> [Doc1, Doc2]
nhanh    -> [Doc1]
```
Đây là cấu trúc lõi giúp full-text search có tốc độ cao thay vì phải quét toàn bộ `_source`.

### 6.2 Pipeline phân tích văn bản (Analyzer)
```
Text đầu vào → Character Filter → Tokenizer → Token Filter → Token cuối cùng
```
- **Tokenizer**: tách chuỗi thành token (ví dụ `standard` tách theo biên từ).
- **Token Filter**: biến đổi token (`lowercase`, `asciifolding` để bỏ dấu, `stop` để loại stopword...).

### 6.3 Thử nghiệm với `_analyze`
```http
POST products-lab/_analyze?filter_path=tokens.token,tokens.position
{
  "analyzer": "lab_text",
  "text": "Tai Nghe Bluetooth Chống Ồn!"
}
```
So sánh với `keyword` analyzer (giữ nguyên cả chuỗi thành 1 token duy nhất):
```http
POST products-lab/_analyze?filter_path=tokens.token,tokens.position
{
  "analyzer": "keyword",
  "text": "Tai Nghe Chống Ồn"
}
```

**Đầu ra mẫu:**
```json
{"tokens":[
  {"token":"tai","position":0},
  {"token":"nghe","position":1},
  {"token":"bluetooth","position":2},
  {"token":"chong","position":3},
  {"token":"on","position":4}
]}
{"tokens":[{"token":"Tai Nghe Chống Ồn","position":0}]}
```

**Giải thích:** `standard` tokenizer tách câu thành năm token, `lowercase` chuyển chữ thường và `asciifolding` biến `Chống Ồn` thành `chong`, `on`. Analyzer `keyword` không tách và cũng không lowercase nên giữ nguyên cả chuỗi.

### 6.4 Segment trong Lucene
- Mỗi shard thực chất là một **Lucene index**, chia thành nhiều **segment bất biến (immutable)**.
- Ghi mới → tạo segment mới; update/delete tạo phiên bản mới hoặc đánh dấu xoá (segment cũ không bị sửa).
- Định kỳ, **merge** gộp các segment nhỏ để tối ưu hiệu năng đọc và dọn dữ liệu đã xoá.

```http
PUT products-lab/_doc/p-segment?refresh=true
{
  "productId": "p-segment",
  "name": "Segment demo"
}

GET _cat/segments/products-lab?v=true

DELETE products-lab/_doc/p-segment?refresh=true
```

**Đầu ra mẫu (rút gọn):**
```text
{"_id":"p-segment","result":"created"}
index        shard prirep segment generation docs.count docs.deleted size
products-lab 1     p      _0              0          1            0  4.2kb
products-lab 1     r      _0              0          1            0  4.2kb
products-lab 1     r      _0              0          1            0  4.2kb
{"_id":"p-segment","result":"deleted"}
```

**Giải thích:** `refresh=true` buộc document mẫu xuất hiện trong segment có thể tìm kiếm. Mỗi dòng là một Lucene segment thuộc một bản shard; ví dụ có một primary (`p`) và hai replica (`r`) chứa cùng document. Shard ID, số dòng, tên segment và kích thước không cố định vì routing, refresh và merge chạy nền. Document mẫu được xóa ngay sau khi quan sát.

### 📸 Cần chụp lại cho báo cáo
- Kết quả `_analyze` của `lab_text` (token đã lowercase + bỏ dấu) và của `keyword` (1 token duy nhất).
- Kết quả `_cat/segments`.

---

## MỤC 7. THAO TÁC CRUD VÀ CƠ CHẾ NEAR REAL-TIME (NRT)

> **Mục tiêu:** thực hiện đầy đủ Create, Read, Update, Delete và chứng minh sự khác nhau giữa real-time GET với near real-time search.
>
> **Lý do thực hiện:** CRUD là luồng làm việc cơ bản của ứng dụng, còn NRT là nguyên nhân phổ biến khiến document vừa ghi đã đọc được theo ID nhưng chưa xuất hiện ngay trong kết quả search.

### 7.1 Create – Read – Update – Delete
Tạo document với ID cố định:
```http
PUT products-lab/_doc/p-001?filter_path=_index,_id,_version,result,_shards
{
  "productId": "p-001",
  "name": "Tai nghe chống ồn cao cấp",
  "description": "Tai nghe bluetooth âm thanh rõ",
  "category": "electronics",
  "price": 2390000,
  "stock": 15,
  "createdAt": "2026-08-01T10:00:00Z"
}
```

Đọc, cập nhật rồi xóa document:
```http
GET products-lab/_doc/p-001?filter_path=_id,_version,found,_source

POST products-lab/_update/p-001?filter_path=_id,_version,result
{
  "doc": { "price": 2290000 }
}

DELETE products-lab/_doc/p-001?filter_path=_id,_version,result
```

**Đầu ra mẫu (theo thứ tự bốn request):**
```json
{"_index":"products-lab","_id":"p-001","_version":1,"result":"created","_shards":{"total":3,"successful":3,"failed":0}}
{"_id":"p-001","_version":1,"found":true,"_source":{"productId":"p-001","name":"Tai nghe chống ồn cao cấp","description":"Tai nghe bluetooth âm thanh rõ","category":"electronics","price":2390000,"stock":15,"createdAt":"2026-08-01T10:00:00Z"}}
{"_id":"p-001","_version":2,"result":"updated"}
{"_id":"p-001","_version":3,"result":"deleted"}
```

**Giải thích:** `created → updated → deleted` phản ánh kết quả từng thao tác. `_version` tăng sau mỗi lần thay đổi document; đây là số phiên bản nội bộ. Với optimistic concurrency control hiện đại, ứng dụng nên dùng `_seq_no` cùng `_primary_term`, không chỉ dựa vào `_version`.

### 7.2 Chứng minh Near Real-time (GET tức thời khác Search NRT)
Tắt tạm refresh tự động để quan sát rõ hiện tượng:
```http
PUT products-lab/_settings
{
  "index": { "refresh_interval": "-1" }
}
```
Ghi 1 document và thử GET theo ID lẫn search ngay lập tức:
```http
PUT products-lab/_doc/p-nrt-001?filter_path=_id,result
{
  "productId": "p-nrt-001",
  "name": "Test NRT"
}

GET products-lab/_doc/p-nrt-001?filter_path=found,_source

POST products-lab/_search?filter_path=hits.total.value,hits.hits._id
{
  "query": { "ids": { "values": ["p-nrt-001"] } }
}
```
Ép refresh thủ công rồi search lại:
```http
POST products-lab/_refresh

POST products-lab/_search?filter_path=hits.total.value,hits.hits._id
{
  "query": { "ids": { "values": ["p-nrt-001"] } }
}
```

**Đầu ra mẫu cần đối chiếu:**
```json
{"_id":"p-nrt-001","result":"created"}
{"found":true,"_source":{"productId":"p-nrt-001","name":"Test NRT"}}
{"hits":{"total":{"value":0},"hits":[]}}
{"_shards":{"total":9,"successful":9,"failed":0}}
{"hits":{"total":{"value":1},"hits":[{"_id":"p-nrt-001"}]}}
```

Dọn document thử nghiệm và bật lại refresh tự động:
```http
DELETE products-lab/_doc/p-nrt-001?refresh=true&filter_path=_id,result

PUT products-lab/_settings
{
  "index": { "refresh_interval": "30s" }
}
```

**Giải thích**: real-time `GET` đọc trực tiếp từ translog/version map nên thấy document ngay; `search` chỉ đọc qua Lucene searcher đã refresh. Refresh mở segment/searcher mới nên document mới nhìn thấy được — đây là bản chất "near real-time" chứ không phải "real-time" của Elasticsearch.

### 📸 Cần chụp lại cho báo cáo
- Kết quả CRUD cơ bản (chú ý `_version`, `result`).
- **Quan trọng nhất**: so sánh search trả `0 hit` trước `_refresh` và `1 hit` sau `_refresh` — đây là bằng chứng near real-time cần có trong báo cáo.

---

## MỤC 8. QUERY DSL – CÁC LOẠI TRUY VẤN

> **Mục tiêu:** nạp dữ liệu bằng Bulk API và thực hành `match`, `term`, `range`, `bool`, `must`, `filter` cùng cơ chế tính `_score`.
>
> **Lý do thực hiện:** mỗi loại query giải quyết một nhu cầu khác nhau; chọn sai giữa full-text query và exact query dễ dẫn đến không có kết quả, sai relevance hoặc tốn tài nguyên không cần thiết.

### 8.1 Nạp dữ liệu mẫu bằng Bulk API
```http
POST products-lab/_bulk?refresh=wait_for&filter_path=errors,items.*._id,items.*.status,items.*.result
{"index":{"_id":"p-002"}}
{"productId":"p-002","name":"Bàn phím cơ không dây","description":"Bàn phím cơ switch brown","category":"electronics","price":1450000,"stock":8,"createdAt":"2026-08-01T10:01:00Z"}
{"index":{"_id":"p-003"}}
{"productId":"p-003","name":"Sách Kafka căn bản","description":"Event streaming và hệ thống phân tán","category":"books","price":320000,"stock":30,"createdAt":"2026-08-01T10:02:00Z"}
{"index":{"_id":"p-004"}}
{"productId":"p-004","name":"Máy pha cà phê tự động","description":"Máy pha cà phê cho gia đình","category":"home","price":5200000,"stock":4,"createdAt":"2026-08-01T10:03:00Z"}
```
> Lưu ý: luôn kiểm tra trường `errors` trong response — Bulk API có thể trả HTTP 200 dù một vài item bên trong thất bại.

**Đầu ra mẫu:**
```json
{
  "errors": false,
  "items": [
    { "index": { "_id": "p-002", "status": 201, "result": "created" } },
    { "index": { "_id": "p-003", "status": 201, "result": "created" } },
    { "index": { "_id": "p-004", "status": 201, "result": "created" } }
  ]
}
```

**Giải thích:** `errors: false` mới xác nhận cả ba thao tác con đều thành công. `refresh=wait_for` chờ refresh kế tiếp nên các document có thể được tìm thấy ngay ở các truy vấn sau. Nếu chạy lại cùng ID, `index` sẽ ghi đè và thường trả `status: 200`, `result: updated`.

### 8.2 Match Query (full-text, có tính điểm)
```http
GET products-lab/_search?filter_path=hits.total.value,hits.hits._id,hits.hits._score,hits.hits._source.name
{
  "query": { "match": { "name": "bàn phím" } }
}
```

**Đầu ra mẫu:**
```json
{"hits":{"total":{"value":1},"hits":[{"_id":"p-002","_score":1.9616582,"_source":{"name":"Bàn phím cơ không dây"}}]}}
```

**Giải thích:** query text và field `name` cùng đi qua analyzer nên `bàn phím` khớp các token `ban`, `phim`. `_score` lớn hơn 0 biểu diễn độ liên quan và có thể khác theo dữ liệu, phiên bản Lucene và thống kê shard.

### 8.3 Term Query (chính xác, không phân tích)
```http
GET products-lab/_search?filter_path=hits.total.value,hits.hits._id,hits.hits._source.category
{
  "query": { "term": { "category": "electronics" } }
}
```

**Đầu ra mẫu:**
```json
{"hits":{"total":{"value":1},"hits":[{"_id":"p-002","_source":{"category":"electronics"}}]}}
```

**Giải thích:** `term` không phân tích chuỗi đầu vào, phù hợp với field `keyword`. Giá trị `Electronics` viết hoa sẽ không khớp `electronics`.

### 8.4 Range Query
```http
GET products-lab/_search?filter_path=hits.total.value,hits.hits._id,hits.hits._source.price
{
  "query": { "range": { "price": { "gte": 500000, "lte": 3000000 } } }
}
```

**Đầu ra mẫu:**
```json
{"hits":{"total":{"value":1},"hits":[{"_id":"p-002","_source":{"price":1450000}}]}}
```

**Giải thích:** khoảng lấy cả hai biên (`gte`, `lte`). `p-003` thấp hơn 500.000 và `p-004` cao hơn 3.000.000 nên chỉ còn `p-002`.

### 8.5 Bool Query + boost field
```http
GET products-lab/_search?filter_path=hits.total.value,hits.hits._id,hits.hits._score,hits.hits._source.name,hits.hits._source.category
{
  "query": {
    "bool": {
      "must":   [ { "multi_match": { "query": "bàn phím", "fields": ["name^3", "description"] } } ],
      "filter": [ { "term": { "category": "electronics" } } ]
    }
  }
}
```

**Đầu ra mẫu:**
```json
{"hits":{"total":{"value":1},"hits":[{"_id":"p-002","_score":5.8849745,"_source":{"name":"Bàn phím cơ không dây","category":"electronics"}}]}}
```

**Giải thích:** `multi_match` trong `must` vừa bắt buộc khớp vừa tính `_score`; `name^3` làm tín hiệu từ tên mạnh hơn mô tả. `filter` loại document sai category mà không cộng điểm. Con số `_score` chỉ mang tính minh họa, không nên kiểm thử bằng một giá trị cố định.

### 8.6 So sánh `must` vs `filter`
- `must`: có ảnh hưởng đến điểm relevance (`_score`, tính theo thuật toán BM25).
- `filter`: không tính score, kết quả có thể được cache → hiệu năng cao hơn cho điều kiện lọc thuần túy.
- `name^3`: boost trọng số field `name` cao gấp 3 lần `description` khi tính score.

### 📸 Cần chụp lại cho báo cáo
- Kết quả Bulk (`errors: false`).
- Kết quả từng loại truy vấn, đặc biệt chú ý `_score` khác nhau giữa match/term/bool.

---

## MỤC 9. AGGREGATION – PHÂN TÍCH DỮ LIỆU

> **Mục tiêu:** tạo metric aggregation, bucket aggregation và aggregation lồng nhau để tổng hợp dữ liệu sản phẩm.
>
> **Lý do thực hiện:** Elasticsearch không chỉ tìm kiếm document mà còn phục vụ thống kê gần thời gian thực; aggregation là nền tảng cho dashboard, báo cáo và phân tích dữ liệu vận hành.

### 9.1 Metric + Bucket Aggregation
```http
GET products-lab/_search?filter_path=aggregations
{
  "size": 0,
  "aggs": {
    "products_by_category": { "terms": { "field": "category" } },
    "average_price":        { "avg": { "field": "price" } }
  }
}
```

**Đầu ra mẫu:**
```json
{
  "aggregations": {
    "average_price": { "value": 2323333.3333333335 },
    "products_by_category": {
      "doc_count_error_upper_bound": 0,
      "sum_other_doc_count": 0,
      "buckets": [
        { "key": "books", "doc_count": 1 },
        { "key": "electronics", "doc_count": 1 },
        { "key": "home", "doc_count": 1 }
      ]
    }
  }
}
```

**Giải thích:** `terms` tạo một bucket cho mỗi category và `doc_count` là số document trong bucket. `avg` bỏ qua document thiếu `price` và tính trung bình ba giá trị mẫu: `(1.450.000 + 320.000 + 5.200.000) / 3`.

### 9.2 Nested Aggregation (bucket + metric lồng nhau)
```http
GET products-lab/_search?filter_path=aggregations.by_category.buckets
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": { "avg_price_per_category": { "avg": { "field": "price" } } }
    }
  }
}
```

**Đầu ra mẫu:**
```json
{
  "aggregations": {
    "by_category": {
      "buckets": [
        { "key": "books", "doc_count": 1, "avg_price_per_category": { "value": 320000 } },
        { "key": "electronics", "doc_count": 1, "avg_price_per_category": { "value": 1450000 } },
        { "key": "home", "doc_count": 1, "avg_price_per_category": { "value": 5200000 } }
      ]
    }
  }
}
```

**Giải thích:** Elasticsearch tạo bucket category trước, sau đó chạy `avg` riêng trong phạm vi từng bucket. Vì dữ liệu mẫu có một sản phẩm mỗi category nên trung bình đúng bằng giá của sản phẩm đó.

### 9.3 Lưu ý
- `size: 0` bỏ phần `hits` khi chỉ cần thống kê, giảm tải trả về.
- Bucket aggregation (`terms`) chạy trên `keyword`/doc values chính xác — **không dùng field `text`** cho mục đích này vì đã bị phân tích thành nhiều token.

### 📸 Cần chụp lại cho báo cáo
- Kết quả từng loại aggregation, chú ý cấu trúc JSON (`buckets`, `doc_count`, `value`).

---

## MỤC 10. SHARDING, REPLICATION VÀ NODE FAILURE (DỪNG 1 NODE)

> **Mục tiêu:** quan sát vị trí primary/replica, dừng elected master, xác nhận cluster tiếp tục đọc/ghi và phục hồi về trạng thái `green`.
>
> **Lý do thực hiện:** bài lab chứng minh replica và cơ chế bầu master thực sự cung cấp khả năng chịu lỗi, đồng thời cho thấy `yellow` không đồng nghĩa với mất khả năng phục vụ dữ liệu.

### 10.1 Cách phân bổ document vào shard
```
shard_num = hash(_routing) % number_of_primary_shards
```
Mặc định `_routing` là `_id` của document — đây là lý do **số lượng primary shard không thể thay đổi sau khi tạo index** (trừ khi reindex sang index mới).

### 10.2 Xem shard được phân bổ trên các node
```http
GET _cat/shards/products-lab?v=true&h=index,shard,prirep,state,node
```
Với `number_of_replicas: 2` trên cluster 3 node: mỗi primary có thêm 2 replica, và bản sao của cùng một shard ID luôn nằm trên 3 node khác nhau (Elasticsearch không cho phép 2 bản của cùng shard nằm chung 1 node).

**Đầu ra mẫu:** có 9 dòng `STARTED`: ba dòng `p` (primary) và sáu dòng `r` (replica). Với mỗi shard ID `0`, `1`, `2`, ba bản sao phải nằm trên ba node khác nhau. Cách phân bố primary cụ thể có thể khác lần chạy minh họa.

### 10.3 Thử nghiệm node failure (dừng 1 node)
Trong **Kibana Dev Tools**, tìm tên elected master và ghi lại kết quả:
```http
GET _cat/master?v=true&h=node
```

Trong **Terminal**, thay `es01` bằng tên vừa nhận được rồi dừng node đó:
```bash
MASTER=es01
echo "Dừng elected master: $MASTER"
docker compose -f docker-compose.elasticsearch.yml stop "$MASTER"
```

Chờ Dev Tools tự kết nối sang một node còn sống, sau đó chạy:
```http
GET _cluster/health?wait_for_status=yellow&timeout=60s&filter_path=status,number_of_nodes,active_primary_shards,active_shards,unassigned_shards

GET _cat/master?v=true

GET _cat/shards/products-lab?v=true&h=shard,prirep,state,node

PUT products-lab/_doc/p-failover?refresh=wait_for&filter_path=_id,result,_shards
{
  "productId": "p-failover",
  "name": "Write while one node is down"
}
```

**Đầu ra mẫu (rút gọn):**
```text
Dừng elected master: es01
{"status":"yellow","number_of_nodes":2,"active_primary_shards":3,"active_shards":6,"unassigned_shards":3}
id                     host         ip           node
u2K...                 172.20.0.3   172.20.0.3   es02
{"_id":"p-failover","result":"created","_shards":{"total":3,"successful":2,"failed":0}}
```

**Giải thích:** một trong hai node sống được bầu làm master mới. Replica của primary nằm trên node đã dừng được promote khi cần. Cluster `yellow` vì cả ba primary vẫn hoạt động nhưng mỗi shard thiếu một replica; ghi vẫn thành công trên hai bản đang sống. `_shards.total` vẫn phản ánh số bản được cấu hình, còn `successful` phản ánh số bản đã xác nhận lúc node đang dừng.

Khôi phục node:
```bash
docker compose -f docker-compose.elasticsearch.yml start "$MASTER"
```

Quay lại **Kibana Dev Tools**:
```http
GET _cluster/health?wait_for_status=green&timeout=60s&filter_path=status,number_of_nodes,active_shards,unassigned_shards

DELETE products-lab/_doc/p-failover?refresh=true&filter_path=_id,result
```

**Đầu ra mẫu:**
```json
{"status":"green","number_of_nodes":3,"active_shards":9,"unassigned_shards":0}
{"_id":"p-failover","result":"deleted"}
```

**Giải thích:** node cũ tham gia lại, Elasticsearch tự đồng bộ các replica còn thiếu và cluster trở về `green`. Document thử nghiệm được xóa để dữ liệu ở các bài sau vẫn có đúng ba sản phẩm mẫu.

### 📸 Cần chụp lại cho báo cáo
- `_cat/shards` trước và sau khi dừng node: thể hiện shard được relocate/promote.
- Cluster health chuyển `green → yellow → green` theo từng bước.
- `_cat/master` trước/sau cho thấy elected master đã đổi.

---

## MỤC 11. MÔ PHỎNG MẤT QUORUM (DỪNG 2/3 NODE)

> **Mục tiêu:** tạo tình huống cluster mất majority, nhận diện lỗi no-master và khôi phục cluster khi các node tham gia lại.
>
> **Lý do thực hiện:** quorum ngăn các phần cluster ghi dữ liệu độc lập và gây split-brain. Hiểu giới hạn chịu lỗi giúp lựa chọn đúng số master-eligible node và xử lý sự cố an toàn.

### 11.1 Khái niệm Quorum trong Elasticsearch
Với cluster có N node master-eligible, số node tối thiểu cần thiết để bầu ra master (quorum) là:
```
majority = floor(N/2) + 1
```
Với N = 3 → majority = 2. Cluster chỉ chịu được **tối đa 1 node lỗi**; nếu mất từ 2 node trở lên, các node còn lại **không đủ đa số** để tự bầu master mới → cluster từ chối phần lớn thao tác để tránh **split-brain** (hai phần cluster cùng tự nhận là "đúng" và ghi dữ liệu độc lập, gây phân mảnh dữ liệu).

### 11.2 Thực hiện: dừng đồng thời 2 node
> Phần này bắt buộc dùng Terminal: khi cluster mất quorum, Kibana Dev Tools có thể không tải được phản hồi. `curl -i` cho phép quan sát trực tiếp HTTP status và lỗi từ node còn sống.

```bash
docker compose -f docker-compose.elasticsearch.yml stop es02 es03

curl --max-time 8 -sS -i 'localhost:9200/_cluster/health?master_timeout=5s'
docker compose -f docker-compose.elasticsearch.yml logs --tail=40 es01
```

**Đầu ra mẫu của request (một trong các dạng có thể gặp):**
```text
HTTP/1.1 503 Service Unavailable
content-type: application/json

{"error":{"type":"master_not_discovered_exception","reason":null},"status":503}
```

**Đầu ra log mẫu (rút gọn):**
```text
master not discovered or elected yet, an election requires at least 2 nodes with ids from [...]
```

**Giải thích:** `503` nghĩa là node còn chạy nhưng cluster tạm không cung cấp được thao tác cần cluster state. Tùy thời điểm và phiên bản, `curl` cũng có thể hết `--max-time` và báo timeout; cả hai đều chứng minh một node không đủ majority của cluster ba master-eligible node.

### 11.3 Kết quả kỳ vọng
- Request tới node còn lại (`es01`) thường trả **HTTP 503** kèm lỗi `master_not_discovered_exception`, hoặc request bị timeout.
- Log của `es01` báo không tìm được đủ số master-eligible node để hình thành quorum.
- **Lưu ý quan trọng**: node `es01` vẫn còn nguyên dữ liệu (Lucene segment) trên đĩa — đây là vấn đề *thiếu quorum để điều phối cluster*, không phải *mất dữ liệu*.

### 11.4 Khôi phục
```bash
docker compose -f docker-compose.elasticsearch.yml start es02 es03
```

Khi Kibana kết nối lại, xác nhận trong **Dev Tools**:
```http
GET _cluster/health?wait_for_status=green&timeout=120s&filter_path=status,number_of_nodes,active_shards,unassigned_shards
```

**Đầu ra mẫu:**
```json
{"status":"green","number_of_nodes":3,"active_shards":9,"unassigned_shards":0}
```

**Giải thích:** khi `es02` và `es03` trở lại, ít nhất hai node có thể bầu master. Cluster state và shard được phục hồi; dữ liệu không cần nạp lại vì volume của các node vẫn còn nguyên.

### 📸 Cần chụp lại cho báo cáo
- Lỗi `master_not_discovered_exception` (hoặc timeout/503) khi chỉ còn 1 node.
- Đoạn log của `es01` thể hiện không đủ master-eligible node.
- Cluster health trở lại `green` sau khi khởi động lại `es02`, `es03`.
- Giải thích công thức `floor(N/2)+1` trong báo cáo, minh hoạ tại sao cluster 3 node chỉ chịu được 1 lỗi.

---

## MỤC 12. ÉP LỖI UNASSIGNED SHARD (CẤU HÌNH SAI REPLICA)

> **Mục tiêu:** chủ động tạo unassigned replica, chẩn đoán nguyên nhân bằng Allocation Explain API và đưa cluster trở lại `green`.
>
> **Lý do thực hiện:** unassigned shard là sự cố vận hành thường gặp. Bài lab rèn quy trình dựa trên quyết định của allocation decider thay vì sửa cấu hình bằng phỏng đoán.

### 12.1 Tình huống
Trên cluster chỉ có 3 node, nếu đặt `number_of_replicas = 3`, mỗi primary shard cần tổng cộng 4 bản sao (1 primary + 3 replica) nằm trên **4 node khác nhau** — nhưng cluster chỉ có 3 node. Elasticsearch sẽ không thể phân bổ đủ replica.

### 12.2 Thực hiện
```http
PUT products-lab/_settings
{
  "index": { "number_of_replicas": 3 }
}
```
Kiểm tra health và số shard chưa được gán:
```http
GET _cluster/health/products-lab?filter_path=status,active_primary_shards,active_shards,unassigned_shards
```

**Đầu ra mẫu:**
```json
{"acknowledged":true}
{"status":"yellow","active_primary_shards":3,"active_shards":9,"unassigned_shards":3}
```

**Giải thích:** ba primary vẫn hoạt động. Mỗi shard có primary và hai replica đang chạy trên ba node (`9` active), còn replica thứ ba của mỗi shard không có node thứ tư để đặt, tạo `3` unassigned shard và làm health chuyển `yellow`.

### 12.3 Chẩn đoán bằng Allocation Explain API
```http
POST _cluster/allocation/explain?filter_path=index,shard,primary,current_state,allocate_explanation,node_allocation_decisions
{
  "index": "products-lab",
  "shard": 0,
  "primary": false
}
```
Kết quả sẽ cho thấy quyết định **NO** từ decider **same-shard** (không được đặt 2 bản của cùng shard trên cùng 1 node) — đây chính là API đầu tiên nên dùng khi gặp unassigned shard trong thực tế, thay vì đoán mò nguyên nhân.

**Đầu ra mẫu (rút gọn):**
```json
{
  "index": "products-lab",
  "shard": 0,
  "primary": false,
  "current_state": "unassigned",
  "allocate_explanation": "Elasticsearch isn't allowed to allocate this shard to any of the nodes in the cluster",
  "node_allocation_decisions": [
    {
      "node_name": "es01",
      "node_decision": "no",
      "deciders": [
        { "decider": "same_shard", "decision": "NO", "explanation": "a copy of this shard is already allocated to this node" }
      ]
    }
  ]
}
```

**Giải thích:** API đánh giá từng node. Cả ba node đều nhận quyết định `NO` vì mỗi node đã chứa một bản của shard `0`; đặt thêm sẽ vi phạm quy tắc không colocate hai bản cùng shard.

### 12.4 Khắc phục
```http
PUT products-lab/_settings
{
  "index": { "number_of_replicas": 2 }
}

GET _cluster/health/products-lab?wait_for_status=green&timeout=60s&filter_path=status,active_shards,unassigned_shards
```

**Đầu ra mẫu:**
```json
{"acknowledged":true}
{"status":"green","active_shards":9,"unassigned_shards":0}
```

**Giải thích:** giảm replica về hai làm tổng số bản mỗi shard bằng đúng số node hiện có; các unassigned replica dư biến mất và cluster trở lại `green`.

### 📸 Cần chụp lại cho báo cáo
- Cluster health chuyển `yellow` với `unassigned_shards > 0` sau khi đặt replicas=3.
- Kết quả `_cluster/allocation/explain` (chú ý trường `node_allocation_decisions` với quyết định `NO`).
- Cluster health trở lại `green` sau khi sửa về replicas=2.

---

## MỤC 13. BULK API VÀ REINDEX CƠ BẢN

> **Mục tiêu:** hiểu lợi ích của Bulk API và thực hiện sao chép document từ index nguồn sang một index đích bằng `_reindex`.
>
> **Lý do thực hiện:** Bulk giảm chi phí HTTP khi ghi nhiều document, còn reindex là công cụ nền tảng để di chuyển dữ liệu, chuẩn bị đổi mapping hoặc tái tổ chức index.

### 13.1 Vì sao cần Bulk API
Giảm số round-trip HTTP, tăng throughput khi ghi số lượng lớn document so với gửi từng request `PUT`/`POST` riêng lẻ.

### 13.2 Reindex cơ bản sang index tạm
```http
POST _reindex?wait_for_completion=true&refresh=true&filter_path=took,total,created,updated,failures
{
  "source": { "index": "products-lab" },
  "dest": { "index": "products-lab-copy" }
}

GET products-lab-copy/_count
```

**Đầu ra mẫu:**
```json
{"took":87,"total":3,"created":3,"updated":0,"failures":[]}
{"count":3,"_shards":{"total":1,"successful":1,"skipped":0,"failed":0}}
```

**Giải thích:** `_reindex` đọc ba document nguồn rồi tạo ba document đích; mảng `failures` rỗng xác nhận không có item lỗi. Vì chưa tạo trước `products-lab-copy`, Elasticsearch tự tạo index này bằng cấu hình/mapping mặc định. Khi đổi mapping thật, phải tạo index đích trước với mapping mong muốn như Mục 14.

Dọn index tạm để không ảnh hưởng các bài sau:
```http
DELETE products-lab-copy
```

**Đầu ra mẫu và giải thích:** `{"acknowledged":true}` nghĩa là thao tác xóa index đã được cluster chấp nhận. Index nguồn `products-lab` không bị thay đổi.

### 📸 Cần chụp lại cho báo cáo
- Kết quả `_bulk` (`errors: false`, danh sách `items`).
- Kết quả `_reindex` (`total`, `created`, `took`).

---

## MỤC 14. ZERO-DOWNTIME REINDEX + CUTOVER BẰNG ALIAS

> **Mục tiêu:** tạo index phiên bản mới, reindex dữ liệu và chuyển alias sang index mới bằng một thao tác nguyên tử.
>
> **Lý do thực hiện:** nhiều thay đổi mapping không thể áp dụng trực tiếp lên field đã tồn tại. Alias giúp ứng dụng đổi index vật lý mà không đổi endpoint và không có khoảng trống phục vụ trong lúc cutover.

### 14.1 Vấn đề cần giải quyết
Mapping của một field **đã tồn tại** thường không thể đổi kiểu trực tiếp (ví dụ đổi `price` từ `float` sang `scaled_float`). Cách làm đúng trong thực tế là: tạo index phiên bản mới → reindex dữ liệu sang → **chuyển alias đọc sang index mới trong một thao tác nguyên tử**, để client không bao giờ thấy khoảng trống dữ liệu.

### 14.2 Bước 1 — Gắn alias đọc vào index hiện tại (v1)
```http
POST _aliases
{
  "actions": [
    { "add": { "index": "products-lab", "alias": "products-read" } }
  ]
}

GET _alias/products-read
```
Từ giờ, ứng dụng nên đọc qua alias `products-read` thay vì gọi thẳng tên index.

**Đầu ra mẫu:**
```json
{"acknowledged":true}
{"products-lab":{"aliases":{"products-read":{}}}}
```

**Giải thích:** alias chỉ là tên logic trong cluster state, không sao chép document. Trước cutover, `products-read` phân giải duy nhất tới index nguồn `products-lab`.

### 14.3 Bước 2 — Tạo index v2 với mapping mới (ví dụ thêm field `brand`)
```http
PUT products-lab-v2
{
  "settings": { "number_of_shards": 3, "number_of_replicas": 2 },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "productId":   { "type": "keyword" },
      "name":        { "type": "text", "fields": { "raw": { "type": "keyword" } } },
      "description": { "type": "text" },
      "category":    { "type": "keyword" },
      "brand":       { "type": "keyword" },
      "price":       { "type": "scaled_float", "scaling_factor": 100 },
      "stock":       { "type": "integer" },
      "createdAt":   { "type": "date" }
    }
  }
}
```

**Đầu ra mẫu:**
```json
{"acknowledged":true,"shards_acknowledged":true,"index":"products-lab-v2"}
```

**Giải thích:** index vật lý mới được tạo độc lập nên có thể dùng mapping mới, ở đây thêm `brand`. Việc tạo trước đích cũng tránh `_reindex` tự suy luận mapping không như mong muốn.

### 14.4 Bước 3 — Reindex dữ liệu từ v1 sang v2
```http
POST _reindex?wait_for_completion=true&refresh=true&filter_path=took,total,created,failures
{
  "source": { "index": "products-lab" },
  "dest": { "index": "products-lab-v2" }
}
```

**Đầu ra mẫu:**
```json
{"took":74,"total":3,"created":3,"failures":[]}
```

**Giải thích:** ba document được sao chép sang v2 và có thể search ngay nhờ `refresh=true`. `failures: []` là điều kiện cần kiểm tra trước khi cutover; `took` thay đổi theo máy.

### 14.5 Bước 4 — Cutover alias (nguyên tử, không downtime)
```http
POST _aliases
{
  "actions": [
    { "remove": { "index": "products-lab",    "alias": "products-read" } },
    { "add":    { "index": "products-lab-v2", "alias": "products-read" } }
  ]
}

GET _alias/products-read

GET products-read/_count
```

**Đầu ra mẫu:**
```json
{"acknowledged":true}
{"products-lab-v2":{"aliases":{"products-read":{}}}}
{"count":3,"_shards":{"total":3,"successful":3,"skipped":0,"failed":0}}
```

**Giải thích:** sau một cluster-state update, alias chỉ còn trỏ tới v2. Count qua alias vẫn là `3`, chứng minh client tiếp tục đọc cùng lượng dữ liệu mà không cần đổi URL hoặc thấy khoảng trống giữa hai index.

### 14.6 Tại sao không có downtime?
Request `_aliases` chứa cả `remove` và `add` được áp dụng **trong cùng một cập nhật cluster-state** — client không bao giờ thấy trạng thái "không có index nào gắn alias". Nếu cần rollback, chỉ cần đảo ngược `remove`/`add` để trỏ alias về lại `products-lab`.

> Lưu ý: `_reindex` chỉ copy dữ liệu tại thời điểm chạy — với hệ thống có ghi liên tục, cần thêm cơ chế đồng bộ phần dữ liệu ghi mới trong lúc reindex (ví dụ dual-write hoặc tạm dừng ghi ngắn), nội dung này nằm ngoài phạm vi bài lab.

### 📸 Cần chụp lại cho báo cáo
- Kết quả reindex không có `failures`.
- `_alias/products-read` trước cutover (trỏ vào v1) và sau cutover (trỏ vào v2).
- `_count` qua alias khớp với số document ở index v2.

---

## MỤC 15. SNAPSHOT VÀ RESTORE

> **Mục tiêu:** đăng ký repository, tạo snapshot, restore sang index tên khác và đối chiếu số document trước/sau khôi phục.
>
> **Lý do thực hiện:** replica chỉ bảo vệ khi node hỏng và vẫn sao chép cả thao tác xóa/ghi sai. Snapshot cung cấp bản backup độc lập để phục hồi sau lỗi logic hoặc sự cố toàn cluster.

### 15.1 Vì sao replica không thay thế được backup
Replica bảo vệ khỏi lỗi phần cứng/node nhưng **không bảo vệ khỏi lỗi logic** (xoá nhầm index, ghi đè sai dữ liệu) vì thao tác lỗi sẽ được nhân bản sang cả replica. Snapshot là cơ chế backup độc lập, giúp khôi phục về một thời điểm trước đó.

### 15.2 Đăng ký Snapshot Repository (filesystem, dùng chung volume `es_snapshots`)
```http
PUT _snapshot/lab-repo
{
  "type": "fs",
  "settings": {
    "location": "lab-backups",
    "compress": true
  }
}

POST _snapshot/lab-repo/_verify
```
`_verify` kiểm tra cả 3 node đều truy cập được cùng một shared path — bắt buộc vì snapshot cần mọi node cùng thấy chung repository.

**Đầu ra mẫu:**
```json
{"acknowledged":true}
{
  "nodes": {
    "R7m...": { "name": "es01" },
    "u2K...": { "name": "es02" },
    "Q9x...": { "name": "es03" }
  }
}
```

**Giải thích:** đăng ký repository chỉ lưu cấu hình; `_verify` mới thực sự thử thao tác với repository trên các node. Đủ ba tên node cho thấy shared volume và quyền ghi/đọc đang đúng.

### 15.3 Tạo snapshot
```http
PUT _snapshot/lab-repo/products-snapshot-01?wait_for_completion=true&filter_path=snapshot.snapshot,snapshot.state,snapshot.indices,snapshot.shards
{
  "indices": "products-lab-v2",
  "include_global_state": false
}
```

**Đầu ra mẫu:**
```json
{
  "snapshot": {
    "snapshot": "products-snapshot-01",
    "state": "SUCCESS",
    "indices": ["products-lab-v2"],
    "shards": { "total": 3, "failed": 0, "successful": 3 }
  }
}
```

**Giải thích:** `wait_for_completion=true` làm request chờ đến khi snapshot xong. `SUCCESS` và `failed: 0` chứng minh cả ba primary shard của v2 đã được backup; replica không làm tăng số shard logic trong snapshot.

### 15.4 Restore sang tên khác (để đối chiếu, không đè lên index đang chạy)
```http
POST _snapshot/lab-repo/products-snapshot-01/_restore?wait_for_completion=true&filter_path=snapshot.shards
{
    "indices": "products-lab-v2",
    "rename_pattern": "products-lab-v2",
    "rename_replacement": "products-lab-restored",
    "include_aliases": false,
    "include_global_state": false
}

GET products-lab-v2/_count?filter_path=count

GET products-lab-restored/_count?filter_path=count
```
`include_aliases: false` để tránh alias `products-read` (đang trỏ vào v2) bị gắn luôn vào bản restore, gây đếm trùng khi query qua alias.

**Đầu ra mẫu:**
```json
{"snapshot":{"shards":{"total":3,"failed":0,"successful":3}}}
{"count":3}
{"count":3}
```

**Giải thích:** restore thành công trên cả ba shard; hai response `_count` theo đúng thứ tự source rồi restored đều trả `3`, nên bản khôi phục có đủ document. Đổi tên giúp đối chiếu an toàn, không đóng hoặc ghi đè index v2 đang phục vụ alias.

### 15.5 Lưu ý về phạm vi lab
Volume dùng chung `es_snapshots` chỉ mô phỏng shared filesystem trên **một Docker host** — đây là cách đơn giản để học cơ chế. Trong production, repository phải là hạ tầng lưu trữ độc lập với cluster (S3, GCS, Azure Blob, hoặc NAS/shared filesystem thật), kèm chính sách backup định kỳ (SLM) và diễn tập restore thường xuyên.

### 📸 Cần chụp lại cho báo cáo
- Kết quả `_verify` (danh sách 3 node xác nhận truy cập được repository).
- Snapshot có `state: SUCCESS`, `shards.failed: 0`.
- `_count` của index `products-lab-restored` khớp với index gốc `products-lab-v2`.
- Giải thích ngắn: vì sao cần snapshot dù đã có 2 replica.

---

## MỤC 16. TÌNH HUỐNG THỰC TẾ (TROUBLESHOOTING TỔNG HỢP)

> **Mục tiêu:** xây dựng trình tự thu thập cluster health, shard state và disk allocation trước khi đưa ra hướng xử lý sự cố.
>
> **Lý do thực hiện:** thay đổi cấu hình khi chưa xác định nguyên nhân có thể làm sự cố nghiêm trọng hơn. Một quy trình kiểm tra chỉ đọc giúp khoanh vùng vấn đề và lưu lại bằng chứng phục vụ báo cáo.

| Hiện tượng | API kiểm tra | Nguyên nhân thường gặp |
|---|---|---|
| Cluster yellow/red | `_cluster/health`, `_cat/shards` | Mất node, thiếu replica, mất primary |
| Unassigned shard | `_cluster/allocation/explain` | Cấu hình replica sai (Mục 12), disk watermark, allocation filter |
| Mất quorum | `_cluster/health`, log node | Dừng đồng thời quá nửa số master-eligible node (Mục 11) |
| Mapping exception | `_mapping`, lỗi item trong `_bulk` | Sai kiểu dữ liệu, field lạ với `dynamic: strict` |
| Search chậm | `_search` với `"profile": true` | Query đắt, quá nhiều shard nhỏ, script phức tạp |
| Disk gần đầy | `_cat/allocation` | Thiếu retention/ILM, quá nhiều replica |
| Snapshot fail | `_snapshot/.../_verify` | Quyền path, repository không chung giữa các node |

Chạy gói lệnh chỉ đọc sau để thu thập trạng thái trước khi thay đổi cấu hình:
```http
GET _cluster/health/products-lab,products-lab-v2,products-lab-restored?filter_path=status,number_of_nodes,active_primary_shards,unassigned_shards

GET _cat/shards?v=true&h=index,shard,prirep,state,unassigned.reason,node

GET _cat/allocation?v=true&h=node,shards,disk.percent,disk.avail,disk.total
```

**Đầu ra khỏe mạnh mẫu (rút gọn):**
```text
{"status":"green","number_of_nodes":3,"active_primary_shards":9,"unassigned_shards":0}
index                 shard prirep state   unassigned.reason node
products-lab          0     p      STARTED                   es01
products-lab-v2       0     r      STARTED                   es02
products-lab-restored 0     r      STARTED                   es03
node shards disk.percent disk.avail disk.total
es01      9           24     72.1gb     95gb
```

**Giải thích:** số primary lúc này là `9` vì đang tồn tại ba index, mỗi index ba primary shard. Trong trạng thái tốt, mọi shard là `STARTED`, cột `unassigned.reason` trống và disk chưa chạm watermark. Con số dung lượng, số shard trên từng node và cách phân bổ sẽ khác. Nếu health `yellow/red`, lọc các dòng `UNASSIGNED` rồi gọi `_cluster/allocation/explain` như Mục 12 trước khi sửa.

### 📸 Cần chụp lại cho báo cáo
- Bảng trên tự trình bày lại trong báo cáo, đối chiếu với các lỗi thực tế đã gặp trong quá trình làm lab (Mục 5.3, 11, 12, 15).

---

## MỤC 17. BẢO MẬT CƠ BẢN (TÙY CHỌN – NÂNG CAO)

> **Mục tiêu:** hiểu yêu cầu bật security trên cluster nhiều node và tạo role/user có quyền tối thiểu bằng Security API.
>
> **Lý do thực hiện:** cluster không xác thực có thể bị đọc, sửa hoặc xóa dữ liệu bởi bất kỳ client nào truy cập được. RBAC áp dụng nguyên tắc least privilege để giới hạn thiệt hại khi tài khoản bị lộ hoặc ứng dụng thao tác sai.

### 17.1 Kích hoạt X-Pack Security
```yaml
xpack.security.enabled=true
```
Sau khi bật, cần thiết lập mật khẩu cho user hệ thống:
```bash
docker exec -it es01 bin/elasticsearch-reset-password -u elastic
docker exec -it es01 bin/elasticsearch-reset-password -u kibana_system
```

> Với cluster nhiều node, chỉ thêm một dòng trên là **chưa đủ để khởi động an toàn**: cần cấu hình chứng thư TLS cho transport giữa các node rồi restart toàn cluster. Phần tạo CA/certificate nằm ngoài phạm vi lab này. Sau đó cấu hình Kibana bằng tài khoản `kibana_system` (hoặc service account token), restart Kibana và đăng nhập giao diện bằng `elastic`. Không lưu mật khẩu production trực tiếp trong Compose/Git.

### 17.2 Role-based Access Control (RBAC)
- Tạo **role** giới hạn quyền theo index/action.
- Gán role cho **user** cụ thể để kiểm soát truy cập chi tiết.

Đăng nhập Kibana bằng `elastic`, sau đó chạy trong **Dev Tools**. Chỉ dùng mật khẩu dùng một lần trong môi trường lab vì request được lưu trong Console history:
```http
PUT _security/role/products_reader
{
  "cluster": [],
  "indices": [
    {
      "names": ["products-read"],
      "privileges": ["read", "view_index_metadata"]
    }
  ]
}

POST _security/user/lab_reader
{
  "password": "ThayBangMatKhauLabManh!",
  "roles": ["products_reader"]
}
```

Dev Tools luôn dùng tài khoản của phiên Kibana hiện tại. Để kiểm tra đúng quyền của `lab_reader`, dùng Terminal hoặc đăng nhập bằng user đó trong một client khác:
```bash
read -s -p 'Mật khẩu lab_reader: ' LAB_READER_PASSWORD; echo
curl -fsS --user "lab_reader:${LAB_READER_PASSWORD}" \
  localhost:9200/products-read/_count
unset LAB_READER_PASSWORD
```

**Đầu ra mẫu:**
```json
{"role":{"created":true}}
{"created":true}
{"count":3,"_shards":{"total":3,"successful":3,"skipped":0,"failed":0}}
```

**Giải thích:** superuser tạo một role chỉ có quyền đọc alias `products-read`, sau đó gán role cho `lab_reader`. Request `_count` thành công chứng minh user có quyền đọc; user này không có quyền ghi, xóa index hoặc quản trị cluster. Không ghi mật khẩu thật trực tiếp vào tài liệu hay commit vào Git.

### 📸 Cần chụp lại cho báo cáo (nếu triển khai)
- Kết quả hai API tạo role/user và `_count` thành công bằng tài khoản `lab_reader`.

---

## MỤC 18. DỌN DẸP MÔI TRƯỜNG LAB

> **Mục tiêu:** xóa các tài nguyên Elasticsearch đã tạo và phân biệt việc dừng container có giữ volume với việc xóa toàn bộ volume.
>
> **Lý do thực hiện:** dọn dẹp tránh dữ liệu cũ ảnh hưởng lần chạy sau, giải phóng tài nguyên máy và giúp người học nhận biết rõ thao tác nào có thể phục hồi, thao tác nào làm mất dữ liệu vĩnh viễn.

> Các API xóa được chạy trong Dev Tools nên tự dùng phiên đăng nhập Kibana hiện tại. Nếu security đang tắt theo luồng lab chính, không cần xác thực.

Trong **Kibana Dev Tools**:
```http
DELETE products-lab,products-lab-v2,products-lab-restored,products-lab-copy?ignore_unavailable=true

DELETE _snapshot/lab-repo/products-snapshot-01

DELETE _snapshot/lab-repo
```

Trong **Terminal**:
```bash
# Dừng Elasticsearch và Kibana nhưng giữ lại data volume
docker compose -f docker-compose.elasticsearch.yml down

# Chạy lại với dữ liệu cũ
docker compose -f docker-compose.elasticsearch.yml up -d

# Chỉ xoá toàn bộ khi chắc chắn không cần dữ liệu nữa
docker compose -f docker-compose.elasticsearch.yml down -v
```

**Đầu ra mẫu của các lệnh xóa REST:**
```json
{"acknowledged":true}
{"acknowledged":true}
{"acknowledged":true}
```

**Đầu ra mẫu của `docker compose ... down`:**
```text
Container es03  Removed
Container es02  Removed
Container es01  Removed
Container kibana Removed
Network ...     Removed
```

**Giải thích:** response `acknowledged` lần lượt xác nhận xóa index, snapshot và đăng ký repository. `docker compose down` xóa container/network nhưng giữ named volume, nên `up -d` có thể dùng lại dữ liệu. `down -v` xóa cả volume dữ liệu và snapshot; đây là bước không thể khôi phục từ các volume đó, chỉ chạy sau khi đã chắc chắn không cần dữ liệu.

### 📸 Cần chụp lại cho báo cáo
- Kết quả `docker compose down` / `down -v` và xác nhận container đã dừng bằng `docker ps`.

---

## MỤC 19. TỔNG KẾT VÀ CÂU HỎI ÔN TẬP

### 19.1 Bảng tổng hợp khái niệm cốt lõi
| Khái niệm | Vai trò |
|---|---|
| Inverted Index | Nền tảng tốc độ full-text search |
| Shard/Replica | Phân tán dữ liệu, chịu lỗi |
| Analyzer | Chuẩn hóa văn bản trước khi index |
| Translog | Đảm bảo durability trước khi flush |
| Refresh | Cho phép NRT search |
| Merge | Tối ưu số lượng segment, dọn dữ liệu đã xóa |
| Elected master | Quản lý cluster state, được bầu từ các master-eligible node |
| Quorum | Số node tối thiểu (`floor(N/2)+1`) để bầu master, tránh split-brain |
| Alias | Lớp gián tiếp giữa client và index vật lý, cho phép cutover không downtime |
| Snapshot | Backup độc lập với replica, chống lại lỗi logic (xoá/ghi đè nhầm) |

### 19.2 Câu hỏi ôn tập gợi ý (đưa vào báo cáo)
1. Vì sao Elasticsearch không thể search ngay tức thời sau khi ghi dữ liệu? Vì sao `GET` theo ID vẫn thấy được ngay?
2. Phân biệt `text` và `keyword`, cho ví dụ tình huống dùng sai gây lỗi khi aggregation.
3. Khi nào cluster chuyển Yellow, khi nào chuyển Red? Cách khắc phục từng trường hợp.
4. Tại sao không thể thay đổi số lượng primary shard sau khi tạo index?
5. So sánh `must` và `filter` trong bool query về mặt hiệu năng và relevance score.
6. Vì sao cluster 3 node chỉ chịu được tối đa 1 node lỗi? Điều gì xảy ra khi mất 2 node?
7. Vì sao đặt `number_of_replicas` quá lớn so với số node lại gây ra unassigned shard?
8. Alias giúp gì cho việc đổi mapping mà không gây downtime? Vì sao thao tác remove/add alias được xem là nguyên tử?
9. Vì sao đã có 2 replica nhưng vẫn cần snapshot?

### 📸 Cần chụp lại cho báo cáo
- Bảng tổng hợp tự trình bày lại (có thể chèn ảnh hoặc gõ lại bằng Word).

---

## MỞ RỘNG (KHÔNG BẮT BUỘC — DÀNH CHO AI MUỐN TÌM HIỂU SÂU HƠN)

Hai chủ đề sau vẫn nằm ngoài phạm vi báo cáo chính vì đi sâu vào chi tiết vận hành ứng dụng hơn là cơ chế lõi của Elasticsearch:
- **Optimistic concurrency control**: dùng `_seq_no` + `_primary_term` để tránh lost update khi nhiều client cùng ghi một document, xử lý lỗi HTTP 409 `version_conflict_engine_exception`.
- **Deep pagination**: dùng `search_after` kết hợp Point in Time (PIT) thay vì `from`/`size` khi cần lấy dữ liệu ở trang rất sâu (vượt `index.max_result_window`, mặc định 10.000).

## GHI CHÚ TRÌNH BÀY BÁO CÁO
- Mỗi mục nên có: **Lệnh thực hiện → Kết quả (ảnh chụp) → Giải thích ý nghĩa kết quả**.
- Đánh số ảnh chụp tương ứng với số mục (ví dụ: Hình 5.1, Hình 5.2...).
- Phần "Tình huống thực tế" (Mục 11, 12, 15, 16) nên trình bày theo cấu trúc: **Hiện tượng → Nguyên nhân → Cách xử lý** để thể hiện tư duy vận hành hệ thống, không chỉ là thao tác lệnh.
