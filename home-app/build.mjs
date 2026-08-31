import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, 'dist')
const staticFiles = ['index.html', 'styles.css', 'auth.js', 'bug-reports.js', 'config.js']

fs.mkdirSync(distDir, { recursive: true })

for (const file of staticFiles) {
  fs.copyFileSync(path.join(__dirname, file), path.join(distDir, file))
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || ''

const configJs = `/** Generated at build time — do not edit dist/config.js by hand. */
window.SHS_SUPABASE = {
  url: ${JSON.stringify(supabaseUrl)},
  anonKey: ${JSON.stringify(supabaseAnonKey)},
}
`

fs.writeFileSync(path.join(distDir, 'config.js'), configJs, 'utf8')
