import type { RegisteredTool } from '../define-tool'
import { discoveryTools } from './discovery'

export const ALL_TOOLS: RegisteredTool[] = [...discoveryTools]
