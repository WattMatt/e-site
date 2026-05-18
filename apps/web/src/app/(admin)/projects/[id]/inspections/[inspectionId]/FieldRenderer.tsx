'use client'

import type { Field, Response as InspectionResponse } from '@esite/shared'
import PassFailField from './fields/PassFailField'
import NumberField from './fields/NumberField'
import TextField from './fields/TextField'
import DropdownField from './fields/DropdownField'
import DateField from './fields/DateField'
import PhotoField from './fields/PhotoField'
import SignatureField from './fields/SignatureField'
import FileField from './fields/FileField'
import HeaderField from './fields/HeaderField'
import ComputedField from './fields/ComputedField'

export interface RendererProps {
  field: Field
  response?: InspectionResponse
  inspectionId: string
  sectionId: string
  readOnly: boolean
  verifierFlipMode: boolean
  onChange: (patch: Partial<InspectionResponse>) => void
}

export default function FieldRenderer(p: RendererProps) {
  switch (p.field.type) {
    case 'pass_fail':
      return <PassFailField {...p} />
    case 'number':
      return <NumberField {...p} />
    case 'text':
    case 'textarea':
      return <TextField {...p} />
    case 'dropdown':
    case 'multi_select':
      return <DropdownField {...p} />
    case 'date':
      return <DateField {...p} />
    case 'photo':
      return <PhotoField {...p} />
    case 'signature':
      return <SignatureField {...p} />
    case 'file':
      return <FileField {...p} />
    case 'header':
      return <HeaderField {...p} />
    case 'computed':
      return <ComputedField {...p} />
    default:
      return null
  }
}
