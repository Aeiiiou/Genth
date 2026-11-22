/**
 * Office life between runs: idle bots get coffee, play games, chat in the lounge and drop by each
 * other's desks, then go back to work. Purely cosmetic and local to the browser; the moment a real
 * run starts everyone heads back to their desk and the backend takes over the choreography.
 */
import { useAgentMotion } from '../../state/agentMotion'
import { useOfficeStore } from '../../state/officeStore'
import { agentById, layout } from '../layout'

const TICK_MS = 1000
/** Seconds an agent stays at its desk between activities. */
const DESK_TIME: [number, number] = [25, 70]
/** Wait after a run ends before idle life resumes. */
const RESUME_AFTER_RUN_S = 12

const CHATS: [string, string][] = [
  ['Did you see that last commit?', 'Clean code, honestly.'],
  ['Coffee after this?', 'Always.'],
  ['Who broke the build?', 'Not me 👀'],
  ['Weekend plans?', 'Gaming, obviously.'],
  ['The 12:00 meeting again…', 'Boss loves his meetings.'],
  ['How many commits today?', 'MEDG will tell us at noon.'],
  ['Nice shirt.', 'Thanks, it’s my debugging shirt.'],
  ['Ping pong rematch?', 'You’re on.'],
]
const COFFEE_LINES = ['☕ Coffee time', 'One espresso, please', 'Need caffeine…', '☕ Just a quick break']
const GAME_LINES = ['🎮 One more round!', 'New high score!', 'Ping pong anyone?', '🕹️ Practising for later']
const VISIT_LINES = ['Got a minute?', 'Quick question…', 'How’s it going?', 'Nice desk setup!']
const VISIT_REPLIES = ['Sure, what’s up?', 'Busy, but go on.', 'All good here!', 'Thanks!']

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]
const between = ([a, b]: [number, number]) => a + Math.random() * (b - a)
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000))

class Cancelled extends Error {}

/** Starts idle life. Returns a function that stops it. */
export function startIdleLife(): () => void {
  const busy = new Set<string>()
  const nextAt = new Map<string, number>(layout.agents.map((a) => [a.id, Date.now() + between([4, 20]) * 1000]))
  let generation = 0 // bumped when a run starts: running activities notice and stop
  let resumeAt = 0
  let wasRunning = false
  /** Agents idle life has sent somewhere; only these are recalled when a run starts. */
  const away = new Set<string>()

  const motion = () => useAgentMotion.getState()
  const office = () => useOfficeStore.getState()
  const name = (id: string) => agentById.get(id)?.name ?? id

  const runActive = () => office().run?.status === 'running'

  /** Moves an agent and waits until it has (roughly) arrived. Throws if a run started meanwhile. */
  async function go(id: string, spot: Parameters<ReturnType<typeof motion>['moveTo']>[1], gen: number) {
    away.add(id)
    const seconds = motion().moveTo(id, spot)
    await sleep(seconds + 0.5)
    if (gen !== generation) throw new Cancelled()
  }
  async function wait(seconds: number, gen: number) {
    await sleep(seconds)
    if (gen !== generation) throw new Cancelled()
  }
  const say = (id: string, text: string) => office().speak(id, text, 4500)

  const activities: Record<string, (id: string, gen: number) => Promise<void>> = {
    async coffee(id, gen) {
      await go(id, 'cafe', gen) // a free stool, or the counter when the tables are full
      say(id, pick(COFFEE_LINES))
      await wait(between([15, 30]), gen)
    },
    async gaming(id, gen) {
      await go(id, 'gaming', gen)
      say(id, pick(GAME_LINES))
      await wait(between([20, 40]), gen)
      if (Math.random() < 0.5) say(id, pick(['GG!', 'So close…', 'Rematch later.']))
      await wait(2, gen)
    },
    async chat(id, gen) {
      const partner = layout.agents.map((a) => a.id).find((other) => other !== id && !busy.has(other) && (nextAt.get(other) ?? 0) - Date.now() < 30000)
      if (!partner) return activities.coffee(id, gen)
      busy.add(partner)
      try {
        away.add(partner)
        motion().moveTo(partner, 'lounge')
        await go(id, 'lounge', gen)
        await wait(2, gen)
        const [line, reply] = pick(CHATS)
        say(id, line)
        await wait(3, gen)
        say(partner, reply)
        await wait(between([8, 15]), gen)
        say(id, pick(['Back to work!', 'Talk later.', 'Okay, I’m off.']))
        await wait(2, gen)
      } finally {
        busy.delete(partner)
        nextAt.set(partner, Date.now() + between(DESK_TIME) * 1000)
        if (gen === generation) {
          motion().moveTo(partner, 'desk')
          away.delete(partner)
        }
      }
    },
    async visit(id, gen) {
      const others = layout.agents.map((a) => a.id).filter((o) => o !== id && !busy.has(o))
      if (!others.length) return
      const host = pick(others)
      await go(id, `visit:${host}`, gen)
      say(id, `Hey ${name(host)}! ${pick(VISIT_LINES)}`)
      await wait(3, gen)
      say(host, pick(VISIT_REPLIES))
      await wait(between([6, 12]), gen)
    },
    async desk(id, gen) {
      say(id, pick(['Reading docs…', 'Tidying my desk', 'Inbox zero!', 'Stretching 🙆']))
      await wait(between([5, 10]), gen)
    },
  }
  const weights: [keyof typeof activities, number][] = [
    ['coffee', 3],
    ['gaming', 2],
    ['chat', 3],
    ['visit', 2],
    ['desk', 1],
  ]
  const chooseActivity = () => {
    let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0)
    for (const [k, w] of weights) if ((r -= w) <= 0) return k
    return 'desk'
  }

  async function live(id: string) {
    const gen = generation
    busy.add(id)
    try {
      await activities[chooseActivity()](id, gen)
      if (gen === generation) {
        motion().moveTo(id, 'desk')
        away.delete(id)
      }
    } catch (err) {
      if (!(err instanceof Cancelled)) console.warn('[idle life]', err)
    } finally {
      busy.delete(id)
      nextAt.set(id, Date.now() + between(DESK_TIME) * 1000)
    }
  }

  // A run started: stop every activity at once and send idle wanderers back to their desks. This must
  // happen synchronously on the run.started event, before the backend's own moves arrive, and must
  // only touch agents idle life sent away, or it would undo the backend's choreography.
  const unsubscribe = useOfficeStore.subscribe((state, prev) => {
    if (state.run?.status !== 'running' || prev.run?.status === 'running') return
    generation++
    for (const id of away) motion().moveTo(id, 'desk')
    away.clear()
  })

  const timer = setInterval(() => {
    const running = runActive()
    if (!running && wasRunning) resumeAt = Date.now() + RESUME_AFTER_RUN_S * 1000
    wasRunning = running
    if (running || Date.now() < resumeAt || office().connection === 'connecting') return

    const now = Date.now()
    for (const a of layout.agents) {
      if (busy.has(a.id) || now < (nextAt.get(a.id) ?? 0)) continue
      void live(a.id)
    }
  }, TICK_MS)

  return () => {
    clearInterval(timer)
    unsubscribe()
    generation++
  }
}
