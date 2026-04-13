/** LMDB files named like `iot_timeline.lmdb` use the IoT timeline reader (time range + table/chart). */
export function isIotTimelineLmdbFile(fileName: string): boolean {
  return /^iot_timeline\.lmdb$/i.test(fileName.trim())
}
