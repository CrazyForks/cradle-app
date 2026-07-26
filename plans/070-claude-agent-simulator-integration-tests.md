# Plan 070: Test the Claude Agent provider against the real wire — shared model-api-simulator harness, port the self-referential SDK-mock tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat cc3facef..HEAD -- apps/server/vitest.config.ts apps/server/package.json packages/model-api-simulator apps/server/src/modules/chat-runtime-providers/claude-agent`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH (the feasibility gate in Step 1 decides whether the rest exists)
- **Depends on**: plans/065-claude-agent-sdk-integration-correctness.md, plans/066-claude-agent-live-query-config-and-history.md (the integration tests assert the *fixed* behavior; landing the harness first would pin the bugs as green)
- **Category**: tests
- **Planned at**: commit `cc3facef`, 2026-07-26

## Why this matters

The claude-agent suite (17 files / 160+ tests) fakes the SDK `query()`
factory. That is fine for asserting `Options` construction, but every claim
about *scheduling, stream lifecycle, permission gating, history projection,
and cancel* is self-referential: the test owns both when the SDK pulls a
prompt and when provider output appears. This was called out when the
simulator was commissioned (advisor-plans/001: "the test owns both sides…
that makes SDK scheduling and stream-lifecycle claims self-referential") —
and that plan explicitly deferred "migrating Cradle providers to consume it"
to a later plan. **This is that plan.**

`@cradle/model-api-simulator` is built and green: loopback HTTP serving the
Anthropic Messages API from checked-in protocol snapshots, with a scenario
gate (unmatched requests fail loudly) and a request ledger. The Claude Agent
SDK spawns a real bundled CLI (`extractFromBunfs` in
`@anthropic-ai/claude-agent-sdk@0.3.207`) that talks to whatever
`ANTHROPIC_BASE_URL`/api-key env it is given. Point the provider's `baseUrl`
at the simulator and the whole stack — provider → SDK → real CLI subprocess →
HTTP wire — runs for real, deterministically, offline.

One shared simulator per test run, started once in vitest `globalSetup` —
not per file, not per test.

## Current state

- `packages/model-api-simulator/src/index.ts` — `startModelApiSimulator({ port? })` → `{ anthropicBaseUrl, openaiBaseUrl, controller, close() }`; port `0` picks a free port. `controller.enqueue(scenario)` gates responses; `src/core/request-ledger.ts` records what actually arrived.
- `apps/server/vitest.config.ts` (whole file): `environment: 'node'`, `setupFiles: ['./vitest.setup.ts']`, `maxConcurrency: 1`, swc + tsconfigPaths plugins. **No `globalSetup` yet.** `maxConcurrency: 1` is already the serial execution a shared simulator + spawned CLI subprocesses need.
- `apps/server/package.json` — has `@cradle/*` workspace deps (`@cradle/chat-runtime-contracts`, `@cradle/db`, …) but **not** `@cradle/model-api-simulator`. Its `test` script builds plugin-sdk and plugins first.
- Provider config path for pointing at the simulator: the provider target's `configJson` carries `baseUrl` + `apiKey` (`readTrustedClaudeAgentConfig`, provider-base.ts:219); `buildClaudeQueryOptions` resolves the credential env var (`projectAnthropicCredentialEnvVar`, input-projector.ts:428) — `ANTHROPIC_API_KEY` for a plain baseUrl.
- `packages/model-api-simulator` protocol profile (from its own plan): `POST /v1/messages` (streaming + non-streaming), `count_tokens`, `GET /v1/models[/:model]`, error envelopes. Anything the CLI calls beyond that profile is a feasibility question — Step 1 answers it empirically.

## Commands you will need

| Purpose | Command (run from repo root) | Expected on success |
|---|---|---|
| Typecheck server | `pnpm typecheck:server` | exit 0 |
| Simulator tests | `pnpm --filter @cradle/model-api-simulator test` | all pass |
| Integration suite | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent/integration --reporter=dot` | all pass |
| Scoped unit suite | `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent --reporter=dot` | all pass |
| Full server tests | `pnpm --filter @cradle/server test` | all pass |

## Scope

**In scope**:

- `apps/server/package.json` (add `"@cradle/model-api-simulator": "workspace:*"` to devDependencies)
- `apps/server/vitest.config.ts` (add `globalSetup`)
- New: `apps/server/vitest.global-setup.ts`
- New: `apps/server/src/modules/chat-runtime-providers/claude-agent/integration/` (harness helper + integration specs)
- `apps/server/src/modules/chat-runtime-providers/claude-agent/README.md` (testing section)
- `plans/README.md` status row

**Out of scope**:

- `packages/model-api-simulator/**` — if the CLI needs an endpoint the simulator's protocol profile doesn't cover, STOP and report (simulator extension is its owner's plan, not a drive-by here).
- Existing unit tests — do NOT delete the fake-`query` suites; Step 4 explains the division of labor. Only tests whose assertions were self-referential *scheduling/lifecycle* claims get ported; pure `Options`-construction assertions stay unit.
- Codex / OpenAI side of the simulator — same pattern, separate plan.
- CI workflow files — if CI needs a flag to skip the integration dir on machines without the CLI runtime, report instead of editing workflows here.

## Git workflow

- Branch: `advisor/070-claude-agent-simulator-integration-tests`
- Conventional commits, e.g. `test(claude-agent): add shared model-api-simulator harness`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Feasibility gate — boot the real CLI against the simulator (spike, timebox: half a day)

Write a throwaway script (not a committed test yet) that:

1. `startModelApiSimulator({ port: 0 })`;
2. enqueues a minimal scenario answering one user turn with a text reply;
3. calls the real `query()` from `@anthropic-ai/claude-agent-sdk` with
   `options = { cwd: <tmp dir>, model: <scenario model>, permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, settingSources: [] }` and the env the provider would set (`ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` pointing at the simulator — check how the SDK/CLI picks up baseUrl; if it only reads env vars, spawn env is the seam; if `Options` has a field, use it);
4. drives one prompt to a `result` message.

**Gate outcomes**:

- Works → delete the spike, proceed. Record the exact working options/env shape in the commit message of Step 2 — the harness depends on it.
- CLI demands real Anthropic auth / phones home / calls endpoints outside the simulator profile → STOP, report the exact requests from the simulator's failure output and request ledger. Do NOT stub around it and do NOT expand the simulator in this plan.

### Step 2: Shared harness — one simulator per test run

`apps/server/vitest.global-setup.ts` (new): `startModelApiSimulator({ port: 0 })` once; expose the base URL to workers via vitest `provide` (or `process.env.CRADLE_TEST_ANTHROPIC_BASE_URL` — pick whichever the repo's vitest version supports for `globalSetup` → test context; state the choice in a comment); teardown calls `close()`. Register it in `vitest.config.ts` (`globalSetup: ['./vitest.global-setup.ts']`).

Guard: if the env/provide value is absent (e.g. someone runs a different config), the integration helper must `describe.skip` with a printed reason — never fall back to a real network call.

`integration/harness.ts` (new): helper that builds a provider target whose `configJson` points `baseUrl`/`apiKey` at the shared simulator, constructs the provider with the same deps the unit tests use, and exposes `simulator.controller` + the request ledger. Model its shape on how `provider.test.ts` already builds targets/deps — the only difference is no `query` mock.

**Verify**: `pnpm vitest run apps/server/src/modules/chat-runtime-providers/claude-agent/integration --reporter=dot` with one smoke spec (one turn, one text reply, assert the provider yielded text chunks and the ledger recorded exactly one `/v1/messages` streaming request) → green.

### Step 3: Port the wire-observable behavior assertions

Add integration specs for the assertions that Plans 065/066 made but could only test against mocks. Mapping (each names the behavior it pins):

1. **History replay (066 Step 1)** — `claudeAi` auth mode, two turns on one session: the ledger's second `/v1/messages` request must NOT re-contain the full earlier transcript (assert on recorded request body), while a fresh session's first request does. This is the O(N²) regression pinned at the wire.
2. **Startup permission mode (065 Step 1)** — enqueue a scenario whose reply requests a tool call; in `plan` mode the provider's `canUseTool` gate fires before any tool result returns (assert via approval-request hook + ledger: no tool_result follows without approval); in `bypassPermissions` the tool executes without gating. This kills the self-referential version of the bypass-window claim.
3. **Cancel teardown (065 Step 5)** — start a turn with a slow/streaming scenario, cancel before first output: assert the HTTP connection terminates, the CLI child process exits (no orphan — check via the provider's `activeQueries` being empty AND process teardown), and the next turn creates a fresh session that the simulator answers.
4. **Project settings load (066 Step 5)** — seed the temp `cwd` with a `CLAUDE.md`; in `apiKey` mode the first request's system prompt contains it (ledger body assertion).

If a mapped assertion proves impossible to express at the wire (e.g. the CLI doesn't expose the behavior through HTTP), keep the unit test and note why in the spec file — do not force it.

**Verify**: integration suite green; scoped unit suite still green (unported assertions intact).

### Step 4: Write down the division of labor

In `claude-agent/README.md`, testing section: **unit tests with the fake
`query` factory own `Options`-construction assertions** (effort mapping,
mcpServers projection, skills selection, snapshot writers); **integration
tests against the shared simulator own behavior claims that cross the
SDK/CLI boundary** (history content, permission gating, cancel/process
lifecycle, wire payload shapes). New behavior tests must justify which side
they're on; new self-referential scheduling assertions in unit tests should
be rejected in review.

**Verify**: `pnpm typecheck:server` → 0; `pnpm --filter @cradle/server test` → all pass (integration included).

## Test plan

This plan *is* tests. Required coverage = the smoke spec (Step 2) + the four
mapped specs (Step 3). The full server suite must stay green with the
integration directory included; the suite stays serial (`maxConcurrency: 1`
already set — do not raise it; the shared simulator and CLI subprocesses
assume it).

## Done criteria

ALL must hold:

- [ ] `pnpm typecheck:server` exits 0
- [ ] `pnpm --filter @cradle/model-api-simulator test` exits 0 (untouched)
- [ ] `pnpm --filter @cradle/server test` exits 0 including `claude-agent/integration/`
- [ ] Exactly one simulator instance per test run (globalSetup; grep the integration dir for `startModelApiSimulator` → only the harness/global-setup references it)
- [ ] The four Step-3 specs exist and pass; skipped-with-reason is acceptable only with the documented wire limitation
- [ ] No test outside `claude-agent/integration/` imports `@cradle/model-api-simulator`
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's gate fails (CLI won't run against the simulator offline, demands real auth, or calls endpoints outside the simulator's protocol profile). Report the ledger evidence; the fallback is "keep unit tests, defer integration" — say that instead of forcing it.
- The simulator must be modified to make the CLI work — that belongs to the simulator owner's plan; report the gap (endpoint/behavior + ledger excerpt).
- Running the real CLI in the test environment needs network access, credentials, or writes outside the repo tmp dirs.
- Integration tests are flaky after a genuine stabilization attempt (serial run, explicit scenario gating, generous but bounded waits) — flakiness here means the CLI's timing assumptions leak; report rather than committing `sleep()`-driven tests.
- Plans 065/066 have not landed and the Step-3 assertions would pin the *unfixed* behavior — wait or land the harness (Steps 1-2) only, marking specs `.skip` with the plan dependency noted.

## Maintenance notes

- The request ledger is the assertion surface of choice — prefer "what actually crossed the wire" over provider-internal state whenever both exist.
- The same harness pattern (globalSetup + shared instance) should serve codex/OpenAI Responses integration later; do not generalize the helper beyond claude-agent in this plan.
- CI: if the bundled CLI can't run in CI, gate the integration dir behind an env flag in a follow-up — flag design is a CI-owner decision.
- Keep scenario fixtures minimal and named after the behavior they pin; the simulator fails loudly on unscripted requests, so every new provider code path that hits the API will break these tests loudly — that is the point.
