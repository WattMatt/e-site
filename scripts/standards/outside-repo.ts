/**
 * Datasets and reports carry licensed values; the repository is public. Refuse
 * any output path inside ANY git work tree (this worktree, the canonical
 * checkout, …), compared on real paths and case-insensitively (APFS).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function outsideRepo(path: string): string {
  const abs = resolve(path)
  let dir = dirname(abs)
  while (!existsSync(dir)) dir = dirname(dir)
  const real = realpathSync(dir)
  let top: string | null = null
  try {
    top = execFileSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch { /* not inside a git work tree */ }
  const here = realpathSync(resolve(import.meta.dirname, '../..'))
  const inside = (root: string): boolean => {
    const r = realpathSync(root).toLowerCase(); const d = real.toLowerCase()
    return d === r || d.startsWith(r + '/')
  }
  if (top || inside(here)) throw new Error(`refusing to write licensed values inside a git work tree: ${abs}`)
  return abs
}
