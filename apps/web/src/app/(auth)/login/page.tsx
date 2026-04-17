'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { signInSchema, type SignInInput } from '@esite/shared'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
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
    <div className="auth-card">
      <h2 className="auth-card-title">Welcome back</h2>
      <p className="auth-card-sub">Sign in to your E-Site workspace</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        {serverError && (
          <div className="auth-alert-error">{serverError}</div>
        )}

        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            {...register('email')}
            type="email"
            className={`auth-input${errors.email ? ' auth-input-error' : ''}`}
            placeholder="you@company.co.za"
            autoComplete="email"
          />
          {errors.email && <p className="auth-error-text">{errors.email.message}</p>}
        </div>

        <div className="auth-field">
          <label className="auth-label">Password</label>
          <input
            {...register('password')}
            type="password"
            className={`auth-input${errors.password ? ' auth-input-error' : ''}`}
            autoComplete="current-password"
          />
          {errors.password && <p className="auth-error-text">{errors.password.message}</p>}
        </div>

        <button type="submit" disabled={isSubmitting} className="auth-btn">
          {isSubmitting ? 'Signing in…' : 'Sign in →'}
        </button>
      </form>

      <div className="auth-links">
        <Link href="/reset-password" className="auth-link">Forgot password?</Link>
        <Link href="/signup" className="auth-link">
          No account?{' '}
          <span className="auth-link-accent">Sign up free</span>
        </Link>
      </div>
    </div>
  )
}
