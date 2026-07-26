# Plan 001: Build a deterministic Anthropic Messages and OpenAI Responses API simulator

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```sh
> git diff --stat 6b6867b0..HEAD -- \
>   package.json pnpm-lock.yaml pnpm-workspace.yaml README.md .github/workflows/ci.yml \
>   packages/model-api-simulator advisor-plans
> ```
>
> `packages/model-api-simulator/` does not exist at the planned commit. If any
> in-scope existing file changed after `6b6867b0`, compare the "Current state"
> excerpts against live code before proceeding. Treat a semantic mismatch as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: direction / tests / DX
- **Planned at**: commit `6b6867b0`, 2026-07-25

## Why this matters

Cradle's Claude Agent provider tests currently replace the SDK `Query`, so the
test owns both when the SDK pulls a prompt and when provider output appears.
That makes SDK scheduling and stream-lifecycle claims self-referential. Codex
has the same architectural need whenever app-server behavior must be exercised
against the Responses wire protocol without calling a paid or nondeterministic
model.

Create a standalone, Cradle-owned simulator that accepts real Anthropic
Messages and OpenAI Responses clients over loopback HTTP. It must synthesize
payloads from checked-in authoritative protocol snapshots, enforce
provider-specific stream state machines, and expose deterministic scenario
gates to tests. This plan builds the simulator and proves wire compatibility
against the official TypeScript SDKs. Migrating Cradle providers to consume it
is a later plan.

## Product definition and compatibility boundary

The simulator is wire- and behavior-compatible, not model-intelligence
compatible:

- It accepts and validates requests for the in-scope API operations.
- It emits valid JSON responses, SSE frames, headers, pagination resources,
  error envelopes, and connection termination.
- It preserves cross-frame and cross-request correlations such as response
  IDs, item IDs, content-block indices, cumulative usage, and terminal state.
- It never invents a semantic answer for an unmatched prompt. Tests enqueue an
  explicit scenario; an unexpected request fails loudly.

In this plan, "complete" means complete coverage of the **core protocol profile
defined below**, including its schema variants, source-backed invariants, and
simulator-owned transitions. It does not mean complete coverage of every event
family published by either provider, and it does not mean inventing an
undocumented provider state machine:

### Anthropic

- `POST /v1/messages`, non-streaming and streaming.
- `POST /v1/messages/count_tokens`.
- `GET /v1/models` and `GET /v1/models/:model`.
- Stable Messages schemas plus beta Messages fields selected by
  `anthropic-beta` headers, limited to the core content/event branches below.
- Anthropic error envelopes, authentication/version headers, pagination, ping,
  stream error, and disconnect behavior.

### OpenAI

- `POST /v1/responses`, non-streaming and streaming.
- `GET` and `DELETE /v1/responses/:response_id`.
- `POST /v1/responses/:response_id/cancel`.
- `GET /v1/responses/:response_id/input_items`.
- `POST /v1/responses/input_tokens`.
- `POST /v1/responses/compact`.
- `GET /v1/models` and `GET /v1/models/:model`.
- Stable and `beta=true` variants present in the checked-in OpenAI OpenAPI
  snapshot, limited to the core request/output/event branches below.
- OpenAI error envelopes, Bearer authentication, pagination, SSE terminal
  behavior, request IDs, and disconnect behavior.

Explicitly out of scope: OpenAI Chat Completions, Realtime, Assistants, Audio,
Images, Embeddings, Files, Batches, Fine-tuning, and Webhooks; Anthropic Message
Batches, Files, Skills, Admin, Compliance, Environments, Agents, Sessions,
Vaults, and other Managed Agent APIs; Bedrock, Vertex, Foundry, or other cloud
provider dialects.

### Core protocol profile

Check in `protocol/core-scope.json` as the single core allowlist used by snapshot
normalization, schema generation, state machines, corpus coverage, and tests.
Hash it in both provider manifests. Do not infer "common" variants from names
at generation time, and do not build a second exhaustive inventory of everything
outside the allowlist.

The Anthropic core profile includes:

- stream envelopes: `message_start`, `content_block_start`,
  `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop`,
  `ping`, and `error`;
- assistant content blocks: `text`, `tool_use`, `thinking`, and
  `redacted_thinking`;
- deltas: `text_delta`, `input_json_delta`, `thinking_delta`, and
  `signature_delta`;
- non-streaming messages composed from the same content blocks.

The OpenAI Responses core profile includes:

- lifecycle events: `response.queued`, `response.created`,
  `response.in_progress`, `response.completed`, `response.failed`, and
  `response.incomplete`;
- core structure events: `response.output_item.added`,
  `response.output_item.done`, `response.content_part.added`, and
  `response.content_part.done`;
- text/refusal events: `response.output_text.delta`,
  `response.output_text.done`, `response.refusal.delta`, and
  `response.refusal.done`;
- reasoning events: `response.reasoning_summary_part.added`,
  `response.reasoning_summary_part.done`,
  `response.reasoning_summary_text.delta`,
  `response.reasoning_summary_text.done`, `response.reasoning_text.delta`, and
  `response.reasoning_text.done`;
- function-call events: `response.function_call_arguments.delta` and
  `response.function_call_arguments.done`;
- the top-level `error` event;
- output items/content for assistant messages, text, refusal, reasoning, and
  ordinary function calls.

