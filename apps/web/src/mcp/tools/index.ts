import type { RegisteredTool } from '../define-tool'
import { discoveryTools } from './discovery'
import { dbTools } from './db'

export const ALL_TOOLS: RegisteredTool[] = [...discoveryTools, ...dbTools]
