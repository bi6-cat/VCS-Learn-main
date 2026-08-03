# HƯỚNG DẪN BỔ SUNG BÁO CÁO DOCKER
### Phần lý thuyết còn thiếu + hướng dẫn thực hành lab mới

Tài liệu này bổ sung cho báo cáo tuần "Docker Container" hiện tại. Báo cáo gốc đã bao quát tốt phần lõi (kiến trúc, namespaces/cgroups, layer/overlay2, network, Compose, Swarm). Phần dưới đây tập trung vào các mảng **vận hành thực tế** còn thiếu: bảo mật, build hiện đại, resource control, logging — đây là những thứ hay gặp khi vận hành production và hay bị hỏi khi phỏng vấn.

---

## PHẦN A — LÝ THUYẾT CẦN BỔ SUNG

### A.1 BuildKit (build engine hiện đại)

Docker build mặc định hiện nay dùng BuildKit thay vì builder cũ (legacy builder). Cần nắm:

- Kích hoạt: `DOCKER_BUILDKIT=1 docker build ...` hoặc dùng thẳng `docker buildx build ...`
- **Cache mount**: cho phép cache thư mục dependency (npm, pip, apt) giữa các lần build mà không tạo layer, giúp build nhanh hơn nhiều:
  ```dockerfile
  RUN --mount=type=cache,target=/root/.npm npm install
  ```
- **Secret mount**: đưa secret (API key, token clone private repo) vào quá trình build mà **không** lưu vào layer của image (khác với dùng `ARG`/`ENV` — cách này để lộ secret vĩnh viễn trong lịch sử layer):
  ```dockerfile
  RUN --mount=type=secret,id=git_token \
      git clone https://$(cat /run/secrets/git_token)@github.com/private/repo.git
  ```
  ```bash
  docker build --secret id=git_token,src=./token.txt -t myapp .
  ```
- **Multi-platform build**: build 1 image chạy được trên nhiều kiến trúc CPU (amd64, arm64) cùng lúc:
  ```bash
  docker buildx build --platform linux/amd64,linux/arm64 -t myapp:latest --push .
  ```

### A.2 Bảo mật container

Đây là mảng báo cáo hiện chưa có mục riêng, trong khi rất hay bị hỏi trong phỏng vấn hoặc audit thực tế:

- **Linux Capabilities**: mặc định container có một tập quyền kernel giới hạn nhưng vẫn còn khá rộng. Nên `--cap-drop=ALL` rồi chỉ `--cap-add` đúng quyền cần (ví dụ `NET_BIND_SERVICE` nếu cần bind port <1024).
- **Chạy non-root**: dùng `USER` trong Dockerfile là chưa đủ để "an toàn" nếu không kết hợp với cap-drop — mục đích chính là giảm thiệt hại nếu container bị chiếm quyền (container escape).
- **Read-only filesystem**: `docker run --read-only` khiến container không ghi được vào bất kỳ đâu ngoài các mount được khai báo rõ (`--tmpfs /tmp`), giảm bề mặt tấn công.
- **`--security-opt no-new-privileges`**: chặn process trong container leo thang quyền qua setuid binary.
- **seccomp / AppArmor**: Docker có sẵn seccomp profile mặc định chặn nhiều syscall nguy hiểm; có thể custom profile riêng cho từng ứng dụng.
- **Docker Secrets vs biến môi trường**: biến môi trường (`-e`, `environment:`) dễ bị lộ qua `docker inspect`, log crash, hoặc `/proc/<pid>/environ`. Secret (Swarm) được mount dưới dạng file trong `/run/secrets/`, không nằm trong inspect.
- **Image scanning**: `docker scout cves <image>` hoặc Trivy để quét lỗ hổng (CVE) trong base image trước khi deploy.

### A.3 Resource limit chi tiết (mở rộng phần cgroups)

Báo cáo đã nói cgroups giới hạn tài nguyên nhưng chưa có lệnh cụ thể và hành vi khi vượt giới hạn:

