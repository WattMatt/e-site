import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode, type CSSProperties } from 'react'

// Shared form primitive. Wraps a label, the input slot, an optional hint, and
// an error message with consistent typography + spacing. Pair with
// <TextInput>, <Select>, <Textarea> below to get the amber focus ring + error
// border automatically.
//
// Pattern:
//   <FormField label="Email" required error={errors.email?.message}>
//     <TextInput type="email" {...register('email')} />
//   </FormField>

export interface FormFieldProps {
  label: string
  required?: boolean
  error?: string | undefined
  hint?: string
  htmlFor?: string
  children: ReactNode
}

export function FormField({ label, required, error, hint, htmlFor, children }: FormFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        htmlFor={htmlFor}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--c-text-mid)',
          letterSpacing: '0.02em',
        }}
      >
        {label}
        {required && <span style={{ color: 'var(--c-amber)', marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && !error && (
        <span style={{ fontSize: 11, color: 'var(--c-text-dim)', lineHeight: 1.5 }}>{hint}</span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--c-red)', lineHeight: 1.5 }}>{error}</span>
      )}
    </div>
  )
}

// ─── Shared field styling ────────────────────────────────────────────────────

const fieldBase: CSSProperties = {
  background: 'var(--c-panel)',
  color: 'var(--c-text)',
  border: '1px solid var(--c-border-mid)',
  borderRadius: 4,
  padding: '9px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
}

function fieldStyleWithError(hasError?: boolean, extra?: CSSProperties): CSSProperties {
  return {
    ...fieldBase,
    ...(hasError ? { borderColor: 'var(--c-red)' } : {}),
    ...extra,
  }
}

// ─── TextInput ───────────────────────────────────────────────────────────────

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { invalid, style, onFocus, onBlur, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      style={fieldStyleWithError(invalid, style)}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--c-red)' : 'var(--c-amber)'
        e.currentTarget.style.boxShadow = invalid
          ? '0 0 0 2px rgba(232,85,85,0.15)'
          : '0 0 0 2px rgba(232,146,58,0.18)'
        onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--c-red)' : 'var(--c-border-mid)'
        e.currentTarget.style.boxShadow = 'none'
        onBlur?.(e)
      }}
    />
  )
})

// ─── Select ──────────────────────────────────────────────────────────────────

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, style, onFocus, onBlur, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      {...rest}
      style={fieldStyleWithError(invalid, style)}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--c-red)' : 'var(--c-amber)'
        e.currentTarget.style.boxShadow = invalid
          ? '0 0 0 2px rgba(232,85,85,0.15)'
          : '0 0 0 2px rgba(232,146,58,0.18)'
        onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--c-red)' : 'var(--c-border-mid)'
        e.currentTarget.style.boxShadow = 'none'
        onBlur?.(e)
      }}
    >
      {children}
    </select>
  )
})

// ─── Textarea ────────────────────────────────────────────────────────────────

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, style, onFocus, onBlur, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      {...rest}
      style={fieldStyleWithError(invalid, { resize: 'vertical', minHeight: 80, ...style })}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--c-red)' : 'var(--c-amber)'
        e.currentTarget.style.boxShadow = invalid
          ? '0 0 0 2px rgba(232,85,85,0.15)'
          : '0 0 0 2px rgba(232,146,58,0.18)'
        onFocus?.(e)
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = invalid ? 'var(--c-red)' : 'var(--c-border-mid)'
        e.currentTarget.style.boxShadow = 'none'
        onBlur?.(e)
      }}
    />
  )
})
