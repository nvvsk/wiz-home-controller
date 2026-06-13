const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  VERBOSE: 3,
  TRACE: 4
};

// ISO-without-millis-without-Z keeps the line short and still sorts lexically.
function ts() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

class Logger {
  constructor(level = 'INFO') {
    this.level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO;
  }

  setLevel(level) {
    this.level = LOG_LEVELS[level.toUpperCase()] || LOG_LEVELS.INFO;
  }

  error(message, ...args) {
    if (this.level >= LOG_LEVELS.ERROR) {
      console.error(`${ts()} ❌ [ERROR] ${message}`, ...args);
    }
  }

  warn(message, ...args) {
    if (this.level >= LOG_LEVELS.WARN) {
      console.warn(`${ts()} ⚠️  [WARN]  ${message}`, ...args);
    }
  }

  info(message, ...args) {
    if (this.level >= LOG_LEVELS.INFO) {
      console.log(`${ts()} ℹ️  [INFO]  ${message}`, ...args);
    }
  }

  verbose(message, ...args) {
    if (this.level >= LOG_LEVELS.VERBOSE) {
      console.log(`${ts()} 📝 [VERB]  ${message}`, ...args);
    }
  }

  trace(message, ...args) {
    if (this.level >= LOG_LEVELS.TRACE) {
      console.log(`${ts()} 🔍 [TRACE] ${message}`, ...args);
    }
  }
}

const logger = new Logger(process.env.LOG_LEVEL || 'INFO');

module.exports = logger;
