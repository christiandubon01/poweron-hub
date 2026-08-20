/**
 * ElevenLabs server credential + upstream error mapping for /.netlify/functions/speak.
 * Pure helpers — safe to unit-test without loading the Netlify handler.
 */

export type SpeakUpstreamCode =
  | 'not_configured'
  | 'invalid_credential'
  | 'bad_voice'
  | 'upstream_unavailable'
  | 'upstream_error'

export function resolveElevenLabsApiKey(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const poweron = String(env.POWERON_ELEVENLABS_API_KEY || '').trim()
  if (poweron) return poweron
  return String(env.ELEVENLABS_API_KEY || '').trim()
}

/**
 * Map ElevenLabs HTTP failures to safe client-facing errors.
 * Never echo upstream bodies (may contain sensitive detail).
 */
export function mapElevenLabsUpstreamFailure(
  status: number,
  bodyText: string,
): { statusCode: number; code: SpeakUpstreamCode; error: string } {
  const lower = String(bodyText || '').toLowerCase()

  if (
    status === 401 ||
    status === 403 ||
    /invalid_api_key|unauthorized|authentication|forbidden/.test(lower)
  ) {
    return {
      statusCode: 401,
      code: 'invalid_credential',
      error: 'ElevenLabs rejected the server credential.',
    }
  }

  if (
    status === 404 ||
    /voice_not_found|voice_does_not_exist|does not exist|invalid.?voice|unknown voice/.test(lower)
  ) {
    return {
      statusCode: 400,
      code: 'bad_voice',
      error: 'Requested voice is invalid or unavailable.',
    }
  }

  if (status === 429 || status >= 500) {
    return {
      statusCode: 502,
      code: 'upstream_unavailable',
      error: 'ElevenLabs upstream is unavailable.',
    }
  }

  return {
    statusCode: 502,
    code: 'upstream_error',
    error: 'ElevenLabs request failed.',
  }
}
