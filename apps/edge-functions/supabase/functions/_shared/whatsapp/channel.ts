// apps/edge-functions/supabase/functions/_shared/whatsapp/channel.ts
//
// The per-project "channel" over a 1:1 conversation (spec 2026-09-29). This
// file decides which list or card to show; every read of projects and items
// goes through a wa_* function that acts as the user under RLS.
import {
  PENDING_POST_TTL_MS, decodePayload, encodePayload, isMenuWord, isWithin, matchProjects, type Payload,
} from './core.ts'
import type { InboundMessage } from './parse.ts'
import type { InboundRow, LinkRow, ProcessResult, ProcessorDeps } from './processor.ts'
import { humanDate } from './templates.ts'

export interface PendingPost {
  post_id: string
  project_id: string | null
  project_name: string | null
  inbound_ids: string[]
  started_at: string
  asked: boolean
}

interface ProjectRow { id: string; name: string; role: string }

export const CHANNEL = {
  noProjects: "You're not on any E-Site projects yet. Ask your project manager to add you.",
  whichProject: 'Which project?',
  didYouMean: 'Did you mean…',
  projectsButton: 'Projects',
  menuButton: 'Menu',
  itemsButton: 'Items',
  now: (name: string) => `Now on *${name}*.`,
  menuBody: (name: string) => `*${name}* — what do you need?`,
  notYourProject: "You're not on that project.",
  nothingOpen: (name: string) => `Nothing open on ${name} right now.`,
  nothingMine: (name: string) => `Nothing waiting on you on ${name}.`,
  itemGone: "That item isn't available to you.",
  postPrompt: (name: string) => `Send the photo or message for *${name}*.`,
  postAsk: (name: string) => `Post to *${name}* as…`,
  diaryButton: '📓 Diary',
  issueButton: '⚠️ Raise an issue',
  postToProject: (name: string) => `Post to ${name}`,
  postToAProject: 'Post to a project…',
  postNotItem: '(not an item)',
  diaryDone: (name: string, photos: number) =>
    `📓 Added to today's ${name} diary${photos ? ` with ${photos} photo${photos === 1 ? '' : 's'}` : ''}.`,
  issueDone: (ref: string, name: string, who: string | null) =>
    `⚠️ Raised *${ref}* on ${name} — it's with ${who ?? 'the project manager'} to sort out.`,
  postExpired: (name: string | null) => `Your earlier post to ${name ?? 'the project'} wasn't filed — send it again.`,
  postGone: 'That post was already filed or has expired.',
  postEmpty: 'Send the photo or message first.',
  postRefused: (msg: string) => `Couldn't file that: ${msg}`,
} as const

const res = (outcome: ProcessResult['outcome'], reason: string | null, userId: string | null, itemId: string | null): ProcessResult =>
  ({ outcome, reason, userId, itemId })

async function myProjects(deps: ProcessorDeps, link: LinkRow): Promise<ProjectRow[]> {
  const r = await deps.store.call('wa_my_projects', { p_user: link.user_id })
  return Array.isArray(r) ? (r as ProjectRow[]) : []
}

async function setProject(deps: ProcessorDeps, link: LinkRow, projectId: string): Promise<void> {
  await deps.store.updateLink(link.id, { current_project_id: projectId, current_project_at: deps.now().toISOString() })
  link.current_project_id = projectId
}

export async function sendProjectList(deps: ProcessorDeps, link: LinkRow, list: ProjectRow[], body: string): Promise<ProcessResult> {
  await deps.meta.sendList(link.phone_e164, body, CHANNEL.projectsButton,
    list.slice(0, 10).map((p) => ({ id: encodePayload({ kind: 'proj', projectId: p.id }), title: p.name, description: p.role })))
  return res('unmatched', 'project_list', link.user_id, null)
}