```bash
docker run -d \
  --memory=512m --memory-swap=512m \
  --cpus=1.5 \
  --pids-limit=200 \
  myapp
```

- `--memory`: giới hạn RAM cứng. Vượt quá → kernel OOM Killer giết process trong container (không phải Docker chủ động dừng).
- `--memory-swap=--memory` (bằng nhau) → tắt hẳn swap, tránh container "chậm âm thầm" khi swap vào ổ đĩa.
- `--cpus`: giới hạn số lõi CPU logic (có thể là số thập phân, ví dụ 1.5 lõi).
- `--pids-limit`: chặn fork bomb.
- Kiểm tra: `docker inspect <container> | grep -i oom` → `OOMKilled: true` là dấu hiệu container bị giết do vượt RAM.

### A.4 Logging driver & log rotation

Mặc định Docker dùng driver `json-file` **không giới hạn dung lượng** — log chạy lâu ngày có thể làm đầy ổ đĩa host. Cần cấu hình:

```yaml
# trong compose.yml
services:
  api:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Ngoài `json-file` còn có các driver khác để gửi log tập trung: `syslog`, `fluentd`, `gelf` (Graylog), hoặc dùng Loki/Promtail để gom log nhiều container về một nơi quan sát chung.

### A.5 HEALTHCHECK ở tầng Dockerfile (gốc của Compose healthcheck)

Báo cáo đã dùng `condition: service_healthy` ở Compose nhưng chưa nói cơ chế gốc nằm ở Dockerfile:

```dockerfile
HEALTHCHECK --interval=10s --timeout=3s --retries=3 --start-period=5s \
  CMD curl -f http://localhost:3000/health || exit 1
