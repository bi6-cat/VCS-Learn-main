# PHẦN 3: LÝ THUYẾT DOCKER SWARM

## 3.1. Tổng quan

Docker Swarm là công cụ **orchestration** (điều phối container) được tích hợp sẵn trong Docker Engine. Nó biến nhiều máy Docker đơn lẻ thành **một cluster thống nhất**, cho phép triển khai, scale, tự phục hồi và quản lý service trên nhiều node.

Với Docker Swarm, ta không chỉ chạy container trên một máy duy nhất nữa, mà có thể triển khai ứng dụng phân tán trên nhiều máy, nhưng vẫn giữ được cách dùng quen thuộc của Docker và Docker Compose.

Docker Swarm không cần cài thêm thành phần phức tạp. Nó là một **mode có sẵn trong Docker Engine**.

```bash
docker swarm init
```

Lệnh trên biến Docker Engine hiện tại thành một Swarm Manager đầu tiên.

### Tại sao cần Swarm khi đã có Compose?

Docker Compose rất tiện để chạy nhiều container trên một máy, ví dụ chạy web, database, Redis, RabbitMQ trong môi trường local hoặc server nhỏ. Tuy nhiên, Compose không được thiết kế để điều phối ứng dụng trên nhiều máy.

Docker Swarm giải quyết bài toán đó bằng cách gom nhiều máy thành một cluster, sau đó triển khai service lên toàn cluster.

| Docker Compose | Docker Swarm |
|---|---|
| Chạy trên 1 máy duy nhất | Chạy trên nhiều máy thành 1 cluster |
| Container chết thì thường chỉ restart trên chính máy đó | Self-healing: scheduler tự tạo container thay thế, có thể trên node khác |
| Không có khái niệm service phân tán | Có Service: khai báo số replica mong muốn, Swarm tự phân phối |
| Load balancing giữa container phải tự dựng thêm | Có Routing Mesh và load balancing tích hợp |
| Update thường phải down/up lại, dễ có downtime | Hỗ trợ rolling update, có thể zero-downtime |
| Không có cơ chế bầu lại máy điều phối chính | Dùng Raft consensus để bầu lại Manager Leader |
| Phù hợp local/dev hoặc single-server | Phù hợp môi trường nhiều node, HA, scale cơ bản |

### Các khái niệm cốt lõi trong Swarm

| Khái niệm | Ý nghĩa |
|---|---|
| Cluster | Tập hợp nhiều máy Docker hoạt động như một hệ thống thống nhất |
| Node | Một máy tham gia vào Swarm cluster |
| Manager | Node quản lý cluster, lập lịch service, lưu cluster state |
| Worker | Node chạy container theo lệnh từ Manager |
| Service | Đơn vị triển khai chính trong Swarm |
| Task | Một lần thực thi cụ thể của service, thường tương ứng với một container |
| Replica | Số bản sao của service cần chạy |
| Overlay network | Mạng ảo giúp container ở nhiều node khác nhau giao tiếp với nhau |
| Routing Mesh | Cơ chế route request vào đúng service dù request đi vào node nào |

---

## 3.2. Kiến trúc Cluster: Manager & Worker

Docker Swarm cluster gồm nhiều node. Mỗi node là một máy có Docker Engine và đã tham gia vào Swarm.

Trong Swarm có hai loại node chính:

- **Manager**
- **Worker**

### Manager node

Manager là node chịu trách nhiệm quản lý cluster.

Manager làm các việc quan trọng như:

- Lưu trạng thái cluster.
- Nhận lệnh tạo, sửa, xóa service.
- Quyết định service nào chạy ở node nào.
- Theo dõi trạng thái task/container.
- Tạo task mới khi task cũ chết.
- Tham gia Raft consensus để đồng bộ trạng thái giữa các Manager.

Manager có thể vừa quản lý cluster vừa chạy container. Đây là hành vi mặc định của Docker Swarm.

Trong môi trường production lớn, người ta có thể cấu hình Manager chỉ làm nhiệm vụ quản lý, không chạy workload, bằng cách đặt node đó về trạng thái `drain`.

```bash
docker node update --availability drain manager-1
```

