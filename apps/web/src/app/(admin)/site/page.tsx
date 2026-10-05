import { redirect } from 'next/navigation'

/**
 * `/site` used to be a global "Site capture" page. Capture is always about one
 * project, so it now lives inside the project (`/projects/[id]/capture`). Old
 * links and bookmarks land on the project list instead of a 404.
 *
 * Only the bare `/site` path is caught here. The QR resolver at
 * `(scan)/site/tag/[text]` is a separate route and is unaffected, and
 * `safe-next.ts` keeps the `/site` prefix so that resolver's ?next= sign-in
 * round trip still works.
 *
 * A temporary (307) redirect on purpose: a permanent one is cached by browsers
 * and would defeat a later decision to put a project picker here.
 */
export default function SiteRedirectPage(): never {
  redirect('/projects')
}
