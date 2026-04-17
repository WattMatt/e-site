import { type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed'

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary:   { background: 'var(--c-amber)', color: '#0D0B09', border: 'none', borderRadius: 6 },
  secondary: { background: 'var(--c-panel)', color: 'var(--c-text-mid)', border: '1px solid var(--c-border)', borderRadius: 6 },
  ghost:     { background: 'transparent', color: 'var(--c-text-mid)', border: 'none', borderRadius: 6 },
  danger:    { background: 'var(--c-red-dim)', color: 'var(--c-red)', border: '1px solid #6b1e1e', borderRadius: 6 },
}

const sizeStyles: Record<Size, React.CSSProperties> = {
  sm: { padding: '6px 12px', fontSize: 12 },
  md: { padding: '9px 16px', fontSize: 13 },
  lg: { padding: '12px 24px', fontSize: 15 },
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
  isLoading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  isLoading,
  disabled,
  style,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || isLoading}
      className={`${BASE}${className ? ` ${className}` : ''}`}
      style={{ ...variantStyles[variant], ...sizeStyles[size], fontFamily: 'var(--font-sans)', letterSpacing: '0.01em', ...style }}
    >
      {isLoading && (
        <svg className="animate-spin" width="14" height="14" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
