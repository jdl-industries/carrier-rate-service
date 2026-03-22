/**
 * JWT validation for Shopify Customer Account API session tokens.
 * Uses Web Crypto API (crypto.subtle) - no external JWT library.
 */

const OPENID_CONFIG_URL = 'https://shopify.com/.well-known/openid-configuration';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface JWK {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

interface JWKS {
  keys: JWK[];
}

interface OpenIDConfig {
  jwks_uri: string;
  issuer: string;
}

interface JWTHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JWTPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  dest?: string;
  sid?: string;
}

export interface ValidatedToken {
  customerId: string;
  payload: JWTPayload;
}

// In-memory cache for JWKS
let cachedJWKS: JWKS | null = null;
let cachedIssuer: string | null = null;
let jwksCacheTime = 0;

async function fetchOpenIDConfig(): Promise<OpenIDConfig> {
  const response = await fetch(OPENID_CONFIG_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenID config: ${response.status}`);
  }
  return response.json() as Promise<OpenIDConfig>;
}

async function fetchJWKS(jwksUri: string): Promise<JWKS> {
  const response = await fetch(jwksUri);
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`);
  }
  return response.json() as Promise<JWKS>;
}

async function getJWKS(): Promise<{ jwks: JWKS; issuer: string }> {
  const now = Date.now();
  if (cachedJWKS && cachedIssuer && now - jwksCacheTime < JWKS_CACHE_TTL_MS) {
    return { jwks: cachedJWKS, issuer: cachedIssuer };
  }

  const config = await fetchOpenIDConfig();
  const jwks = await fetchJWKS(config.jwks_uri);

  cachedJWKS = jwks;
  cachedIssuer = config.issuer;
  jwksCacheTime = now;

  return { jwks, issuer: config.issuer };
}

function base64UrlDecode(input: string): Uint8Array {
  // Convert base64url to base64
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  const padding = base64.length % 4;
  if (padding) {
    base64 += '='.repeat(4 - padding);
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJWTHeader(token: string): JWTHeader {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const headerJson = new TextDecoder().decode(base64UrlDecode(parts[0]));
  return JSON.parse(headerJson) as JWTHeader;
}

function decodeJWTPayload(token: string): JWTPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }
  const payloadJson = new TextDecoder().decode(base64UrlDecode(parts[1]));
  return JSON.parse(payloadJson) as JWTPayload;
}

async function importRSAPublicKey(jwk: JWK): Promise<CryptoKey> {
  if (!jwk.n || !jwk.e) {
    throw new Error('Invalid JWK: missing n or e');
  }
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'RSA',
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      use: 'sig',
    },
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['verify']
  );
}

async function verifySignature(
  token: string,
  publicKey: CryptoKey
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecode(parts[2]);

  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    signedData
  );
}

export async function validateCustomerToken(
  token: string,
  expectedAudience: string
): Promise<ValidatedToken> {
  // Decode header to get key ID
  const header = decodeJWTHeader(token);
  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Fetch JWKS and find matching key
  const { jwks, issuer } = await getJWKS();
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error(`No matching key found for kid: ${header.kid}`);
  }

  // Import public key and verify signature
  const publicKey = await importRSAPublicKey(jwk);
  const isValid = await verifySignature(token, publicKey);
  if (!isValid) {
    throw new Error('Invalid JWT signature');
  }

  // Decode and validate payload
  const payload = decodeJWTPayload(token);

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token has expired');
  }

  // Check issued at (with 5 minute clock skew tolerance)
  if (payload.iat && payload.iat > now + 300) {
    throw new Error('Token issued in the future');
  }

  // Check issuer
  if (payload.iss !== issuer) {
    throw new Error(`Invalid issuer: expected ${issuer}, got ${payload.iss}`);
  }

  // Check audience
  if (payload.aud !== expectedAudience) {
    throw new Error(
      `Invalid audience: expected ${expectedAudience}, got ${payload.aud}`
    );
  }

  // Extract customer ID from sub claim
  // Format is typically: gid://shopify/Customer/123456789
  const customerId = payload.sub;
  if (!customerId || !customerId.startsWith('gid://shopify/Customer/')) {
    throw new Error(`Invalid customer ID in token: ${customerId}`);
  }

  return {
    customerId,
    payload,
  };
}

/**
 * Extracts Bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