### Worker node

Worker là node chuyên chạy container.

Worker không tự quyết định service nào được chạy. Nó nhận nhiệm vụ từ Manager, sau đó thực thi task được giao.

Worker làm các việc như:

- Pull image.
- Tạo container.
- Chạy container.
- Báo trạng thái container về Manager.

Worker **không lưu cluster state đầy đủ** và **không tham gia quyết định điều phối**.

### Sơ đồ tư duy đơn giản

```text
Swarm Cluster
│
├── Manager 1 (Leader)
├── Manager 2 (Follower)
├── Manager 3 (Follower)
│
├── Worker 1
├── Worker 2
└── Worker 3
```

Manager ra quyết định. Worker chạy container.

Nếu có nhiều Manager, một Manager sẽ được bầu làm **Leader**. Các Manager còn lại là **Follower**.

---

## 3.3. Thuật toán Raft

Raft là một thuật toán đồng thuận được thiết kế để quản lý các bản ghi được nhân bản trên hệ thống phân tán.

Trong Docker Swarm, Raft giúp nhiều Manager cùng thống nhất về trạng thái của cluster.

Ví dụ cluster state bao gồm:

- Service nào đang tồn tại.
- Mỗi service có bao nhiêu replica.
- Network nào đã được tạo.
- Secret/config nào đang được quản lý.
- Node nào đang active, down, drain.
- Task nào đang chạy, task nào đã fail.

Nếu cluster có nhiều Manager, các Manager cần thống nhất với nhau về những thông tin trên. Raft đảm bảo cluster có một nguồn sự thật chung.

### Ba trạng thái của một node trong Raft

Trong một cụm chạy Raft, tại một thời điểm, mỗi Manager có thể nằm trong một trong ba trạng thái sau:

| Trạng thái | Ý nghĩa |
|---|---|
| Leader | Manager chính, nhận yêu cầu ghi, ra quyết định và đồng bộ log xuống các Manager khác |
| Follower | Manager thụ động, nhận log từ Leader và phản hồi lại |
| Candidate | Trạng thái tạm thời khi Follower không thấy Leader và tự ứng cử để trở thành Leader mới |

### Leader

Leader là Manager đang giữ quyền điều phối chính.

Khi bạn chạy lệnh như:

```bash
docker service create --name web nginx
```

Yêu cầu này sẽ được xử lý thông qua Manager Leader. Leader ghi quyết định vào Raft log, sau đó đồng bộ sang các Manager khác.

### Follower

Follower không tự ra quyết định. Nó nhận log từ Leader và lưu lại trạng thái giống Leader.

Nếu Leader chết, các Follower có thể tham gia bầu cử để chọn Leader mới.

### Candidate

Candidate xuất hiện khi một Follower không nhận được tín hiệu từ Leader trong một khoảng thời gian.

Khi đó, nó chuyển sang trạng thái Candidate và yêu cầu các Manager khác bỏ phiếu cho mình.

Nếu nhận được đa số phiếu, Candidate trở thành Leader mới.

### Vì sao nên dùng số lẻ Manager?

Swarm cần đa số Manager đồng ý để xác nhận một thay đổi. Đa số này gọi là quorum.

Vì vậy, số lượng Manager nên là số lẻ: 1, 3, 5 hoặc 7.

| Số Manager | Số Manager có thể mất mà cluster vẫn còn quorum |
|---|---|
| 1 | 0 |
| 3 | 1 |
| 5 | 2 |
| 7 | 3 |

Không nên dùng số chẵn Manager. Ví dụ 4 Manager vẫn chỉ chịu mất được 1 Manager nếu muốn giữ quorum, tương tự 3 Manager, nhưng lại tốn thêm một máy.

---

## 3.4. Quorum

Quorum là điều kiện **đa số Manager còn sống và đồng ý**.

Một quyết định, ví dụ tạo service mới, update service, scale service, chỉ được xác nhận khi đa số Manager ghi nhận thay đổi đó vào Raft log.

Công thức dễ nhớ:

```text
Quorum = hơn 50% số Manager
```

Ví dụ:

