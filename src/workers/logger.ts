/**
 * Structured logging for the worker.
 *
 * RUNBOOK §5: logs are JSON, one object per line, and **every line carries the
 * engagement id when there is one**. That is not a style preference — the first
 * query in almost every investigation is `grep '"engagementId":"<ID>"'` across
 * both services, and a line without it is a line that will not be found.
 *
 * The `msg` values here are the ones the runbook's table names: `retention.*`,
 * `purge.planned`, `purge.started`, `purge.completed`, `purge.failed`. Renaming
 * one silently breaks a documented 3am procedure.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  engagementId?: string | undefined;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, fields: LogFields): void {
  const line = JSON.stringify({ level, msg, ...fields, ts: new Date().toISOString() });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  info: (msg: string, fields: LogFields = {}) => {
    emit('info', msg, fields);
  },
  warn: (msg: string, fields: LogFields = {}) => {
    emit('warn', msg, fields);
  },
  error: (msg: string, fields: LogFields = {}) => {
    emit('error', msg, fields);
  },
};

/** Errors reach the log as a message, never as an object that stringifies to `{}`. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
