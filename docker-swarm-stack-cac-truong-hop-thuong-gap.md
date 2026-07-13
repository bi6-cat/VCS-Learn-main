# Các Trường Hợp Hay Gặp Khi Làm Việc Với Docker Swarm Stack

Tài liệu này tổng hợp các tình huống thường gặp khi triển khai ứng dụng bằng Docker Swarm Stack, đặc biệt trong mô hình lab gồm nhiều manager/worker, registry nội bộ và Redis chạy ngoài Swarm.

Mục tiêu là giúp nhận biết nhanh:

- Hiện tượng đang gặp là gì.
- Nguyên nhân thường đến từ đâu.
- Dùng lệnh nào để kiểm tra.
- Cách xử lý phù hợp.

---

## 1. `docker stack deploy` Không Tự Build Image

### Hiện tượng

Khi deploy stack, service không chạy được hoặc báo lỗi không tìm thấy image:

```text
No such image
image could not be accessed on a registry
```

### Giải thích

Khác với `docker compose up`, Docker Swarm Stack không dùng `build:` để build image trực tiếp trên cluster. Stack cần image đã tồn tại sẵn ở registry hoặc đã có trên tất cả node.

Ví dụ trong stack:

```yaml
services:
  backend:
    image: 192.168.56.30:5000/fullstack-backend:1.0.1
```

Swarm sẽ yêu cầu các node pull image này từ registry.

### Cách xử lý

Build và push image trước khi deploy:

```bash
export REGISTRY=192.168.56.30:5000
export APP_VERSION=1.0.1

docker build -t $REGISTRY/fullstack-backend:$APP_VERSION ./backend
docker build -t $REGISTRY/fullstack-frontend:$APP_VERSION ./frontend

docker push $REGISTRY/fullstack-backend:$APP_VERSION
docker push $REGISTRY/fullstack-frontend:$APP_VERSION

docker stack deploy -c docker-stack.prod.yml fullstack
```

---

## 2. Worker Không Pull Được Image Từ Registry Nội Bộ

### Hiện tượng

Trong `docker stack ps` thấy task bị `Rejected`:

```text
Rejected "No such image: 192.168.56.30:5000/fullstack-backend:1.0.1"
```

Hoặc khi push/pull:

```text
http: server gave HTTP response to HTTPS client
```

### Giải thích

Registry nội bộ trong lab thường chạy HTTP, ví dụ:

```text
192.168.56.30:5000
```

Trong khi Docker mặc định muốn dùng HTTPS. Vì vậy tất cả node cần được cấu hình tin registry HTTP này.

### Cách kiểm tra

Trên từng node Swarm:

```bash
docker info | grep -A 5 "Insecure Registries"
```

Cần thấy:

```text
192.168.56.30:5000
```

Kiểm tra registry sống:

```bash
curl http://192.168.56.30:5000/v2/
```

Kỳ vọng:

```json
{}
```

### Cách xử lý

Trên tất cả node Swarm, sửa `/etc/docker/daemon.json`:

```json
{
  "insecure-registries": ["192.168.56.30:5000"]
}
```

Restart Docker:

```bash
sudo systemctl restart docker
```

Test pull:

```bash
docker pull 192.168.56.30:5000/fullstack-backend:1.0.1
```

---

## 3. `docker stack ps` Có Nhiều Dòng `Shutdown`, `Rejected`, `Failed`

### Hiện tượng

Khi xem task:

```bash
docker stack ps fullstack
```

thấy nhiều dòng dạng:

```text
\_ fullstack_backend.3   Shutdown   Rejected
\_ fullstack_frontend.2  Shutdown   Failed
```

### Giải thích

Swarm giữ lại lịch sử task cũ để debug. Dòng có dấu `\_` thường là task cũ đã bị thay thế. Điều này không nhất thiết nghĩa là service hiện tại đang lỗi.

Ví dụ:

```text
fullstack_backend.3       Running
\_ fullstack_backend.3    Shutdown Rejected
```

Nghĩa là task cũ của slot số 3 đã lỗi, nhưng Swarm đã tạo task mới thay thế và task mới đang chạy.

### Cách kiểm tra trạng thái hiện tại

```bash
docker stack services fullstack
docker stack ps fullstack --filter desired-state=running
```

Nếu thấy:

```text
fullstack_backend    4/4
fullstack_frontend   3/3
```

