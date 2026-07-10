const express = require('express');
const amqp = require('amqplib');
const { createCluster } = require('redis');

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const redisClusterNodes = (process.env.REDIS_CLUSTER_NODES || 'redis://localhost:7001')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const queueName = process.env.QUEUE_NAME || 'like_notifications';
const likesKey = 'post:1:likes';

let redisClient;
let rabbitChannel;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectRabbitWithRetry() {
  while (true) {
    try {
      const connection = await amqp.connect(rabbitmqUrl);
      const channel = await connection.createChannel();
      await channel.assertQueue(queueName, { durable: true });

      connection.on('close', () => {
        console.error('RabbitMQ connection closed. Stop backend and let Docker restart it.');
        process.exit(1);
      });

      return channel;
    } catch (error) {
      console.error(`RabbitMQ is not ready yet: ${error.message}`);
      await sleep(3000);
    }
  }
}

app.get('/health', async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

app.get('/likes', async (req, res) => {
  const likes = Number(await redisClient.get(likesKey)) || 0;
  res.json({ postId: 1, likes });
});

app.post('/like', async (req, res) => {
  const likes = await redisClient.incr(likesKey);

  const message = {
    postId: 1,
    event: 'liked',
    likes,
    createdAt: new Date().toISOString()
  };

  rabbitChannel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    contentType: 'application/json'
  });

  res.status(201).json({
    message: 'Like saved in Redis and notification job sent to RabbitMQ',
    postId: 1,
    likes
  });
});

app.delete('/likes', async (req, res) => {
  await redisClient.del(likesKey);
  res.json({ message: 'Likes reset', postId: 1, likes: 0 });
});

async function start() {
  redisClient = createCluster({
    rootNodes: redisClusterNodes.map((url) => ({ url }))
  });
  redisClient.on('error', (error) => console.error('Redis error:', error.message));
  await redisClient.connect();

  rabbitChannel = await connectRabbitWithRetry();

  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