Explicitly exclude these event and output families even when the pinned
upstream schema contains them:

- MCP calls and MCP tool-list events;
- web search, file search, and output-text annotation/citation events;
- image generation and audio/transcript events;
- computer use;
- shell/local-shell events;
- code interpreter and code-execution events;
- provider-hosted bash, text-editor, memory, tool-search, web-fetch, or other
  server-tool events;
- OpenAI custom-tool-call events;
- Anthropic citation deltas and server-tool content blocks.

Normalization may remove whole excluded union branches by their official
discriminator/component identity. It must never copy, rewrite, or hand-maintain
the fields of a retained branch. A client request selecting an excluded tool
family fails core-schema validation with a provider-native
`400 invalid_request_error`. A scenario that tries to enqueue a non-allowlisted
response event fails immediately with a typed
`UnsupportedProtocolVariantError`; it must not start a partial stream.

## Authoritative protocol sources

Use these upstream sources. Do not derive the simulator's wire contract from
Cradle's provider mappers.

### OpenAI

- Official OpenAPI 3.1 repository:
  `https://github.com/openai/openai-openapi`
- Planned upstream `main` commit:
  `5c044be3bf3a42854e99e34616564eeb2124a317`
- Snapshot source:
  `https://raw.githubusercontent.com/openai/openai-openapi/<ref>/openapi.json`
- Official Responses reference:
  `https://developers.openai.com/api/reference/resources/responses/methods/create/`
- Official TypeScript SDK used for conformance: repository version
  `openai@6.34.0` initially, then updated deliberately through the protocol
  refresh workflow.

OpenAI publishes a machine-readable specification. The refresh command must
accept an explicit git ref, resolve and record the exact commit, normalize only
the in-scope paths and core-profile component branches, and record a SHA-256.

### Anthropic

- Official API overview:
  `https://platform.claude.com/docs/en/api/overview`
- Official Messages reference:
  `https://platform.claude.com/docs/en/api/messages`
- Official streaming grammar:
  `https://platform.claude.com/docs/en/build-with-claude/streaming`
- Official TypeScript SDK:
  `https://github.com/anthropics/anthropic-sdk-typescript`
- Planned SDK schema source: `@anthropic-ai/sdk@0.115.0`.

Anthropic does not publish an equivalent standalone OpenAPI file. Generate a
normalized JSON Schema catalogue from selected official SDK exports. At
minimum, the entry module must select stable and beta equivalents of:

- `MessageCreateParams`
- `MessageCountTokensParams`
- `Message`
- `MessageTokensCount`
- `RawMessageStreamEvent`
- model list/retrieve request and response types
- public error response types needed for the in-scope operations

After generation, retain only whole discriminated union branches allowed by
`protocol/core-scope.json`; do not generate an exhaustive excluded inventory,
witnesses, state-machine families, or route fixtures for other branches.

Use `ts-json-schema-generator` against a checked-in schema-entry TypeScript file
that imports and re-exports only those official types. Alias every selected
export to a unique local catalogue name (for example,
`AnthropicMessageCreateParams` versus `AnthropicBetaMessageCreateParams`);
stable and beta modules contain colliding export names and must not be merged
under their upstream short names. The SDK declaration version and the hashes of
the selected declaration entry files must be recorded in the Anthropic
manifest. Handwritten protocol state machines may add temporal constraints;
they must not duplicate the SDK's payload field definitions.

## Current state

### Repository ownership and package conventions

- `AGENTS.md:7-24` requires a clear namespace owner, read-across/write-within,
  direct TypeScript types, separation of concerns, and discussion before
  heuristics.
- `pnpm-workspace.yaml:1-4` automatically includes every `packages/*`
  directory. No workspace-list edit is needed.
- `package.json:4` pins `pnpm@11.2.2`.
- `package.json:10-20` owns root lint, typecheck, and Vitest commands.
- `packages/download-center/package.json:1-19` is the smallest current exemplar
  for a private TypeScript package with source exports, independent typecheck,
  and Vitest scripts.

Create one owner namespace:

```text
packages/model-api-simulator/
```

Do not place shared simulator semantics under either provider directory.

### Server and SSE conventions

`apps/server/src/app.ts:162-166` constructs the production app with Elysia and
the Node adapter:

```ts
const app = new Elysia({
  name: 'cradle.server.elysia',
  adapter: node(),
  normalize: 'typebox',
})
```

`apps/server/src/modules/download-center/index.ts:38-71` keeps route ownership
in an Elysia module and returns a `Response` around a `ReadableStream` for SSE.
`apps/server/src/modules/download-center/task-events.ts:12-32` shows
abort-aware stream cleanup. Match those route and stream patterns, but do not
copy the production listener lifecycle blindly.

The repository's patched `@elysiajs/node@1.4.5` callback reports `port: 0`
before the underlying Node listener has bound, and `app.stop()` does not own
that callback server. The simulator therefore uses Elysia's web-standard
`app.fetch` as the request handler and a direct `srvx` server as the listener.
`await server.ready()` exposes the resolved random-port URL and
`server.close(true)` owns listener shutdown. This is a deliberate simulator
lifecycle seam, not a new server-wide convention.

### Protocol snapshot convention

