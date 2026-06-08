// Optimized spatial grid for collision detection
class SpatialGrid {
  constructor(cellSize, arenaSize) {
    this.cellSize = cellSize;
    this.arenaSize = arenaSize;
    this.cells = new Map();
    this.entityCount = 0;
  }

  _getKey(x, y) {
    const gx = Math.floor((x + this.arenaSize) / this.cellSize);
    const gy = Math.floor((y + this.arenaSize) / this.cellSize);
    return `${gx},${gy}`;
  }

  _getCellRange(x, y, radius) {
    const minX = Math.floor((x - radius + this.arenaSize) / this.cellSize);
    const maxX = Math.floor((x + radius + this.arenaSize) / this.cellSize);
    const minY = Math.floor((y - radius + this.arenaSize) / this.cellSize);
    const maxY = Math.floor((y + radius + this.arenaSize) / this.cellSize);
    return { minX, maxX, minY, maxY };
  }

  clear() {
    this.cells.clear();
    this.entityCount = 0;
  }

  insert(entity) {
    const { minX, maxX, minY, maxY } = this._getCellRange(
      entity.x, entity.y, entity.radius || entity.r
    );

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = `${gx},${gy}`;
        if (!this.cells.has(key)) {
          this.cells.set(key, new Set());
        }
        this.cells.get(key).add(entity);
      }
    }
    this.entityCount++;
  }

  remove(entity) {
    const { minX, maxX, minY, maxY } = this._getCellRange(
      entity.x, entity.y, entity.radius || entity.r
    );

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gy = minY; gy <= maxY; gy++) {
        const key = `${gx},${gy}`;
        const cell = this.cells.get(key);
        if (cell) {
          cell.delete(entity);
          if (cell.size === 0) {
            this.cells.delete(key);
          }
        }
      }
    }
    this.entityCount--;
  }

  query(x, y, radius) {
    const results = new Set();
    const { minX, maxX, minY, maxY } = this._getCellRange(x, y, radius);

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

  queryCircle(x, y, radius, filterFn = null) {
    const candidates = this.query(x, y, radius);
    const results = [];
    const radiusSq = radius * radius;

    for (const entity of candidates) {
      if (filterFn && !filterFn(entity)) continue;

      const dx = entity.x - x;
      const dy = entity.y - y;
      const distSq = dx * dx + dy * dy;

      if (distSq <= radiusSq) {
        results.push({ entity, dist: Math.sqrt(distSq) });
      }
    }

    return results.sort((a, b) => a.dist - b.dist);
  }

  getStats() {
    return {
      cellCount: this.cells.size,
      entityCount: this.entityCount,
      avgEntitiesPerCell: this.entityCount / (this.cells.size || 1)
    };
  }
}

module.exports = SpatialGrid;
