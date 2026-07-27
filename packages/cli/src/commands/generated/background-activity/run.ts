import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [
    {
      "name": "ownerNamespace",
      "required": true,
      "target": "path.ownerNamespace",
      "type": "string"
    },
    {
      "name": "key",
      "required": true,
      "target": "path.key",
      "type": "string"
    }
  ],
  "command": [
    "background-activity",
    "run"
  ],
  "description": "Run a background activity now",
  "flags": [],
  "method": "post",
  "path": "/background-activities/{ownerNamespace}/{key}/run"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
