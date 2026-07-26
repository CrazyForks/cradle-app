# Plan 067: Enforce Cradle's hard tool-call denies through a PreToolUse hook so they hold in every permission mode

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cc3facef..HEAD -- apps/server/src/modules/chat-runtime-providers/claude-agent/permission-bridge.ts apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts apps/server/src/modules/chat-runtime-providers/claude-agent/plan-mode.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/065-claude-agent-sdk-integration-correctness.md (065 makes the Query start in the user's real permission mode; this plan assumes that behavior and adds mode-independent denies on top)
- **Category**: bug / security
- **Planned at**: commit `cc3facef`, 2026-07-26

## Why this matters

The provider's entire permission bridge hangs off the SDK's `canUseTool`
callback. The SDK's own runtime warns (string verified in the compiled
`sdk.mjs` of `@anthropic-ai/claude-agent-sdk@0.3.207`):

> "canUseTool will not be invoked: permissionMode 'bypassPermissions'
> auto-approves every tool call (except explicit deny rules) before the
> callback is consulted. To gate every tool call, use a PreToolUse hook
> instead."

Two Cradle behaviors currently live behind `canUseTool` and therefore
silently evaporate whenever a session runs in `bypassPermissions`:

1. **ExitPlanMode hard-deny.** `permission-bridge.ts:64-66` denies the
   ExitPlanMode tool unconditionally (Cradle owns plan-mode exit semantics —
   see `plan-mode.ts`). In bypass mode the denial never runs and the agent can
   exit plan mode behind Cradle's back, desyncing the plan-mode state the
   provider projects.
2. **`AskUserQuestion` transport.** `permission-bridge.ts:55-62` routes the
   agent's questions to the Cradle user via `deps.requestUserInput`. In bypass
   mode the callback is skipped, so the agent's question is auto-approved
   without user input (the model receives an empty/default answer and
   proceeds).

Approvals-as-prompts in bypass mode are *intended* (the user chose bypass);
Cradle's own structural denies and question transport are not — they are
provider semantics, not permission policy. The SDK's supported mechanism that
fires regardless of permission mode is a `PreToolUse` hook. This plan moves
the two structural behaviors to a hook and leaves interactive approval
prompting on `canUseTool`, where it belongs.

## Current state

### Files (roles)

