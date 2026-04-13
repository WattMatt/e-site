import { redirect } from 'next/navigation'

// Root → redirect to dashboard (middleware handles unauth → login)
export default function HomePage() {
  redirect('/dashboard')
}
