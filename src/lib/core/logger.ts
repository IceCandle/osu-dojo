/**
 * Structured logging system for osu!dojo
 * Format: [TIMESTAMP] [LEVEL] [COMPONENT] {context} message
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/**
 * Format timestamp in ISO 8601 format
 */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Format context object as JSON string
 */
function formatContext(context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  return JSON.stringify(context);
}

/**
 * Core logging function
 */
function log(
  level: LogLevel,
  component: string,
  message: string,
  context?: LogContext,
  baseContext?: LogContext,
): void {
  const timestamp = formatTimestamp();
  const levelStr = level.toUpperCase().padEnd(5);
  const componentStr = component.padEnd(15);

  // Merge base context with provided context
  const mergedContext = { ...baseContext, ...context };
  const contextStr = formatContext(mergedContext);

  // Format: [TIMESTAMP] [LEVEL] [COMPONENT] {context} message
  const parts = [`[${timestamp}]`, `[${levelStr}]`, `[${componentStr}]`];

  if (contextStr) {
    parts.push(contextStr);
  }

  parts.push(message);

  const logMessage = parts.join(' ');

  // Output to console based on log level
  switch (level) {
    case 'debug':
      console.debug(logMessage);
      break;
    case 'info':
      console.info(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'error':
      console.error(logMessage);
      break;
  }
}

/**
 * Create a logger instance for a specific component
 *
 * @param component - Component name (e.g., "Bot", "API", "Queue")
 * @param baseContext - Optional base context that will be merged into all log calls
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * const logger = createLogger('Bot', { version: '1.0.0' });
 * logger.info('Starting bot', { user: 'test' });
 * // Output: [2024-01-01T00:00:00.000Z] [INFO ] [Bot            ] {"version":"1.0.0","user":"test"} Starting bot
 */
export function createLogger(component: string, baseContext?: LogContext): Logger {
  return {
    debug(message: string, context?: LogContext): void {
      log('debug', component, message, context, baseContext);
    },
    info(message: string, context?: LogContext): void {
      log('info', component, message, context, baseContext);
    },
    warn(message: string, context?: LogContext): void {
      log('warn', component, message, context, baseContext);
    },
    error(message: string, context?: LogContext): void {
      log('error', component, message, context, baseContext);
    },
  };
}

/**
 * Default logger instance (use when component-specific logger not needed)
 */
export const defaultLogger = createLogger('Default');
