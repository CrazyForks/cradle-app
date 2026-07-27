import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "usage",
    "cost-efficiency"
  ],
  "description": "Get cost efficiency trend (avg tokens per run over time)",
  "flags": [
    {
      "name": "days",
      "required": false,
      "target": "query.days",
      "type": "string"
    }
  ],
  "method": "get",
  "path": "/usage/cost-efficiency"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