`apps/server/scripts/generate-kimi-web-protocol.ts:21-54` snapshots, normalizes,
hashes, and generates a provider protocol. Its checked-in
`apps/server/src/modules/chat-runtime-providers/kimi/protocol/MANIFEST.json:1-17`
records source version, hashes, owner, generator, and refresh command. Reuse
this manifest discipline inside the new package; do not import Kimi code.

### Existing future consumer seams

Claude already projects a configured base URL to `ANTHROPIC_BASE_URL` in
`apps/server/src/modules/chat-runtime-providers/claude-agent/input-projector.ts:333-350`.

Codex already configures an external model provider with `base_url` and
`wire_api: 'responses'` in
`apps/server/src/modules/chat-runtime-providers/codex/config/runtime-config.ts:66-82`.

These files prove future connectivity. They are out of scope for this plan.

## Target module layout

Create this structure. A step may add small private files when needed, but do
not collapse these responsibilities or move them into `apps/server`.

```text
packages/model-api-simulator/
  README.md
  package.json
  tsconfig.json
  tsconfig.test.json
  vitest.config.ts
  scripts/
    refresh-openai-protocol.ts
    refresh-anthropic-protocol.ts
    generate-protocol-artifacts.ts
    check-protocol-artifacts.ts
    check-protocol-coverage.ts
  protocol/
    core-scope.json
    openai/
      openapi.json
      MANIFEST.json
    anthropic/
      schema.json
      schema-entry.ts
      stream-grammar.json
      MANIFEST.json
  src/
    index.ts
    server.ts
    listener.ts
    contract.ts
    core/
      corpus-generator.ts
      corpus-coverage.ts
      json-schema-registry.ts
      request-ledger.ts
      scenario-runtime.ts
      stream-scheduler.ts
    anthropic/
      index.ts
      auth.ts
      errors.ts
      routes.ts
      state-machine.ts
      sse.ts
    openai/
      index.ts
      auth.ts
      errors.ts
      resource-store.ts
      routes.ts
      state-machine.ts
      sse.ts
    generated/
      anthropic-schemas.ts
      openai-schemas.ts
      corpus-manifest.json
      protocol-coverage.json
  tests/
    server.test.ts
    corpus-generator.test.ts
    scenario-runtime.test.ts
    stream-scheduler.test.ts
    anthropic-routes.test.ts
    anthropic-state-machine.test.ts
    anthropic-sdk-conformance.test.ts
    openai-routes.test.ts
    openai-state-machine.test.ts
    openai-sdk-conformance.test.ts
    protocol-artifacts.test.ts
```

If generated artifact size makes TypeScript modules impractical, keep generated
payload corpora as JSON under `protocol/generated/` and generate only typed
registry accessors under `src/generated/`. This is an allowed plan-local choice;
do not remove the checked-in manifest and deterministic artifact check.

## Public package contract

Export a programmatic API, not globals:

```ts
export interface ModelApiSimulator {
  readonly anthropicBaseUrl: string
  readonly openaiBaseUrl: string
  readonly controller: SimulatorController
  close(): Promise<void>
}

export interface SimulatorController {
  enqueue(scenario: SimulatorScenario): void
  waitForRequest(match: RequestMatch): Promise<ObservedRequest>
  release(gate: string): void
  requests(): readonly ObservedRequest[]
  assertExhausted(): void
  reset(): void
}

export async function startModelApiSimulator(
  options?: StartSimulatorOptions,
): Promise<ModelApiSimulator>
```

Required lifecycle semantics:

- Bind only to `127.0.0.1`.
- Default to port `0`.
- Create the listener with `srvx.serve({ fetch: app.fetch, hostname:
  '127.0.0.1', port: 0, gracefulShutdown: false, silent: true })`; await
  `server.ready()` before reading `server.url` or returning the simulator.
- Return `anthropicBaseUrl` as `http://127.0.0.1:<port>` because the Anthropic
  SDK appends `/v1/messages`, and return `openaiBaseUrl` as
  `http://127.0.0.1:<port>/v1` because the OpenAI SDK appends `/responses`.
- Use no process-wide environment mutation.
- `close()` is idempotent, cancels controller-owned streams, then calls the
  retained srvx server's `close(true)`. Do not call `app.stop()` and do not
  reach through srvx or Elysia private/raw fields.
- `reset()` fails if a stream is still open; tests must close or cancel it.
- Multiple simulator instances must not share scenarios, ledgers, IDs, or
  gates.
- No test-control HTTP routes are exposed on the compatible API listener. The
  in-process controller is the control plane for this plan.

## Scenario contract

Define a provider-tagged scenario with ordered exchanges:

```ts
type SimulatorScenario =
  | { provider: 'anthropic', exchanges: AnthropicExchange[] }
  | { provider: 'openai', exchanges: OpenAIExchange[] }
```

Each exchange must contain:

- method and path matcher;
- schema ID for request validation;
- optional semantic matcher for selected fields;
- expected headers;
- response status and headers;
- either one non-streaming body or one stream plan;
- optional resource-store effects for OpenAI retrieve/cancel/delete/input-items;
- a human-readable label included in mismatch errors.

A stream plan is an ordered discriminated union:

```ts
type JsonPrimitive = boolean | number | string | null
type JsonArray = readonly JsonValue[]
type JsonObject = { readonly [key: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonArray | JsonObject

type StreamStep =
  | { kind: 'event', event: JsonValue }
  | { kind: 'gate', name: string }
  | { kind: 'yield' }
  | { kind: 'close' }
  | { kind: 'disconnect', reason: string }
```

