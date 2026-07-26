# Plan 066: Make the long-lived Claude Query the authority for history and live config — stop replaying full history, stop rebuilding discarded options, drop `maxTurns` from session queries

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cc3facef..HEAD -- apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/065-claude-agent-sdk-integration-correctness.md (065 rewrites the same `streamTurn` prologue — land it first; the excerpts below are from the pre-065 tree, re-locate by symbol name after 065)
- **Category**: bug / perf
- **Planned at**: commit `cc3facef`, 2026-07-26

## Why this matters

The Claude Agent provider keeps one long-lived SDK `Query` per chat session
(Plan 062 settled design: "one session = one long-lived Query"). That Query
already holds the full conversation context inside its CLI subprocess. But
`streamTurn` still behaves as if every turn goes to a fresh request/response
process:

1. **O(N²) history replay in `claudeAi` auth mode.** `claudeAi` never persists
   SDK sessions (`shouldPersistClaudeAgentSdkSession('claudeAi') → false`), so
   `historyScope` is `'full'` on *every* turn — and the resulting full-history
   prompt is pushed into the *live* Query that already consumed turns 1..N-1.
   Turn N re-sends the entire transcript; prompt size grows quadratically over
   a session and the model sees duplicated history.
2. **Model switches are silently dropped in `claudeAi` mode.** The pending
   model switch is applied via `query.setModel()` only when
   `shouldResumeProviderSession` is true — which is never true for `claudeAi`.
3. **`queryOptions` is rebuilt on every turn and discarded on reuse.** The
   build has side effects (reads the API-key secret, `mkdirSync` of the SDK
   config dir, skill projection reconcile), and none of skills/effort/tools/
   mcpServers changes after turn 1 ever take effect.
4. **`maxTurns: 100` is applied to the long-lived session Query.** A session
   dies silently at its 100th turn even though `maxTurns` was designed as a
   per-ephemeral-query agentic-loop cap.

This plan is the subset of the original "live config reconciliation" finding
that is unambiguous bug fixing. The policy-level piece (which config changes
may be pushed mid-session via `setMcpServers`/`reloadSkills`/
`applyFlagSettings`) is explicitly deferred — see Maintenance notes.

## Current state

### Files (roles)

- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` (3041 lines) — the `ChatRuntime` implementation; `streamTurn` at line 522.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` (761 lines) — `buildClaudeQueryOptions` (line 192), `buildClaudeAgentTurnContent` (line 150), `formatClaudeAgentHistory` (line 469), `shouldPersistClaudeAgentSdkSession` (line 403), `claudeAgentSettingSourcesForAuthMode` (line 414).
- `apps/server/src/modules/provider-contracts/provider-base.ts` — `ClaudeAgentConfigSchema` with `maxTurns: z.number().default(100)` (line 80) and `readTrustedClaudeAgentConfig` applying `maxTurns: config.maxTurns ?? 100` (line 236).
- `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — SDK contract (version 0.3.207).

### Excerpt A — the per-turn history decision (provider.ts, ~lines 526-536)

```ts
const shouldPersistSession = shouldPersistClaudeAgentSdkSession(config.authMode)
const resumedProviderSessionId = shouldPersistSession
  ? input.runtimeSession.providerSessionId
  : null
