// fetch-only and free of Node-only imports: src/middleware.ts runs on the edge runtime.
export async function hasVerifiedMfaFactor(userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        cache: 'no-store',
      },
    )
    if (!res.ok) return false
    const body = await res.json() as { factors?: { status: string }[] }
    return (body.factors ?? []).some((f) => f.status === 'verified')
  } catch {
    return false
  }
}