The public scenario contract accepts deeply readonly JSON so callers can use
literal fixtures with `as const` without widening or copying them. Centralize
`isJsonArray(value): value is JsonArray` and
`isJsonObject(value): value is JsonObject` predicates at the JSON contract
boundary. Anthropic SSE encoding and both provider state machines must use
those predicates instead of relying on the false branch of
`Array.isArray()`: TypeScript's built-in predicate only narrows mutable arrays
and does not exclude `readonly JsonValue[]` from a union.

Do not add arbitrary real-time sleeps. `yield` means one scheduler turn, but it
does not promise a distinct TCP chunk or SDK callback because transports may
coalesce adjacent writes. Tests that require an externally observable pause use
named gates.

Unexpected requests, invalid request bodies, invalid event payloads, illegal
event transitions, excluded protocol variants, duplicate gate names, release of
unknown gates, unconsumed exchanges, and unclosed streams must produce typed
simulator errors with the scenario label and request ledger index.

## Schema corpus rules

The corpus generator must produce deterministic minimal witnesses and explicit
coverage records. It must understand, for schemas reachable from the retained
core-profile branches:

- `$ref`, `$defs`, `definitions`
- `type`, `const`, `enum`
- `oneOf`, `anyOf`, `allOf`, discriminator
- object required and optional properties
- nullable unions
- arrays
- number and string boundaries
- `additionalProperties`
- recursion

Use these finite witness classes:

- union/discriminator: every branch;
- enum: every value;
- optional property: one minimal baseline with all optional properties absent,
  plus one witness per optional property with that property present; do not add
  a pairwise/combinatorial heuristic;
- nullable: null and non-null;
- array: zero, one, and two elements where allowed;
- string: empty when allowed, minimal normal ASCII, and Unicode;
- numeric values: minimum, ordinary interior value, and maximum when bounded;
- recursion: zero-depth/base and one recursive expansion, then stop by schema
  identity rather than an arbitrary object-depth guess.

Generate schema-invalid near-neighbors separately:

- omit each required field;
- use the wrong discriminator;
- substitute one wrong primitive type;
- exceed a declared bound.

Generate protocol-invalid scenarios separately in state-machine tests:

- reference an unknown correlated ID/index;
- emit a valid event in an illegal protocol position.

The generator must expose coverage in terms of schema branch IDs and protocol
transition IDs. "100%" means every core-profile branch and declared transition
has at least one witness. Non-allowlisted branches are outside the coverage
denominator. Coverage does not claim to enumerate unbounded strings, arrays, or
all Cartesian products.

Property-based tests may use `fast-check`, but every failure must print and
persist the seed in the test output. CI uses fixed default seeds so the suite is
reproducible.

## Protocol state machines

Payload schemas do not define legal SSE ordering. Keep provider grammars
separate. Each enforced transition or correlation must carry an evidence tag:

- `documented:<official-url>#<section>` for a provider-documented invariant; or
- `simulator:<transition-id>` for a constraint the simulator owns only to make
  a declared scenario deterministic.

Simulator-owned constraints must never be described as provider compatibility
requirements. When official sources specify an event payload but not its exact
relative ordering, validate its schema and correlations without inventing a
mandatory predecessor.

### Anthropic grammar

Encode the documented sequence:

```text
message_start
  -> (ping)*
  -> (
       content_block_start(index)
       -> content_block_delta(index)*
       -> content_block_stop(index)
     )*
  -> message_delta+
  -> message_stop
```

Account for documented exceptions:

- ping may occur without changing message state;
- stream error terminates the connection without `message_stop`;
- indices must be contiguous and correlate across start/delta/stop;
- `message_start.message.content` begins empty;
- cumulative usage cannot decrease;
- `message_stop` is terminal.

### OpenAI grammar

Generate event kinds only for the OpenAI allowlist in
`protocol/core-scope.json` and define transition families for:

- queued / created / in-progress lifecycle;
- core output item added/done;
- core content part added/done;
- text, refusal, reasoning, and ordinary function-call deltas/done events;
- completed, failed, and incomplete stream outcomes present in the snapshot;
- cancelled resource state from the cancel operation, without inventing a
  cancelled SSE event when the snapshot does not define one;
- top-level error and transport disconnect.

Correlate `response_id`, output index, item ID, item index, content index, call
ID, and sequence number where present. Terminal events must forbid later
events. An upstream event absent from the core allowlist does not require a
grammar family and does not enter offline coverage.

## Commands the executor will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install after adding package dependencies | `pnpm install` | exit 0; `pnpm-lock.yaml` updated only for declared dependencies |
| Package typecheck | `pnpm --filter @cradle/model-api-simulator typecheck` | exit 0, no TypeScript errors |
| Package tests | `pnpm --filter @cradle/model-api-simulator test` | exit 0; all unit, route, and official-SDK conformance tests pass |
| Artifact determinism | `pnpm --filter @cradle/model-api-simulator protocol:check` | exit 0; checked-in snapshots and generated files byte-match temp regeneration |
| Coverage | `pnpm --filter @cradle/model-api-simulator coverage:check` | exit 0; no uncovered core-profile schema branch or protocol transition |
| Lint | `pnpm exec eslint packages/model-api-simulator --max-warnings=0` | exit 0 |
| Root typecheck gate | `pnpm typecheck:model-api-simulator` | exit 0 |
| Root test discovery | `pnpm exec vitest run --project node packages/model-api-simulator/tests` | exit 0 |
| Diff hygiene | `git diff --check` | no output, exit 0 |

