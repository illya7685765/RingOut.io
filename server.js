const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// 👇 ОЦЕ МІСЦЕ
const io = new Server(server, {
  transports: ["websocket", "polling"]
});

app.use(express.json());
app.use(express.static("public"));

const rooms = {};
const ARENA = 1000;
const TICK_RATE = 15;
const GRID_SIZE = 100;

const allowedServers = ["EU-1", "EU-2", "EU-3"];
const allowedSkins = ["green", "fire", "ice", "toxic", "shadow", "gold", "neon"];

function normalizeServer(code) {
  const clean = (code || "EU-1").toUpperCase();
  return allowedServers.includes(clean) ? clean : "EU-1";
}

function randomSpawn(maxDist = 850) {
  const a = Math.random() * Math.PI * 2;
  const d = Math.random() * maxDist;
  return { x: Math.cos(a) * d, y: Math.sin(a) * d };
}

function makePlayer(id, name, skin) {
  const s = randomSpawn();
  return {
    id,
    name: name || "Player",
    skin,
    x: s.x,
    y: s.y,
    vx: 0,
    vy: 0,
    r: 22,
    mass: 0,
    alive: true,
    dashCooldown: 0,
    lastUpdate: Date.now()
  };
}

class SpatialGrid {
  constructor(size, arena) {
    this.size = size;
    this.arena = arena;
    this.cells = new Map();
  }

  getKey(x, y) {
    const gx = Math.floor((x + this.arena) / this.size);
    const gy = Math.floor((y + this.arena) / this.size);
    return `${gx},${gy}`;
  }

  clear() {
    this.cells.clear();
  }

  insert(entity, x, y, r) {
    const minX = Math.floor((x - r + this.arena) / this.size);
    const maxX = Math.floor((x + r + this.arena) / this.size);
    const minY = Math.floor((y - r + this.arena) / this.size);
    const maxY = Math.floor((y + r + this.arena) / this.size);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = `${gx},${gy}`;
        if (!this.cells.has(key)) {
          this.cells.set(key, []);
        }
        this.cells.get(key).push(entity);
      }
    }
  }

  query(x, y, r) {
    const results = new Set();
    const minX = Math.floor((x - r + this.arena) / this.size);
    const maxX = Math.floor((x + r + this.arena) / this.size);
    const minY = Math.floor((y - r + this.arena) / this.size);
    const maxY = Math.floor((y + r + this.arena) / this.size);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = `${gx},${gy}`;
        const cell = this.cells.get(key);
        if (cell) {
          for (const entity of cell) {
            results.add(entity);
          }
        }
      }
    }
    return Array.from(results);
  }
}

function makeRoom() {
  return {
    players: {},
    foods: [],
    playerGrid: new SpatialGrid(GRID_SIZE, ARENA),
    foodGrid: new SpatialGrid(GRID_SIZE, ARENA),
    sequence: 0,
    lastSnapshot: null
  };
}

function ensureRoom(code) {
  const c = normalizeServer(code);
  if (!rooms[c]) rooms[c] = makeRoom();
  return rooms[c];
}

io.on("connection", (socket) => {
  socket.data = {
    room: null,
    lastInputSeq: 0,
    inputBuffer: []
  };

  socket.on("join", ({ serverCode, name, skin }) => {
    const room = ensureRoom(serverCode);
    const code = normalizeServer(serverCode);

    socket.data.room = code;
    socket.join(code);

    const player = makePlayer(
      socket.id,
      name,
      allowedSkins.includes(skin) ? skin : "green"
    );
    room.players[socket.id] = player;

    socket.emit("init", {
      id: socket.id,
      arena: ARENA
    });
  });

  socket.on("input", (data) => {
    const room = rooms[socket.data.room];
    if (!room) return;

    const p = room.players[socket.id];
    if (!p || !p.alive) return;

    socket.data.inputBuffer.push({
      seq: data.seq,
      input: data.input,
      timestamp: Date.now()
    });
  });

  socket.on("disconnect", () => {
    const room = rooms[socket.data.room];
    if (room) delete room.players[socket.id];
  });
});

