const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const referralGuests = new Map();

app.post("/api/referral/join", (req, res) => {
  const referrerId = String((req.body && req.body.referrerId) || "").slice(0, 64);
  const guestId = String((req.body && req.body.guestId) || "").slice(0, 64);
  if (!referrerId || !guestId || referrerId === guestId) {
    return res.status(400).json({ ok: false });
  }
  if (!referralGuests.has(referrerId)) referralGuests.set(referrerId, new Set());
  const set = referralGuests.get(referrerId);
  const isNew = !set.has(guestId);
  if (isNew) set.add(guestId);
  res.json({ ok: true, count: set.size, isNew });
});

app.get("/api/referral/count/:id", (req, res) => {
  const id = String(req.params.id || "").slice(0, 64);
  const set = referralGuests.get(id);
  res.json({ count: set ? set.size : 0 });
});

const rooms = {};
const ARENA = 1000;
const DANGER_TIME = 3000;
const MEGA_WARNING_MS = 5000;

const allowedServers = ["EU-1", "EU-2", "EU-3"];
const allowedSkins = ["green", "fire", "ice", "toxic", "shadow", "gold", "neon"];

const MEGA_TYPES = ["shrink", "meteor", "gravity"];

function normalizeServer(code) {
  const clean = (code || "EU-1").toUpperCase();
  return allowedServers.includes(clean) ? clean : "EU-1";
}

function xpToLevel(xp) {
  return Math.floor(Math.sqrt(xp / 40)) + 1;
}

function xpToRank(xp) {
  if (xp >= 12000) return "Legend";
  if (xp >= 7000) return "Master";
  if (xp >= 3500) return "Diamond";
  if (xp >= 1500) return "Gold";
  if (xp >= 500) return "Silver";
  return "Bronze";
}

function addXp(p, amount) {
  p.xp += amount;
  p.level = xpToLevel(p.xp);
  p.rank = xpToRank(p.xp);
}