Do not use `protocol:refresh` as a normal CI command because it requires the
network and follows upstream refs. CI must run the offline `protocol:check`.

## Suggested executor toolkit

- Use the `elysiajs` skill if available when implementing the listener and
  route modules. Consult `https://elysiajs.com/llms.txt`, especially Node,
  validation, and testing sections.
- Use `openai-docs` or the official OpenAI OpenAPI repository for Responses
  details. Do not use third-party compatibility guides as contract authority.
- Use the official Anthropic API reference, streaming guide, and
  `@anthropic-ai/sdk` declarations together; none alone expresses the full
  temporal protocol.

## Scope

### In scope

- `packages/model-api-simulator/**` — create.
- `pnpm-lock.yaml` — dependency lock changes only.
- `pnpm-workspace.yaml` — only a parent-scoped peer override that keeps the
  existing `@anthropic-ai/claude-agent-sdk` runtime on its baseline
  `@anthropic-ai/sdk@0.81.0` peer while the simulator uses an aliased pinned
  `0.115.0` schema/conformance SDK. The final lock diff must prove that no
  existing production importer or peer context changed.
- `package.json` — add
  `typecheck:model-api-simulator` and include it in the root `typecheck` chain.
- `.github/workflows/ci.yml` — run simulator typecheck and offline protocol
  artifact/coverage checks.
- `README.md` — add the new private package to the Packages table.
- `advisor-plans/README.md` — status update only after completion.

### Out of scope

- `apps/server/src/modules/chat-runtime-providers/claude-agent/**`
- `apps/server/src/modules/chat-runtime-providers/codex/**`
- Any existing provider test or production provider behavior.
- Cradle database schemas, migrations, routes, CLI commands, desktop code, web
  code, plugins, or UI.
- Network proxying, request recording, fixture redaction, or replay of captured
  upstream traffic.
- A provider-neutral merged protocol model.
- Schema witnesses, scenarios, state-machine families, or SDK conformance
  fixtures for any event/output/tool family excluded by "Core protocol
  profile".
- Any endpoint family excluded in "Product definition and compatibility
  boundary".
- Publishing the package to npm.

## Git workflow

- Work in an isolated worktree or clean branch named
  `advisor/001-model-api-simulator`.
- Preserve all unrelated user changes; the planned source commit has a dirty
  main worktree in unrelated areas.
- Use conventional commits matching current history, for example:
  `feat: add deterministic model API simulator`.
- Commit by logical milestone if the operator requested commits.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Scaffold the owner package and lifecycle contract

Create `packages/model-api-simulator` with a private ESM package named
`@cradle/model-api-simulator`. Follow `packages/download-center` for TypeScript,
test config, and source exports. Add `resolveJsonModule: true` because checked-in
generated JSON is imported by typed registry accessors. Add direct dependencies
`elysia@^1.4.28`, `srvx@^0.11.15`, `ajv@^8.17.1`, and
`ajv-formats@^3.0.1`. Add development dependencies
`@anthropic-ai/sdk@0.115.0`, `openai@^6.34.0`, `vitest@^4.1.4`,
`typescript@^5.9.3`, `tsx@^4.21.0`, `ts-json-schema-generator@^2.9.0`,
`fast-check@^4.9.0`, and `@types/node@^22.19.1`.

Define these exact package scripts:

```json
{
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
  "test": "vitest run --config vitest.config.ts",
  "protocol:refresh:openai": "tsx scripts/refresh-openai-protocol.ts",
  "protocol:refresh:anthropic": "tsx scripts/refresh-anthropic-protocol.ts",
  "protocol:generate": "tsx scripts/generate-protocol-artifacts.ts",
  "protocol:check": "tsx scripts/check-protocol-artifacts.ts",
  "coverage:check": "tsx scripts/check-protocol-coverage.ts"
}
```

`protocol:refresh:openai` is the only networked command above.
`coverage:check` reads the checked-in coverage artifact and fails on uncovered
in-scope IDs.

Implement only the public interfaces and start/close lifecycle first:

- Elysia with `normalize: 'typebox'`, exposing its web-standard `app.fetch`;
- a retained srvx listener on `127.0.0.1` and port `0`;
- `await server.ready()`, derive both base URLs from `server.url`, and close via
  `server.close(true)`;
- separate provider base URLs on one listener;
- isolated controller state per instance;
- idempotent close.

Write lifecycle tests for two simultaneous instances, port isolation, loopback
host, close twice, and open-stream cleanup.

**Verify**:

```sh
pnpm install
pnpm --filter @cradle/model-api-simulator typecheck
pnpm --filter @cradle/model-api-simulator exec vitest run --config vitest.config.ts tests/server.test.ts
```

Expected: all exit 0; no source file outside the package, root scripts,
lockfile, CI, README, or advisor status changes.

### Step 2: Add reproducible protocol snapshot pipelines

Implement `refresh-openai-protocol.ts`:

1. Require an explicit `--ref`.
2. Download official `openapi.json`.
3. Reject non-OpenAPI-3.1 input.
4. Retain only in-scope paths plus the request/response/event branches allowed
   by `protocol/core-scope.json` and their reachable schemas, parameters,
   responses, security schemes, and headers.
