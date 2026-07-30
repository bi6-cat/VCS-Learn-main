const eventForm = document.querySelector('#eventForm');
const searchForm = document.querySelector('#searchForm');
const toast = document.querySelector('#toast');
const formatMoney = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

function notify(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? 'show error' : 'show';
  setTimeout(() => { toast.className = ''; }, 3500);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function checkHealth() {
  const element = document.querySelector('#health');
  try {
    const health = await fetchJson('/api/health');
    element.className = 'health healthy';
    element.innerHTML = `<span></span> Kafka: ${health.kafka} · ES: ${health.elasticsearch}`;
  } catch {
    element.className = 'health unhealthy';
    element.innerHTML = '<span></span> Pipeline chưa sẵn sàng';
  }
}

eventForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = eventForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(eventForm));
    values.amount = Number(values.amount || 0);
    const result = await fetchJson('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    document.querySelector('#publishResult').textContent = `ID ${result.event.id} → partition ${result.kafka.partition}, offset ${result.kafka.baseOffset}`;
    notify('Kafka đã xác nhận event. Đợi Elasticsearch refresh khoảng 1 giây.');
    setTimeout(runSearch, 1300);
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#sampleButton').addEventListener('click', () => {
  const samples = [
    ['user-001', 'view', 'electronics', 'Tai nghe chống ồn cao cấp', 'Khách hàng xem tai nghe bluetooth chống ồn', 0],
    ['user-002', 'search', 'books', 'Tìm sách kiến trúc hệ thống', 'Tìm kiếm sách Kafka và hệ thống phân tán', 0],
    ['user-003', 'purchase', 'electronics', 'Mua bàn phím cơ', 'Đơn hàng bàn phím cơ không dây', 1450000],
    ['user-001', 'review', 'electronics', 'Đánh giá tai nghe rất tốt', 'Âm thanh rõ và khả năng chống ồn tốt', 0]
  ];
  const sample = samples[Math.floor(Math.random() * samples.length)];
  ['userId', 'eventType', 'category', 'title', 'description', 'amount'].forEach((name, index) => {
    eventForm.elements[name].value = sample[index];
  });
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

async function runSearch() {
  const parameters = new URLSearchParams();
  for (const [key, value] of new FormData(searchForm)) if (value) parameters.set(key, value);
  try {
    const data = await fetchJson(`/api/search?${parameters}`);
    render(data);
  } catch (error) {
    notify(error.message, true);
  }
}

function render(data) {
  document.querySelector('#total').textContent = data.total;
  document.querySelector('#took').textContent = `${data.took} ms`;
  document.querySelector('#amount').textContent = formatMoney.format(data.aggregations?.total_amount?.value || 0);

  const results = document.querySelector('#results');
  results.replaceChildren();
  if (!data.items.length) {
    results.innerHTML = '<p class="empty">Không tìm thấy event phù hợp.</p>';
  }
  for (const item of data.items) {
    const card = document.querySelector('#resultTemplate').content.cloneNode(true);
    card.querySelector('.event-type').textContent = item.eventType;
    card.querySelector('time').textContent = new Date(item.timestamp).toLocaleString('vi-VN');
    card.querySelector('h3').textContent = item.title;
    card.querySelector('p').textContent = item.description || 'Không có mô tả';
    card.querySelector('.category').textContent = `# ${item.category}`;
    card.querySelector('.user').textContent = item.userId;
    card.querySelector('.partition').textContent = `P${item.kafka?.partition} / O${item.kafka?.offset}`;
    card.querySelector('.score').textContent = item.score == null ? 'score —' : `score ${item.score.toFixed(2)}`;
    results.append(card);
  }

  const aggs = document.querySelector('#aggregations');
  const groups = [
    ['Theo loại', data.aggregations?.by_event_type?.buckets || []],
    ['Theo danh mục', data.aggregations?.by_category?.buckets || []]
  ];
  aggs.innerHTML = groups.map(([title, buckets]) => `<h4>${title}</h4>${buckets.map((bucket) => `<div><span>${bucket.key}</span><strong>${bucket.doc_count}</strong></div>`).join('') || '<small>Chưa có</small>'}`).join('');
}

checkHealth();
runSearch();
setInterval(checkHealth, 15000);

