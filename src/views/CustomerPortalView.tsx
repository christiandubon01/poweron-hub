/**
 * CustomerPortalView.tsx
 * Public-facing Power On Solutions Customer Portal
 * Route: /portal  /request
 * No auth required — Phase 1
 *
 * Features:
 *   - Real logo in nav
 *   - Google Places Autocomplete on address field
 *   - Phone auto-format (XXX) XXX-XXXX
 *   - Flexible time toggle (1-2 extra time slots)
 *   - Photo/video upload → Supabase Storage portal-uploads bucket
 *   - GC tab: PDF upload up to 256MB with real PDF validation
 *   - GC tab: Ideal date field
 *   - Direct REST API insert (bypasses auth session for mobile)
 */

import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { GOOGLE_MAPS_BROWSER_KEY, loadV15rGoogleMapsScript } from '@/utils/googleMapsLoader'

const LOGO_URL = 'https://edxxbtyugohtowvslbfo.supabase.co/storage/v1/object/public/brand-assets/ChatGPT%20Image%20Jan%2030,%202026,%2010_40_53%20AM1.png'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

type Tab = 'homeowner' | 'gc'

type FormState = {
  name: string
  phone: string
  email: string
  address: string
  city: string
  service_category: string
  description: string
  preferred_date: string
  preferred_time: string
  preferred_time_2: string
  preferred_time_3: string
  company: string
  ideal_date: string
}

const BLANK: FormState = {
  name: '', phone: '', email: '', address: '', city: '',
  service_category: '', description: '', preferred_date: '',
  preferred_time: '', preferred_time_2: '', preferred_time_3: '',
  company: '', ideal_date: '',
}

const SERVICE_CATEGORIES = [
  { value: 'residential',   label: 'Residential' },
  { value: 'commercial',    label: 'Commercial' },
  { value: 'solar',         label: 'Solar / PV' },
  { value: 'maintenance',   label: 'Maintenance & Service' },
  { value: 'panel_upgrade', label: 'Panel Upgrade' },
  { value: 'ev_charger',    label: 'EV Charger Installation' },
  { value: 'other',         label: 'Other' },
]

const TIME_SLOTS = [
  'Morning (8am – 12pm)',
  'Afternoon (12pm – 4pm)',
  'Evening (4pm – 7pm)',
  'Flexible',
]

