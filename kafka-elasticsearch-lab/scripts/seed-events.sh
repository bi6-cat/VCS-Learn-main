#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8080/api/events}"

events=(
  '{"userId":"user-001","eventType":"view","title":"Tai nghe chống ồn cao cấp","description":"Khách hàng xem tai nghe bluetooth chống ồn","category":"electronics","amount":0}'
  '{"userId":"user-002","eventType":"search","title":"Tìm sách Kafka căn bản","description":"Tìm tài liệu về event streaming và hệ thống phân tán","category":"books","amount":0}'
  '{"userId":"user-001","eventType":"add_to_cart","title":"Thêm tai nghe vào giỏ","description":"Tai nghe bluetooth màu đen","category":"electronics","amount":2390000}'
  '{"userId":"user-003","eventType":"purchase","title":"Mua bàn phím cơ không dây","description":"Đơn hàng đã thanh toán thành công","category":"electronics","amount":1450000}'
  '{"userId":"user-004","eventType":"purchase","title":"Mua sách thiết kế hệ thống","description":"Sách kiến trúc phần mềm và hệ thống phân tán","category":"books","amount":320000}'
  '{"userId":"user-001","eventType":"review","title":"Đánh giá tai nghe rất tốt","description":"Âm thanh rõ và khả năng chống ồn tốt","category":"electronics","amount":0}'
  '{"userId":"user-005","eventType":"view","title":"Xem máy pha cà phê","description":"Máy pha cà phê tự động cho gia đình","category":"home","amount":0}'
  '{"userId":"user-005","eventType":"purchase","title":"Mua máy pha cà phê","description":"Đặt mua máy pha cà phê tự động","category":"home","amount":5200000}'
)

for event in "${events[@]}"; do
  curl -fsS -X POST "$API_URL" -H 'Content-Type: application/json' -d "$event"
  printf '\n'
done

echo "Đã gửi ${#events[@]} events. Đợi khoảng 2 giây rồi mở trang tìm kiếm."