thì hiện tại service đã đạt desired state.

---

## 4. Replica Nhiều Hơn Số Worker

### Hiện tượng

Cluster có 3 worker nhưng backend đặt 4 replicas:

```yaml
deploy:
  replicas: 4
```

### Giải thích

Một worker có thể chạy nhiều replica của cùng một service. Swarm không bắt buộc mỗi node chỉ chạy một replica.

Ví dụ phân bố hợp lệ:

```text
swarm-worker1: backend.1
swarm-worker2: backend.2, backend.3
swarm-worker3: backend.4
```

Miễn node còn đủ CPU/RAM, Swarm có thể xếp nhiều container lên cùng một worker.

### Nếu muốn giới hạn mỗi node chỉ chạy 1 replica

```yaml
deploy:
  replicas: 3
  placement:
    max_replicas_per_node: 1
```

Nếu có 3 worker nhưng đặt 4 replicas và `max_replicas_per_node: 1`, replica thứ 4 sẽ bị `Pending`.

---

## 5. Service Không Chạy Đủ Replicas

### Hiện tượng

```text
fullstack_backend    2/4
```

hoặc:

```text
fullstack_frontend   1/3
```

### Nguyên nhân thường gặp

- Worker không pull được image.
- Container start lỗi.
- Healthcheck fail.
- Placement constraint sai.
- Node thiếu tài nguyên.
- Node bị `Drain`.

### Cách kiểm tra

```bash
docker service ps fullstack_backend --no-trunc
docker service logs fullstack_backend --tail 100
docker service inspect fullstack_backend --pretty
docker node ls
```

### Cách đọc nhanh

Nếu `ERROR` là:

```text
No such image
```

thì kiểm tra registry/pull image.

Nếu là:

```text
task: non-zero exit (1)
```

thì container crash, cần xem log service.

Nếu task `Pending`, kiểm tra placement/resource.

---

## 6. Placement Constraint Sai Làm Task Bị Pending

### Ví dụ

```yaml
deploy:
  placement:
    constraints:
      - node.labels.zone == zone-a
```

### Giải thích

Service chỉ được chạy trên node có label:

```text
zone=zone-a
```

Nếu không node nào có label này, task sẽ không được xếp lịch.

### Kiểm tra label

```bash
docker node inspect swarm-worker1 --pretty
```

### Gắn label

```bash
docker node update --label-add zone=zone-a swarm-worker1
docker node update --label-add zone=zone-b swarm-worker2
docker node update --label-add zone=zone-c swarm-worker3
```

---

## 7. `depends_on` Không Đảm Bảo Service Sẵn Sàng Trong Swarm

### Giải thích

Trong Docker Compose thường, `depends_on` giúp xác định thứ tự start container. Nhưng trong Docker Swarm Stack, `depends_on` không đảm bảo dependency đã sẵn sàng.

Ví dụ backend có thể start trước Redis hoặc frontend có thể start trước backend DNS sẵn sàng.

### Cách thiết kế đúng

Ứng dụng cần tự retry dependency:

```text
backend -> retry connect Redis
frontend/nginx -> resolve backend linh hoạt
```

Backend nên có retry khi connect Redis. Healthcheck nên phản ánh tình trạng thật của app.

---

## 8. Frontend Không Resolve Được Backend

### Hiện tượng

Log nginx:

```text
host not found in upstream "backend:3000"
```

### Giải thích

Nginx resolve upstream ngay lúc start. Nếu Docker DNS/service backend chưa sẵn sàng trong khoảnh khắc đó, frontend container có thể crash.

### Cấu hình tốt hơn cho Swarm

Trong `nginx.conf`:

```nginx
resolver 127.0.0.11 valid=10s ipv6=off;

location /api/ {
    set $backend_api http://backend:3000;
    proxy_pass $backend_api;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

`127.0.0.11` là Docker DNS nội bộ trong container.

---

## 9. Gọi Một Node Được, Node Khác Không Được

### Hiện tượng

```bash
curl http://192.168.56.21:8080
# 200 OK

