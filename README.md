# Chatwoot Custom — Voice Agent Edition

A fork of [Chatwoot](https://www.chatwoot.com/) with built-in AI Voice Agent support. Visitors can chat with your support team or talk to an AI voice agent (powered by [ElevenLabs Conversational AI](https://elevenlabs.io/docs/conversational-ai)) directly in the widget.

**What's included:**
- ✅ Voice Agent section in each web-widget inbox's Configuration tab
- ✅ Real-time voice calls with transcripts auto-posted to conversations
- ✅ Support for ElevenLabs agents (public & private)
- ✅ Full Chatwoot dashboard for team collaboration

---

## 📋 Prerequisites

- **Docker Desktop** (Windows / Mac / Linux) — https://docker.com
- **Git** — to clone the repo
- **8 GB RAM** free (Vite bundle is large during first build)
- **10 GB disk space** free

---

## 🚀 Quick Start — Choose Your Path

### **Option A: Run from Pre-Built Image** (Fastest ⚡)

Use this if the image is already pushed to a registry.

```bash
# 1. Pull the image
docker pull jatin71/chatwoot-custom:latest

# 2. Clone the repo (for docker-compose.yaml and .env)
git clone https://github.com/Jatin200471/chatwoot-custom-master.git
cd chatwoot-custom-master

# 3. Setup environment
cp .env.example .env
# Edit .env with your values (see "Environment Variables" below)

# 4. Update docker-compose.yaml
# Change the `image:` line under rails/sidekiq services to:
#   image: jatin71/chatwoot-custom:latest
# (Remove or comment out any `build:` block)

# 5. Start everything
docker compose up -d

# 6. Wait ~60 seconds, then open http://localhost:3000
```

### **Option B: Build Locally from Source** (Slower, ~5–15 min)

Use this if you want to modify code or don't have a pre-built image.

```bash
# 1. Clone the repo
git clone https://github.com/Jatin200471/chatwoot-custom-master.git
cd chatwoot-custom-master

# 2. Setup environment
cp .env.example .env
# Edit .env with your values

# 3. Build the image
./build.sh

# 4. Start everything
docker compose up -d

# 5. Wait ~60 seconds, then open http://localhost:3000
```

---

## 🔐 Environment Variables

Copy `.env.example` to `.env` and fill in these values:

```env
# Public URL of your Chatwoot instance
# Localhost OK for testing, but HTTPS required for voice/mic outside localhost
FRONTEND_URL=http://localhost:3000

# Generate with: docker run --rm chatwoot/chatwoot:latest rails secret
SECRET_KEY_BASE=<your_generated_secret>

# Strong passwords for services (must match docker-compose.yaml)
POSTGRES_PASSWORD=your_postgres_password
REDIS_PASSWORD=your_redis_password
```

---

## 🎯 Post-Install: Wire Up Voice Agent

After the dashboard loads, configure your ElevenLabs voice agent:

1. **Log in** to http://localhost:3000

2. **Create or open a Web Widget inbox**
   - Settings → Inboxes → "Add Inbox" → Website
   - Fill in name & URL → Finish

3. **Open the "Configuration" tab** of your inbox

4. **Scroll to "Voice Agent" section** and fill in:
   - **Enable Voice Agent** → Toggle ON
   - **Provider** → `elevenlabs`
   - **API Key** → Leave blank if agent is Public; paste only if Private (requires `convai_write` permission)
   - **Agent ID** → Copy from your ElevenLabs URL: `https://elevenlabs.io/app/conversational-ai/agents/agent_XXXXXXX`
     - Paste just the `agent_XXXXXXX` part
   - Click Save

5. **Verify your ElevenLabs agent is configured:**
   - ✅ Voice is assigned
   - ✅ First Message is set (e.g., "Hi, how can I help?")
   - ✅ System Prompt is set
   - ✅ Security → "Allow public access" is ON (for Public agents)

---

## 💬 Embed Widget on Your Website

Works with any tech stack — React, Vue, Angular, Next.js, WordPress, Shopify, plain HTML, etc.

1. **In the dashboard:** Settings → Inboxes → Your Inbox → Configuration tab

2. **Copy the "Messenger Script"** block

3. **Paste it before `</body>`** on your website:

```html
<script>
  (function(d,t) {
    var BASE_URL="http://localhost:3000";
    var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
    g.src=BASE_URL+"/packs/js/sdk.js";
    g.async = true;
    s.parentNode.insertBefore(g,s);
    g.onload=function(){
      window.chatwootSDK.run({
        websiteToken: 'YOUR_WEBSITE_TOKEN',
        baseUrl: BASE_URL
      })
    }
  })(document,"script");
</script>
```

**Where to paste by framework:**
- **HTML / WordPress / Shopify** — footer template
- **React / Next.js** — `<Head>` or `next/script` in `_document`
- **Vue / Nuxt** — `public/index.html` or `nuxt.config.head.scripts`
- **Angular** — `src/index.html` before `</body>`

---

## 🔧 Common Issues & Fixes

| Problem | Solution |
|---------|----------|
| **Call button doesn't appear** | Toggle Voice Agent off → Save → On → Save. Close & reopen widget bubble. |
| **Call connects then drops (~3 sec)** | ElevenLabs quota exceeded. Check https://elevenlabs.io/app/usage. Upgrade or wait. |
| **"missing_permissions: convai_write" error** | Your API key lacks permissions. ElevenLabs Dashboard → API Keys → edit key → enable "ElevenAgents → Write" → re-paste in Chatwoot. |
| **Voice transcript not appearing** | Check logs: `docker compose logs rails \| Select-String voice_transcript`. Successful POST should return 200. |
| **"WebRTC negotiation timed out"** | Run `./build.sh` to refresh the bundle (uses latest ElevenLabs LiveKit protocol). |

---

## 🛠️ Useful Commands

```bash
# Start all services in background
docker compose up -d

# Stop and remove containers
docker compose down

# Tail Rails logs (Ctrl+C to exit)
docker compose logs -f rails

# Find voice-agent logs (PowerShell)
docker compose logs rails | Select-String VOICE-AGENT

# Restart Rails after code changes
docker compose restart rails

# Open Rails console
docker compose exec rails rails c

# Shell into Rails container
docker compose exec rails bash
```

---

## 📚 Documentation

- **Chatwoot Docs** — https://www.chatwoot.com/docs
- **ElevenLabs Conversational AI** — https://elevenlabs.io/docs/conversational-ai
- **This repo's memory** — [.antigravity/memory.md](.antigravity/memory.md)
- **Coding rules & gotchas** — [.antigravity/RULES.md](.antigravity/RULES.md)
- **Full setup guide** — [SETUP.txt](SETUP.txt)
```

---

## 🎙️ Voice Agent Setup (Optional)

1. Go to **Settings → Inboxes → Your Inbox → Configuration**
2. Enable **Voice Agent**
3. Select provider (ElevenLabs)
4. Enter your **Agent ID** and **API Key**
5. Save ✅

---

## 🌐 Share Online (ngrok)

To let others test your instance online:

```bash
# Install ngrok from https://ngrok.com
ngrok http 3000
```

Update `.env`:
```env
FRONTEND_URL=https://your-ngrok-url.ngrok-free.app
```

Restart:
```bash
docker compose restart rails
```

---

## 🛑 Useful Commands

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs rails --tail=50

# Restart
docker compose restart rails

# Full reset (deletes all data!)
docker compose down -v
```

---

## ⚠️ Important Notes

- Never commit `.env` file — it contains secrets
- Each person needs their **own** Website Token (from their own inbox)
- `REDIS_PASSWORD` and the password inside `REDIS_URL` must be **identical**
