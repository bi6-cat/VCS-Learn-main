const express = require('express');
const redis = require('redis');
const cors = require('cors');

const app = express();
app.use(cors());

const redisClient = redis.createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

async function startServer() {
  await redisClient.connect();
  
  app.get('/api/visits', async (req, res) => {
    try {
      let visits = await redisClient.get('visits');
      if (!visits) visits = 0;
      visits = parseInt(visits) + 1;
      await redisClient.set('visits', visits);
      
      res.json({ message: 'Hello từ Backend Node.js!', visits: visits });
    } catch (error) {
      res.status(500).json({ error: 'Lỗi kết nối Redis' });
    }
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Backend API đang chạy ở port ${port}`);
  });
}

startServer();
