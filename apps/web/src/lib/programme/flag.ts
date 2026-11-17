/** The programme module ships dark: every programme action refuses until `PROGRAMME_ENABLED=true`. */
export function programmeEnabled(): boolean {
  return process.env.PROGRAMME_ENABLED === 'true'
}
