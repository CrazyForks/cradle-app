# Logging

Shared server logging infrastructure. Startup, plugin host, request, and fatal process diagnostics go through this namespace so stdout and file logging stay consistent. The logger writes human-readable terminal output and raw JSON lines to `CRADLE_LOG_FILE` or `<CRADLE_DATA_DIR>/server.log`.

The logging owner rotates the file at 64 MiB, retains three numbered generations, and reopens the active Pino destination after same-directory atomic renames. Maintenance checks the limit every 15 minutes and also on server startup.

Desktop owns `server-process-exits.ndjson` separately. It rotates that diagnostic stream at 8 MiB before appending a new exit record and retains three generations. Neither policy deletes database observability history.

## Files

- **logger.ts**: pino-backed logger wrapper, child logger creation, explicit fatal-exit flush, and bounded file rotation. Stdout uses NestJS-style pretty printing with picocolors; the file destination writes raw JSON.
