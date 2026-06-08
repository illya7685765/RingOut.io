// Anti-cheat validation
const config = require('../config');

class AntiCheat {
  constructor() {
    this.playerStates = new Map();
  }

  updatePlayerState(playerId, state) {
    this.playerStates.set(playerId, {
      ...state,
      lastUpdate: Date.now()
    });
  }

  validatePosition(playerId, newX, newY, newMass) {
    const state = this.playerStates.get(playerId);
    if (!state) return { valid: true };

    const now = Date.now();
    const dt = (now - state.lastUpdate) / 1000; // seconds
    if (dt <= 0) return { valid: true };

    // Calculate maximum possible distance based on mass
    const speed = this.calculateMaxSpeed(newMass);
    const maxDistance = speed * dt;

    const dx = newX - state.x;
    const dy = newY - state.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxDistance + config.POSITION_TOLERANCE) {
      return {
        valid: false,
        reason: 'position',
        detected: distance,
        allowed: maxDistance,
        tolerance: config.POSITION_TOLERANCE
      };
    }

    return { valid: true };
  }

  validateMass(playerId, newMass, oldMass) {
    // Mass should not increase too rapidly
    const maxIncrease = 50; // Maximum mass increase per tick
    if (newMass - oldMass > maxIncrease) {
      return {
        valid: false,
        reason: 'mass',
        detected: newMass - oldMass,
        allowed: maxIncrease
      };
    }

    return { valid: true };
  }

  validateSpeed(playerId, vx, vy, mass) {
    const speed = Math.sqrt(vx * vx + vy * vy);
    const maxSpeed = this.calculateMaxSpeed(mass);

    if (speed > maxSpeed * 2) { // Allow some margin for dash
      return {
        valid: false,
        reason: 'speed',
        detected: speed,
        allowed: maxSpeed
      };
    }

    return { valid: true };
  }

  calculateMaxSpeed(mass) {
    // Speed decreases as mass increases (Agar.io style)
    const baseSpeed = config.BASE_SPEED;
    const decay = config.SPEED_DECAY;
    return Math.max(1, baseSpeed * Math.pow(mass, -decay));
  }

  removePlayer(playerId) {
    this.playerStates.delete(playerId);
  }

  getStats() {
    return {
      trackedPlayers: this.playerStates.size
    };
  }
}

module.exports = AntiCheat;
