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
    }
  ],
  "command": [
    "pull-request",
    "assignable-users"
  ],
  "description": "List users who can be assigned to pull requests in this repository",
  "flags": [],
  "method": "get",
  "path": "/pull-requests/{owner}/{repo}/assignable-users"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
