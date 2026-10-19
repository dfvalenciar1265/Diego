import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/server'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { registerTools, toToolResult } from '@/lib/mcp/tools'

describe('toToolResult', () => {
  it('returns the same JSON as the REST API as structured content', () => {
    expect(toToolResult({ ok: true, status: 200, data: { count: 1 } })).toEqual({
      content: [{ type: 'text', text: '{"count":1}' }],
      structuredContent: { count: 1 },
    })
  })

  it('marks errors so the model explains them', () => {
    expect(toToolResult({ ok: false, status: 400, error: 'Falta "title".' })).toEqual({
      content: [{ type: 'text', text: 'Falta "title".' }],
      isError: true,
    })
  })

  it('shows the current state with a conflict so the model does not retry blindly', () => {
    expect(toToolResult({ ok: false, status: 409, error: 'El cobro cambió.', current: { version: 2 } })).toEqual({
      content: [{ type: 'text', text: 'El cobro cambió.\nEstado actual: {"version":2}' }],
      isError: true,
    })
  })
})

describe('registerTools', () => {
  const calls: { name: string; config: { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } } }[] = []
  registerTools({ registerTool: (name: string, config: never) => { calls.push({ name, config }) } } as unknown as McpServer)

  it('exposes the six GPT actions, the turnover times, reservations and their charges / requests', () => {
    expect(calls.map(c => c.name)).toEqual([
      'list_properties', 'list_maintenance', 'create_maintenance',
      'update_maintenance', 'list_reservations', 'compare_reservations',
      'list_turnovers', 'set_checkout_time', 'set_checkin_time',
      'create_reservation', 'update_reservation', 'cancel_reservation',
      'list_followups', 'create_charge', 'update_charge', 'create_special_request', 'update_special_request',
    ])
  })

  it('marks only the reading tools as read-only', () => {
    const readOnly = calls.filter(c => c.config.annotations?.readOnlyHint).map(c => c.name)
    expect(readOnly).toEqual(['list_properties', 'list_maintenance', 'list_reservations', 'list_turnovers', 'list_followups'])
  })

  it('marks only cancelling a reservation as destructive', () => {
    expect(calls.filter(c => c.config.annotations?.destructiveHint).map(c => c.name)).toEqual(['cancel_reservation'])
  })
})
