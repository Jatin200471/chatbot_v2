JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE)
patches_applied = []
patches_failed = []

# ── Patch 1: startCall guard — localStorage → backend hbAge2 ─────────────────
# Find the pattern: localStorage.getItem("cw_voice_popup_heartbeat") used in guard context
m1 = content.match(/const \w+=parseInt\(localStorage\.getItem\("cw_voice_popup_heartbeat"\)[^;]*;[^}]*?alert\([^)]+\);return\}/)
if m1
  old_str = m1[0]
  puts "P1 found (#{old_str.length} chars): #{old_str[0..100]}"
  new_str = 'const hbAge2=f.last_heartbeat?Date.now()-new Date(f.last_heartbeat).getTime():Infinity;if(hbAge2<1e4){F("Fresh backend heartbeat "+Math.round(hbAge2/1e3)+"s — another tab"),this._syncCallActiveFromPopup();alert("You already have a voice call open in another tab. Please end it there before starting a new one.");return}'
  content = content.sub(old_str, new_str)
  patches_applied << "P1: startCall guard"
else
  puts "P1: PATTERN NOT FOUND — dumping localStorage context:"
  i = content.index('cw_voice_popup_heartbeat')
  puts i ? content[[i-50,0].max, 300] : "cw_voice_popup_heartbeat not found at all"
  patches_failed << "P1: guard"
end

# ── Patch 2: _checkBackendCallStatus — localStorage → backend hbAge ──────────
m2 = content.match(/parseInt\(localStorage\.getItem\("cw_voice_popup_heartbeat"\)[^\n]{0,300}stale[^\)]+\)/)
if m2
  old_str = m2[0]
  puts "P2 found (#{old_str.length} chars): #{old_str[0..100]}"
  new_str = 'parseInt("0",10);const hbAge=n.last_heartbeat?Date.now()-new Date(n.last_heartbeat).getTime():Infinity;hbAge<1e4||l?(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(hbAge/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(hbAge/1e3)+"s ignoring")'
  content = content.sub(old_str, new_str)
  patches_applied << "P2: checkStatus"
else
  # Try broader pattern
  idx = 0; all = []
  while (i = content.index('cw_voice_popup_heartbeat', idx))
    all << i; idx = i + 1
  end
  puts "P2: cw_voice_popup_heartbeat occurrences: #{all.length}"
  all.each { |i| puts "  at #{i}: #{content[[i-30,0].max, 200]}" }
  patches_failed << "P2: checkStatus"
end

File.write(JS_FILE, content)
puts "\nApplied: #{patches_applied.join(', ')}"
puts "Failed:  #{patches_failed.join(', ')}" unless patches_failed.empty?
