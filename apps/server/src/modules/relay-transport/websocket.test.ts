import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { closeRelayWebSocket } from './websocket'

describe('relay websocket teardown', () => {
  it('terminates a connecting socket without throwing from close()', async () => {
    const ws = new WebSocket('ws://127.0.0.1:1')

    expect(ws.readyState).toBe(WebSocket.CONNECTING)
    expect(() => closeRelayWebSocket(ws)).not.toThrow()
    await new Promise<void>((resolve) => { ws.once('close', () => resolve()) })
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })
})
