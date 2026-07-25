import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'
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
    "fingerprint",
    "probe"
  ],
  "description": "Probe GitHub for pull request fingerprint changes while the detail surface is visible",
  "flags": [
    {
      "name": "previous",
      "required": false,
      "target": "body.previous",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/pull-requests/{owner}/{repo}/{number}/fingerprint/probe"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
