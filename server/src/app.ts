import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import path from 'path'
import multer from 'multer'
import fs from 'fs'
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
          description: 'Post a message to your Facebook wall (via browser automation).',
          example: 'fb: Hello Facebook!',
        },
        {
          command: 'fb page: <content>',
          description: 'Post a message to your connected Facebook Page (via Graph API).',
          example: 'fb page: Hello Page!',
        },
        {
          command: 'ws fb login',
          description: 'Get the link to upload Facebook cookies for wall posting.',
          example: 'ws fb login',
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

  // ── Facebook cookies setup page ──────────────────────────────────────
  const fbUpload = multer({
    storage: multer.diskStorage({
      destination: path.resolve(process.cwd()),
      filename: () => 'fb_cookies.txt',
    }),
    limits: { fileSize: 1 * 1024 * 1024 },
  })

  app.get('/fb-setup', (_req, res) => {
    const cookiesExists = fs.existsSync(path.resolve(process.cwd(), 'fb_cookies.txt'))
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Facebook Wall Post - Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;min-height:100vh;display:flex;justify-content:center;padding:40px 16px}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.1);max-width:640px;width:100%;padding:32px}
h1{font-size:24px;color:#1a1a2e;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e4e6eb}
h2{font-size:16px;color:#1a1a2e;margin:24px 0 12px}
.step{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #f0f0f0}
.step:last-child{border-bottom:none}
.step-num{flex-shrink:0;width:28px;height:28px;background:#1877f2;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600}
.step-body{font-size:14px;line-height:1.6;color:#333}
.step-body strong{display:block;margin-bottom:2px}
.step-body code{background:#f0f2f5;padding:2px 6px;border-radius:4px;font-size:13px;color:#1877f2}
.upload-area{border:2px dashed #ccd0d5;border-radius:10px;padding:32px;text-align:center;cursor:pointer;transition:all .2s;margin-top:16px}
.upload-area:hover{border-color:#1877f2;background:#f0f8ff}
.upload-area.dragover{border-color:#1877f2;background:#e7f3ff}
.upload-area.has-file{border-color:#42b72a;background:#f0fff0}
.upload-area label{cursor:pointer;display:block}
.upload-area input{display:none}
.upload-icon{font-size:36px;margin-bottom:8px;display:block}
.upload-text{font-size:14px;color:#65676b}
.upload-text strong{color:#1877f2}
.file-status{margin-top:8px;font-size:13px;padding:8px;border-radius:6px;display:none}
.file-status.success{display:block;background:#e6f7e6;color:#2e7d32}
.file-status.error{display:block;background:#fde8e8;color:#c62828}
.btn{background:#1877f2;color:#fff;border:none;border-radius:6px;padding:10px 20px;font-size:15px;font-weight:600;cursor:pointer;margin-top:16px;width:100%}
.btn:hover{background:#166fe5}
.btn:disabled{opacity:.5;cursor:not-allowed}
.status-bar{margin-top:12px;padding:12px;border-radius:8px;font-size:14px;display:none;text-align:center}
.status-bar.uploading{display:block;background:#fff3cd;color:#856404}
.status-bar.success{display:block;background:#e6f7e6;color:#2e7d32}
.status-bar.error{display:block;background:#fde8e8;color:#c62828}
.badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;margin-left:8px}
.badge.ok{background:#e6f7e6;color:#2e7d32}
.badge.missing{background:#fde8e8;color:#c62828}
</style>
</head>
<body>
<div class="card">
<h1>🔗 Facebook Wall Post — Setup</h1>

<h2>Instructions</h2>

<div class="step">
  <div class="step-num">1</div>
  <div class="step-body">
    <strong>Install the cookie exporter</strong>
    Add <code>Get cookies.txt LOCALLY</code> from the Chrome Web Store to your browser.
  </div>
</div>

<div class="step">
  <div class="step-num">2</div>
  <div class="step-body">
    <strong>Log into Facebook</strong>
    Open <code>facebook.com</code> and make sure you're logged in.
  </div>
</div>

<div class="step">
  <div class="step-num">3</div>
  <div class="step-body">
    <strong>Export cookies</strong>
    Click the extension icon → <strong>Export</strong> → saves <code>facebook_cookies.txt</code> to your computer.
  </div>
</div>

<div class="step">
  <div class="step-num">4</div>
  <div class="step-body">
    <strong>Upload the file below</strong>
    Select the exported <code>facebook_cookies.txt</code> file and click Upload.
  </div>
</div>

<h2>Upload Cookies File</h2>
<p style="font-size:13px;color:#65676b;margin-bottom:8px;">
  Current status:
  <span id="statusBadge" class="badge ${cookiesExists ? 'ok' : 'missing'}">
    ${cookiesExists ? 'Cookies installed' : 'No cookies uploaded'}
  </span>
</p>

<form id="uploadForm">
  <div class="upload-area" id="dropZone">
    <label for="fileInput">
      <span class="upload-icon">📄</span>
      <div class="upload-text">
        Drag & drop your <strong>facebook_cookies.txt</strong> here<br>
        or click to browse
      </div>
      <input type="file" id="fileInput" accept=".txt" required>
    </label>
  </div>
  <div id="fileStatus" class="file-status"></div>
  <button type="submit" class="btn" id="uploadBtn" disabled>Upload</button>
</form>
<div id="statusBar" class="status-bar"></div>
</div>

<script>
const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const fileStatus = document.getElementById('fileStatus');
const uploadBtn = document.getElementById('uploadBtn');
const statusBar = document.getElementById('statusBar');
const statusBadge = document.getElementById('statusBadge');

fileInput.addEventListener('change', function() {
  if (this.files.length > 0) {
    const f = this.files[0];
    if (f.name !== 'facebook_cookies.txt') {
      fileStatus.className = 'file-status error';
      fileStatus.textContent = '⚠️ File must be named facebook_cookies.txt';
      uploadBtn.disabled = true;
      return;
    }
    fileStatus.className = 'file-status success';
    fileStatus.textContent = '✅ Selected: ' + f.name + ' (' + (f.size / 1024).toFixed(1) + ' KB)';
    dropZone.classList.add('has-file');
    uploadBtn.disabled = false;
  }
});

dropZone.addEventListener('dragover', function(e) {
  e.preventDefault();
  this.classList.add('dragover');
});
dropZone.addEventListener('dragleave', function() {
  this.classList.remove('dragover');
});
dropZone.addEventListener('drop', function(e) {
  e.preventDefault();
  this.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

form.addEventListener('submit', async function(e) {
  e.preventDefault();
  if (!fileInput.files.length) return;

  statusBar.className = 'status-bar uploading';
  statusBar.textContent = '⏳ Uploading...';
  uploadBtn.disabled = true;

  const fd = new FormData();
  fd.append('cookies', fileInput.files[0]);

  try {
    const r = await fetch('/fb-setup/upload', { method: 'POST', body: fd });
    const data = await r.json();
    if (data.success) {
      statusBar.className = 'status-bar success';
      statusBar.textContent = '✅ Cookies uploaded successfully! You can now use fb: commands.';
      statusBadge.className = 'badge ok';
      statusBadge.textContent = 'Cookies installed';
      fileStatus.className = 'file-status success';
      fileStatus.textContent = '✅ Upload complete';
    } else {
      statusBar.className = 'status-bar error';
      statusBar.textContent = '❌ ' + (data.error || 'Upload failed');
    }
  } catch (err) {
    statusBar.className = 'status-bar error';
    statusBar.textContent = '❌ Network error: ' + err.message;
  }
});
</script>
</body>
</html>`)
  })

  app.post('/fb-setup/upload', fbUpload.single('cookies'), (req, res) => {
    if (!req.file) {
      res.json({ success: false, error: 'No file uploaded' })
      return
    }
    res.json({ success: true })
  })

  app.use(errorHandler)

  return app
}
