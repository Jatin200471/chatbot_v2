JS_FILE = '/app/public/vite/assets/Messages-CiLd_mvQ.js'
content = File.read(JS_FILE)

patches_applied = []
patches_failed = []

# ── Patch 1: startCall guard — localStorage → backend timestamp ───────────────
old_guard = 'const S=parseInt(localStorage.getItem("cw_voice_popup_heartbeat")||"0",10);if(S&&Date.now()-S<5e3){F("Recent localStorage heartbeat — call active in another tab"),this._syncCallActiveFromPopup(),alert("You already have a voice call open in another tab. Please end it there before starting a new one.");return}'
new_guard = 'const hbAge2=f.last_heartbeat?Date.now()-new Date(f.last_heartbeat).getTime():Infinity;if(hbAge2<1e4){F("Fresh backend heartbeat "+Math.round(hbAge2/1e3)+"s — another tab"),this._syncCallActiveFromPopup();alert("You already have a voice call open in another tab. Please end it there before starting a new one.");return}'

if content.include?(old_guard)
  content = content.sub(old_guard, new_guard)
  patches_applied << "P2: startCall guard"
else
  patches_failed << "P2: guard NOT FOUND"
end

# ── Patch 2: _checkBackendCallStatus — localStorage → backend timestamp ────────
old_check = 'const r=parseInt(localStorage.getItem("cw_voice_popup_heartbeat")||"0",10);r&&Date.now()-r<5e3||l?(console.log("[VOICE-WIDGET] \xe2\x9c\x85 syncing UI to ACTIVE (backend + localStorage heartbeat confirm)"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] \xe2\x9a\xa0\xef\xb8\x8f backend says active but no fresh localStorage heartbeat \xe2\x80\x94 treating as stale, ignoring")'
new_check = 'const hbAge=n.last_heartbeat?Date.now()-new Date(n.last_heartbeat).getTime():Infinity;hbAge<1e4||l?(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(hbAge/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(hbAge/1e3)+"s ignoring")'

if content.include?(old_check)
  content = content.sub(old_check, new_check)
  patches_applied << "P3: checkStatus"
else
  # Try ASCII-safe version without emoji
  m = content.match(/parseInt\(localStorage\.getItem\("cw_voice_popup_heartbeat"\).{0,200}stale, ignoring"\)/)
  if m
    content = content.sub(m[0], new_check)
    patches_applied << "P3: checkStatus (alt match)"
  else
    patches_failed << "P3: checkStatus NOT FOUND"
  end
end

File.write(JS_FILE, content)
puts "Applied: #{patches_applied.join(', ')}"
puts "Failed:  #{patches_failed.join(', ')}" unless patches_failed.empty?
