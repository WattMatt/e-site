'use client'

import { useRef, useState, useTransition } from 'react'

import {
  uploadOrgLogoAction,
  updateOrgBrandingAction,
  removeOrgLogoAction,
  type OrgBrandingInput,
} from '@/actions/org-branding.actions'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'

// ─── compressImage (inlined to avoid pulling the full useFieldPhotos hook into
//     this settings bundle — same decision as the project _BrandingFields) ────

const MAX_WIDTH = 2048
const QUALITY = 0.85

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrandingFormProps {
  orgId: string
  name: string
  address: string
  city: string
  province: string
  registrationNumber: string
  vatNumber: string
  phone: string
  website: string
  signatoryName: string
  signatoryTitle: string
  reportAccentColor: string
  /** Whether a logo is currently stored on the org row. */
  hasLogo: boolean
  /** Signed URL for the currently-stored logo, if any. */
  logoUrl: string | null
}

const DEFAULT_ACCENT = '#E69500'

// ─── BrandingForm ──────────────────────────────────────────────────────────────

export function BrandingForm(props: BrandingFormProps) {
  // Text fields
  const [name, setName] = useState(props.name)
  const [address, setAddress] = useState(props.address)
  const [city, setCity] = useState(props.city)
  const [province, setProvince] = useState(props.province)
  const [regNo, setRegNo] = useState(props.registrationNumber)
  const [vat, setVat] = useState(props.vatNumber)
  const [phone, setPhone] = useState(props.phone)
  const [website, setWebsite] = useState(props.website)
  const [signatoryName, setSignatoryName] = useState(props.signatoryName)
  const [signatoryTitle, setSignatoryTitle] = useState(props.signatoryTitle)
  const [accent, setAccent] = useState(props.reportAccentColor || DEFAULT_ACCENT)

  // Save state
  const [isSaving, startSave] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Logo state
  const inputRef = useRef<HTMLInputElement>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(props.logoUrl)
  const [hasLogo, setHasLogo] = useState(props.hasLogo)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  const accentValid = /^#[0-9A-Fa-f]{6}$/.test(accent)
  const previewAccent = accentValid ? accent : DEFAULT_ACCENT

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setSaved(false)
    if (!name.trim()) {
      setSaveError('Organisation name is required.')
      return
    }
    if (accent && !accentValid) {
      setSaveError('Accent colour must be in #RRGGBB format.')
      return
    }

    const input: OrgBrandingInput = {
      name: name.trim(),
      address,
      city,
      province,
      registration_number: regNo,
      vat_number: vat,
      phone,
      website,
      signatory_name: signatoryName,
      signatory_title: signatoryTitle,
      report_accent_color: accent,
    }

    startSave(async () => {
      const result = await updateOrgBrandingAction(input)
      if ('error' in result) {
        setSaveError(result.error)
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    })
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError(null)

    // Client-side guards (server re-validates).
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      setLogoError('Logo must be a PNG or JPEG image.')
      if (inputRef.current) inputRef.current.value = ''
      return
    }

    setLogoBusy(true)
    try {
      const prepared = await compressImage(file)
      if (prepared.size > 5 * 1024 * 1024) {
        setLogoError('Logo must be 5 MB or smaller.')
        return
      }
      const fd = new FormData()
      fd.append('file', prepared)
      const result = await uploadOrgLogoAction(fd)
      if ('error' in result) {
        setLogoError(result.error)
        return
      }
      // Show the just-uploaded file locally (bucket is private).
      setLogoPreview(URL.createObjectURL(prepared))
      setHasLogo(true)
    } catch (err) {
      setLogoError((err as Error).message)
    } finally {
      setLogoBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function handleRemoveLogo() {
    setLogoError(null)
    setLogoBusy(true)
    startSave(async () => {
      const result = await removeOrgLogoAction()
      setLogoBusy(false)
      if ('error' in result) {
        setLogoError(result.error)
        return
      }
      setLogoPreview(null)
      setHasLogo(false)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Letterhead preview ── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Letterhead preview
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Live preview of the header used on generated letters
          </span>
        </CardHeader>
        <CardBody>
          <LetterheadPreview
            name={name || 'Your Organisation'}
            address={[address, city, province].filter(Boolean).join(', ')}
            regNo={regNo}
            vat={vat}
            phone={phone}
            website={website}
            accent={previewAccent}
            logoUrl={logoPreview}
          />
        </CardBody>
      </Card>

      {/* ── Logo ── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Logo
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            PNG or JPEG, max 5 MB
          </span>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div
              role="button"
              tabIndex={logoBusy ? -1 : 0}
              aria-label="Upload organisation logo"
              aria-disabled={logoBusy}
              onClick={() => !logoBusy && inputRef.current?.click()}
              onKeyDown={(e) => {
                if (!logoBusy && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  inputRef.current?.click()
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 132,
                height: 88,
                border: '1px dashed var(--c-border)',
                borderRadius: 6,
                cursor: logoBusy ? 'not-allowed' : 'pointer',
                background: 'var(--c-bg)',
                opacity: logoBusy ? 0.6 : 1,
                overflow: 'hidden',
                fontSize: 12,
                color: 'var(--c-text-dim)',
                textAlign: 'center',
                padding: 6,
              }}
            >
              {logoBusy ? (
                'Working…'
              ) : logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreview}
                  alt="Organisation logo"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : (
                'Click to upload'
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={() => !logoBusy && inputRef.current?.click()}
                disabled={logoBusy}
                style={{
                  fontSize: 12,
                  color: 'var(--c-amber)',
                  background: 'transparent',
                  border: '1px solid var(--c-border)',
                  borderRadius: 6,
                  padding: '7px 14px',
                  cursor: logoBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {hasLogo ? 'Replace logo' : 'Upload logo'}
              </button>
              {hasLogo && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  disabled={logoBusy}
                  style={{
                    fontSize: 12,
                    color: 'var(--c-red)',
                    background: 'transparent',
                    border: '1px solid var(--c-border)',
                    borderRadius: 6,
                    padding: '7px 14px',
                    cursor: logoBusy ? 'not-allowed' : 'pointer',
                  }}
                >
                  Remove logo
                </button>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              onChange={handleLogoChange}
              disabled={logoBusy}
            />
          </div>
          {logoError && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--c-red)', marginTop: 10 }}>
              {logoError}
            </p>
          )}
        </CardBody>
      </Card>

      {/* ── Details form ── */}
      <Card>
        <CardHeader>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>
            Letterhead details
          </span>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
            Company particulars printed on the letterhead
          </span>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="ob-label">Organisation name *</label>
              <input className="ob-input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <label className="ob-label">Address</label>
              <input
                className="ob-input"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="1 Example Street"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="ob-label">City / Town</label>
                <input className="ob-input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Durban" />
              </div>
              <div>
                <label className="ob-label">Province</label>
                <input className="ob-input" value={province} onChange={(e) => setProvince(e.target.value)} placeholder="KwaZulu-Natal" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="ob-label">Registration No.</label>
                <input className="ob-input" value={regNo} onChange={(e) => setRegNo(e.target.value)} placeholder="2024/000000/07" />
              </div>
              <div>
                <label className="ob-label">VAT No.</label>
                <input className="ob-input" value={vat} onChange={(e) => setVat(e.target.value)} placeholder="4000000000" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="ob-label">Phone</label>
                <input className="ob-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 31 000 0000" type="tel" />
              </div>
              <div>
                <label className="ob-label">Website</label>
                <input className="ob-input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" type="url" />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label className="ob-label">Signatory name</label>
                <input className="ob-input" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div>
                <label className="ob-label">Signatory title</label>
                <input className="ob-input" value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} placeholder="Principal Agent" />
              </div>
            </div>

            <div>
              <label className="ob-label">Accent colour</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="color"
                  value={previewAccent}
                  onChange={(e) => setAccent(e.target.value)}
                  aria-label="Accent colour picker"
                  style={{
                    width: 40,
                    height: 32,
                    padding: 2,
                    border: '1px solid var(--c-border)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    background: 'none',
                  }}
                />
                <input
                  type="text"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                  maxLength={7}
                  placeholder="#E69500"
                  aria-label="Accent colour hex"
                  style={{
                    width: 100,
                    padding: '6px 8px',
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    border: '1px solid var(--c-border)',
                    borderRadius: 4,
                    background: 'var(--c-bg)',
                    color: 'var(--c-text)',
                  }}
                />
              </div>
            </div>

            {saveError && <p style={{ color: 'var(--c-red)', fontSize: 12 }}>{saveError}</p>}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="submit"
                disabled={isSaving}
                style={{
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: 'var(--c-amber)',
                  color: 'var(--c-on-amber)',
                  border: 'none',
                  borderRadius: 6,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  opacity: isSaving ? 0.6 : 1,
                }}
              >
                {isSaving ? 'Saving…' : 'Save letterhead'}
              </button>
              {saved && <span style={{ color: 'var(--c-green)', fontSize: 12 }}>Saved!</span>}
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}

// ─── LetterheadPreview ─────────────────────────────────────────────────────────

function LetterheadPreview({
  name,
  address,
  regNo,
  vat,
  phone,
  website,
  accent,
  logoUrl,
}: {
  name: string
  address: string
  regNo: string
  vat: string
  phone: string
  website: string
  accent: string
  logoUrl: string | null
}) {
  const regVat = [regNo && `Reg. ${regNo}`, vat && `VAT ${vat}`].filter(Boolean).join('  ·  ')
  const contact = [phone, website].filter(Boolean).join('  ·  ')

  return (
    <div
      style={{
        background: '#ffffff',
        color: '#1a1a1a',
        borderRadius: 6,
        border: '1px solid var(--c-border)',
        padding: '20px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: accent, lineHeight: 1.2 }}>
            {name}
          </div>
          {address && (
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>{address}</div>
          )}
          {regVat && (
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{regVat}</div>
          )}
          {contact && (
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>{contact}</div>
          )}
        </div>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt="Logo"
            style={{ maxWidth: 120, maxHeight: 60, objectFit: 'contain', flexShrink: 0 }}
          />
        )}
      </div>
      <div style={{ height: 3, background: accent, borderRadius: 2, marginTop: 14 }} />
    </div>
  )
}