function randomSpawn(maxDist = 850) {
  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * maxDist;
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

function randomEventDelay(playerCount = 1) {
  if (playerCount <= 1) return (25 + Math.random() * 35) * 1000;
  if (playerCount <= 3) return (40 + Math.random() * 80) * 1000;
  return (60 + Math.random() * 240) * 1000;
}

function baseRadius(p) {
  return Math.min(130, 22 + Math.sqrt(p.mass) * 5.2);
}

function makeFood() {
  const s = randomSpawn(950);
  return {
    id: Math.random().toString(36).slice(2),
    x: s.x,
    y: s.y,
    r: 6 + Math.random() * 4,
    value: 0.4
  };
}

function makePlayer(id, name, skin) {
  const s = randomSpawn();

  return {
    id,
    name: name || "Player",
    skin: allowedSkins.includes(skin) ? skin : "green",
    x: s.x,
    y: s.y,
    vx: 0,
    vy: 0,
    r: 22,
    mass: 0,
    kills: 0,
    streak: 0,
    xp: 0,
    level: 1,
    rank: "Bronze",
    foodCollected: 0,
    alive: true,
    respawnAt: 0,
    lastHitBy: null,
    lastKillerName: null,
    dashCooldown: 0,
    dangerStartedAt: 0,
    dangerTimeLeft: 0,
    kingUntil: 0,
    lastKillAt: 0,
    streakBanner: null
  };
}

function respawnPlayer(p) {
  const s = randomSpawn();

  p.x = s.x;
  p.y = s.y;
  p.vx = 0;
  p.vy = 0;
  p.r = 22;
  p.mass = 0;
  p.streak = 0;
  p.alive = true;
  p.respawnAt = 0;
  p.lastHitBy = null;
  p.lastKillerName = null;
  p.dashCooldown = 0;
  p.dangerStartedAt = 0;
  p.dangerTimeLeft = 0;
  p.kingUntil = 0;
  p.streakBanner = null;
}

function makeRoom() {
  const foods = [];
  for (let i = 0; i < 180; i++) foods.push(makeFood());

  return {
    players: {},
    foods,
    killFeed: [],
    event: null,
    eventMessage: "",
    nextEventAt: Date.now() + randomEventDelay(0),
    hitEffects: [],
    arenaRadius: ARENA,
    megaWarning: null,
    meteors: [],
    eventParticipants: new Set()
  };
}

function ensureRoom(code) {
  const serverCode = normalizeServer(code);
  if (!rooms[serverCode]) rooms[serverCode] = makeRoom();
  return rooms[serverCode];
}

function addFeed(room, text) {
  room.killFeed.unshift(text);
  room.killFeed = room.killFeed.slice(0, 5);
}

function getEffectiveArena(room) {
  return room.arenaRadius || ARENA;
}

function scheduleMegaWarning(room) {
  const type = MEGA_TYPES[Math.floor(Math.random() * MEGA_TYPES.length)];
  const labels = {
    shrink: "SHRINKING RING",
    meteor: "METEOR SHOWER",
    gravity: "GRAVITY PULSE"
  };

  room.megaWarning = {
    type,
    label: labels[type],
    endsAt: Date.now() + MEGA_WARNING_MS
  };
  room.eventMessage = `⚠ MEGA EVENT: ${labels[type]} INCOMING`;
  addFeed(room, room.eventMessage);
}

function startMegaEvent(room) {
  const type = room.megaWarning.type;
  room.megaWarning = null;
  const now = Date.now();

  if (type === "shrink") {
    room.event = {
      type: "mega_shrink",
      endsAt: now + 25000,
      startArena: ARENA,
      minArena: 520
    };
    room.eventMessage = "MEGA: SHRINKING RING";
  } else if (type === "meteor") {
    room.event = {
      type: "mega_meteor",
      endsAt: now + 22000,
      nextMeteorAt: now + 400
    };
    room.meteors = [];
    room.eventMessage = "MEGA: METEOR SHOWER";
  } else {
    room.event = {
      type: "mega_gravity",
      endsAt: now + 18000,
      strength: 0.35
    };
    room.eventMessage = "MEGA: GRAVITY PULSE";
  }

  room.eventParticipants = new Set();
  addFeed(room, room.eventMessage);
}

function spawnRandomEvent(room) {
  if (Math.random() < 0.14) {
    scheduleMegaWarning(room);
    return;
  }

  const roll = Math.random();
  const s = randomSpawn(750);

  if (roll < 0.4) {
    room.event = {
      type: "king",
      x: s.x,
      y: s.y,
      r: 90,
      captureId: null,
      captureStart: 0,
      endsAt: Date.now() + 45000
    };
    room.eventMessage = "RING MASTER ZONE";
  } else if (roll < 0.75) {
    room.event = {
      type: "gold",
      x: s.x,
      y: s.y,
      r: 34,
      endsAt: Date.now() + 30000
    };
    room.eventMessage = "GOLDEN CORE";
  } else {
    room.event = {
      type: "blackhole",
      x: s.x,
      y: s.y,
      r: 70,
      vx: (Math.random() - 0.5) * 1.6,
      vy: (Math.random() - 0.5) * 1.6,
      endsAt: Date.now() + 40000
    };
    room.eventMessage = "VOID RIFT";
  }

  room.eventParticipants = new Set();
  addFeed(room, room.eventMessage);
}

function awardEventSurvival(room) {
  for (const p of Object.values(room.players)) {
    if (p.alive && room.eventParticipants.has(p.id)) {
      addXp(p, 100);
    }
  }
}

function endEvent(room) {
  if (room.event && !room.event.type.startsWith("mega_")) {
    awardEventSurvival(room);
  }

  if (room.event && room.event.type === "mega_shrink") {
    room.arenaRadius = ARENA;
    awardEventSurvival(room);
  }

  if (room.event && (room.event.type === "mega_meteor" || room.event.type === "mega_gravity")) {
    awardEventSurvival(room);
  }

  room.event = null;
  room.eventMessage = "";
  room.meteors = [];
  const pc = Object.keys(room.players).length;
  room.nextEventAt = Date.now() + randomEventDelay(pc);
  room.eventParticipants = new Set();
}

function spawnMeteor(room) {
  const arena = getEffectiveArena(room);
  const angle = Math.random() * Math.PI * 2;
  const dist = arena + 120;
  room.meteors.push({
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    vx: -Math.cos(angle) * 14,
    vy: -Math.sin(angle) * 14,
    r: 18 + Math.random() * 14,
    life: 120
  });
}

function setStreakBanner(killer) {
  const now = Date.now();
  if (killer.lastKillAt && now - killer.lastKillAt < 8000) {
    killer.streak++;
  } else {
    killer.streak = 1;
  }
  killer.lastKillAt = now;

  if (killer.streak === 2) killer.streakBanner = "DOUBLE KILL";
  else if (killer.streak === 3) killer.streakBanner = "TRIPLE KILL";
  else if (killer.streak >= 5) killer.streakBanner = "GODLIKE";
  else killer.streakBanner = null;
}

function getServersInfo() {
  return allowedServers.map(code => {
    const room = rooms[code];
    return {
      code,
      online: room ? Object.keys(room.players).length : 0
    };
  });
}

function killPlayer(room, p, text, killer) {
  p.alive = false;
  p.respawnAt = Date.now() + 3000;
  p.vx = 0;
  p.vy = 0;
  p.lastKillerName = killer && killer.id !== p.id ? killer.name : null;
  addFeed(room, text || `${p.name} died`);
}

io.on("connection", socket => {
  socket.data = socket.data || {};

  socket.on("spectate", ({ serverCode }) => {
    const code = normalizeServer(serverCode);

    if (socket.data.spectating) socket.leave(socket.data.spectating);
    if (socket.data.room) socket.leave(socket.data.room);

    ensureRoom(code);

    socket.join(code);
    socket.data.spectating = code;
  });

  socket.on("join", ({ serverCode, name, skin }) => {
    const code = normalizeServer(serverCode);
    const safeSkin = allowedSkins.includes(skin) ? skin : "green";

    if (socket.data.spectating) {
      socket.leave(socket.data.spectating);
      socket.data.spectating = null;
    }

    const room = ensureRoom(code);
    room.players[socket.id] = makePlayer(socket.id, name, safeSkin);

    socket.join(code);
    socket.data.room = code;
  });

  socket.on("input", input => {
    const room = rooms[socket.data.room];
    if (!room) return;

    const p = room.players[socket.id];
    if (!p || !p.alive) return;

    let speed = Math.max(0.2, 5.2 - p.mass * 0.015);

    let ax = 0;
    let ay = 0;

    if (input.up) ay -= 1;
    if (input.down) ay += 1;
    if (input.left) ax -= 1;
    if (input.right) ax += 1;

    const len = Math.hypot(ax, ay);
    if (len > 0) {
      ax /= len;
      ay /= len;
      p.vx += ax * speed * 0.22;
      p.vy += ay * speed * 0.22;
    }

    if (input.dash && p.dashCooldown <= 0 && len > 0) {
      p.vx += ax * 16;
      p.vy += ay * 16;
      p.dashCooldown = 72;
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    if (code && rooms[code]) {
      delete rooms[code].players[socket.id];
    }
  });
});

function updateRoom(room) {
  const now = Date.now();

  while (room.foods.length < 180) {
    room.foods.push(makeFood());
  }

  if (room.megaWarning && now >= room.megaWarning.endsAt) {
    startMegaEvent(room);
  }

  if (!room.event && !room.megaWarning && now >= room.nextEventAt) {
    spawnRandomEvent(room);
  }

  if (room.event && now >= room.event.endsAt) {
    endEvent(room);
  }

  if (room.event && room.event.type === "mega_shrink") {
    const t = 1 - (room.event.endsAt - now) / 25000;
    room.arenaRadius = room.event.startArena - (room.event.startArena - room.event.minArena) * Math.min(1, t);
  }

  if (room.event && room.event.type === "mega_meteor" && now >= room.event.nextMeteorAt) {
    spawnMeteor(room);
    room.event.nextMeteorAt = now + 350 + Math.random() * 450;
  }

  if (room.event && room.event.type === "blackhole") {
    room.event.x += room.event.vx;
    room.event.y += room.event.vy;

    if (Math.hypot(room.event.x, room.event.y) > ARENA - 80) {
      room.event.vx *= -1;
      room.event.vy *= -1;
    }
  }

  const arena = getEffectiveArena(room);

  for (let i = room.meteors.length - 1; i >= 0; i--) {
    const m = room.meteors[i];
    m.x += m.vx;
    m.y += m.vy;
    m.life--;

    if (m.life <= 0 || Math.hypot(m.x, m.y) < 40) {
      room.meteors.splice(i, 1);
    }
  }

  const players = Object.values(room.players);

  for (const p of players) {
    if (!p.alive) {
      if (now >= p.respawnAt) respawnPlayer(p);
      continue;
    }

    if (p.dashCooldown > 0) p.dashCooldown--;

    if (room.event && room.event.type === "mega_gravity") {
      const dist = Math.hypot(p.x, p.y) || 1;
      p.vx -= (p.x / dist) * room.event.strength;
      p.vy -= (p.y / dist) * room.event.strength;
    }

    for (const m of room.meteors) {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < p.r + m.r) {
        const nx = (p.x - m.x) / (d || 1);
        const ny = (p.y - m.y) / (d || 1);
        p.vx += nx * 22;
        p.vy += ny * 22;
        m.life = 0;
      }
    }

    p.vx *= 0.93;
    p.vy *= 0.93;

    p.x += p.vx;
    p.y += p.vy;

    p.r = baseRadius(p);

    const distCenter = Math.hypot(p.x, p.y);

    if (distCenter > arena - p.r) {
      if (!p.dangerStartedAt) p.dangerStartedAt = now;

      p.dangerTimeLeft = Math.max(0, DANGER_TIME - (now - p.dangerStartedAt));

      const pushX = -p.x / distCenter;
      const pushY = -p.y / distCenter;
      p.vx += pushX * 0.45;
      p.vy += pushY * 0.45;

      if (p.dangerTimeLeft <= 0) {
        const killer = room.players[p.lastHitBy];

        if (killer && killer.id !== p.id) {
          killer.kills++;
          setStreakBanner(killer);
          killer.mass += Math.max(1, p.mass * 0.5);
          addXp(killer, 50);
          killPlayer(room, p, `${killer.name} knocked ${p.name} out`, killer);
        } else {
          killPlayer(room, p, `${p.name} vanished outside arena`, null);
        }
      }
    } else {
      p.dangerStartedAt = 0;
      p.dangerTimeLeft = 0;
    }

    for (let i = room.foods.length - 1; i >= 0; i--) {
      const f = room.foods[i];
      const d = Math.hypot(p.x - f.x, p.y - f.y);

      if (d < p.r + f.r) {
        const bonus = p.mass < 8 ? 0.25 : 0;
        p.mass += f.value + bonus;
        p.foodCollected++;
        addXp(p, p.mass < 8 ? 4 : 2);
        room.foods.splice(i, 1);
      }
    }

    if (room.event) {
      const e = room.event;
      room.eventParticipants.add(p.id);

      if (e.type === "gold" && e.x != null) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < p.r + e.r) {
          p.mass += 12;
          addFeed(room, `${p.name} collected GOLD BALL`);
          endEvent(room);
        }
      }

      if (e.type === "blackhole" && e.x != null) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < p.r + e.r) {
          killPlayer(room, p, `${p.name} vanished in BLACK HOLE`, null);
        }
      }

      if (e.type === "king" && e.x != null) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < p.r + e.r) {
          p.mass += 0.03;
          p.kingUntil = now + 1000;
        }
      }
    }

    if (p.streakBanner) {
      if (!p.streakBannerUntil) p.streakBannerUntil = now + 2000;
      if (now >= p.streakBannerUntil) {
        p.streakBanner = null;
        p.streakBannerUntil = 0;
      }
    }
  }

  for (const a of players) {
    if (!a.alive) continue;

    for (const b of players) {
      if (!b.alive || a.id === b.id) continue;

      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < a.r + b.r) {
        const nx = (b.x - a.x) / (d || 1);
        const ny = (b.y - a.y) / (d || 1);

        b.vx += nx * 2.8;
        b.vy += ny * 2.8;
        a.vx -= nx * 1.4;
        a.vy -= ny * 1.4;

        const hitPower = Math.max(3.2, (a.mass - b.mass) * 0.1 + Math.hypot(a.vx, a.vy) * 1.05);
        b.vx += nx * hitPower;
        b.vy += ny * hitPower;

        a.vx -= nx * 1;
        a.vy -= ny * 1;

        b.lastHitBy = a.id;
        room.hitEffects.push({
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          power: hitPower,
          victimId: b.id
        });
        if (room.hitEffects.length > 12) room.hitEffects.shift();
      }
    }
  }

  room.meteors = room.meteors.filter(m => m.life > 0);
}

function publicState(room) {
  const hitEffects = room.hitEffects;
  room.hitEffects = [];

  const players = Object.values(room.players).map(p => ({
    i: p.id,
    n: p.name,
    s: p.skin,
    x: p.x,
    y: p.y,
    r: p.r,
    m: p.mass,
    k: p.kills,
    a: p.alive,
    l: p.level,
    rk: p.rank,
    xp: p.xp,
    d: p.dangerTimeLeft,
    sb: p.streakBanner,
    sbu: p.streakBannerUntil || 0
  }));

  return {
    p: players,
    f: room.foods,
    ar: ARENA,
    arr: getEffectiveArena(room),
    kf: room.killFeed,
    ev: room.event,
    em: room.eventMessage,
    et: Math.max(0, room.nextEventAt - Date.now()),
    mw: room.megaWarning,
    met: room.meteors,
    he: hitEffects,
    on: Object.keys(room.players).length,
    srv: getServersInfo()
  };
}

const TICK_RATE = 15;
setInterval(() => {
  for (const code of allowedServers) {
    const room = ensureRoom(code);
    updateRoom(room);
    io.to(code).emit("state", publicState(room));
  }
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
