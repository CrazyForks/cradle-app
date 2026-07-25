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
    "reviewers"
  ],
  "description": "Request or remove pull request reviewers",
  "flags": [
    {
      "name": "add",
      "required": false,
      "target": "body.add",
      "type": "string[]"
    },
    {
      "name": "remove",
      "required": false,
      "target": "body.remove",
      "type": "string[]"
    }
  ],
  "method": "post",
  "path": "/pull-requests/{owner}/{repo}/{number}/reviewers"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
