import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { AgentToolHttpRequestError, requestAgentToolJson } from '../../http-client'
import type { AgentToolRegistration } from '../../registry'

export const RECALL_QUERY_TOOL_NAME = 'recall_query'

const RecallQueryResponseSchema = z.object({
  kind: z.string(),
  result: z.unknown().optional(),
  error: z.string().optional(),
})

function currentChatSessionId(): string | null {
  return process.env.CRADLE_CHAT_SESSION_ID?.trim() || null
}

async function executeRecallQueryTool(input: { code: string }) {
  const chatSessionId = currentChatSessionId()
  if (!chatSessionId) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'recall_query is unavailable because this runtime did not bind a Cradle chat session. No query was executed.',
        },
      ],
      isError: true,
    }
  }

  try {
    const outcome = await requestAgentToolJson({
      path: '/recall/query',
      body: { chatSessionId, code: input.code },
      responseSchema: RecallQueryResponseSchema,
    })
    if (outcome.kind !== 'completed') {
      return {
        content: [{ type: 'text' as const, text: outcome.error ?? `recall_query ${outcome.kind}` }],
        isError: true,
      }
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(outcome.result) }],
    }
  }
 catch (error) {
    const message
      = error instanceof AgentToolHttpRequestError
        ? `recall_query failed (${error.code ?? 'request_failed'}): ${error.message}`
        : `recall_query failed: ${error instanceof Error ? error.message : String(error)}`
    return { content: [{ type: 'text' as const, text: message }], isError: true }
  }
}

function registerRecallQueryTool(server: McpServer): void {
  server.registerTool(
    RECALL_QUERY_TOOL_NAME,
    {
      title: 'Recall Query',
      description:
        'Search prior Cradle execution evidence and memories, returning citable JSON from the current workspace. Use when the user asks what happened before, how a decision or bug was handled, what a prior chat concluded, or to find related failures, runs, messages, or file history. Typical requests include "how did we handle this before", "did we discuss this earlier", "why did this fail", "find the earlier decision", and "what changed in this file". Read-only: helper filters may narrow the runtime-bound workspace scope but cannot broaden it.',
      inputSchema: {
        code: z
          .string()
          .min(1)
          .describe('JavaScript CodeAct query. Return JSON-compatible evidence with stable IDs.'),
      },
    },
    executeRecallQueryTool,
  )
}

export const recallQueryTool: AgentToolRegistration = {
  name: RECALL_QUERY_TOOL_NAME,
  register: registerRecallQueryTool,
}
