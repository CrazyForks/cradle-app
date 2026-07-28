# Plan 071: Eliminate active-run replay retention and recover from snapshots

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `plans/README.md` unless a reviewer dispatched you and told you they maintain
> the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 28ff968c..HEAD -- \
>   apps/server/src/modules/chat-runtime \
>   apps/server/src/modules/sync-gateway \
>   apps/server/src/modules/observability \
>   apps/server/src/telemetry/metrics.ts \
>   apps/server/tests \
>   apps/server/openapi.json \
>   apps/web/src/api-gen \
>   observability/grafana/provisioning/dashboards \
>   packages/ai-sdk/README.md
>
> git diff --stat -- \
>   apps/server/src/modules/chat-runtime \
>   apps/server/src/modules/sync-gateway \
>   apps/server/src/modules/observability \
>   apps/server/src/telemetry/metrics.ts \
>   apps/server/tests \
>   apps/server/openapi.json \
>   apps/web/src/api-gen \
>   observability/grafana/provisioning/dashboards \
>   packages/ai-sdk/README.md
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding. The second
> command intentionally catches uncommitted overlap, which already existed in
> lifecycle and Sync files when this plan was authored. Preserve those changes
> and establish their ownership before editing. A semantic mismatch or
> unexplained overlap is a STOP condition.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: none; this deliberately supersedes only the active-run replay-retention part of completed Plan 054
- **Category**: perf
- **Planned at**: commit `28ff968c`, 2026-07-27

## Why this matters

An observed active Chat run grew its in-memory replay from 198 to 3,448
entries, including 2,982 `tool-output-available` snapshots. Server heap grew
from about 445 MB to about 1.07 GB while the merged durable snapshot was only
about 0.6 MB. The active-run replay log retains every historical
`UIMessageChunk`, so repeated updates to one large tool output retain all old
payload versions until run release.

The product does not require historical chunk replay anymore. Commit
`3d8f57e3` added a complete `data-cradle-stream-snapshot` recovery frame that
serializes the current message plus active text, reasoning, and partial tool
input state. The correct live-run model is therefore:

```text
one current UIMessage projection
+ one monotonic run cursor
+ live subscribers
+ scalar publication diagnostics
```

It must not include an array of historical chunks. A reconnect receives one
snapshot at cursor N and then live entries N+1 onward. This is semantic
compaction, not truncation: current text, tool output, metadata, and active
stream identities remain complete.

## Current state

### Repository and verification conventions

- The repository is a pnpm TypeScript monorepo.
- `apps/server` is an Elysia application. `apps/server/AGENTS.md` requires
  module ownership, TypeScript-first contracts, Drizzle for database work, and
  focused Vitest coverage for runtime lifecycle changes.
- Chat Runtime owns active run state and streaming semantics.
- Sync Gateway owns delivery/backpressure only; it must not allocate Chat
  Runtime cursors.
- `@cradleapp/ai-sdk` owns `UIMessageChunk` projection and snapshot
  serialization.
- Commit messages use Conventional Commit-style subjects, for example
  `feat(ai-sdk): add @cradleapp/ai-sdk and adopt snapshot-based stream recovery`.

The following baseline gates passed at commit `28ff968c` on 2026-07-27:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/modules/chat-runtime/stream/run-chunk-log.test.ts \
  src/modules/sync-gateway/channels.test.ts \
  tests/sync-websocket.test.ts \
  --maxWorkers=1 --reporter=dot

pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/web typecheck
```

### The active-run log retains every published payload

`apps/server/src/modules/chat-runtime/stream/run-chunk-log.ts:29-47`:

```ts
export function createRunChunkLog(runId: string, capacity: number): RunChunkLog {
  const entries: SequencedRunChunk[] = []
  const subscribers = new Set<SequencedRunChunkSubscriber>()
  let nextCursor = 0
  let terminal = false

  // ...
  entries.push(entry)
  while (entries.length > capacity) {
    entries.shift()
  }
}
```

`DEFAULT_RUN_REPLAY_CHUNKS` is 5,000 and limits entry count rather than bytes.
A large output updated repeatedly therefore costs approximately
`payload size * retained update count`.

### The current message is already a complete recovery authority

`packages/ai-sdk/src/ui-message-stream-state.ts:162-169` replaces the current
tool output for a `toolCallId`:

```ts
case 'tool-output-available':
  updateToolPart(message, chunk.toolCallId, {
    state: 'output-available',
    output: chunk.output,
    providerExecuted: chunk.providerExecuted,
    providerMetadata: chunk.providerMetadata,
    preliminary: chunk.preliminary,
  })
```

`packages/ai-sdk/src/ui-message-stream-state.ts:271-285` exports the complete
current message and active stream identities:

```ts
export function exportUIMessageStreamSnapshot(target: UIMessageStreamTarget) {
  flushUIMessageStreamState(target)
  return {
    version: 1,
    message: structuredClone(target.message),
    activeTextParts: serializeActiveParts(target.message, target.state.activeTextParts),
    activeReasoningParts: serializeActiveParts(target.message, target.state.activeReasoningParts),
    partialToolCalls: Array.from(target.state.partialToolCalls, /* ... */),
  }
}
```

`packages/ai-sdk/README.md:5-7` explicitly says active in-memory stream state is
the recovery authority for reconnects and late subscribers. Persisted
`run_stream_checkpoints` are a separate crash-recovery concern.

### Sync already has an atomic snapshot-to-live handoff

`apps/server/src/modules/chat-runtime/stream/session-run-chunk-sync.ts:29-43`
subscribes before creating a recovery snapshot:

```ts
const unsubscribe = active.runChunkLog.subscribe(subscriber)
// ...
const cursor = active.runChunkLog.readLatestCursor()
return {
  kind: 'recovery',
  runId,
  cursor,
  chunk: createUIMessageStreamSnapshotChunk({
    runId,
    cursor,
    target: { message: active.finalMessage, state: active.finalProjection },
  }),
  unsubscribe,
}
```

`apps/server/src/modules/sync-gateway/channels.ts:99-198` queues live entries
while bootstrap data is sent and then emits only queued entries whose cursor
is greater than the bootstrap cursor. Preserve this ordering exactly.

### HTTP SSE still chooses exact replay when the log has entries

`apps/server/src/modules/chat-runtime/stream/live-run-streams.ts:56-81` calls
`replayAfter()`, sends historical chunks when available, and uses a snapshot
only after eviction. This must become snapshot-first for every active run.
Provider-thread streams are a different owner and must retain their existing
replay behavior.

### Diagnostics currently inspect retained payloads

`apps/server/src/modules/chat-runtime/runtime-status-api.ts:111-132` calls
`readRetainedEntries()` and counts chunk types from the retained objects.
Those counts feed:

- active-run durable snapshot summaries in
  `run/active-run-snapshot.ts`;
- optional runtime profile logging in `run/profile.ts`;
- `/observability/runtime-snapshot`;
- OpenTelemetry metrics in `src/telemetry/metrics.ts`;
- two Grafana dashboards.

Keep the diagnostic value by counting publications as scalars in the new
sequencer. Do not keep payloads so diagnostics can continue reading them.

### Plan 054's premise has been superseded

Plan 054 introduced the append-only log to make `{ runId, cursor }` stable
before snapshot recovery existed. Commit `3d8f57e3` later added snapshot-based
recovery but left the normal exact-replay path intact. This plan preserves Plan
054's run-scoped monotonic cursor, terminal ordering, WebSocket liveness, and
replay/live labeling; it replaces only raw active-run history retention.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused stream tests | `pnpm --filter @cradle/server exec vitest run src/modules/chat-runtime/stream/run-chunk-sequencer.test.ts src/modules/chat-runtime/stream/sse.test.ts src/modules/sync-gateway/channels.test.ts tests/sync-websocket.test.ts --maxWorkers=1 --reporter=dot` | exit 0; all selected tests pass |
| Chat integration tests | `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts tests/run-snapshot.test.ts tests/turn-executor.test.ts --maxWorkers=1 --reporter=dot` | exit 0; all selected tests pass |
| Server boundaries | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0; no TypeScript or boundary errors |
| Generate API | `pnpm generate:web` | exit 0; OpenAPI and generated Web types agree |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0; no TypeScript errors |
| Full Server tests | `pnpm --filter @cradle/server test` | exit 0; full server suite passes |
| Diff integrity | `git diff --check` | exit 0; no whitespace errors |

Do not run a formatter over the repository. Lint only changed TypeScript files
in check mode:

```bash
git diff --name-only 28ff968c -- '*.ts' '*.tsx' \
  | xargs pnpm exec eslint
