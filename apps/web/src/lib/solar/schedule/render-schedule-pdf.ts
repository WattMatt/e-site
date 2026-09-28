import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { CalendarDate, WorkCalendar } from '@esite/shared'
import { SchedulePdfDocument, buildSchedulePdfModel } from './schedule-pdf'
import type { ScheduleData } from './types'

/** Node runtime only (renderToBuffer); tests need `// @vitest-environment node`. */
export async function renderSchedulePdf(data: ScheduleData, cal: WorkCalendar, generatedOn: CalendarDate): Promise<Buffer> {
  const element = React.createElement(SchedulePdfDocument, { model: buildSchedulePdfModel(data, cal, generatedOn) }) as unknown as React.ReactElement<DocumentProps>
  return renderToBuffer(element)
}
