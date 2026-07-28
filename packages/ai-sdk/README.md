# @cradleapp/ai-sdk

Cradle-owned, TypeScript-source-only extensions around the Vercel AI SDK. This package is private and exports directly from `src/index.ts`; it has no build or publish step.

`UIMessageStreamState` applies AI SDK `UIMessageChunk` state transitions while retaining the active text, reasoning, and partial tool-input identities needed to resume later deltas. A live owner can serialize that state into the transient `data-cradle-stream-snapshot` chunk and a consumer can restore it before processing subsequent chunks.

The snapshot chunk is a recovery control frame and is never persisted as a `UIMessage` part. Active in-memory state is the recovery authority for reconnects and late subscribers: the Server sends one current snapshot and then live chunks, without retaining an exact replay suffix. Server `run_stream_checkpoints` remain the separate crash-recovery authority after the process that owned the live state is gone.
