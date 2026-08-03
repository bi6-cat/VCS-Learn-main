# BÁO CÁO: LÝ THUYẾT VÀ THỰC HÀNH ELASTICSEARCH

---

## MỤC LỤC

1. [Tổng quan về Elasticsearch](#1-tổng-quan-về-elasticsearch)
2. [Các khái niệm cốt lõi](#2-các-khái-niệm-cốt-lõi)
3. [Kiến trúc và cơ chế hoạt động](#3-kiến-trúc-và-cơ-chế-hoạt-động)
4. [Inverted Index và Analyzer](#4-inverted-index-và-analyzer)
5. [Chấm điểm liên quan (Relevance Scoring — BM25)](#5-chấm-điểm-liên-quan-relevance-scoring--bm25)
6. [Cơ chế bền vững dữ liệu (Durability & Recovery)](#6-cơ-chế-bền-vững-dữ-liệu-durability--recovery)
7. [Sharding, Replication và High Availability](#7-sharding-replication-và-high-availability)
8. [Hướng dẫn Lab thực hành cơ bản](#8-hướng-dẫn-lab-thực-hành-cơ-bản)
9. [Dự án demo: Hệ thống Log Search HA (Kafka + Elasticsearch + Nginx + HAProxy + Keepalived + Supervisord)](#9-dự-án-demo-hệ-thống-log-search-ha-kafka--elasticsearch--nginx--haproxy--keepalived--supervisord)
10. [Lưu ý và xử lý sự cố thực tế](#10-lưu-ý-và-xử-lý-sự-cố-thực-tế)
11. [Kết luận](#11-kết-luận)

---

## 1. Tổng quan về Elasticsearch

### 1.1. Elasticsearch là gì

**Elasticsearch (ES)** là một search engine & analytics engine phân tán, mã nguồn mở, xây dựng trên nền thư viện **Apache Lucene**. ES lưu trữ dữ liệu dạng document JSON, đánh chỉ mục (index) chúng để tìm kiếm full-text và phân tích (aggregation) trên tập dữ liệu lớn với độ trễ thấp, gần thời gian thực (**near real-time**, không phải real-time tuyệt đối — lý do giải thích ở mục 3.4).

ES giao tiếp qua REST API bằng JSON (**Query DSL**), có thể mở rộng theo chiều ngang bằng cách thêm node vào cluster, và tự động phân phối dữ liệu (sharding) cũng như nhân bản (replication) để chịu lỗi.

### 1.2. So sánh nhanh với các hệ thống liên quan

| Tiêu chí | Elasticsearch | RDBMS (MySQL/PostgreSQL) | Redis |
|---|---|---|---|
| Mô hình dữ liệu | Document JSON, đánh index cho tìm kiếm | Bảng quan hệ, ràng buộc, index B-Tree | Key-value / cấu trúc dữ liệu trong RAM |
| Thế mạnh | Full-text search, phân tích thống kê trên dữ liệu lớn | Toàn vẹn dữ liệu, transaction ACID, quan hệ phức tạp | Tốc độ đọc/ghi cực nhanh, cache |
| Truy vấn | Query DSL (JSON), tính điểm liên quan (relevance score) | SQL, JOIN | Lệnh theo cấu trúc dữ liệu (GET/SET/ZADD...) |
| Consistency | Eventually consistent giữa các shard/replica | Strong consistency (ACID) | Strong trên 1 node, eventual giữa replica |
| Mở rộng | Horizontal scaling qua sharding tự động | Thường scale-up hoặc cần kỹ thuật sharding thủ công | Cluster (hash slot) hoặc Replication |

### 1.3. Các trường hợp sử dụng phổ biến

- **Tìm kiếm full-text**: e-commerce (tìm sản phẩm), tài liệu, tìm kiếm nội bộ doanh nghiệp
- **Log & metrics analytics**: trung tâm của bộ **ELK/Elastic Stack** (Elasticsearch – Logstash – Kibana)
- **Application Performance Monitoring (APM)**: theo dõi hiệu năng ứng dụng theo thời gian thực
- **Security analytics (SIEM)**: phát hiện bất thường, phân tích log bảo mật
- **Vector search / semantic search**: tìm kiếm theo ngữ nghĩa (kNN trên embedding vector) ở các phiên bản gần đây

### 1.4. Đặc điểm nổi bật

| Đặc điểm | Mô tả |
|---|---|
| Phân tán (Distributed) | Dữ liệu và tải truy vấn được chia đều cho nhiều node trong cluster |
| Near real-time | Document mới ghi vào có thể tìm thấy sau khoảng `refresh_interval` (mặc định ~1s), không tức thì tuyệt đối |
| Schema linh hoạt | Có thể tự suy luận kiểu dữ liệu (dynamic mapping) hoặc khai báo mapping tường minh |
| RESTful | Toàn bộ thao tác (CRUD, search, quản trị) đều qua HTTP + JSON, dễ tích hợp với bất kỳ ngôn ngữ nào |
| Chịu lỗi | Replica shard tự động promote thành primary khi node chứa primary bị mất |
| Hệ sinh thái | Kibana (trực quan hóa), Logstash/Beats (thu thập dữ liệu) tạo thành Elastic Stack hoàn chỉnh |

---

## 2. Các khái niệm cốt lõi

| Khái niệm | Mô tả | Tương đương trong RDBMS |
|---|---|---|
| **Cluster** | Tập hợp một hay nhiều node hoạt động cùng nhau, chia sẻ một `cluster.name` | Toàn bộ hệ thống DB |
| **Node** | Một tiến trình Elasticsearch đang chạy (có thể là 1 container/1 máy) | Một instance DB server |
| **Index** | Tập hợp các document có cùng đặc điểm, được đánh chỉ mục cùng nhau | Database / Table |
| **Document** | Đơn vị dữ liệu cơ bản, định dạng JSON | Row (bản ghi) |
| **Field** | Một thuộc tính bên trong document | Column |
| **Mapping** | Định nghĩa kiểu dữ liệu cho từng field trong index | Table schema |
| **Shard** | Một mảnh của index, thực chất là một Lucene index độc lập | Partition |
| **Replica** | Bản sao của một shard, phục vụ chịu lỗi (HA) và tăng throughput đọc | Standby / Read replica |

---

## 3. Kiến trúc và cơ chế hoạt động

### 3.1. Vai trò các loại node

Một node Elasticsearch có thể đảm nhận một hoặc nhiều vai trò cùng lúc (cấu hình qua `node.roles`):

- **Master-eligible node**: có quyền được bầu làm master, quản lý **cluster state** — metadata toàn cục (danh sách index, mapping, vị trí phân bổ shard trên node nào...). Tại một thời điểm chỉ có **một master đang hoạt động**; các thay đổi cluster state phải được đa số node master-eligible (quorum) đồng thuận trước khi áp dụng, nhằm tránh **split-brain** (hai node cùng tưởng mình là master).
- **Data node**: lưu trữ shard thật sự, thực hiện CRUD, search cục bộ trên shard mà nó giữ, và aggregation cục bộ.
- **Ingest node**: chạy pipeline tiền xử lý document (transform, enrich, parse) trước khi lưu vào index.
- **Coordinating node**: mọi node đều có khả năng đóng vai trò này — tiếp nhận request từ client, định tuyến (route) đến đúng shard, rồi gộp (merge) kết quả từ các shard trả về client. Trong cluster nhỏ, một node có thể vừa là master, vừa là data, vừa là coordinating cùng lúc; cluster lớn production thường tách riêng từng vai trò cho từng nhóm node để tối ưu tài nguyên.

### 3.2. Cơ chế ghi dữ liệu (Write path)

1. Client gửi request index document tới một **coordinating node** bất kỳ.
2. Coordinating node tính toán shard đích bằng công thức routing mặc định: `hash(_id) % số_lượng_primary_shard`, sau đó chuyển request tới **primary shard** tương ứng (có thể đang nằm trên node khác).
3. Primary shard ghi thay đổi vào **translog** (write-ahead log, xem mục 6) và vào **in-memory buffer** — dữ liệu ở bước này **chưa** tìm kiếm được.
4. Primary shard chuyển tiếp (replicate) thao tác ghi này song song tới toàn bộ **replica shard** tương ứng; chỉ khi các bản sao xác nhận ghi thành công, request mới được coi là hoàn tất (tuỳ `wait_for_active_shards`).
5. Định kỳ (mặc định mỗi 1 giây, cấu hình qua `refresh_interval`), in-memory buffer được **refresh** thành một **segment** Lucene mới → lúc này dữ liệu mới thực sự **searchable**. Đây chính là lý do ES được gọi là *near real-time* chứ không phải real-time tuyệt đối.
6. Các segment nhỏ được **merge** định kỳ ở nền thành segment lớn hơn để giảm số lượng file, tối ưu tốc độ tìm kiếm.
7. Translog được **flush** (Lucene commit) xuống đĩa theo chu kỳ, đảm bảo dữ liệu bền vững ngay cả khi chưa refresh.

### 3.3. Cơ chế đọc dữ liệu (Read path) — mô hình Scatter-Gather

Elasticsearch thực hiện truy vấn theo hai pha (**query phase** và **fetch phase**), do một shard không biết toàn bộ dữ liệu nằm ở shard khác:

- **Query phase**: coordinating node gửi truy vấn tới một bản sao (primary hoặc replica, chọn theo round-robin) của **mọi shard liên quan** đến index. Mỗi shard tự tìm kiếm cục bộ trên dữ liệu nó có, trả về **ID và điểm relevance (score)** của top-N kết quả — chưa trả nội dung document đầy đủ.
- **Fetch phase**: coordinating node gộp toàn bộ kết quả từ các shard, sắp xếp lại theo score, chọn ra top-K cuối cùng cần trả cho client, rồi mới gửi request lấy **nội dung đầy đủ** của đúng K document đó tới các shard tương ứng.

Tách hai pha như vậy giúp tránh việc mọi shard phải truyền toàn bộ nội dung document về coordinating node dù phần lớn không nằm trong top-K cuối cùng, tiết kiệm băng thông mạng đáng kể khi query trên cluster nhiều shard.

### 3.4. Tính chất "Near Real-time"

Vì dữ liệu chỉ searchable sau khi refresh (mặc định 1 giây), có một khoảng trễ ngắn giữa lúc ghi và lúc tìm thấy được document. Có thể ép refresh ngay lập tức bằng `?refresh=true` khi gọi API ghi (hữu ích khi viết test, nhưng **không nên dùng trong production** vì refresh liên tục tạo ra nhiều segment nhỏ, tốn CPU cho việc merge sau này).

---

## 4. Inverted Index và Analyzer

### 4.1. Inverted Index — cơ chế tìm kiếm

Đây là cấu trúc dữ liệu cốt lõi giúp ES tìm kiếm cực nhanh. Thay vì quét tuần tự từng document (linear scan) như cách RDBMS truyền thống xử lý `LIKE '%...%'`, Lucene xây dựng **inverted index**: ánh xạ từ **term (từ khóa)** sang **danh sách document chứa từ đó**.

Ví dụ với 2 document:
```
Doc1: "quick brown fox"
Doc2: "quick blue fish"
```

Inverted index tương ứng:
```
Term      | Documents
----------|----------
quick     | Doc1, Doc2
brown     | Doc1
fox       | Doc1
blue      | Doc2
fish      | Doc2
```

Khi tìm "quick fish", ES chỉ cần tra thẳng vào bảng term thay vì quét toàn bộ document → chi phí tìm kiếm gần như không phụ thuộc vào tổng số document, khác hẳn độ phức tạp O(n) của quét tuần tự.

### 4.2. Analyzer — quá trình phân tích văn bản

Trước khi một field kiểu `text` được đưa vào inverted index, nội dung phải đi qua **Analyzer**, gồm 3 giai đoạn xử lý tuần tự:

1. **Character filters**: tiền xử lý raw text (VD: loại bỏ thẻ HTML)
2. **Tokenizer**: tách text thành các token riêng lẻ (VD: tách theo khoảng trắng/dấu câu)
3. **Token filters**: biến đổi từng token (chuyển thường, loại bỏ stopword, stemming — đưa từ về dạng gốc, VD "running" → "run")

Ví dụ minh họa:
```
"The Quick Brown Foxes!"
   → Tokenizer         → [The, Quick, Brown, Foxes]
   → Lowercase filter  → [the, quick, brown, foxes]
   → Stop word filter  → [quick, brown, foxes]
   → Stemmer filter    → [quick, brown, fox]
```

Analyzer phổ biến: `standard` (mặc định), `simple`, `whitespace`, `keyword` (giữ nguyên, không tách). Với tiếng Việt, cần dùng tokenizer chuyên biệt (VD plugin ICU hoặc analyzer tiếng Việt) vì `standard` không tách đúng từ ghép có dấu.

**Lưu ý quan trọng — `text` vs `keyword`:** field kiểu `text` được phân tích (dùng cho full-text search, VD tìm "phone" ra "smartphone"); field kiểu `keyword` giữ nguyên chuỗi, không phân tích, dùng để lọc chính xác, sort, và aggregation. Một field có thể khai báo cả hai dạng cùng lúc (multi-field) để phục vụ cả hai mục đích.

---

## 5. Chấm điểm liên quan (Relevance Scoring — BM25)

Từ phiên bản 5.0 trở đi, Elasticsearch dùng thuật toán **BM25** (bản cải tiến của TF-IDF) để tính điểm liên quan (`_score`) cho mỗi kết quả tìm kiếm, dựa trên 3 yếu tố:

- **TF (Term Frequency)**: từ khóa xuất hiện càng nhiều trong document thì điểm càng cao, nhưng có ngưỡng bão hòa để tránh bị lợi dụng bằng cách lặp từ khóa (spam)
- **IDF (Inverse Document Frequency)**: từ khóa càng hiếm gặp trong toàn bộ index thì càng có giá trị phân biệt, được cộng điểm cao hơn so với từ khóa phổ biến
- **Field length norm**: document ngắn chứa từ khóa thường được đánh giá liên quan hơn document dài chứa cùng từ khóa đó (vì tỉ trọng từ khóa trong document cao hơn)

Không cần nhớ công thức toán học chi tiết, chỉ cần hiểu nguyên tắc: **từ hiếm + xuất hiện hợp lý + document ngắn gọn, tập trung = điểm relevance cao**.

---

## 6. Cơ chế bền vững dữ liệu (Durability & Recovery)

Elasticsearch không có khái niệm RDB/AOF như Redis, nhưng có cơ chế tương đương để đảm bảo dữ liệu không mất khi node crash và có thể khôi phục khi cần.

### 6.1. Translog (Write-Ahead Log)

Mỗi shard duy trì một **translog** riêng — ghi lại mọi thao tác thay đổi dữ liệu (index, update, delete) **trước khi** chúng được phản ánh vào Lucene segment. Vì refresh (làm dữ liệu searchable) chỉ chạy định kỳ mỗi ~1 giây, translog chính là lớp đảm bảo durability cho khoảng thời gian giữa hai lần refresh/flush: nếu node crash trước khi flush, khi khởi động lại, Elasticsearch **replay translog** để khôi phục đúng các thay đổi đã xác nhận ghi thành công.

Độ an toàn được cấu hình qua `index.translog.durability`:
- `request` (mặc định): `fsync` translog xuống đĩa sau **mỗi request ghi** — an toàn nhất, tương tự `appendfsync always` của Redis AOF
- `async`: `fsync` theo chu kỳ (mặc định 5 giây) — nhanh hơn nhưng có thể mất dữ liệu của khoảng thời gian chưa kịp fsync nếu crash, tương tự `appendfsync everysec`/`no`

### 6.2. Flush (Lucene Commit)

**Flush** là thao tác commit dữ liệu trong translog vào Lucene segment trên đĩa một cách bền vững, sau đó **xóa bỏ phần translog đã commit** (không cần replay lại nữa). Flush chạy tự động khi translog đạt kích thước ngưỡng hoặc theo chu kỳ thời gian, có thể coi là điểm tương đồng gần nhất với `BGSAVE` của Redis — tạo một trạng thái đã lưu bền vững để giảm thời gian phục hồi khi restart.

### 6.3. Snapshot & Restore

Để sao lưu toàn cụm hoặc di chuyển dữ liệu sang cluster khác, Elasticsearch dùng cơ chế **Snapshot** — chụp trạng thái index tại một thời điểm ra một **repository** (shared filesystem, S3, GCS...). Snapshot đầu tiên là bản đầy đủ; các snapshot sau đó chỉ lưu phần **segment mới/thay đổi** so với snapshot trước (incremental), giúp tiết kiệm dung lượng và thời gian. Khi cần khôi phục, dùng API `_restore` để nạp lại dữ liệu từ một snapshot bất kỳ trong repository — đây là cơ chế disaster-recovery chính thức của Elasticsearch, tương tự vai trò của việc sao lưu định kỳ file RDB/AOF ra kho lưu trữ ngoài ở Redis.

---

## 7. Sharding, Replication và High Availability

### 7.1. Primary Shard và Replica Shard

- **Primary shard**: số lượng được ấn định **ngay khi tạo index** (`number_of_shards`) và rất khó thay đổi sau này (phải reindex sang index mới) — quyết định khả năng mở rộng ghi dữ liệu và mức độ song song hoá khi search.
- **Replica shard**: số lượng có thể tăng/giảm linh hoạt sau khi index đã tồn tại (`number_of_replicas`) — quyết định khả năng chịu lỗi (fault tolerance) và tăng throughput đọc, vì mỗi bản sao đều có thể phục vụ truy vấn đọc.

Nguyên tắc phân bổ: Elasticsearch **không bao giờ** đặt primary shard và replica shard của cùng một mảnh dữ liệu trên cùng một node — đảm bảo mất một node vẫn còn ít nhất một bản sao dữ liệu ở node khác.

### 7.2. Cluster State và bầu chọn Master

Mọi thay đổi cấu trúc cluster (tạo/xoá index, phân bổ lại shard, thêm/bớt node...) đều đi qua **cluster state**, chỉ được cập nhật khi có sự đồng thuận (quorum) của đa số node master-eligible. Cơ chế đồng thuận này (dựa trên thuật toán tương tự Raft) đảm bảo tại một thời điểm chỉ tồn tại đúng một master hợp lệ, tránh tình trạng **split-brain**. Đây là lý do cluster production luôn khuyến nghị số node master-eligible là **số lẻ** (thường 3) — tương tự nguyên tắc quorum của Redis Sentinel.

### 7.3. Cơ chế Failover

Khi node giữ **primary shard** của một mảnh dữ liệu bị mất kết nối hoặc crash, master phát hiện qua cơ chế heartbeat, sau đó **promote** một trong các replica shard còn sống của mảnh đó lên làm primary mới, đồng thời lên lịch tạo thêm replica mới ở node khác để bù lại số lượng bản sao đã cấu hình. Trong lúc failover diễn ra, cluster health chuyển từ `green` sang `yellow` (thiếu replica nhưng dữ liệu vẫn đầy đủ và truy vấn được) — chỉ chuyển sang `red` khi **cả primary lẫn toàn bộ replica** của một shard đều không còn node nào giữ (mất dữ liệu thật sự).

| Trạng thái Cluster Health | Ý nghĩa |
|---|---|
| `green` | Tất cả primary và replica shard đều hoạt động đầy đủ |
| `yellow` | Toàn bộ primary shard hoạt động, nhưng thiếu ít nhất một replica |
| `red` | Có ít nhất một primary shard không có bản sao nào khả dụng — mất dữ liệu của shard đó |

---

## 8. Hướng dẫn Lab thực hành cơ bản

### Lab 1: Cài đặt cluster Elasticsearch 2 node bằng Docker

```bash
docker network create elastic

docker run -d --name es01 --net elastic -p 9200:9200 \
  -e "node.name=es01" \
  -e "cluster.name=demo-cluster" \
  -e "discovery.seed_hosts=es02" \
  -e "cluster.initial_master_nodes=es01,es02" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.14.0

docker run -d --name es02 --net elastic -p 9201:9200 \
  -e "node.name=es02" \
  -e "cluster.name=demo-cluster" \
  -e "discovery.seed_hosts=es01" \
  -e "cluster.initial_master_nodes=es01,es02" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  docker.elastic.co/elasticsearch/elasticsearch:8.14.0

# Kiểm tra
curl http://localhost:9200
curl http://localhost:9200/_cluster/health?pretty
```

**Đưa vào báo cáo:**
- Sơ đồ 2 node vừa tạo, giải thích vai trò `discovery.seed_hosts`/`cluster.initial_master_nodes`
- Kết quả `_cluster/health` (số node, status `green`)

**Chụp màn hình:**
- Output `curl http://localhost:9200` (thấy `cluster_name: demo-cluster`)
- Output `curl http://localhost:9200/_cluster/health?pretty` (status `green`, `number_of_nodes: 2`)

### Lab 2: Cài Kibana (giao diện quản trị, tuỳ chọn)

```bash
docker run -d --name kibana --net elastic -p 5601:5601 \
  -e "ELASTICSEARCH_HOSTS=http://es01:9200" \
  docker.elastic.co/kibana/kibana:8.14.0
```

**Đưa vào báo cáo:** lý do dùng Kibana (Dev Tools để chạy Query DSL trực quan thay vì `curl`)

**Chụp màn hình:** giao diện Kibana lúc mở `http://localhost:5601`, màn hình Dev Tools

### Lab 3: Thực hành CRUD cơ bản

```bash
# Tạo index
curl -X PUT "localhost:9200/products"

# Create
curl -X POST "localhost:9200/products/_doc/1" -H "Content-Type: application/json" -d '
{ "name": "iPhone 16", "category": "smartphone", "price": 999, "in_stock": true }'

# Read
curl -X GET "localhost:9200/products/_doc/1"

# Update (chỉ sửa 1 field)
curl -X POST "localhost:9200/products/_update/1" -H "Content-Type: application/json" -d '
{ "doc": { "price": 899 } }'

# Delete
curl -X DELETE "localhost:9200/products/_doc/1"

# Bulk API — thao tác hàng loạt, hiệu năng cao hơn nhiều so với gọi lẻ
curl -X POST "localhost:9200/_bulk" -H "Content-Type: application/json" -d '
{ "index": { "_index": "products", "_id": "2" } }
{ "name": "MacBook Pro", "category": "laptop", "price": 1999 }
{ "index": { "_index": "products", "_id": "3" } }
{ "name": "AirPods Pro", "category": "audio", "price": 249 }
'
```

**Đưa vào báo cáo:** từng lệnh + kết quả trả về, giải thích ý nghĩa (VD `_version` tăng sau update, `result: deleted` sau xóa)

**Chụp màn hình:** kết quả Create/Read/Update/Delete/Bulk lần lượt

### Lab 4: Mapping và kiểu dữ liệu

```bash
curl -X PUT "localhost:9200/products" -H "Content-Type: application/json" -d '
{
  "mappings": {
    "properties": {
      "name":       { "type": "text", "analyzer": "standard" },
      "category":   { "type": "keyword" },
      "price":      { "type": "float" },
      "in_stock":   { "type": "boolean" },
      "created_at": { "type": "date" }
    }
  }
}'

curl -X GET "localhost:9200/products/_mapping?pretty"
```

**Đưa vào báo cáo:** giải thích vì sao `name` dùng `text` còn `category` dùng `keyword` (liên hệ mục 4.2)

**Chụp màn hình:** kết quả `_mapping?pretty`

### Lab 5: Query DSL

```bash
# Match query — full-text search
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{ "query": { "match": { "name": "iphone" } } }'

# Term query — khớp chính xác, dùng cho field keyword
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{ "query": { "term": { "category": "smartphone" } } }'

# Bool query — kết hợp nhiều điều kiện
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{
  "query": {
    "bool": {
      "must":     [ { "match": { "name": "pro" } } ],
      "filter":   [ { "range": { "price": { "gte": 200, "lte": 1500 } } } ],
      "must_not": [ { "term": { "category": "audio" } } ]
    }
  }
}'
```

- `must`: bắt buộc khớp, có ảnh hưởng đến `_score`
- `filter`: bắt buộc khớp, không ảnh hưởng điểm, được cache → nhanh hơn `must`
- `should`: khớp thì cộng điểm (tuỳ chọn)
- `must_not`: loại trừ kết quả khớp

**Đưa vào báo cáo:** so sánh kết quả `_score` giữa các query, giải thích vì sao `filter` nên dùng khi không cần tính điểm

**Chụp màn hình:** kết quả 3 loại query trên, chú ý phần `_score` trong response

### Lab 6: Aggregations

```bash
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": { "avg_price": { "avg": { "field": "price" } } }
    }
  }
}'
```

**Đưa vào báo cáo:** so sánh aggregation với `GROUP BY` trong SQL, giải thích `doc_count` và `avg_price.value` trong response

**Chụp màn hình:** kết quả trả về của truy vấn aggregation

### Lab 7: Kiểm chứng Sharding, Replication và Failover

```bash
# Tạo index với 3 primary shard, 1 replica mỗi shard
curl -X PUT "localhost:9200/logs-demo" -H "Content-Type: application/json" -d '
{ "settings": { "number_of_shards": 3, "number_of_replicas": 1 } }'

# Xem shard được phân bổ trên node nào
curl -X GET "localhost:9200/_cat/shards/logs-demo?v"

# Mô phỏng mất 1 node
docker stop es02
curl -X GET "localhost:9200/_cluster/health?pretty"   # kỳ vọng: status yellow

# Dữ liệu vẫn truy vấn được dù thiếu 1 node
curl -X GET "localhost:9200/logs-demo/_search"

# Khởi động lại node, cluster tự cân bằng lại
docker start es02
curl -X GET "localhost:9200/_cluster/health?pretty"   # kỳ vọng: quay lại green
```

**Đưa vào báo cáo:** giải thích vì sao status chuyển `yellow` chứ không phải `red`, cơ chế promote replica lên primary (liên hệ mục 7.3)

**Chụp màn hình:**
- Kết quả `_cat/shards` trước khi tắt node (thấy shard nằm trên cả es01 và es02)
- Kết quả `_cluster/health` ngay sau khi `docker stop es02` (status `yellow`)
- Kết quả search vẫn trả về dữ liệu đầy đủ trong lúc thiếu node
- Kết quả `_cluster/health` sau khi `docker start es02` (status trở lại `green`)

---

## 9. Dự án demo: Hệ thống Log Search HA (Kafka + Elasticsearch + Nginx + HAProxy + Keepalived + Supervisord)

### 9.1. Mục tiêu

Xây dựng một hệ thống nhỏ nhưng đủ để **quan sát trực tiếp** các cơ chế đã học ở phần lý thuyết (sharding/replica failover của ES, load balancing, health check, VIP failover, process supervision) thay vì chỉ đọc lý thuyết suông. Bài toán: một hệ thống **tìm kiếm log ứng dụng theo thời gian thực**, log được sinh liên tục, đẩy qua Kafka, một service index vào Elasticsearch, và người dùng tìm kiếm log qua một trang web nhỏ được đặt sau một cụm Load Balancer có khả năng chịu lỗi (HA).

### 9.2. Kiến trúc tổng thể

```
                                   ┌────────────────────────┐
                                   │   Virtual IP (VIP)      │
                                   │   172.28.0.100:80       │
                                   └───────────┬─────────────┘
                                    Keepalived (VRRP) chọn 1 node giữ VIP
                        ┌──────────────────────┴──────────────────────┐
                        │                                             │
                ┌───────▼────────┐                           ┌────────▼───────┐
                │  lb1            │◄──── VRRP heartbeat ─────►│  lb2           │
                │  HAProxy +      │      (advert mỗi 1s)      │  HAProxy +     │
                │  Keepalived     │                           │  Keepalived    │
                │  (MASTER)       │                           │  (BACKUP)      │
                └───────┬─────────┘                           └────────┬───────┘
                        │           HAProxy load balance (health check) │
                ┌───────┴──────────────────────┬────────────────────────┘
                │                              │
         ┌──────▼──────┐               ┌───────▼─────┐
         │  nginx1      │               │  nginx2      │   (reverse proxy)
         └──────┬───────┘               └───────┬──────┘
                │                                │
         ┌──────▼──────┐               ┌────────▼─────┐
         │  web1 (Flask)│               │  web2 (Flask) │  (Search UI, query ES)
         └──────┬───────┘               └────────┬──────┘
                └────────────────┬────────────────┘
                                 │
                     ┌───────────▼────────────┐
                     │  Elasticsearch cluster   │
                     │   es01  <──replica──> es02│
                     └───────────▲────────────┘
                                 │ index document
                     ┌───────────┴────────────┐
                     │  worker (Supervisord)   │
                     │  ├─ producer.py ────────┼──► Kafka topic "app-logs"
                     │  └─ consumer.py ◄───────┘  (đọc Kafka, index vào ES)
                     └────────────────────────┘
                                 ▲
                          ┌──────┴──────┐
                          │    Kafka     │
                          └─────────────┘
```

### 9.3. Vai trò từng công nghệ trong hệ thống

| Công nghệ | Vai trò trong demo | Cơ chế được minh họa |
|---|---|---|
| **Kafka** | Hàng đợi trung gian nhận log từ producer | Decouple producer/consumer, buffer khi consumer chậm/down |
| **Elasticsearch** | Lưu trữ và tìm kiếm log | Sharding, replica, failover, near real-time search |
| **Supervisord** | Quản lý 2 tiến trình `producer.py` và `consumer.py` trong 1 container | Tự động restart tiến trình con khi crash |
| **Flask webapp** | Giao diện tìm kiếm log, gọi Query DSL tới ES | Ứng dụng thực tế dùng ES làm search backend |
| **Nginx** | Reverse proxy đứng trước mỗi instance webapp | Tách lớp mạng, thêm header nhận diện node |
| **HAProxy** | Load balancer Layer 7, phân phối tải giữa nginx1/nginx2 | Round-robin, health check tự loại backend lỗi |
| **Keepalived** | Chạy cùng HAProxy trên 2 node, giữ 1 Virtual IP dùng chung | VRRP failover — HAProxy chết thì VIP tự chuyển node |
| **Docker / Docker Compose** | Đóng gói và điều phối toàn bộ service trên | Triển khai nhất quán, cô lập môi trường |

### 9.4. Cấu trúc thư mục project

```
es-log-demo/
├── docker-compose.yml
├── worker/
│   ├── Dockerfile
│   ├── producer.py
│   ├── consumer.py
│   └── supervisord.conf
├── webapp/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py
├── nginx/
│   ├── nginx1.conf
│   └── nginx2.conf
└── lb/
    ├── Dockerfile
    ├── haproxy.cfg
    ├── keepalived.conf.template
    └── entrypoint.sh
```

### 9.5. Worker: Producer + Consumer chạy dưới Supervisord

**`worker/producer.py`** — sinh log giả lập, đẩy vào Kafka:

```python
import json, random, time
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers="kafka:9092",
    value_serializer=lambda v: json.dumps(v).encode("utf-8"),
)

SERVICES = ["auth-service", "payment-service", "order-service", "search-service"]
LEVELS = ["INFO", "WARN", "ERROR"]
MESSAGES = {
    "INFO":  ["request handled successfully", "user logged in", "cache hit"],
    "WARN":  ["response time exceeded 500ms", "retrying downstream call"],
    "ERROR": ["connection timeout to database", "null pointer exception", "payment declined"],
}

while True:
    level = random.choices(LEVELS, weights=[70, 20, 10])[0]
    event = {
        "service": random.choice(SERVICES),
        "level": level,
        "message": random.choice(MESSAGES[level]),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    producer.send("app-logs", event)
    print("sent:", event, flush=True)
    time.sleep(1)
```

**`worker/consumer.py`** — đọc Kafka, index vào Elasticsearch:

```python
import json
from kafka import KafkaConsumer
from elasticsearch import Elasticsearch

consumer = KafkaConsumer(
    "app-logs",
    bootstrap_servers="kafka:9092",
    value_deserializer=lambda v: json.loads(v.decode("utf-8")),
    auto_offset_reset="earliest",
    group_id="es-indexer",
)
es = Elasticsearch(["http://es01:9200", "http://es02:9200"])

for msg in consumer:
    doc = msg.value
    es.index(index="app-logs", document=doc)
    print("indexed:", doc, flush=True)
```

**`worker/supervisord.conf`** — giám sát cả 2 tiến trình, tự khởi động lại khi crash:

```ini
[supervisord]
nodaemon=true
logfile=/var/log/supervisord.log

[program:producer]
command=python /app/producer.py
autostart=true
autorestart=true
stdout_logfile=/var/log/producer.log
stderr_logfile=/var/log/producer.err.log

[program:consumer]
command=python /app/consumer.py
autostart=true
autorestart=true
stdout_logfile=/var/log/consumer.log
stderr_logfile=/var/log/consumer.err.log
```

**`worker/Dockerfile`:**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir supervisor kafka-python "elasticsearch==8.14.0"
COPY producer.py consumer.py supervisord.conf .
CMD ["supervisord", "-c", "/app/supervisord.conf"]
```

### 9.6. Web Search App (Flask)

**`webapp/app.py`:**

```python
import os
from flask import Flask, request, render_template_string
from elasticsearch import Elasticsearch

app = Flask(__name__)
ES_HOSTS = os.environ.get("ES_HOSTS", "http://es01:9200,http://es02:9200").split(",")
WEB_NODE = os.environ.get("WEB_NODE", "web?")
es = Elasticsearch(ES_HOSTS)

TEMPLATE = """
<!doctype html>
<html><head><title>Log Search Demo</title></head>
<body style="font-family: sans-serif; max-width: 700px; margin: 40px auto;">
  <h2>Log Search Demo</h2>
  <p style="color:gray">Served by: <b>{{ web_node }}</b></p>
  <form method="GET">
    <input name="q" placeholder="Tìm trong message (VD: error)" value="{{ q }}" style="width:70%">
    <button type="submit">Tìm</button>
  </form>
  <p>Tổng số log trong index: <b>{{ total_docs }}</b></p>
  <ul>
  {% for hit in hits %}
    <li><b>[{{ hit.level }}]</b> {{ hit.service }} — {{ hit.timestamp }}<br>{{ hit.message }}</li>
  {% endfor %}
  </ul>
</body></html>
"""

@app.route("/")
def index():
    q = request.args.get("q", "")
    if q:
        result = es.search(index="app-logs", query={"match": {"message": q}}, size=20)
    else:
        result = es.search(index="app-logs", query={"match_all": {}}, size=20,
                            sort=[{"timestamp": "desc"}])
    hits = [h["_source"] for h in result["hits"]["hits"]]
    total = es.count(index="app-logs")["count"]
    return render_template_string(TEMPLATE, q=q, hits=hits, total_docs=total, web_node=WEB_NODE)

@app.route("/health")
def health():
    return "OK"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
```

**`webapp/requirements.txt`:**

```
flask
elasticsearch==8.14.0
```

**`webapp/Dockerfile`:**

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 5000
CMD ["python", "app.py"]
```

### 9.7. Nginx reverse proxy

**`nginx/nginx1.conf`** (nginx2.conf tương tự, đổi `web1` → `web2` và header thành `nginx2`):

```nginx
server {
    listen 80;
    add_header X-Nginx-Node "nginx1" always;

    location / {
        proxy_pass http://web1:5000;
        proxy_set_header Host $host;
    }
}
```

### 9.8. HAProxy + Keepalived (HA Load Balancer)

**`lb/haproxy.cfg`** (dùng chung cho cả lb1 và lb2):

```
global
    maxconn 2000

defaults
    mode http
    timeout connect 5s
    timeout client  30s
    timeout server  30s

frontend http_front
    bind *:80
    default_backend nginx_nodes

backend nginx_nodes
    balance roundrobin
    option httpchk GET /health
    http-check expect status 200
    server nginx1 nginx1:80 check
    server nginx2 nginx2:80 check

listen stats
    bind *:8404
    stats enable
    stats uri /
    stats refresh 5s
```

**`lb/keepalived.conf.template`** — sinh cấu hình khác nhau cho MASTER/BACKUP qua biến môi trường:

```
vrrp_script chk_haproxy {
    script "pidof haproxy"
    interval 2
    weight 2
}

vrrp_instance VI_1 {
    state ${KEEPALIVED_STATE}
    interface eth0
    virtual_router_id 51
    priority ${KEEPALIVED_PRIORITY}
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass demopass
    }
    virtual_ipaddress {
        172.28.0.100
    }
    track_script {
        chk_haproxy
    }
}
```

**`lb/entrypoint.sh`:**

```bash
#!/bin/bash
set -e
envsubst < /etc/keepalived/keepalived.conf.template > /etc/keepalived/keepalived.conf
haproxy -f /usr/local/etc/haproxy/haproxy.cfg -D
exec keepalived -n --log-console
```

**`lb/Dockerfile`:**

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y haproxy keepalived gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY haproxy.cfg /usr/local/etc/haproxy/haproxy.cfg
COPY keepalived.conf.template /etc/keepalived/keepalived.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### 9.9. `docker-compose.yml` tổng hợp toàn hệ thống

```yaml
networks:
  demo_net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/24

services:
  kafka:
    image: bitnami/kafka:3.7
    environment:
      - KAFKA_CFG_NODE_ID=1
      - KAFKA_CFG_PROCESS_ROLES=broker,controller
      - KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093
      - KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092
      - KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER
      - KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@kafka:9093
      - KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      - ALLOW_PLAINTEXT_LISTENER=yes
    networks:
      demo_net:
        ipv4_address: 172.28.0.10

  es01:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.14.0
    environment:
      - node.name=es01
      - cluster.name=demo-cluster
      - discovery.seed_hosts=es02
      - cluster.initial_master_nodes=es01,es02
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports: ["9200:9200"]
    networks:
      demo_net:
        ipv4_address: 172.28.0.21

  es02:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.14.0
    environment:
      - node.name=es02
      - cluster.name=demo-cluster
      - discovery.seed_hosts=es01
      - cluster.initial_master_nodes=es01,es02
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports: ["9201:9200"]
    networks:
      demo_net:
        ipv4_address: 172.28.0.22

  worker:
    build: ./worker
    depends_on: [kafka, es01, es02]
    networks:
      demo_net:
        ipv4_address: 172.28.0.30

  web1:
    build: ./webapp
    environment:
      - WEB_NODE=web1
      - ES_HOSTS=http://es01:9200,http://es02:9200
    networks:
      demo_net:
        ipv4_address: 172.28.0.41

  web2:
    build: ./webapp
    environment:
      - WEB_NODE=web2
      - ES_HOSTS=http://es01:9200,http://es02:9200
    networks:
      demo_net:
        ipv4_address: 172.28.0.42

  nginx1:
    image: nginx:alpine
    volumes:
      - ./nginx/nginx1.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      demo_net:
        ipv4_address: 172.28.0.51

  nginx2:
    image: nginx:alpine
    volumes:
      - ./nginx/nginx2.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      demo_net:
        ipv4_address: 172.28.0.52

  lb1:
    build: ./lb
    cap_add: [NET_ADMIN, NET_BROADCAST, NET_RAW]
    sysctls:
      - net.ipv4.ip_nonlocal_bind=1
    environment:
      - KEEPALIVED_STATE=MASTER
      - KEEPALIVED_PRIORITY=150
    ports:
      - "8080:80"
      - "8404:8404"
    networks:
      demo_net:
        ipv4_address: 172.28.0.61

  lb2:
    build: ./lb
    cap_add: [NET_ADMIN, NET_BROADCAST, NET_RAW]
    sysctls:
      - net.ipv4.ip_nonlocal_bind=1
    environment:
      - KEEPALIVED_STATE=BACKUP
      - KEEPALIVED_PRIORITY=100
    ports:
      - "8081:80"
      - "8405:8404"
    networks:
      demo_net:
        ipv4_address: 172.28.0.62
```

```bash
cd es-log-demo
docker compose up --build -d
docker compose ps
```

---

### 9.10. Chạy demo và các kịch bản kiểm chứng cơ chế

#### Kịch bản 1: Luồng dữ liệu end-to-end (Kafka → Elasticsearch → Web)

```bash
docker compose logs -f worker
```

Mở trình duyệt (Linux/macOS truy cập trực tiếp VIP; trên Windows dùng cổng publish của lb1, xem lưu ý ở mục 10):

```
http://localhost:8080/?q=error
```

**Đưa vào báo cáo:** giải thích luồng: `producer.py` sinh log → Kafka topic `app-logs` → `consumer.py` đọc và index vào ES → web app query ES và hiển thị

**Chụp màn hình:** log `worker` (dòng `sent:` và `indexed:`), giao diện web hiển thị log tìm được kèm dòng "Served by: web1/web2"

#### Kịch bản 2: Elasticsearch mất 1 node (Replica tự promote)

```bash
docker exec es01 curl -s "localhost:9200/_cluster/health?pretty"

docker compose stop es02
docker exec es01 curl -s "localhost:9200/_cluster/health?pretty"   # kỳ vọng: yellow

curl "http://localhost:8080/?q=error"   # dữ liệu vẫn tìm được bình thường

docker compose start es02
docker exec es01 curl -s "localhost:9200/_cluster/health?pretty"   # trở lại green
```

**Đưa vào báo cáo:** liên hệ cơ chế promote replica → primary (mục 7.3), giải thích vì sao web app vẫn hoạt động dù thiếu 1 node ES

**Chụp màn hình:** kết quả `_cluster/health` ở 3 thời điểm (trước, trong lúc mất es02, sau khi khôi phục)

#### Kịch bản 3: Web app/Nginx lỗi (HAProxy tự loại backend)

```bash
docker compose stop web1
```

Mở trang stats HAProxy: `http://localhost:8404/` → dòng `nginx1` chuyển đỏ (DOWN)

```bash
curl "http://localhost:8080/?q=error"   # vẫn có kết quả, do HAProxy chuyển hết sang nginx2/web2

docker compose start web1
```

**Đưa vào báo cáo:** giải thích cơ chế `option httpchk` của HAProxy, vì sao backend lỗi tự bị loại khỏi vòng round-robin mà không cần can thiệp thủ công

**Chụp màn hình:** trang HAProxy stats trước/sau khi `stop web1` (thấy trạng thái UP/DOWN đổi màu)

#### Kịch bản 4: HAProxy chết — Keepalived chuyển VIP (VRRP failover)

```bash
# Xác định node đang giữ VIP
docker exec lb1 ip addr show eth0 | grep 172.28.0.100
docker exec lb2 ip addr show eth0 | grep 172.28.0.100

# Dừng node đang là MASTER (giả sử là lb1)
docker compose stop lb1

# Kiểm tra lại — VIP phải chuyển sang lb2
docker exec lb2 ip addr show eth0 | grep 172.28.0.100

# Kiểm tra dịch vụ không gián đoạn bằng cách gọi VIP từ 1 container khác trong cùng network
docker exec worker curl -s http://172.28.0.100/health

# Khởi động lại lb1 — do priority cao hơn (150 > 100), lb1 giành lại vai trò MASTER (preemption)
docker compose start lb1
docker exec lb1 ip addr show eth0 | grep 172.28.0.100
```

**Đưa vào báo cáo:** giải thích cơ chế VRRP (advertisement mỗi 1s, priority quyết định ai giữ VIP, `vrrp_script` kiểm tra HAProxy còn sống hay không thông qua `pidof haproxy`)

**Chụp màn hình:** kết quả `ip addr` trên lb1/lb2 trước và sau khi `stop lb1`, log keepalived ghi nhận chuyển trạng thái (`docker compose logs lb1 lb2` — tìm dòng `Entering MASTER STATE`/`Entering BACKUP STATE`)

> **Lưu ý khi test trên Windows (Docker Desktop):** container trên mạng bridge tuỳ chỉnh không phải lúc nào cũng truy cập trực tiếp được từ trình duyệt Windows (do Docker Desktop chạy trong VM). Cách kiểm chứng đáng tin cậy nhất là `docker exec` vào một container bất kỳ trong cùng `demo_net` (VD `worker`) rồi `curl` tới VIP như lệnh trên, thay vì mở VIP trực tiếp từ trình duyệt Windows.

#### Kịch bản 5: Supervisord tự phục hồi tiến trình bị crash

```bash
docker exec -it <container_worker> supervisorctl status

# Giả lập consumer bị crash
docker exec -it <container_worker> pkill -f consumer.py

# Theo dõi Supervisord tự khởi động lại
docker exec -it <container_worker> supervisorctl status
docker compose logs worker | grep consumer
```

**Đưa vào báo cáo:** giải thích `autorestart=true` trong `supervisord.conf` khiến tiến trình con tự được khởi động lại ngay khi thoát bất thường, không cần can thiệp thủ công — điểm khác biệt so với chạy trực tiếp một script Python đơn thuần (crash là dừng hẳn)

**Chụp màn hình:** kết quả `supervisorctl status` trước và sau khi kill (cột `uptime` reset về gần 0 sau restart), đoạn log ghi nhận sự kiện `exited` rồi `started` của tiến trình `consumer`

---

## 10. Lưu ý và xử lý sự cố thực tế

### 10.1. Bảo mật

- Demo trong báo cáo này tắt `xpack.security.enabled` để đơn giản hoá — **không dùng cấu hình này cho production**. Production cần bật security, TLS giữa các node, và xác thực (API key/user-role)
- Không expose cổng 9200 ra internet công khai; giới hạn qua firewall/VPC nội bộ

### 10.2. Split-brain và Discovery

- Cấu hình sai `discovery.seed_hosts`/`cluster.initial_master_nodes` là nguyên nhân phổ biến khiến node không join được cluster hoặc tạo ra 2 cluster riêng biệt (split-brain) — luôn kiểm tra `_cluster/health` sau khi thêm node mới
- Cluster production nên có số node master-eligible là số lẻ (3, 5...) để đảm bảo quorum rõ ràng

### 10.3. Bộ nhớ và hiệu năng

- JVM heap không nên vượt quá 50% RAM của node và không nên vượt ngưỡng ~32GB (mất tối ưu compressed OOPs của JVM) — theo dõi qua `_nodes/stats/jvm`
- Tránh **oversharding**: quá nhiều shard nhỏ làm tăng overhead quản lý cluster state; kích thước shard lý tưởng thường trong khoảng 10–50GB
- Dùng Bulk API khi ghi số lượng lớn document, tránh gọi index từng document một
- Dùng `filter` thay vì `must` khi không cần tính điểm relevance để tận dụng cache của Elasticsearch

### 10.4. Kafka & pipeline dữ liệu

- Theo dõi **consumer lag** (khoảng cách offset giữa producer và consumer) — lag tăng liên tục nghĩa là consumer (ở đây là `consumer.py` index vào ES) xử lý không kịp tốc độ producer sinh dữ liệu
- Nếu Elasticsearch tạm thời không nhận request (quá tải, đang failover), consumer cần có cơ chế retry/backoff thay vì để lỗi làm crash tiến trình liên tục

### 10.5. HAProxy / Keepalived

- Hai node Keepalived phải cùng `virtual_router_id` và cùng mật khẩu `auth_pass` mới nhận diện được nhau; khác `virtual_router_id` sẽ khiến chúng không "thấy" nhau, cả hai cùng nhận là MASTER (split-brain LB, gây trùng IP tạm thời)
- `priority` khác nhau giữa 2 node để tránh việc cả hai cùng khởi động lại lúc là MASTER, nếu bằng nhau việc chọn ai giữ VIP sẽ phụ thuộc vào địa chỉ IP thấp hơn (không kiểm soát được)
- Cần đảm bảo `vrrp_script` thực sự phản ánh tình trạng HAProxy (không chỉ check tiến trình còn sống mà lý tưởng nên check luôn cổng lắng nghe/health endpoint) để tránh trường hợp HAProxy "còn sống" nhưng không phục vụ được request

### 10.6. Supervisord

- Log của các tiến trình con nên được giới hạn kích thước (`stdout_logfile_maxbytes`) để tránh file log phình to vô hạn trong container chạy dài ngày
- `autorestart=true` giúp tự phục hồi khi crash ngẫu nhiên, nhưng nếu tiến trình crash liên tục do lỗi cấu hình (không phải sự cố tạm thời), Supervisord sẽ restart lặp vô hạn — cần theo dõi `supervisorctl status` để phát hiện tiến trình restart quá thường xuyên (`FATAL` state khi vượt `startretries`)

---

## 11. Kết luận

Elasticsearch là công cụ mạnh cho bài toán tìm kiếm full-text và phân tích dữ liệu quy mô lớn nhờ cơ chế inverted index, phân tán qua sharding, và khả năng chịu lỗi qua replication. Tuy nhiên giá trị thực sự của nó chỉ bộc lộ khi được đặt trong một hệ thống hoàn chỉnh: dữ liệu cần được đưa vào một cách đáng tin cậy (Kafka làm lớp đệm), dịch vụ tìm kiếm cần luôn sẵn sàng trước người dùng (Nginx + HAProxy + Keepalived tạo thành lớp HA-LB), và các tiến trình nền phải tự phục hồi khi có sự cố (Supervisord). Dự án demo ở mục 9 minh hoạ rằng các cơ chế lý thuyết — promote replica, health check loại bỏ backend lỗi, VRRP chuyển VIP, tự khởi động lại tiến trình — không phải khái niệm trừu tượng mà có thể quan sát trực tiếp bằng vài lệnh `docker stop`/`kill` đơn giản, giúp hiểu rõ hơn cách các thành phần hạ tầng thực tế phối hợp để đạt được tính sẵn sàng cao.

---

*Tài liệu được biên soạn phục vụ mục đích học tập và tham khảo kỹ thuật.*
