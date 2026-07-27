<!-- Once this directory changes, update this README.md -->

# Background Activity Module

The background-activity module owns the in-memory runtime registry for observable server work. It gives every registered activity a stable owner namespace and key, a snapshot for the developer activity overview, and a single-flight execution lifecycle.

It does not persist work, schedule recurring work, define domain semantics, or execute shell commands. The owning domain registers its own `run(reporter, context)` callback and decides when to request it. The registry only records the runtime state: idle, running, succeeded, or failed; timestamps; reported progress; and the latest error.

## Files

- **index.ts**: Elysia routes. Listing and manual execution have generated CLI metadata as `cradle background-activity list` and `cradle background-activity run <ownerNamespace> <key>`.
- **model.ts**: TypeBox list and run response schemas.
- **service.ts**: Runtime registration, snapshots, single-flight execution, manual-run validation, and lifecycle reset.

## Interface and lifecycle

Owners register a `BackgroundActivityDescriptor` with `ownerNamespace`, `key`, presentation metadata, `manuallyRunnable`, and an async `run(reporter, context)` callback. The context distinguishes `automatic` owner/scheduler requests from `manual` HTTP/CLI requests so an owner can gate opportunistic work without blocking an explicit user action. Re-registering the same owner/key is idempotent and updates metadata without clearing the current snapshot.

`requestRun` is available to the owning domain regardless of manual capability. The HTTP route calls `requestManualRun`, which rejects missing activities with `background_activity_not_found` and non-manual activities with `background_activity_not_manually_runnable`.

The registry is intentionally process-local. `stop`/`reset` clear registrations and invalidate updates from any callback that completes after shutdown. Durable jobs and restart recovery remain the responsibility of the background-job module.
