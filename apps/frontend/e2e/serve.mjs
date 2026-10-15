// Serve only the built static SPA, with the same shell fallback as nginx.conf.
// This is a test helper, not a replacement for the production nginx server.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const root = resolve('dist/client')
await readFile(resolve(root, '_shell.html')) // Fail early if no build exists.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }

createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const file = resolve(root, `.${pathname}`)
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(404).end()
      return
    }
    let body
    let extension = extname(file)
    try {
      body = await readFile(file)
    } catch {
      if (pathname.startsWith('/assets/')) {
        res.writeHead(404).end()
        return
      }
      body = await readFile(resolve(root, '_shell.html'))
      extension = '.html'
    }
    res.writeHead(200, { 'Content-Type': types[extension] ?? 'application/octet-stream' }).end(body)
  } catch {
    res.writeHead(400).end()
  }
}).listen(4173, '127.0.0.1')
