/** Generated test keys and example claims for SPEC section 6 Access verification. */
export const TEST_ISSUER = 'https://team.example.cloudflareaccess.com'
export const TEST_AUD = 'test-audience-tag'
export const TEST_ADMIN_EMAIL = 'admin@example.com'

function encodeSegment(value: Uint8Array): string {
  return btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: TEST_ISSUER, aud: TEST_AUD, exp: Math.floor(Date.now() / 1000) + 3600,
    email: TEST_ADMIN_EMAIL, sub: 'test-user', type: 'access', ...overrides,
  }
}

/** Each factory call creates an independent signer, including for bad-signature tests. */
export async function createAccessTestKeys() {
  const keys = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
  }, true, ['sign', 'verify'])
  const kid = crypto.randomUUID()
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey)
  return {
    kid,
    jwks: { keys: [{ ...publicKey, kid, alg: 'RS256', use: 'sig' }] },
    async sign(claims: Record<string, unknown>, overrides: Record<string, unknown> = {}): Promise<string> {
      const encoder = new TextEncoder()
      const header = encodeSegment(encoder.encode(JSON.stringify({ ...overrides, alg: 'RS256', kid: overrides.kid ?? kid })))
      const payload = encodeSegment(encoder.encode(JSON.stringify(claims)))
      const input = `${header}.${payload}`
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, encoder.encode(input))
      return `${input}.${encodeSegment(new Uint8Array(signature))}`
    },
  }
}

export const createWrongKeySigner = createAccessTestKeys
