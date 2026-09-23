import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sampleFilesPlugin(): Plugin {
  const files: Record<string, { name: string; type: string }> = {
    '/dev-samples/ipoint': { name: 'Item List24.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    '/dev-samples/products': { name: 'Products.csv', type: 'text/csv' },
  }
  return {
    name: 'csvfiles-samples',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = req.url?.split('?')[0] || ''
        const spec = files[key]
        if (!spec) {
          next()
          return
        }
        const filePath = path.join(repoRoot, 'CSVFiles', spec.name)
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          res.end(`Missing ${spec.name} in CSVFiles.`)
          return
        }
        res.setHeader('Content-Type', spec.type)
        res.setHeader('Content-Disposition', `attachment; filename="${spec.name}"`)
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/inventory-transfer/' : '/',
  plugins: [react(), sampleFilesPlugin()],
  server: {
    port: 5181,
    host: true,
    fs: { allow: [repoRoot] },
  },
})