export async function sendMenu(deps: ProcessorDeps, link: LinkRow, prefix?: string): Promise<ProcessResult> {
  const list = await myProjects(deps, link)
  if (list.length === 0) {
    await deps.meta.sendText(link.phone_e164, CHANNEL.noProjects)
    return res('refused', 'no_projects', link.user_id, null)
  }
  let current = list.find((p) => p.id === link.current_project_id) ?? null
  if (!current && list.length === 1) {
    current = list[0]
    await setProject(deps, link, current.id)
  }
  if (!current) return sendProjectList(deps, link, list, prefix ? `${prefix}\n\n${CHANNEL.whichProject}` : CHANNEL.whichProject)
  const rows = [
    { id: encodePayload({ kind: 'menu', row: 'mine' }), title: 'My open items' },
    { id: encodePayload({ kind: 'menu', row: 'project' }), title: 'Project open items' },
    ...(current.role !== 'client_viewer' ? [{ id: encodePayload({ kind: 'menu', row: 'post' }), title: CHANNEL.postToProject(current.name) }] : []),
    { id: encodePayload({ kind: 'menu', row: 'switch' }), title: 'Switch project' },
  ]
  await deps.meta.sendList(link.phone_e164, (prefix ? `${prefix}\n\n` : '') + CHANNEL.menuBody(current.name), CHANNEL.menuButton, rows)
  return res('applied', 'menu', link.user_id, null)
}

async function sendItemList(deps: ProcessorDeps, link: LinkRow, scope: 'mine' | 'project'): Promise<ProcessResult> {
  const list = await myProjects(deps, link)
  const current = list.find((p) => p.id === link.current_project_id)
  if (!current) return sendProjectList(deps, link, list, CHANNEL.whichProject)
  const r = await deps.store.call('wa_project_items', { p_user: link.user_id, p_project: current.id, p_scope: scope })
  const items = Array.isArray(r) ? (r as Array<{ id: string; ref: string; title: string; due_date: string }>) : []
  if (items.length === 0) {
    await deps.meta.sendText(link.phone_e164, scope === 'mine' ? CHANNEL.nothingMine(current.name) : CHANNEL.nothingOpen(current.name))
    return res('applied', 'no_items', link.user_id, null)
  }
  await deps.meta.sendList(link.phone_e164, `${current.name} — ${scope === 'mine' ? 'waiting on you' : 'open items'}`, CHANNEL.itemsButton,
    items.map((i) => ({ id: encodePayload({ kind: 'item', itemId: i.id }), title: i.ref, description: `due ${humanDate(i.due_date)} · ${i.title}` })))
  return res('applied', `items_${scope}`, link.user_id, null)
}

async function sendItemCard(deps: ProcessorDeps, link: LinkRow, itemId: string): Promise<ProcessResult> {
  const c = await deps.store.call('wa_item_card', { p_user: link.user_id, p_item: itemId })
  if (c?.code !== 'ok') {
    await deps.meta.sendText(link.phone_e164, CHANNEL.itemGone)
    return res('refused', 'item_gone', link.user_id, itemId)
  }
  await deps.meta.sendButtons(link.phone_e164, `*${c.ref}* · ${c.project_name}\n${c.title}\nDue ${humanDate(c.due_date)} · ${c.status}`, [
    { id: encodePayload({ kind: 'ack', itemId }), title: 'Acknowledge' },
    { id: encodePayload({ kind: 'done', itemId }), title: 'Mark done' },
    { id: encodePayload({ kind: 'open', itemId }), title: 'Open in E-Site' },
  ])
  const at = deps.now().toISOString()
  await deps.store.updateLink(link.id, { active_item_id: itemId, active_item_at: at, current_project_id: c.project_id, current_project_at: at })
  return res('applied', 'item_card', link.user_id, itemId)
}

