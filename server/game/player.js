// Player entity class
const config = require('../config');

class Player {
  constructor(id, name, skin, x, y) {
    this.id = id;
    this.name = name || 'Player';
    this.skin = skin || 'green';
    
    // Position
    this.x = x || 0;
    this.y = y || 0;
    this.vx = 0;
    this.vy = 0;
    
    // Size
    this.mass = config.START_MASS;
    this.radius = this.calculateRadius();
    
    // State
    this.alive = true;
    this.cells = [this.createCell()]; // Support for split cells
    
    // Cooldowns
    this.splitCooldown = 0;
    this.ejectCooldown = 0;
    this.dashCooldown = 0;
    
    // Stats
    this.kills = 0;
    this.deaths = 0;
    this.foodEaten = 0;
    this.playTime = 0;
    this.maxMass = this.mass;
    
    // XP and leveling
    this.xp = 0;
    this.level = 1;
    
    // Timestamps
    this.lastUpdate = Date.now();
    this.joinTime = Date.now();
  }

  createCell() {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      mass: this.mass,
      radius: this.radius
    };
  }

  calculateRadius(mass = this.mass) {
    // Agar.io style: radius = mass^(1/3) * constant
    return config.START_RADIUS + Math.pow(mass, 0.4) * 2;
  }

  updateRadius() {
    this.radius = this.calculateRadius();
    for (const cell of this.cells) {
      cell.radius = this.calculateRadius(cell.mass);
    }
  }

  getMaxSpeed() {
    // Speed decreases with mass
    const baseSpeed = config.BASE_SPEED;
    const decay = config.SPEED_DECAY;
    return Math.max(1, baseSpeed * Math.pow(this.mass, -decay));
  }

  applyInput(input) {
    if (!this.alive) return;

    let ax = 0, ay = 0;
    if (input.up) ay -= 1;
    if (input.down) ay += 1;
    if (input.left) ax -= 1;
    if (input.right) ax += 1;

    const lenSq = ax * ax + ay * ay;
    if (lenSq > 0) {
      const len = Math.sqrt(lenSq);
      ax /= len;
      ay /= len;

      const speed = this.getMaxSpeed();
      this.vx += ax * speed * 0.3;
      this.vy += ay * speed * 0.3;
    }

    // Dash - only if moving and cooldown ready
    if (input.dash && this.dashCooldown <= 0 && lenSq > 0) {
      const len = Math.sqrt(lenSq);
      if (len > 0) {
        this.vx += (ax / len) * 16;
        this.vy += (ay / len) * 16;
        this.dashCooldown = 30; // 1 second at 30 ticks
      }
    }
  }

  update(dt) {
    if (!this.alive) return;

    // Apply friction
    this.vx *= config.FRICTION;
    this.vy *= config.FRICTION;

    // Update position
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Update cells
    for (const cell of this.cells) {
      cell.x = this.x;
      cell.y = this.y;
      cell.vx = this.vx;
      cell.vy = this.vy;
    }

    // Mass decay over time
    this.mass *= config.MASS_LOSS_RATE;
    this.updateRadius();

    // Update cooldowns
    if (this.splitCooldown > 0) this.splitCooldown -= dt;
    if (this.ejectCooldown > 0) this.ejectCooldown -= dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;

    // Update stats
    this.playTime += dt;
    if (this.mass > this.maxMass) {
      this.maxMass = this.mass;
    }

    // Update XP
    this.xp += this.mass * 0.01;
    this.level = Math.floor(this.xp / 100) + 1;

    this.lastUpdate = Date.now();
  }

  canSplit() {
    return this.splitCooldown <= 0 && 
           this.mass >= config.MIN_SPLIT_MASS &&
           this.cells.length < 16; // Max 16 cells
  }

  split(directionX, directionY) {
    if (!this.canSplit()) return null;

    const splitMass = this.mass / 2;
    this.mass = splitMass;
    this.updateRadius();

    const newCell = {
      x: this.x,
      y: this.y,
      vx: directionX * config.SPLIT_SPEED_MULTIPLIER * this.getMaxSpeed(),
      vy: directionY * config.SPLIT_SPEED_MULTIPLIER * this.getMaxSpeed(),
      mass: splitMass,
      radius: this.radius
    };

    this.cells.push(newCell);
    this.splitCooldown = config.SPLIT_COOLDOWN;

    return newCell;
  }

  canEject() {
    return this.ejectCooldown <= 0 && 
           this.mass >= config.EJECT_MASS_COST;
  }

  eject(directionX, directionY) {
    if (!this.canEject()) return null;

    this.mass -= config.EJECT_MASS_COST;
    this.updateRadius();

    const ejectedMass = {
      x: this.x + directionX * (this.radius + 10),
      y: this.y + directionY * (this.radius + 10),
      vx: directionX * config.EJECT_SPEED,
      vy: directionY * config.EJECT_SPEED,
      mass: config.EJECT_MASS_VALUE,
      radius: this.calculateRadius(config.EJECT_MASS_VALUE),
      ownerId: this.id
    };

    this.ejectCooldown = config.EJECT_COOLDOWN;

    return ejectedMass;
  }

  checkArenaBounds(arenaSize) {
    const dist = Math.sqrt(this.x * this.x + this.y * this.y);
    if (dist > arenaSize) {
      // Push back
      const angle = Math.atan2(this.y, this.x);
      this.x = Math.cos(angle) * arenaSize;
      this.y = Math.sin(angle) * arenaSize;
      this.vx *= -0.5;
      this.vy *= -0.5;
    }
  }

  addMass(amount) {
    this.mass += amount;
    this.foodEaten += amount;
    this.updateRadius();
  }

  kill() {
    this.alive = false;
    this.deaths++;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      skin: this.skin,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      r: Math.round(this.radius * 10) / 10,
      m: Math.round(this.mass * 100) / 100,
      a: this.alive ? 1 : 0,
      k: this.kills,
      l: this.level,
      xp: Math.round(this.xp)
    };
  }
}

module.exports = Player;
