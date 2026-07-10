import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { env } from './config/env'
import { errorHandler } from './middleware/errorHandler'
import authRoutes from './routes/auth'
import whatsappRoutes from './routes/whatsapp'
import automationRoutes from './routes/automation'
import billingRoutes from './routes/billing'
import metaWebhookRoutes from './routes/webhooks/meta'
import stripeWebhookRoutes from './routes/webhooks/stripe'
import uploadRoutes from './routes/upload'
import facebookRoutes from './routes/facebook'

export function createApp(): express.Application {
  const app = express()

  app.use(cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }))

  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      const url = req.url || ''
      if (url.includes('/webhooks/stripe')) {
        (req as any).rawBody = buf
      }
    },
  }))

  app.use(express.urlencoded({ extended: true }))

  app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')))

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  })

  app.get('/api/help', (_req, res) => {
    res.json({
      commands: [
        {
          command: '-help',
          description: 'Show this help message.',
          example: '-help',
        },
        {
          command: 'fb: <content>',
          description: 'Post a message to your Facebook feed/wall.',
          example: 'fb: Hello Facebook!',
        },
        {
          command: 'ws create rule <name>',
          description: 'Start an interactive wizard to create an automation rule. The bot will ask for platform, trigger values, contacts, saved groups, autoreply, and media type step by step.',
          example: 'ws create rule Motorcycle',
        },
        {
          command: 'ws create <name> save <group1>, <group2>, ...',
          description: 'Save a named list of WhatsApp groups for reuse.',
          example: 'ws create schools save exams, grade 7 a',
        },
        {
          command: 'ws get group lists',
          description: 'Show all saved group list names.',
          example: 'ws get group lists',
        },
        {
          command: 'ws get group lists content',
          description: 'Show all saved group lists with their groups.',
          example: 'ws get group lists content',
        },
        {
          command: 'ws get groups',
          description: 'List all your WhatsApp groups with admin status.',
          example: 'ws get groups',
        },
        {
          command: 'ws get rules',
          description: 'List all active WhatsApp automation rule names.',
          example: 'ws get rules',
        },
        {
          command: 'ws get <rule name> triggers',
          description: 'Show all trigger values for a specific rule.',
          example: 'ws get welcome bot triggers',
        },
        {
          command: 'ws list <name>: <content>',
          description: 'Send a message to all groups in a saved list.',
          example: 'ws list schools: Hello everyone!',
        },
        {
          command: 'ws fb login',
          description: 'Generate a Facebook OAuth URL. Open it in your browser, authorize the app, and the access token will be saved automatically.',
          example: 'ws fb login',
        },
        {
          command: 'ws test <rule name>: <trigger>',
          description: 'Test an automation rule by simulating a trigger.',
          example: 'ws test welcome bot: hello',
        },
        {
          command: 'ws delete rule <name>',
          description: 'Delete an automation rule by name.',
          example: 'ws delete rule Motorcycle',
        },
        {
          command: 'ws delete list <name>',
          description: 'Delete a saved group list by name.',
          example: 'ws delete list schools',
        },
        {
          command: 'ws <group1>, <group2>: <content>',
          description: 'Send a message directly to specific WhatsApp groups (you must be admin).',
          example: 'ws my group: Hello!',
        },
      ],
      note: 'All commands are sent as self-chat messages (message yourself). Append -h to any ws command for specific help (e.g. "ws create rule -h").',
    })
  })

  app.get('/privacy', (_req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Privacy Policy - EduLb</title><style>body{font-family:Arial,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#333}h1{color:#1a1a2e}</style></head>
<body>
<h1>Privacy Policy</h1>
<p>Last updated: June 29, 2026</p>
<p>EduLb ("we", "our", "us") operates the edulb.duckdns.org website and the EduLb Facebook application.</p>
<h2>Information We Collect</h2>
<p>When you connect your Facebook page to our service, we collect and store your Facebook Page access token and Page ID to provide automation features such as auto-replying to comments and messages.</p>
<h2>How We Use Your Information</h2>
<p>We use your Page access token solely to reply to comments, send messages via Facebook Messenger, and publish scheduled posts on your behalf.</p>
<h2>Data Storage</h2>
<p>Your access token is stored securely in our database and is never shared with third parties. You can revoke access at any time by removing your Facebook Page from our application.</p>
<h2>Contact</h2>
<p>Email: ahmad.zeineddine@hotmail.com</p>
</body>
</html>`)
  })

  app.use('/api/auth', authRoutes)
  app.use('/api/whatsapp', whatsappRoutes)
  app.use('/api/automation', automationRoutes)
  app.use('/api/billing', billingRoutes)
  app.use('/api/upload', uploadRoutes)
  app.use('/api/facebook', facebookRoutes)

  app.use('/webhooks/meta', metaWebhookRoutes)
  app.use('/webhooks/stripe', stripeWebhookRoutes)

  // ── Facebook Login web page ──────────────────────────────────────────
  app.get('/fb-login', (_req, res) => {
    const appId = env.META_APP_ID
    if (!appId) {
      res.status(500).send('META_APP_ID not configured')
      return
    }
    const jid = typeof _req.query.jid === 'string' ? _req.query.jid : ''

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Facebook Login</title>
<style>
body{font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}
.card{background:#fff;border-radius:12px;padding:40px;box-shadow:0 2px 12px rgba(0,0,0,0.1);text-align:center;max-width:400px;width:90%}
h1{color:#1a1a2e;font-size:24px;margin-bottom:8px}
p{color:#666;margin-bottom:24px;font-size:14px}
.fb-login-button{display:inline-block;background:#1877f2;color:#fff;border:none;border-radius:6px;padding:12px 24px;font-size:16px;cursor:pointer;font-weight:600}
.fb-login-button:hover{background:#166fe5}
#status{margin-top:16px;padding:12px;border-radius:6px;display:none;font-size:14px}
#status.success{display:block;background:#e6f7e6;color:#2e7d32}
#status.error{display:block;background:#fde8e8;color:#c62828}
</style>
</head>
<body>
<div class="card">
<h1>Connect Facebook</h1>
<p>Authorize the app to post to your feed.</p>
<button class="fb-login-button" id="loginBtn">Login with Facebook</button>
<div id="status"></div>
</div>

<script>
const JID = ${JSON.stringify(jid)};
const APP_ID = ${JSON.stringify(appId)};

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = type;
}

// Load FB SDK
window.fbAsyncInit = function() {
  FB.init({ appId: APP_ID, version: 'v21.0' });
};

(function(d, s, id) {
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) return;
  js = d.createElement(s); js.id = id;
  js.src = "https://connect.facebook.net/en_US/sdk.js";
  fjs.parentNode.insertBefore(js, fjs);
}(document, 'script', 'facebook-jssdk'));

document.getElementById('loginBtn').addEventListener('click', function() {
  setStatus('Opening Facebook...', '');
  FB.login(function(response) {
    if (response.authResponse) {
      setStatus('Authorized. Saving token...', '');
      fetch('/api/facebook/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: response.authResponse.accessToken, jid: JID })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setStatus('✅ Connected! You can close this tab.', 'success');
        } else {
          setStatus('❌ ' + (data.error || 'Failed to save token'), 'error');
        }
      })
      .catch(err => setStatus('❌ Network error: ' + err.message, 'error'));
    } else {
      setStatus('❌ Login cancelled or failed.', 'error');
    }
  }, { scope: 'publish_posts,user_posts' });
});
</script>
</body>
</html>`)
  })

  app.use(errorHandler)

  return app
}
