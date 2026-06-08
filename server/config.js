// Server configuration
module.exports = {
  // Arena settings
  ARENA_SIZE: 3000,
  GRID_SIZE: 100,
  
  // Game settings
  TICK_RATE: 30,
  FOOD_COUNT: 500,
  FOOD_VALUE: 1,
  MAX_MASS: 10000,
  START_MASS: 10,
  START_RADIUS: 20,
  
  // Movement
  BASE_SPEED: 5,
  SPEED_DECAY: 0.02,
  FRICTION: 0.95,
  
  // Split mechanics
  SPLIT_COOLDOWN: 500,
  SPLIT_SPEED_MULTIPLIER: 2.5,
  MIN_SPLIT_MASS: 35,
  
  // Eject mass
  EJECT_COOLDOWN: 200,
  EJECT_MASS_COST: 15,
  EJECT_MASS_VALUE: 12,
  EJECT_SPEED: 15,
  
  // Eating mechanics
  MASS_LOSS_RATE: 0.9995,
  EAT_THRESHOLD: 1.1, // Must be 10% larger to eat
  
  // Network
  SNAPSHOT_RATE: 30,
  INTEREST_RADIUS: 2000,
  DELTA_THRESHOLD: 2.0,
  
  // Rate limiting
  MAX_INPUTS_PER_SECOND: 30,
  MAX_PACKETS_PER_SECOND: 60,
  
  // Anti-cheat
  MAX_SPEED: 20,
  POSITION_TOLERANCE: 50,
  
  // Servers
  ALLOWED_SERVERS: ["EU-1", "EU-2", "EU-3", "US-1", "US-2", "ASIA-1"],
  
  // Skins
  ALLOWED_SKINS: ["green", "fire", "ice", "toxic", "shadow", "gold", "neon"],
  
  // Profiling
  ENABLE_PROFILING: true,
  PROFILE_INTERVAL: 60000, // 1 minute
};
