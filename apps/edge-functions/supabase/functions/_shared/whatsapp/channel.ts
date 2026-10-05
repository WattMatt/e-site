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
import { formsMenuRow, hasOpenInspections } from './forms.ts'

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
    ...((await hasOpenInspections(deps, link, current.id)) ? [formsMenuRow()] : []),
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

function newPostId(): string {
  return crypto.randomUUID()
}

async function currentProjectRow(deps: ProcessorDeps, link: LinkRow): Promise<ProjectRow | null> {
  const list = await myProjects(deps, link)
  return list.find((p) => p.id === link.current_project_id) ?? null
}

async function promptForPost(deps: ProcessorDeps, link: LinkRow, post: PendingPost): Promise<ProcessResult> {
  await deps.meta.sendText(link.phone_e164, CHANNEL.postPrompt(post.project_name ?? 'the project'))
  return res('applied', 'post_armed', link.user_id, null)
}

async function askClassify(deps: ProcessorDeps, link: LinkRow, post: PendingPost): Promise<ProcessResult> {
  await deps.meta.sendButtons(link.phone_e164, CHANNEL.postAsk(post.project_name ?? 'the project'), [
    { id: encodePayload({ kind: 'post', choice: 'diary', postId: post.post_id }), title: CHANNEL.diaryButton },
    { id: encodePayload({ kind: 'post', choice: 'issue', postId: post.post_id }), title: CHANNEL.issueButton },
  ])
  const next = { ...post, asked: true }
  await deps.store.updateLink(link.id, { pending_post: next })
  link.pending_post = next
  return res('unmatched', 'post_asked', link.user_id, null)
}

/** "Post to {project}" chosen from the menu or the pick list. A held unmatched message becomes the post's first message. */
async function startPost(deps: ProcessorDeps, link: LinkRow): Promise<ProcessResult> {
  const project = await currentProjectRow(deps, link)
  const post: PendingPost = {
    post_id: newPostId(), project_id: project?.id ?? null, project_name: project?.name ?? null,
    inbound_ids: link.pending_inbound_id ? [link.pending_inbound_id] : [], started_at: deps.now().toISOString(), asked: false,
  }
  await deps.store.updateLink(link.id, { pending_post: post, pending_inbound_id: null })
  link.pending_post = post
  link.pending_inbound_id = null
  if (!project) return sendProjectList(deps, link, await myProjects(deps, link), CHANNEL.whichProject)
  if (project.role === 'client_viewer') {
    await deps.store.updateLink(link.id, { pending_post: null })
    await deps.meta.sendText(link.phone_e164, CHANNEL.notYourProject)
    return res('refused', 'client_viewer_post', link.user_id, null)
  }
  return post.inbound_ids.length ? askClassify(deps, link, post) : promptForPost(deps, link, post)
}

async function holdInPost(deps: ProcessorDeps, link: LinkRow, post: PendingPost, inboundId: string): Promise<ProcessResult> {
  const next: PendingPost = { ...post, inbound_ids: [...post.inbound_ids, inboundId] }
  await deps.store.updateLink(link.id, { pending_post: next })
  link.pending_post = next
  if (!next.project_id) return res('unmatched', 'post_held', link.user_id, null)
  if (!next.asked) return askClassify(deps, link, next)
  return res('unmatched', 'post_held', link.user_id, null)
}

export async function expireStalePost(deps: ProcessorDeps, link: LinkRow): Promise<string | null> {
  const post = link.pending_post as PendingPost | null
  if (!post || isWithin(post.started_at, deps.now(), PENDING_POST_TTL_MS)) return null
  for (const id of post.inbound_ids) {
    await deps.store.markInbound(id, { outcome: 'unmatched', outcome_reason: 'post_expired', resolved_user_id: link.user_id,
      resolved_item_id: null, processed_at: deps.now().toISOString() })
  }
  await deps.store.updateLink(link.id, { pending_post: null })
  link.pending_post = null
  return post.inbound_ids.length ? CHANNEL.postExpired(post.project_name) : null
}

/** Rows prepended to the foundation's "Which item is this for?" list. */
export async function pickPrefixRows(deps: ProcessorDeps, link: LinkRow): Promise<Array<{ id: string; title: string; description?: string }>> {
  const project = await currentProjectRow(deps, link)
  if (project?.role === 'client_viewer') return []
  return [{ id: encodePayload({ kind: 'menu', row: 'post' }),
    title: project ? CHANNEL.postToProject(project.name) : CHANNEL.postToAProject, description: CHANNEL.postNotItem }]
}

