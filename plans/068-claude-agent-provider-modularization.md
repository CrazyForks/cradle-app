# Plan 068: Split the 3041-line claude-agent `provider.ts` into an owner directory, re-justify the workflow declaration-extractor, and delete the dead `permissionMode` config projection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cc3facef..HEAD -- apps/server/src/modules/chat-runtime-providers/claude-agent apps/server/src/modules/provider-contracts/provider-base.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/065-claude-agent-sdk-integration-correctness.md, plans/066-claude-agent-live-query-config-and-history.md, plans/067-claude-agent-pretooluse-hard-denies.md (all three edit `provider.ts` / `input-projector.ts`; splitting first would force them through a moving target — land them first)
- **Category**: tech-debt
- **Planned at**: commit `cc3facef`, 2026-07-26

## Why this matters

`provider.ts` is 3041 lines with ~60 methods and is the only chat-runtime
provider that has not been decomposed into an owner directory (codex is split
into `app-server/`, `app-server-protocol/`, `config/`, `projection/`, `turn/`,
plus focused single-file modules). Every correctness fix (Plans 065-067) has
to navigate it, and its 6103-line test file compounds the problem.
Separately, two smaller debts ride along because they are one-commit each and
would never justify their own plan: the workflow `declaration-extractor`
executes user scripts in a worker to *guess* structure (a heuristic the repo
rules say must be argued, not assumed), and `readTrustedClaudeAgentConfig`
projects a `permissionMode` field that nothing consumes.

## Current state

### Files (roles)

- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` (3041 lines) — everything below lives in this one class.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts` (6103 lines).
- `apps/server/src/modules/chat-runtime-providers/codex/` — the exemplar owner-directory shape: `provider.ts` keeps the `ChatRuntime` facade; cohesive areas live in subdirectories (`projection/state-projector.ts`, `turn/`, `config/`).
- `apps/server/src/modules/chat-runtime-providers/claude-agent/workflow/declaration-extractor.ts` (305 lines) — see Excerpt B.
- `apps/server/src/modules/provider-contracts/provider-base.ts` — `readTrustedClaudeAgentConfig` (line 219).

### Excerpt A — provider.ts method inventory (from grep of method boundaries)

Lines and groups (verified against the file at `cc3facef`):

- **Session/query lifecycle**: fields 323-327, `releaseQuery` 330,
  `startChatSession` 342, `resumeChatSession` 360, `closeSessionQuery` 1486,
  `releaseSubmittedInputsOnQueryClose` 1542, `dispose` 1678.
- **Turn streaming**: `streamTurn` 522, `pumpClaudeSessionQuery` 823,
  `finalizeClaudeUserTurn` 867, `steerTurn` 1631, `cancelTurn` 1649,
  `submitNativeInput` 1558, `cancelNativeInput` 1598, `hasNativeInput` 1616.
- **Message dispatch**: `handleClaudeSessionMessage` 886,
  `handleClaudeProviderThreadMessage` 1031, `handleClaudeCommandLifecycle` 1513,
  `handleClaudeSyntheticSessionMessage` 1217, `resolveMessageLifecycleSupport` 1505.
- **Synthetic/provider-thread turns**: `ensureClaudeProviderThreadTurn` 1060,
  `publishClaudeProviderThreadEvent` 1084, `completeClaudeProviderThreadTurns` 1104,
  `emitClaudeProviderThreadParentOutput` 1122,
  `emitClaudeAgentToolApprovalRequest` 1167,
  `resolveClaudeToolApprovalProviderThreadTurn` 1193,
  `ensureClaudeMainSyntheticTurn` 1269,
  `ensureClaudeProviderThreadSyntheticTurn` 1295,
  `completeClaudeSyntheticTurns` 1323, `enqueueClaudeSyntheticTurnEvent` 1345,
  `publishClaudeSyntheticTurnEvent` 1356, `updateClaudeTurnProviderSession` 1383,
  `emitClaudeAssistantUsageEvent` 1429.
- **Presentation/capabilities**: `getPresentation` 388, `getDraftPresentation` 414,
  `getUiSlotStates` 418, `getContextUsage` 1621, compact-state helpers
  1760-1830.
- **Settings sync**: `updateActiveQueryPermissionMode` 1832,
  `updateActiveQueryUltracode` 1856, `requestRuntimePermissionModeUpdate` 1871,
  `updateRuntimeSettings` 1894.
- **Title & account**: `generateSessionTitle` 1903, `reportClaudeSessionTitle` 1940,
  `captureClaudeAgentAccountSnapshot` 1965, `resolveClaudeSessionTitleGenerationConfig`
  2074, `generateClaudeSessionTitleInBackground` 2118.