const shouldResumeProviderSession = Boolean(resumedProviderSessionId)
const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
const userContent = buildClaudeAgentTurnContent({
  userContent: projectedUserContent,
  history: input.history,
  historyScope: shouldResumeProviderSession ? 'recentCradleLocal' : 'full',
})
```

The history scope is computed **before** the live-query lookup
(`let activeEntry = this.activeQueries.get(sessionId)` at ~line 543) and never
considers it. The same `userContent` is pushed on both the create path and the
reuse path (`activeEntry.inputStream.push(userContent, { priority: 'next' })`
at ~line 790).

For `claudeAi`: `shouldPersistClaudeAgentSdkSession` (input-projector.ts:403-412)
returns `false`, so `shouldResumeProviderSession` is always false, so scope is
always `'full'` — even when `activeEntry` exists and its Query already
received every earlier turn.

For `apiKey` (`persistSession` on): turn 1 creates the Query with `'full'`
(correct — fresh process). Later turns have `providerSessionId` set, so scope
is `'recentCradleLocal'` (correct).

### Excerpt B — the model switch gate (provider.ts, ~lines 762-767)

```ts
if (shouldResumeProviderSession && pendingModelSwitchId) {
  await activeEntry.query.setModel(
    pendingModelSwitchId === CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID
      ? undefined
      : pendingModelSwitchId,
  )
}
```

`pendingModelSwitchId` comes from the provider state snapshot
(`readClaudeAgentPendingModelSwitchId`, provider.ts:539). For `claudeAi`
sessions the `shouldResumeProviderSession` conjunct is always false, so a
user-initiated model switch never reaches the live Query.

`Query.setModel(model?: string): Promise<void>` exists at sdk.d.ts:2278, and
`applyFlagSettings` is already used by this provider
(`updateActiveQueryUltracode`, provider.ts:1864) — live control requests on a
running Query are an established pattern here, not a new technique.

### Excerpt C — per-turn options rebuild (provider.ts, ~lines 566-579)

```ts
const queryOptions = buildClaudeQueryOptions({
  deps: this.deps,
  input,
  abortController,
  attachPermissionHandler: true,
  permissionBridgeState,
  emitToolApprovalRequest: request =>
    this.emitClaudeAgentToolApprovalRequest(sessionId, request),
  onStderr: stderrSink.onStderr,
})
if (!activeEntry) {
  ...
  const activeQuery = query({ prompt: inputStream, options: queryOptions })
```

`buildClaudeQueryOptions` (input-projector.ts:192) is called unconditionally;
its result is consumed only inside `if (!activeEntry)`. Side effects inside the
build: `resolveApiKey(...)` (line 211), and further down SDK config-dir
preparation and skill projection. On the reuse path all of that work — and any
changes the user made to skills/effort/tools/mcpServers — is thrown away.

### Excerpt D — maxTurns (input-projector.ts:237, provider-base.ts:80,236)

```ts
// input-projector.ts:237 (inside the queryOptions literal)
maxTurns: config.maxTurns,
```

`config.maxTurns` defaults to 100 (`provider-base.ts:80` schema default,
`:236` reader fallback). sdk.d.ts:1638 documents `maxTurns?: number` as a
limit on conversation turns. On a long-lived Query that accumulates user turns
across the whole chat session, the session hits the cap and ends as a
`result`-with-max-turns — to the user, the session silently dies around turn
100. The ephemeral side queries (`quickQuestion` provider.ts:452,
`generateSessionTitle` provider.ts:1903, `getPresentation`) are single-purpose
and short; the cap is meaningless there too but harmless.

### Excerpt E — settingSources (input-projector.ts:414-424)

```ts
function claudeAgentSettingSourcesForAuthMode(
  authMode: ClaudeAgentAuthMode,
): NonNullable<Options['settingSources']> {
  switch (authMode) {
    case 'claudeAi':
      return ['user', 'project', 'local']
    case 'apiKey':
    default:
      return []
  }
}
```

sdk.d.ts:1860-1870:

> When omitted, all sources are loaded (matches CLI defaults).
> Pass `[]` to disable filesystem settings (SDK isolation mode).
> **Must include `'project'` to load CLAUDE.md files.**

So in `apiKey` mode the SDK subprocess loads no CLAUDE.md, no
`.claude/settings.json`, no user global settings — the two auth modes behave
like two different agents. The original `[]` was presumably chosen to isolate
the subprocess from user-global config when a custom baseUrl/apiKey is in
play; unifying to `['user', 'project', 'local']` changes what user-global
settings (including user-configured hooks and MCP servers from
`~/.claude/settings.json`) reach the subprocess. Step 5 below therefore
unifies to `['project', 'local']` only — CLAUDE.md and project settings load,
user-global stays isolated — and calls the trade-off out in the commit
message.

### Conventions

- Conventional commits (`fix(scope): ...` — see `git log`).
- Tests: vitest, colocated `*.test.ts`. The claude-agent suite baseline is
  green: 17 files / 160 tests. `provider.test.ts` already builds fake SDK
  `query` factories and asserts on captured `Options` and pushed user content —
  model new tests on it.
- Plan 062 (`plans/062-claude-native-session-projection.md`) is DONE and
  settled: long-lived Query ownership, `result`-as-turn-boundary, SDK owns the
  queue. Do not restructure `streamTurn`'s turn machinery.
- `timeout` (coreutils) and `npx` are **not available** on this machine; use
  `pnpm vitest run ...` directly. Do not `cd`; run from repo root.

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Typecheck server | `pnpm typecheck:server` | exit 0 |
| Scoped tests | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` | all pass (baseline: 17 files / 160 tests) |
| Full server tests | `pnpm --filter @cradle/server test` | all pass |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` (history/model-switch paragraphs)
- Existing colocated `provider.test.ts` / `input-projector.test.ts` (extend)

**Out of scope** (do NOT touch, even though they look related):

- `packages/chat-runtime-contracts/**`, `packages/db/**` — no contract or schema change.
- `apps/server/src/modules/provider-contracts/provider-base.ts` — do NOT change the `maxTurns` schema default or the dead `permissionMode` projection; the fix is at the consumption site. (The dead field is noted in Plan 068.)
- Anything Plan 065 owns: the `permissionMode` startup value, `setPermissionMode` startup sync, `activePermissionModesBySession` cache, dispose wiring, `commands_changed`, snapshot array bounds. If 065 has not landed, re-locate symbols by name and do not "also fix" its items.
- Live reconciliation of `mcpServers`/`skills`/`tools`/`disallowedTools` via `setMcpServers`/`reloadSkills`/`applyFlagSettings` — deferred; needs a product policy on which settings may change mid-session (see Maintenance notes).
- SDK `sessionStore` (alpha) adoption — deferred; it is the principled long-term fix for `claudeAi` persistence, not a correctness patch.
- `quickQuestion` / `generateSessionTitle` / `getPresentation` ephemeral queries, except Step 4's `maxTurns` omission which applies to `buildClaudeQueryOptions` globally.

## Git workflow

- Branch: `advisor/066-claude-agent-live-query-config-and-history`
- Conventional commits, one per step, e.g. `fix(claude-agent): scope replayed history to what the live query has not consumed`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Base history scope on what the receiving Query has consumed

In `provider.ts` `streamTurn`:

- Move the `userContent` construction (Excerpt A) to **after** the
  `activeEntry` lookup and stale-entry close (after the `if (activeEntry && (...closed...))` block, ~line 552).
- Change the scope rule to: a Query that already exists (or that will resume a
  persisted SDK session) has already consumed the earlier history; only a
  brand-new, non-resuming Query needs `'full'`:

```ts
const historyScope = (activeEntry || shouldResumeProviderSession)
  ? 'recentCradleLocal' as const
  : 'full' as const
```

(Keep `shouldResumeProviderSession` computed where it is; only the
`userContent` construction moves. Note `activeEntry` may be `undefined` after
the stale-close block — the expression handles that.)

**Verify**: add the regression test from Test plan item 1 first (it must fail
before the change), then apply the edit and run
`pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot`
→ all pass.

### Step 2: Build `queryOptions` only when creating a Query

In `provider.ts` `streamTurn`, move the `buildClaudeQueryOptions({...})` call
(Excerpt C) inside the `if (!activeEntry)` block. The reuse path (the `else`
branch at ~line 659) must not build options at all — it already applies the
two live-syncable settings explicitly (`updateActiveQueryUltracode` at ~680,
`updateActiveQueryPermissionMode` at ~684) and Step 3 adds the model switch.

Check for other uses of `queryOptions` below the `if/else` before moving it —
if any exist, STOP (see STOP conditions).

**Verify**: `pnpm typecheck:server` → exit 0. Scoped tests → all pass except
possibly tests asserting per-turn side effects of the options build (e.g. a
test counting `resolveApiKey` calls across two turns); update those to the new
behavior.

### Step 3: Apply the pending model switch on every live Query, not just resumed ones

In `provider.ts` (~line 762, Excerpt B), drop the `shouldResumeProviderSession`
conjunct so the block becomes:

```ts
if (pendingModelSwitchId) {
  await activeEntry.query.setModel(...)
}
```

Keep the snapshot-clearing behavior that follows it exactly as-is (the
existing tests at provider.test.ts:3296-3384 pin the "does not call setModel
when a resumed turn repeats the snapshot model override" semantics — those
must stay green).

**Verify**: scoped tests → all pass, including the existing setModel tests and
the new one from Test plan item 2.

### Step 4: Remove `maxTurns` from session Query options

In `input-projector.ts` `buildClaudeQueryOptions`, delete the
`maxTurns: config.maxTurns,` line (line 237). `maxTurns` then falls back to
the SDK default (unlimited) for every query this provider spawns.

Rationale to put in the commit message: `maxTurns` caps *conversation turns of
the whole Query*, not agentic loop iterations of one user prompt; on a
long-lived session Query it kills the session at turn ~100
(`provider-base.ts:80` default). The config field stays in the schema
(out-of-scope file) but is no longer consumed — note that in the commit
message too.

**Verify**: `grep -n "maxTurns" apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` → no match. Scoped tests → update any test asserting `maxTurns` in captured `Options` (search `provider.test.ts` / `input-projector.test.ts` for `maxTurns`), then all pass.

### Step 5: Load project-level settings in `apiKey` mode

In `input-projector.ts` `claudeAgentSettingSourcesForAuthMode` (Excerpt E),
change the `apiKey`/default branch from `[]` to `['project', 'local']`. Do not
add `'user'` — user-global settings (including user hooks and MCP servers from
`~/.claude/settings.json`) stay isolated from credential-bearing custom
endpoints; that half of the isolation is a deliberate product boundary, say so
in a one-line comment and in the commit message.

Effect (sdk.d.ts:1868): CLAUDE.md and `.claude/settings.json` now load in
`apiKey` mode, matching `claudeAi`.

**Verify**: scoped tests → update the test asserting `settingSources: []`
(provider.test.ts:674) to `['project', 'local']`; the `claudeAi` assertion at
provider.test.ts:1171 must stay unchanged. Then all pass.

### Step 6: Align the README

In `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md`:

- Find the paragraph describing history projection (search for `historyScope`
  or "history"); state that history is replayed in full only to a Query that
  has not consumed it (fresh, non-resumed process), and that a live or resumed
  Query receives only the recent local slice.
- Find any statement that model switches require a resumed/persisted session;
  correct it: pending model switches are applied to the live Query via
  `setModel()` regardless of auth mode.
- If the README promises per-turn re-read of skills/effort/tools config,
  correct it: those are fixed at Query creation; only permission mode,
  ultracode effort flag, and model switch sync live.

**Verify**: `grep -n "full history" apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` → any remaining match must describe the fresh-process case only.

### Step 7: Full verification pass

1. `pnpm typecheck:server` → exit 0
2. `pnpm lint` → exit 0
3. `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` → all pass (≥160 + new)
4. `pnpm --filter @cradle/server test` → all pass

## Test plan

Model new tests after the existing patterns in `provider.test.ts` (fake
`query` factory capturing `Options` and pushed content):

1. **History scope follows the live Query (the O(N²) regression)**: with
   `authMode: 'claudeAi'`, run turn 1 (creates the Query — assert pushed user
   content embeds the full formatted history), then turn 2 on the same session
   (same live entry — assert pushed user content uses the
   `recentCradleLocal` slice, i.e. does NOT re-embed the turn-1-era full
   transcript). Name the test after the replay bug.
2. **Model switch applies without resume**: with `authMode: 'claudeAi'` and a
   `pendingModelSwitchId` in the provider state snapshot, assert
   `activeQuery.setModel` is called on the live Query (mirror the existing
   apiKey-mode test at provider.test.ts:3296).
3. **Options built once**: two sequential `streamTurn` calls on one session →
   the fake `query` factory is invoked once (this may already be covered;
   extend rather than duplicate).
4. **`maxTurns` absent**: captured `Options` for a session query has
   `maxTurns === undefined`.
5. **`settingSources`**: `apiKey` mode → `['project', 'local']`;
   `claudeAi` mode → `['user', 'project', 'local']` (unchanged).

Verification: command #3 in Step 7 → all pass including the new tests.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck:server` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0
- [ ] `grep -n "historyScope: shouldResumeProviderSession" apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` → no match
- [ ] `grep -n "maxTurns" apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` → no match
- [ ] `grep -n "shouldResumeProviderSession && pendingModelSwitchId" apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` → no match
- [ ] `grep -n "return \[\]" apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` → no match in `claudeAgentSettingSourcesForAuthMode`
- [ ] New tests from the Test plan exist and pass
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- After 065 lands, any excerpt above cannot be re-located by symbol name in
  `streamTurn` (e.g. the `if (!activeEntry)` structure changed) — report the
  new shape instead of guessing.
- `queryOptions` is referenced below the `if (!activeEntry)/else` structure
  (Step 2) — some other consumer exists that this plan didn't see.
- Dropping the resume conjunct in Step 3 breaks the existing
  `setModel` dedup tests in a way that suggests model switches were
  deliberately resume-gated (check `git log -S "shouldResumeProviderSession && pendingModelSwitchId"` for the introducing commit and report its rationale).
- The `recentCradleLocal` slice turns out to drop context the live Query does
  NOT actually have (e.g. Cradle-side edits/deletes of earlier messages are
  not reflected in the SDK subprocess) — that would mean history divergence is
  a real product behavior to design for, not a bug to patch.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- **Deferred, deliberately**: live reconciliation of `mcpServers`, `skills`,
  `tools`, `disallowedTools`, and effort mid-session. The SDK control surface
  exists (`Query.setMcpServers` sdk.d.ts:2490, `reloadSkills` :2418,
  `reloadPlugins` :2412, `applyFlagSettings` :2320 — already used by
  `updateActiveQueryUltracode`), but which settings may change mid-session is a
  product policy decision; until then those configs are creation-time only
  (documented in Step 6's README edit).
- **Deferred**: SDK `sessionStore` (sdk.d.ts:713, alpha) would let `claudeAi`
  sessions persist and resume, eliminating the fresh-process full replay on
  session reopen too. Evaluate when the API stabilizes.
- Reviewers should scrutinize: Step 1's interaction with Cradle-side message
  editing (if users can edit/delete earlier turns, the live Query's context
  and Cradle's history diverge — today that divergence already exists for
  apiKey mode; Step 1 only extends it to claudeAi); Step 5's security
  trade-off (project settings can define hooks/MCP servers — they now load in
  apiKey mode, which is the CLI default behavior but a change for Cradle).
- After this lands, `config.maxTurns` in `provider-base.ts` is unconsumed by
  the claude-agent provider; Plan 068 notes the cleanup.
