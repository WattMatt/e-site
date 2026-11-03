import type { RegisteredTool } from '../../define-tool'
import { esiteDbSchemas } from './catalog'
import { esiteDbSelect } from './select'
import { esiteDbSql } from './sql'

export const dbTools: RegisteredTool[] = [esiteDbSchemas, esiteDbSelect, esiteDbSql]
