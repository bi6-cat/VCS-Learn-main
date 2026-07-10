const amqp = require('amqplib');

const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
const queueName = process.env.QUEUE_NAME || 'like_notifications';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry() {
  while (true) {
    try {
      const connection = await amqp.connect(rabbitmqUrl);
      const channel = await connection.createChannel();
      await channel.assertQueue(queueName, { durable: true });
      channel.prefetch(1);

      connection.on('close', () => {
        console.error('RabbitMQ connection closed. Stop worker and let Docker restart it.');
        process.exit(1);
      });

      return channel;
    } catch (error) {
      console.error(`RabbitMQ is not ready yet: ${error.message}`);
      await sleep(3000);
    }
  }
}

async function start() {
  const channel = await connectWithRetry();

  console.log(`Worker waiting for jobs from queue: ${queueName}`);

  channel.consume(queueName, async (message) => {
    if (!message) return;

    const job = JSON.parse(message.content.toString());
    console.log(`[Worker] Receive job: post ${job.postId} ${job.event}, likes=${job.likes}`);

    await sleep(500);
    console.log(`[Worker] Fake notification sent for post ${job.postId}`);

    channel.ack(message);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