5. Normalize key ordering and source-only volatile metadata.
6. Record upstream commit/ref, URL, OpenAPI version, source SHA-256, normalized
   SHA-256, core-scope SHA-256, generated date, owner namespace, and refresh
   command.

Implement `refresh-anthropic-protocol.ts`:

1. Read the installed `@anthropic-ai/sdk` version.
2. Run `ts-json-schema-generator` against `protocol/anthropic/schema-entry.ts`
   with the explicit list of unique local catalogue names; do not use a wildcard
   that pulls unrelated Managed Agent surfaces into the schema.
3. Retain only whole union branches allowed by `protocol/core-scope.json`, then
   assert the output has one root/definition for every selected local name and
   no definition reachable only from an out-of-scope endpoint family.
4. Generate stable and beta core catalogues for the selected exports.
5. Preserve and record the generator's Draft-07 `$schema` declaration; do not
   silently relabel it as 2020-12.
6. Normalize and hash the result.
7. Record SDK version, package integrity from the lockfile when accessible,
   selected declaration entry paths and hashes, core-scope hash, generated
   date, owner, and command.
8. Keep `stream-grammar.json` handwritten and validated against the generated
   event discriminants.

Implement one offline generator that reads checked-in snapshots and writes all
`src/generated` artifacts. Implement `protocol:check` by generating into a
fresh temporary directory and byte-comparing with checked-in artifacts. Do not
rewrite the workspace during the check.

Model these manifests after the Kimi protocol manifest discipline cited above,
not by importing provider-owned code.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator protocol:refresh:openai --ref 5c044be3bf3a42854e99e34616564eeb2124a317
pnpm --filter @cradle/model-api-simulator protocol:refresh:anthropic
pnpm --filter @cradle/model-api-simulator protocol:generate
pnpm --filter @cradle/model-api-simulator protocol:check
```

Expected: the first generation creates snapshots/manifests/artifacts; the final
check exits 0 with no diff.

### Step 3: Build the schema registry, witness corpus, and coverage report

Implement a dialect-aware JSON Schema registry. Use the default AJV class for
the Anthropic Draft-07 catalogue and `Ajv2020` for OpenAI's OpenAPI 3.1 schema
objects. Register formats on both. Preserve OpenAPI's supported `nullable` and
discriminator semantics rather than treating the OpenAPI document as if it were
the generated Anthropic schema. Resolve schemas by stable IDs that include
provider, snapshot version, dialect, and component name. Centralize the
untrusted JSON boundary so route handlers receive validated typed values rather
than repeating `unknown` checks.

Implement deterministic positive witnesses and invalid near-neighbors according
to "Schema corpus rules". Emit:

- a typed schema registry;
- a corpus manifest mapping every witness to covered branch IDs;
- a protocol coverage report with uncovered core branches listed explicitly;
- readable failure output showing the schema path and generation decision.

Add characterization tests for every supported JSON Schema construct,
recursive schemas, independent optional-property witnesses, stable ordering,
and mutation generation. Run fixed-seed property tests over the generator and
validate every positive witness with AJV while asserting every negative witness
fails its targeted rule.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator exec vitest run --config vitest.config.ts tests/corpus-generator.test.ts
pnpm --filter @cradle/model-api-simulator coverage:check
```

Expected: all positive witnesses validate, all targeted negative witnesses
fail, every core-profile schema branch is covered, and repeated generation is
byte-identical.

### Step 4: Implement the deterministic scenario runtime

Implement the ordered exchange queue, semantic request matcher, request ledger,
named gates, one-turn `yield`, abort/disconnect handling, exhaustion assertion,
and typed diagnostics.

The scheduler must never implicitly release a gate or use time-based settling.
If an event is available immediately after another event, it may be emitted in
the same pump; tests that require an observable boundary must add `yield` or a
gate explicitly.

Test:

- deeply readonly `as const` scenario fixtures, including nested arrays and
  objects, compile and are accepted without mutation;
- exact and semantic request matching;
- unexpected requests;
- two concurrent simulator instances;
- duplicate/unknown gates;
- consumer cancellation while gated;
- disconnect before first event and mid-stream;
- reset with an open stream;
- unconsumed exchanges;
- deterministic request ledger order under concurrent clients.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator exec vitest run --config vitest.config.ts \
  tests/scenario-runtime.test.ts tests/stream-scheduler.test.ts
```

Expected: all named tests pass without fake timers or nondeterministic sleeps.

### Step 5: Implement the Anthropic Messages data plane

Create explicit Elysia routes for the in-scope Anthropic operations. Validate:

- `x-api-key` or Bearer authentication;
- required `anthropic-version`;
- optional `anthropic-beta`;
- the official SDK's beta namespace form (`/v1/messages?beta=true` and
  `/v1/messages/count_tokens?beta=true`) as the same paths plus an explicit
  query condition, never as literal Elysia route strings;
- request bodies against stable or beta generated core schemas, returning an
  Anthropic `invalid_request_error` when a non-allowlisted branch fails
  validation;
- model pagination query parameters;
- provider-native error envelopes and request IDs.

Implement non-streaming responses and the Anthropic SSE encoder. Every SSE event
must include both the named `event:` field and matching JSON `type`. Validate
each event payload before enqueue and run the state machine before bytes are
written. Preserve logical SSE event ordering and never emit past a gate; do not
claim that one event maps to one TCP chunk.

Write route/state-machine tests for every retained core event variant and every
declared transition: text, ordinary tool use with incrementally assembled JSON,
thinking/signature deltas, redacted thinking, ping, error, invalid index,
decreasing usage, duplicate stop, and abrupt disconnect. Add one representative
non-allowlisted content/event rejection test; do not generate positive fixtures
for excluded families.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator exec vitest run --config vitest.config.ts \
  tests/anthropic-routes.test.ts tests/anthropic-state-machine.test.ts
pnpm --filter @cradle/model-api-simulator coverage:check
```

