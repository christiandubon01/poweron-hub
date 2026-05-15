// @ts-nocheck
/**
 * Netlify Function — Blueprint Vision (classify + extract)
 *
 * POST { mode: 'classify' | 'extract', images: string[], pageNumbers: number[] }
 *   → Forwards to Anthropic Messages API with vision (claude-sonnet-4-5)
 *   → Returns { success: true, data } | { success: false, error: string }
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-5'
const REQUEST_TIMEOUT_MS = 90_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

const CLASSIFY_SYSTEM =
  'You are an architectural drawing classifier. Given images of construction document sheets, identify the role of each. Return ONLY a JSON array, no prose, no markdown.'

const EXTRACT_SYSTEM =
  'You are an architectural floor plan extractor. Return ONLY valid JSON, no prose, no markdown, no code fences.'

function buildClassifyUserText(pageNumbers: number[]): string {
  const n = pageNumbers.length
  return `Classify each of these ${n} pages from a construction document set. For each page return an object with these fields:
- pageNumber (integer, matches the order provided)
- role (one of: floor_plan, electrical_plan, schedule, title_sheet, elevation, rendering, demolition_plan, reflected_ceiling_plan, other)
- confidence (number 0-1)
- reason (short string, max 80 chars)

Return: [{"pageNumber":1,"role":"title_sheet","confidence":0.95,"reason":"sheet index visible"}, ...]`
}

const EXTRACT_USER = `This is an architectural floor plan. Extract the building geometry.

Coordinate system: origin (0,0) at bottom-left. All measurements in feet.

Return this JSON structure exactly:
{
  "footprint": {"width": <feet>, "height": <feet>},
  "scale": "<e.g. 1/4\\" = 1'>",
  "rooms": [
    {
      "id": "room-1",
      "label": "<room name from drawing>",
      "role": "<reception|waiting|styling|wash-station|hallway|bath|utility|storage|service|office|living|bedroom|kitchen|other>",
      "boundsFeet": {"x": 0, "y": 0, "width": 0, "height": 0}
    }
  ],
  "walls": [
    {
      "id": "wall-1",
      "startFeet": {"x": 0, "y": 0},
      "endFeet": {"x": 0, "y": 0},
      "kind": "<exterior|partition|glass>",
      "thicknessInches": 6
    }
  ],
  "openings": [
    {
      "id": "opening-1",
      "wallId": "wall-1",
      "type": "<door|window>",
      "positionFeet": 0,
      "widthFeet": 3,
      "swing": "<left|right|fixed|sliding>"
    }
  ]
}

If the image is not a floor plan or geometry cannot be extracted, return:
{"error": "not_a_floor_plan", "reason": "<short explanation>"}

Use rooms that match the drawing labels exactly when visible.`

function imageBlocks(images: string[]) {
  return images.map((b64) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: b64.replace(/^data:image\/\w+;base64,/, ''),
    },
  }))
}

function parseJsonFromModelText(text: string): unknown {
  const trimmed = String(text || '').trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const start = unfenced.indexOf('{')
  const arrStart = unfenced.indexOf('[')
  let slice = unfenced
  if (arrStart >= 0 && (start < 0 || arrStart < start)) {
    const end = unfenced.lastIndexOf(']')
    if (end > arrStart) slice = unfenced.slice(arrStart, end + 1)
  } else if (start >= 0) {
    const end = unfenced.lastIndexOf('}')
    if (end > start) slice = unfenced.slice(start, end + 1)
  }
  return JSON.parse(slice)
}

async function callAnthropic(apiKey: string, system: string, userText: string, images: string[]) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8192,
        system,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: userText }, ...imageBlocks(images)],
          },
        ],
      }),
      signal: controller.signal,
    })

    const raw = await res.text()
    let parsed: any = {}
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = { raw }
    }

    if (!res.ok) {
      const msg =
        parsed?.error?.message ||
        parsed?.message ||
        `Anthropic API error ${res.status}`
      return { ok: false as const, error: msg }
    }

    const text =
      (parsed.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('') || ''

    if (!text.trim()) {
      return { ok: false as const, error: 'Empty response from vision model' }
    }

    try {
      const data = parseJsonFromModelText(text)
      return { ok: true as const, data }
    } catch (err: any) {
      return {
        ok: false as const,
        error: `Malformed JSON from model: ${err?.message || 'parse failed'}`,
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false as const, error: 'Vision API request timed out' }
    }
    return { ok: false as const, error: err?.message || 'Vision API request failed' }
  } finally {
    clearTimeout(timer)
  }
}

exports.handler = async (event: any) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'ANTHROPIC_API_KEY not configured. Add it in Netlify environment variables.',
      }),
    }
  }

  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Invalid JSON body' }),
    }
  }

  const mode = body.mode
  const images = body.images
  const pageNumbers = body.pageNumbers

  if (mode !== 'classify' && mode !== 'extract') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'mode must be classify or extract' }),
    }
  }

  if (!Array.isArray(images) || images.length === 0) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'images array is required' }),
    }
  }

  if (!Array.isArray(pageNumbers) || pageNumbers.length !== images.length) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: 'pageNumbers must be an array matching images length',
      }),
    }
  }

  if (mode === 'extract' && images.length !== 1) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'extract mode requires exactly one image' }),
    }
  }

  const userText =
    mode === 'classify' ? buildClassifyUserText(pageNumbers as number[]) : EXTRACT_USER
  const system = mode === 'classify' ? CLASSIFY_SYSTEM : EXTRACT_SYSTEM

  const result = await callAnthropic(apiKey, system, userText, images as string[])

  if (!result.ok) {
    console.error('[blueprintVision]', mode, result.error)
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: result.error }),
    }
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: true, data: result.data }),
  }
}
