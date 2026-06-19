/**
 * Changelog data — curated release manifest for the landing page.
 *
 * Each release body is a markdown string rendered via `marked`.
 * The leading `>` blockquote is styled as the tagline.
 */

export interface Release {
  version: string
  date: string // ISO yyyy-mm-dd
  /** Markdown body. A leading `>` blockquote is styled as the tagline. */
  body: string
  featured?: boolean
}

export const RELEASES: Release[] = [
  {
    version: '0.0.0-dev-20260619.1',
    date: '2026-06-19',
    featured: true,
    body: `> Codex auth modes, a background terminal panel, account diagnostics, and a round of stability fixes.

## Features

1. Surface Bar now shows live running state; the torn-off header displays the current session title.
2. Codex Provider settings gained explicit auth modes: API Key, ChatGPT Login, Personal Access Token, AWS Bedrock API Key.
3. Settings adds a Codex account diagnostics panel — manually refresh rate limit, token usage, reset credit, and other account state.
4. The composer area adds a Codex background terminal list — inspect command, cwd, pid, CPU, memory, and terminate any background process individually.
5. Hack Codex Goal — use with caution.

## Performance

1. Server memory footprint reduced.
2. Chat Runtime recovery now follows a clearer recovery path, fixing CPU spikes caused by polling on large sessions.
3. Renderer context lifecycle refactored to cut dev-time exceptions from Jarvis context provider double-registration.

## Bug Fixes

1. Fixed Chat stream connection cleanup.
2. Fixed side conversation streams being incorrectly pulled into session retention.
3. Fixed provider thread deletion and Codex thread projection issues.
4. Fixed tool-call identification so Bash and similar tools are no longer misrendered as subagents.
5. Fixed Surface / app shell rendering instability.
6. Notification Center: quick reply now auto-refreshes the corresponding chat session and manages the notification lifecycle correctly.
7. Markdown / plan refine editor: fixed save races where blur-save and duplicate-save overwrote content with stale state.
8. Hosted web support is more complete: added CORS origin and private network preflight handling.
9. Fixed Model List selection behavior not matching expectations.`,
  },
  {
    version: '0.0.0-dev-20260618.1',
    date: '2026-06-18',
    body: `> Internal dev testing is now open.

_**After roughly two months of development, the first public dev build of Cradle Desktop is available for testing.**_

Cradle is an AI-native desktop client focused on providing a stable, practical environment for agent-driven workflows. Rather than introducing an entirely new workflow, the goal is to integrate naturally into the workflows people already use every day.

This release marks the beginning of broader testing. The application has not yet gone through large-scale validation, so bugs, edge cases, and rough edges should be expected. Feedback is highly encouraged.

## What We Are Testing

If there are aspects of Codex that feel particularly effective, or areas where Claude Code provides a better experience, we would love to hear about them. Cradle is still early in its development and many product decisions remain open.

## cc-switch Integration

The cc-switch plugin is enabled by default and bundled with the application.

Users who already use cc-switch should see their configured providers immediately after launching Cradle. However, model lists are not automatically refreshed on startup.

To load models for a provider, open Settings and manually select the provider once. This triggers a backend refresh and retrieves the latest model list.

While not ideal, this behavior is currently intentional to avoid generating a large number of /model requests automatically during application startup.

## Current Status

Cradle is still an early-stage project.

There are no particularly flashy features yet, and the focus remains on reliability, usability, and creating a solid foundation for future development.

Current support is centered around Codex-based workflows. Claude Code support is available, but some workflows may still exhibit compatibility issues.

HiJarvis, my personal agent runtime, will continue evolving alongside Cradle and is expected to become the default runtime experience in the future.

## Known Limitations

1. Application size is currently larger than desired
1. Packaging and distribution are still being optimized
1. Apple Developer ID signing is not yet available
1. Automatic update mechanisms are still under investigation

Thank you to everyone willing to spend time testing an unfinished product. Every bug report, workflow discussion, and piece of feedback helps shape where Cradle goes next.
`,
  },
]
