/**
 * RECOVERED SOURCE — extracted 2026-09-11 from the deployed `notify-entity`
 * bundle (ESZIP2.3, v3, deployed 2026-06-24); never committed. It sits under
 * `_shared/` because that is where the deployed bundle's import specifier
 * points (`../_shared/email-templates/field-create.ts`); `notify-entity` is
 * currently its only consumer. Checked in verbatim; see
 * `notify-entity/index.ts` for the provenance note.
 *
 * Note the header below claims to mirror `packages/shared/src/email/rfi-email.ts`
 * and `notify-core.ts` claims to mirror
 * `packages/shared/src/notify/notify-entity-created.ts`. NEITHER canonical
 * exists in this repository — both were part of the same unmerged work. There
 * is therefore nothing to keep these "in lockstep" with today.
 */
/**
 * Snag + site-diary "created" email renderers (Deno port).
 *
 * MIRROR of packages/shared/src/email/rfi-email.ts —
 * renderSnagCreatedEmail / renderDiaryCreatedEmail. Keep the two in lockstep.
 * Pure (no Deno/Node globals), so the bodies are copied verbatim; only this
 * header differs from the canonical. Consumed by the `notify-entity` function
 * so mobile-originated snag/diary creates email the roster with the same
 * markup the web path sends.
 */ function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Dark-card transactional wrapper matching the other send-email templates. */ function baseEmailTemplate(content, siteUrl) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:32px}
.card{background:#1E293B;border:1px solid #334155;border-radius:12px;padding:28px;max-width:480px;margin:0 auto}
h2{margin:0 0 16px;font-size:18px}
.btn{display:inline-block;margin-top:16px;background:#3B82F6;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:14px}
.footer{margin-top:24px;font-size:11px;color:#64748B}</style></head>
<body><div class="card">${content}<div class="footer">E-Site Construction Management · <a href="${siteUrl}" style="color:#3B82F6">app.e-site.live</a></div></div></body></html>`;
}
/** Render the "new snag" email (description + deep link). */ export function renderSnagCreatedEmail(v) {
  const link = `${v.siteUrl}/snags/${v.snagId}`;
  const assignee = v.assigneeName ?? 'Unassigned';
  const subject = `New snag: ${v.snagTitle}`;
  const html = baseEmailTemplate(`<h2>New snag raised</h2>
    <p><strong>${escapeHtml(v.raisedByName)}</strong> raised a snag on project <strong>${escapeHtml(v.projectName)}</strong>.</p>
    <p><strong>Defect:</strong> ${escapeHtml(v.snagTitle)}<br>
    <strong>Assigned to:</strong> ${escapeHtml(assignee)}<br>
    <strong>Priority:</strong> ${escapeHtml(v.priority)}${v.dueDate ? `<br><strong>Due:</strong> ${escapeHtml(v.dueDate)}` : ''}</p>
    <a class="btn" href="${link}">View snag</a>`, v.siteUrl);
  return {
    subject,
    html
  };
}
/** Render the "new site diary entry" email (excerpt + deep link to the diary). */ export function renderDiaryCreatedEmail(v) {
  const link = `${v.siteUrl}/projects/${v.projectId}/diary`;
  const subject = `Site diary — ${v.projectName} (${v.entryDate})`;
  const html = baseEmailTemplate(`<h2>New site diary entry</h2>
    <p><strong>${escapeHtml(v.authorName)}</strong> logged a diary entry on <strong>${escapeHtml(v.projectName)}</strong> for <strong>${escapeHtml(v.entryDate)}</strong>.</p>
    <p style="white-space:pre-wrap">${escapeHtml(v.summary)}</p>
    <a class="btn" href="${link}">View diary</a>`, v.siteUrl);
  return {
    subject,
    html
  };
}