- **Provider threads / fs reads**: `listProviderThreads` 1684,
  `readProviderThread` 1729, `listProviderThreadTurns` 1738,
  `projectClaudeAgentRuntimeState` 1983, `resolveClaudeSessionProjectDir` 2010,
  `resolveClaudeProviderThreadDir` 2019, `readClaudeSubagentMessages` 2027,
  `resolveClaudeSubagentThreadRecord` 2036.

### Excerpt B — declaration-extractor (declaration-extractor.ts:1-60)

```ts
import { Worker } from 'node:worker_threads'
...
/**
 * Explores the finite Workflow declaration paths reached by an AST-instrumented
 * inert execution. Resource limits are explicit; truncation is surfaced through
 * `incomplete` and never represented as exhaustive discovery.
```

It instruments the user's workflow script (`declaration-instrumenter.ts`) and
executes it in a worker thread with caps (`MAX_SCRIPT_BYTES = 512 * 1024`,
`MAX_PATHS = 256`, `EXTRACTION_TIMEOUT_MS = 3_000`) to recover declared
phases/agents. The repo's own rule (AGENTS.md: "Discuss before using
heuristics") was never satisfied for this subsystem — there is no recorded
rationale for why structure is guessed by execution instead of required from a
static declaration format. Note the existing mitigations: worker isolation,
explicit caps, and `incomplete` honesty — this is a *re-justification or
replacement* task, not an emergency rip-out.

### Excerpt C — dead config projection (provider-base.ts:230)

```ts
permissionMode: config.permissionMode === 'plan' ? 'plan' : 'bypassPermissions',
```

`grep -rn "config\.permissionMode" apps/server/src` returns only this
definition site — no consumer. It also defaults to `bypassPermissions`, so if
anything ever did consume it, it would be a fail-open. Delete the field from
the returned object (keep the `ClaudeAgentConfig` type field only if the type
is shared — check; if the type field is required by the zod schema or another
reader, STOP and report instead of half-deleting).

### Conventions

- Module boundary check: `pnpm --filter @cradle/server check:boundaries` must
  stay green — new files must respect the module's allowed imports.
- Match codex's owner-directory idiom: `provider.ts` remains the exported
  facade class; extracted areas become `*.ts` modules taking explicit
  dependencies (state maps, deps, logger) rather than reaching into the class.
- One semantic React/TS export per file where applicable; no re-export
  pass-through files (AGENTS.md).
