import crypto from 'node:crypto';
import express from 'express';
import { createKafka, env, esRequest } from './lib.js';

const app = express();
const kafka = createKafka('customer-event-api');
const producer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true });
const allowedTypes = new Set(['view', 'search', 'add_to_cart', 'purchase', 'review']);

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (_request, response) => {
  try {
    const es = await esRequest('/_cluster/health');
    response.json({ status: 'ok', kafka: 'connected', elasticsearch: es.status });
  } catch (error) {
    response.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.post('/api/events', async (request, response, next) => {
  try {
    const { userId, eventType, title, description = '', category, amount = 0 } = request.body;
    if (!userId || !eventType || !title || !category) {
      return response.status(400).json({ error: 'userId, eventType, title và category là bắt buộc' });
    }
    if (!allowedTypes.has(eventType)) {
      return response.status(400).json({ error: `eventType phải thuộc: ${[...allowedTypes].join(', ')}` });
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) {
      return response.status(400).json({ error: 'amount phải là số không âm' });
    }

    const event = {
      id: crypto.randomUUID(),
      userId: String(userId).slice(0, 100),
      eventType,
      title: String(title).slice(0, 300),
      description: String(description).slice(0, 2000),
      category: String(category).slice(0, 100),
      amount: Number(amount),
      timestamp: new Date().toISOString()
    };

    const metadata = await producer.send({
      topic: env.topic,
      acks: -1,
      messages: [{ key: event.userId, value: JSON.stringify(event) }]
    });

    response.status(202).json({
      message: 'Event đã được Kafka xác nhận',
      event,
      kafka: {
        topic: env.topic,
        partition: metadata[0]?.partition,
        baseOffset: metadata[0]?.baseOffset
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/search', async (request, response, next) => {
  try {
    const { q = '', eventType = '', category = '', userId = '', from = '', to = '' } = request.query;
    const requestedPage = Number.parseInt(request.query.page || '1', 10);
    const requestedSize = Number.parseInt(request.query.size || '20', 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const size = Number.isFinite(requestedSize) ? Math.min(50, Math.max(1, requestedSize)) : 20;
    const filters = [];

    if (eventType) filters.push({ term: { eventType } });
    if (category) filters.push({ term: { category } });
    if (userId) filters.push({ term: { userId } });
    if (from || to) {
      filters.push({ range: { timestamp: { ...(from && { gte: from }), ...(to && { lte: to }) } } });
    }

    const query = q
      ? { bool: { must: [{ multi_match: { query: q, fields: ['title^3', 'description'], fuzziness: 'AUTO' } }], filter: filters } }
      : { bool: { must: [{ match_all: {} }], filter: filters } };

    const result = await esRequest(`/${env.esIndex}/_search`, {
      method: 'POST',
      body: JSON.stringify({
        from: (page - 1) * size,
        size,
        query,
        sort: q ? [{ _score: 'desc' }, { timestamp: 'desc' }] : [{ timestamp: 'desc' }],
        aggs: {
          by_event_type: { terms: { field: 'eventType', size: 10 } },
          by_category: { terms: { field: 'category', size: 10 } },
          total_amount: { sum: { field: 'amount' } }
        }
      })
    });

    response.json({
      took: result.took,
      total: result.hits.total.value,
      items: result.hits.hits.map((hit) => ({ id: hit._id, score: hit._score, ...hit._source })),
      aggregations: result.aggregations
    });
  } catch (error) {
    if (error.status === 404) {
      return response.json({ took: 0, total: 0, items: [], aggregations: {} });
    }
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.status || 500).json({ error: error.message });
});

const port = Number(process.env.PORT || 3000);
let server;

async function start() {
  await producer.connect();
  server = app.listen(port, '0.0.0.0', () => console.log(`API listening on :${port}`));
}

async function shutdown(signal) {
  console.log(`${signal}: shutting down API`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await producer.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
