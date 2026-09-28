/**
 * The request body of POST /api/paystack/solar-subscribe, shared by the route
 * (which parses it) and the Solar SubscribeButton (which sends it), so the two
 * cannot drift. The org is always derived from the PROJECT server-side.
 */
import { z } from 'zod'

export const solarSubscribeBodySchema = z.object({ project_id: z.string().uuid() })
export type SolarSubscribeBody = z.infer<typeof solarSubscribeBodySchema>
