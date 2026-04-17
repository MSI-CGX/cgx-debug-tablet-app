import crypto from 'crypto'
import type { BinaryLike, CipherKey } from 'crypto'

const ENCRYPTION_ALGORITHM = 'aes-256-cbc'

/**
 * Decrypts a buffer written by conf/electron-store with `encryptionKey`
 * (IV + ':' + ciphertext format, or legacy createDecipher ciphertext).
 *
 * Note: `Buffer` ↔ `BinaryLike` / `CipherKey` assertions bridge @types/node strictness
 * (ArrayBufferLike vs ArrayBuffer) — runtime behavior is unchanged.
 */
export function decryptConfEncryptedBuffer(
  data: Buffer,
  encryptionKey: string | Buffer
): string {
  if (data.length >= 17 && data.subarray(16, 17).toString() === ':') {
    const initializationVector = data.subarray(0, 16)
    const password = crypto.pbkdf2Sync(
      encryptionKey as BinaryLike,
      initializationVector.toString(),
      10000,
      32,
      'sha512'
    )
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      password as unknown as CipherKey,
      initializationVector as unknown as BinaryLike
    )
    return Buffer.concat([
      decipher.update(data.subarray(17)),
      decipher.final()
    ]).toString('utf8')
  }

  try {
    const decipher = crypto.createDecipher(
      ENCRYPTION_ALGORITHM,
      encryptionKey as unknown as BinaryLike
    )
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `Decryption failed: ${e.message}`
        : 'Decryption failed: invalid key or file format'
    )
  }
}