- Baseline before starting: claude-agent suite 17 files / 160 tests green;
  `pnpm --filter @cradle/server test` green.

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Typecheck server | `pnpm typecheck:server` | exit 0 |
| Module boundaries | `pnpm --filter @cradle/server check:boundaries` | exit 0 |
| Scoped tests | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` | all pass |
| Full server tests | `pnpm --filter @cradle/server test` | all pass |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope**:

- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.ts` (shrink to facade)
- New files under `apps/server/src/modules/chat-runtime-providers/claude-agent/` (subdirectories allowed, mirroring codex)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/provider.test.ts` (split along the same seams)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/workflow/declaration-extractor.ts` and `declaration-instrumenter.ts` (only if the Step 6 decision is "replace"; otherwise docs-only)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/workflow/README.md`
- `apps/server/src/modules/provider-contracts/provider-base.ts` (Excerpt C field only)

**Out of scope**:

- Any behavior change to the extracted code. This plan is a move, not a fix.
  Plans 065-067 own the behavior; if you spot a bug while moving, note it in
  the commit message or a follow-up — do not fix it here.
- Other providers, `packages/**` (except the single provider-base.ts field),
  `workflow/execution.ts`, `state-projector.ts`, `event-to-chunk-mapper.ts`
  (they are already separate files; do not re-split them).
- Rewriting `provider.test.ts` from scratch — move tests with their code.

## Git workflow

- Branch: `advisor/068-claude-agent-provider-modularization`
- One commit per extracted area (each keeps the suite green), e.g.
  `refactor(claude-agent): extract provider-thread turn projection from provider.ts`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Order matters: each step must leave typecheck + scoped tests green before the
next. Extract in this order (least-coupled first):

### Step 1: Extract provider-thread / synthetic-turn projection

Move the "Synthetic/provider-thread turns" group (Excerpt A) into
`claude-agent/projection/provider-thread-turns.ts` (create the `projection/`
directory to mirror codex). These methods share state (`mapperState`,
snapshot writes) — pass an explicit context object; do not import the provider
class. Update `provider.ts` to delegate.

**Verify**: `pnpm typecheck:server` → 0; scoped tests → green.

### Step 2: Extract presentation/capabilities + compact state

Move `getPresentation`, `getDraftPresentation`, `getUiSlotStates`,
`getContextUsage`, and the compact-state helpers (1760-1830) into
`claude-agent/presentation.ts` (or `projection/ui-slots.ts` if it fits the
codex naming better — pick one and be consistent).

**Verify**: typecheck + scoped tests green.

### Step 3: Extract settings sync

Move `updateActiveQueryPermissionMode`, `updateActiveQueryUltracode`,
`requestRuntimePermissionModeUpdate`, `updateRuntimeSettings` into
`claude-agent/live-settings.ts`. ⚠️ Plans 065-067 touched exactly these —
if their commits are in, extract the *new* code, not the excerpts in those
plans.

**Verify**: typecheck + scoped tests green.

### Step 4: Extract title/account and provider-thread fs reads

Move the "Title & account" and "Provider threads / fs reads" groups into
`claude-agent/session-artifacts.ts` (title generation, account snapshot,
project-dir resolution, subagent message reads).

**Verify**: typecheck + scoped tests + `check:boundaries` green.

### Step 5: Split provider.test.ts along the same seams

Move each extracted area's tests into colocated `*.test.ts` next to its new
module (e.g. `projection/provider-thread-turns.test.ts`). Keep the shared
fake-`query` factory — hoist it into `claude-agent/test-kit.ts` (check first
whether a kit module already exists under `../kit/` to reuse instead).

**Verify**: full scoped suite green; total test count unchanged from baseline
(160, or the post-065/066/067 count — record the baseline before starting).

### Step 6: Re-justify or replace the declaration-extractor

First, write the argument down in `workflow/README.md`: why inert
AST-instrumented execution in a worker is the right way to recover workflow
structure, weighed against (a) requiring a static declaration format and
(b) parsing without execution. If the argument does not hold, replace the
extractor with the static-format approach behind the same
`ClaudeWorkflowDeclaration` interface (declaration-extractor.ts:22-30) so
callers are untouched; keep the worker's resource caps either way. If the
argument holds, the README entry must state the threat model (executing
agent-supplied code, even "inert", in the server process's worker threads)
and why the caps make it acceptable.

**Verify**: `workflow/` tests green; if replaced, `grep -n "worker_threads" apps/server/src/modules/chat-runtime-providers/claude-agent/workflow/declaration-extractor.ts` → no match.

### Step 7: Delete the dead `permissionMode` projection

Remove provider-base.ts:230 per Excerpt C. If `ClaudeAgentConfig`'s type
declaration or the zod schema also carries the field and nothing else reads
it, remove those too; if anything outside this repo's server consumes the
field (check `apps/`, `packages/`), STOP and report.

**Verify**: `pnpm typecheck:server` → 0; `grep -rn "permissionMode" apps/server/src/modules/provider-contracts/provider-base.ts` → no match.

### Step 8: README + full pass

Update `claude-agent/README.md`'s file map to the new layout. Then run:
`pnpm typecheck:server`, `pnpm lint`,
`pnpm --filter @cradle/server check:boundaries`,
`pnpm --filter @cradle/server test` → all exit 0.

## Test plan

No new behavior → no new tests. The plan's safety net is: the pre-existing
suite (160 tests baseline, more after 065-067) passes unmodified in
assertions, with files moved but not rewritten, plus `check:boundaries`.
Step 6's replacement (if taken) must reuse the existing
`declaration-extractor.test.ts` expectations against the new implementation.

## Done criteria

ALL must hold:

- [ ] `provider.ts` ≤ ~800 lines (facade + lifecycle + streamTurn/pump only)
- [ ] `pnpm typecheck:server`, `pnpm lint`, `pnpm --filter @cradle/server check:boundaries`, `pnpm --filter @cradle/server test` all exit 0
- [ ] Test count ≥ pre-split baseline; no test assertions changed
- [ ] `workflow/README.md` contains the declaration-extractor rationale (or the extractor no longer uses `worker_threads`)
- [ ] `grep -rn "permissionMode" apps/server/src/modules/provider-contracts/provider-base.ts` → no match
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- An extracted method reads/writes class-private state that cannot be passed
  explicitly without changing behavior (e.g. ordering-sensitive mutation of
  `activeQueries`) — that area stays in `provider.ts`; report the coupling.
- Plans 065-067 have NOT landed and the code to extract still matches the old
  excerpts — do the extraction against the live code anyway ONLY if the drift
  check passes; otherwise stop.
- Step 6's static-format replacement would change `ClaudeWorkflowDeclaration`
  consumers (`workflow/execution.ts`, state reducer) — that is a bigger
  redesign; report instead of expanding scope.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- After the split, new claude-agent behavior should land in the owning module,
  not back in `provider.ts`; reviewers should reject facade regrowth.
- The `permission-bridge.ts` / `input-projector.ts` / `state-projector.ts`
  trio stays as-is — they are already focused modules.
- If Step 6 keeps the worker executor, a later hardening plan could move it to
  a separate process (worker threads share the server's memory space); that
  was out of scope here because it changes latency characteristics of
  workflow declaration.
