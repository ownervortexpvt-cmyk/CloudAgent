/**
 * Client-side AI Provider Proxy
 *
 * When the server's IP is blocked by Cloudflare (Groq, OpenAI, etc),
 * we can make the API call directly from the user's browser instead.
 * The browser sends the request to the AI provider, gets the response,
 * and sends it back to the server for processing.
 *
 * This bypasses server IP blocks entirely.
 */

export interface ClientProxyRequest {
  endpoint: string
  apiKey: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
  stream?: boolean
}

export interface ClientProxyResponse {
  ok: boolean
  content?: string
  error?: string
  tokensIn?: number
  tokensOut?: number
}

/**
 * Makes a direct API call from the browser to the AI provider.
 * This bypasses server-side IP blocks.
 */
export async function clientProxyChat(req: ClientProxyRequest): Promise<ClientProxyResponse> {
  try {
    // OpenAI-compatible format (works for Groq, OpenAI, Together, etc.)
    const url = `${req.endpoint}/chat/completions`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${req.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 200000,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      let errMsg = errText
      try {
        const errJson = JSON.parse(errText)
        errMsg = errJson?.error?.message || errText
      } catch {}

      let hint = ''
      if (res.status === 401) hint = 'API key is invalid or missing'
      else if (res.status === 403) hint = 'Access forbidden — key may be expired or rate-limited'
      else if (res.status === 404) hint = 'Model not found — check model name'
      else if (res.status === 429) hint = 'Rate limit exceeded — wait and try again'

      return { ok: false, error: `HTTP ${res.status}: ${hint}\n${errMsg.slice(0, 300)}` }
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content || ''
    const tokensIn = data?.usage?.prompt_tokens
    const tokensOut = data?.usage?.completion_tokens

    return { ok: true, content, tokensIn, tokensOut }
  } catch (e: any) {
    return { ok: false, error: e.message || 'Network error' }
  }
}

/**
 * Tests a provider connection from the browser.
 */
export async function clientProxyTest(endpoint: string, apiKey: string, model: string): Promise<ClientProxyResponse> {
  return clientProxyChat({
    endpoint,
    apiKey,
    model,
    messages: [{ role: 'user', content: 'Say "hi" in one word.' }],
    temperature: 0,
    maxTokens: 10,
  })
}
