import { redirect } from 'next/navigation'

// The portal home lands clients on their "My sites" picker.
export default function PortalHome() {
  redirect('/portal/sites')
}
