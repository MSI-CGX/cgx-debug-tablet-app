import crypto from 'crypto'

const ENCRYPTION_ALGORITHM = 'aes-256-cbc'

/**
 * Decrypts a buffer written by conf/electron-store with `encryptionKey`
 * (IV + ':' + ciphertext format, or legacy createDecipher ciphertext).
 */
export function decryptConfEncryptedBuffer(
  data: Buffer,
  encryptionKey: string | Buffer
): string {
  if (data.length >= 17 && data.subarray(16, 17).toString() === ':') {
    const initializationVector = data.subarray(0, 16)
    const password = crypto.pbkdf2Sync(
      encryptionKey,
      initializationVector.toString(),
      10000,
      32,
      'sha512'
    )
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      password,
      initializationVector
    )
    return Buffer.concat([
      decipher.update(data.subarray(17)),
      decipher.final()
    ]).toString('utf8')
  }

  try {
    const decipher = crypto.createDecipher(
      ENCRYPTION_ALGORITHM,
      encryptionKey as crypto.BinaryLike
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
