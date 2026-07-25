import { describe, expect, it } from 'vitest'

import { projectCodexUserInput } from './input-projector'

describe('codex input projector', () => {
  it('projects a selected skill as an explicit SDK skill invocation', () => {
    expect(projectCodexUserInput({
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Run' },
        {
          type: 'data-cradle-skill',
          data: {
            type: 'data-cradle-skill',
            name: 'cradle-chat-runtime-sdk-update',
            path: '/tmp/cradle-chat-runtime-sdk-update',
            scope: 'workspace',
            description: null,
          },
        },
        { type: 'text', text: 'for this change.' },
      ],
    }, 'Codex provider')).toEqual([
      { type: 'text', text: 'Run $cradle-chat-runtime-sdk-update', text_elements: [] },
      {
        type: 'skill',
        name: 'cradle-chat-runtime-sdk-update',
        path: '/tmp/cradle-chat-runtime-sdk-update',
      },
      { type: 'text', text: 'for this change.', text_elements: [] },
    ])
  })

  it('does not duplicate a skill reference already written in the prompt', () => {
    expect(projectCodexUserInput({
      id: 'user-1',
      role: 'user',
      parts: [
        { type: 'text', text: 'Run $cradle-chat-runtime-sdk-update.' },
        {
          type: 'data-cradle-skill',
          data: {
            type: 'data-cradle-skill',
            name: 'cradle-chat-runtime-sdk-update',
            path: '/tmp/cradle-chat-runtime-sdk-update',
            scope: 'workspace',
            description: null,
          },
        },
      ],
    }, 'Codex provider')).toEqual([
      { type: 'text', text: 'Run $cradle-chat-runtime-sdk-update.', text_elements: [] },
      {
        type: 'skill',
        name: 'cradle-chat-runtime-sdk-update',
        path: '/tmp/cradle-chat-runtime-sdk-update',
      },
    ])
  })
})
