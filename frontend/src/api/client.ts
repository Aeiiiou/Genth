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

export interface GitHubStatus {
  ready: boolean
  problem: string | null
  author: string
  repositories: string[]
  today?: string
  tokenConfigured: boolean
}

export interface StoredCommit {
  id: number
  repo: string
  sha: string
  message: string
  committedAt: string
  url: string
  isMerge: boolean
  branches: string[]
}

export interface AIStatus {
  ready: boolean
  problem: string | null
  provider?: string
  model?: string
  keyConfigured: boolean
}

export type SummaryStatus = 'pending_review' | 'approved' | 'rejected' | 'superseded'

export interface SummaryItem {
  id: number
  text: string
  commitIds: number[]
  edited: boolean
}

export interface SummaryBatch {
  id: number
  date: string
  status: SummaryStatus
  model: string
  createdAt: string
  reviewedAt: string | null
  reviewNote: string | null
  items: SummaryItem[]
  sourceCommitIds: number[]
  commits: StoredCommit[]
}

export interface ItemEdit {
  id?: number
  text: string
  commitIds: number[]
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
  startGitHubRun: () => request<ServerRun>('/runs/github', { method: 'POST', body: '{}' }),
  githubStatus: () => request<GitHubStatus>('/github/status'),
  aiStatus: () => request<AIStatus>('/ai/status'),
  startDailyRun: () => request<ServerRun>('/runs/daily', { method: 'POST', body: '{}' }),
  summaries: (status?: SummaryStatus) => request<SummaryBatch[]>(status ? '/summaries?status=' + status : '/summaries'),
  summary: (id: number) => request<SummaryBatch>('/summaries/' + id),
  editSummary: (id: number, items: ItemEdit[]) =>
    request<SummaryBatch>('/summaries/' + id + '/items', { method: 'PUT', body: JSON.stringify({ items }) }),
  approveSummary: (id: number, note?: string) =>
    request<SummaryBatch>('/summaries/' + id + '/approve', { method: 'POST', body: JSON.stringify({ note }) }),
  rejectSummary: (id: number, note?: string) =>
    request<SummaryBatch>('/summaries/' + id + '/reject', { method: 'POST', body: JSON.stringify({ note }) }),
  commits: (date?: string) =>
    request<{ date: string; commits: StoredCommit[] }>(date ? `/commits?date=${encodeURIComponent(date)}` : '/commits'),
}
