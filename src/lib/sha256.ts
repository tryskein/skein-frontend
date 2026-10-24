/**
 * sha256Hex — sk-62.3.8.
 *
 * Compute the lowercase hex SHA-256 of a string via the Web Crypto
 * SubtleCrypto API. Used to match the current browser's push endpoint
 * against the server-supplied `endpointHash` on each device row (the raw
 * endpoint never leaves the server, so the client hashes its own endpoint
 * the same way the backend does and compares the digests).
 *
 * Pure (modulo the platform `crypto.subtle`) + dependency-free so it can be
 * unit-tested in isolation. Requires a secure context — `crypto.subtle` is
 * only exposed over HTTPS / localhost, which is also where Service Workers
 * (and thus push) live, so the constraint is already satisfied wherever this
 * runs.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}
