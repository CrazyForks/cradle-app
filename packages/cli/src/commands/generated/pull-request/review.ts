import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "owner",
      "required": true,
      "target": "path.owner",
      "type": "string"
    },
    {
      "name": "repo",
      "required": true,
      "target": "path.repo",
      "type": "string"
    },
    {
      "name": "number",
      "required": true,
      "target": "path.number",
      "type": "string"
    }
  ],
  "command": [
    "pull-request",
    "review"
  ],
  "description": "Submit a whole-PR GitHub review (approve, request changes, or comment)",
  "flags": [
    {
      "name": "event",
      "required": true,
      "target": "body.event",
      "type": "string",
      "values": [
        "APPROVE",
        "REQUEST_CHANGES",
        "COMMENT"
      ]
    },
    {
      "name": "body",
      "required": false,
      "target": "body.body",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/pull-requests/{owner}/{repo}/{number}/review"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
