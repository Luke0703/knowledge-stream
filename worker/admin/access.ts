/** Worker-side Access verification fails closed as required by SPEC section 6. */
export interface AccessConfig {
  /** Issuer origin, e.g. "https://example.cloudflareaccess.com" (no trailing slash). */
  teamDomain: string
  /** Expected Access application audience tag. */
  aud: string
  /** Optional admin email allowlist; empty means "any verified Access user". */
  adminEmails: string[]
}

export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  ACCESS_ADMIN_EMAILS?: string
}

export type AccessAuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 500 | 401 | 403; error: string }

export interface AccessVerifyDeps {
  /** Injectable for tests; defaults to a JWKS fetch with an in-memory cache. */
  fetchJwks?: (issuer: string) => Promise<unknown>
  /** Injectable clock for tests; defaults to () => new Date(). */
  now?: () => Date
}

const JWKS_TTL_MS = 10 * 60_000
const jwksCache = new Map<string, { value: unknown; expiresAt: number }>()

/** Pure configuration validation; missing or invalid settings disable admin access. */
export function accessConfigFromEnv(env: AccessEnv): AccessConfig | null {
  const domain = env.ACCESS_TEAM_DOMAIN?.trim()
  const aud = env.ACCESS_AUD?.trim()
  if (!domain || !aud) return null
  try {
    const input = domain.includes('://') ? domain : `https://${domain}`
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || !/^https:\/\/[^/?#]+\/?$/.test(input)) return null
    return {
      teamDomain: url.origin,
      aud,
      adminEmails: (env.ACCESS_ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean),
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** JWT segments use unpadded base64url, never the ordinary base64 alphabet. */
function decodeSegment(segment: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) {
    throw new Error('Invalid encoding')
  }
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0))
}

function decodeJson(segment: string): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(decodeSegment(segment)))
}

function findKey(jwks: unknown, kid: string): (JsonWebKey & { kid: string }) | undefined {
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) return undefined
  return jwks.keys.find((key): key is JsonWebKey & { kid: string } =>
    isRecord(key) && key.kid === kid && key.kty === 'RSA')
}

async function fetchCachedJwks(issuer: string, kid: string): Promise<unknown> {
  const cached = jwksCache.get(issuer)
  if (cached && cached.expiresAt > Date.now() && findKey(cached.value, kid)) return cached.value
  // Refresh once on expiry or an unknown kid to support Access signing-key rotation.
  const response = await fetch(`${issuer}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error('Unable to fetch Access keys')
  const value: unknown = await response.json()
  jwksCache.set(issuer, { value, expiresAt: Date.now() + JWKS_TTL_MS })
  return value
}

/** Verify signatures and claims before applying the optional SPEC section 6 email restriction. */
export async function authenticateAdmin(
  request: Request, env: AccessEnv, deps: AccessVerifyDeps = {},
): Promise<AccessAuthResult> {
  const config = accessConfigFromEnv(env)
  if (!config) return { ok: false, status: 500, error: 'Admin is unavailable' }
  const token = request.headers.get('Cf-Access-Jwt-Assertion')?.trim()
  if (!token) return { ok: false, status: 401, error: 'Authentication required' }
  const invalid = { ok: false, status: 401, error: 'Invalid access token' } as const
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return invalid
    const [headerPart, payloadPart, signaturePart] = parts
    const header = decodeJson(headerPart)
    const payload = decodeJson(payloadPart)
    const signature = decodeSegment(signaturePart)
    if (!isRecord(header) || header.alg !== 'RS256' || typeof header.kid !== 'string') return invalid
    const jwks = deps.fetchJwks
      ? await deps.fetchJwks(config.teamDomain)
      : await fetchCachedJwks(config.teamDomain, header.kid)
    const jwk = findKey(jwks, header.kid)
    if (!jwk) return invalid
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    )
    if (!await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )) return invalid
    const now = (deps.now ?? (() => new Date()))().getTime() / 1000
    if (!isRecord(payload) || payload.iss !== config.teamDomain
      || !(payload.aud === config.aud || (Array.isArray(payload.aud) && payload.aud.includes(config.aud)))
      || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || !(payload.exp > now)
      || ('nbf' in payload && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || !(payload.nbf <= now)))
      || typeof payload.email !== 'string' || !payload.email.trim()) return invalid
    if (config.adminEmails.length && !config.adminEmails.includes(payload.email.toLowerCase())) {
      return { ok: false, status: 403, error: 'Forbidden' }
    }
    return { ok: true, email: payload.email }
  } catch {
    return invalid
  }
}
