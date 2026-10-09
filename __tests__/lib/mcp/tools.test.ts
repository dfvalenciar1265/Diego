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
})

describe('registerTools', () => {
  const calls: { name: string; config: { annotations?: { readOnlyHint?: boolean } } }[] = []
  registerTools({ registerTool: (name: string, config: never) => { calls.push({ name, config }) } } as unknown as McpServer)

  it('exposes the six GPT actions', () => {
    expect(calls.map(c => c.name)).toEqual([
      'list_properties', 'list_maintenance', 'create_maintenance',
      'update_maintenance', 'list_reservations', 'compare_reservations',
    ])
  })

  it('marks only the reading tools as read-only', () => {
    const readOnly = calls.filter(c => c.config.annotations?.readOnlyHint).map(c => c.name)
    expect(readOnly).toEqual(['list_properties', 'list_maintenance', 'list_reservations'])
  })
})
