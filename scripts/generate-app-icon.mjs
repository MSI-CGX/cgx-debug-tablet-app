/**
 * Rasterizes resources/logo_splash.svg to:
 * - build/icon.png — electron-builder (exe / shortcuts / dock) + dev BrowserWindow
 * - src/renderer/public/favicon.png — tab / window title in dev
 */
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svgPath = join(root, 'resources', 'logo_splash.svg')
const outPath = join(root, 'build', 'icon.png')
const faviconPath = join(root, 'src', 'renderer', 'public', 'favicon.png')
const SIZE = 1024

mkdirSync(dirname(outPath), { recursive: true })

// Source SVG has a very large viewBox; disable input pixel limit for rasterization.
const png = await sharp(svgPath, {
  density: 120,
  limitInputPixels: false
})
  .resize(SIZE, SIZE, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png()
  .toBuffer()

writeFileSync(outPath, png)
console.log('App icon written to', outPath)

mkdirSync(dirname(faviconPath), { recursive: true })
writeFileSync(faviconPath, png)
console.log('Favicon written to', faviconPath)
