import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "tools"
  ],
  "description": "Get tool usage breakdown by runtime and model",
  "flags": [
    {
      "name": "from",
      "required": false,
      "target": "query.from",
      "type": "string"
    },
    {
      "name": "to",
      "required": false,
      "target": "query.to",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/usage/tools"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