```

- `--interval`: chu kỳ kiểm tra.
- `--timeout`: thời gian tối đa 1 lần check.
- `--retries`: số lần fail liên tiếp trước khi đánh dấu `unhealthy`.
- `--start-period`: thời gian "ân hạn" lúc mới start, fail trong giai đoạn này không tính.

### A.6 Init process & zombie process

Nhiều ứng dụng Node.js/Python khi chạy trực tiếp làm PID 1 trong container sẽ **không xử lý đúng signal** (SIGTERM) và không "reap" được zombie process con. Giải pháp:

```bash
docker run --init myapp
```

Cờ `--init` chèn một init process nhỏ (tini) làm PID 1 thật sự, ứng dụng chạy như process con — nhận signal đúng cách và dọn zombie process tự động.

### A.7 Swarm: Secrets & Configs, Placement Constraints

- **Docker Secret** (khác biến môi trường trong Compose thường):
  ```bash
  echo "supersecret" | docker secret create db_password -
  ```
  ```yaml
  services:
    db:
      secrets:
        - db_password
  secrets:
    db_password:
      external: true
  ```
  Secret được mount vào `/run/secrets/db_password` trong container, không hiện trong `docker service inspect`.

- **Docker Config**: tương tự Secret nhưng dùng cho file cấu hình không nhạy cảm (nginx.conf, v.v.), có thể update mà không cần rebuild image.

- **Node label & Placement constraint/preference**: khi cluster có node phần cứng không đồng nhất (SSD vs HDD, node có GPU...):
  ```bash
  docker node update --label-add disk=ssd worker1
  docker service create --constraint node.labels.disk==ssd ...
  ```

### A.8 Network driver còn thiếu: macvlan / ipvlan

Ngoài bridge/host/overlay/none, còn driver `macvlan` cấp cho container một địa chỉ MAC/IP thật nằm trực tiếp trong mạng LAN của host (như một máy vật lý riêng biệt) — hay dùng khi cần container có IP cố định nhìn thấy được từ toàn bộ mạng doanh nghiệp, hoặc chạy ứng dụng legacy yêu cầu IP riêng.

### A.9 Swarm vs Kubernetes (thêm 1 đoạn so sánh ngắn)

Nên có một đoạn ngắn nêu lý do lựa chọn công nghệ, thể hiện tư duy kiến trúc:

| Tiêu chí | Docker Swarm | Kubernetes |
|---|---|---|
| Độ phức tạp | Đơn giản, tích hợp sẵn trong Docker Engine | Phức tạp hơn, cần học riêng (kubectl, YAML phong phú) |
| Hệ sinh thái | Nhỏ hơn | Rất lớn (Helm, Operator, CRD, service mesh...) |
| Autoscaling | Cơ bản | Mạnh (HPA, VPA, Cluster Autoscaler) |
| Khi nào chọn | Team nhỏ, hạ tầng đơn giản, muốn nhanh gọn | Hệ thống lớn, cần khả năng mở rộng và ecosystem phong phú |

---

## PHẦN B — HƯỚNG DẪN LÀM LAB THỰC HÀNH MỚI

Mỗi lab dưới đây nêu **mục tiêu**, **các bước triển khai** và **cách kiểm chứng kết quả** (để bạn tự chụp lại log/output đưa vào báo cáo, giống format các lab hiện có).

### Lab 1 — BuildKit: Secret Mount khi build

**Mục tiêu:** Chứng minh cách dùng secret đúng (không lộ vào layer) so với cách dùng sai (ARG/ENV).

**Các bước:**
1. Tạo file `token.txt` chứa 1 chuỗi giả lập token.
2. Viết 2 Dockerfile:
   - `Dockerfile.sai`: dùng `ARG TOKEN` rồi `RUN echo $TOKEN > /tmp/x` (cách sai).
   - `Dockerfile.dung`: dùng `RUN --mount=type=secret,id=token cat /run/secrets/token`.
3. Build cả hai:
   ```bash
   docker build -f Dockerfile.sai --build-arg TOKEN=$(cat token.txt) -t demo-sai .
   docker build -f Dockerfile.dung --secret id=token,src=token.txt -t demo-dung .
   ```
4. Kiểm chứng: chạy `docker history demo-sai` và `docker history demo-dung`, so sánh xem token có xuất hiện trong layer/history của bản nào.

**Kỳ vọng đưa vào báo cáo:** ảnh chụp `docker history` cho thấy `demo-sai` lộ token trong layer, còn `demo-dung` thì không.

---

### Lab 2 — Hardening container (bảo mật)

**Mục tiêu:** So sánh hành vi 1 ứng dụng chạy dưới 2 cấu hình bảo mật khác nhau.

**Các bước:**
1. Chạy container cấu hình "lỏng lẻo" (mặc định, root, full capability):
   ```bash
   docker run -d --name loose nginx
   docker exec loose sh -c "echo test > /etc/malicious_test"
   ```
2. Chạy container "hardened":
   ```bash
   docker run -d --name hardened \
     --cap-drop=ALL \
     --security-opt no-new-privileges \
     --read-only --tmpfs /tmp \
     --user 1000:1000 \
     nginx
   docker exec hardened sh -c "echo test > /etc/malicious_test"
   ```
3. Kiểm chứng: quan sát lệnh ghi file ở bước 2 sẽ báo lỗi "Read-only file system" hoặc "Permission denied", trong khi container ở bước 1 ghi thành công.

**Kỳ vọng đưa vào báo cáo:** log lỗi ghi file bị chặn, và bảng so sánh capability bằng `docker inspect --format '{{.HostConfig.CapDrop}}'`.

---

### Lab 3 — Swarm Secrets thay cho biến môi trường

**Mục tiêu:** Nâng cấp bảo mật cho Full Stack Lab 2 đã làm (Frontend+Backend+DB+Redis).

**Các bước:**
1. Tạo secret cho mật khẩu DB:
   ```bash
   echo "MyStrongPass123" | docker secret create db_password -
   ```
2. Sửa compose stack: bỏ `DB_PASSWORD` khỏi `environment:`, thêm block `secrets:` cho service backend/db, ứng dụng đọc mật khẩu từ file `/run/secrets/db_password` thay vì biến môi trường.
3. Deploy lại: `docker stack deploy -c compose.yaml my_stack`.
4. Kiểm chứng:
   ```bash
   docker service inspect my_stack_backend | grep -i password   # không thấy gì
   docker exec <container_id> cat /run/secrets/db_password       # thấy mật khẩu
   ```

**Kỳ vọng đưa vào báo cáo:** đối chiếu output `docker service inspect` trước/sau khi chuyển sang Secret, chứng minh mật khẩu không còn lộ trong inspect.

---

### Lab 4 — Giới hạn tài nguyên & OOM Killer

**Mục tiêu:** Quan sát trực tiếp hành vi kernel OOM Killer khi container vượt giới hạn RAM.

**Các bước:**
1. Chạy container giới hạn RAM thấp với công cụ stress-ng:
   ```bash
   docker run -d --name oom-test --memory=100m polinux/stress-ng \
     stress-ng --vm 1 --vm-bytes 300M --timeout 30s
   ```
2. Theo dõi: `docker stats oom-test` trong lúc chạy.
3. Sau khi container bị kill, kiểm tra:
   ```bash
   docker inspect oom-test --format '{{.State.OOMKilled}}'   # true
   docker inspect oom-test --format '{{.State.ExitCode}}'
   ```

**Kỳ vọng đưa vào báo cáo:** ảnh chụp `docker stats` lúc RAM tiệm cận giới hạn, và kết quả `OOMKilled: true`.

---

### Lab 5 — Logging driver & rotation

**Mục tiêu:** Cấu hình giới hạn dung lượng log, tránh log làm đầy ổ đĩa.

**Các bước:**
1. Thêm cấu hình logging vào 1 service trong compose:
   ```yaml
   services:
     api:
       logging:
         driver: json-file
         options:
           max-size: "5m"
           max-file: "3"
   ```
2. Tạo tải để sinh log liên tục (vòng lặp gọi API hoặc dùng `yes` trong container test).
3. Kiểm chứng: tìm file log thật trên host:
   ```bash
   docker inspect --format '{{.LogPath}}' <container_id>
   ls -lh $(docker inspect --format '{{.LogPath}}' <container_id>)*
   ```
   Xác nhận file log không vượt quá `max-size` và số file rotate không vượt `max-file`.

**Kỳ vọng đưa vào báo cáo:** danh sách file log đã rotate (`.1`, `.2`...) và dung lượng từng file.

---

### Lab 6 — Node Placement Constraint trong Swarm

**Mục tiêu:** Ghim service vào đúng node theo đặc tính phần cứng, tận dụng cluster 6 node đã dựng.

**Các bước:**
1. Gắn label cho 1 worker node:
   ```bash
   docker node update --label-add disk=ssd worker1
   ```
2. Sửa service backend trong compose/stack, thêm constraint:
   ```yaml
   deploy:
     placement:
       constraints:
         - node.labels.disk == ssd
   ```
3. Deploy lại và kiểm chứng vị trí chạy thực tế:
   ```bash
   docker service ps my_stack_backend
   ```
   Xác nhận tất cả replica của backend đều nằm trên `worker1`.

**Kỳ vọng đưa vào báo cáo:** output `docker service ps` cho thấy container chỉ chạy trên node có label `disk=ssd`.

---

### Lab 7 — Rolling Update thất bại có kiểm soát (auto-rollback)

**Mục tiêu:** Quan sát Swarm tự động rollback khi bản update mới bị lỗi, không cần can thiệp thủ công.

**Các bước:**
1. Thêm cấu hình auto-rollback vào service:
   ```yaml
   deploy:
     update_config:
       order: start-first
       failure_action: rollback
       monitor: 10s
     rollback_config:
       order: stop-first
   ```
   Đảm bảo service có `healthcheck` hợp lệ (dùng lại cấu hình đã có ở Lab Full Stack).
2. Cố ý build 1 image lỗi (ví dụ sai port trong HEALTHCHECK khiến healthcheck luôn fail), push lên registry nội bộ đã dựng.
3. Update service với image lỗi:
   ```bash
   docker service update --image myregistry/backend:broken my_stack_backend
   ```
4. Kiểm chứng: theo dõi `docker service ps my_stack_backend` — thấy Swarm tự phát hiện container mới unhealthy và tự rollback về image cũ mà không cần gọi `docker service rollback` thủ công.

**Kỳ vọng đưa vào báo cáo:** log `docker service ps` thể hiện trạng thái container mới "Rejected/Shutdown" rồi tự quay về image version cũ.

---

### Lab 8 — Hoàn thiện RabbitMQ Cluster Lab (đang bỏ trống trong báo cáo hiện tại)

**Mục tiêu:** Bổ sung nội dung cho mục "COMPOSE LAB 3: RabbitMQ Cluster" hiện chỉ có tiêu đề.

**Các bước:**
1. Dựng cụm RabbitMQ 3 node bằng Docker Compose (dùng plugin `rabbitmq_peer_discovery_classic_config` hoặc join thủ công bằng `rabbitmqctl join_cluster`).
2. Tạo 1 **quorum queue** (khuyến nghị thay cho classic mirrored queue vì bền vững hơn với Raft-based replication):
   ```bash
   rabbitmqctl -n rabbit@node1 add_user testuser testpass
   # khai báo queue kiểu quorum qua management UI hoặc CLI
   ```
3. Test failover: publish message liên tục, sau đó `docker stop` node đang là leader của queue.
4. Kiểm chứng: message không mất, cluster tự bầu leader mới cho quorum queue, consumer vẫn nhận được message bình thường sau vài giây gián đoạn.

**Kỳ vọng đưa vào báo cáo:** ảnh chụp `rabbitmqctl cluster_status`, và log consumer cho thấy message vẫn được xử lý liên tục qua quá trình failover.

---

### Lab 9 — Disaster Recovery: Mất Quorum trong Swarm

**Mục tiêu:** Quan sát hành vi cluster khi mất quorum và cách backup/restore trạng thái Manager.

**Các bước:**
1. Trên cụm 3 Manager đã dựng, backup trạng thái Swarm của 1 manager:
   ```bash
   docker swarm ca --rotate   # (tuỳ chọn) xoay CA trước khi backup để test
   systemctl stop docker      # dừng daemon trước khi copy để đảm bảo consistency
   tar -czvf swarm-backup.tar.gz /var/lib/docker/swarm
   systemctl start docker
   ```
2. Cố ý tắt 2/3 Manager (mất quorum vì chỉ còn 1/3 < 50%):
   ```bash
   docker node update --availability drain manager-2   # hoặc tắt hẳn VM
   ```
3. Thử tạo service mới trên Manager còn sống → quan sát lệnh bị treo/từ chối do cluster ở trạng thái read-only.
4. Bật lại các Manager đã tắt, xác nhận cluster phục hồi quorum và có thể tạo service trở lại.
5. (Tuỳ chọn nâng cao) Test restore: dựng 1 Manager mới hoàn toàn từ file backup ở bước 1 để mô phỏng khôi phục sau sự cố toàn bộ cluster.

**Kỳ vọng đưa vào báo cáo:** log lỗi khi cố tạo service lúc mất quorum, và log xác nhận cluster hoạt động lại bình thường sau khi khôi phục đủ Manager.

---

## GỢI Ý THỨ TỰ ƯU TIÊN

Nếu thời gian có hạn, nên làm theo thứ tự ưu tiên sau (từ dễ/nhanh → khó/tốn thời gian):

1. Lab 4 (OOM) — nhanh, dễ, minh hoạ rõ cgroups
2. Lab 5 (Logging) — nhanh, dễ
3. Lab 2 (Hardening) — trung bình
4. Lab 3 (Swarm Secrets) — trung bình, tận dụng lại Lab 2 cũ
5. Lab 6 (Placement) — trung bình, tận dụng lại cluster 6 node đã có
6. Lab 1 (BuildKit secret) — trung bình
7. Lab 7 (Rolling update rollback) — khó hơn, cần chuẩn bị 2 version image
8. Lab 8 (RabbitMQ) — khó, cần thời gian dựng cluster riêng
9. Lab 9 (Disaster Recovery) — khó nhất, cần thao tác cẩn thận trên cluster thật
