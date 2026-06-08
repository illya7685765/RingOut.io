const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const config = require("./server/config");
const GameLoop = require("./server/gameLoop");
const SocketHandler = require("./server/network/socketHandler");
const logger = require("./server/utils/logger");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  transports: ["websocket", "polling"],
  pingTimeout: 10000,
  pingInterval: 5000,
  maxHttpBufferSize: 1e6
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static("public"));

// API endpoint for referral system
app.get("/api/referral/count/:playerId", (req, res) => {
  // Mock response - in production, this would query a database
  res.json({ count: 0 });
});

app.post("/api/referral/join", (req, res) => {
  // Mock response - in production, this would update a database
  res.json({ success: true });
});

// Initialize socket handler
const socketHandler = new SocketHandler(io);

// Game update function
function gameUpdate(dt) {
  for (const [code, room] of socketHandler.rooms) {
    room.update(dt);
  }
  socketHandler.processInputs();
}

// Snapshot broadcast function
function broadcastSnapshots() {
  socketHandler.broadcastSnapshots();
}

// Initialize game loop
const gameLoop = new GameLoop(gameUpdate, broadcastSnapshots);

// Start game loop
gameLoop.start();

// Performance monitoring
if (config.ENABLE_PROFILING) {
  setInterval(() => {
    logger.printMetrics();
    logger.info("Server Stats:", socketHandler.getStats());
  }, config.PROFILE_INTERVAL);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  gameLoop.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  gameLoop.stop();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`RingOut.io server running on port ${PORT}`);
  logger.info(`Arena size: ${config.ARENA_SIZE}`);
  logger.info(`Tick rate: ${config.TICK_RATE} Hz`);
  logger.info(`Snapshot rate: ${config.SNAPSHOT_RATE} Hz`);
});