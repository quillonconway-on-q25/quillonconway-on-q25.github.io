import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY          = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { client_id, message } = await req.json()
    if (!client_id || !message) {
      return new Response(JSON.stringify({ error: 'Missing client_id or message' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Use service role to fetch the client's email + name
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: { user }, error: userErr } = await admin.auth.admin.getUserById(client_id)
    if (userErr || !user?.email) {
      return new Response(JSON.stringify({ error: 'Client not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', client_id)
      .single()

    const clientEmail = user.email
    const clientName  = profile?.full_name && !profile.full_name.includes('@')
      ? profile.full_name.split(' ')[0]
      : clientEmail.split('@')[0]

    // Truncate preview for email subject
    const preview = message.length > 80 ? message.slice(0, 80) + '…' : message

    // Send email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'ON-Q25 <noreply@on-q25.com>',
        to:      clientEmail,
        subject: `New message from ON-Q25`,
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#09090f;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Header -->
          <tr>
            <td style="padding-bottom:28px;text-align:center;">
              <span style="font-size:1.4rem;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">
                ON-<span style="color:#6b8eff;">Q</span>25
              </span>
              <p style="margin:6px 0 0;font-size:0.75rem;color:#6b7280;letter-spacing:0.05em;text-transform:uppercase;">Client Portal</p>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#111118;border:1px solid #1e1e2e;border-radius:16px;padding:32px;">
              <p style="margin:0 0 6px;font-size:0.78rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">New Message</p>
              <h1 style="margin:0 0 20px;font-size:1.15rem;font-weight:700;color:#f0f0ff;">
                Hi ${clientName}, you have a new message from ON-Q25
              </h1>

              <!-- Message bubble -->
              <div style="background:#1a1a2e;border:1px solid #2a2a3e;border-radius:12px;padding:16px 20px;margin-bottom:24px;">
                <p style="margin:0 0 10px;font-size:0.95rem;color:#e0e0f0;line-height:1.6;">
                  ${preview.replace(/\n/g, '<br>')}
                </p>
                <p style="margin:0;font-size:0.72rem;color:#6b7280;">ON-Q25 Team</p>
              </div>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://on-q25.com/portal/messages.html"
                       style="display:inline-block;background:#3b6ef5;color:#ffffff;font-size:0.875rem;font-weight:600;
                              text-decoration:none;padding:12px 28px;border-radius:10px;letter-spacing:0.01em;">
                      View Message →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:0.72rem;color:#4b5563;">
                You're receiving this because you have an active account with ON-Q25.<br />
                <a href="https://on-q25.com" style="color:#6b8eff;text-decoration:none;">on-q25.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
      }),
    })

    const result = await emailRes.json()

    if (!emailRes.ok) {
      console.error('Resend error:', result)
      return new Response(JSON.stringify({ error: result }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
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
