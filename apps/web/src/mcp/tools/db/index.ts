import type { RegisteredTool } from '../../define-tool'
import { esiteDbSchemas } from './catalog'
import { esiteDbSelect } from './select'
import { esiteDbSql } from './sql'
import { esiteDbInsert } from './insert'
import { esiteDbUpdate, esiteDbDelete } from './mutate'

export const dbTools: RegisteredTool[] = [esiteDbSchemas, esiteDbSelect, esiteDbSql, esiteDbInsert, esiteDbUpdate, esiteDbDelete]