curl http://192.168.56.11:8080
# treo hoặc timeout
```

### Giải thích

Nếu service đang Running đủ replicas, lỗi thường nằm ở node nhận request, routing mesh, firewall hoặc gossip/overlay network.

### Kiểm tra

```bash
docker node ls
sudo ufw status
sudo journalctl -u docker --no-pager -n 100
```

Kiểm tra port cần thiết:

```text
2377/tcp  - Swarm management
7946/tcp  - gossip
7946/udp  - gossip
4789/udp  - overlay VXLAN
8080/tcp  - published app port
```

### Xử lý nhanh trong lab

Trên node bị lỗi:

```bash
sudo systemctl restart docker
```

Nếu dùng UFW trong lab nội bộ:

```bash
sudo ufw disable
```

---

## 10. Routing Mesh Mở Published Port Trên Mọi Node

### Ví dụ

```yaml
ports:
  - target: 80
    published: 8080
    protocol: tcp
    mode: ingress
```

### Giải thích

Với `mode: ingress`, Swarm Routing Mesh mở port `8080` trên mọi node trong cluster.

Có thể gọi:

```text
http://192.168.56.11:8080
http://192.168.56.21:8080
http://192.168.56.22:8080
```

Dù node đó không chạy frontend replica, Swarm vẫn route request tới một replica đang chạy.

---

## 11. Có Bị Trùng Port Khi Nhiều Replica Không?

### Giải thích

Mặc định không bị trùng port vì port publish ở cấp service, không phải từng container bind trực tiếp lên host.

Ví dụ:

```yaml
frontend:
  deploy:
    replicas: 3
  ports:
    - target: 80
      published: 8080
      mode: ingress
```

Swarm chỉ publish port `8080` cho service, còn các container frontend listen port `80` bên trong network riêng của chúng.

### Khi nào dễ trùng port?

Khi dùng `mode: host`:

```yaml
ports:
  - target: 80
    published: 8080
    mode: host
```

Nếu nhiều replica cùng chạy trên một node và cùng bind `8080`, sẽ xảy ra xung đột.

---

## 12. Stateful Service Như Redis Chạy Trong Swarm Dễ Mất Dữ Liệu

### Vấn đề

Named volume local chỉ nằm trên node đang chạy container.

Nếu Redis chạy trên `swarm-worker1` và lưu data bằng local volume, khi task bị chuyển sang `swarm-worker2`, dữ liệu cũ không tự đi theo.

### Cách xử lý

Các hướng thường dùng:

- Chạy Redis ngoài Swarm trên VM riêng.
- Pin Redis vào một node bằng placement constraint.
- Dùng storage dùng chung.
- Dùng Redis Sentinel/Cluster hoặc managed Redis.

Trong lab hiện tại:

```text
Redis external: 192.168.56.30:6379
```

Backend kết nối Redis qua biến môi trường:

```yaml
environment:
  REDIS_HOST: 192.168.56.30
  REDIS_PORT: 6379
```

---

## 13. Rolling Update Không Thấy Thay Đổi

### Nguyên nhân

Hay gặp nhất là dùng lại cùng một image tag:

```text
latest
1.0.0
```

Docker node có thể đã cache image cũ, khiến update không như mong đợi.

### Cách làm tốt

Mỗi lần update nên dùng tag mới:

```bash
export APP_VERSION=1.0.2

docker build -t 192.168.56.30:5000/fullstack-backend:$APP_VERSION ./backend
docker build -t 192.168.56.30:5000/fullstack-frontend:$APP_VERSION ./frontend

docker push 192.168.56.30:5000/fullstack-backend:$APP_VERSION
docker push 192.168.56.30:5000/fullstack-frontend:$APP_VERSION
```

Deploy:

```bash
REGISTRY=192.168.56.30:5000 \
APP_VERSION=1.0.2 \
REDIS_HOST=192.168.56.30 \
docker stack deploy -c docker-stack.prod.yml fullstack
```

---

## 14. Healthcheck Fail Và Rollback

### Ví dụ cấu hình

```yaml
deploy:
  update_config:
    parallelism: 2
    delay: 10s
    order: start-first
    failure_action: rollback
    monitor: 30s
    max_failure_ratio: 0.25
