# Elasticsearch — Lý thuyết & Thực hành

## Mục lục
1. [Elasticsearch là gì?](#1-elasticsearch-là-gì)
2. [Các khái niệm cốt lõi](#2-các-khái-niệm-cốt-lõi)
3. [Kiến trúc & cơ chế hoạt động](#3-kiến-trúc--cơ-chế-hoạt-động)
4. [Inverted Index — cơ chế tìm kiếm](#4-inverted-index--cơ-chế-tìm-kiếm)
5. [Analyzer & quá trình phân tích văn bản](#5-analyzer--quá-trình-phân-tích-văn-bản)
6. [Chấm điểm liên quan (Relevance Scoring — BM25)](#6-chấm-điểm-liên-quan-relevance-scoring--bm25)
7. [Cài đặt & khởi động nhanh](#7-cài-đặt--khởi-động-nhanh)
8. [Thực hành: CRUD cơ bản](#8-thực-hành-crud-cơ-bản)
9. [Thực hành: Mapping & kiểu dữ liệu](#9-thực-hành-mapping--kiểu-dữ-liệu)
10. [Thực hành: Query DSL](#10-thực-hành-query-dsl)
11. [Thực hành: Aggregations](#11-thực-hành-aggregations)
12. [Sharding, Replication & tính sẵn sàng cao](#12-sharding-replication--tính-sẵn-sàng-cao)
13. [Hiệu năng & best practices](#13-hiệu-năng--best-practices)
14. [Ứng dụng ELK Stack](#14-ứng-dụng-elk-stack)
15. [Tài liệu tham khảo](#15-tài-liệu-tham-khảo)

---

## 1. Elasticsearch là gì?

Elasticsearch (ES) là một **search engine & analytics engine** phân tán, mã nguồn mở, được xây dựng trên nền **Apache Lucene**. Nó cho phép:

- Lưu trữ, tìm kiếm và phân tích lượng lớn dữ liệu (structured, unstructured) gần như **real-time**.
- Mở rộng theo chiều ngang (horizontal scaling) qua nhiều node/cluster.
- Truy vấn bằng REST API với JSON (Query DSL).

**Các trường hợp sử dụng phổ biến:**
- Tìm kiếm full-text (e-commerce, tài liệu, log)
- Log & metrics analytics (ELK/Elastic Stack)
- Application performance monitoring (APM)
- Security analytics (SIEM)
- Vector search / semantic search (kNN, embeddings) — các phiên bản mới

---

## 2. Các khái niệm cốt lõi

| Khái niệm | Mô tả | So sánh với RDBMS |
|---|---|---|
| **Cluster** | Tập hợp một hay nhiều node hoạt động cùng nhau | Toàn bộ hệ thống DB |
| **Node** | Một instance của Elasticsearch đang chạy | Một server DB |
| **Index** | Tập hợp các document có cùng đặc điểm | Database / Table |
| **Document** | Đơn vị dữ liệu cơ bản, dạng JSON | Row |
| **Field** | Thuộc tính của document | Column |
| **Mapping** | Định nghĩa schema (kiểu dữ liệu) cho index | Table schema |
| **Shard** | Một phần của index, là 1 Lucene index thực sự | Partition |
| **Replica** | Bản sao của shard, phục vụ HA & tăng throughput đọc | Standby / Read replica |

---

## 3. Kiến trúc & cơ chế hoạt động

```
                ┌─────────────────────────────┐
                │           Cluster           │
                │  ┌────────┐   ┌────────┐    │
                │  │ Node 1 │   │ Node 2 │ .. │
                │  │(Master)│   │ (Data) │    │
                │  └────────┘   └────────┘    │
                └─────────────────────────────┘
                        │
        Mỗi Index được chia thành nhiều Primary Shard
        Mỗi Primary Shard có thể có 0..n Replica Shard
```

**Vai trò node:**
- **Master node**: quản lý trạng thái cluster (tạo/xóa index, phân bổ shard...).
- **Data node**: lưu trữ dữ liệu, thực hiện CRUD, search, aggregation.
- **Ingest node**: tiền xử lý document trước khi index (pipeline).
- **Coordinating node**: nhận request, định tuyến đến các shard liên quan, tổng hợp kết quả trả về client.

**Cơ chế ghi dữ liệu (Write path):**
1. Client gửi request index document → **Coordinating node**.
2. Coordinating node dùng công thức routing (mặc định: `hash(_id) % số_primary_shard`) để xác định shard đích.
3. Request được chuyển đến **Primary shard** tương ứng.
4. Primary shard ghi vào **translog** (write-ahead log) và bộ nhớ đệm **in-memory buffer**.
5. Dữ liệu được sao chép (replicate) sang các **Replica shard**.
6. Định kỳ (mặc định 1 giây — `refresh_interval`), buffer được "refresh" thành **segment** mới trong Lucene → dữ liệu trở nên **searchable** (đây là lý do ES gọi là "near real-time" chứ không phải real-time tuyệt đối).
7. Định kỳ, các segment nhỏ được **merge** lại thành segment lớn hơn để tối ưu hiệu năng.
8. Translog được **flush** xuống đĩa (Lucene commit) để đảm bảo durability.

**Cơ chế đọc dữ liệu (Read path):**
1. Coordinating node nhận query, gửi đến **tất cả shard liên quan** (cả primary lẫn replica, chọn 1 bản sao khả dụng — round-robin).
2. Mỗi shard thực hiện query cục bộ, trả về top-N kết quả kèm điểm relevance.
3. Coordinating node gộp (merge & sort) kết quả từ mọi shard, cắt lấy top-K cuối cùng trả về client.

---

## 4. Inverted Index — cơ chế tìm kiếm

Đây là "trái tim" giúp ES tìm kiếm cực nhanh. Thay vì quét từng document (linear scan) như RDBMS truyền thống, Lucene xây dựng **inverted index**: ánh xạ từ **term (từ khóa)** → **danh sách document chứa từ đó**.

Ví dụ có 2 document:
```
Doc1: "quick brown fox"
Doc2: "quick blue fish"
```

Inverted index được tạo ra:
```
Term      | Documents
----------|----------
quick     | Doc1, Doc2
brown     | Doc1
fox       | Doc1
blue      | Doc2
fish      | Doc2
```

Khi tìm "quick fish" → ES chỉ cần tra bảng, không cần quét toàn bộ dữ liệu → tốc độ O(1)-ish thay vì O(n).

---

## 5. Analyzer & quá trình phân tích văn bản

Trước khi đưa vào inverted index, text phải qua **Analyzer**, gồm 3 bước:

1. **Character filters**: tiền xử lý raw text (VD: bỏ HTML tag).
2. **Tokenizer**: tách text thành các token (VD: tách theo khoảng trắng, dấu câu).
3. **Token filters**: xử lý token (lowercase, bỏ stopword, stemming — đưa từ về gốc: "running" → "run").

```
"The Quick Brown Foxes!" 
   → Character filter → "The Quick Brown Foxes!"
   → Tokenizer         → [The, Quick, Brown, Foxes]
   → Lowercase filter  → [the, quick, brown, foxes]
   → Stop word filter  → [quick, brown, foxes]
   → Stemmer filter    → [quick, brown, fox]
```

Analyzer phổ biến: `standard` (mặc định), `simple`, `whitespace`, `keyword` (không tách), hoặc custom analyzer riêng cho từng ngôn ngữ (VD tiếng Việt cần tokenizer riêng như ICU hoặc plugin `vi`).

---

## 6. Chấm điểm liên quan (Relevance Scoring — BM25)

Từ phiên bản 5.0+, ES dùng thuật toán **BM25** (cải tiến của TF-IDF) để tính điểm relevance:

- **TF (Term Frequency)**: từ khóa xuất hiện càng nhiều trong document → điểm càng cao (nhưng có giới hạn bão hòa, tránh spam).
- **IDF (Inverse Document Frequency)**: từ khóa càng hiếm trong toàn bộ index → càng có giá trị phân biệt → điểm cao hơn.
- **Field length norm**: document ngắn mà chứa từ khóa thường được đánh giá "liên quan" hơn document dài.

Công thức tổng quát (đơn giản hóa):
```
score(D,Q) = Σ IDF(qi) · (f(qi,D) · (k1+1)) / (f(qi,D) + k1·(1-b+b·|D|/avgdl))
```
Không cần nhớ công thức, chỉ cần hiểu: **từ hiếm + xuất hiện nhiều + document ngắn gọn = điểm cao**.

---

## 7. Cài đặt & khởi động nhanh

**Docker (khuyến nghị để thực hành):**
```bash
docker network create elastic

docker run -d --name es01 --net elastic -p 9200:9200 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms1g -Xmx1g" \
  docker.elastic.co/elasticsearch/elasticsearch:8.14.0

# Kiểm tra
curl http://localhost:9200
```

Cài thêm **Kibana** để có giao diện quản trị:
```bash
docker run -d --name kibana --net elastic -p 5601:5601 \
  -e "ELASTICSEARCH_HOSTS=http://es01:9200" \
  docker.elastic.co/kibana/kibana:8.14.0
```

---

## 8. Thực hành: CRUD cơ bản

**Tạo index:**
```bash
curl -X PUT "localhost:9200/products" -H "Content-Type: application/json"
```

**Thêm document (Create):**
```bash
curl -X POST "localhost:9200/products/_doc/1" -H "Content-Type: application/json" -d '
{
  "name": "iPhone 16",
  "category": "smartphone",
  "price": 999,
  "in_stock": true
}'
```

**Đọc document (Read):**
```bash
curl -X GET "localhost:9200/products/_doc/1"
```

**Cập nhật (Update) — chỉ sửa 1 field:**
```bash
curl -X POST "localhost:9200/products/_update/1" -H "Content-Type: application/json" -d '
{
  "doc": { "price": 899 }
}'
```

**Xóa (Delete):**
```bash
curl -X DELETE "localhost:9200/products/_doc/1"
```

**Bulk API (thao tác hàng loạt — hiệu năng cao hơn nhiều so với gọi lẻ):**
```bash
curl -X POST "localhost:9200/_bulk" -H "Content-Type: application/json" -d '
{ "index": { "_index": "products", "_id": "2" } }
{ "name": "MacBook Pro", "category": "laptop", "price": 1999 }
{ "index": { "_index": "products", "_id": "3" } }
{ "name": "AirPods Pro", "category": "audio", "price": 249 }
'
```

---

## 9. Thực hành: Mapping & kiểu dữ liệu

Mapping giống schema, nên định nghĩa trước khi index dữ liệu lớn:

```bash
curl -X PUT "localhost:9200/products" -H "Content-Type: application/json" -d '
{
  "mappings": {
    "properties": {
      "name":     { "type": "text", "analyzer": "standard" },
      "category": { "type": "keyword" },
      "price":    { "type": "float" },
      "in_stock": { "type": "boolean" },
      "created_at": { "type": "date" }
    }
  }
}'
```

**Lưu ý quan trọng — `text` vs `keyword`:**
- `text`: được phân tích (analyzed), dùng cho full-text search (VD tìm "phone" ra "smartphone").
- `keyword`: KHÔNG phân tích, giữ nguyên chuỗi, dùng cho lọc chính xác, sort, aggregation (VD lọc `category = "smartphone"`).

---

## 10. Thực hành: Query DSL

**Match query (full-text search):**
```bash
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{
  "query": {
    "match": { "name": "iphone" }
  }
}'
```

**Term query (khớp chính xác — dùng cho field `keyword`):**
```bash
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{
  "query": {
    "term": { "category": "smartphone" }
  }
}'
```

**Bool query (kết hợp nhiều điều kiện):**
```bash
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{
  "query": {
    "bool": {
      "must":   [ { "match": { "name": "pro" } } ],
      "filter": [ { "range": { "price": { "gte": 200, "lte": 1500 } } } ],
      "must_not": [ { "term": { "category": "audio" } } ]
    }
  }
}'
```

- `must`: bắt buộc khớp, **có** ảnh hưởng đến điểm relevance.
- `filter`: bắt buộc khớp, **không** ảnh hưởng điểm, được cache → nhanh hơn.
- `should`: khớp thì cộng điểm (tùy chọn).
- `must_not`: loại trừ.

---

## 11. Thực hành: Aggregations

Aggregation dùng để thống kê, tương tự `GROUP BY` trong SQL.

**Đếm số sản phẩm theo category + tính giá trung bình:**
```bash
curl -X GET "localhost:9200/products/_search" -H "Content-Type: application/json" -d '
{
  "size": 0,
  "aggs": {
    "by_category": {
      "terms": { "field": "category" },
      "aggs": {
        "avg_price": { "avg": { "field": "price" } }
      }
    }
  }
}'
```

Kết quả trả về dạng: mỗi category kèm số lượng document (`doc_count`) và giá trung bình (`avg_price.value`).

---

## 12. Sharding, Replication & tính sẵn sàng cao

- **Primary shard**: số lượng được set **cố định khi tạo index** (khó đổi sau này) — quyết định khả năng mở rộng ghi dữ liệu.
- **Replica shard**: có thể tăng/giảm linh hoạt sau — quyết định khả năng chịu lỗi (fault tolerance) và tăng throughput đọc.

```bash
curl -X PUT "localhost:9200/products" -H "Content-Type: application/json" -d '
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  }
}'
```

**Cơ chế chịu lỗi:** Nếu node chứa primary shard bị down, ES tự động **promote** một replica shard thành primary mới — đảm bảo dữ liệu không mất và cluster vẫn hoạt động (nếu còn đủ node).

---

## 13. Hiệu năng & best practices

1. **Không đánh index những field không cần search** → dùng `"enabled": false` hoặc `index: false` trong mapping để tiết kiệm dung lượng.
2. **Dùng `filter` thay vì `query` khi không cần tính điểm** → tận dụng cache, nhanh hơn nhiều.
3. **Bulk API** khi ghi số lượng lớn, tránh gọi API đơn lẻ từng document.
4. **Tránh quá nhiều shard nhỏ** ("oversharding") — mỗi shard tốn overhead riêng; kích thước lý tưởng thường 10–50GB/shard.
5. **Dùng `_source` filtering** để chỉ trả về field cần thiết, giảm băng thông.
6. **Index Lifecycle Management (ILM)** cho dữ liệu log/time-series: tự động chuyển từ hot → warm → cold → xóa dữ liệu cũ.
7. **Giám sát heap** — tránh để JVM heap vượt 75-80%, tránh garbage collection kéo dài (long GC pause).

---

## 14. Ứng dụng ELK Stack

```
Logstash / Beats (Filebeat, Metricbeat...)  →  Elasticsearch  →  Kibana
     (thu thập & xử lý dữ liệu)              (lưu trữ & tìm kiếm)  (trực quan hóa)
```

Đây là bộ công cụ phổ biến (**Elastic Stack**) dùng để giám sát log hệ thống, phân tích metrics, phát hiện bất thường (anomaly detection), dashboard thời gian thực.

---

## 15. Tài liệu tham khảo

- Tài liệu chính thức: https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html
- Elasticsearch: The Definitive Guide (sách chính thức của Elastic)
- Query DSL reference: https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl.html

---

*Tài liệu này mang tính tổng hợp lý thuyết + thực hành cơ bản. Để đi sâu vào production (bảo mật, cluster nhiều node thật, snapshot/backup, vector search...), nên tham khảo thêm tài liệu chính thức ở trên.*
