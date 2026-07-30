import { Kafka, logLevel } from 'kafkajs';

export const env = {
  brokers: (process.env.KAFKA_BROKERS || 'kafka:19092').split(','),
  topic: process.env.KAFKA_TOPIC || 'customer-events',
  dlqTopic: process.env.KAFKA_DLQ_TOPIC || 'customer-events-dlq',
  groupId: process.env.KAFKA_GROUP_ID || 'elasticsearch-indexers',
  esUrl: (process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200').replace(/\/$/, ''),
  esIndex: process.env.ELASTICSEARCH_INDEX || 'customer-events-v1'
};

export function createKafka(clientId) {
  return new Kafka({
    clientId,
    brokers: env.brokers,
    logLevel: logLevel.INFO,
    retry: { initialRetryTime: 300, retries: 10 }
  });
}

export async function esRequest(path, options = {}) {
  const response = await fetch(`${env.esUrl}${path}`, {
    ...options,
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

  if (!response.ok) {
    const error = new Error(`Elasticsearch ${response.status}: ${JSON.stringify(body)}`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
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