Expected: route and grammar tests pass; Anthropic schema and transition coverage
are 100% for the core profile.

### Step 6: Implement the OpenAI Responses data plane

Create explicit Elysia routes for every in-scope Responses and Models operation
in the snapshot. Validate Bearer auth, request bodies, query/path parameters,
and response bodies against generated core schemas; a non-allowlisted
tool/output discriminator therefore returns an OpenAI `invalid_request_error`.
Treat upstream OpenAPI keys such as
`/responses?beta=true` as the same HTTP path plus an explicit `beta=true` query
condition; never register a literal question mark in an Elysia route.

Implement an in-memory resource store owned by each simulator instance:

- response create assigns or accepts deterministic scenario IDs;
- retrieve returns current state;
- cancel transitions only cancellable states;
- delete removes the resource;
- input-items returns deterministic cursor pages;
- input-token and compact operations use scenario-provided valid results;
- every error uses the OpenAI envelope and `x-request-id`.

Implement the OpenAI SSE encoder and grammar. Automatically compare the
core event allowlist against registered grammar families. Generation fails for
a missing core family. A non-allowlisted upstream event does not need a family.

Test every retained core event variant and transition family, all terminal
states, all resource operations, cursor behavior, invalid correlations, events
after a terminal frame, top-level error, and disconnect. Add one representative
non-allowlisted tool/event rejection test; do not create positive fixtures for
excluded families.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator exec vitest run --config vitest.config.ts \
  tests/openai-routes.test.ts tests/openai-state-machine.test.ts
pnpm --filter @cradle/model-api-simulator coverage:check
```

Expected: route, resource, and grammar tests pass; OpenAI schema and transition
coverage are 100% for the core profile.

### Step 7: Prove compatibility with official SDKs

Write black-box tests that start the real loopback listener and use unmocked
official SDK clients.

Construct both clients with fake keys, `maxRetries: 0`, and a test-local
`fetch` wrapper that records every URL and throws before dispatch if the
hostname is not `127.0.0.1`. This wrapper is a network escape assertion, not an
SDK mock. Use bounded per-test timeouts only as a final hang guard; stream
progress itself must be controlled by scenario gates.

Anthropic conformance must cover:

- non-streaming `messages.create`;
- raw streaming iteration through `messages.create({ stream: true })`;
- final-message accumulation through the SDK's `messages.stream(...)` helper
  and `finalMessage()`;
- `messages.countTokens`;
- model list/retrieve;
- one tool-use stream with split JSON deltas;
- one stream error and one abrupt disconnect;
- beta request fields and beta core response variants selected by headers.

OpenAI conformance must cover:

- non-streaming `responses.create`;
- raw event iteration through `responses.create({ stream: true })`;
- final response accumulation through `responses.stream(...)` and
  `finalResponse()`;
- response retrieve, cancel, delete, and input items;
- input-token and compact operations if the installed official SDK exposes
  them; otherwise test those routes through `fetch` and record the SDK gap in
  the manifest;
- one function-call stream with split arguments;
- one failed response and one abrupt disconnect;
- model list/retrieve.

No `vi.mock` may replace either official SDK in these files. Use fake keys only.
After each test, assert that the fetch ledger contains only loopback URLs, call
`controller.assertExhausted()`, and call `simulator.close()` in `finally`.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator exec vitest run --config vitest.config.ts \
  tests/anthropic-sdk-conformance.test.ts tests/openai-sdk-conformance.test.ts
```

Expected: both official SDK suites pass against loopback without any upstream
network request.

### Step 8: Add CI gates and operator documentation

Document:

- what "complete" means for the core profile and the explicitly excluded API
  and event/tool families;
- quick-start examples for OpenAI and Anthropic official SDKs;
- scenario construction, gates, request inspection, exhaustion, and cleanup;
- schema refresh versus offline generation;
- compatibility manifests and how to review upstream drift;
- coverage semantics;
- known limitation: no model intelligence and no unmatched-request fallback.

Add the package to the root README Packages table. Add the root
`typecheck:model-api-simulator` script and include it in the root `typecheck`
chain. Add CI steps for package typecheck, `protocol:check`, and
`coverage:check`; keep refresh network-free in CI.

Run the complete package suite and repository gates proportionate to the
changes.

**Verify**:

```sh
pnpm --filter @cradle/model-api-simulator typecheck
pnpm --filter @cradle/model-api-simulator test
pnpm --filter @cradle/model-api-simulator protocol:check
pnpm --filter @cradle/model-api-simulator coverage:check
pnpm typecheck:model-api-simulator
pnpm exec eslint packages/model-api-simulator --max-warnings=0
git diff --check
```

