import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'
import type { Command } from 'commander'

const spec = {
  "arguments": [],
  "command": [
    "issue",
    "reorder"
  ],
  "description": "Reorder issues and apply a group change",
  "flags": [
    {
      "description": "Defaults to the workspace for your current directory, then CRADLE_WORKSPACE_ID.",
      "name": "workspaceId",
      "required": true,
      "target": "body.workspaceId",
      "type": "string",
      "flagName": "workspace",
      "resolver": "workspace",
      "resolverAmbient": true
    },
    {
      "name": "orderedIds",
      "required": true,
      "target": "body.orderedIds",
      "type": "string[]"
    },
    {
      "name": "patch",
      "required": false,
      "target": "body.patch",
      "type": "json"
    }
  ],
  "method": "post",
  "path": "/issues/reorder"
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
