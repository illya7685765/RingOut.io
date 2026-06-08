// Logging utility with performance tracking
class Logger {
  constructor() {
    this.logs = [];
    this.performanceMetrics = new Map();
    this.startTime = Date.now();
  }

  log(level, message, data = null) {
    const entry = {
      timestamp: Date.now(),
      level,
      message,
      data
    };
    
    this.logs.push(entry);
    
    // Keep only last 1000 logs in memory
    if (this.logs.length > 1000) {
      this.logs.shift();
    }
    
    // Console output
    const prefix = `[${level.toUpperCase()}]`;
    const logStr = data ? `${prefix} ${message}` : `${prefix} ${message}`;
    
    switch(level) {
      case 'error':
        console.error(logStr, data || '');
        break;
      case 'warn':
        console.warn(logStr, data || '');
        break;
      case 'info':
        console.log(logStr, data || '');
        break;
      default:
        console.log(logStr, data || '');
    }
  }

  error(message, data) { this.log('error', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  info(message, data) { this.log('info', message, data); }
  debug(message, data) { this.log('debug', message, data); }

  // Performance tracking
  startTimer(label) {
    this.performanceMetrics.set(label, {
      startTime: process.hrtime.bigint(),
      count: (this.performanceMetrics.get(label)?.count || 0) + 1
    });
  }

  endTimer(label) {
    const metric = this.performanceMetrics.get(label);
    if (!metric) return;

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - metric.startTime) / 1000000; // Convert to ms

    const totalTime = (metric.totalTime || 0) + duration;
    this.performanceMetrics.set(label, {
      ...metric,
      totalTime,
      avgTime: totalTime / metric.count,
      lastTime: duration
    });
  }

  getMetrics() {
    const metrics = {};
    for (const [label, data] of this.performanceMetrics) {
      metrics[label] = {
        count: data.count,
        totalTime: data.totalTime?.toFixed(2) + 'ms',
        avgTime: data.avgTime?.toFixed(2) + 'ms',
        lastTime: data.lastTime?.toFixed(2) + 'ms'
      };
    }
    return metrics;
  }

  printMetrics() {
    console.log('\n=== Performance Metrics ===');
    const metrics = this.getMetrics();
    for (const [label, data] of Object.entries(metrics)) {
      console.log(`${label}:`, data);
    }
    console.log('============================\n');
  }

  getRecentLogs(count = 50) {
    return this.logs.slice(-count);
  }
}

module.exports = new Logger();
