// apps/mobile/src/hooks/projects.queries.ts
//
// Pure, React-Native-free so it is unit-testable under Vitest (Node).
//
// The device SQLite DB already holds exactly the projects the user may see:
// own-org projects via the `org_projects` PowerSync bucket + cross-org shared
// sites via the `project_access` bucket. An organisation filter here would
// re-hide the shared sites, which is the bug this change fixes.
export const PROJECTS_LOCAL_QUERY = 'SELECT * FROM projects ORDER BY name ASC'