Expected: every command exits 0.

## Test plan

The new package owns four verification layers:

1. **Pure unit tests**
   - JSON Schema traversal and branch accounting.
   - Positive witnesses and invalid mutations.
   - Provider state machines.
   - SSE byte encoding.
   - request ledger and scenario scheduler.

2. **In-memory route tests**
   - Call the Elysia app through `app.handle(new Request(...))`.
   - Verify headers, JSON, SSE bytes, auth failures, schema failures, resources,
     pagination, and abort cleanup without binding a port.

3. **Loopback official-SDK conformance**
   - Start the retained srvx listener on `127.0.0.1:0` and await `ready()`.
   - Use unmocked `openai` and `@anthropic-ai/sdk`.
   - Assert complete scenario consumption, loopback-only fetches, and no open
     handles.

4. **Artifact and coverage checks**
   - Regenerate into a temporary directory.
   - Byte-compare snapshots and generated artifacts.
   - Fail on an uncovered core schema branch, uncovered core transition, or
     unsupported reachable core schema construct.

Do not add browser tests. Do not add Cradle provider tests in this plan.

## Done criteria

All must hold:

- [ ] `packages/model-api-simulator` is the sole owner of simulator contracts,
  protocol snapshots, scenario state, and server lifecycle.
- [ ] OpenAI manifests pin the official OpenAPI commit and
  source/generated/core-scope hashes.
- [ ] Anthropic manifests pin the official SDK version, selected declaration
  entry hashes, generated schema hash, core-scope hash, and handwritten grammar
  hash.
- [ ] `protocol/core-scope.json` is the only event/tool-family allowlist and is
  hashed by both manifests.
- [ ] Every in-scope endpoint exists and validates provider-native auth,
  request, response, and error shapes.
- [ ] Non-streaming and SSE behavior pass official SDK conformance tests.
- [ ] Every core-profile schema branch has a deterministic witness.
- [ ] Every core-profile stream transition is tested.
- [ ] MCP, web/file search, annotation/citation, image, audio, computer, shell,
  code-interpreter/execution, custom-tool, and provider-hosted server-tool event
  families have no positive fixtures or grammar families.
- [ ] Any event discriminator absent from the core allowlist is rejected before
  streaming.
- [ ] `protocol:check` is offline and does not mutate the working tree.
- [ ] No runtime path calls an upstream Anthropic or OpenAI host.
- [ ] No real API key is required.
- [ ] No provider, DB, UI, CLI, desktop, or plugin source file changed.
- [ ] All commands in Step 8 exit 0.
- [ ] `git status --short` shows changes only under the in-scope paths.
- [ ] `advisor-plans/README.md` marks Plan 001 `DONE`.

## STOP conditions

Stop and report; do not improvise if:

- The operator intends "Anthropic/OpenAI API Simulator" to cover an endpoint or
  event/tool family explicitly excluded in this plan. Replan that family as a
  separate extension; do not silently expand the core profile.
- OpenAI's selected upstream ref no longer contains an OpenAPI 3.1 document or
  its licensing/source terms no longer permit a checked-in normalized snapshot.
- `ts-json-schema-generator` cannot resolve the selected public Anthropic SDK
  types without copying or hand-recreating their field definitions. Report the
  unsupported type constructs and propose a generator alternative; do not
  create an unreviewed handwritten mirror.
- An in-scope reachable JSON Schema construct cannot be traversed or validated.
  Name the construct and affected branch IDs; do not mark them covered through
  a heuristic.
- Elysia's web-standard handler plus the direct srvx listener cannot bind an
  isolated port `0`, expose the resolved URL after `ready()`, preserve gated
  incremental SSE delivery, or close open streams deterministically.
- Either official SDK rejects an otherwise valid loopback response that the
  checked-in official source says is valid. Preserve the minimal failing
  scenario and report the source disagreement.
- Supporting an operation requires provider production changes, a database
  migration, or a test-only hook in Claude Agent/Codex.
- After completing one coherent plan-scoped correction (including all
  mechanically required call-site updates), the same verification step still
  fails because of an unresolved external protocol, SDK, framework, or schema
  contradiction. Do not count follow-on compiler errors from an intentionally
  incomplete multi-file refactor as separate failed correction attempts.
- An in-scope existing file has drifted semantically from the excerpts above.
- The work would overwrite or reformat unrelated user changes.

## Maintenance notes

- Review every protocol refresh as an upstream contract change, not generated
  noise. The manifest diff, core allowlist diff, uncovered branch report, and
  grammar-family diff are the primary review surfaces.
- A newly published event is not automatically part of the simulator. Leave it
  outside the allowlist unless a concrete Cradle core flow needs it; expanding
  the allowlist requires its own reviewed plan and conformance fixture.
- OpenAI OpenAPI and Anthropic SDK versions evolve independently; never advance
  both in one unexplained generated-data commit.
- Keep the protocol-specific state machines independent. Shared code may
  schedule bytes and account for schema branches, but it must not assign
  provider semantics.
- A later provider-integration plan should add a small set of real Claude Agent
  SDK and Codex app-server tests against this package. It should not delete fast
  mapper/state-machine unit tests merely because the simulator exists.
- If a future standalone control service is needed, expose it on a separate
  loopback listener. Never add simulator-only routes to the compatible data
  plane.
