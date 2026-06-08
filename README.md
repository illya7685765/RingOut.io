# RingOut.io

A production-ready Agar.io-style multiplayer browser game built with Node.js, Express, and Socket.IO.

## Features

### Gameplay
- **Agar.io-style mechanics**: Larger cells eat smaller cells
- **Split mechanic**: Press Q to split your cell and launch half forward
- **Eject mass**: Press E to eject mass that can be eaten by others
- **Mass-based movement**: Speed decreases as you grow larger
- **Dash ability**: Press SPACE to dash in your movement direction
- **Food collection**: Collect food pellets to grow

### Performance Optimizations
- **Interest management**: Only send nearby entities to each player
- **Delta compression**: Send only changed data to reduce bandwidth
- **Spatial grid**: Optimized collision detection with O(1) lookups
- **Viewport culling**: Render only visible objects on client
- **Map-based lookups**: O(1) player/food lookups instead of array searches
- **Leaderboard caching**: Avoid expensive sorts every frame
- **Batch rendering**: Group food by color to reduce draw calls

### Anti-Cheat & Security
- **Rate limiting**: Prevent packet flooding and DDoS
- **Position validation**: Server-side movement validation
- **Speed checks**: Detect impossible movement speeds
- **Mass validation**: Prevent rapid mass increases

### Progression System
- **XP and leveling**: Gain XP as you play and level up
- **Achievements**: Unlock achievements for various milestones
- **Daily quests**: Complete daily challenges for rewards
- **Skins**: Unlock skins by reaching kill milestones
- **Statistics**: Track your total kills, best mass, and games played

### Multiplayer
- **Multiple servers**: EU-1, EU-2, EU-3, US-1, US-2, ASIA-1
- **Spectator mode**: Watch games without participating
- **Kill feed**: See who's eliminating whom
- **Leaderboard**: Real-time ranking of top players
- **100+ players**: Support for 100+ concurrent players per room

### UI/UX
- **Glassmorphism design**: Modern 2026 aesthetic
- **Mobile responsive**: Touch controls for mobile devices
- **Smooth camera**: Improved camera smoothing
- **Client prediction**: Responsive movement with server reconciliation
- **Interpolation**: Smooth entity movement between updates

## Architecture

### Backend (Modular)
```
server/
├── config.js           # Game configuration
├── gameLoop.js         # Fixed timestep game loop
├── game/
│   ├── player.js       # Player entity with Agar.io mechanics
│   ├── food.js         # Food and ejected mass entities
│   └── room.js         # Room management with interest management
├── network/
│   └── socketHandler.js # Socket.IO event handling
└── utils/
    ├── logger.js       # Performance logging
    ├── spatialGrid.js  # Optimized spatial partitioning
    ├── rateLimiter.js  # Rate limiting for anti-cheat
    └── antiCheat.js    # Anti-cheat validation
```

### Frontend (Optimized)
- Map-based entity lookups (O(1) instead of O(n))
- Viewport culling for rendering
- Batch rendering by color
- Cached leaderboard calculations
- Client-side prediction with server reconciliation
- Smooth interpolation

## Installation

```bash
npm install
```

## Running

```bash
npm start
```

The server will start on port 3000 (or PORT environment variable).

Open `http://localhost:3000` in your browser.

## Controls

- **WASD**: Move
- **SPACE**: Dash
- **Q**: Split
- **E**: Eject mass

## Configuration

Edit `server/config.js` to adjust game settings:

- Arena size
- Tick rate
- Food count
- Movement speed
- Split/eject mechanics
- Rate limiting thresholds
- Anti-cheat tolerances

## Performance

The server is optimized to handle 100+ concurrent players per room with:

- 30 Hz game tick rate
- 30 Hz snapshot rate
- Interest management (only send nearby entities)
- Delta compression (only send changed data)
- Spatial grid collision detection
- Memory leak prevention
- Graceful shutdown handling

## License

MIT 
