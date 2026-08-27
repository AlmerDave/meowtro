import assert from 'node:assert/strict'
import { computeScaledSize } from './imageToDataUrl'

// Never upscales.
assert.deepEqual(computeScaledSize(200, 100, 640), { width: 200, height: 100 })

// Downscales the longest edge to maxDim, keeping aspect ratio.
assert.deepEqual(computeScaledSize(1280, 640, 640), { width: 640, height: 320 })
assert.deepEqual(computeScaledSize(640, 1280, 640), { width: 320, height: 640 })

// A square image scales both dimensions equally.
assert.deepEqual(computeScaledSize(2000, 2000, 500), { width: 500, height: 500 })

console.log('imageToDataUrl: ok')