/** Channel payloads (menu, proj, item, open, post). Returns null for payloads this module does not own. */
export async function handleChannelPayload(p: Payload, link: LinkRow, inbound: InboundRow, deps: ProcessorDeps): Promise<ProcessResult | null> {
  switch (p.kind) {
    case 'menu':
      if (p.row === 'mine' || p.row === 'project') return sendItemList(deps, link, p.row)
      if (p.row === 'switch') return sendProjectList(deps, link, await myProjects(deps, link), CHANNEL.whichProject)
      return startPost(deps, link)
    case 'proj': {
      const list = await myProjects(deps, link)
      const chosen = list.find((x) => x.id === p.projectId)
      if (!chosen) {
        await deps.meta.sendText(link.phone_e164, CHANNEL.notYourProject)
        return res('refused', 'not_your_project', link.user_id, null)
      }
      await setProject(deps, link, chosen.id)
      const post = link.pending_post as PendingPost | null
      if (post && !post.project_id) {
        const next: PendingPost = { ...post, project_id: chosen.id, project_name: chosen.name }
        await deps.store.updateLink(link.id, { pending_post: next })
        link.pending_post = next
        return next.inbound_ids.length ? askClassify(deps, link, next) : promptForPost(deps, link, next)
      }
      return sendMenu(deps, link, CHANNEL.now(chosen.name))
    }
    case 'item':
      return sendItemCard(deps, link, p.itemId)
    case 'open':
      await deps.meta.sendText(link.phone_e164, `${deps.appUrl}/wa/${p.itemId}`)
      return res('applied', 'open_link', link.user_id, p.itemId)
    case 'post':
      return classifyPost(deps, link, p.choice, p.postId)
    default:
      return null
  }
}

/** Free text/photos the channel owns: menu words, a held post, project names. Returns null to fall through. */
export async function handleChannelContent(msg: InboundMessage, link: LinkRow, inbound: InboundRow, deps: ProcessorDeps,
                                           hasActiveItem: boolean): Promise<ProcessResult | null> {
  const text = msg.type === 'text' ? (msg.text ?? '') : ''
  if (text && isMenuWord(text)) return sendMenu(deps, link)
  const post = link.pending_post as PendingPost | null
  if (post && isWithin(post.started_at, deps.now(), PENDING_POST_TTL_MS) && (msg.type === 'text' || msg.type === 'image')) {
    return holdInPost(deps, link, post, inbound.id)
  }
  // Project names are only looked for when nothing is current: with an active item, short text is a note.
  if (text && text.length <= 60 && !msg.contextId && !hasActiveItem) {
    const list = await myProjects(deps, link)
    const m = matchProjects(text, list)
    if (m.kind === 'exact') {
      await setProject(deps, link, m.project.id)
      return sendMenu(deps, link, CHANNEL.now(m.project.name))
    }
    if (m.kind === 'candidates') {
      return sendProjectList(deps, link, list.filter((p) => m.projects.some((c) => c.id === p.id)), CHANNEL.didYouMean)
    }
  }
  return null
}

export { decodePayload }

async function startPost(deps: ProcessorDeps, link: LinkRow): Promise<ProcessResult> { return res('refused', 'todo', link.user_id, null) }
async function promptForPost(deps: ProcessorDeps, link: LinkRow, _p: PendingPost): Promise<ProcessResult> { return res('refused', 'todo', link.user_id, null) }
async function askClassify(deps: ProcessorDeps, link: LinkRow, _p: PendingPost): Promise<ProcessResult> { return res('refused', 'todo', link.user_id, null) }
async function holdInPost(deps: ProcessorDeps, link: LinkRow, _p: PendingPost, _id: string): Promise<ProcessResult> { return res('refused', 'todo', link.user_id, null) }
async function classifyPost(deps: ProcessorDeps, link: LinkRow, _c: 'diary' | 'issue', _id: string): Promise<ProcessResult> { return res('refused', 'todo', link.user_id, null) }

export async function expireStalePost(_deps: ProcessorDeps, _link: LinkRow): Promise<string | null> { return null }
export async function pickPrefixRows(_deps: ProcessorDeps, _link: LinkRow): Promise<Array<{ id: string; title: string; description?: string }>> { return [] }
