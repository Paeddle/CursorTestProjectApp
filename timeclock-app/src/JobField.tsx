import { useMemo, useState } from 'react'

type JobFieldProps = {
  id?: string
  label?: string
  value: string
  jobs: string[]
  onChange: (value: string) => void
  placeholder?: string
}

export function JobField({
  id = 'job',
  label = 'Job',
  value,
  jobs,
  onChange,
  placeholder = 'Warehouse(8000)',
}: JobFieldProps) {
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const query = value.trim().toLowerCase()
    if (!query) return jobs
    return jobs.filter((job) => job.toLowerCase().includes(query))
  }, [jobs, value])

  return (
    <label className="note job-field">
      {label}
      <div className="job-input-wrap">
        <input
          id={id}
          value={value}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        />
        <button
          type="button"
          className="job-toggle"
          aria-label="Show saved jobs"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
        >
          ▾
        </button>
      </div>
      {open && matches.length > 0 ? (
        <ul className="job-list" role="listbox">
          {matches.map((job) => (
            <li key={job}>
              <button
                type="button"
                role="option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(job)
                  setOpen(false)
                }}
              >
                {job}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  )
}