const MAX_MEDIA_SIZE = 100 * 1024 * 1024  // 100MB per file
const MAX_PDF_SIZE   = 256 * 1024 * 1024 // 256MB

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');

  .pr {
    --green:   #6ccb3f;
    --green-2: #1c7b36;
    --gold:    #ffd222;
    --white:   #f7f8ef;
    --muted:   #b8c3b4;
    --muted-2: #778372;
    --panel:   rgba(10, 18, 14, 0.72);
    --line:    rgba(255, 255, 255, 0.11);
    --shadow:  0 28px 80px rgba(0,0,0,.48);
    --radius:  24px;
    --ease:    cubic-bezier(.2,.75,.18,1);
    min-height: 100vh;
    background:
      radial-gradient(circle at 20% 0%, rgba(108,203,63,.14), transparent 28%),
      radial-gradient(circle at 85% 12%, rgba(255,210,34,.08), transparent 26%),
      radial-gradient(circle at 65% 85%, rgba(28,123,54,.12), transparent 26%),
      linear-gradient(180deg, #010201 0%, #030604 38%, #061007 100%);
    color: var(--white);
    font-family: "Plus Jakarta Sans", "Manrope", ui-sans-serif, system-ui, sans-serif;
    overflow-x: hidden;
    position: relative;
  }
  .pr-grain {
    position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .18;
    background-image: linear-gradient(rgba(255,255,255,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px);
    background-size: 52px 52px;
    mask-image: linear-gradient(to bottom, black, transparent 92%);
  }
  .pr-nav {
    position: sticky; top: 0; z-index: 50;
    backdrop-filter: blur(22px); background: rgba(1,3,2,.82);
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .pr-nav-inner {
    width: min(1240px, calc(100vw - 40px)); margin: 0 auto;
    height: 78px; display: flex; align-items: center;
    justify-content: space-between; gap: 24px; position: relative; z-index: 2;
  }
  .pr-logo { height: 48px; width: auto; object-fit: contain; display: block; }
  .pr-phone { font-size: 14px; font-weight: 700; color: var(--green); text-decoration: none; transition: color .2s; }
  .pr-phone:hover { color: var(--gold); }
  .pr-body { width: min(640px, calc(100vw - 32px)); margin: 0 auto; padding: 52px 0 72px; position: relative; z-index: 2; }
  .pr-eyebrow { display: inline-flex; align-items: center; gap: 10px; color: var(--green); font-weight: 800; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; margin-bottom: 18px; }
  .pr-eyebrow::before { content: "⚡"; color: var(--gold); font-size: 14px; }
  .pr-eyebrow::after { content: ""; width: 70px; height: 1px; background: linear-gradient(90deg, var(--green), transparent); }
  .pr-h1 { font-size: clamp(36px, 6vw, 56px); font-weight: 800; line-height: .96; letter-spacing: -.04em; margin: 0 0 18px; }
  .pr-h1 .gold { color: var(--gold); }
  .pr-sub { font-size: 16px; color: var(--muted); line-height: 1.65; max-width: 520px; margin-bottom: 32px; }
  .pr-badges { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 36px; }
  .pr-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 14px; border-radius: 30px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); font-size: 12px; font-weight: 600; color: var(--muted); }
  .pr-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px rgba(108,203,63,.6); flex-shrink: 0; }
  .pr-tabs { display: flex; gap: 0; background: rgba(255,255,255,.04); border-radius: 16px; border: 1px solid rgba(255,255,255,.08); padding: 5px; margin-bottom: 24px; }
  .pr-tab { flex: 1; padding: 11px 16px; border-radius: 11px; border: none; cursor: pointer; font-family: "Plus Jakarta Sans","Manrope",sans-serif; font-weight: 800; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; transition: all .25s var(--ease); background: transparent; color: var(--muted-2); }
  .pr-tab.active { background: linear-gradient(135deg, var(--green-2), #0f5225); color: var(--white); border: 1px solid rgba(108,203,63,.4); box-shadow: 0 4px 18px rgba(108,203,63,.22), inset 0 1px 0 rgba(255,255,255,.12); }
  .pr-card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 36px; backdrop-filter: blur(16px); box-shadow: var(--shadow); position: relative; overflow: hidden; }
  .pr-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(108,203,63,.3), rgba(255,210,34,.2), transparent); }
  .pr-gc-box { background: rgba(108,203,63,.06); border: 1px solid rgba(108,203,63,.18); border-radius: 16px; padding: 20px 24px; margin-bottom: 28px; }
  .pr-gc-title { font-size: 14px; font-weight: 800; color: var(--green); margin-bottom: 10px; }
  .pr-gc-box ul { font-size: 13px; color: var(--muted); line-height: 1.9; margin: 0; padding-left: 18px; }
  .pr-section { font-size: 10px; font-weight: 800; letter-spacing: .18em; color: var(--green); text-transform: uppercase; margin: 28px 0 14px; display: flex; align-items: center; gap: 10px; }
  .pr-section::after { content: ""; flex: 1; height: 1px; background: linear-gradient(90deg, rgba(108,203,63,.3), transparent); }
  .pr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .pr-full { grid-column: 1 / -1; }
  .pr-field { display: flex; flex-direction: column; gap: 7px; position: relative; }
  .pr-label { font-size: 11px; font-weight: 700; letter-spacing: .07em; color: var(--muted-2); text-transform: uppercase; }
  .pr-req { color: var(--gold); margin-left: 2px; }
  .pr-input, .pr-select, .pr-textarea {
    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
    border-radius: 12px; padding: 11px 15px;
    font-size: 14px; font-weight: 500; color: var(--white);
    outline: none; width: 100%; box-sizing: border-box;
    font-family: "Plus Jakarta Sans","Manrope",sans-serif;
    transition: border-color .2s, background .2s, box-shadow .2s;
    -webkit-appearance: none; appearance: none;
  }
  .pr-input:focus, .pr-select:focus, .pr-textarea:focus { border-color: rgba(108,203,63,.5); background: rgba(255,255,255,.07); box-shadow: 0 0 0 3px rgba(108,203,63,.1); }
  .pr-input::placeholder, .pr-textarea::placeholder { color: var(--muted-2); opacity: 1; }
  .pr-textarea { min-height: 110px; resize: vertical; }
  .pr-select { cursor: pointer; }
  .pr-select option { background: #07100a; }

  /* Address autocomplete dropdown */
  .pr-autocomplete-list {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
    background: #0d1f0d; border: 1px solid rgba(108,203,63,.3);
    border-top: none; border-radius: 0 0 12px 12px;
    max-height: 200px; overflow-y: auto;
  }
  .pr-autocomplete-item {
    padding: 10px 15px; font-size: 13px; color: var(--white); cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,.05); transition: background .15s;
  }
  .pr-autocomplete-item:last-child { border-bottom: none; }
  .pr-autocomplete-item:hover { background: rgba(108,203,63,.12); }

  /* Toggle */
  .pr-toggle-row { display: flex; align-items: center; gap: 10px; margin: 4px 0 12px; cursor: pointer; user-select: none; }
  .pr-toggle { width: 36px; height: 20px; border-radius: 10px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.15); position: relative; transition: background .2s; flex-shrink: 0; }
  .pr-toggle.on { background: var(--green-2); border-color: var(--green); }
  .pr-toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,.5); transition: transform .2s, background .2s; }
  .pr-toggle.on::after { transform: translateX(16px); background: #fff; }
  .pr-toggle-label { font-size: 12px; color: var(--muted); font-weight: 600; }

  /* Upload area */
  .pr-upload-area {
    border: 2px dashed rgba(255,255,255,.12); border-radius: 12px;
    padding: 24px; text-align: center; cursor: pointer;
    transition: border-color .2s, background .2s;
    background: rgba(255,255,255,.02);
  }
  .pr-upload-area:hover, .pr-upload-area.drag { border-color: rgba(108,203,63,.4); background: rgba(108,203,63,.05); }
  .pr-upload-icon { font-size: 28px; margin-bottom: 8px; }
  .pr-upload-text { font-size: 13px; color: var(--muted); line-height: 1.5; }
  .pr-upload-hint { font-size: 11px; color: var(--muted-2); margin-top: 4px; }
  .pr-file-list { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
  .pr-file-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); font-size: 12px; }
  .pr-file-name { flex: 1; truncate: true; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--white); }
  .pr-file-size { color: var(--muted-2); flex-shrink: 0; }
  .pr-file-remove { color: var(--muted-2); cursor: pointer; flex-shrink: 0; font-size: 16px; line-height: 1; padding: 0 2px; }
  .pr-file-remove:hover { color: #fca5a5; }
  .pr-file-valid { color: var(--green); flex-shrink: 0; }
  .pr-file-invalid { color: #fca5a5; flex-shrink: 0; }

  /* Upload progress */
  .pr-upload-progress { height: 3px; background: rgba(255,255,255,.08); border-radius: 2px; margin-top: 8px; overflow: hidden; }
  .pr-upload-progress-bar { height: 100%; background: linear-gradient(90deg, var(--green), var(--gold)); border-radius: 2px; transition: width .3s; }

  .pr-btn-gold {
    width: 100%; margin-top: 28px; min-height: 52px; padding: 0 24px;
    border-radius: 14px; border: none; cursor: pointer;
    font-family: "Plus Jakarta Sans","Manrope",sans-serif;
    font-weight: 850; font-size: 15px; letter-spacing: .02em; color: #111307;
    background: linear-gradient(135deg, #ffe75c, #ffc20f 48%, #d88905);
    box-shadow: 0 14px 34px rgba(255,210,34,.2), inset 0 1px 0 rgba(255,255,255,.55);
    transition: transform .24s var(--ease), box-shadow .24s var(--ease);
    position: relative; overflow: hidden;
  }
  .pr-btn-gold::before { content: ""; position: absolute; top: -80%; left: -40%; width: 32%; height: 240%; background: rgba(255,255,255,.55); transform: rotate(25deg) translateX(-160%); transition: transform .7s var(--ease); }
  .pr-btn-gold:hover::before { transform: rotate(25deg) translateX(520%); }
  .pr-btn-gold:hover { transform: translateY(-2px); box-shadow: 0 20px 50px rgba(255,210,34,.3); }
  .pr-btn-gold:disabled { opacity: .5; cursor: not-allowed; transform: none !important; }
  .pr-btn-ghost { padding: 11px 30px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.14); color: var(--white); font-size: 14px; font-weight: 600; cursor: pointer; transition: all .22s var(--ease); font-family: "Plus Jakarta Sans","Manrope",sans-serif; }
  .pr-btn-ghost:hover { background: rgba(255,255,255,.09); border-color: rgba(108,203,63,.45); transform: translateY(-2px); }
  .pr-error { background: rgba(220,38,38,.1); border: 1px solid rgba(220,38,38,.25); border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #fca5a5; margin-top: 16px; }
  .pr-consent { font-size: 12px; color: var(--muted-2); text-align: center; margin-top: 16px; line-height: 1.6; }

  .pr-success { text-align: center; padding: 72px 24px; }
  .pr-success-icon { width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(135deg, var(--green), var(--green-2)); display: grid; place-items: center; font-size: 36px; margin: 0 auto 28px; box-shadow: 0 8px 40px rgba(108,203,63,.3); animation: pr-pop .4s var(--ease) both; }
  .pr-success-title { font-size: clamp(32px, 6vw, 48px); font-weight: 800; line-height: 1; letter-spacing: -.03em; margin-bottom: 16px; }
  .pr-success-sub { font-size: 16px; color: var(--muted); line-height: 1.65; max-width: 440px; margin: 0 auto 32px; }
  .pr-success-chip { display: inline-flex; align-items: center; gap: 10px; padding: 12px 24px; border-radius: 14px; background: rgba(108,203,63,.08); border: 1px solid rgba(108,203,63,.2); font-size: 13px; color: var(--green); font-weight: 600; margin-bottom: 32px; }
  .pr-track-link { display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: 12px; background: linear-gradient(135deg, var(--green-2), #0f5225); color: var(--white); font-size: 15px; font-weight: 700; text-decoration: none; margin-bottom: 16px; border: 1px solid rgba(108,203,63,.4); box-shadow: 0 4px 20px rgba(108,203,63,.25); transition: all .22s var(--ease); }
  .pr-track-link:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(108,203,63,.35); }
  .pr-track-url { font-size: 11px; color: var(--muted-2); font-family: monospace; margin-bottom: 28px; word-break: break-all; padding: 0 16px; }
  .pr-footer { text-align: center; padding: 22px 24px; border-top: 1px solid rgba(255,255,255,.06); font-size: 12px; color: var(--muted-2); position: relative; z-index: 2; }
  .pr-footer a { color: var(--green); text-decoration: none; }
  .pr-footer a:hover { color: var(--gold); }

  @keyframes pr-pop { 0% { transform: scale(.7); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); } }
  @media (max-width: 520px) { .pr-grid { grid-template-columns: 1fr; } .pr-full { grid-column: 1; } .pr-card { padding: 22px 16px; } .pr-body { padding: 36px 0 60px; } }
`

function injectStyles() {
  if (document.getElementById('pr-styles')) return
  const s = document.createElement('style')
  s.id = 'pr-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

// ── Phone formatter ───────────────────────────────────────────────────────────
function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// ── Google Places loader ──────────────────────────────────────────────────────
function loadPlaces(cb: () => void) {
  void loadV15rGoogleMapsScript().then(cb).catch(() => {})
}

// ── Address Autocomplete ──────────────────────────────────────────────────────
function AddressAutocomplete({
  value, onChange, onSelect, placeholder,
}: {
  value: string
  onChange: (val: string) => void
  onSelect: (address: string, city: string) => void
  placeholder: string
}) {
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showList, setShowList] = useState(false)
  const sessionToken = useRef<any>(null)
  const service = useRef<any>(null)
  const debounce = useRef<any>(null)

  useEffect(() => {
    if (!GOOGLE_MAPS_BROWSER_KEY) return
    const initService = () => {
      const google = (window as any).google
      if (!google?.maps?.places) return
      service.current = new google.maps.places.AutocompleteService()
      sessionToken.current = new google.maps.places.AutocompleteSessionToken()
    }
    if ((window as any).google?.maps?.places) {
      initService()
    } else {
      loadPlaces(initService)
    }
  }, [])

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    if (!val || val.length < 3) { setSuggestions([]); setShowList(false); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      if (!service.current) return
      service.current.getPlacePredictions(
        { input: val, componentRestrictions: { country: 'us' }, sessionToken: sessionToken.current },
        (results: any, status: any) => {
          if (status === 'OK' && results) { setSuggestions(results); setShowList(true) }
          else { setSuggestions([]); setShowList(false) }
        }
      )
    }, 200)
  }

  const handleSelect = (prediction: any) => {
    const google = (window as any).google
    const placesService = new google.maps.places.PlacesService(document.createElement('div'))
    placesService.getDetails(
      { placeId: prediction.place_id, fields: ['address_components', 'formatted_address'], sessionToken: sessionToken.current },
      (place: any, status: any) => {
        if (status !== 'OK' || !place) return
        let streetNumber = '', route = '', city = ''
        for (const comp of place.address_components) {
          if (comp.types.includes('street_number')) streetNumber = comp.long_name
          if (comp.types.includes('route')) route = comp.long_name
          if (comp.types.includes('locality')) city = comp.long_name
        }
        const address = [streetNumber, route].filter(Boolean).join(' ')
        onSelect(address, city)
        setSuggestions([])
        setShowList(false)
        sessionToken.current = new google.maps.places.AutocompleteSessionToken()
      }
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="pr-input"
        value={value}
        onChange={handleInput}
        onBlur={() => setTimeout(() => setShowList(false), 200)}
        onFocus={() => suggestions.length > 0 && setShowList(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {showList && suggestions.length > 0 && (
        <div className="pr-autocomplete-list">
          {suggestions.map((s) => (
            <div key={s.place_id} className="pr-autocomplete-item" onMouseDown={() => handleSelect(s)}>
              📍 {s.description}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── File upload helpers ───────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function isPdfValid(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const arr = new Uint8Array(e.target?.result as ArrayBuffer)
      // Check PDF magic bytes: %PDF
      const isPdf = arr[0] === 0x25 && arr[1] === 0x50 && arr[2] === 0x44 && arr[3] === 0x46
      resolve(isPdf)
    }
    reader.readAsArrayBuffer(file.slice(0, 4))
  })
}

interface UploadedFile {
  file: File
  valid: boolean
  error?: string
}

// ── Field component ───────────────────────────────────────────────────────────
function Field({ label, required, children, full }: {
  label: string; required?: boolean; children: React.ReactNode; full?: boolean
}) {
  return (
    <div className={`pr-field${full ? ' pr-full' : ''}`}>
      <label className="pr-label">{label}{required && <span className="pr-req">*</span>}</label>
      {children}
    </div>
  )
}

// ── Upload area component ─────────────────────────────────────────────────────
function UploadArea({
  files, onAdd, onRemove, accept, maxSize, hint, multiple = true,
}: {
  files: UploadedFile[]
  onAdd: (files: UploadedFile[]) => void
  onRemove: (idx: number) => void
  accept: string
  maxSize: number
  hint: string
  multiple?: boolean
}) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const processFiles = async (rawFiles: File[]) => {
    const results: UploadedFile[] = []
    for (const file of rawFiles) {
      if (file.size > maxSize) {
        results.push({ file, valid: false, error: `Too large (max ${formatBytes(maxSize)})` })
        continue
      }
      if (file.type === 'application/pdf') {
        const valid = await isPdfValid(file)
        results.push({ file, valid, error: valid ? undefined : 'Invalid PDF file' })
      } else {
        results.push({ file, valid: true })
      }
    }
    onAdd(results)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  return (
    <div className="pr-full">
      <label className="pr-label">Attachments</label>
      <div
        className={`pr-upload-area${drag ? ' drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="pr-upload-icon">📎</div>
        <div className="pr-upload-text">Drag & drop or click to upload</div>
        <div className="pr-upload-hint">{hint}</div>
        <input
          ref={inputRef} type="file" accept={accept}
          multiple={multiple} style={{ display: 'none' }}
          onChange={(e) => processFiles(Array.from(e.target.files ?? []))}
        />
      </div>
      {files.length > 0 && (
        <div className="pr-file-list">
          {files.map((f, i) => (
            <div key={i} className="pr-file-item">
              <span className={f.valid ? 'pr-file-valid' : 'pr-file-invalid'}>
                {f.valid ? '✓' : '✗'}
              </span>
              <span className="pr-file-name">{f.file.name}</span>
              <span className="pr-file-size">{formatBytes(f.file.size)}</span>
              {f.error && <span style={{ color: '#fca5a5', fontSize: 11 }}>{f.error}</span>}
              <span className="pr-file-remove" onClick={(e) => { e.stopPropagation(); onRemove(i) }}>×</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CustomerPortalView() {
  useEffect(() => { injectStyles() }, [])

  const [tab, setTab] = useState<Tab>('homeowner')
  const [form, setForm] = useState<FormState>(BLANK)
  const [loading, setLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [showTime2, setShowTime2] = useState(false)
  const [showTime3, setShowTime3] = useState(false)
  const [mediaFiles, setMediaFiles] = useState<UploadedFile[]>([])
  const [pdfFiles, setPdfFiles] = useState<UploadedFile[]>([])

  const setF = (key: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [key]: e.target.value }))

  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, phone: formatPhone(e.target.value) }))
  }

  const handleAddressSelect = (address: string, city: string) => {
    setForm(prev => ({ ...prev, address, city }))
  }

  // Upload files to Supabase Storage
  const uploadFiles = async (requestId: string): Promise<string[]> => {
    const allFiles = [
      ...mediaFiles.filter(f => f.valid),
      ...pdfFiles.filter(f => f.valid),
    ]
    if (allFiles.length === 0) return []

    const urls: string[] = []
    let done = 0

    for (const { file } of allFiles) {
      const path = `${requestId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error } = await supabase.storage
        .from('portal-uploads')
        .upload(path, file, { cacheControl: '3600', upsert: false })

      if (!error) {
        const { data } = supabase.storage.from('portal-uploads').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
      done++
      setUploadProgress(Math.round((done / allFiles.length) * 100))
    }
    return urls
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Please enter your name.'); return }
    if (!form.phone.trim() && !form.email.trim()) { setError('Please enter a phone number or email.'); return }
    if (!form.service_category) { setError('Please select a service category.'); return }

    const invalidFiles = [...mediaFiles, ...pdfFiles].filter(f => !f.valid)
    if (invalidFiles.length > 0) { setError('Please remove invalid files before submitting.'); return }

    setLoading(true)
    setError(null)
    setUploadProgress(0)

    try {
      // Build preferred times string
      const times = [form.preferred_time, form.preferred_time_2, form.preferred_time_3]
        .filter(Boolean).join(' / ')

      const payload: Record<string, any> = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        service_category: form.service_category,
        description: form.description.trim() || null,
        preferred_date: form.preferred_date || null,
        preferred_time: times || null,
        request_type: tab === 'gc' ? 'gc' : 'homeowner',
        source: 'customer_portal',
        status: 'new',
      }

      if (tab === 'gc') {
        const noteParts = []
        if (form.company.trim()) noteParts.push(`Company: ${form.company.trim()}`)
        if (form.ideal_date) noteParts.push(`Ideal date: ${form.ideal_date}`)
        if (noteParts.length) payload.notes = noteParts.join(' | ')
      }

      // Insert via direct REST API (bypasses auth session for mobile compatibility)
      const { data, error: dbError } = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(payload),
      }).then(async (res) => {
        const json = await res.json()
        if (!res.ok) return { data: null, error: json }
        return { data: Array.isArray(json) ? json[0] : json, error: null }
      })

      if (dbError || !data?.id) {
        setError('Something went wrong. Please try again or call us at (760) 623-8962.')
        return
      }

      // Upload files if any
      if (mediaFiles.length > 0 || pdfFiles.length > 0) {
        const fileUrls = await uploadFiles(data.id)
        if (fileUrls.length > 0) {
          // Update the request with file URLs
          await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${data.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ notes: (payload.notes ? payload.notes + ' | ' : '') + `Files: ${fileUrls.join(', ')}` }),
          })
        }
      }

      setSubmittedId(data.id)
      setSubmitted(true)

      // Send confirmation email (fire and forget)
      if (form.email.trim()) {
        fetch('/.netlify/functions/portal-schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'send_submission_confirmation',
            customerEmail: form.email.trim(),
            customerName: form.name.trim(),
            requestId: data.id,
            serviceCategory: form.service_category,
          }),
        }).catch(err => console.error('Email error:', err))
      }
    } catch (err: any) {
      setError('Unexpected error. Please try again.')
      console.error(err)
    } finally {
      setLoading(false)
      setUploadProgress(0)
    }
  }

  const reset = () => {
    setForm(BLANK); setSubmitted(false); setSubmittedId(null)
    setError(null); setMediaFiles([]); setPdfFiles([])
    setShowTime2(false); setShowTime3(false)
  }

  const trackingUrl = submittedId ? `${window.location.origin}/portal/track/${submittedId}` : null
  const hasUploads = mediaFiles.length > 0 || pdfFiles.length > 0
  const uploadsDone = uploadProgress === 100

  return (
    <div className="pr">
      <div className="pr-grain" />

      <nav className="pr-nav">
        <div className="pr-nav-inner">
          <img src={LOGO_URL} alt="Power On Solutions LLC" className="pr-logo" />
          <a href="tel:17606238962" className="pr-phone">(760) 623-8962</a>
        </div>
      </nav>

      <div className="pr-body">
        {submitted ? (
          <div className="pr-success">
            <div className="pr-success-icon">✓</div>
            <div className="pr-success-title">
              Request <span style={{ color: 'var(--gold)' }}>Received</span>
            </div>
            <p className="pr-success-sub">
              We'll review your request and reach out within 1 business day.
              Track your request status using the link below.
            </p>
            {trackingUrl && (
              <>
                <div style={{ marginBottom: 8 }}>
                  <a href={trackingUrl} className="pr-track-link">⚡ Track My Request →</a>
                </div>
                <div className="pr-track-url">{trackingUrl}</div>
              </>
            )}
            <div className="pr-success-chip">
              <span>📧</span>
              <span>{form.email ? 'Check your email for your tracking link' : 'Bookmark the tracking link above'}</span>
            </div>
            <button className="pr-btn-ghost" onClick={reset}>Submit another request</button>
          </div>
        ) : (
          <>
            <div className="pr-eyebrow">Coachella Valley Electrical</div>
            <h1 className="pr-h1">Request <span className="gold">Electrical</span><br />Service</h1>
            <p className="pr-sub">Residential, commercial, solar, and maintenance. Licensed, insured, and built around the Coachella Valley. No-obligation estimates.</p>
            <div className="pr-badges">
              <span className="pr-badge"><span className="pr-dot" />Fast response</span>
              <span className="pr-badge"><span className="pr-dot" />C-10 Licensed & Insured</span>
              <span className="pr-badge"><span className="pr-dot" />Coachella Valley based</span>
            </div>

            <div className="pr-tabs">
              <button className={`pr-tab${tab === 'homeowner' ? ' active' : ''}`} onClick={() => setTab('homeowner')}>🏠 Homeowner</button>
              <button className={`pr-tab${tab === 'gc' ? ' active' : ''}`} onClick={() => setTab('gc')}>🏗️ GC / Sub-Contractor</button>
            </div>

            <div className="pr-card">
              {tab === 'gc' && (
                <div className="pr-gc-box">
                  <div className="pr-gc-title">⚡ General Contractor & Sub-Contractor RFQ</div>
                  <ul>
                    <li>C-10 Electrical License #1151468 — available for bid</li>
                    <li>Commercial, residential, and solar projects</li>
                    <li>Crew capacity and certifications available on request</li>
                    <li>We respond within 1 business day</li>
                  </ul>
                </div>
              )}

              {/* Contact */}
              <div className="pr-section">Contact Information</div>
              <div className="pr-grid">
                <Field label="Full Name" required>
                  <input className="pr-input" value={form.name} onChange={setF('name')} placeholder="Your name" />
                </Field>
                {tab === 'gc' ? (
                  <Field label="Company">
                    <input className="pr-input" value={form.company} onChange={setF('company')} placeholder="Company name" />
                  </Field>
                ) : (
                  <Field label="Phone">
                    <input className="pr-input" type="tel" value={form.phone} onChange={handlePhone} placeholder="(760) 000-0000" />
                  </Field>
                )}
                {tab === 'gc' && (
                  <Field label="Phone">
                    <input className="pr-input" type="tel" value={form.phone} onChange={handlePhone} placeholder="(760) 000-0000" />
                  </Field>
                )}
                <Field label="Email">
                  <input className="pr-input" type="email" value={form.email} onChange={setF('email')} placeholder="you@email.com" />
                </Field>
              </div>

              {/* Location */}
              <div className="pr-section">Service Location</div>
              <div className="pr-grid">
                <Field label="Street Address" full>
                  <AddressAutocomplete
                    value={form.address}
                    onChange={(val) => setForm(prev => ({ ...prev, address: val }))}
                    onSelect={handleAddressSelect}
                    placeholder="Start typing your address..."
                  />
                </Field>
                <Field label="City">
                  <input className="pr-input" value={form.city} onChange={setF('city')} placeholder="e.g. Palm Springs" />
                </Field>
              </div>

              {/* Service */}
              <div className="pr-section">Service Details</div>
              <div className="pr-grid">
                <Field label="Service Category" required>
                  <select className="pr-select" value={form.service_category} onChange={setF('service_category')}>
                    <option value="">Select a category</option>
                    {SERVICE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                {tab === 'homeowner' && (
                  <Field label="Preferred Date">
                    <input className="pr-input" type="date" value={form.preferred_date} onChange={setF('preferred_date')} />
                  </Field>
                )}
                {tab === 'gc' && (
                  <Field label="Ideal Date">
                    <input className="pr-input" type="date" value={form.ideal_date} onChange={setF('ideal_date')} />
                  </Field>
                )}
              </div>

              {/* Time preference */}
              <div className="pr-grid">
                <Field label="Preferred Time">
                  <select className="pr-select" value={form.preferred_time} onChange={setF('preferred_time')}>
                    <option value="">Any time</option>
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </div>

              {/* Flexible time toggle */}
              <div className="pr-toggle-row" onClick={() => { setShowTime2(!showTime2); if (showTime2) { setShowTime3(false); setForm(p => ({ ...p, preferred_time_2: '', preferred_time_3: '' })) } }}>
                <div className={`pr-toggle${showTime2 ? ' on' : ''}`} />
                <span className="pr-toggle-label">Add alternative time preferences</span>
              </div>

              {showTime2 && (
                <>
                  <div className="pr-grid">
                    <Field label="Alternative Time 1">
                      <select className="pr-select" value={form.preferred_time_2} onChange={setF('preferred_time_2')}>
                        <option value="">Select time</option>
                        {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Field>
                    <Field label="Alternative Time 2">
                      <select className="pr-select" value={form.preferred_time_3} onChange={setF('preferred_time_3')} disabled={!showTime3} style={{ opacity: showTime3 ? 1 : 0.3 }}>
                        <option value="">Select time</option>
                        {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="pr-toggle-row" onClick={() => { setShowTime3(!showTime3); if (showTime3) setForm(p => ({ ...p, preferred_time_3: '' })) }}>
                    <div className={`pr-toggle${showTime3 ? ' on' : ''}`} />
                    <span className="pr-toggle-label">Enable second alternative time</span>
                  </div>
                </>
              )}

              {/* Description */}
              <div className="pr-grid">
                <Field label={tab === 'gc' ? 'Project Scope / Description' : 'Describe the Issue'} full>
                  <textarea
                    className="pr-textarea" value={form.description} onChange={setF('description')}
                    placeholder={tab === 'gc' ? 'Scope, timeline, special requirements, trade coordination...' : 'What electrical issue are you experiencing? Any details help us prepare...'}
                  />
                </Field>
              </div>

              {/* File uploads */}
              <div className="pr-section">
                {tab === 'gc' ? 'Project Documents' : 'Photos & Videos'}
              </div>
              <div className="pr-grid">
                {tab === 'homeowner' ? (
                  <UploadArea
                    files={mediaFiles}
                    onAdd={(newFiles) => setMediaFiles(prev => [...prev, ...newFiles])}
                    onRemove={(idx) => setMediaFiles(prev => prev.filter((_, i) => i !== idx))}
                    accept="image/*,video/*"
                    maxSize={MAX_MEDIA_SIZE}
                    hint="Photos or videos up to 100MB each · JPG, PNG, MP4, MOV"
                  />
                ) : (
                  <UploadArea
                    files={pdfFiles}
                    onAdd={(newFiles) => setPdfFiles(prev => [...prev, ...newFiles])}
                    onRemove={(idx) => setPdfFiles(prev => prev.filter((_, i) => i !== idx))}
                    accept="application/pdf,image/png,image/jpeg,video/mp4"
                    maxSize={MAX_PDF_SIZE}
                    hint="PDF, PNG, JPG, JPEG, MP4 · Up to 256MB each"
                  />
                )}
              </div>

              {/* Upload progress */}
              {loading && hasUploads && uploadProgress > 0 && uploadProgress < 100 && (
                <div className="pr-upload-progress">
                  <div className="pr-upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                </div>
              )}

              {error && <div className="pr-error">{error}</div>}

              <button className="pr-btn-gold" onClick={handleSubmit} disabled={loading}>
                {loading
                  ? (hasUploads && uploadProgress > 0 ? `Uploading… ${uploadProgress}%` : 'Submitting…')
                  : tab === 'gc' ? '⚡ Submit RFQ' : '⚡ Request My Estimate'}
              </button>

              <p className="pr-consent">By submitting you agree to be contacted by Power On Solutions LLC. Your information is never shared or sold.</p>
            </div>
          </>
        )}
      </div>

      <footer className="pr-footer">
        © {new Date().getFullYear()} Power On Solutions LLC &nbsp;·&nbsp;
        C-10 Electrical License #1151468 &nbsp;·&nbsp;
        Desert Hot Springs, CA &nbsp;·&nbsp;
        <a href="tel:17606238962">(760) 623-8962</a>
      </footer>
    </div>
  )
}
