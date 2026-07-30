import { Kafka, logLevel } from 'kafkajs';

export const env = {
  brokers: (process.env.KAFKA_BROKERS || 'kafka1:19092,kafka2:19092,kafka3:19092')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean),
  topic: process.env.KAFKA_TOPIC || 'customer-events',
  dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'customer-events-dlq',
  groupId: process.env.KAFKA_GROUP_ID || 'elasticsearch-indexers',
  esUrls: (process.env.ELASTICSEARCH_URLS || process.env.ELASTICSEARCH_URL || 'http://es01:9200,http://es02:9200,http://es03:9200')
    .split(',')
    .map((url) => url.trim().replace(/\/$/, ''))
    .filter(Boolean),
  esIndex: process.env.ELASTICSEARCH_INDEX || 'customer-events-v1'
};

let nextEsNode = 0;

export function createKafka(clientId) {
  return new Kafka({
    clientId,
    brokers: env.brokers,
    logLevel: logLevel.INFO,
    retry: { initialRetryTime: 300, retries: 10 }
  });
}

export async function esRequest(path, options = {}) {
  const startAt = nextEsNode % env.esUrls.length;
  nextEsNode += 1;
  let lastError;

  for (let index = 0; index < env.esUrls.length; index += 1) {
    const nodeUrl = env.esUrls[(startAt + index) % env.esUrls.length];
    try {
      const response = await fetch(`${nodeUrl}${path}`, {
        ...options,
        signal: options.signal || AbortSignal.timeout(5000),
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {})
        }
      });

      const raw = await response.text();
      let body = raw;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        // Keep raw text so diagnostics are not lost.
      }

      if (response.ok) return body;

      const error = new Error(`Elasticsearch ${response.status} at ${nodeUrl}: ${JSON.stringify(body)}`);
      error.status = response.status;
      error.details = body;
      error.nodeUrl = nodeUrl;

      // Lỗi 4xx thuộc request/dữ liệu, thử node khác cũng không giải quyết được.
      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      lastError = error;
      console.error(`Elasticsearch node ${nodeUrl} unavailable: ${error.message}`);
    }
  }

  throw lastError || new Error('No Elasticsearch node is configured');
}

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isValidEvent(event) {
  return Boolean(
    event &&
    typeof event.id === 'string' &&
    typeof event.userId === 'string' &&
    typeof event.eventType === 'string' &&
    typeof event.title === 'string' &&
    (event.description === undefined || typeof event.description === 'string') &&
    typeof event.category === 'string' &&
    (event.amount === undefined || Number.isFinite(event.amount)) &&
    typeof event.timestamp === 'string' &&
    Number.isFinite(Date.parse(event.timestamp))
  );
}
