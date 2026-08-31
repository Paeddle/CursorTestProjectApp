/** Bug report submit + list via Supabase REST (no email server). */
;(function () {
  function getSupabaseConfig() {
    var cfg = window.SHS_SUPABASE || {}
    var url = typeof cfg.url === 'string' ? cfg.url.trim() : ''
    var anonKey = typeof cfg.anonKey === 'string' ? cfg.anonKey.trim() : ''
    if (!url || !anonKey) return null
    return { url: url.replace(/\/$/, ''), anonKey: anonKey }
  }

  function supabaseHeaders(cfg, extra) {
    var headers = {
      apikey: cfg.anonKey,
      Authorization: 'Bearer ' + cfg.anonKey,
    }
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) {
          headers[key] = extra[key]
        }
      }
    }
    return headers
  }

  function formatWhen(iso) {
    if (!iso) return ''
    var d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  window.SHSBugReports = {
    isConfigured: function () {
      return getSupabaseConfig() != null
    },

    submit: function (payload) {
      var cfg = getSupabaseConfig()
      if (!cfg) {
        return Promise.reject(new Error('Bug reports are not configured on this server.'))
      }
      var name = String(payload.reporterName || '').trim()
      var comment = String(payload.comment || '').trim()
      if (!name) return Promise.reject(new Error('Enter your name.'))
      if (!comment) return Promise.reject(new Error('Describe the bug.'))

      return fetch(cfg.url + '/rest/v1/bug_reports', {
        method: 'POST',
        headers: supabaseHeaders(cfg, {
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        }),
        body: JSON.stringify({
          reporter_name: name,
          comment: comment,
          page_url: String(payload.pageUrl || window.location.href),
          user_agent: String(payload.userAgent || navigator.userAgent || ''),
        }),
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            var msg = body || res.statusText || 'Could not save bug report.'
            if (/bug_reports|relation|does not exist/i.test(msg)) {
              throw new Error(
                'Bug reports table missing. Run supabase/add-bug-reports.sql in the Supabase SQL Editor.',
              )
            }
            throw new Error(msg)
          })
        }
      })
    },

    fetchRecent: function (limit) {
      var cfg = getSupabaseConfig()
      if (!cfg) {
        return Promise.reject(new Error('Bug reports are not configured on this server.'))
      }
      var max = typeof limit === 'number' ? limit : 100
      var query =
        '/rest/v1/bug_reports?select=id,reporter_name,comment,page_url,created_at&order=created_at.desc&limit=' +
        max

      return fetch(cfg.url + query, {
        headers: supabaseHeaders(cfg),
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            throw new Error(body || res.statusText || 'Could not load bug reports.')
          })
        }
        return res.json()
      })
    },

    formatWhen: formatWhen,
    escapeHtml: escapeHtml,
  }
})()
