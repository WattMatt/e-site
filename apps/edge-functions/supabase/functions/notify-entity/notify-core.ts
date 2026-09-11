/**
 * RECOVERED SOURCE — extracted 2026-09-11 from the deployed `notify-entity`
 * bundle (ESZIP2.3, v3, deployed 2026-06-24); never committed. Checked in
 * verbatim so the repo matches production; see index.ts for why and for the
 * full provenance note.
 *
 * ⚠ KNOWN DEFECT, NOT FIXED HERE. Both fan-out calls below send
 * `Authorization: Bearer ${deps.serviceKey}`, where serviceKey is the edge
 * runtime's `SUPABASE_SERVICE_ROLE_KEY`. The runtime injects that in the
 * `sb_secret_…` format, which is not a JWT — so `send-notification` and
 * `send-email` (both deployed with gateway verification ON) answer 401 and
 * neither the bell nor the email is ever delivered. The errors are logged and
 * swallowed because the whole path is best-effort, so this fails silently.
 * Same bug as the 2026-07-23 cron tick; the fix there was to forward the
 * caller's own `Authorization` header rather than rebuild one. Fixing it is a
 * behaviour change and belongs in its own commit, not in a source-rescue.
 */
/**
 * Roster-notification orchestration for snag + site-diary creation (Deno port).
 *
 * MIRROR of packages/shared/src/notify/notify-entity-created.ts — keep the two
 * in lockstep. The canonical is integration-tested in the shared package; this
 * port differs only in (a) the renderer import path and (b) Deno-native typing.
 *
 * One live resolve (the 00146 `project_notification_recipients` RPC) feeds both
 * channels: the in-app bell + push (whole roster minus the actor) and the
 * batched roster email (gated by the per-module project toggle). Inactive
 * members + non-members are excluded inside the RPC. Best-effort — never throws.
 */ import { renderSnagCreatedEmail, renderDiaryCreatedEmail } from '../_shared/email-templates/field-create.ts';
const SUMMARY_MAX = 280;
/** Per-module email toggles. M3-safe: missing row → defaults ON. */ async function readToggles(deps, projectId) {
  const { data } = await deps.svc.schema('projects').from('project_settings').select('notify_snag_email, notify_diary_email').eq('project_id', projectId).maybeSingle();
  return {
    snagEmail: data?.notify_snag_email ?? true,
    diaryEmail: data?.notify_diary_email ?? true
  };
}
/** One live resolve → bell + push (roster minus actor) + batched email (gated). */ async function notifyEntityEvent(deps, args) {
  try {
    const { data, error } = await deps.svc.rpc('project_notification_recipients', {
      p_project_id: args.projectId,
      p_exclude_user: null
    });
    if (error || !Array.isArray(data)) {
      if (error) console.error('[notify] resolve failed', {
        projectId: args.projectId,
        err: error.message
      });
      return;
    }
    const recipients = data;
    const bellUserIds = recipients.filter((r)=>r.user_id !== args.actorId).map((r)=>r.user_id);
    const emails = recipients.map((r)=>r.email).filter((e)=>Boolean(e));
    if (bellUserIds.length) {
      try {
        await deps.fetch(`${deps.supabaseUrl}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deps.serviceKey}`
          },
          body: JSON.stringify({
            userIds: bellUserIds,
            title: args.bell.title,
            body: args.bell.body,
            type: args.bell.type,
            entityType: args.bell.entityType,
            entityId: args.bell.entityId,
            data: {
              route: args.bell.route
            }
          })
        });
      } catch (e) {
        console.error('[notify] bell threw', {
          type: args.bell.type,
          err: String(e)
        });
      }
    }
    if (args.email?.enabled && emails.length) {
      try {
        const res = await deps.fetch(`${deps.supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deps.serviceKey}`
          },
          body: JSON.stringify({
            type: 'rfi-created',
            payload: {
              to: emails,
              subject: args.email.subject,
              html: args.email.html
            }
          })
        });
        if (!res.ok) {
          const body = await res.text().catch(()=>'');
          console.error('[notify] email failed', {
            type: args.bell.type,
            status: res.status,
            body: body.slice(0, 200)
          });
        }
      } catch (e) {
        console.error('[notify] email threw', {
          type: args.bell.type,
          err: String(e)
        });
      }
    }
  } catch (e) {
    console.error('[notify] failed', {
      projectId: args.projectId,
      err: String(e)
    });
  }
}
/** Bell to the whole roster (minus raiser) + batched email (gated by `notify_snag_email`). */ export async function notifySnagCreatedRoster(deps, args) {
  try {
    const toggles = await readToggles(deps, args.projectId);
    const nameIds = [
      args.assigneeId,
      args.raiserId
    ].filter((x)=>Boolean(x));
    const { data: profileRows } = await deps.svc.from('profiles').select('id, full_name').in('id', nameIds);
    const profiles = Object.fromEntries((profileRows ?? []).map((p)=>[
        p.id,
        p
      ]));
    const { data: project } = await deps.svc.schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle();
    const { subject, html } = renderSnagCreatedEmail({
      raisedByName: profiles[args.raiserId]?.full_name ?? 'A team member',
      assigneeName: args.assigneeId ? profiles[args.assigneeId]?.full_name ?? null : null,
      snagTitle: args.title,
      projectName: project?.name ?? 'your project',
      priority: args.priority,
      dueDate: args.dueDate ?? null,
      snagId: args.snagId,
      siteUrl: deps.siteUrl
    });
    await notifyEntityEvent(deps, {
      projectId: args.projectId,
      actorId: args.raiserId,
      bell: {
        title: 'New snag raised',
        body: `"${args.title}" — ${args.priority} priority`,
        route: `/snags/${args.snagId}`,
        type: 'snag_created',
        entityType: 'snag',
        entityId: args.snagId
      },
      email: {
        enabled: toggles.snagEmail,
        subject,
        html
      }
    });
  } catch  {
  // Notification failures must never propagate to the snag write.
  }
}
/** Bell to the whole roster (minus author) + batched email (gated by `notify_diary_email`). */ export async function notifyDiaryCreatedRoster(deps, args) {
  try {
    const toggles = await readToggles(deps, args.projectId);
    const { data: author } = await deps.svc.from('profiles').select('full_name').eq('id', args.authorId).maybeSingle();
    const { data: project } = await deps.svc.schema('projects').from('projects').select('name').eq('id', args.projectId).maybeSingle();
    const trimmed = args.progressNotes.trim();
    const summary = trimmed.length > SUMMARY_MAX ? `${trimmed.slice(0, SUMMARY_MAX)}…` : trimmed;
    const projectName = project?.name ?? 'your project';
    const { subject, html } = renderDiaryCreatedEmail({
      authorName: author?.full_name ?? 'A team member',
      projectName,
      entryDate: args.entryDate,
      summary,
      projectId: args.projectId,
      siteUrl: deps.siteUrl
    });
    await notifyEntityEvent(deps, {
      projectId: args.projectId,
      actorId: args.authorId,
      bell: {
        title: 'New site diary entry',
        body: `${projectName} — ${args.entryDate}`,
        route: `/projects/${args.projectId}/diary`,
        type: 'diary_created',
        entityType: 'diary',
        entityId: args.entryId
      },
      email: {
        enabled: toggles.diaryEmail,
        subject,
        html
      }
    });
  } catch  {
  // Notification failures must never propagate to the diary write.
  }
}