| Số Manager | Cần tối thiểu bao nhiêu Manager sống để có quorum |
|---|---|
| 1 | 1 |
| 3 | 2 |
| 5 | 3 |
| 7 | 4 |

### Khi cluster còn quorum

Cluster vẫn hoạt động bình thường.

Bạn có thể:

- Tạo service mới.
- Xóa service.
- Scale service.
- Update image.
- Thay đổi network, secret, config.
- Thêm hoặc xóa node.

### Khi cluster mất quorum

Cluster chuyển sang trạng thái gần như read-only.

Container đang chạy **vẫn tiếp tục chạy**, nhưng bạn không thể thực hiện các thay đổi mới đối với cluster.

Ví dụ, các thao tác sau có thể bị lỗi hoặc bị treo:

```bash
docker service create
docker service update
docker service scale
docker node update
```

Điểm quan trọng cần nhớ:

> Mất quorum không có nghĩa là container đang chạy bị tắt ngay. Nó có nghĩa là cluster không còn đủ Manager để thống nhất các quyết định mới.

---

## 3.5. Service: Đơn vị triển khai của Swarm

Service là đơn vị triển khai chính trong Docker Swarm.

Khi dùng Docker thường, bạn hay chạy container trực tiếp:

```bash
docker run -d --name web -p 8080:80 nginx
```

Nhưng trong Swarm, bạn không nên quản lý từng container riêng lẻ. Thay vào đó, bạn khai báo một Service:

```bash
docker service create \
  --name web \
  --replicas 3 \
  --publish 8080:80 \
  nginx
```

Lệnh trên có nghĩa là:

> Tôi muốn service tên `web`, chạy image `nginx`, có 3 bản sao, publish port 8080 ra ngoài.

Swarm sẽ tự quyết định:

- Tạo bao nhiêu container.
- Container chạy trên node nào.
- Nếu container chết thì tạo container mới ở đâu.
- Nếu scale lên/xuống thì thêm hoặc xóa container nào.
- Nếu update image thì thay container cũ bằng container mới như thế nào.

### Service vs Container

Sự khác biệt quan trọng nhất là:

| Container | Service |
|---|---|
| Là một tiến trình chạy cụ thể | Là khai báo trạng thái mong muốn |
| Thường nằm trên một node cụ thể | Có thể được phân phối trên nhiều node |
| Chết là kết thúc container đó | Swarm tạo task/container mới để thay thế |
| Quản lý bằng `docker run`, `docker stop`, `docker rm` | Quản lý bằng `docker service create`, `update`, `scale`, `rm` |
| Phù hợp chạy đơn lẻ | Phù hợp triển khai ứng dụng phân tán |

Với Swarm, tư duy quan trọng là **desired state**.

Bạn không nói:

> Hãy chạy container này trên máy này.

Bạn nói:

> Hãy đảm bảo service này luôn có 3 replica đang chạy.

Swarm sẽ tự xử lý phần còn lại.

### Service, Task và Container

Mối quan hệ giữa Service, Task và Container:

```text
Service
└── Task
    └── Container
```

Ví dụ service `web` có 3 replicas:

```text
Service: web
├── Task 1 -> Container nginx trên node-1
├── Task 2 -> Container nginx trên node-2
└── Task 3 -> Container nginx trên node-3
```

Nếu container trên `node-2` chết:

```text
Desired state: web cần 3 replicas
Current state: chỉ còn 2 replicas sống
Swarm action: tạo Task mới để quay lại đủ 3 replicas
```

Task trong Swarm có tính gần như immutable. Khi task lỗi hoặc chết, Swarm thường tạo task mới thay thế thay vì sửa task cũ.

### Replica là gì?

Replica là số bản sao của một service cần chạy.

Ví dụ:

```bash
docker service create --name api --replicas 5 my-api:1.0
```

Nghĩa là Swarm phải duy trì 5 container đang chạy cho service `api`.

Nếu một container chết, Swarm tạo container mới.

Nếu bạn scale xuống:

```bash
docker service scale api=2
```

Swarm sẽ giảm số replica từ 5 xuống 2.

Nếu bạn scale lên:

```bash
docker service scale api=10
```

Swarm sẽ tăng số replica lên 10.

---

