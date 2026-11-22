/**
 * Backend REST client. Requests go to /api on the same origin; in development the Vite proxy
 * forwards them to FastAPI and adds the session token, so the browser never holds it.
 */

export interface ServerEvent {
  id: number
  runId: number | null
  agentId: string | null
  type: string
  payload: Record<string, unknown> & { message?: string }
  createdAt: string
}

export interface ServerRun {
  id: number
  kind: string
  status: 'running' | 'completed' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, typeof body.detail === 'string' ? body.detail : res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  recentEvents: (limit = 20) => request<ServerEvent[]>(`/events?limit=${limit}`),
  startDemoRun: () => request<ServerRun>('/runs/mock', { method: 'POST', body: '{}' }),
}
