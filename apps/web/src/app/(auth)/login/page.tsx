'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { signInSchema, type SignInInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) })

  async function onSubmit({ email, password }: SignInInput) {
    setServerError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setServerError(error.message)
      return
    }
    const next = new URLSearchParams(window.location.search).get('next') ?? '/dashboard'
    window.location.href = next
  }

  return (
    <div className="bg-slate-800 rounded-xl p-8 shadow-2xl">
      <h2 className="text-xl font-semibold text-white mb-6">Sign in</h2>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Email</label>
          <input
            {...register('email')}
            type="email"
            className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@company.co.za"
          />
          {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email.message}</p>}
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Password</label>
          <input
            {...register('password')}
            type="password"
            className="w-full bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.password && <p className="text-red-400 text-sm mt-1">{errors.password.message}</p>}
        </div>

        {serverError && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
            {serverError}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {isSubmitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-center text-sm text-slate-400">
        <Link href="/reset-password" className="block hover:text-white">
          Forgot password?
        </Link>
        <Link href="/signup" className="block hover:text-white">
          Don&apos;t have an account? Sign up
        </Link>
      </div>
    </div>
  )
}