## 3.6. Hai chế độ Service: Replicated và Global

Docker Swarm có hai kiểu service phổ biến:

- Replicated service
- Global service

### Replicated service

Đây là chế độ mặc định.

Bạn chỉ định số replica cụ thể, Swarm sẽ rải các replica đó lên các node phù hợp.

```bash
docker service create \
  --name web \
  --replicas 4 \
  nginx
```

Nếu cluster có 3 node, Swarm có thể phân phối như sau:

```text
node-1: 2 replicas
node-2: 1 replica
node-3: 1 replica
```

Replicated service phù hợp với:

- Web server.
- API service.
- Worker xử lý job.
- Service cần scale theo tải.

### Global service

Global service chạy đúng một task trên mỗi node phù hợp.

```bash
docker service create \
  --name node-exporter \
  --mode global \
  prom/node-exporter
```

Nếu cluster có 5 node, service sẽ có 5 task. Mỗi node có một task.

Global service phù hợp với:

- Monitoring agent.
- Log collector.
- Security agent.
- Metrics exporter.
- Các service cần chạy trên mọi node.

| Tiêu chí | Replicated | Global |
|---|---|---|
| Số lượng container | Do bạn khai báo bằng `--replicas` | Tự bằng số node phù hợp |
| Khi thêm node mới | Không nhất thiết có container mới | Tự chạy thêm 1 task trên node mới |
| Use case | Web, API, worker | Agent, exporter, log collector |

---

## 3.7. Scheduling trong Swarm

Scheduling là quá trình Manager quyết định task sẽ chạy trên node nào.

Khi tạo service, Swarm scheduler sẽ xem xét:

- Node nào đang active.
- Node nào còn tài nguyên.
- Node nào thỏa placement constraint.
- Service cần bao nhiêu replica.
- Có cần rải đều task hay không.
- Node nào đang ở trạng thái drain, pause hoặc active.

Ví dụ:

```bash
docker service create \
  --name api \
  --replicas 3 \
  --constraint node.role==worker \
  my-api:1.0
```

Service trên chỉ được chạy trên Worker node.

### Availability của node

Node trong Swarm có thể có ba trạng thái availability:

| Trạng thái | Ý nghĩa |
|---|---|
| active | Node có thể nhận task mới |
| pause | Node không nhận task mới, nhưng task cũ vẫn chạy |
| drain | Node không nhận task mới, task cũ sẽ bị di chuyển sang node khác |

Ví dụ drain một node trước khi bảo trì:

```bash
docker node update --availability drain worker-1
```

Swarm sẽ cố gắng di chuyển các task đang chạy trên `worker-1` sang node khác.

---

## 3.8. Self-healing

Self-healing là khả năng tự phục hồi của Swarm.

Nếu một container chết, Swarm tạo container mới.

Nếu một node chết, Swarm cố gắng chạy lại các task bị mất trên node khác còn sống.

Ví dụ service `web` cần 3 replicas:

```text
node-1: web.1
node-2: web.2
node-3: web.3
```

Nếu `node-2` chết:

```text
node-1: web.1
node-2: down
node-3: web.3
```

Swarm phát hiện chỉ còn 2 replicas sống, sau đó tạo replica thay thế:

```text
node-1: web.1
node-3: web.3
node-3: web.4
```

Miễn là còn node phù hợp và còn tài nguyên, Swarm sẽ cố đưa service về đúng desired state.

---

## 3.9. Networking trong Swarm

Trong Docker Compose thông thường, các container thường giao tiếp với nhau qua bridge network trên cùng một máy.

Trong Docker Swarm, container có thể nằm trên nhiều máy khác nhau. Vì vậy Swarm dùng **overlay network** để kết nối container xuyên node.

### Overlay network

Overlay network là mạng ảo trải qua nhiều Docker host.

Tạo overlay network:

```bash
docker network create \
  --driver overlay \
  app-net
```

Tạo service gắn vào overlay network:

```bash
docker service create \
  --name web \
  --network app-net \
  nginx
```

Các service trong cùng overlay network có thể gọi nhau bằng tên service.

Ví dụ service `api` gọi service `db`:

```text
postgres://db:5432
```

