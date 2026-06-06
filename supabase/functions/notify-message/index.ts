import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ADMIN_EMAIL          = Deno.env.get('ADMIN_EMAIL') || 'daquanconway@on-q25.com'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function emailHtml(opts: {
  preheader: string, heading: string, subheading: string,
  body: string, ctaText: string, ctaUrl: string, footer: string,
}) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#09090f;font-family:'Inter',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
      <tr><td style="padding-bottom:28px;text-align:center;">
        <span style="font-size:1.4rem;font-weight:800;letter-spacing:-0.02em;color:#fff;">ON-<span style="color:#6b8eff;">Q</span>25</span>
        <p style="margin:6px 0 0;font-size:0.75rem;color:#6b7280;letter-spacing:0.05em;text-transform:uppercase;">Client Portal</p>
      </td></tr>
      <tr><td style="background:#111118;border:1px solid #1e1e2e;border-radius:16px;padding:32px;">
        <p style="margin:0 0 6px;font-size:0.78rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">${opts.preheader}</p>
        <h1 style="margin:0 0 20px;font-size:1.15rem;font-weight:700;color:#f0f0ff;">${opts.heading}</h1>
        <div style="background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
          <p style="margin:0 0 10px;font-size:0.95rem;color:#e0e0f0;line-height:1.6;">${opts.body}</p>
          <p style="margin:0;font-size:0.72rem;color:#6b7280;">${opts.subheading}</p>
        </div>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <a href="${opts.ctaUrl}" style="display:inline-block;background:#3b6ef5;color:#fff;font-size:0.875rem;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:10px;">${opts.ctaText}</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding-top:24px;text-align:center;">
        <p style="margin:0;font-size:0.72rem;color:#4b5563;">${opts.footer}<br/><a href="https://on-q25.com" style="color:#6b8eff;text-decoration:none;">on-q25.com</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'ON-Q25 <noreply@on-q25.com>', to, subject, html }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(data))
  return data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { client_id, message, to_admin, subject_override } = await req.json()
    if (!client_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing client_id or message' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: { user } } = await db.auth.admin.getUserById(client_id)
    const { data: profile }  = await db.from('profiles').select('full_name, business_name').eq('id', client_id).single()

    const clientEmail = user?.email || ''
    const clientName  = profile?.full_name && !profile.full_name.includes('@')
      ? profile.full_name
      : clientEmail.split('@')[0]
    const firstName   = clientName.split(' ')[0]
    const bizName     = profile?.business_name || ''
    const preview     = message.length > 120 ? message.slice(0, 120) + '…' : message

    let result
    if (to_admin) {
      // ── Notify admin that a client messaged ──────────────────────────────
      const html = emailHtml({
        preheader:  'New Client Message',
        heading:    `${clientName} sent you a message`,
        subheading: `${bizName || clientEmail}`,
        body:       preview.replace(/\n/g, '<br>'),
        ctaText:    'Reply in Inbox →',
        ctaUrl:     'https://on-q25.com/portal/admin-inbox.html',
        footer:     'You\'re receiving this because a client messaged you through the ON-Q25 portal.',
      })
      result = await sendEmail(ADMIN_EMAIL, `New message from ${clientName}`, html)
    } else {
      // ── Notify client that admin messaged ────────────────────────────────
      if (!clientEmail) {
        return new Response(JSON.stringify({ error: 'Client email not found' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
      const html = emailHtml({
        preheader:  'New Message',
        heading:    `Hi ${firstName}, you have a new message from ON-Q25`,
        subheading: 'ON-Q25 Team',
        body:       preview.replace(/\n/g, '<br>'),
        ctaText:    'View Message →',
        ctaUrl:     'https://on-q25.com/portal/messages.html',
        footer:     'You\'re receiving this because you have an active account with ON-Q25.',
      })
      result = await sendEmail(clientEmail, subject_override || 'New message from ON-Q25', html)
    }

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