```

### Giải thích

Khi update, Swarm tạo task mới. Nếu task mới không healthy hoặc crash vượt ngưỡng cho phép, Swarm rollback về version trước.

### Kiểm tra

```bash
docker service ps fullstack_backend --no-trunc
docker service inspect fullstack_backend --pretty
docker service logs fullstack_backend --tail 100
```

---

## 15. Manager Cũng Có Thể Chạy Container

### Giải thích

Trong Docker Swarm, manager mặc định vẫn có thể chạy workload nếu `Availability=Active`.

Kiểm tra:

```bash
docker node ls
```

Nếu manager là `Active`, scheduler có thể xếp task lên manager.

### Production thường làm gì?

Để manager chỉ quản lý cluster, không chạy app:

```bash
docker node update --availability drain swarm-manager1
docker node update --availability drain swarm-manager2
docker node update --availability drain swarm-manager3
```

Trong lab, có thể để manager `Active` để dễ quan sát.

---

## 16. Mất Quorum Manager

### Giải thích

Swarm manager dùng Raft consensus. Với 3 manager, cần ít nhất 2 manager sống để cluster nhận thay đổi mới.

Nếu chỉ còn 1/3 manager:

```text
Container đang chạy vẫn tiếp tục chạy.
Nhưng không deploy/scale/update được service.
```

### Kiểm tra

```bash
docker node ls
```

Nếu mất quorum, các lệnh thay đổi cluster có thể treo hoặc báo:

```text
context deadline exceeded
```

---

## 17. Scale Service

### Tăng replica

```bash
docker service scale fullstack_backend=6
```

### Giảm replica

```bash
docker service scale fullstack_backend=2
```

### Kiểm tra

```bash
docker service ps fullstack_backend
docker stack services fullstack
```

Swarm sẽ tự tạo thêm hoặc dừng bớt task để đạt desired state.

---

## 18. Drain Node Để Test Self-Healing

### Drain worker

```bash
docker node update --availability drain swarm-worker2
```

### Giải thích

Swarm sẽ không xếp task mới lên node này và sẽ di chuyển task hiện có sang node khác.

### Kiểm tra

```bash
docker stack ps fullstack --filter desired-state=running
curl http://192.168.56.21:8080/api/visits
```

### Khôi phục

```bash
docker node update --availability active swarm-worker2
```

---

## 19. Xóa Stack Nhưng Volume Vẫn Còn

### Xóa stack

```bash
docker stack rm fullstack
```

### Giải thích

Docker thường không tự xóa volume để tránh mất dữ liệu ngoài ý muốn.

Kiểm tra volume:

```bash
docker volume ls
```

Nếu chắc chắn không cần nữa mới xóa thủ công.

---

## 20. Lệnh Debug Nên Nhớ

### Cluster

```bash
docker node ls
docker node inspect <node> --pretty
```

### Stack

```bash
docker stack services fullstack
docker stack ps fullstack
docker stack ps fullstack --filter desired-state=running
```

### Service

```bash
docker service ps fullstack_backend --no-trunc
docker service logs fullstack_backend --tail 100
docker service inspect fullstack_backend --pretty
docker service update --force fullstack_backend
```

### Registry

```bash
curl http://192.168.56.30:5000/v2/
curl http://192.168.56.30:5000/v2/fullstack-backend/tags/list
curl http://192.168.56.30:5000/v2/fullstack-frontend/tags/list
```

### Redis

```bash
redis-cli -h 192.168.56.30 -a 'ChangeMe_StrongPassword_123' ping
redis-cli -h 192.168.56.30 -a 'ChangeMe_StrongPassword_123' get visits
```

### App

```bash
curl -I http://192.168.56.21:8080
curl http://192.168.56.21:8080/api/visits
```

---

## Tổng Kết

Khi làm việc với Docker Swarm Stack, cần nhớ các nguyên tắc quan trọng:

1. Stack không tự build image, phải build và push image trước.
2. Tất cả node phải pull được image từ registry.
3. `docker stack ps` hiển thị cả lịch sử task cũ, không chỉ task đang chạy.
4. Một node có thể chạy nhiều replica.
5. Service stateless phù hợp với Swarm hơn stateful service.
6. Redis/database nên được tách ra ngoài Swarm hoặc dùng giải pháp storage/HA phù hợp.
7. Routing Mesh cho phép gọi vào bất kỳ node nào, nhưng phụ thuộc vào network/iptables/firewall của từng node.
8. Healthcheck, rolling update và rollback giúp deploy an toàn hơn.
9. Manager cần quorum để cluster nhận thay đổi mới.
10. Debug Swarm nên bắt đầu từ `docker node ls`, `docker stack services`, `docker service ps --no-trunc` và service logs.

