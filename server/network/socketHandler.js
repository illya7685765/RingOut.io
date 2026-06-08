// Socket.IO network handler
const Room = require('../game/room');
const RateLimiters = require('../utils/rateLimiter');
const AntiCheat = require('../utils/antiCheat');
const config = require('../config');
const logger = require('../utils/logger');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.rateLimiters = new RateLimiters();
    this.antiCheat = new AntiCheat();
    
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`Client connected: ${socket.id}`);
      
      socket.data = {
        room: null,
        playerId: null,
        lastInputSeq: 0,
        inputBuffer: []
      };

      socket.on('join', (data) => this.handleJoin(socket, data));
      socket.on('input', (data) => this.handleInput(socket, data));
      socket.on('split', (data) => this.handleSplit(socket, data));
      socket.on('eject', (data) => this.handleEject(socket, data));
      socket.on('spectate', (data) => this.handleSpectate(socket, data));
      socket.on('disconnect', () => this.handleDisconnect(socket));
    });
  }

  handleJoin(socket, data) {
    const { serverCode, name, skin } = data;
    
    // Validate server code
    if (!config.ALLOWED_SERVERS.includes(serverCode)) {
      socket.emit('error', { message: 'Invalid server code' });
      return;
    }
    
    // Validate skin
    if (!config.ALLOWED_SKINS.includes(skin)) {
      socket.emit('error', { message: 'Invalid skin' });
      return;
    }
    
    // Get or create room
    let room = this.rooms.get(serverCode);
    if (!room) {
      room = new Room(serverCode);
      this.rooms.set(serverCode, room);
    }
    
    // Add player to room
    const player = room.addPlayer(socket.id, name, skin);
    socket.data.room = serverCode;
    socket.data.playerId = socket.id;
    
    // Join socket room
    socket.join(serverCode);
    
    // Initialize anti-cheat state
    this.antiCheat.updatePlayerState(socket.id, {
      x: player.x,
      y: player.y,
      mass: player.mass
    });
    
    // Send init
    socket.emit('init', {
      id: socket.id,
      arena: config.ARENA_SIZE,
      serverCode
    });
    
    logger.info(`Player ${name} joined ${serverCode}`);
  }

  handleInput(socket, data) {
    const roomCode = socket.data.room;
    if (!roomCode) return;
    
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    // Rate limit check
    const rateCheck = this.rateLimiters.checkInput(socket.id);
    if (!rateCheck.allowed) {
      if (rateCheck.violations > 5) {
        logger.warn(`Rate limit exceeded for ${socket.id}`);
        socket.emit('error', { message: 'Rate limit exceeded' });
      }
      return;
    }
    
    const player = room.getPlayer(socket.id);
    if (!player || !player.alive) return;
    
    // Buffer input
    socket.data.inputBuffer.push({
      seq: data.seq,
      input: data.input,
      timestamp: Date.now()
    });
  }

  handleSplit(socket, data) {
    const roomCode = socket.data.room;
    if (!roomCode) return;
    
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    // Rate limit check
    const rateCheck = this.rateLimiters.checkAction(socket.id);
    if (!rateCheck.allowed) return;
    
    const player = room.getPlayer(socket.id);
    if (!player || !player.alive) return;
    
    if (player.canSplit()) {
      const directionX = data.directionX || 1;
      const directionY = data.directionY || 0;
      const newCell = player.split(directionX, directionY);
      
      if (newCell) {
        room.addEjectedMass(newCell);
      }
    }
  }

  handleEject(socket, data) {
    const roomCode = socket.data.room;
    if (!roomCode) return;
    
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    // Rate limit check
    const rateCheck = this.rateLimiters.checkAction(socket.id);
    if (!rateCheck.allowed) return;
    
    const player = room.getPlayer(socket.id);
    if (!player || !player.alive) return;
    
    if (player.canEject()) {
      const directionX = data.directionX || 1;
      const directionY = data.directionY || 0;
      const ejected = player.eject(directionX, directionY);
      
      if (ejected) {
        room.addEjectedMass(ejected);
      }
    }
  }

  handleSpectate(socket, data) {
    const { serverCode } = data;
    
    if (!config.ALLOWED_SERVERS.includes(serverCode)) {
      socket.emit('error', { message: 'Invalid server code' });
      return;
    }
    
    let room = this.rooms.get(serverCode);
    if (!room) {
      room = new Room(serverCode);
      this.rooms.set(serverCode, room);
    }
    
    socket.data.room = serverCode;
    socket.join(serverCode);
    
    socket.emit('init', {
      id: null,
      arena: config.ARENA_SIZE,
      serverCode,
      spectating: true
    });
  }

  handleDisconnect(socket) {
    const roomCode = socket.data.room;
    if (roomCode) {
      const room = this.rooms.get(roomCode);
      if (room) {
        room.removePlayer(socket.id);
      }
      
      this.rateLimiters.reset(socket.id);
      this.antiCheat.removePlayer(socket.id);
    }
    
    logger.info(`Client disconnected: ${socket.id}`);
  }

  processInputs() {
    for (const [code, room] of this.rooms) {
      for (const [socketId, player] of room.players) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket || !socket.data.inputBuffer.length) continue;
        
        // Process buffered inputs
        for (const inputData of socket.data.inputBuffer) {
          player.applyInput(inputData.input);
          
          // Anti-cheat validation
          const speedCheck = this.antiCheat.validateSpeed(
            socketId, player.vx, player.vy, player.mass
          );
          
          if (!speedCheck.valid) {
            logger.warn(`Speed cheat detected for ${socketId}`);
          }
        }
        
        // Update anti-cheat state
        this.antiCheat.updatePlayerState(socketId, {
          x: player.x,
          y: player.y,
          mass: player.mass
        });
        
        // Clear buffer
        socket.data.inputBuffer = [];
      }
    }
  }

  broadcastSnapshots() {
    for (const [code, room] of this.rooms) {
      // Get all sockets in this room
      const sockets = this.io.sockets.adapter.rooms.get(code);
      if (!sockets) continue;
      
      for (const socketId of sockets) {
        const socket = this.io.sockets.sockets.get(socketId);
        if (!socket) continue;
        
        // Create personalized snapshot
        const snapshot = room.createSnapshot(socketId);
        
        // Send to player
        socket.emit('s', snapshot);
      }
      
      // Broadcast leaderboard periodically
      if (room.sequence % 30 === 0) {
        const leaderboard = room.getLeaderboard(10);
        this.io.to(code).emit('leaderboard', leaderboard);
      }
    }
  }

  getStats() {
    const roomStats = {};
    for (const [code, room] of this.rooms) {
      roomStats[code] = room.getStats();
    }
    
    return {
      rooms: roomStats,
      rateLimiters: this.rateLimiters.getStats(),
      antiCheat: this.antiCheat.getStats()
    };
  }
}

module.exports = SocketHandler;