- `apps/server/src/modules/chat-runtime-providers/claude-agent/permission-bridge.ts` (217 lines) — `createClaudeAgentCanUseTool` (line 49); the three-way dispatch quoted below.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/plan-mode.ts` — `isClaudeAgentExitPlanModeToolName`, `denyClaudeAgentExitPlanMode`, `CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE`.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/user-question.ts` — `handleAskUserQuestionViaCanUseTool` is defined in permission-bridge.ts using `projectClaudeAgentUserInputQuestions` / `buildClaudeAgentAskUserQuestionOutput` from here.
- `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` — `buildClaudeQueryOptions`; attaches `queryOptions.canUseTool` at lines 285-292.
- `apps/server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — hook contract (0.3.207).

### Excerpt A — the current dispatch (permission-bridge.ts:54-78)

```ts
return async (toolName, toolInput, options) => {
  if (toolName === 'AskUserQuestion' && input.deps.requestUserInput) {
    return handleAskUserQuestionViaCanUseTool({ ... })
  }
  if (isClaudeAgentExitPlanModeToolName(toolName)) {
    return denyClaudeAgentExitPlanMode()
  }
  return handleClaudeAgentToolPermissionRequest({ ... })
}
```

### Excerpt B — SDK hook contract (sdk.d.ts, verified line numbers)

```ts
// :789
export declare type HookCallback = (input: HookInput, toolUseID: string | undefined, options: {
    signal: AbortSignal;
}) => Promise<HookJSONOutput>;
// :796
export declare interface HookCallbackMatcher { matcher?: string; hooks: ... }
// :809
export declare type HookPermissionDecision = 'allow' | 'deny' | 'ask' | 'defer';
// :1481 (Options)
hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
// :2199-2212
export declare type PreToolUseHookInput = BaseHookInput & {
    hook_event_name: 'PreToolUse';
    tool_name: string;
    tool_input: unknown;
    tool_use_id: string;
};
export declare type PreToolUseHookSpecificOutput = {
    hookEventName: 'PreToolUse';
    permissionDecision?: HookPermissionDecision;
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
};
```

The hook returns `{ continue: true, hookSpecificOutput: { hookEventName:
'PreToolUse', permissionDecision, permissionDecisionReason } }`
(`SyncHookJSONOutput` at sdk.d.ts:6644, union field at :6657).

Semantics that matter (from sdk.d.ts:4043's `permission_denied` doc):
**a PreToolUse hook deny is terminal — it bypasses `canUseTool`.** A hook
decision of `ask` falls back to the normal permission flow (i.e. `canUseTool`
in non-bypass modes; auto-allow in bypass). `HOOK_EVENTS` (sdk.d.ts:784)
confirms `'PreToolUse'` is a supported event in 0.3.207.

### What the hook can and cannot fix

- ExitPlanMode deny → hook returns `deny` with the existing
  `CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE` reason. Terminal in every mode. ✅
- AskUserQuestion → the hook cannot itself prompt the user; but it can return
  `permissionDecision: 'ask'`. In non-bypass modes that defers to
  `canUseTool`, which already implements the Cradle transport. In bypass mode
  there is no interactive fallback, so the question remains auto-allowed —
  **the hook does not fix AskUserQuestion in bypass mode.** Step 3 below
  handles AskUserQuestion by *denying it in bypass with a reason that tells
  the model the transport is unavailable* — an honest failure the agent can
  react to (it will ask in plain text) instead of a silent empty answer.
  This is a deliberate behavior choice; see STOP conditions if you believe
  silent auto-answer is preferable.
- Interactive approvals (`handleClaudeAgentToolPermissionRequest`) stay on
  `canUseTool` untouched.

### Conventions

- Conventional commits; vitest colocated tests; baseline claude-agent suite:
  17 files / 160 tests, green. `permission-bridge` behavior is currently
  tested via `provider.test.ts` fakes and `plan-mode.test.ts`.
- `timeout` and `npx` are not available; run vitest via `pnpm vitest run`.
- Trust TypeScript types; the SDK exports every type needed — no
  `unknown`+guard shims.

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Typecheck server | `pnpm typecheck:server` | exit 0 |
| Scoped tests | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` | all pass |
| Full server tests | `pnpm --filter @cradle/server test` | all pass |
| Lint | `pnpm lint` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `apps/server/src/modules/chat-runtime-providers/claude-agent/permission-bridge.ts`
- `apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` (attach `hooks` in `buildClaudeQueryOptions`)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` (permission-bridge paragraph)
- Colocated tests: `permission-bridge` tests (create `permission-bridge.test.ts` if none exists — check first), `provider.test.ts`, `input-projector.test.ts`

**Out of scope**:

- `plan-mode.ts`, `user-question.ts` — reuse their exports unchanged.
- `canUseTool`'s interactive approval path (`handleClaudeAgentToolPermissionRequest`) — unchanged.
- Any other hook events (`HOOK_EVENTS` lists 30) — this plan adds PreToolUse only.
- Ephemeral queries (`quickQuestion`, title generation, `getPresentation`):
  they pass `attachPermissionHandler: false` and strip tools; do NOT attach
  the hook there (no tools → nothing to gate; AskUserQuestion transport is
  intentionally off those paths already).
- `packages/chat-runtime-contracts/**` — no contract change.

## Git workflow

- Branch: `advisor/067-claude-agent-pretooluse-hard-denies`
- Conventional commits, e.g. `fix(claude-agent): enforce ExitPlanMode deny via PreToolUse hook in all permission modes`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `createClaudeAgentPreToolUseHook` to permission-bridge.ts

New exported function next to `createClaudeAgentCanUseTool`, reusing the same
bridge state so mode/runtimeSettings stay in sync via the existing
`updateClaudeAgentPermissionBridgeState` calls in `buildClaudeQueryOptions`:

```ts
export function createClaudeAgentPreToolUseHook(input: {
  state: ClaudeAgentPermissionBridgeState
}): HookCallback {
  return async (hookInput) => {
    if (hookInput.hook_event_name !== 'PreToolUse') {
      return { continue: true }
    }
    if (isClaudeAgentExitPlanModeToolName(hookInput.tool_name)) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE,
        },
      }
    }
    if (
      hookInput.tool_name === 'AskUserQuestion'
      && input.state.permissionMode === 'bypassPermissions'
    ) {
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'AskUserQuestion is unavailable in bypassPermissions mode; ask the user in plain text instead.',
        },
      }
    }
    return { continue: true } // no opinion → normal flow (canUseTool) decides
  }
}
```

Import `HookCallback` and the plan-mode constant (check what
`denyClaudeAgentExitPlanMode` returns today and mirror its message — read
`plan-mode.ts` first; if `CLAUDE_EXIT_PLAN_MODE_CAPTURED_MESSAGE` is not the
right user-facing reason string, use the one `denyClaudeAgentExitPlanMode`
puts in its `PermissionResult`).

### Step 2: Keep `canUseTool` as-is (no double-deny conflicts)

Do not remove the ExitPlanMode / AskUserQuestion branches from
`createClaudeAgentCanUseTool`. Ordering per sdk.d.ts:4043: hook denies are
terminal and skip `canUseTool`; when the hook has no opinion, `canUseTool`
runs as today. The two layers therefore cannot fight: the hook only ever
speaks for the two structural cases, `canUseTool` keeps the interactive ones.

Verify by reading: with the hook attached, a non-bypass session's
ExitPlanMode call is denied by the hook before `canUseTool` — the existing
plan-mode tests assert the denial outcome, not the layer, so they should stay
green.

### Step 3: Attach the hook in `buildClaudeQueryOptions`

In `input-projector.ts`, inside the same `if (input.attachPermissionHandler
|| hasUserInputHandler)` block that sets `queryOptions.canUseTool`
(lines 285-292), also set:

```ts
queryOptions.hooks = {
  ...queryOptions.hooks,
  PreToolUse: [
    ...(queryOptions.hooks?.PreToolUse ?? []),
    { hooks: [createClaudeAgentPreToolUseHook({ state: permissionBridgeState })] },
  ],
}
```

(The spread preserves any hooks a future caller adds; today none exist.)

**Verify**: `pnpm typecheck:server` → exit 0.

### Step 4: Tests

Write the Test plan items below, then run the scoped suite.

**Verify**: `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` → all pass.

### Step 5: README + full pass

In the claude-agent README permission paragraph, add: hard structural denies
(ExitPlanMode capture, AskUserQuestion-unavailable-in-bypass) are enforced by
a PreToolUse hook and therefore hold in every permission mode; interactive
approvals remain on `canUseTool` and are mode-dependent by design.

Then: `pnpm typecheck:server`, `pnpm lint`,
`pnpm --filter @cradle/server test` → all exit 0.

## Test plan

Model after `plan-mode.test.ts` and the `provider.test.ts` fake-query
patterns:

1. **Hook denies ExitPlanMode regardless of mode**: invoke the hook callback
   with a PreToolUse input for the ExitPlanMode tool name while state
   `permissionMode` is `'bypassPermissions'` and again with `'default'` →
   both return `permissionDecision: 'deny'` with the captured message.
2. **Hook passes through ordinary tools**: any other tool name →
   `{ continue: true }` with no `hookSpecificOutput`.
3. **AskUserQuestion in bypass**: hook returns `deny` with the
   transport-unavailable reason when state mode is `'bypassPermissions'`;
   returns no opinion (`continue: true`, no decision) in `'default'`/`'plan'`
   (so `canUseTool` handles it).
4. **Options wiring**: in `input-projector.test.ts` (or `provider.test.ts`),
   assert captured `Options.hooks.PreToolUse` exists with one matcher when
   `attachPermissionHandler: true`, and that ephemeral paths
   (`attachPermissionHandler: false`, no user-input handler) get no hooks.
5. **Regression — existing plan-mode denial still works end-to-end**: the
   existing plan-mode/provider tests must stay green without modification; if
   one asserts the denial came specifically through `canUseTool`, update the
   assertion to the hook layer and say so in the commit message.

Verification: Step 4 command → all pass including the new tests.

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck:server` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0
- [ ] `grep -n "PreToolUse" apps/server/src/modules/chat-runtime-providers/claude-agent/permission-bridge.ts apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` → matches in both files
- [ ] `grep -rn "hooks" apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts` → `queryOptions.hooks` assignment present
- [ ] New tests from the Test plan exist and pass; pre-existing suite unmodified except assertions explicitly about the denial layer
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The SDK's compiled runtime (`sdk.mjs`) does not actually invoke PreToolUse
  hooks registered via `Options.hooks` in streaming mode (check the control
  protocol handshake; if hook registration requires a different option shape
  than sdk.d.ts:1481 documents, report the discrepancy — do not guess).
- A PreToolUse `deny` is observed (in tests with the fake, or in sdk.mjs
  source reading) to *also* invoke `canUseTool` afterward — that would double
  the denial path and contradict sdk.d.ts:4043.
- `denyClaudeAgentExitPlanMode` in `plan-mode.ts` carries behavior beyond a
  message (e.g. side effects on bridge state) that a hook cannot reproduce —
  report instead of dropping the behavior.
- The product owner wants AskUserQuestion to remain silently auto-answered in
  bypass mode rather than denied-with-reason (Step 1's third branch) — that is
  a product call, not for the executor to make.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The SDK exposes 30 hook events (sdk.d.ts:784). This plan establishes the
  wiring pattern (`Options.hooks` + bridge-state-backed callback); future
  candidates (e.g. `PostToolUse` for audit, `SessionEnd` for cleanup
  projection) should reuse it rather than inventing parallel plumbing.
- `includeHookEvents` (sdk.d.ts:1586) can mirror hook firings into the message
  stream; leave it off unless a UI surface needs hook visibility.
- If Anthropic ever lets `canUseTool` fire in bypass mode, this hook stays
  correct (deny is idempotent across layers) — no migration needed.
- Reviewers should scrutinize: the AskUserQuestion-in-bypass deny reason text
  (the model reads it verbatim); and that `updateClaudeAgentPermissionBridgeState`
  really is called on every settings sync so the hook never sees a stale mode.
