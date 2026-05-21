# Chatwoot Custom — Voice Agent Edition

A customized Chatwoot instance with built-in AI Voice Assistant support (ElevenLabs & multi-provider).

---

## 🚀 Quick Start (Anyone Can Run This!)

### Step 1 — Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- Git installed

### Step 2 — Clone the repo
```bash
git clone https://github.com/Jatin200471/chatbot_v2.git
cd chatbot_v2
```

### Step 3 — Setup environment
```bash
# Copy the example file
cp .env.example .env
```

Now open `.env` and fill in these values:

**Generate SECRET_KEY_BASE:**
```bash
docker run --rm ruby:3 ruby -e "require 'securerandom'; puts SecureRandom.hex(64)"
```

**Minimum required values in `.env`:**
```env
FRONTEND_URL=http://localhost:3000
SECRET_KEY_BASE=<paste generated secret here>
POSTGRES_PASSWORD=any_strong_password
REDIS_PASSWORD=any_strong_password
REDIS_URL=redis://:any_strong_password@redis:6379
```
> ⚠️ Use the **same password** in `REDIS_PASSWORD` and inside `REDIS_URL`

### Step 4 — Create logs folder
```bash
mkdir -p logs
```

### Step 5 — Start the app
```bash
docker compose up -d
```
> ⏳ First time takes 5–10 minutes (database setup)

### Step 6 — Check everything is running
```bash
docker compose ps
```
All services should show `Up` or `healthy`.

### Step 7 — Open in browser
```
http://localhost:3000
```

---

## 🔧 First Time Setup in Browser

1. Go to `http://localhost:3000`
2. Click **"Create a new account"**
3. Fill in your name, email & password
4. Done! You're logged in ✅

---

## 💬 Setup Chat Widget

1. Go to **Settings → Inboxes → Add Inbox**
2. Select **"Website"**
3. Fill inbox name & website URL
4. Click Next → Finish
5. Copy the **Website Token** shown
6. Embed the widget in your HTML:

```html
<script>
  (function(d,t) {
    var BASE_URL = "http://localhost:3000";
    var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
    g.src = BASE_URL + "/packs/js/sdk.js";
    g.defer = true;
    g.async = true;
    s.parentNode.insertBefore(g,s);
    g.onload = function() {
      window.chatwootSDK.run({
        websiteToken: 'YOUR_WEBSITE_TOKEN_HERE',
        baseUrl: BASE_URL
      });
    };
  })(document, "script");
</script>
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
