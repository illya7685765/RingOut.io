// Rate limiter for anti-cheat and DDoS protection
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.clients = new Map();
  }

  _cleanup() {
    const now = Date.now();
    for (const [clientId, data] of this.clients) {
      if (now - data.lastReset > this.windowMs * 2) {
        this.clients.delete(clientId);
      }
    }
  }

  check(clientId) {
    this._cleanup();

    const now = Date.now();
    let clientData = this.clients.get(clientId);

    if (!clientData) {
      clientData = {
        count: 0,
        lastReset: now,
        violations: 0
      };
      this.clients.set(clientId, clientData);
    }

    // Reset if window expired
    if (now - clientData.lastReset >= this.windowMs) {
      clientData.count = 0;
      clientData.lastReset = now;
    }

    clientData.count++;

    if (clientData.count > this.maxRequests) {
      clientData.violations++;
      return {
        allowed: false,
        remaining: 0,
        resetAfter: this.windowMs - (now - clientData.lastReset),
        violations: clientData.violations
      };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - clientData.count,
      resetAfter: this.windowMs - (now - clientData.lastReset),
      violations: clientData.violations
    };
  }

  reset(clientId) {
    this.clients.delete(clientId);
  }

  getStats() {
    return {
      totalClients: this.clients.size,
      totalViolations: Array.from(this.clients.values())
        .reduce((sum, c) => sum + c.violations, 0)
    };
  }
}

// Multiple rate limiters for different actions
class RateLimiters {
  constructor() {
    this.inputLimiter = new RateLimiter(30, 1000); // 30 inputs per second
    this.packetLimiter = new RateLimiter(60, 1000); // 60 packets per second
    this.actionLimiter = new RateLimiter(10, 1000); // 10 actions per second
  }

  checkInput(clientId) {
    return this.inputLimiter.check(clientId);
  }

  checkPacket(clientId) {
    return this.packetLimiter.check(clientId);
  }

  checkAction(clientId) {
    return this.actionLimiter.check(clientId);
  }

  reset(clientId) {
    this.inputLimiter.reset(clientId);
    this.packetLimiter.reset(clientId);
    this.actionLimiter.reset(clientId);
  }

  getStats() {
    return {
      input: this.inputLimiter.getStats(),
      packet: this.packetLimiter.getStats(),
      action: this.actionLimiter.getStats()
    };
  }
}

module.exports = RateLimiters;
