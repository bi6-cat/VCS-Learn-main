import { createKafka, env, esRequest, isValidEvent, sleep } from './lib.js';

const kafka = createKafka('elasticsearch-indexer');
const consumer = kafka.consumer({ groupId: env.groupId, allowAutoTopicCreation: false });
const dlqProducer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true });

const indexDefinition = {
  settings: {
    number_of_shards: 3,
    number_of_replicas: 0,
    refresh_interval: '1s',
    analysis: {
      analyzer: {
        lab_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'asciifolding']
        }
      }
    }
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      id: { type: 'keyword' },
      userId: { type: 'keyword' },
      eventType: { type: 'keyword' },
      title: { type: 'text', analyzer: 'lab_text', fields: { raw: { type: 'keyword', ignore_above: 256 } } },
      description: { type: 'text', analyzer: 'lab_text' },
      category: { type: 'keyword' },
      amount: { type: 'scaled_float', scaling_factor: 100 },
      timestamp: { type: 'date' },
      indexedAt: { type: 'date' },
      kafka: {
        properties: {
          topic: { type: 'keyword' },
          partition: { type: 'integer' },
          offset: { type: 'keyword' }
        }
      }
    }
  }
};

async function ensureIndex() {
  const response = await fetch(`${env.esUrl}/${env.esIndex}`, { method: 'HEAD' });
  if (response.status === 404) {
    await esRequest(`/${env.esIndex}`, { method: 'PUT', body: JSON.stringify(indexDefinition) });
    console.log(`Created Elasticsearch index ${env.esIndex}`);
    return;
  }
  if (!response.ok) throw new Error(`Cannot inspect Elasticsearch index: HTTP ${response.status}`);
  console.log(`Elasticsearch index ${env.esIndex} already exists`);
}

async function indexWithRetry(event, metadata) {
  const document = {
    ...event,
    indexedAt: new Date().toISOString(),
    kafka: metadata
  };

  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await esRequest(`/${env.esIndex}/_doc/${encodeURIComponent(event.id)}`, {
        method: 'PUT',
        body: JSON.stringify(document)
      });
      return;
    } catch (error) {
      lastError = error;
      console.error(`Index attempt ${attempt}/5 failed: ${error.message}`);
      if (attempt < 5) await sleep(500 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function sendToDlq(rawValue, metadata, error) {
  await dlqProducer.send({
    topic: env.dlqTopic,
    acks: -1,
    messages: [{
      key: `${metadata.topic}-${metadata.partition}-${metadata.offset}`,
      value: JSON.stringify({
        failedAt: new Date().toISOString(),
        error: error.message,
        source: metadata,
        originalValue: rawValue
      })
    }]
  });
}

async function start() {
  await ensureIndex();
  await Promise.all([consumer.connect(), dlqProducer.connect()]);
  await consumer.subscribe({ topic: env.topic, fromBeginning: true });

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const metadata = { topic, partition, offset: message.offset };
      const rawValue = message.value?.toString('utf8') || '';
      let event;

      try {
        event = JSON.parse(rawValue);
        if (!isValidEvent(event)) throw new Error('Event không đúng schema bắt buộc');
      } catch (error) {
        console.error(`Moving partition=${partition} offset=${message.offset} to DLQ: ${error.message}`);
        await sendToDlq(rawValue, metadata, error);
        await consumer.commitOffsets([{ topic, partition, offset: String(BigInt(message.offset) + 1n) }]);
        return;
      }

      // Lỗi hạ tầng Elasticsearch là lỗi tạm thời: ném lỗi và KHÔNG commit offset.
      // Container sẽ restart, rồi consumer đọc lại record theo cơ chế at-least-once.
      await indexWithRetry(event, metadata);
      console.log(`Indexed event=${event.id} partition=${partition} offset=${message.offset}`);
      await consumer.commitOffsets([{ topic, partition, offset: String(BigInt(message.offset) + 1n) }]);
    }
  });
}

async function shutdown(signal) {
  console.log(`${signal}: shutting down indexer`);
  await Promise.allSettled([consumer.disconnect(), dlqProducer.disconnect()]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
