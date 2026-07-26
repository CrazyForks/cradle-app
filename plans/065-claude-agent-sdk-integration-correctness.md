# Plan 065: Make the Claude Agent SDK integration honest — permission modes, live-Query reconciliation, lifecycle disposal, settle-on-cancel, and bounded persisted state

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cc3facef..HEAD -- apps/server/src/modules/chat-runtime-providers/claude-agent apps/server/src/modules/chat-runtime/runtime-settings-registry.ts apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts apps/server/src/modules/chat-runtime/capabilities-api.ts apps/server/src/app.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: none (Plan 062 is DONE and is settled design this plan must not reopen — see Boundaries)
- **Category**: bug / security / tech-debt
- **Planned at**: commit `cc3facef`, 2026-07-26

## Why this matters

The Claude Agent provider (`apps/server/src/modules/chat-runtime-providers/claude-agent/`) integrates `@anthropic-ai/claude-agent-sdk@0.3.207` through a long-lived `query()` per chat session. Four defects make the integration dishonest about what the SDK is actually doing:

1. **Every SDK process starts in `bypassPermissions` regardless of the user's setting**, then is "corrected" by an **un-awaited** `setPermissionMode()` call. Until that control request lands (or if it fails — the failure is only logged), the session runs with all permission checks bypassed and `canUseTool` is never consulted: the SDK's own bundled runtime warns *"canUseTool will not be invoked: permissionMode 'bypassPermissions' auto-approves every tool call (except explicit deny rules) before the callback is consulted."* A user who chose `plan` or `default` mode can have tools executed with zero gating during that window. Additionally the mode cache is written **before** the switch is confirmed, so a failed switch permanently poisons the cache and later syncs are skipped.
2. **The provider has a `dispose()` with zero call sites.** Server shutdown (`app.ts` `RuntimeResourceRegistry`) and session archive/cleanup hooks never close active Claude Queries — each is a live CLI child process. Long-running servers leak subprocesses per chat session forever (there is no TTL; the `provider-runtime/host-manager.ts` refcount/TTL machinery is used by codex/kimi but not claude-agent).
3. **`getPresentation` spawns a whole fresh CLI subprocess on every call just to read `supportedCommands()`**, and `capabilities-api.ts` calls it uncached on every capabilities read. The SDK's own docs say `supportedCommands()` is captured once at initialize and clients must consume the `commands_changed` system message — which the provider never handles (grep: zero matches).
4. **The persisted per-session state snapshot grows without bound.** `state-projector.ts` appends `crewCalls`, `workflowExecutions`, and `taskActivity` entries with upsert-but-never-trim semantics (only `alert` is capped at 12); workflow records additionally accumulate `rawInput`/`rawOutput`/`rawLifecycle` blobs. The full JSON string is re-serialized on every write and re-written to the `backend_session_bindings.backend_state_snapshot` SQLite column at least once per turn (turn completion, terminal finalize, and cancel paths all call `attachBinding`). A long agentic session degrades every read/write path that round-trips this blob.
5. **Cancel awaits the SDK and cannot settle the turn locally.** `cancelTurn` (~lines 1649-1676) settles the UI turn locally only in the deferred-empty-result case; for an in-flight turn it just `await entry.query.interrupt()` and waits for the native result / query exit as "terminal authority". If the CLI is wedged (or slow to honor the interrupt), Stop appears dead — the user clicks it repeatedly. And even though `interrupt()` is issued when `currentTurn` is null (pre-first-output window), nothing settles or tears anything down: the live CLI process keeps running the canceled turn. The README documents a cancel-path **detach** that does not exist in code (grep "detach" → no matches). The fix: settle locally, tear the Query down (the documented detach), and make `interrupt()` best-effort.

Each fix is small; together they make the SDK integration match its documented contract.

## Current state

### Files (roles)

- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` (3041 lines) — the `ChatRuntime` implementation; owns `activeQueries: Map<string, ActiveClaudeQuery>` and all SDK control calls.
- `.../claude-agent/input-projector.ts` — `buildClaudeQueryOptions` (query `Options` construction; the `permissionMode: 'bypassPermissions'` hardcode is here at ~line 229-236).
- `.../claude-agent/runtime-settings.ts` (25 lines) — `readClaudeAgentPermissionMode` fail-open + `readClaudeAgentAllowDangerouslySkipPermissions`.
- `.../claude-agent/permission-bridge.ts` — `createClaudeAgentCanUseTool`; handles `AskUserQuestion` transport, plan-mode denial, approval requests.
- `.../claude-agent/state-projector.ts` (905 lines) — all `providerStateSnapshot` writers; `writeClaudeAgentCrewCall` (~line 585), `writeClaudeAgentWorkflowExecution` (~line 609), `writeClaudeAgentTaskActivity` (~line 819) are the unbounded appenders.
- `.../claude-agent/workflow/execution.ts` — `ClaudeWorkflowExecutionRecord` with `rawInput`/`rawOutput`/`rawLifecycle` and `mergeClaudeWorkflowLifecycle` (unbounded array merge at ~line 271).
- `.../claude-agent/metadata.ts` — `projectClaudeAgentPresentation(slashCommands)`.
- `apps/server/src/modules/chat-runtime/capabilities-api.ts` — `getCapabilities(sessionId)` calls `runtime.getPresentation(...)` uncached on both its paths (~lines 44-107).
- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` — `RuntimeRegistry` class (~line 58) + `getRuntimeRegistry()` singleton (~line 458).
- `apps/server/src/modules/chat-runtime/runtime.ts` — lines 287-288 are the only session lifecycle hooks chat-runtime registers today.
- `apps/server/src/app.ts` — `RuntimeResourceRegistry` entries (~lines 440-536); **no chat-runtime provider dispose entry exists**.
- `apps/server/src/modules/session/service.ts` — `onSessionCleanup` / `onSessionArchived` hook registries (~lines 1164-1200).
- `apps/server/src/modules/chat-runtime/runtime-settings-registry.ts` — the product-side `CLAUDE_AGENT_PERMISSION_MODES` (lines 13-18): `['default','acceptEdits','bypassPermissions','plan']`.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` — provider design doc; documents a cancel "detach" that the code never implemented (Step 5 implements it; Step 8 aligns the doc).

### Excerpt A — the bypass-then-correct race

`input-projector.ts` (~lines 229-236, inside `buildClaudeQueryOptions`):

```ts
const queryOptions: Options = {
  abortController: input.abortController,
  cwd: runtimeContext.cwd,
  // The SDK process must start in bypass mode so a later live switch back to it works reliably.
  // streamTurn syncs the user's actual mode immediately after creating the query.
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: readClaudeAgentAllowDangerouslySkipPermissions(runtimeSettings),
  maxTurns: config.maxTurns,
```

Note `readClaudeAgentPermissionMode(runtimeSettings)` is already computed a few lines above (line ~216) and available; it just isn't used for `permissionMode`.

`provider.ts` (~lines 576-589, inside `streamTurn`, `if (!activeEntry)` branch):

```ts
if (!activeEntry) {
  this.activePermissionModesBySession.set(sessionId, turnPermissionMode)
  const inputStream = new ClaudeAgentInputStream()
  const activeQuery = query({ prompt: inputStream, options: queryOptions })
  if (turnPermissionMode !== 'bypassPermissions') {
    void activeQuery.setPermissionMode(turnPermissionMode).catch((error) => {
      this.deps.logger?.warn?.('Claude Agent failed to sync SDK permission mode after query start', {
```

`provider.ts` (~lines 1832-1854) — the cache pre-write:

```ts
const mode = input.mode ?? 'bypassPermissions'
if (this.activePermissionModesBySession.get(sessionId) !== mode) {
  await entry.query.setPermissionMode(mode)
}
this.activePermissionModesBySession.set(sessionId, mode)
```

(If `setPermissionMode` throws, the outer caller may swallow it while the map was already… no — here the set happens *after* the await, so *this* function is safe on throw; the real poison is at line 577 above where the map is written before the un-awaited switch resolves. Also note the fallback `?? 'bypassPermissions'` — an undefined mode silently becomes bypass.)

`runtime-settings.ts` (whole relevant body):

```ts
const CLAUDE_AGENT_PERMISSION_MODES = [
  'default', 'acceptEdits', 'bypassPermissions', 'plan',
] as const satisfies readonly ClaudeAgentPermissionMode[]

export function readClaudeAgentPermissionMode(
  settings: RuntimeSettings | null | undefined,
): ClaudeAgentPermissionMode {
  const mode = settings?.permissionMode
  if (typeof mode === 'string' && (CLAUDE_AGENT_PERMISSION_MODES as readonly string[]).includes(mode)) {
    return mode as ClaudeAgentPermissionMode
  }
  return 'bypassPermissions'    // ← fail-open
}

export function readClaudeAgentAllowDangerouslySkipPermissions(
  settings: RuntimeSettings | null | undefined,
): boolean {
  return readClaudeAgentPermissionMode(settings) !== 'plan'
}
```

SDK facts (from `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`):
- `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'` (line 2043). Cradle models only the first four — an SDK-side `dontAsk`/`auto` value coming back through settings would fail-open to `bypassPermissions`.
- `allowDangerouslySkipPermissions` — "Must be set to `true` when using `permissionMode: 'bypassPermissions'`" (line 1708-1711). It is a **precondition for bypass**, not a general safety flag — so it only needs to be `true` when the effective mode IS `bypassPermissions`.
- `setPermissionMode(mode: PermissionMode): Promise<void>` (line 2251) — live switching **is** supported in both directions; the code comment "must start in bypass mode so a later live switch back to it works reliably" has no basis in the SDK's types or compiled source. (If a real CLI bug motivated it, that belongs in a linked issue, not a permanent bypass window — see STOP conditions.)

### Excerpt B — dispose with no callers

`provider.ts` (~lines 1678-1682):

```ts
async dispose(): Promise<void> {
  for (const [sessionId, entry] of this.activeQueries) {
    this.closeSessionQuery(sessionId, entry)
  }
}
```

`grep -rn "dispose" apps/server/src/modules/chat-runtime/ apps/server/src/app.ts` → zero call sites. The contract (`packages/chat-runtime-contracts/src/index.ts:1543`) declares `dispose?: () => Promise<void>`. `RuntimeRegistry` (chat-runtime-provider-registry.ts:58) has no method to iterate registered runtimes' dispose. `app.ts` registers ~22 `runtimeResources.register(...)` entries (phases `cancel | drain | stop | close`) — e.g.:

```ts
runtimeResources.register({
  name: 'provider-runtime',
  phase: 'stop',
  stop: () => providerRuntimeHostManager.shutdown(),
})
```

Session lifecycle exemplar (`apps/server/src/modules/pty/service.ts:139-149`):

```ts
SessionService.onSessionCleanup((sessionId) => {
  cancelProviderSessionCapture(sessionId)
  ...
})
SessionService.onSessionArchived((sessionId) => {
  destroyPtySession(sessionId)
  ...
})
```

And chat-runtime already registers hooks the same way (`apps/server/src/modules/chat-runtime/runtime.ts:287-288`):

```ts
SessionService.onSessionArchived(releaseSideConversationsByParentSessionId)
SessionService.onSessionCleanup(releaseSideConversationsByParentSessionId)
```

`closeSessionQuery(sessionId, entry)` (provider.ts ~line 1486) is idempotent (`if (entry.closed) return`) and safe to call for an archived session.

### Excerpt C — getPresentation subprocess + no commands_changed

`provider.ts` (~lines 388-412):

```ts
async getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
  const abortController = new AbortController()
  const stderrSink = createClaudeStderrSink()
  const queryOptions = buildClaudeQueryOptions({ ... attachPermissionHandler: false, persistSession: false, ... })
  const activeQuery = query({ prompt: emptyClaudeAgentInput(), options: queryOptions })
  try {
    const slashCommands = await activeQuery.supportedCommands()
    return projectClaudeAgentPresentation(slashCommands)
  } ...
  finally {
    closeClaudeQuery(activeQuery)
  }
}
```

SDK doc (sdk.d.ts:2854, `SDKCommandsChangedMessage`, `type:'system', subtype:'commands_changed', commands: SlashCommand[]`):

> "Clients should REPLACE their cached command list with this payload: supportedCommands() is captured once at initialize and never reflects mid-session changes, so a client re-fetch would return the stale init list."

The provider's message pump (`handleClaudeSessionMessage`, provider.ts ~line 900) handles `system/init`, `system/compact_boundary`, `auth_status`, `rate_limit_event`, `system/permission_denied` — but not `commands_changed`. `getCapabilities` in `capabilities-api.ts` (~lines 44-107) calls `runtime.getPresentation(...)` on every request with no cache on either the active-run or resolved-session path.

### Excerpt D — unbounded snapshot + write frequency (the 落库 facts)

Write chain (verified):
1. Providers mutate `runtimeSession.providerStateSnapshot` **in memory** (a JSON string, fully re-parsed and re-serialized per write) — `state-projector.ts` does this in every `writeClaudeAgent*` function.
2. The blob reaches SQLite only via `attachBinding` (`apps/server/src/modules/chat-runtime/runtime-session-context.ts:221-236`) → `persistProviderRuntimeResolution` (`provider-runtime/service.ts:209`) → `writeProviderRuntimeBinding` (`provider-runtime/directory.ts:83`) → Drizzle update/insert of `backend_session_bindings.backend_state_snapshot` (`packages/db/src/schema/backend-control-plane.ts:23`).
3. `attachBinding` call sites: run start (`run-coordinator.ts:271`), turn completion (`turn-executor.ts:564` in `recordRunCompletion`), terminal finalize (`terminal-finalizer.ts:220` in `recordTerminalRunBindingId`), cancel (`lifecycle/cancel.ts:158`), bang commands (`bang-command-execution.ts:75`), title service, rollback, codex host. So: **~3 DB writes of the full blob per normal turn** (start, terminal finalize, completion), each a full-row `UPDATE`.

So the DB write frequency is bounded per turn (fine), but the *payload* is unbounded across session lifetime, and the in-memory churn (parse + stringify of the whole blob) happens on **every** crew-call/task/workflow event within a turn.

The unbounded appenders (`state-projector.ts`):

```ts
// ~line 585  writeClaudeAgentCrewCall — upsert by id/agentId, else push; no trim
existingCalls.push(call)
claudeAgentState.crewCalls = existingCalls

// ~line 609  writeClaudeAgentWorkflowExecution — upsert by toolCallId, else push; no trim
existingExecutions.push(execution)

// ~line 819  writeClaudeAgentTaskActivity — upsert by id, else push; no trim
existingItems.push(item)
```

Contrast: `writeClaudeAgentPermissionDeniedSnapshot` (~line 326) caps alerts with `.slice(0, CLAUDE_AGENT_RECENT_ALERT_LIMIT /* 12 */)`, and the codex exemplar (`chat-runtime-providers/codex/projection/state-projector.ts`) trims everywhere: `.slice(0, 6)` / `.slice(0, 8)` / `.slice(0, 12)` (lines 428, 622, 875, 981, 1064, 1092).

Also unbounded *within one record*: `workflow/execution.ts` `mergeClaudeWorkflowLifecycle` (~line 271) and `mergeRawLifecycle` (~line 301) append every lifecycle event with a distinct `uuid` into `lifecycle[]` and `rawLifecycle[]`; `rawInput`/`rawOutput` keep whole raw tool payloads. Crew-call records keep the full `prompt` string (captured from `args.prompt` in `event-to-chunk-mapper.ts:1208`) — Agent prompts are routinely multi-KB.

### Conventions

- Conventional commits (`feat(scope): ...`, `fix(scope): ...` — see `git log`).
- Trust TypeScript types; no `unknown`+guards workarounds (CLAUDE.md).
- Tests: vitest, colocated `*.test.ts`. The claude-agent suite is currently green: 17 files / 160 tests.
- Provider snapshot parsing goes through `readWorkspaceProviderStateSnapshot` in `chat-runtime-providers/kit/state-snapshot.ts` — it has a `registerProviderStateSnapshotMigration` mechanism if a shape change is ever needed (this plan does NOT change the schema, only bounds array lengths, so no migration is required).

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Typecheck server | `pnpm typecheck:server` | exit 0 |
| Module boundaries | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Scoped tests | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` | all pass (baseline: 17 files / 160 tests) |
| Chat-runtime tests | `pnpm vitest run apps/server/src/modules/chat-runtime --reporter=dot` | all pass |
| Full server tests | `pnpm --filter @cradle/server test` | all pass |
| Lint | `pnpm lint` | exit 0 |

Notes: `timeout` (coreutils) and `npx` are **not available** on this machine; use `pnpm vitest run ...` directly. Do not use `cd` in compound commands; use absolute or repo-root-relative paths.

## Scope

**In scope** (the only files you should modify):
- `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/runtime-settings.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/workflow/execution.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md`
- `apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` (add registry-wide dispose)
- `apps/server/src/modules/chat-runtime/runtime.ts` (session lifecycle hooks)
- `apps/server/src/app.ts` (one `runtimeResources.register` entry)
- Existing colocated `*.test.ts` files for the above (extend; create only if a new module needs one)

**Out of scope** (do NOT touch, even though they look related):
- `packages/db/src/schema/**` — no schema change is needed; the snapshot stays a text column.
- `packages/chat-runtime-contracts/**` — `dispose?` already exists in the contract.
- `apps/server/src/modules/chat-runtime-providers/codex/**`, `kimi/**`, `acp/**`, `opencode/**`, `system-agent/**`, `mock-claude-agent/**` — other providers keep their behavior.
- `apps/server/src/modules/provider-runtime/host-manager.ts` — migrating claude-agent onto the host manager is explicitly deferred (see Maintenance notes).
- `apps/server/src/modules/chat-runtime/runtime-settings-registry.ts` and `provider-contracts/provider-base.ts` — do NOT add `dontAsk`/`auto` to product enums in this plan; the product surface intentionally exposes four modes. Only the provider-internal fail-open changes.
- Anything covered by Plan 062's settled design: long-lived Query ownership, `result`-as-turn-boundary, deferred empty results, system-origin projection runs, msg_lifecycle semantics. Do not restructure `streamTurn`'s turn machinery.
- `permission-bridge.ts` — its plan-mode denial and `AskUserQuestion` transport remain as-is. (With the fix, `canUseTool` starts being consulted in non-bypass modes from process start — that is the *intended* effect, not a regression.)
- `apps/server/src/modules/chat-runtime/lifecycle/cancel.ts` and all other chat-runtime code — Step 5's cancel change is provider-local. If cancel appears swallowed upstream of the provider, that is a STOP condition (report to Plan 061), not a fix target here.

## Git workflow

- Branch: `advisor/065-claude-agent-sdk-integration-correctness`
- Conventional commits, one per step or logical unit, e.g. `fix(claude-agent): start SDK query in the user's permission mode`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Start the Query in the user's actual permission mode

In `input-projector.ts`, `buildClaudeQueryOptions`:
- Replace the hardcoded `permissionMode: 'bypassPermissions'` with the already-computed `permissionMode` local (from `readClaudeAgentPermissionMode(runtimeSettings)` at ~line 216). Delete the two-line comment claiming the process "must start in bypass mode".
- Change `allowDangerouslySkipPermissions` to be `true` only when it can actually be needed: `permissionMode === 'bypassPermissions' || readClaudeAgentAllowDangerouslySkipPermissions(runtimeSettings)` is wrong — instead, set it to `permissionMode !== 'plan'` **only if** tests depend on live switching *into* bypass later. Preferred shape: keep `allowDangerouslySkipPermissions: readClaudeAgentAllowDangerouslySkipPermissions(runtimeSettings)` unchanged in this step (it already returns `mode !== 'plan'`, which keeps a later live switch to bypass legal per sdk.d.ts:1708) and only swap `permissionMode`. Rationale: the SDK requires the flag to be true *when* bypass is used, and pre-authorizing it does not itself bypass anything — the mode does.

In `provider.ts` `streamTurn` (~lines 576-589):
- Delete the entire `if (turnPermissionMode !== 'bypassPermissions') { void activeQuery.setPermissionMode(...) }` block — the query now starts in the right mode.
- Move `this.activePermissionModesBySession.set(sessionId, turnPermissionMode)` to stay (it now records the true initial mode, no race).
- The `permissionBridgeState` for a new entry is created with `permissionMode: 'bypassPermissions'` at ~line 556 (`createClaudeAgentPermissionBridgeState({ ..., permissionMode: 'bypassPermissions', ... })`); change that literal to `turnPermissionMode` so `canUseTool` sees the correct mode from the first tool call. (`turnPermissionMode` is computed just below it at ~line 559 — reorder the two declarations.)

**Verify**: `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` → expect failures ONLY in tests that assert `permissionMode: 'bypassPermissions'` in initial query options or assert the post-start `setPermissionMode` call; update those assertions to the new behavior (the test now should assert the query options carry the user's mode). All other tests must stay green.

### Step 2: Fix the mode-cache poisoning and the silent bypass fallback

In `provider.ts` `updateActiveQueryPermissionMode` (~lines 1832-1854):
- Replace `const mode = input.mode ?? 'bypassPermissions'` with an early return when `input.mode` is undefined (an unknown mode must never silently become bypass):
  ```ts
  const mode = input.mode
  if (!mode) {
    return
  }
  ```
- Keep the `set` **after** the awaited `setPermissionMode` (it already is — confirm and leave). Add a `catch`-rethrow is not needed; just ensure no code path writes the map before the await resolves.

In `runtime-settings.ts`:
- Change the fail-open default in `readClaudeAgentPermissionMode` from `'bypassPermissions'` to `'default'`. An unrecognized persisted mode should degrade to *prompting*, not to *bypassing*.
- `readClaudeAgentAllowDangerouslySkipPermissions` keeps its shape but re-derives correctly from the new default (mode `'default'` → returns `true`, unchanged behavior for known modes).

**Verify**: scoped tests again → update any test asserting the old `'bypassPermissions'` fallback (search `runtime-settings.test` and `provider.test` for `bypassPermissions` fallback assertions). Then `pnpm typecheck:server` → exit 0.

### Step 3: Wire provider disposal into server shutdown

In `chat-runtime-provider-registry.ts`, add to the `RuntimeRegistry` class:

```ts
async disposeAll(): Promise<void> {
  for (const entry of this.runtimes.values()) {
    try {
      await entry.runtime.dispose?.()
    }
    catch (error) {
      // disposal must not block the remaining runtimes
      createChildLogger({ module: 'chat-runtime-provider' }).warn('runtime dispose failed', { error, runtimeKind: entry.runtime.runtimeKind })
    }
  }
}
```

(Match the file's existing logger import/pattern — `createChildLogger` is already imported there for the provider context; reuse it or hoist a module-level logger, matching local style.)

In `app.ts`, register it alongside the other runtime resources (phase `stop`, before `provider-runtime`'s entry so provider processes close before host-manager shutdown — order of registration is execution order within a phase; verify by reading `RuntimeResourceRegistry.shutdown` and place accordingly; if order within phase is not guaranteed, placement is cosmetic and any position in `stop` is fine):

```ts
runtimeResources.register({
  name: 'chat-runtime-providers',
  phase: 'stop',
  stop: () => getRuntimeRegistry().disposeAll(),
})
```

`getRuntimeRegistry` is already exported from `chat-runtime-provider-registry.ts`; add the import to `app.ts` following its existing import grouping.

**Verify**: `pnpm typecheck:server` → exit 0. `pnpm vitest run apps/server/src/modules/chat-runtime --reporter=dot` → all pass.

### Step 4: Close the session's live Query on archive/cleanup

The provider needs a public way to close one session's query. In `provider.ts`, add next to `dispose()`:

```ts
async disposeSession(sessionId: string): Promise<void> {
  const entry = this.activeQueries.get(sessionId)
  if (entry) {
    this.closeSessionQuery(sessionId, entry)
  }
}
```

Note: `ChatRuntime` contract does not declare `disposeSession`. Do NOT add it to the contract (out of scope). Instead, in `apps/server/src/modules/chat-runtime/runtime.ts`, extend the existing lifecycle hook block (lines 287-288) to iterate registered runtimes and call `disposeSession` when present, via a narrow structural check:

```ts
function disposeRuntimeSessionResources(sessionId: string): void {
  for (const item of getRuntimeRegistry().list()) {
    const runtime = getRuntimeRegistry().get(item.runtimeKind)
    const disposeSession = (runtime as { disposeSession?: (id: string) => Promise<void> } | undefined)?.disposeSession
    if (disposeSession) {
      void disposeSession.call(runtime, sessionId)
    }
  }
}
SessionService.onSessionArchived(disposeRuntimeSessionResources)
SessionService.onSessionCleanup(disposeRuntimeSessionResources)
```

⚠️ CLAUDE.md says "trust TypeScript types / avoid `unknown` + guards". The structural cast above is a seam the repo will dislike. Preferred alternative if it typechecks cleanly: export a dedicated function from the claude-agent package (e.g. `disposeClaudeAgentSession(sessionId)`) that reaches the provider instance — but the provider is constructed inside `getRuntimeRegistry()`, so a module-level function would need a registry lookup anyway. Decide by trying the clean route first: add `disposeSession?: (sessionId: string) => Promise<void>` to the local `ChatRuntime`-consuming type in `runtime-provider-types.ts` **only if** that file re-exports the contract type with server-local extensions already (check first; if it is a pure re-export, fall back to the structural check with a comment explaining why).

**Verify**: `pnpm typecheck:server` → exit 0; `pnpm --filter @cradle/server check:boundaries` → exit 0. Scoped claude-agent tests → green. Write the new test from the Test plan (archive closes query) now and see it pass.

### Step 5: Settle cancel locally and tear down the Query (implement the documented detach)

Current `cancelTurn` (~lines 1649-1676):

```ts
async cancelTurn(input: CancelTurnInput): Promise<void> {
  const sessionId = input.runtimeSession.chatSessionId
  const entry = this.activeQueries.get(sessionId)
  if (!entry || entry.closed) {
    return
  }
  const turn = entry.currentTurn
  if (turn) {
    turn.interruptRequested = true
    if (turn.deferredEmptyResult && !turn.hasProjectedOutput) {
      this.finalizeClaudeUserTurn(entry, turn, { type: 'abort', reason: 'user' })
    }
  }
  // For in-flight turns with projected output, interrupt does not settle the
  // turn: the native result / query exit remains the terminal authority.
  await entry.query.interrupt()
}
```

Rewrite it to: settle first, tear down second, interrupt best-effort — with no awaited SDK round-trip on the cancel path:

```ts
async cancelTurn(input: CancelTurnInput): Promise<void> {
  const sessionId = input.runtimeSession.chatSessionId
  const entry = this.activeQueries.get(sessionId)
  if (!entry || entry.closed) {
    return
  }
  const turn = entry.currentTurn
  if (turn) {
    turn.interruptRequested = true
    // Settle the UI turn locally in every case, not just deferred-empty: the
    // Query is about to be torn down, so no native result will ever arrive to
    // act as terminal authority.
    if (!turn.hasProjectedOutput || turn.deferredEmptyResult) {
      this.finalizeClaudeUserTurn(entry, turn, { type: 'abort', reason: 'user' })
    }
  }
  // Best-effort interrupt so a healthy CLI can checkpoint; do not await — the
  // process is being closed regardless.
  void entry.query.interrupt().catch(() => {})
  // Detach: kill the live Query. The next prompt builds a fresh one.
  this.closeSessionQuery(sessionId, entry)
}
```

Notes on the shape:

- `closeSessionQuery` (~line 1486) already completes provider-thread turns, releases submitted inputs, aborts the controller, closes the input stream, and closes the query — and it is idempotent. Call it **after** `finalizeClaudeUserTurn`, because it nulls `entry.currentTurn`.
- For an in-flight turn **with** projected output, keep the existing semantics: do not finalize locally there (the partial output already streamed is a real turn record; chat-runtime's cancel path owns its terminal projection). The behavioral change for that case is the teardown + un-awaited interrupt — Stop returns immediately and the process dies, instead of waiting on a possibly-wedged CLI.
- The `activePermissionModesBySession` entry is harmless to leave (the next create overwrites it, Step 1), but deleting it here is one line — do it for hygiene.
- This implements the "detach" the README already promises (Step 8 updates the README to match); it does NOT touch `lifecycle/cancel.ts` or any chat-runtime code — the swallow-in-chat-runtime scenario is a STOP condition, not a fix target.

**Verify**: scoped claude-agent tests → update tests asserting that `cancelTurn` awaits `interrupt()` or that the entry survives cancel; add the new pre-TTFT cancel test from the Test plan. Then `pnpm typecheck:server` → exit 0. Manual smoke (record the result in the commit message): start a turn, click Stop once before first output → stop takes effect immediately and the CLI child process is gone (`ps` shows no claude CLI for that session). If one click is NOT enough, see the STOP conditions — do not patch around it here.

### Step 6: Consume `commands_changed` and stop paying a subprocess per capabilities read

In `provider.ts`:
- Add a per-entry cached command list: extend `ActiveClaudeQuery` with `slashCommands: SlashCommand[] | null` (initialize `null` in the entry literal in `streamTurn`).
- In `handleClaudeSessionMessage` (the pump, ~line 900), before the mapper dispatch, handle the push:
  ```ts
  if (message.type === 'system' && message.subtype === 'commands_changed') {
    entry.slashCommands = (message as SDKCommandsChangedMessage).commands
    return
  }
  ```
  (`SDKCommandsChangedMessage` is exported from the SDK — import the type. If 0.3.207's `SDKMessage` union does not include it and the narrow fails to typecheck, follow the existing local pattern in `sdk-augmentation.d.ts` / the "observed-wire type" convention documented in the README for `command_lifecycle`.)
- In `getPresentation` (~line 388): if `this.activeQueries.get(input.runtimeSession.chatSessionId)` exists and is not closed, serve from the live entry: use `entry.slashCommands` if set; otherwise call `entry.query.supportedCommands()` **on the live query** (no new subprocess), store into `entry.slashCommands`, and return `projectClaudeAgentPresentation(...)`. Fall back to the current spawn-and-dispose path only when there is no live query for the session.

Do NOT add a cross-request cache in `capabilities-api.ts` — with the live-query path, repeated capability reads for an active session no longer spawn processes, and cold-session reads keep current semantics. (A TTL cache there would affect every runtime and belongs to a separate decision.)

**Verify**: scoped claude-agent tests → green (plus the new test from Test plan). `pnpm typecheck:server` → exit 0.

### Step 7: Bound the persisted snapshot arrays

In `state-projector.ts`, mirror the alert-cap pattern (and the codex exemplar's `.slice(0, N)` style):
- Add module constants next to `CLAUDE_AGENT_RECENT_ALERT_LIMIT` (~line 65):
  ```ts
  const CLAUDE_AGENT_RECENT_CREW_CALL_LIMIT = 24
  const CLAUDE_AGENT_RECENT_WORKFLOW_EXECUTION_LIMIT = 12
  const CLAUDE_AGENT_RECENT_TASK_ACTIVITY_LIMIT = 24
  const CLAUDE_AGENT_CREW_PROMPT_SNAPSHOT_LIMIT = 2_000 // chars
  ```
- `writeClaudeAgentCrewCall`: after the upsert, trim: keep all `status === 'running'` entries plus the most recent non-running entries up to the limit (sort/retain by `startedAt` descending for the non-running remainder; a running background agent must never be evicted or its later terminal event re-appends as a fresh record). Also truncate `call.prompt` to `CLAUDE_AGENT_CREW_PROMPT_SNAPSHOT_LIMIT` chars before storing (UI preview uses only 120 chars — see `state-projector.ts:797`).
- `writeClaudeAgentWorkflowExecution`: same retain-running-plus-recent trim by `startedAt`.
- `writeClaudeAgentTaskActivity`: same trim (running items retained; completed/failed beyond the limit dropped, most recent first).

In `workflow/execution.ts`:
- `createClaudeWorkflowExecutionRecord` / `mergeClaudeWorkflowExecutionRecord`: cap `lifecycle` and `rawLifecycle` to the most recent 20 entries each (append then `slice(-20)` in `mergeClaudeWorkflowLifecycle` and `mergeRawLifecycle`). Do not touch `input`/`output` projections. Leave `rawInput`/`rawOutput` (single objects, bounded by tool payload) as-is.

Check read-side invariants before choosing eviction: `projectClaudeAgentCrewUiSlotState` (~line 651) computes active/completed/failed counts from the array — trimming completed entries changes those counts. That is acceptable (the slot is a "recent activity" surface, matching codex behavior), but keep the running-entry retention rule strict so active counts stay exact.

**Verify**: scoped claude-agent tests → green; add the bounding tests from the Test plan. `pnpm typecheck:server` → exit 0.

### Step 8: Align the README with real behavior

In `claude-agent/README.md`:
- The "Stopping a current turn" paragraph documents a cancel-path **detach** ("Cradle **detaches** that live Query and the next prompt rebuilds…"). After Step 5 this is finally true — rewrite the paragraph to describe the real behavior precisely: cancel settles the UI turn locally (abort/user), issues `interrupt()` best-effort without awaiting, and closes the live Query (the documented detach); the next prompt builds a fresh Query. For an in-flight turn with already-projected output, chat-runtime's cancel path owns the terminal projection. Remove the stale implication that the native result remains the terminal authority after a cancel.
- Update the permission-mode paragraph ("Claude Agent sessions own runtime settings through the native SDK `permissionMode` axis…") to state that the SDK Query now **starts** in the session's configured mode and live changes go through `setPermissionMode`; remove any implication of a bypass-first startup.
- Add one sentence to the presentation paragraph: slash commands are served from the live Query and refreshed by `commands_changed` pushes; a subprocess is only spawned for sessions with no live Query.

**Verify**: `grep -n "detaches" apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` → the remaining match must describe the Step-5 behavior (local settle + best-effort interrupt + query teardown), not the old interrupt-only path; the LinkCode historical reference must be gone or rewritten.

### Step 9: Full verification pass

Run, in order:
1. `pnpm typecheck:server` → exit 0
2. `pnpm lint` → exit 0
3. `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` → all pass (≥160 + new tests)
4. `pnpm vitest run apps/server/src/modules/chat-runtime --reporter=dot` → all pass
5. `pnpm --filter @cradle/server test` → all pass

## Test plan

Extend existing colocated suites (model new tests after the existing style in `provider.test.ts` — it already builds fake SDK `query` factories and asserts on captured `Options`):

1. **`input-projector` / `provider.test.ts`** — *query starts in user mode*: with `runtimeSettings.permissionMode = 'plan'` (and `'default'`), assert the `Options` passed to `query()` carry that mode and that no `setPermissionMode` call is issued at startup. Regression name should reference the bypass-window bug.
2. **`provider.test.ts`** — *mode cache not poisoned*: make `setPermissionMode` reject once; assert a subsequent `updateActiveQueryPermissionMode` with the same target mode retries the SDK call (cache was not pre-written).
3. **`runtime-settings.test.ts`** (exists) — fallback for unknown mode is now `'default'`, not `'bypassPermissions'`.
4. **archive/cleanup closes query** — in the chat-runtime layer or provider test: create an active query entry, invoke the archived-hook path (or call `disposeSession` directly at provider level), assert the underlying query received close/abort and `activeQueries` no longer holds the session.
5. **`commands_changed`** — push a `{type:'system', subtype:'commands_changed', commands:[...]}` message through the pump; assert a following `getPresentation` returns the new list without constructing a new `query()` (the fake query factory counts instantiations).
6. **snapshot bounding** (`state-projector.test.ts` — check if it exists; create colocated if not): write `LIMIT+10` distinct completed crew calls → stored array length == limit and most-recent retained; a `running` call older than all others survives trimming; workflow `lifecycle` capped at 20; `prompt` longer than 2000 chars is truncated in the snapshot.
7. **pre-TTFT cancel settles and tears down** (`provider.test.ts`): create an active entry whose `currentTurn` is null (pushed prompt, no output yet — the pre-first-output window); call `cancelTurn`; assert: it returns without awaiting `interrupt()` (make the fake `interrupt()` return a never-resolving promise and assert `cancelTurn` still resolves), the underlying query received close/abort, `activeQueries` no longer holds the session, and a following `streamTurn` constructs a fresh `query()`. Add a second case: `currentTurn` present with `deferredEmptyResult` → the UI turn is finalized `{type:'abort', reason:'user'}` before the entry closes.

Verification: command #3 in Step 9 → all pass including the new tests.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck:server` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0
- [ ] `grep -n "permissionMode: 'bypassPermissions'" apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` → no match
- [ ] `grep -rn "disposeAll" apps/server/src/app.ts apps/server/src/modules/chat-runtime/chat-runtime-provider-registry.ts` → registry method + app.ts registration both present
- [ ] `grep -rn "commands_changed" apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` → ≥1 match
- [ ] `grep -n "CLAUDE_AGENT_RECENT_CREW_CALL_LIMIT" apps/server/src/modules/chat-runtime-providers/claude-agent/state-projector.ts` → present and used in `writeClaudeAgentCrewCall`
- [ ] `grep -n "await entry.query.interrupt" apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` → no match (interrupt is best-effort on the cancel path)
- [ ] `grep -n "closeSessionQuery(sessionId, entry)" apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` → called from `cancelTurn` as well as `dispose`
- [ ] New tests from the Test plan exist and pass
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Starting the query in `plan` or `default` mode makes the SDK CLI fail to boot, reject the first prompt, or behave differently from a live-switched session in the scoped tests — this would mean the "must start in bypass" comment encoded a real CLI defect. Report the exact failure; do not reintroduce the bypass window silently.
- `SDKCommandsChangedMessage` cannot be narrowed from the pump's `SDKMessage` union AND the `sdk-augmentation.d.ts` route also fails to typecheck.
- Adding `disposeSession` requires editing `packages/chat-runtime-contracts` to typecheck (that package is out of scope — report instead).
- Trimming crew calls breaks an assertion in web-side fixtures/tests that expect full history (search `apps/web` for `crewCalls` before assuming — if web depends on unbounded arrays, report).
- After Step 5's local settle + teardown, a real Stop still needs multiple clicks — that means the cancel never reaches the provider (swallowed inside chat-runtime before `cancelTurn`). Report this as a finding for Plan 061 (turn lifecycle authority is its ownership); do NOT patch chat-runtime from this plan.
- Closing the Query on cancel breaks the next turn (e.g. `streamTurn` re-create path assumes state the teardown destroyed, or the deferred-empty handling double-settles) — report the exact failure rather than reintroducing the await-the-native-result behavior.
- The drift check shows `provider.ts`, `input-projector.ts`, or `state-projector.ts` changed since `cc3facef` in the regions excerpted above.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Deferred, deliberately**: migrating claude-agent's `activeQueries` onto `provider-runtime/host-manager.ts` (refcount + TTL + idle reaping, as codex/kimi do). This plan adds *deterministic* disposal (shutdown + archive); *idle* reaping of abandoned-but-unarchived sessions is a follow-up that should reuse the host manager rather than a bespoke timer. Also deferred: reusing the live Query for `quickQuestion`/title generation (each still spawns its own short-lived process), and splitting `provider.ts` (3041 lines) into an owner directory like `codex/`.
- **Superseded deferral**: the `claudeAi` history replay (O(N²)), `settingSources` divergence, and related live-config issues were originally noted here as deferred product decisions. They are now owned by Plan 066 (re-audit concluded the history replay is a bug, not a trade-off). The only piece still deferred is mid-session reconciliation of `mcpServers`/`skills`/`tools` (needs a product policy) and SDK `sessionStore` adoption (alpha API).
- **Deferred, architecturally**: the snapshot blob conflates two kinds of state — (a) small, bounded *resume state* the provider needs to rebuild itself (`pendingModelSwitchId`, `capturedPlan`, compact state) and (b) an unbounded *UI activity feed* (`crewCalls`, `workflowExecutions`, `taskActivity`) whose authoritative source is the event/message history Cradle already persists (Plan 024 event sourcing). The principled fix is to split them: keep (a) persisted and small; derive (b) on read from authoritative history (or store raw payloads out-of-line as artifacts referenced by id, in the spirit of `workflow/artifact-stream.ts`). That is a design project — it requires proving every feed field is re-derivable from persisted events and moving compute to the read path — so this plan caps the arrays instead. The caps are chosen so the split remains possible later: no consumer may depend on more than the capped window.
- Reviewers should scrutinize: the permission-bridge initial state (Step 1) — `canUseTool` will now be consulted from the first tool call in non-bypass modes, so approval-request plumbing gets more traffic; and the crew-call trim's running-entry retention (Step 7) — evicting a running background agent would resurrect it as a duplicate record on its terminal event; and the cancel teardown (Step 5) — an in-flight turn with projected output must still reach its terminal projection through chat-runtime's cancel path, not through a provider-side local finalize.
- If a future SDK bump adds `command_lifecycle` / `commands_changed` to the typed union, delete the local narrowing.
