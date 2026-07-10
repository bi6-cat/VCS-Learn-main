# BÁO CÁO: LÝ THUYẾT VÀ THỰC HÀNH REDIS

---

## MỤC LỤC

1. [Tổng quan về Redis](#1-tổng-quan-về-redis)
2. [Kiến trúc và cơ chế hoạt động](#2-kiến-trúc-và-cơ-chế-hoạt-động)
3. [Các kiểu dữ liệu trong Redis](#3-các-kiểu-dữ-liệu-trong-redis)
4. [Cơ chế lưu trữ bền vững (Persistence)](#4-cơ-chế-lưu-trữ-bền-vững-persistence)
5. [Replication và High Availability](#5-replication-và-high-availability)
6. [Hướng dẫn Lab thực hành](#6-hướng-dẫn-lab-thực-hành)
7. [Lưu ý và xử lý sự cố thực tế](#7-lưu-ý-và-xử-lý-sự-cố-thực-tế)
8. [Kết luận](#8-kết-luận)

---

## 1. Tổng quan về Redis

### 1.1. Redis là gì

**Redis** (REmote DIctionary Server) là hệ quản trị dữ liệu key-value mã nguồn mở, do Salvatore Sanfilippo khởi tạo năm 2009. Redis thuộc nhóm NoSQL, lưu dữ liệu chủ yếu trong RAM (in-memory data store) và giao tiếp với client qua giao thức văn bản riêng gọi là **RESP** (REdis Serialization Protocol) trên mô hình client-server, thường qua TCP port mặc định 6379.

Khác với hệ quản trị dữ liệu quan hệ (MySQL, PostgreSQL) lưu dữ liệu dạng bảng và tối ưu cho truy vấn phức tạp trên đĩa, Redis lưu dữ liệu dạng cấu trúc (data structure server) — không chỉ là key-value đơn thuần mà key có thể trỏ tới các cấu trúc dữ liệu phong phú (List, Hash, Set, Sorted Set...). Vì vậy Redis thường được gọi là "data structure server" hơn là "database" theo nghĩa truyền thống.

### 1.2. So sánh nhanh với các hệ thống liên quan

| Tiêu chí | Redis | Memcached | RDBMS (MySQL/PostgreSQL) |
|---|---|---|---|
| Nơi lưu dữ liệu chính | RAM (có thể persist ra đĩa) | RAM (không persist) | Đĩa (có cache trong RAM) |
| Kiểu dữ liệu | String, Hash, List, Set, Sorted Set, Stream... | Chỉ String (key-value đơn giản) | Bảng quan hệ, ràng buộc, index |
| Persistence | Có (RDB/AOF) | Không | Có (mặc định) |
| Truy vấn phức tạp (JOIN, transaction ACID đầy đủ) | Hạn chế | Không | Mạnh |
| Tốc độ | Rất nhanh (µs–ms) | Rất nhanh | Chậm hơn (I/O đĩa, xử lý query phức tạp) |

### 1.3. Các trường hợp sử dụng phổ biến

- **Cache layer**: đứng trước database chính để giảm tải truy vấn lặp lại
- **Session store**: lưu session/token đăng nhập cho ứng dụng web, chia sẻ được giữa nhiều server (stateless backend)
- **Message broker / Queue**: dùng List, Stream hoặc Pub/Sub để truyền message, xử lý job bất đồng bộ
- **Bộ đếm & số liệu thời gian thực**: leaderboard (Sorted Set), rate limiting (String + TTL), analytics, đếm lượt xem
- **Distributed lock**: dùng `SET key value NX PX <ttl>` để tạo khóa phân tán đơn giản giữa nhiều tiến trình/server

### 1.4. Đặc điểm nổi bật

| Đặc điểm | Mô tả |
|---|---|
| Tốc độ | Đọc/ghi ở mức micro-giây do dữ liệu nằm trong RAM và cấu trúc dữ liệu được tối ưu cho từng loại thao tác |
| Đơn luồng xử lý lệnh | Mỗi lệnh thực thi nguyên tử, không bị chen ngang bởi lệnh khác, tránh race-condition mà không cần lock |
| Đa dạng kiểu dữ liệu | String, Hash, List, Set, Sorted Set, Stream, Bitmap, HyperLogLog — mỗi loại có tập lệnh và độ phức tạp riêng |
| Persistence tuỳ chọn | RDB (snapshot) và AOF (ghi log lệnh), có thể dùng riêng hoặc kết hợp |
| Khả năng mở rộng | Replication (nhân bản), Sentinel (giám sát/failover), Cluster (sharding ngang) |
| Giao thức nhẹ | RESP là giao thức text đơn giản, chi phí parse thấp, dễ triển khai client ở nhiều ngôn ngữ |

---

## 2. Kiến trúc và cơ chế hoạt động

### 2.1. Mô hình xử lý lệnh: Single-thread + Event Loop

Redis xử lý lệnh dựa trên một **vòng lặp sự kiện (event loop)** chạy trên một luồng chính, kết hợp với cơ chế I/O đa dồn kênh của hệ điều hành (`epoll` trên Linux, `kqueue` trên BSD/macOS). Cơ chế này cho phép một luồng duy nhất theo dõi hàng nghìn kết nối socket cùng lúc mà không cần tạo thread riêng cho mỗi client.

**Vì sao đơn luồng vẫn nhanh?**
- Dữ liệu nằm hoàn toàn trong RAM, các thao tác trên cấu trúc dữ liệu có độ phức tạp thấp (thường O(1) hoặc O(log n))
- Không tốn chi phí context-switch giữa các thread, không cần cơ chế lock/mutex để bảo vệ dữ liệu dùng chung → giảm overhead đáng kể so với hệ thống đa luồng
- Mỗi lệnh được thực thi trọn vẹn trước khi xử lý lệnh tiếp theo, nên tự nhiên có tính **nguyên tử (atomicity)** ở cấp lệnh

**Giới hạn của mô hình đơn luồng:** nếu một lệnh chạy lâu (ví dụ `KEYS *` trên tập dữ liệu lớn, `SORT` không giới hạn, hoặc một Lua script phức tạp) thì toàn bộ server bị "block" trong lúc đó — mọi client khác phải chờ, kể cả các lệnh đơn giản như `PING`. Đây là lý do Redis khuyến cáo dùng `SCAN` thay cho `KEYS`, và cần theo dõi `SLOWLOG` trong vận hành thực tế.

**Redis 6.0 trở lên** bổ sung I/O đa luồng (`io-threads`) nhưng chỉ áp dụng cho việc đọc/ghi dữ liệu thô trên socket và parse lệnh — phần **thực thi lệnh** (command execution) vẫn chạy trên một luồng duy nhất, nên tính nguyên tử và mô hình lập trình đơn giản (không cần lo race-condition) vẫn được giữ nguyên.

### 2.2. Quản lý bộ nhớ: TTL và Eviction Policy

**TTL (Time To Live).** Mỗi key có thể được gán thời gian sống bằng `EXPIRE`, `PEXPIRE`, `SETEX`. Redis dùng song song hai cơ chế để dọn key hết hạn:
- **Passive expire**: khi một client truy cập key, Redis kiểm tra TTL trước, nếu đã hết hạn thì xoá ngay và trả về như key không tồn tại
- **Active expire cycle**: một tiến trình nền chạy định kỳ (mặc định ~10 lần/giây), mỗi lần lấy ngẫu nhiên một mẫu nhỏ key có TTL để kiểm tra; nếu tỉ lệ key hết hạn trong mẫu vượt ngưỡng (~25%) thì lặp lại ngay để dọn nhanh hơn, tránh key rác tích tụ dù không ai truy cập tới

Trong mô hình replication, replica **không tự ý xoá** key hết hạn — master mới là nơi quyết định, sau đó gửi lệnh `DEL`/`UNLINK` xuống replica, nhằm đảm bảo dữ liệu giữa các node luôn nhất quán.

**Eviction Policy.** Khi bộ nhớ sử dụng chạm ngưỡng `maxmemory`, Redis phải chọn xoá bớt key để có chỗ ghi mới, theo chính sách cấu hình sẵn:

| Chính sách | Ý nghĩa |
|---|---|
| `noeviction` | Không xoá, trả lỗi `OOM` khi có lệnh ghi thêm |
| `allkeys-lru` / `volatile-lru` | Xoá theo Least Recently Used — trong toàn bộ key / chỉ trong các key có TTL |
| `allkeys-lfu` / `volatile-lfu` | Xoá theo Least Frequently Used (Redis 4.0+) |
| `allkeys-random` / `volatile-random` | Xoá ngẫu nhiên |
| `volatile-ttl` | Ưu tiên xoá key có TTL còn lại ngắn nhất |

Điểm cần lưu ý: Redis **không** duy trì một danh sách LRU/LFU chính xác toàn cục (vì tốn thêm bộ nhớ cho cấu trúc theo dõi). Thay vào đó, Redis dùng LRU/LFU **xấp xỉ**: mỗi lần cần xoá, nó lấy ngẫu nhiên một mẫu gồm `maxmemory-samples` key (mặc định 5), so sánh thời gian truy cập gần nhất giữa các key trong mẫu rồi xoá key "cũ nhất". Tăng `maxmemory-samples` giúp kết quả gần với LRU thật hơn nhưng tốn thêm CPU mỗi lần eviction.

### 2.3. Pipeline

Bình thường, mỗi lệnh Redis là một round-trip mạng: client gửi lệnh → chờ server xử lý → nhận phản hồi rồi mới gửi lệnh kế tiếp. Với hệ thống có độ trễ mạng (latency) đáng kể, gửi hàng nghìn lệnh riêng lẻ sẽ rất chậm dù bản thân Redis xử lý cực nhanh.

**Pipeline** cho phép client gửi liên tiếp nhiều lệnh mà không cần chờ phản hồi từng lệnh, rồi đọc toàn bộ kết quả trả về cùng lúc. Redis vẫn xử lý các lệnh theo đúng thứ tự nhận được, nhưng chi phí round-trip mạng chỉ phải trả một lần cho cả lô lệnh thay vì từng lệnh một.

Ví dụ: thay vì gửi 1000 lệnh `SET` riêng lẻ (1000 round-trip), client gom thành một pipeline duy nhất — số round-trip giảm gần như về 1, thời gian tổng thể giảm đáng kể đặc biệt khi độ trễ mạng cao.

### 2.4. Transaction: MULTI / EXEC / DISCARD / WATCH

Redis hỗ trợ transaction thông qua 4 lệnh:

- `MULTI`: bắt đầu transaction, các lệnh sau đó không thực thi ngay mà được xếp vào hàng đợi
- `EXEC`: thực thi toàn bộ lệnh đã xếp hàng, theo đúng thứ tự, không bị lệnh của client khác chen ngang
- `DISCARD`: huỷ transaction, xoá hàng đợi lệnh
- `WATCH key...`: theo dõi một hoặc nhiều key trước khi `MULTI` — nếu bất kỳ key nào bị thay đổi bởi client khác trước khi `EXEC` được gọi, toàn bộ transaction sẽ bị huỷ (trả về `nil`) thay vì thực thi. Đây là cơ chế **optimistic locking** (khoá lạc quan): không khoá dữ liệu ngay từ đầu mà chỉ kiểm tra xung đột tại thời điểm commit.

**Khác biệt so với transaction trong RDBMS:** Redis đảm bảo tính *tuần tự và không bị chen ngang* trong lúc `EXEC`, nhưng **không có rollback**. Nếu một lệnh trong transaction lỗi logic khi thực thi (ví dụ `INCR` trên key kiểu String không phải số), các lệnh trước và sau đó trong cùng transaction vẫn được thực thi bình thường — Redis không tự động hoàn tác các thay đổi đã áp dụng. Vì vậy transaction ở Redis phù hợp cho mục tiêu *cô lập/nguyên tử theo lô lệnh*, không thay thế được ACID transaction đầy đủ của RDBMS.

### 2.5. Pub/Sub và Streams

**Pub/Sub** là cơ chế publish-subscribe cho giao tiếp thời gian thực: client `SUBSCRIBE` vào một channel (hoặc `PSUBSCRIBE` theo pattern), client khác `PUBLISH` message vào channel đó, Redis chuyển tiếp ngay lập tức tới các subscriber đang lắng nghe. Phù hợp cho notification, chat realtime, broadcast sự kiện — nhưng có hạn chế lớn: **message không được lưu lại**, subscriber offline tại thời điểm publish sẽ mất message đó vĩnh viễn.

**Streams** (từ Redis 5.0) khắc phục hạn chế trên bằng cách lưu lại các message dưới dạng log theo thứ tự thời gian, mỗi entry có một ID duy nhất (dạng `<timestamp>-<seq>`), có thể đọc lại bất kỳ lúc nào:

- `XADD`: thêm entry vào stream
- `XREAD`: đọc entry (có thể đọc từ vị trí bất kỳ, kể cả các entry cũ)
- `XGROUP` + `XREADGROUP`: tạo **consumer group** để nhiều worker cùng chia nhau xử lý các entry của một stream (mỗi entry chỉ được một consumer trong nhóm xử lý), tương tự cơ chế partition/consumer group của Kafka nhưng gọn nhẹ hơn
- `XACK`: consumer xác nhận đã xử lý xong một entry, tránh bị xử lý lại

Nhờ lưu lại lịch sử và hỗ trợ consumer group, Streams phù hợp cho message queue, event sourcing và các hệ thống cần đảm bảo message được xử lý (at-least-once), điều mà Pub/Sub thuần không làm được.

### 2.6. Các mô hình dùng Redis làm Cache

- **Cache-aside (lazy loading)**: ứng dụng đọc Redis trước; nếu cache miss thì đọc từ database rồi ghi ngược lại vào Redis. Đây là pattern phổ biến nhất vì đơn giản và chỉ cache đúng dữ liệu thực sự được truy vấn.
- **Write-through**: mỗi lần ghi, ứng dụng ghi đồng thời vào cache và database → dữ liệu trong cache luôn mới, nhưng độ trễ ghi tăng vì phải chờ cả hai thao tác.
- **Write-behind (write-back)**: ghi vào cache trước, sau đó đồng bộ xuống database theo lô ở một tiến trình nền → ghi nhanh, nhưng có rủi ro mất dữ liệu nếu cache sập trước khi kịp đồng bộ.
- **Cache invalidation**: khi dữ liệu gốc thay đổi, cần chủ động xoá hoặc cập nhật lại key cache tương ứng, nếu không ứng dụng sẽ đọc phải dữ liệu cũ (stale data).
- **Cache stampede (dogpile effect)**: khi một key "hot" (được truy cập rất nhiều) hết hạn, hàng loạt request cùng lúc bị cache-miss và dồn xuống database, có thể làm database quá tải. Giảm thiểu bằng cách dùng lock khi rebuild cache, đặt TTL có độ lệch ngẫu nhiên (jitter) giữa các key, hoặc refresh cache trước khi hết hạn thật sự.

### 2.7. Lua Script

Redis cho phép chạy Lua script trực tiếp trên server bằng `EVAL` (gửi kèm mã script) hoặc `EVALSHA` (gửi hash của script đã được cache trước đó bằng `SCRIPT LOAD`, tránh phải truyền lại toàn bộ script mỗi lần gọi). Toàn bộ script được thực thi **nguyên tử** — trong lúc chạy, không lệnh nào khác được chen vào, tương tự một transaction nhưng linh hoạt hơn vì có thể chứa logic điều kiện.

Cơ chế này thường dùng khi cần gộp nhiều bước đọc-kiểm tra-ghi thành một thao tác an toàn duy nhất mà `MULTI/EXEC` không đủ linh hoạt để biểu diễn, ví dụ: kiểm tra tồn kho rồi trừ số lượng chỉ khi đủ hàng, cập nhật counter có điều kiện, hoặc cài đặt thuật toán rate limiting (sliding window) chính xác.

---

## 3. Các kiểu dữ liệu trong Redis

| Kiểu dữ liệu | Lệnh tiêu biểu | Use case |
|---|---|---|
| **String** | `SET`, `GET`, `INCR`, `APPEND` | Cache giá trị đơn, counter |
| **Hash** | `HSET`, `HGET`, `HGETALL` | Lưu object (VD: user profile) |
| **List** | `LPUSH`, `RPUSH`, `LRANGE`, `BRPOP` | Hàng đợi, timeline |
| **Set** | `SADD`, `SMEMBERS`, `SINTER` | Tập hợp không trùng, tag |
| **Sorted Set** | `ZADD`, `ZRANGE`, `ZINCRBY` | Bảng xếp hạng (leaderboard) |
| **Stream** | `XADD`, `XREAD`, `XGROUP` | Message queue, event log |
| **Bitmap** | `SETBIT`, `GETBIT`, `BITCOUNT` | Theo dõi trạng thái on/off (VD: điểm danh) |
| **HyperLogLog** | `PFADD`, `PFCOUNT` | Đếm số lượng phần tử duy nhất xấp xỉ |

**Cơ chế encoding nội bộ.** Với mỗi kiểu dữ liệu, Redis không luôn dùng một cấu trúc lưu trữ cố định mà tự động chọn encoding tối ưu theo kích thước dữ liệu để tiết kiệm bộ nhớ. Ví dụ một Hash hoặc List nhỏ (ít phần tử, giá trị ngắn) được lưu dưới dạng `listpack` — một mảng liên tục nén gọn, duyệt tuần tự; khi số phần tử hoặc kích thước vượt ngưỡng cấu hình (`hash-max-listpack-entries`, `list-max-listpack-size`...), Redis tự chuyển sang cấu trúc đầy đủ (hash table, linked list, skiplist cho Sorted Set) để đảm bảo thao tác vẫn nhanh khi dữ liệu lớn. Việc chuyển đổi này diễn ra tự động, người dùng không cần can thiệp, nhưng hiểu cơ chế này giúp giải thích vì sao nhiều key nhỏ (VD: Hash đại diện một object) thường tiết kiệm bộ nhớ hơn nhiều key String rời rạc.

---

## 4. Cơ chế lưu trữ bền vững (Persistence)

Vì dữ liệu nằm chủ yếu trong RAM, nếu tiến trình Redis dừng đột ngột (crash, restart, mất điện) thì toàn bộ dữ liệu có thể mất. Redis cung cấp hai cơ chế persistence, có thể dùng riêng hoặc kết hợp.

### 4.1. RDB (Redis Database Snapshot)

RDB chụp toàn bộ dữ liệu tại một thời điểm ra một file nhị phân `.rdb`, theo chu kỳ cấu hình (VD: `save 900 1` nghĩa là sau 900 giây nếu có ít nhất 1 thay đổi thì lưu).

**Cơ chế bên dưới:** khi thực hiện `BGSAVE`, Redis gọi `fork()` để tạo tiến trình con. Nhờ cơ chế **copy-on-write** của hệ điều hành, tiến trình con ban đầu dùng chung vùng nhớ với tiến trình cha mà không cần copy ngay — chỉ khi tiến trình cha ghi đè lên một trang bộ nhớ nào đó trong lúc con đang snapshot thì trang đó mới được copy riêng. Nhờ vậy `BGSAVE` không chặn (block) các client khác đang đọc/ghi dữ liệu, nhưng nếu tốc độ ghi trong lúc fork rất cao, chi phí copy-on-write có thể khiến RAM sử dụng tăng vọt tạm thời.

- **Ưu điểm**: file nhỏ gọn, phục hồi (load lại khi restart) nhanh, phù hợp cho backup định kỳ
- **Nhược điểm**: có thể mất dữ liệu ghi ra giữa 2 lần snapshot nếu Redis crash trước khi kịp lưu

### 4.2. AOF (Append Only File)

AOF ghi lại **mọi lệnh làm thay đổi dữ liệu** (write command) vào một file log theo kiểu append-only, theo đúng thứ tự thực thi. Khi restart, Redis phục hồi dữ liệu bằng cách chạy lại toàn bộ các lệnh trong file này.

Độ an toàn được cấu hình qua `appendfsync` — quyết định tần suất Redis gọi `fsync()` để đảm bảo dữ liệu thực sự ghi xuống đĩa (không chỉ nằm trong buffer của OS):
- `always`: fsync sau mỗi lệnh ghi — an toàn nhất, nhưng chậm nhất vì mỗi lệnh đều chờ I/O đĩa
- `everysec`: fsync mỗi giây một lần — cân bằng giữa hiệu năng và độ an toàn, mất tối đa ~1 giây dữ liệu nếu crash, là cấu hình khuyến nghị mặc định
- `no`: để hệ điều hành tự quyết định thời điểm flush — nhanh nhất nhưng rủi ro mất dữ liệu cao nhất nếu crash

Vì log lệnh sẽ phình to dần theo thời gian, Redis có cơ chế **AOF rewrite** (`BGREWRITEAOF`): tương tự `BGSAVE`, Redis fork một tiến trình con để viết lại file AOF ở dạng tối giản — thay vì giữ lại toàn bộ lịch sử lệnh, nó ghi ra tập lệnh tối thiểu cần thiết để tái tạo đúng trạng thái dữ liệu hiện tại (VD: 1000 lệnh `INCR` trên cùng key được rút gọn thành một lệnh `SET` với giá trị cuối cùng).

### 4.3. Kết hợp RDB + AOF

Từ Redis 4.0+, có thể bật đồng thời cả hai cơ chế (`aof-use-rdb-preamble yes`): file AOF khi rewrite sẽ bắt đầu bằng một đoạn dữ liệu dạng RDB (phục hồi nhanh) rồi tiếp theo là các lệnh ghi phát sinh sau đó dạng AOF (đảm bảo không mất dữ liệu gần nhất) — tận dụng được cả tốc độ phục hồi của RDB lẫn độ an toàn của AOF.

**Lựa chọn trong thực tế:** dùng RDB đơn thuần nếu Redis chỉ đóng vai trò cache thuần tuý (mất dữ liệu có thể chấp nhận được, sẽ tự nạp lại từ nguồn chính). Bật thêm AOF (`everysec`) nếu Redis lưu dữ liệu quan trọng không có nguồn nào khác để phục hồi (session, queue, counter nghiệp vụ).

---

## 5. Replication và High Availability

### 5.1. Master-Replica Replication

Một node **master** có thể có nhiều **replica** (trước gọi là slave) đồng bộ dữ liệu theo cơ chế **bất đồng bộ (asynchronous)**: master không chờ replica xác nhận đã nhận dữ liệu trước khi trả kết quả cho client ghi.

**Quá trình đồng bộ gồm hai giai đoạn:**
- **Full resync**: khi replica kết nối lần đầu (hoặc mất kết nối quá lâu), master tạo một bản RDB snapshot rồi gửi toàn bộ cho replica để nạp vào, sau đó master tiếp tục gửi các lệnh ghi phát sinh trong lúc snapshot đang truyền
- **Partial resync (PSYNC)**: nếu replica chỉ mất kết nối tạm thời, master và replica có thể tiếp tục đồng bộ từ điểm dừng cũ bằng cách dựa vào **replication backlog** — một buffer trong bộ nhớ master lưu lại các lệnh ghi gần nhất, tránh phải truyền lại toàn bộ dữ liệu (full resync tốn kém về băng thông và CPU)

Replica được dùng để: scale-out cho việc đọc (nhiều client đọc trên nhiều replica, giảm tải cho master), backup dữ liệu mà không ảnh hưởng master, và làm nguồn để failover khi master gặp sự cố. Vì đồng bộ bất đồng bộ, luôn tồn tại một độ trễ (replication lag) nhỏ giữa master và replica — cần lưu ý khi ứng dụng đọc trên replica ngay sau khi vừa ghi trên master.

### 5.2. Redis Sentinel

Sentinel là một tiến trình độc lập chạy song song để giám sát cụm master-replica và tự động xử lý sự cố:

- **Giám sát**: định kỳ ping tới master/replica để phát hiện tình trạng "down". Một Sentinel đơn lẻ nghi ngờ node down gọi là **SDOWN** (Subjectively Down); khi đủ số Sentinel khác trong nhóm cũng xác nhận, trạng thái nâng lên **ODOWN** (Objectively Down)
- **Failover tự động**: khi master bị xác nhận ODOWN, các Sentinel tổ chức bầu chọn (dựa trên thuật toán tương tự Raft) một Sentinel làm "leader" để chọn ra replica phù hợp nhất (dữ liệu mới nhất, độ ưu tiên cấu hình cao nhất) và thăng cấp (`REPLICAOF NO ONE`) thành master mới, đồng thời chỉ các replica còn lại đồng bộ theo master mới
- **Quorum**: số lượng Sentinel tối thiểu phải đồng ý thì mới xác nhận ODOWN và tiến hành failover. Cần triển khai **tối thiểu 3 node Sentinel** (số lẻ) đặt trên các máy vật lý khác nhau để có quorum đáng tin cậy và tránh chính Sentinel trở thành single point of failure

### 5.3. Redis Cluster

Redis Cluster giải quyết bài toán mở rộng ngang khi một node duy nhất không đủ RAM hoặc throughput cho toàn bộ dữ liệu:

- Toàn bộ không gian key được chia thành **16384 hash slot** cố định; mỗi key được gán vào một slot theo công thức `CRC16(key) mod 16384` (nếu dùng hash tag `{...}` thì chỉ phần trong dấu ngoặc được dùng để tính slot, giúp gom các key liên quan vào cùng một slot)
- Mỗi **shard** trong cluster phụ trách một tập slot, gồm 1 master + tối thiểu 1 replica để đảm bảo HA cho riêng shard đó — nếu master của shard chết, các node khác trong cluster tự bầu replica của shard đó lên làm master mới, tương tự cơ chế failover của Sentinel nhưng được tích hợp sẵn trong giao thức Cluster (dùng gossip protocol giữa các node để trao đổi trạng thái)
- Client kết nối tới bất kỳ node nào trong cluster; nếu key được yêu cầu không thuộc slot mà node đó quản lý, node sẽ trả về lỗi chuyển hướng `MOVED <slot> <ip:port>` để client tự kết nối sang đúng node (hoặc `ASK` trong lúc slot đang được di chuyển giữa hai node)
- Vì dữ liệu được phân mảnh theo slot, các lệnh thao tác nhiều key cùng lúc (`MSET`, `SUNION`...) chỉ hoạt động nếu tất cả key liên quan nằm cùng slot — đây là lý do kỹ thuật hash tag tồn tại

---

## 6. Hướng dẫn Lab thực hành

### Lab 1: Cài đặt Redis (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install redis-server -y

# Kiểm tra version
redis-server --version

# Khởi động service
sudo systemctl enable redis-server
sudo systemctl start redis-server
sudo systemctl status redis-server
```

**Đưa vào báo cáo:**
- Các lệnh đã chạy và mục đích từng lệnh (cài đặt, kiểm tra version, bật service)
- Phiên bản Redis cài được (output của `redis-server --version`)
- Trạng thái service sau khi start (`active (running)`)

**Chụp màn hình:**
- Kết quả lệnh `redis-server --version`
- Kết quả lệnh `sudo systemctl status redis-server` (thấy dòng `Active: active (running)`)

### Lab 2: Cài đặt bằng Docker (khuyến nghị cho môi trường lab)

```bash
docker run -d --name redis-lab -p 6379:6379 redis:7-alpine

# Kết nối vào container
docker exec -it redis-lab redis-cli
```

**Đưa vào báo cáo:**
- Lý do chọn Docker cho môi trường lab (nhanh, không cần cài trực tiếp lên máy)
- Kết quả `docker ps` cho thấy container đang chạy, cổng 6379 được map
- Kết quả gõ `PING` bên trong `redis-cli` của container

**Chụp màn hình:**
- Output `docker ps` (thấy container `redis-lab`, STATUS = Up, PORTS = 6379)
- Cửa sổ terminal sau khi `docker exec -it redis-lab redis-cli`, gõ `PING` trả về `PONG`

### Lab 3: Thao tác cơ bản với redis-cli

```bash
redis-cli

127.0.0.1:6379> SET user:1:name "Nguyen Van A"
OK
127.0.0.1:6379> GET user:1:name
"Nguyen Van A"

127.0.0.1:6379> EXPIRE user:1:name 60
(integer) 1
127.0.0.1:6379> TTL user:1:name
(integer) 58

127.0.0.1:6379> HSET user:1 name "A" age 25 city "Hanoi"
127.0.0.1:6379> HGETALL user:1

127.0.0.1:6379> LPUSH queue:jobs "job1" "job2"
127.0.0.1:6379> LRANGE queue:jobs 0 -1

127.0.0.1:6379> ZADD leaderboard 100 "player1" 200 "player2"
127.0.0.1:6379> ZRANGE leaderboard 0 -1 WITHSCORES
```

**Đưa vào báo cáo:**
- Bảng liệt kê từng lệnh đã chạy, kết quả trả về và giải thích ngắn gọn ý nghĩa (String dùng cho gì, Hash dùng cho gì...)
- Nhận xét: kiểu dữ liệu nào phù hợp với tình huống nào (VD: Hash cho object, Sorted Set cho xếp hạng)

**Chụp màn hình:**
- Toàn bộ phiên `redis-cli` (có thể chụp/ghi lại theo từng nhóm lệnh: String, Hash, List, Sorted Set) sao cho thấy rõ lệnh gõ vào và kết quả trả về

### Lab 4: Cấu hình Persistence (RDB + AOF)

Sửa file `/etc/redis/redis.conf`:

```conf
# RDB
save 900 1
save 300 10
save 60 10000
dbfilename dump.rdb
dir /var/lib/redis

# AOF
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
```

Khởi động lại và kiểm tra:

```bash
sudo systemctl restart redis-server
redis-cli CONFIG GET appendonly
redis-cli BGSAVE      # tạo snapshot RDB thủ công
redis-cli BGREWRITEAOF  # nén lại file AOF
```

**Đưa vào báo cáo:**
- Đoạn cấu hình đã sửa trong `redis.conf` (RDB + AOF)
- Kết quả `redis-cli CONFIG GET appendonly` (xác nhận đã bật `yes`)
- Danh sách file được tạo ra sau `BGSAVE`/`BGREWRITEAOF` (`dump.rdb`, `appendonly.aof`)

**Chụp màn hình:**
- Nội dung file `redis.conf` phần RDB/AOF vừa sửa
- Kết quả `redis-cli CONFIG GET appendonly`
- Kết quả `ls -la /var/lib/redis` cho thấy file `dump.rdb` và `appendonly.aof` tồn tại, kèm log `Background saving terminated with success`

### Lab 5: Thiết lập Master-Replica bằng Docker

Trong lab này, ta chạy 2 container Redis trên cùng một Docker network:

- `redis-master`: đóng vai trò Master, map ra cổng `6379`
- `redis-replica`: đóng vai trò Replica, map ra cổng `6380` trên máy host nhưng bên trong container vẫn dùng cổng `6379`

#### Bước 1: Tạo Docker network

```bash
docker network create redis-net
```

Network riêng giúp các container Redis gọi nhau bằng tên container, ví dụ Replica có thể kết nối tới Master bằng hostname `redis-master`.

#### Bước 2: Chạy Redis Master

```bash
docker run -d --name redis-master --network redis-net -p 6379:6379 redis:7-alpine
```

Kiểm tra container Master:

```bash
docker ps
docker exec -it redis-master redis-cli PING
```

Kết quả mong đợi:

```text
PONG
```

#### Bước 3: Chạy Redis Replica

```bash
docker run -d --name redis-replica --network redis-net -p 6380:6379 redis:7-alpine redis-server --replicaof redis-master 6379
```

Ý nghĩa lệnh:

- `--network redis-net`: đưa Replica vào cùng network với Master
- `-p 6380:6379`: truy cập Replica từ máy host qua cổng `6380`
- `--replicaof redis-master 6379`: cấu hình Redis này đồng bộ dữ liệu từ Master tên `redis-master`, cổng `6379`

#### Bước 4: Lấy IP/cổng của Master và Replica

```bash
docker inspect -f "{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}" redis-master
docker inspect -f "{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}" redis-replica
```

Trong báo cáo có thể ghi:

- Master: container `redis-master`, port nội bộ `6379`, host port `6379`
- Replica: container `redis-replica`, port nội bộ `6379`, host port `6380`
- IP nội bộ Docker: lấy từ kết quả `docker inspect`

#### Bước 5: Kiểm tra replication trên Master

```bash
docker exec -it redis-master redis-cli INFO replication
```

Các dòng quan trọng cần thấy:

```text
role:master
connected_slaves:1
slave0:ip=...,port=6379,state=online,offset=...
master_repl_offset:...
```

Ý nghĩa:

- `role:master`: node hiện tại là Master
- `connected_slaves:1`: đang có 1 Replica kết nối vào Master
- `slave0`: thông tin Replica đang đồng bộ
- `master_repl_offset`: vị trí replication hiện tại của Master

#### Bước 6: Kiểm tra replication trên Replica

```bash
docker exec -it redis-replica redis-cli INFO replication
```

Các dòng quan trọng cần thấy:

```text
role:slave
master_host:redis-master
master_port:6379
master_link_status:up
slave_repl_offset:...
```

Ý nghĩa:

- `role:slave`: node hiện tại là Replica
- `master_host:redis-master`: Replica đang theo Master có hostname `redis-master`
- `master_link_status:up`: kết nối tới Master đang hoạt động
- `slave_repl_offset`: vị trí replication của Replica; giá trị này nên gần hoặc khớp với `master_repl_offset` trên Master

#### Bước 7: Thử đồng bộ dữ liệu

Ghi dữ liệu trên Master:

```bash
docker exec -it redis-master redis-cli SET demo:sync "hello from master"
```

Kết quả:

```text
OK
```

Đọc dữ liệu trên Replica:

```bash
docker exec -it redis-replica redis-cli GET demo:sync
```

Kết quả mong đợi:

```text
"hello from master"
```

Nếu Replica đọc được cùng giá trị, nghĩa là replication đã hoạt động.

#### Bước 8: Dọn lab sau khi thực hành

```bash
docker rm -f redis-master redis-replica
docker network rm redis-net
```

**Đưa vào báo cáo:**
- IP/cổng của Master và Replica
- Kết quả `INFO replication` trên Master, tập trung vào các trường `role:master`, `connected_slaves`, `master_repl_offset`
- Kết quả `INFO replication` trên Replica, tập trung vào các trường `role:slave`, `master_link_status:up`, `slave_repl_offset`
- Kết quả thử `SET` trên Master rồi `GET` trên Replica để chứng minh dữ liệu đã đồng bộ

**Chụp màn hình:**
- Output `docker ps` cho thấy 2 container `redis-master` và `redis-replica` đang chạy
- `INFO replication` trên Master
- `INFO replication` trên Replica
- Cặp ảnh `SET` trên Master và `GET` trên Replica trả về cùng giá trị

### Lab 6: Thiết lập Redis Sentinel (cơ bản)

File `sentinel.conf`:

```conf
port 26379
sentinel monitor mymaster 127.0.0.1 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
```

Chạy Sentinel:

```bash
redis-sentinel /etc/redis/sentinel.conf
```

Kiểm tra Sentinel đang giám sát đúng master:

```bash
redis-cli -p 26379 SENTINEL master mymaster
```

(Tuỳ chọn) mô phỏng failover bằng cách tắt master và quan sát Sentinel bầu replica mới:

```bash
# Trên máy Master
sudo systemctl stop redis-server

# Trên máy Sentinel, theo dõi log để thấy quá trình bầu master mới
```

**Đưa vào báo cáo:**
- Nội dung file `sentinel.conf`
- Kết quả `SENTINEL master mymaster` (thấy đúng IP/port master đang giám sát)
- (Nếu có test failover) log Sentinel lúc phát hiện master down và bầu master mới, IP master mới sau failover

**Chụp màn hình:**
- Terminal log lúc Sentinel khởi động (`Sentinel ID`, `+monitor master`)
- Kết quả lệnh `SENTINEL master mymaster`
- (Nếu test failover) log `+sdown`/`+odown`/`+switch-master` trong quá trình failover

### Lab 7: Benchmark hiệu năng

```bash
redis-benchmark -q -n 100000
redis-benchmark -t set,get -n 100000 -q
```

**Đưa vào báo cáo:**
- Kết quả benchmark (số request/giây cho `SET`, `GET`)
- Nhận xét ngắn về hiệu năng (so với kỳ vọng, ảnh hưởng của cấu hình máy)

**Chụp màn hình:**
- Output đầy đủ của cả hai lệnh `redis-benchmark`

### Lab 8: Web demo nhỏ minh họa Redis (Flask + Redis)

Một web app nhỏ để trực quan hóa 2 tính năng hay dùng: **đếm lượt truy cập** (String/`INCR`) và **bảng xếp hạng** (Sorted Set/`ZADD`).

**Cài thư viện:**

```bash
pip install flask redis
```

**File `app.py`:**

```python
from flask import Flask, request, redirect, url_for, render_template_string
import redis

app = Flask(__name__)
r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)

TEMPLATE = """
<!doctype html>
<html>
<head><title>Redis Demo</title></head>
<body style="font-family: sans-serif; max-width: 480px; margin: 40px auto;">
  <h2>Redis Demo</h2>

  <p>Số lượt truy cập trang: <b>{{ visits }}</b></p>

  <h3>Bảng xếp hạng</h3>
  <form method="POST" action="/score">
    <input name="player" placeholder="Tên người chơi" required>
    <input name="point" type="number" placeholder="Điểm cộng" value="1" required>
    <button type="submit">Cộng điểm</button>
  </form>

  <ol>
    {% for name, score in leaderboard %}
      <li>{{ name }} — {{ score|int }} điểm</li>
    {% endfor %}
  </ol>
</body>
</html>
"""

@app.route("/")
def index():
    visits = r.incr("demo:visits")
    leaderboard = r.zrevrange("demo:leaderboard", 0, 9, withscores=True)
    return render_template_string(TEMPLATE, visits=visits, leaderboard=leaderboard)

@app.route("/score", methods=["POST"])
def add_score():
    player = request.form["player"]
    point = float(request.form["point"])
    r.zincrby("demo:leaderboard", point, player)
    return redirect(url_for("index"))

if __name__ == "__main__":
    app.run(debug=True, port=5000)
```

**Chạy demo:**

```bash
# Đảm bảo Redis đang chạy (Lab 1 hoặc Lab 2)
python app.py
```

Mở trình duyệt tại `http://localhost:5000`:
- Mỗi lần load trang, số lượt truy cập (`demo:visits`) tăng lên nhờ `INCR` — minh họa **String**.
- Nhập tên + điểm rồi bấm "Cộng điểm" để cập nhật **Sorted Set** (`demo:leaderboard`) bằng `ZINCRBY`, bảng xếp hạng hiển thị theo thứ tự điểm giảm dần (`ZREVRANGE`).

Có thể quan sát dữ liệu thô song song qua `redis-cli`:

```bash
redis-cli GET demo:visits
redis-cli ZRANGE demo:leaderboard 0 -1 WITHSCORES
```

**Đưa vào báo cáo:**
- Đoạn code `app.py` và giải thích ánh xạ: thao tác trên web ↔ lệnh Redis tương ứng (load trang → `INCR`, submit form → `ZINCRBY`)
- Kết quả đối chiếu giữa dữ liệu hiển thị trên web và dữ liệu thô lấy từ `redis-cli` (chứng minh web chỉ là lớp hiển thị của Redis)

**Chụp màn hình:**
- Giao diện web lúc mới chạy (visits = 1, bảng xếp hạng trống)
- Giao diện web sau khi F5 vài lần (số lượt truy cập tăng lên)
- Giao diện web sau khi nhập điểm cho 2-3 người chơi (bảng xếp hạng sắp xếp theo điểm giảm dần)
- Terminal chạy `redis-cli GET demo:visits` và `redis-cli ZRANGE demo:leaderboard 0 -1 WITHSCORES` cho thấy số liệu khớp với trên web

---

## 7. Lưu ý và xử lý sự cố thực tế

### 7.1. Bảo mật

- **Luôn đặt password**: `requirepass <strong_password>` trong `redis.conf`, hoặc dùng ACL (`ACL SETUSER`) từ Redis 6+ để phân quyền chi tiết theo user
- **Không bind 0.0.0.0** ra internet công khai nếu không cần thiết — mặc định Redis không có auth mạnh, dễ bị quét và khai thác (ransomware Redis là vấn đề thực tế phổ biến)
- Đổi tên hoặc vô hiệu hóa các lệnh nguy hiểm: `rename-command FLUSHALL ""`, `rename-command CONFIG ""`
- Dùng firewall/VPC security group giới hạn IP truy cập port 6379

### 7.2. Vấn đề Bộ nhớ (Memory)

- **Triệu chứng**: Redis báo lỗi `OOM command not allowed` hoặc bị OS kill (OOM Killer)
- **Nguyên nhân thường gặp**: không set `maxmemory`, key không có TTL tích tụ dần, dùng cấu trúc dữ liệu lớn không hợp lý (VD: List quá dài)
- **Xử lý**:
  - Set `maxmemory` và eviction policy phù hợp
  - Dùng `redis-cli --bigkeys` để tìm key lớn bất thường
  - Dùng `MEMORY USAGE <key>` để kiểm tra dung lượng từng key
  - Cân nhắc bật `maxmemory-policy allkeys-lru` cho cache thuần túy

### 7.3. Vấn đề Persistence

- **RDB fork tốn RAM**: khi `BGSAVE` chạy, Redis fork tiến trình con → có thể gây tràn RAM tạm thời trên hệ thống ít bộ nhớ đệm (do copy-on-write). Theo dõi bằng `INFO persistence` (trường `rdb_bgsave_in_progress`, `latest_fork_usec`)
- **AOF file phình to**: cần bật `auto-aof-rewrite-percentage` và `auto-aof-rewrite-min-size` hợp lý để tự động rewrite
- **Mất dữ liệu sau crash**: nếu chỉ dùng RDB, dữ liệu giữa 2 lần snapshot sẽ mất — với hệ thống quan trọng nên bật thêm AOF với `appendfsync everysec` hoặc `always`

### 7.4. Vấn đề Replication

- **Replica bị "lag"** (chậm đồng bộ so với master): kiểm tra bằng `INFO replication` (trường `master_repl_offset` so với `slave_repl_offset`)
- **Full resync liên tục**: xảy ra khi replication buffer (`repl-backlog-size`) quá nhỏ so với tốc độ ghi — tăng giá trị này để tránh phải đồng bộ lại toàn bộ dữ liệu
- **Split-brain sau failover**: khi master cũ hồi phục nhưng vẫn tưởng mình là master — cần Sentinel cấu hình đúng quorum để tránh 2 node đều nhận là master

### 7.5. Vấn đề Hiệu năng

- **Lệnh chậm (slow command)**: dùng `SLOWLOG GET` để xem các lệnh vượt ngưỡng thời gian (cấu hình `slowlog-log-slower-than`)
- **Tránh lệnh có độ phức tạp cao** trên tập dữ liệu lớn: `KEYS *` (nên dùng `SCAN` thay thế), `SMEMBERS` trên set khổng lồ, `SORT` không giới hạn
- **Client kết nối quá nhiều**: theo dõi bằng `CLIENT LIST`, giới hạn qua `maxclients`; nên dùng connection pool ở phía ứng dụng thay vì tạo kết nối mới liên tục

### 7.6. Vấn đề khi vận hành Cluster

- **Hash slot không đồng đều**: dùng `redis-cli --cluster rebalance` để cân bằng lại tải giữa các node
- **Node bị đánh dấu "fail"**: kiểm tra `CLUSTER NODES`, `CLUSTER INFO`; đảm bảo mỗi master có ít nhất 1 replica để tự động failover
- **Lỗi `CROSSSLOT`**: xảy ra khi thực hiện lệnh đa key nhưng các key thuộc các hash slot khác nhau — dùng **hash tag** (`{user1000}.name`, `{user1000}.age`) để ép các key liên quan về cùng 1 slot

### 7.7. Checklist vận hành thực tế (Production Checklist)

- [ ] Đặt `requirepass` / ACL, không để Redis public ra internet
- [ ] Cấu hình `maxmemory` + eviction policy phù hợp với use case
- [ ] Bật cả RDB và AOF nếu dữ liệu quan trọng, chỉ RDB nếu chỉ là cache
- [ ] Giám sát bằng `INFO`, `SLOWLOG`, hoặc công cụ như RedisInsight, Prometheus + redis_exporter
- [ ] Thiết lập replication + Sentinel/Cluster cho hệ thống cần HA
- [ ] Sao lưu định kỳ file RDB/AOF ra nơi lưu trữ ngoài (S3, NAS...)
- [ ] Test kịch bản failover định kỳ (không chỉ cấu hình xong là để đó)

---

## 8. Kết luận

Redis là công cụ mạnh mẽ và linh hoạt cho các bài toán cần tốc độ truy xuất cao, nhưng việc vận hành ổn định trong môi trường thực tế đòi hỏi hiểu rõ về cơ chế bộ nhớ, persistence và replication. Việc giám sát chủ động (monitoring), cấu hình bảo mật chặt chẽ, và có kế hoạch backup/failover rõ ràng là yếu tố quyết định để tránh sự cố mất dữ liệu hoặc downtime khi triển khai Redis cho hệ thống production.

---

*Tài liệu được biên soạn phục vụ mục đích học tập và tham khảo kỹ thuật.*
