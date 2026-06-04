import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import './AppPasswordGate.css'

const SESSION_KEY = 'app-access-granted'
const expectedPassword = (import.meta.env.VITE_APP_ACCESS_PASSWORD ?? '').trim()

async function accessTokenForPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

type AppPasswordGateProps = {
  children: ReactNode
}

export default function AppPasswordGate({ children }: AppPasswordGateProps) {
  const [ready, setReady] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const verifySession = useCallback(async () => {
    if (!expectedPassword) {
      setUnlocked(false)
      setReady(true)
      return
    }
    const stored = readStoredToken()
    if (!stored) {
      setUnlocked(false)
      setReady(true)
      return
    }
    const expected = await accessTokenForPassword(expectedPassword)
    setUnlocked(stored === expected)
    setReady(true)
  }, [])

  useEffect(() => {
    void verifySession()
  }, [verifySession])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!expectedPassword) return
    setError(null)
    setSubmitting(true)
    try {
      const entered = password.trim()
      if (entered !== expectedPassword) {
        setError('Incorrect password. Try again.')
        return
      }
      const token = await accessTokenForPassword(expectedPassword)
      sessionStorage.setItem(SESSION_KEY, token)
      setUnlocked(true)
      setPassword('')
    } catch {
      setError('Could not verify password. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!ready) {
    return null
  }

  if (!expectedPassword) {
    return (
      <div className="app-password-gate">
        <div className="app-password-gate__card">
          <h1>App access not configured</h1>
          <p>
            Set <code>VITE_APP_ACCESS_PASSWORD</code> in your <code>.env</code> file and rebuild the
            app.
          </p>
        </div>
      </div>
    )
  }

  if (unlocked) {
    return <>{children}</>
  }

  return (
    <div className="app-password-gate">
      <form className="app-password-gate__card" onSubmit={handleSubmit}>
        <h1>Sign in</h1>
        <p className="app-password-gate__hint">Enter the app password to continue.</p>
        <label className="app-password-gate__label" htmlFor="app-password">
          Password
        </label>
        <input
          id="app-password"
          className="app-password-gate__input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          disabled={submitting}
          required
        />
        {error ? <p className="app-password-gate__error">{error}</p> : null}
        <button className="app-password-gate__button" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
