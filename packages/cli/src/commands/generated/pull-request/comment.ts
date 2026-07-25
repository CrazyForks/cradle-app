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
    "comment"
  ],
  "description": "Post an issue comment on a pull request",
  "flags": [
    {
      "name": "body",
      "required": true,
      "target": "body.body",
      "type": "string"
    }
  ],
  "method": "post",
  "path": "/pull-requests/{owner}/{repo}/{number}/comment"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
