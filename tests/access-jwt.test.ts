// @vitest-environment node
import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest'
import { accessConfigFromEnv, authenticateAdmin } from '../worker/admin/access'
import {
  createAccessTestKeys, createWrongKeySigner, TEST_ADMIN_EMAIL, TEST_AUD, TEST_ISSUER, validClaims,
} from './access-test-utils'

const env = { ACCESS_TEAM_DOMAIN: TEST_ISSUER, ACCESS_AUD: TEST_AUD }
const invalid = { ok: false, status: 401, error: 'Invalid access token' }
let issuer: Awaited<ReturnType<typeof createAccessTestKeys>>

function request(token?: string): Request {
  return new Request('https://example.com/api/v1/admin/videos', {
    headers: token === undefined ? {} : { 'Cf-Access-Jwt-Assertion': token },
  })
}

const deps = { fetchJwks: async () => issuer.jwks }

beforeAll(async () => { issuer = await createAccessTestKeys() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** SPEC section 6: authentication rejects every unverified identity and fails closed. */
describe('Access JWT verification', () => {
  it('accepts a valid signed token and preserves the email claim', async () => {
    const email = 'Admin@Example.com'
    expect(await authenticateAdmin(request(await issuer.sign(validClaims({ email }))), env, deps))
      .toEqual({ ok: true, email })
  })

  it.each([undefined, '', '   '])('requires a nonblank assertion header (%s)', async token => {
    expect(await authenticateAdmin(request(token), env, deps))
      .toEqual({ ok: false, status: 401, error: 'Authentication required' })
  })

  it('fails closed without configuration even with a token', async () => {
    expect(await authenticateAdmin(request(await issuer.sign(validClaims())), {}, deps))
      .toEqual({ ok: false, status: 500, error: 'Admin is unavailable' })
  })

  it.each([
    { exp: 0 }, { exp: '9999999999' }, { aud: 'other' }, { iss: `${TEST_ISSUER}/` },
    { email: undefined }, { email: ' ' }, { nbf: '0' }, { nbf: 9999999999 },
  ])('rejects invalid claims %j', async overrides => {
    expect(await authenticateAdmin(request(await issuer.sign(validClaims(overrides))), env, deps)).toEqual(invalid)
  })

  it('accepts an audience array containing the configured tag', async () => {
    expect(await authenticateAdmin(request(await issuer.sign(validClaims({ aud: ['other', TEST_AUD] }))), env, deps))
      .toEqual({ ok: true, email: TEST_ADMIN_EMAIL })
  })

  it('uses the injected clock with strict expiration and inclusive nbf boundaries', async () => {
    const now = () => new Date('2026-11-17T12:00:00Z')
    const seconds = now().getTime() / 1000
    for (const exp of [seconds - 1, seconds, seconds + 1]) {
      const token = await issuer.sign(validClaims({ exp, nbf: seconds }))
      expect(await authenticateAdmin(request(token), env, { ...deps, now }))
        .toEqual(exp > seconds ? { ok: true, email: TEST_ADMIN_EMAIL } : invalid)
    }
  })

  it('rejects a signature from an independent key', async () => {
    const wrong = await createWrongKeySigner()
    const token = await wrong.sign(validClaims(), { kid: issuer.kid })
    expect(await authenticateAdmin(request(token), env, deps)).toEqual(invalid)
  })

  it('rejects an unknown kid', async () => {
    expect(await authenticateAdmin(request(await issuer.sign(validClaims(), { kid: 'unknown' })), env, deps)).toEqual(invalid)
  })

  it('rejects malformed tokens and forbidden algorithms', async () => {
    const token = await issuer.sign(validClaims())
    const [header, payload, signature] = token.split('.')
    for (const malformed of [
      `${header}.${payload}`, `${header}.!invalid.${signature}`, `${header}.eA.${signature}`,
      `eA.${payload}.${signature}`, `${header}.${payload}.!invalid`,
      ...['none', 'HS256'].map(alg => `${btoa(JSON.stringify({ alg, kid: issuer.kid })).replace(/=+$/, '')}.${payload}.${signature}`),
    ]) {
      expect(await authenticateAdmin(request(malformed), env, deps)).toEqual(invalid)
    }
  })

  it('applies a trimmed, case-insensitive allowlist only when configured', async () => {
    const token = await issuer.sign(validClaims({ email: 'Admin@Example.com' }))
    expect(await authenticateAdmin(request(token), { ...env, ACCESS_ADMIN_EMAILS: ' , ADMIN@example.com, ' }, deps))
      .toEqual({ ok: true, email: 'Admin@Example.com' })
    expect(await authenticateAdmin(request(token), { ...env, ACCESS_ADMIN_EMAILS: 'other@example.com' }, deps))
      .toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(await authenticateAdmin(request(await issuer.sign(validClaims({ email: 'any@example.com' }))), env, deps))
      .toEqual({ ok: true, email: 'any@example.com' })
  })

  it('accepts a bare issuer host', async () => {
    expect(await authenticateAdmin(request(await issuer.sign(validClaims())), {
      ...env, ACCESS_TEAM_DOMAIN: 'team.example.cloudflareaccess.com',
    }, deps)).toEqual({ ok: true, email: TEST_ADMIN_EMAIL })
  })

  it.each([{}, { keys: [] }, { keys: [{ kid: 'wrong', kty: 'RSA' }] }])('rejects unusable JWKS %j', async jwks => {
    expect(await authenticateAdmin(request(await issuer.sign(validClaims())), env, { fetchJwks: async () => jwks }))
      .toEqual(invalid)
  })

  it('fails closed when key fetching or key import fails', async () => {
    const token = await issuer.sign(validClaims())
    expect(await authenticateAdmin(request(token), env, { fetchJwks: async () => { throw new Error('Offline') } }))
      .toEqual(invalid)
    expect(await authenticateAdmin(request(token), env, {
      fetchJwks: async () => ({ keys: [{ kid: issuer.kid, kty: 'RSA', n: 'invalid' }] }),
    })).toEqual(invalid)
  })

  it('caches JWKS for ten minutes and refreshes once for an unknown kid', async () => {
    const cacheEnv = { ...env, ACCESS_TEAM_DOMAIN: 'https://cache.example.cloudflareaccess.com' }
    const token = await issuer.sign(validClaims({ iss: cacheEnv.ACCESS_TEAM_DOMAIN }))
    const fetchStub = vi.fn(async () => Response.json(issuer.jwks))
    vi.stubGlobal('fetch', fetchStub)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    expect(await authenticateAdmin(request(token), cacheEnv)).toEqual({ ok: true, email: TEST_ADMIN_EMAIL })
    await authenticateAdmin(request(token), cacheEnv)
    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fetchStub).toHaveBeenCalledWith(`${cacheEnv.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`)
    const unknown = await issuer.sign(validClaims(), { kid: 'rotated' })
    expect(await authenticateAdmin(request(unknown), cacheEnv)).toEqual(invalid)
    expect(fetchStub).toHaveBeenCalledTimes(2)
    clock.mockReturnValue(1_600_000)
    await authenticateAdmin(request(token), cacheEnv)
    expect(fetchStub).toHaveBeenCalledTimes(3)
  })
})

describe('Access configuration validation', () => {
  it('normalizes origins and email lists', () => {
    expect(accessConfigFromEnv({ ...env, ACCESS_TEAM_DOMAIN: `${TEST_ISSUER}/`, ACCESS_ADMIN_EMAILS: ' A@Example.com, , b@example.com ' }))
      .toEqual({ teamDomain: TEST_ISSUER, aud: TEST_AUD, adminEmails: ['a@example.com', 'b@example.com'] })
  })

  it.each(['', ' ', 'https://', `${TEST_ISSUER}/path`, `${TEST_ISSUER}/a/..`, `${TEST_ISSUER}?q=x`,
    `${TEST_ISSUER}#hash`, 'http://team.example.cloudflareaccess.com', 'https://user:pass@example.com'])
  ('rejects an invalid issuer %s', domain => {
    expect(accessConfigFromEnv({ ...env, ACCESS_TEAM_DOMAIN: domain })).toBeNull()
  })

  it.each([{}, { ACCESS_AUD: TEST_AUD }, { ACCESS_TEAM_DOMAIN: TEST_ISSUER }, { ...env, ACCESS_AUD: ' ' }])
  ('rejects missing or blank required settings %j', value => {
    expect(accessConfigFromEnv(value)).toBeNull()
  })
})
