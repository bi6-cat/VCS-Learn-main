param(
    [string]$ApiUrl = "http://localhost:8080/api/events"
)

$ErrorActionPreference = "Stop"

$events = @(
    @{ userId = "user-001"; eventType = "view"; title = "Tai nghe chong on cao cap"; description = "Khach hang xem tai nghe bluetooth chong on"; category = "electronics"; amount = 0 }
    @{ userId = "user-002"; eventType = "search"; title = "Tim sach Kafka can ban"; description = "Tim tai lieu ve event streaming va he thong phan tan"; category = "books"; amount = 0 }
    @{ userId = "user-001"; eventType = "add_to_cart"; title = "Them tai nghe vao gio"; description = "Tai nghe bluetooth mau den"; category = "electronics"; amount = 2390000 }
    @{ userId = "user-003"; eventType = "purchase"; title = "Mua ban phim co khong day"; description = "Don hang da thanh toan thanh cong"; category = "electronics"; amount = 1450000 }
    @{ userId = "user-004"; eventType = "purchase"; title = "Mua sach thiet ke he thong"; description = "Sach kien truc phan mem va he thong phan tan"; category = "books"; amount = 320000 }
    @{ userId = "user-001"; eventType = "review"; title = "Danh gia tai nghe rat tot"; description = "Am thanh ro va kha nang chong on tot"; category = "electronics"; amount = 0 }
    @{ userId = "user-005"; eventType = "view"; title = "Xem may pha ca phe"; description = "May pha ca phe tu dong cho gia dinh"; category = "home"; amount = 0 }
    @{ userId = "user-005"; eventType = "purchase"; title = "Mua may pha ca phe"; description = "Dat mua may pha ca phe tu dong"; category = "home"; amount = 5200000 }
)

foreach ($event in $events) {
    $response = Invoke-RestMethod -Method Post -Uri $ApiUrl `
        -ContentType "application/json; charset=utf-8" `
        -Body ($event | ConvertTo-Json -Compress)
    [pscustomobject]@{
        EventId = $response.event.id
        UserId = $response.event.userId
        Partition = $response.kafka.partition
        Offset = $response.kafka.baseOffset
    }
}

Write-Host "Da gui $($events.Count) events. Doi khoang 2 giay roi mo trang tim kiem."
