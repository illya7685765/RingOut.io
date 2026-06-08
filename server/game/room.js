// Game room management
const SpatialGrid = require('../utils/spatialGrid');
const Player = require('./player');
const { Food, EjectedMass } = require('./food');
const config = require('../config');
const logger = require('../utils/logger');

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.foods = new Map();
    this.ejectedMass = new Map();
    
    this.playerGrid = new SpatialGrid(config.GRID_SIZE, config.ARENA_SIZE);
    this.foodGrid = new SpatialGrid(config.GRID_SIZE, config.ARENA_SIZE);
    
    this.sequence = 0;
    this.lastSnapshot = null;
    this.created = Date.now();
    
    // Kill feed
    this.killFeed = [];
    
    // Statistics
    this.stats = {
      totalKills: 0,
      totalFoodEaten: 0,
      peakPlayers: 0
    };
  }

  addPlayer(socketId, name, skin) {
    const spawn = this.randomSpawn();
    const player = new Player(socketId, name, skin, spawn.x, spawn.y);
    this.players.set(socketId, player);
    
    if (this.players.size > this.stats.peakPlayers) {
      this.stats.peakPlayers = this.players.size;
    }
    
    logger.debug(`Player ${name} joined room ${this.code}`);
    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      this.playerGrid.remove(player);
      this.players.delete(socketId);
      logger.debug(`Player ${player.name} left room ${this.code}`);
    }
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  randomSpawn(maxDist = config.ARENA_SIZE * 0.8) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * maxDist;
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist
    };
  }

  spawnFood() {
    while (this.foods.size < config.FOOD_COUNT) {
      const spawn = this.randomSpawn();
      const food = new Food(spawn.x, spawn.y);
      this.foods.set(food.id, food);
    }
  }

  addEjectedMass(ejected) {
    const mass = new EjectedMass(
      ejected.x, ejected.y, 
      ejected.mass, ejected.ownerId,
      ejected.vx, ejected.vy
    );
    this.ejectedMass.set(mass.id, mass);
  }

  update(dt) {
    logger.startTimer('room_update');
    
    // Clear grids
    this.playerGrid.clear();
    this.foodGrid.clear();
    
    // Rebuild grids
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      this.playerGrid.insert(player);
    }
    
    for (const food of this.foods.values()) {
      this.foodGrid.insert(food);
    }
    
    for (const mass of this.ejectedMass.values()) {
      this.foodGrid.insert(mass);
    }
    
    // Update players
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      player.update(dt);
      player.checkArenaBounds(config.ARENA_SIZE);
    }
    
    // Update ejected mass
    for (const [id, mass] of this.ejectedMass) {
      mass.update(dt);
      if (mass.isExpired()) {
        this.ejectedMass.delete(id);
      }
    }
    
    // Handle collisions
    this.handlePlayerCollisions();
    this.handleFoodCollisions();
    
    // Spawn food
    this.spawnFood();
    
    logger.endTimer('room_update');
  }

  handlePlayerCollisions() {
    logger.startTimer('player_collisions');
    
    const players = Array.from(this.players.values()).filter(p => p.alive);
    
    for (const player of players) {
      const nearby = this.playerGrid.queryCircle(
        player.x, player.y, player.radius + 100
      );
      
      for (const { entity: other } of nearby) {
        if (other.id === player.id || !other.alive) continue;
        
        // Check if player can eat other (Agar.io style)
        if (this.canEat(player, other)) {
          this.eatPlayer(player, other);
          continue;
        }
        
        // Physical collision (push apart)
        const dx = player.x - other.x;
        const dy = player.y - other.y;
        const distSq = dx * dx + dy * dy;
        const minDist = player.radius + other.radius;
        
        if (distSq < minDist * minDist && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          
          // Push apart based on mass ratio
          const totalMass = player.mass + other.mass;
          const playerRatio = other.mass / totalMass;
          const otherRatio = player.mass / totalMass;
          
          player.x += nx * overlap * playerRatio;
          player.y += ny * overlap * playerRatio;
          other.x -= nx * overlap * otherRatio;
          other.y -= ny * overlap * otherRatio;
          
          // Transfer some momentum
          player.vx += nx * 2 * otherRatio;
          player.vy += ny * 2 * otherRatio;
          other.vx -= nx * 2 * playerRatio;
          other.vy -= ny * 2 * playerRatio;
        }
      }
    }
    
    logger.endTimer('player_collisions');
  }

  canEat(predator, prey) {
    // Must be 10% larger to eat
    return predator.mass >= prey.mass * config.EAT_THRESHOLD &&
           predator.radius > prey.radius;
  }

  eatPlayer(predator, prey) {
    const massGain = prey.mass * 0.5; // Gain 50% of prey's mass
    predator.addMass(massGain);
    predator.kills++;
    
    prey.kill();
    
    // Add to kill feed
    this.killFeed.push({
      killer: predator.name,
      victim: prey.name,
      time: Date.now()
    });
    
    // Keep only last 20 kills
    if (this.killFeed.length > 20) {
      this.killFeed.shift();
    }
    
    this.stats.totalKills++;
    logger.info(`${predator.name} ate ${prey.name}`);
  }

  handleFoodCollisions() {
    logger.startTimer('food_collisions');
    
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      
      const nearbyFood = this.foodGrid.queryCircle(
        player.x, player.y, player.radius + 20
      );
      
      for (const { entity: food } of nearbyFood) {
        const dx = player.x - food.x;
        const dy = player.y - food.y;
        const distSq = dx * dx + dy * dy;
        const minDist = player.radius + food.radius;
        
        if (distSq < minDist * minDist) {
          // Eat food
          player.addMass(food.value);
          
          if (food instanceof EjectedMass) {
            this.ejectedMass.delete(food.id);
          } else {
            this.foods.delete(food.id);
          }
          
          this.stats.totalFoodEaten++;
        }
      }
    }
    
    logger.endTimer('food_collisions');
  }

  getNearbyEntities(playerX, playerY, radius) {
    const nearbyPlayers = this.playerGrid.queryCircle(playerX, playerY, radius);
    const nearbyFood = this.foodGrid.queryCircle(playerX, playerY, radius);
    
    return {
      players: nearbyPlayers.map(({ entity }) => entity),
      foods: nearbyFood.map(({ entity }) => entity)
    };
  }

  createSnapshot(playerId) {
    logger.startTimer('snapshot');
    
    this.sequence++;
    
    const player = this.players.get(playerId);
    const viewRadius = player ? config.INTEREST_RADIUS : config.ARENA_SIZE;
    const viewX = player ? player.x : 0;
    const viewY = player ? player.y : 0;
    
    // Get nearby entities (interest management)
    const nearby = this.getNearbyEntities(viewX, viewY, viewRadius);
    
    // Create delta from last snapshot
    const players = {};
    const deltas = [];
    
    for (const p of nearby.players) {
      const playerData = p.toJSON();
      players[p.id] = playerData;
      
      const lastPlayers = this.lastSnapshot?.players || {};
      const last = lastPlayers[p.id];
      
      if (!last || 
          Math.abs(playerData.x - last.x) > config.DELTA_THRESHOLD ||
          Math.abs(playerData.y - last.y) > config.DELTA_THRESHOLD ||
          Math.abs(playerData.r - last.r) > config.DELTA_THRESHOLD ||
          playerData.a !== last.a) {
        deltas.push(playerData);
      }
    }
    
    // Check for removed players
    const lastPlayers = this.lastSnapshot?.players || {};
    for (const id of Object.keys(lastPlayers)) {
      if (!players[id] && nearby.players.find(p => p.id === id)) {
        deltas.push({ i: id, a: 0 });
      }
    }
    
    // Food (send all nearby food for now, could optimize further)
    const foods = nearby.foods.slice(0, 200).map(f => f.toJSON());
    
    this.lastSnapshot = { players, foods };
    
    const snapshot = {
      seq: this.sequence,
      t: Date.now(),
      d: deltas,
      f: foods,
      k: this.killFeed.slice(-10),
      ar: config.ARENA_SIZE
    };
    
    logger.endTimer('snapshot');
    
    return snapshot;
  }

  getLeaderboard(limit = 10) {
    const leaderboard = Array.from(this.players.values())
      .filter(p => p.alive)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, limit);
    
    return leaderboard.map(p => ({
      name: p.name,
      mass: Math.round(p.mass),
      kills: p.kills
    }));
  }

  getStats() {
    return {
      code: this.code,
      playerCount: this.players.size,
      foodCount: this.foods.size,
      uptime: Date.now() - this.created,
      stats: this.stats,
      gridStats: {
        players: this.playerGrid.getStats(),
        food: this.foodGrid.getStats()
      }
    };
  }
}

module.exports = Room;
