/**
 * Copies project root `.env` into `build/staged-env/` so electron-builder can
 * ship it as `extraResources` → `resources/.env` in the packaged app (STORE_KEY).
 * Comments in English per project convention.
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'build', 'staged-env')
const src = path.join(root, '.env')
const dest = path.join(outDir, '.env')

fs.mkdirSync(outDir, { recursive: true })

if (fs.existsSync(src)) {
  fs.copyFileSync(src, dest)
  console.log('[stage-env] Copied .env → build/staged-env/.env (will be packaged under resources/).')
} else {
  fs.writeFileSync(
    dest,
    '# No .env at project root during build. Set STORE_KEY via OS env or add .env before packaging.\n',
    'utf8'
  )
  console.warn(
    '[stage-env] No .env in project root; packaged build ships a placeholder only. Encrypted preview needs STORE_KEY from system env or a real .env before build.'
  )
}
