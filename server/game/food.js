// Food entity class
const config = require('../config');

class Food {
  constructor(x, y, value = config.FOOD_VALUE) {
    this.id = `food_${Math.random().toString(36).substr(2, 9)}`;
    this.x = x;
    this.y = y;
    this.value = value;
    this.radius = this.calculateRadius();
    this.color = this.randomColor();
  }

  calculateRadius() {
    // Food size based on value
    return 5 + Math.sqrt(this.value) * 2;
  }

  randomColor() {
    const colors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', 
      '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  toJSON() {
    return {
      id: this.id,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      r: Math.round(this.radius * 10) / 10,
      v: Math.round(this.value * 100) / 100,
      c: this.color
    };
  }
}

class EjectedMass extends Food {
  constructor(x, y, value, ownerId, vx, vy) {
    super(x, y, value);
    this.ownerId = ownerId;
    this.vx = vx;
    this.vy = vy;
    this.radius = this.calculateRadius();
    this.color = '#ffffff';
    this.decayTimer = 1000; // Disappear after 1 second
  }

  calculateRadius() {
    return 8 + Math.sqrt(this.value) * 3;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.95;
    this.vy *= 0.95;
    this.decayTimer -= dt * 1000;
  }

  isExpired() {
    return this.decayTimer <= 0;
  }
}

module.exports = { Food, EjectedMass };
