# Redis Cluster + RabbitMQ Like Lab

Lab don gian de thay Redis Cluster va RabbitMQ phoi hop trong mot he thong nho.

## Kien truc

```text
curl / Browser
    |
    v
Backend API
    |-- Redis Cluster: luu counter post:1:likes
    |
    |-- RabbitMQ: queue like_notifications
              |
              v
            Worker: nhan job va in log notification gia lap
```

Redis Cluster trong lab gom 6 node:

```text
redis-node-1, redis-node-2, redis-node-3: master
redis-node-4, redis-node-5, redis-node-6: replica
```

## Chay lab

```bash
docker compose up --build
```

Backend API:

```text
http://localhost:3000
```

RabbitMQ Management UI:

```text
http://localhost:15672
username: guest
password: guest
```

Redis Cluster map ra may host tu port `7001` den `7006`.

## Test

Doc so like hien tai:

```bash
curl http://localhost:3000/likes
```

Tang like:

```bash
curl -X POST http://localhost:3000/like
curl -X POST http://localhost:3000/like
```

Doc lai so like:

```bash
curl http://localhost:3000/likes
```

Reset counter:

```bash
curl -X DELETE http://localhost:3000/likes
```

Xem log worker:

```bash
docker compose logs -f worker
```

Kiem tra Redis Cluster:

```bash
docker compose exec redis-node-1 redis-cli cluster info
docker compose exec redis-node-1 redis-cli cluster nodes
```

## Redis Cluster lam gi?

Redis Cluster luu counter:

```text
post:1:likes
```

Moi lan goi `POST /like`, backend chay lenh tuong duong:

```text
INCR post:1:likes
```

Backend ket noi vao cac node Redis Cluster bang bien moi truong:

```text
REDIS_CLUSTER_NODES=redis://redis-node-1:6379,...,redis://redis-node-6:6379
```

Redis Cluster tu chia key vao hash slot. Voi key `post:1:likes`, backend chi can goi `INCR`, Redis client se tu dinh tuyen request den node master dang giu slot cua key do.

## RabbitMQ lam gi?

Moi lan goi `POST /like`, backend gui mot message vao queue:

```json
{
  "postId": 1,
  "event": "liked",
  "likes": 1,
  "createdAt": "2026-07-10T00:00:00.000Z"
}
```

Worker nhan message va in log notification gia lap.

## Dung lab

```bash
docker compose down
```

Xoa ca du lieu Redis va RabbitMQ:

```bash
docker compose down -v
```