function updateRoom(room) {
  const players = Object.values(room.players);
  const now = Date.now();

  room.playerGrid.clear();
  room.foodGrid.clear();

  for (const p of players) {
    if (!p.alive) continue;
    room.playerGrid.insert(p, p.x, p.y, p.r);
  }

  for (const f of room.foods) {
    room.foodGrid.insert(f, f.x, f.y, f.r);
  }

  for (const p of players) {
    if (!p.alive) continue;

    const socket = io.sockets.sockets.get(p.id);
    if (socket && socket.data.inputBuffer.length > 0) {
      for (const inputData of socket.data.inputBuffer) {
        let ax = 0, ay = 0;
        if (inputData.input.up) ay -= 1;
        if (inputData.input.down) ay += 1;
        if (inputData.input.left) ax -= 1;
        if (inputData.input.right) ax += 1;

        const lenSq = ax * ax + ay * ay;
        if (lenSq > 0) {
          const len = Math.sqrt(lenSq);
          ax /= len;
          ay /= len;
          p.vx += ax * 0.3;
          p.vy += ay * 0.3;
        }

        if (inputData.input.dash && p.dashCooldown <= 0) {
          p.vx += ax * 16;
          p.vy += ay * 16;
          p.dashCooldown = 72;
        }
      }
      socket.data.inputBuffer = [];
    }

    p.vx *= 0.92;
    p.vy *= 0.92;

    p.x += p.vx;
    p.y += p.vy;

    if (p.dashCooldown > 0) p.dashCooldown--;

    const distSq = p.x * p.x + p.y * p.y;
    if (distSq > ARENA * ARENA) {
      const dist = Math.sqrt(distSq);
      p.x *= ARENA / dist;
      p.y *= ARENA / dist;
      p.vx *= 0.5;
      p.vy *= 0.5;
    }

    p.r = 22 + Math.sqrt(p.mass) * 5;
    p.lastUpdate = now;
  }

  for (const p of players) {
    if (!p.alive) continue;

    const nearby = room.playerGrid.query(p.x, p.y, p.r + 50);
    for (const other of nearby) {
      if (other.id === p.id || !other.alive) continue;

      const dx = p.x - other.x;
      const dy = p.y - other.y;
      const distSq = dx * dx + dy * dy;
      const minDist = p.r + other.r;

      if (distSq < minDist * minDist && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        const overlap = minDist - dist;
        p.x += nx * overlap * 0.5;
        p.y += ny * overlap * 0.5;
        other.x -= nx * overlap * 0.5;
        other.y -= ny * overlap * 0.5;

        other.vx += nx * 2;
        other.vy += ny * 2;
        p.vx -= nx * 1;
        p.vy -= ny * 1;
      }
    }
  }

  for (const p of players) {
    if (!p.alive) continue;

    const nearbyFood = room.foodGrid.query(p.x, p.y, p.r + 20);
    for (const f of nearbyFood) {
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      const distSq = dx * dx + dy * dy;
      const minDist = p.r + f.r;

      if (distSq < minDist * minDist) {
        p.mass += f.value;
        const idx = room.foods.indexOf(f);
        if (idx !== -1) room.foods.splice(idx, 1);
      }
    }
  }

  while (room.foods.length < 150) {
    const s = randomSpawn(900);
    room.foods.push({ x: s.x, y: s.y, r: 8, value: 0.4 });
  }
}

function createSnapshot(room) {
  room.sequence++;

  const players = {};
  const deltas = [];

  for (const [id, p] of Object.entries(room.players)) {
    const playerData = {
      i: id,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      r: Math.round(p.r * 10) / 10,
      m: Math.round(p.mass * 100) / 100,
      a: p.alive ? 1 : 0
    };
    players[id] = playerData;
  }

  const lastPlayers = room.lastSnapshot?.players || {};
  for (const [id, current] of Object.entries(players)) {
    const last = lastPlayers[id];
    if (!last || 
        Math.abs(current.x - last.x) > 0.5 || 
        Math.abs(current.y - last.y) > 0.5 ||
        current.a !== last.a) {
      deltas.push(current);
    }
  }

  for (const id of Object.keys(lastPlayers)) {
    if (!players[id]) {
      deltas.push({ i: id, a: 0 });
    }
  }

  const foods = room.foods.slice(0, 100).map(f => ({
    x: Math.round(f.x * 100) / 100,
    y: Math.round(f.y * 100) / 100,
    r: f.r
  }));

  room.lastSnapshot = { players, foods };

  return {
    seq: room.sequence,
    t: Date.now(),
    d: deltas,
    f: foods,
    ar: ARENA
  };
}

setInterval(() => {
  for (const code of allowedServers) {
    const room = ensureRoom(code);
    updateRoom(room);
    const snapshot = createSnapshot(room);
    io.to(code).emit("s", snapshot);
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("IO Game Server running on port " + PORT);
});