### Service discovery

Swarm có DNS nội bộ.

Khi một service được tạo, các service khác trong cùng network có thể gọi nó bằng tên service.

Ví dụ:

```bash
docker service create --name api --network app-net my-api:1.0
docker service create --name web --network app-net nginx
```

Service `web` có thể gọi `api` bằng hostname:

```text
http://api:3000
```

---

## 3.10. Routing Mesh và Load Balancing

Routing Mesh là cơ chế giúp request đi vào bất kỳ node nào trong cluster vẫn có thể được chuyển tới đúng service.

Ví dụ service `web` publish port 8080:

```bash
docker service create \
  --name web \
  --replicas 3 \
  --publish 8080:80 \
  nginx
```

Giả sử service `web` chỉ đang có container trên `node-1` và `node-2`, nhưng không có container trên `node-3`.

Bạn vẫn có thể gọi:

```text
http://node-3:8080
```

Swarm sẽ route request từ `node-3` tới một container `web` đang chạy ở node khác.

Đây là điểm rất khác so với Docker Compose thông thường.

### Ingress mode

Mặc định, publish port trong Swarm dùng `ingress mode`.

```bash
docker service create \
  --name web \
  --publish published=8080,target=80,mode=ingress \
  nginx
```

Với ingress mode, mọi node trong cluster đều lắng nghe port published.

### Host mode

Host mode chỉ publish port trên node thật sự chạy container.

```bash
docker service create \
  --name web \
  --publish published=8080,target=80,mode=host \
  nginx
```

Host mode phù hợp khi bạn muốn kiểm soát port ở từng node cụ thể hoặc dùng load balancer bên ngoài.

---

## 3.11. Rolling Update và Rollback

Swarm hỗ trợ rolling update để cập nhật service dần dần.

Ví dụ update image:

```bash
docker service update \
  --image my-api:2.0 \
  api
```

Swarm sẽ thay container cũ bằng container mới theo từng đợt, thay vì tắt toàn bộ service cùng lúc.

Bạn có thể cấu hình số container được update mỗi lần:

```bash
docker service create \
  --name api \
  --replicas 6 \
  --update-parallelism 2 \
  --update-delay 10s \
  my-api:1.0
```

Ý nghĩa:

- Mỗi lần update 2 task.
- Chờ 10 giây giữa các đợt update.
- Giảm nguy cơ downtime toàn bộ service.

Nếu update lỗi, có thể rollback:

```bash
docker service rollback api
```

Rollback đưa service quay lại cấu hình trước lần update gần nhất.

---

## 3.12. Placement Constraint

Placement constraint dùng để ép service chỉ chạy trên node thỏa điều kiện nhất định.

Ví dụ chỉ chạy trên worker:

```bash
docker service create \
  --name api \
  --constraint node.role==worker \
  my-api:1.0
```

Ví dụ chỉ chạy trên node có label `disk=ssd`:

```bash
docker node update --label-add disk=ssd worker-1

docker service create \
  --name db \
  --constraint node.labels.disk==ssd \
  postgres:16
```

Placement constraint rất quan trọng với service stateful như database, vì volume local không tự di chuyển theo container sang node khác.

---

## 3.13. Storage trong Swarm

Storage là phần cần cẩn thận khi dùng Swarm.

Với Docker volume local, dữ liệu nằm trên node đang chạy container. Nếu container bị Swarm đưa sang node khác, volume local cũ không tự đi theo.

Ví dụ:

```text
Postgres chạy ở node-1
Volume nằm trên node-1

node-1 chết
Swarm chạy lại Postgres ở node-2
node-2 không có dữ liệu cũ
```

Vì vậy, với database trong Swarm, cần có chiến lược storage rõ ràng:

- Dùng placement constraint để cố định database vào một node.
- Dùng network storage hoặc volume driver hỗ trợ phân tán.
- Dùng database bên ngoài cluster như RDS, Cloud SQL, managed database.
- Luôn có backup định kỳ.

---

## 3.14. Secrets và Configs

Swarm có cơ chế quản lý secret và config tập trung.

### Secret

Secret dùng cho dữ liệu nhạy cảm như:

- Password database.
- Token.
- Private key.
- API key.

Tạo secret:

```bash
echo "super-secret-password" | docker secret create db_password -
```

Service dùng secret:

```bash
docker service create \
  --name api \
  --secret db_password \
  my-api:1.0
```

Secret được mount vào container dưới dạng file, thường nằm trong:

```text
/run/secrets/db_password
```

### Config

Config dùng cho dữ liệu cấu hình không quá nhạy cảm, ví dụ:

- File cấu hình Nginx.
- File cấu hình app.
- File cấu hình exporter.

Tạo config:

```bash
docker config create nginx_conf ./nginx.conf
```

Service dùng config:

```bash
docker service create \
  --name nginx \
  --config source=nginx_conf,target=/etc/nginx/nginx.conf \
  nginx
```

Secret và config trong Swarm có tính immutable. Muốn đổi nội dung, nên tạo secret/config mới rồi update service dùng bản mới.

---

## 3.15. Stack trong Swarm

Stack là cách triển khai nhiều service liên quan bằng một file Compose.

Thay vì tạo từng service bằng lệnh `docker service create`, ta có thể khai báo trong file YAML rồi deploy:

```bash
docker stack deploy -c docker-compose.yml mystack
```

Ví dụ file Compose dùng cho Swarm:

```yaml
version: "3.8"

services:
  web:
    image: nginx
    ports:
      - "8080:80"
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s

  api:
    image: my-api:1.0
    deploy:
      replicas: 2
```

Xem service trong stack:

```bash
docker stack services mystack
```

Xóa stack:

```bash
docker stack rm mystack
```

Lưu ý quan trọng:

- `build:` không được Swarm build trực tiếp khi deploy stack.
- Image nên được build và push lên registry trước.
- `depends_on` không đảm bảo thứ tự start trong Swarm.
- App nên tự retry khi kết nối database, RabbitMQ hoặc service khác.

---

## 3.16. Các lệnh Docker Swarm thường dùng

### Swarm cluster

```bash
docker swarm init
docker swarm init --advertise-addr <IP_MANAGER>
docker swarm join-token worker
docker swarm join-token manager
docker swarm leave
docker swarm leave --force
```

### Node

```bash
docker node ls
docker node inspect <node> --pretty
docker node update --availability drain <node>
docker node update --availability active <node>
docker node update --label-add key=value <node>
docker node rm <node>
```

### Service

```bash
docker service create --name web --replicas 3 -p 8080:80 nginx
docker service ls
docker service ps web
docker service inspect web --pretty
docker service logs -f web
docker service scale web=5
docker service update --image nginx:1.27-alpine web
docker service rollback web
docker service rm web
```

### Stack

```bash
docker stack deploy -c docker-compose.yml app
docker stack ls
docker stack services app
docker stack ps app
docker stack rm app
```

---

## 3.17. Tổng kết kiến thức cần nhớ

Docker Swarm là orchestration mode tích hợp sẵn trong Docker Engine.

Các ý quan trọng nhất:

- Swarm gom nhiều Docker host thành một cluster.
- Manager quản lý cluster, Worker chạy container.
- Raft giúp các Manager thống nhất cluster state.
- Quorum là điều kiện đa số Manager còn sống để cluster nhận thay đổi mới.
- Service là đơn vị triển khai chính, không phải container.
- Task là thực thể thực thi của service, thường tương ứng với một container.
- Replicated service chạy theo số replica khai báo.
- Global service chạy một task trên mỗi node phù hợp.
- Swarm có self-healing: task chết thì tạo task mới.
- Overlay network giúp service giao tiếp xuyên node.
- Routing Mesh giúp request vào bất kỳ node nào cũng tới được service.
- Rolling update giúp cập nhật service dần dần.
- Storage local là điểm nguy hiểm với service stateful.
- Secret và config giúp quản lý dữ liệu cấu hình tập trung.
- Stack là cách deploy nhiều service bằng Compose file trong Swarm.

Tư duy cốt lõi khi học Swarm:

> Không quản lý từng container. Hãy khai báo trạng thái mong muốn bằng Service, để Swarm duy trì trạng thái đó cho bạn.
