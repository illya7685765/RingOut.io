// Main game loop
const config = require('./config');
const logger = require('./utils/logger');

class GameLoop {
  constructor(updateCallback, snapshotCallback) {
    this.updateCallback = updateCallback;
    this.snapshotCallback = snapshotCallback;
    this.running = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.tickRate = 1000 / config.TICK_RATE;
    this.snapshotRate = 1000 / config.SNAPSHOT_RATE;
    this.snapshotAccumulator = 0;
    this.intervalId = null;
  }

  start() {
    if (this.running) return;
    
    this.running = true;
    this.lastTime = Date.now();
    
    // Use setInterval for Node.js compatibility
    this.intervalId = setInterval(() => this.loop(), 1);
    
    logger.info('Game loop started');
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Game loop stopped');
  }

  loop() {
    if (!this.running) return;
    
    const currentTime = Date.now();
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    this.accumulator += deltaTime;
    this.snapshotAccumulator += deltaTime;
    
    // Fixed timestep for game logic
    while (this.accumulator >= this.tickRate) {
      const dt = this.tickRate / 1000; // Convert to seconds
      this.updateCallback(dt);
      this.accumulator -= this.tickRate;
    }
    
    // Separate rate for snapshots
    if (this.snapshotAccumulator >= this.snapshotRate) {
      this.snapshotCallback();
      this.snapshotAccumulator = 0;
    }
  }
}

module.exports = GameLoop;
