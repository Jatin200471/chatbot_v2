# Voice Call Persistence for Full-Page Navigation

## Your Problem
When visitors navigate between pages on your website, the Chatwoot widget reloads, closing the voice call.

## Root Cause
Your website uses **full-page navigation** (each link causes a complete page reload), which destroys the widget iframe and kills the voice connection.

## Solutions (Choose One)

### ✅ BEST: Convert to Client-Side Navigation (No Page Reload)
This is the optimal solution for the best user experience.

**How it works:**
- Use JavaScript to load page content WITHOUT reloading
- Widget stays in the DOM and never reloads
- Voice calls survive across all "page changes"
- Faster user experience (no full page reload)

**Example with jQuery:**
```html
<nav>
  <a class="nav-link" href="#" data-page="about-us.html">About Us</a>
  <a class="nav-link" href="#" data-page="contact-us.html">Contact</a>
</nav>

<div id="page-content"><!-- Page content loads here --></div>

<!-- Chatwoot widget script loads ONCE -->
<script>
  // Load Chatwoot ONCE at page start
  (function(d,t) {
    var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
    g.src = 'YOUR_CHATWOOT_URL/packs/js/sdk.js';
    g.async = true;
    s.parentNode.insertBefore(g, s);
  })(document, 'script');

  // When user clicks a nav link, load content via AJAX (no reload)
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = e.target.dataset.page;
      
      // Load HTML content WITHOUT reloading page
      fetch(page)
        .then(r => r.text())
        .then(html => {
          document.getElementById('page-content').innerHTML = html;
          window.history.pushState({}, '', '/' + page.replace('.html', ''));
        });
    });
  });
</script>
```

**Benefits:**
- ✅ Widget NEVER reloads
- ✅ Voice calls NEVER disconnect
- ✅ Faster page transitions
- ✅ Better UX overall

---

### 🟡 BACKUP: Chatwoot Widget Loads Once (Your Current Setup)
If your website ALREADY loads the Chatwoot script in a shared layout/template:

**Ensure these in your HTML template/layout:**

```html
<!DOCTYPE html>
<html>
<head><!-- ... --></head>
<body>
  <!-- Navigation -->
  <nav><!-- ... --></nav>
  
  <!-- Page Content -->
  <main><!-- This changes on each page load --></main>
  
  <!-- ✅ IMPORTANT: Chatwoot script is OUTSIDE the main content -->
  <!-- It loads ONCE and survives page reloads -->
  <script>
    var BASE_URL = 'https://your-chatwoot-domain.com';
    var WEBSITE_TOKEN = 'your-token-here';
    
    window.chatwootSettings = { position: 'right', type: 'standard' };
    
    (function(d,t) {
      var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
      g.src = BASE_URL + '/packs/js/sdk.js';
      g.async = true;
      s.parentNode.insertBefore(g, s);
      g.onload = function() {
        window.chatwootSDK.run({ websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
      };
    })(document, 'script');
  </script>
</body>
</html>
```

**Why this works:**
- Widget script is in the shared layout
- It loads once and never reloads
- Even on page reload, browser cache speeds it up
- Voice calls are stored in sessionStorage and resume after reload

---

### 🟢 SAFE: Session Restoration (What We Implemented)
If you cannot change your page navigation, the code we added will:

1. **During voice call** → Store call info in `sessionStorage`
2. **On page reload** → Detect active call and resume automatically
3. **When call ends** → Clear session data

**What you get:**
- ✅ Even if widget reloads, call automatically resumes
- ✅ Transparent to the user
- ✅ Works with current website structure

---

## Implementation for Your Website

### Step 1: Enable Session Persistence
Make sure your Chatwoot widget script is in your main layout template (not in each page):

```html
<script>
  window.chatwootSettings = { position: 'right', type: 'standard' };
  (function(d,t) {
    var g = d.createElement(t), s = d.getElementsByTagName(t)[0];
    g.src = 'https://staging.visualgraphx.com/packs/js/sdk.js';
    g.async = true;
    s.parentNode.insertBefore(g, s);
  })(document, 'script');
</script>
```

### Step 2: Test with Debug Mode
In browser console, run:
```javascript
// Enable debug logging
localStorage.setItem('cw_voice_debug', 'true')

// Now navigate pages and watch the console
// You should see:
// [VOICE] Call saved to session
// [VOICE] Resuming voice call after page reload...
// [VOICE] Resumed voice call from session
```

### Step 3: Monitor
In DevTools:
1. Open **Application** → **Session Storage**
2. Look for key `cw_voice_session_data`
3. While on a call, it will contain:
   ```json
   {"isActive": true, "signedUrl": "...", "timestamp": ...}
   ```
4. When call ends, key is removed

---

## What Each Component Does

| Component | Purpose | Scope |
|-----------|---------|-------|
| **SharedWorker** | Keeps WebSocket alive across pages | All windows/tabs of same origin |
| **sessionStorage** | Remembers call if page reloads | Current tab only |
| **Widget Resume** | Auto-reconnects after reload | 5 minute window |

---

## Troubleshooting

### Voice call still disconnects on navigation
**Check:**
1. Is Chatwoot script in your main layout (not each page)?
   ```bash
   # Search for where widget script is loaded
   grep -r "sdk.js" your/website/directory
   ```
   It should appear in ONE file only (your main layout template)

2. Does your website use full-page reload on navigation?
   - Check DevTools Network tab while clicking a navigation link
   - If you see a full page load, you're reloading

3. Is sessionStorage enabled?
   ```javascript
   try { sessionStorage.setItem('test', '1'); console.log('✅ Enabled'); }
   catch(e) { console.log('❌ Disabled'); }
   ```

### Session resumption not working
1. **Debug logs enabled?**
   ```javascript
   localStorage.setItem('cw_voice_debug', 'true')
   // Now navigate and check console for [VOICE] logs
   ```

2. **Check Application → Session Storage** for `cw_voice_session_data` key

3. **Call older than 5 minutes?** Session restores only recent calls

---

## Recommendation for visualgraphx.com

Since you're a **professional B2B printing company**, your customers will appreciate:

1. **Stable voice calls** — No disconnections during browsing
2. **Fast navigation** — Client-side page loads (no flicker)
3. **Professional UX** — Widget always available

**I recommend:** Convert to client-side navigation (Solution #1 above) for the best experience.

Need help implementing any of these? Let me know!

---

**Last Updated:** 2026-06-08
**Applies to:** Chatwoot Custom with ElevenLabs Voice