```

Expected result: exit 0. If `xargs` is unavailable, pass the changed
TypeScript paths explicitly; do not use a formatter or `--fix`.

## Suggested executor toolkit

- Use the `server-app-development` skill if available for Server module,
  OpenAPI, and generated-client conventions.
- Use the `ai-sdk` skill if available when checking AI SDK
  `UIMessageChunk`/snapshot semantics.
- Use the `codebase-design` skill if available to keep the sequencer interface
  small and prevent replay policy from leaking back into callers.

## Scope

### In scope

Core active-run delivery:

- Delete `apps/server/src/modules/chat-runtime/stream/run-chunk-log.ts`.
- Delete `apps/server/src/modules/chat-runtime/stream/run-chunk-log.test.ts`.
- Add `apps/server/src/modules/chat-runtime/stream/run-chunk-sequencer.ts`.
- Add `apps/server/src/modules/chat-runtime/stream/run-chunk-sequencer.test.ts`.
- `apps/server/src/modules/chat-runtime/stream/session-run-chunk-sync.ts`
- `apps/server/src/modules/chat-runtime/stream/live-run-streams.ts`
- `apps/server/src/modules/chat-runtime/stream/sse.ts`
- `apps/server/src/modules/chat-runtime/stream/sse.test.ts`
- `apps/server/src/modules/chat-runtime/stream/subscriber-registry.ts`
- `apps/server/src/modules/chat-runtime/stream/active-run-stream.ts`
- `apps/server/src/modules/chat-runtime/stream/constants.ts`
- `apps/server/src/modules/chat-runtime/run-registry.ts`
- `apps/server/src/modules/chat-runtime/run/active-run-release.ts`
- `apps/server/src/modules/chat-runtime/run/run-coordinator.ts`
- `apps/server/src/modules/chat-runtime/run/provider-synthetic-turn.ts`
- `apps/server/src/modules/chat-runtime/run/turn-completion.ts`
- `apps/server/src/modules/chat-runtime/run/stream-chunks.ts`

Diagnostics and lifecycle summaries:

- `apps/server/src/modules/chat-runtime/runtime-status-api.ts`
- `apps/server/src/modules/chat-runtime/runtime.ts`
- `apps/server/src/modules/chat-runtime/run/active-run-snapshot.ts`
- `apps/server/src/modules/chat-runtime/run/snapshot-events.ts`
- `apps/server/src/modules/chat-runtime/run/profile.ts`
- `apps/server/src/modules/chat-runtime/run-snapshot.ts`
- `apps/server/src/modules/chat-runtime/run/turn-executor.ts`
- `apps/server/src/modules/observability/runtime-snapshot.ts`
- `apps/server/src/modules/observability/model.ts`
- `apps/server/src/modules/observability/README.md`
- `apps/server/src/telemetry/metrics.ts`
- `observability/grafana/provisioning/dashboards/cradle-correlations.json`
- `observability/grafana/provisioning/dashboards/cradle-runtime.json`

Tests and fixtures that construct `ActiveRun` or assert replay diagnostics:

- `apps/server/src/modules/chat-runtime/run/provider-synthetic-turn.test.ts`
- `apps/server/src/modules/chat-runtime/run/terminal-finalizer.test.ts`
- `apps/server/src/modules/chat-runtime/run/turn-completion.test.ts`
- `apps/server/src/modules/sync-gateway/channels.test.ts`
- `apps/server/tests/chat-runtime.test.ts`
- `apps/server/tests/run-snapshot.test.ts`
- `apps/server/tests/sync-websocket.test.ts`
- `apps/server/tests/turn-executor.test.ts`

Contracts, generated output, and documentation:

- `apps/server/src/modules/chat-runtime/README.md`
- `apps/server/src/modules/chat-runtime/http/stream.routes.ts`
- `packages/ai-sdk/README.md`
- `apps/server/openapi.json` (generated)
- `apps/web/src/api-gen/**` (generated)
- `plans/README.md` (status update only)

### Out of scope

- `apps/server/src/modules/chat-runtime/provider-threads/**`: provider-native
  thread replay is separately owned and may outlive a top-level active run.
- `apps/server/src/modules/chat-runtime/stream/sse.ts` behavior beyond the
  required subscription-before-bootstrap ordering and type/name adjustments.
  Its buffered write coalescing remains.
- Any provider adapter or provider protocol.
- Any database schema or migration.
- Durable `session_events`, `run_stream_checkpoints`, and successful run
  snapshot compaction policy.
- Desktop IPC transport and Plan 063.
- Chat admission, queueing, terminal persistence, synthetic-turn authority,
  and in-progress Plan 061.
- Web UI rendering or Zustand state behavior.
- Payload truncation, provider throttling, artificial delays, event dropping,
  manual GC, or a smaller replacement buffer.
- Compatibility aliases such as retaining `RunChunkLog` while forwarding to
  the new sequencer.

If implementation requires a source file outside this list, stop and report
the dependency before expanding scope.

## Git workflow

- Suggested branch: `advisor/071-eliminate-active-run-replay-retention`
- Use logical Conventional Commits. Suggested split:
  1. `refactor(chat-runtime): recover active streams from snapshots`
  2. `refactor(observability): report stream publications instead of replay buffers`
- Do not push or open a pull request unless the operator explicitly requests
  it.
- Do not modify or revert unrelated working-tree changes.

## Steps

### Step 1: Replace the replay log with a non-retaining run chunk sequencer

Create `stream/run-chunk-sequencer.ts` with a narrow interface:

```ts
export interface SequencedRunChunk {
  runId: string
  cursor: number
  chunk: UIMessageChunk
  terminal: boolean
}

export interface RunChunkPublicationSummary {
  latestCursor: number
  publishedChunkCount: number
  textDeltaCount: number
  reasoningDeltaCount: number
  toolInputDeltaCount: number
  toolOutputCount: number
  maxDeltaChars: number
}

export interface RunChunkSequencer {
  readonly runId: string
  publish: (chunk: UIMessageChunk, terminal: boolean) => SequencedRunChunk
  readLatestCursor: () => number
  readPublicationSummary: () => RunChunkPublicationSummary
  subscribe: (subscriber: SequencedRunChunkSubscriber) => () => void
  clear: () => void
}
```

The implementation may retain only:

- `nextCursor: number`;
- `terminal: boolean`;
- scalar publication counters;
- the subscriber `Set`.

It must not retain a `UIMessageChunk`, `SequencedRunChunk`, output payload,
array, ring buffer, map keyed by cursor/tool call, serialized JSON, weak cache,
or byte-limited tail after `publish()` returns. `publish()` must:

1. reject publication after terminal;
2. allocate one monotonic cursor;
3. update scalar counters without stringifying the payload;
4. synchronously fan out the entry;
5. clear subscribers on terminal;
6. return the entry without storing it.

Count `maxDeltaChars` through the existing
`readDeltaChunkTextLength()` helper. Count chunk families with a direct switch
or statically typed conditions. Do not introduce `unknown` projections.

Rename `ActiveRun.runChunkLog` to `runChunkSequencer` and update every
construction site. Delete:

- `RunChunkReplay`;
- `replayAfter()`;
- `readRetainedEntries()`;
- capacity arguments;
- `createActiveRunChunkLog()`;
- `CRADLE_CHAT_RUN_REPLAY_CHUNKS`;
- `DEFAULT_RUN_REPLAY_CHUNKS`.

Preserve `clear()` in active-run release so live subscribers are detached and
scalar state becomes unreachable with the released `ActiveRun`.

Tests in `run-chunk-sequencer.test.ts` must cover:

- cursors `0, 1, ...` through terminal;
- empty stream reports latest cursor `-1`;
- each subscriber receives each live publication exactly once;
- a throwing subscriber is removed without blocking healthy subscribers;
- terminal clears subscribers and a later publish throws;
- 100 repeated `tool-output-available` publications increment scalar
  diagnostics while the interface exposes no retained entries/replay method;
- delta counts and `maxDeltaChars` are correct.

Do not use a heap-size assertion in Vitest; GC timing makes it flaky. The
structural invariant is that the module owns no payload-retaining collection.

**Verify**:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/modules/chat-runtime/stream/run-chunk-sequencer.test.ts \
  --maxWorkers=1 --reporter=dot
```

Expected: exit 0 and all sequencer tests pass.

### Step 2: Make multiplex Sync bootstrap every active run from one snapshot

Change `openSessionRunChunkSubscription()` so it no longer asks for exact
replay. Preserve this order:

1. resolve the session's current active run;
2. subscribe to `active.runChunkSequencer`;
3. synchronously capture `cursor = readLatestCursor()`;
4. create one `data-cradle-stream-snapshot` from
   `{ message: active.finalMessage, state: active.finalProjection }`;
5. return snapshot, cursor, and unsubscribe.

The wire request may continue carrying `after?: { runId, cursor }` because the
Web client uses it as its last observed run identity. The Server does not need
it to reconstruct state. Do not add a compatibility branch that sometimes
replays old chunks.

Simplify the internal subscription result to one snapshot-bootstrap variant
plus `not-found`. `channels.ts` must continue queuing live entries during
bootstrap and send only queued entries with `item.cursor > snapshot.cursor`.
Preserve:

- snapshot frame marked `replay: true`;
- snapshot cursor acknowledgement before queued live data;
- live frames marked `replay: false`;
- terminal chunk acknowledgement before `end: terminal`;
- empty active runs, whose snapshot/ack cursor is `-1`;
- released or changed runs returning `not-found`.

Update `channels.test.ts` and `sync-websocket.test.ts`. Replace the old
"resumes exact missing chunk" assertion with:

1. publish/project a start and tool output;
2. connect with an older `{ runId, cursor }`;
3. assert the first frame is one snapshot at the current cursor;
4. assert the snapshot contains the latest tool output exactly once;
5. publish terminal and assert it arrives live at the next cursor.

All test helpers that bypass production publication must apply the chunk to
`finalMessage/finalProjection` before publishing it through the sequencer.

**Verify**:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/modules/sync-gateway/channels.test.ts \
  tests/sync-websocket.test.ts \
  --maxWorkers=1 --reporter=dot
```

Expected: exit 0; snapshot bootstrap, cursor ordering, empty run, and terminal
tests all pass.

### Step 3: Make active-run HTTP SSE snapshot-first

In `openRunEventStream()`:

- preserve the interrupted-run error when the DB row is streaming but no
  in-memory `ActiveRun` exists;
- preserve terminal/no-active behavior for completed runs;
- for every active run, create exactly one
  `createUIMessageStreamSnapshotChunk()` at
  `active.runChunkSequencer.readLatestCursor()`;
- pass that snapshot as the initial replay/bootstrap chunk to
  `openBufferedChunkStream()`;
- subscribe to future live chunks through the existing `runSubscribers`
  registry.

Do not touch provider-thread replay. Do not change the SSE wire format,
`: cradle-replay-end`, `[DONE]`, terminal handling, or buffered writer
coalescing.

Add an SSE-focused regression test that constructs an active run with:

- an in-progress text part;
- one tool part whose output has been updated more than once;
- a current cursor greater than zero.

Assert the response emits one snapshot containing only current state before
the replay-end marker, then accepts a later live delta/terminal chunk. Reuse
the existing stream parser/helper rather than parsing SSE with ad hoc string
splits if a structured helper already exists in the test suite.

**Verify**:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/modules/chat-runtime/stream/sse.test.ts \
  tests/chat-runtime.test.ts \
  --maxWorkers=1 --reporter=dot
```

Expected: exit 0; active SSE late join receives one current snapshot and later
live chunks without historical output copies.

### Step 4: Replace replay-buffer diagnostics with scalar publication diagnostics

Rename the Chat Runtime summary:

```text
ActiveRunReplayBufferSummary
  -> ActiveRunStreamPublicationSummary

getActiveRunReplayBufferSummary
  -> getActiveRunStreamPublicationSummary
```

The returned shape must contain `runId` plus the sequencer's:

- `latestCursor`;
- `publishedChunkCount`;
- `textDeltaCount`;
- `reasoningDeltaCount`;
- `toolInputDeltaCount`;
- `toolOutputCount`;
- `maxDeltaChars`.

These are cumulative counts for the currently active run, not retained-entry
counts. Never recover a payload just to compute diagnostics.

Carry the semantic rename through:

- Chat Runtime exports;
- terminal profile field `replayChunkCount/replayChunks` to
  `publishedChunkCount/publishedChunks`;
- durable run snapshot summary property `replayBuffer` to
  `streamPublications`;
- Observability runtime snapshot `chatRuntime.replayBuffers` to
  `chatRuntime.runStreams`;
- replay drilldown names to run-stream publication names;
- telemetry snapshot fields;
- OpenTelemetry instruments:
  - `cradle_chat_stream_published_chunks`;
  - `cradle_chat_stream_published_deltas`.

Update both Grafana dashboards to query the new metrics and label panels as
published stream activity, not retained replay pressure. Preserve heap/RSS
panels so operators can correlate high publication volume with memory without
claiming the publications are retained.

Rename `readReplayCoalesceKey()` in `run/stream-chunks.ts` to a name describing
its remaining durable snapshot-event purpose, such as
`readSnapshotEventCoalesceKey()`. Update the stale comment in
`run/snapshot-events.ts`; durable snapshot event coalescing remains unchanged.

Update `apps/server/tests/chat-runtime.test.ts`:

- assertions that were really testing runtime delta flush/coalescing should
  assert delivery and final text behavior, not retained replay size;
- active snapshot tests may wait on publication counters;
- concurrent-run tests should assert each sequencer reports scalar publication
  counts and no replay-retention API exists;
- repeated tool-output coverage must assert the current projected output is
  the latest value while `toolOutputCount` records all publications.

Do not preserve old observability names as aliases. Repository principles
prefer the clean breaking contract.

**Verify**:

```bash
pnpm --filter @cradle/server exec vitest run \
  tests/chat-runtime.test.ts \
  tests/run-snapshot.test.ts \
  tests/turn-executor.test.ts \
  --maxWorkers=1 --reporter=dot

pnpm --filter @cradle/server typecheck
```

Expected: both commands exit 0; no diagnostics code reads retained chunks.

### Step 5: Regenerate contracts and update ownership documentation

Update `apps/server/src/modules/chat-runtime/README.md` to state:

- active top-level runs retain one current message/projection, one cursor,
  scalar counters, and live subscribers;
- all active-run late joins/reconnects use a transient stream snapshot;
- cursor N identifies the state included by the snapshot, and queued live
  chunks must be greater than N;
- provider-thread replay is separately owned and unchanged;
- `run_stream_checkpoints` are crash recovery, not active reconnect history;
- no raw active-run chunk history is retained or persisted.

Update the module inventory entry from `run-chunk-log.ts` to
`run-chunk-sequencer.ts`. Update runtime profiling documentation from replay
size to publication counts/current final-message size.

Keep `packages/ai-sdk/README.md` aligned: active state remains the reconnect
authority, while the Server no longer keeps an exact replay suffix.

Run `pnpm generate:web` after changing the Observability response model.
Review generated diffs. They must reflect only the intentional
`replayBuffers -> runStreams` summary rename and field changes. Do not hand-edit
generated output.

**Verify**:

```bash
pnpm generate:web
pnpm --filter @cradle/web typecheck
pnpm --filter @cradle/server check:boundaries
```

Expected: all commands exit 0.

### Step 6: Run retention ratchets and complete verification

Run these searches:

```bash
rg -n \
  "RunChunkLog|runChunkLog|createRunChunkLog|createActiveRunChunkLog|replayAfter|readRetainedEntries|CRADLE_CHAT_RUN_REPLAY_CHUNKS|DEFAULT_RUN_REPLAY_CHUNKS" \
  apps/server/src/modules/chat-runtime \
  apps/server/src/modules/sync-gateway \
  apps/server/tests
```

Expected: no matches.

```bash
rg -n \
  "ActiveRunReplayBufferSummary|getActiveRunReplayBufferSummary|replayChunkCount|cradle_chat_replay_buffer|replayBuffers" \
  apps/server/src \
  apps/server/tests \
  apps/server/openapi.json \
  apps/web/src/api-gen \
  observability/grafana/provisioning/dashboards
```

Expected: no matches. Historical plans are deliberately excluded.

Inspect the sequencer implementation:

```bash
rg -n \
  "UIMessageChunk\\[\\]|SequencedRunChunk\\[\\]|entries|chunks|shift\\(|push\\(|Map<.*UIMessageChunk|JSON\\.stringify" \
  apps/server/src/modules/chat-runtime/stream/run-chunk-sequencer.ts
```

Expected: no payload-retaining collection or serialization match. A match in a
type/comment must be reviewed and explained; do not waive an implementation
match.

Run all final gates:

```bash
pnpm --filter @cradle/server exec vitest run \
  src/modules/chat-runtime/stream/run-chunk-sequencer.test.ts \
  src/modules/chat-runtime/stream/sse.test.ts \
  src/modules/sync-gateway/channels.test.ts \
  tests/sync-websocket.test.ts \
  tests/chat-runtime.test.ts \
  tests/run-snapshot.test.ts \
  tests/turn-executor.test.ts \
  --maxWorkers=1 --reporter=dot

pnpm --filter @cradle/server typecheck
pnpm --filter @cradle/web typecheck
pnpm --filter @cradle/server test
git diff --check
```

Expected: every command exits 0.

For a manual acceptance run, start a fresh Server process with
`CRADLE_CHAT_RUNTIME_PROFILE=1`, run a tool that updates the same large output
dozens of times, and sample `/observability/runtime-snapshot` with the existing
`pnpm --filter @cradle/server leak:harness` command. Record:

- baseline and peak `heapUsedMB`;
- publication counts for the active run;
- final message JSON bytes;
- post-release `heapUsedMB` after natural GC.

This manual measurement is evidence, not a blocking numeric threshold. The
blocking invariant is zero active-run historical payload retention. RSS is not
expected to fall immediately after an already-expanded V8 heap.

## Test plan

### `stream/run-chunk-sequencer.test.ts`

- Monotonic run-owned cursor, including terminal.
- Empty cursor `-1`.
- Exact synchronous live fanout.
- Throwing subscriber isolation.
- Terminal cleanup and append-after-terminal rejection.
- Scalar diagnostics for deltas and repeated tool outputs.
- No replay/read-retained interface.

### `modules/sync-gateway/channels.test.ts`

- Fresh and resumed active subscriptions receive one current snapshot.
- Snapshot cursor is acknowledged before queued live entries.
- A live entry racing bootstrap is delivered once when its cursor is greater
  than the snapshot cursor.
- Empty active run remains live from snapshot/ack cursor `-1`.
- Repeated tool output appears only as its latest current value in the
  snapshot.

### `tests/sync-websocket.test.ts`

- Older resume token receives current snapshot rather than an exact historical
  suffix.
- Snapshot is marked replay and later chunks are marked live.
- Terminal cursor is acknowledged before terminal end.
- Wrong/released run remains not found.

### SSE/chat integration

- Active late join receives one snapshot and then live chunks.
- Current text/reasoning/partial tool identities survive snapshot restore.
- Repeated tool output uses the latest output.
- Runtime delta flush thresholds still govern live network chunks, not retained
  memory.
- Concurrent active runs expose scalar publication diagnostics without
  retained histories.

### Observability/contracts

- Runtime snapshot response and generated Web types expose `runStreams`.
- Published chunk/delta metric names appear in Server telemetry and both
  dashboards.
- Old replay-buffer metric and response names have no code/config matches.

## Done criteria

- [ ] `RunChunkLog`, its capacity env/config, and all retained entry APIs are deleted.
- [ ] An active top-level run retains no historical `UIMessageChunk` or tool-output payload.
- [ ] The run-owned cursor remains strictly monotonic through terminal publication.
- [ ] Every active-run Sync connect/reconnect receives one current snapshot, then only live chunks with greater cursors.
- [ ] Every active-run HTTP SSE late join receives one current snapshot, then live chunks.
- [ ] Current message/tool output content is complete; no truncation or event dropping was added.
- [ ] Provider-thread replay behavior is unchanged.
- [ ] Diagnostics use scalar publication counters and retain no payload.
- [ ] Old replay-buffer OpenTelemetry metrics and Grafana queries are removed rather than aliased.
- [ ] OpenAPI and generated Web types are regenerated.
- [ ] Focused tests, Server typecheck, Web typecheck, Server boundaries, full Server tests, scoped lint, and `git diff --check` pass.
- [ ] The two ratchet searches return no matches in active source/config.
- [ ] No database migration, provider throttling, manual GC, replacement replay cache, or compatibility shim is present.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row is updated.

## STOP conditions

Stop and report back; do not improvise if:

- `exportUIMessageStreamSnapshot()` does not represent a chunk type required
  for correct Chat rendering or continuation.
- A client cannot accept a snapshot as the first replay-marked chunk for an
  empty or resumed active run.
- Snapshot-to-live handoff cannot preserve the rule that every live cursor is
  greater than the snapshot cursor.
- Correctness appears to require exact historical chunk replay rather than
  current state. Identify the concrete consumer and chunk type; do not restore
  the buffer.
- The implementation appears to require persisting raw chunks, adding a DB
  table, truncating output, throttling providers, or retaining a short
  byte/count-limited tail.
- Provider-thread replay must change to make active top-level run recovery
  work.
- Terminal publication ordering would need to change relative to durable
  completion or active-run release.
- In-progress Plan 061 has changed an in-scope lifecycle file such that the
  excerpts or ordering assumptions no longer hold.
- `pnpm generate:web` produces unrelated generated-client churn.
- A required change falls outside Scope.
- Any focused verification fails twice after a reasonable scoped correction.

## Maintenance notes

- Cursor values remain process-local active-run delivery positions. They are
  not durable Event Sourcing versions.
- A snapshot cursor means "this snapshot contains all projected state through
  cursor N." Reviewers must scrutinize subscription-before-snapshot ordering
  and filtering of queued live entries `> N`.
- `run_stream_checkpoints` continue to cover crash recovery after the process
  owning live state disappears. Do not use them as a second live projection
  authority.
- Publication counters explain upstream event volume but are not retained
  memory. Dashboards and incident reports must not call them buffer size.
- The SSE writer may still transiently allocate during JSON serialization, and
  slow consumers may retain transport queue data. Those are separate measured
  concerns; do not preemptively alter them in this plan.
- V8 may keep `heapTotal`/RSS committed after GC. Validate this change with
  `heapUsed`/retained-object behavior in a fresh process.
- If a future product explicitly requires exact raw-chunk replay, write a new
  persistence/retention design with a named consumer and quantified budget.
  Do not reintroduce an ad hoc in-memory history.
