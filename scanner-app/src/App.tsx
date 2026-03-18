import { useState, useCallback } from 'react'
import { isSupabaseConfigured, supabase, STORAGE_BUCKET } from './lib/supabase'
import { cropDocumentToBlob } from './lib/documentScanner'
import BarcodeScanner from './components/BarcodeScanner'
import DocumentScanner from './components/DocumentScanner'
import './App.css'

function App() {
  const [poNumber, setPoNumber] = useState('')
  const [manualBarcode, setManualBarcode] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [showDocumentScanner, setShowDocumentScanner] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [docType, setDocType] = useState<'packing_slip' | 'paperwork' | 'other'>('packing_slip')
  const [uploading, setUploading] = useState(false)

  const clearStatus = useCallback(() => {
    setStatus(null)
  }, [])

  const showSuccess = (msg: string) => {
    setStatus({ type: 'success', message: msg })
    setTimeout(clearStatus, 3000)
  }

  const showError = (msg: string) => {
    setStatus({ type: 'error', message: msg })
  }

  const submitBarcode = useCallback(
    async (value: string) => {
      if (!supabase) {
        showError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your host\'s env vars and redeploy.')
        return
      }
      const po = (poNumber || '').trim()
      if (!po) {
        showError('Enter a PO number first')
        return
      }
      const barcode = (value || '').trim()
      if (!barcode) return

      const { error } = await supabase.from('po_barcodes').insert({
        po_number: po,
        barcode_value: barcode,
        scanned_at: new Date().toISOString(),
      })

      if (error) {
        showError(error.message)
        return
      }
      showSuccess(`Barcode saved: ${barcode}`)
      setManualBarcode('')
      setShowCamera(false)
    },
    [poNumber]
  )

  const uploadDocumentBlob = useCallback(
    async (blob: Blob, fileName: string, ext: string) => {
      if (!supabase) {
        showError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your host\'s env vars and redeploy.')
        return
      }
      const po = (poNumber || '').trim()
      if (!po) {
        showError('Enter a PO number first')
        return
      }
      const path = `${po}/${Date.now()}_${docType}.${ext}`
      const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, {
        upsert: false,
      })
      if (uploadError) {
        const msg = uploadError.message || String(uploadError)
        const hint = msg.toLowerCase().includes('bucket') || msg.toLowerCase().includes('not found')
          ? ' Run supabase/create-storage-bucket.sql in Supabase SQL Editor.'
          : ''
        showError(msg + hint)
        return
      }
      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
      const { error: insertError } = await supabase.from('po_documents').insert({
        po_number: po,
        file_url: urlData.publicUrl,
        document_type: docType,
        name: fileName,
        scanned_at: new Date().toISOString(),
      })
      if (insertError) {
        showError(insertError.message)
        return
      }
      showSuccess(`Document saved: ${fileName}`)
    },
    [poNumber, docType]
  )

  const handleDocumentCapture = useCallback(
    async (blob: Blob) => {
      setUploading(true)
      setStatus(null)
      try {
        await uploadDocumentBlob(blob, `scanned_${Date.now()}.jpg`, 'jpg')
        setShowDocumentScanner(false)
      } finally {
        setUploading(false)
      }
    },
    [uploadDocumentBlob]
  )

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const po = (poNumber || '').trim()
    if (!po) {
      showError('Enter a PO number first')
      e.target.value = ''
      return
    }

    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setStatus(null)

    try {
      let blobToUpload: Blob = file
      let ext = file.name.split('.').pop() || 'bin'
      let fileName = file.name

      if (file.type.startsWith('image/')) {
        try {
          const cropped = await cropDocumentToBlob(file)
          if (cropped) {
            blobToUpload = cropped
            ext = 'jpg'
            fileName = file.name.replace(/\.[^.]+$/, '') + '_scanned.jpg'
          }
        } catch (_) {
          // Use original file if crop fails
        }
      }

      await uploadDocumentBlob(blobToUpload, fileName, ext)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>PO Package Scanner</h1>
        <p className="app-subtitle">Scan barcodes and add documents to a PO</p>
      </header>

      <main className="app-main">
        {!isSupabaseConfigured || !supabase ? (
          <section className="section">
            <h2 className="section-title">Setup required</h2>
            <div className="status status-error">
              This deployment is missing Supabase configuration. Add environment variables{' '}
              <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_ANON_KEY</strong> in your host&apos;s
              settings (e.g. <strong>DigitalOcean</strong> App → Settings → App-Level Environment Variables, or{' '}
              <strong>Netlify</strong> Environment Variables), then trigger a new deploy. Without these, barcode and
              document scanning cannot save data.
            </div>
          </section>
        ) : null}

        <section className="section po-section">
          <label className="label">Current PO number</label>
          <input
            type="text"
            className="input po-input"
            placeholder="e.g. PO-12345"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            autoCapitalize="off"
            autoComplete="off"
          />
        </section>

        {status && (
          <div className={`status status-${status.type}`}>
            {status.message}
          </div>
        )}

        <section className="section">
          <h2 className="section-title">Barcode</h2>
          <div className="barcode-actions">
            <input
              type="text"
              className="input barcode-input"
              placeholder="Enter barcode or scan below"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitBarcode(manualBarcode)}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => submitBarcode(manualBarcode)}
              disabled={!manualBarcode.trim()}
            >
              Add barcode
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                if (!isSupabaseConfigured || !supabase) {
                  showError('Configure Supabase first: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your host\'s environment variables (e.g. DigitalOcean or Netlify) and redeploy.')
                  return
                }
                if (!poNumber.trim()) {
                  showError('Enter a PO number first')
                  return
                }
                if (!navigator.mediaDevices?.getUserMedia) {
                  showError(
                    'Camera not available. Browsers require HTTPS (or localhost) for camera access. On phone, open the app via https:// or use it on this computer at localhost.'
                  )
                  return
                }
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                  })
                  stream.getTracks().forEach((t) => t.stop())
                  setShowCamera(true)
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err)
                  if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
                    showError('Camera permission denied. Allow camera access in your browser settings and try again.')
                  } else {
                    showError(msg || 'Could not access camera.')
                  }
                }
              }}
            >
              📷 Scan with camera
            </button>
          </div>
        </section>

        <section className="section">
          <h2 className="section-title">Document (packing slip / paperwork)</h2>
          <div className="doc-actions">
            <select
              className="select doc-type-select"
              value={docType}
              onChange={(e) => setDocType(e.target.value as typeof docType)}
            >
              <option value="packing_slip">Packing slip</option>
              <option value="paperwork">Paperwork</option>
              <option value="other">Other</option>
            </select>
            <label className="btn btn-primary btn-upload">
              {uploading ? 'Uploading…' : 'Choose file'}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="input-hidden"
                onChange={handleDocumentUpload}
                disabled={uploading}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                if (!isSupabaseConfigured || !supabase) {
                  showError('Configure Supabase first: add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your host\'s environment variables (e.g. DigitalOcean or Netlify) and redeploy.')
                  return
                }
                if (!poNumber.trim()) {
                  showError('Enter a PO number first')
                  return
                }
                if (!navigator.mediaDevices?.getUserMedia) {
                  showError(
                    'Camera not available. Browsers require HTTPS (or localhost) for camera access.'
                  )
                  return
                }
                try {
                  const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                  })
                  stream.getTracks().forEach((t) => t.stop())
                  setShowDocumentScanner(true)
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err)
                  if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')) {
                    showError('Camera permission denied. Allow camera access in your browser settings and try again.')
                  } else {
                    showError(msg || 'Could not access camera.')
                  }
                }
              }}
              disabled={uploading}
            >
              📷 Scan with camera
            </button>
          </div>
          <p className="hint">Choose file to pick an image or PDF (images auto-cropped). Or scan with camera to crop to the document.</p>
        </section>
      </main>

      {showCamera && (
        <BarcodeScanner
          onScan={submitBarcode}
          onClose={() => setShowCamera(false)}
        />
      )}

      {showDocumentScanner && (
        <DocumentScanner
          onCapture={handleDocumentCapture}
          onClose={() => setShowDocumentScanner(false)}
        />
      )}
    </div>
  )
}

export default App
