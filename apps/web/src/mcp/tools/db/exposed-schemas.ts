import { ToolRefusal } from '../../define-tool'
import { EXPOSED_SCHEMAS } from '@/lib/mcp-mask/exposed-schemas'
import { UNKNOWN_SCHEMA } from './sentences'

export { EXPOSED_SCHEMAS } from '@/lib/mcp-mask/exposed-schemas'

export function assertExposedSchema(schema: string): void {
  if (!(EXPOSED_SCHEMAS as readonly string[]).includes(schema)) throw new ToolRefusal(UNKNOWN_SCHEMA)
}
