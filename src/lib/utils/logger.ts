// Defines the severity levels for logging messages
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

// Represents a structured log entry with metadata
export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: Date;
  service?: string; // Service name for log identification
}

/**
 * Logger class for structured logging with service identification
 * Provides methods for different log levels and automatic timestamping
 */
export class Logger {
  private readonly serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  /**
   * Converts unknown data to a loggable record
   * Handles Error objects and null/undefined values
   */
  private toLoggable(data: unknown): Record<string, unknown> {
    if (data === null || data === undefined) {
      return {};
    }

    if (data instanceof Error) {
      return {
        error: {
          message: data.message,
          stack: data.stack,
          name: data.name,
        },
      };
    }

    if (typeof data === "object") {
      return data as Record<string, unknown>;
    }

    return { value: data };
  }

  debug(message: string, context?: unknown): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: unknown): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: unknown): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: unknown): void {
    // Combine error and additional context
    const errorContext = error
      ? {
          ...this.toLoggable(context),
          ...this.toLoggable(error),
        }
      : this.toLoggable(context);

    this.log(LogLevel.ERROR, message, errorContext);
  }

  // Core logging method that formats and outputs log entries
  private log(level: LogLevel, message: string, context?: unknown): void {
    const entry: LogEntry = {
      level,
      message,
      context: this.toLoggable(context),
      timestamp: new Date(),
      service: this.serviceName,
    };

    // Route to appropriate console method based on log level
    const logData = {
      service: entry.service,
      msg: message,
      ...entry.context,
    };

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logData);
        break;
      case LogLevel.INFO:
        console.info(logData);
        break;
      case LogLevel.WARN:
        console.warn(logData);
        break;
      case LogLevel.ERROR:
        console.error(logData);
        break;
    }
  }
}

// Factory function for creating logger instances with service identification
export function createLogger(serviceName: string): Logger {
  return new Logger(serviceName);
}
