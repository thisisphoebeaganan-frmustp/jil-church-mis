// ═══════════════════════════════════════════════════════════════
// CHURCH MIS — AI Coach Edge Function
// Proxies requests to Anthropic so the API key never touches the browser.
//
// Deploy:
//   supabase functions deploy ai-coach --no-verify-jwt
//
// Set secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ═══════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const { question, context } = await req.json();

    if (!question) {
      return new Response(JSON.stringify({ error: 'Missing question' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI not configured. Set ANTHROPIC_API_KEY secret.' }), {
        status: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: context || 'You are a helpful pastoral coach for a Filipino church life group management system.',
        messages: [{ role: 'user', content: question }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Anthropic API error');
    }

    const answer = data.content?.map((c: { type: string; text?: string }) =>
      c.type === 'text' ? c.text : ''
    ).join('') || 'No response.';

    return new Response(JSON.stringify({ answer }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