const extOf = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg')

async function classifyPost(deps: ProcessorDeps, link: LinkRow, choice: 'diary' | 'issue', postId: string): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const to = link.phone_e164
  const post = link.pending_post as PendingPost | null
  if (!post || post.post_id !== postId || !isWithin(post.started_at, now(), PENDING_POST_TTL_MS)) {
    await meta.sendText(to, CHANNEL.postGone)
    return res('refused', 'post_gone', link.user_id, null)
  }
  if (!post.project_id || post.inbound_ids.length === 0) {
    await meta.sendText(to, CHANNEL.postEmpty)
    return res('refused', 'post_empty', link.user_id, null)
  }
  const rows = (await Promise.all(post.inbound_ids.map((id) => store.inboundById(id)))).filter((r): r is InboundRow => Boolean(r))
  const msgs = rows.map((r) => ({ row: r, msg: r.raw as InboundMessage }))
  const texts = msgs.map((m) => m.msg.text).filter((t): t is string => Boolean(t && t.trim()))
  const body = texts.join('\n')
  const photos = msgs.filter((m) => m.msg.type === 'image' && m.msg.imageId)
  const name = post.project_name ?? 'the project'
  let itemId: string | null = null

  if (choice === 'diary') {
    const r = await store.call('wa_post_diary', { p_user: link.user_id, p_project: post.project_id, p_body: body, p_inbound: rows[0]?.id ?? null })
    if (r?.code !== 'ok') {
      await meta.sendText(to, CHANNEL.postRefused(String(r?.message ?? "you can't post to this project")))
      await store.updateLink(link.id, { pending_post: null })
      return res('refused', `diary_${r?.code ?? 'error'}`, link.user_id, null)
    }
    for (const { row: pr, msg } of photos) {
      const { bytes, mime } = await meta.fetchMedia(msg.imageId!)
      const file = `wa-${msg.id}.${extOf(mime)}`
      const path = `${r.organisation_id}/${post.project_id}/${r.id}/${file}`
      await store.upload('diary-attachments', path, bytes, mime)
      await store.call('wa_add_diary_attachment', { p_user: link.user_id, p_entry: r.id, p_path: path, p_name: file,
        p_mime: mime, p_size: bytes.length, p_inbound: pr.id })
    }
    await meta.sendText(to, CHANNEL.diaryDone(name, photos.length))
  } else {
    const title = (texts[0] ?? '').slice(0, 120)
    const r = await store.call('wa_post_issue', { p_user: link.user_id, p_project: post.project_id, p_title: title, p_inbound: rows[0]?.id ?? null })
    if (r?.code !== 'ok') {
      await meta.sendText(to, CHANNEL.postRefused(String(r?.message ?? "you can't raise issues on this project")))
      await store.updateLink(link.id, { pending_post: null })
      return res('refused', `issue_${r?.code ?? 'error'}`, link.user_id, null)
    }
    itemId = r.id
    if (body) await store.call('wa_add_note', { p_user: link.user_id, p_item: r.id, p_body: body, p_inbound: rows[0]?.id ?? null })
    for (const { row: pr, msg } of photos) {
      const { bytes, mime } = await meta.fetchMedia(msg.imageId!)
      const path = `${r.organisation_id}/${post.project_id}/${r.id}/wa-${msg.id}.${extOf(mime)}`
      await store.upload('work-item-attachments', path, bytes, mime)
      await store.call('wa_add_attachment', { p_user: link.user_id, p_item: r.id, p_bucket: 'work-item-attachments',
        p_path: path, p_mime: mime, p_role: 'evidence', p_inbound: pr.id })
    }
    await meta.sendText(to, CHANNEL.issueDone(r.ref, name, r.assignee_name ?? null))
  }

  for (const r of rows) {
    await store.markInbound(r.id, { outcome: 'applied', outcome_reason: `posted_${choice}`, resolved_user_id: link.user_id,
      resolved_item_id: itemId, processed_at: now().toISOString() })
  }
  await store.updateLink(link.id, { pending_post: null })
  link.pending_post = null
  return res('applied', `posted_${choice}`, link.user_id, itemId)
}
