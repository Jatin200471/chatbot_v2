content = File.read('/app/public/vite/assets/Messages-Bm4KxdC8.js')

# Fix 1: _checkBackendCallStatus — replace localStorage check with backend timestamp check
old1 = 'n!=null&&n.active&&!this.isCallActive?((()=>{const hb=parseInt(localStorage.getItem("cw_voice_popup_heartbeat")||"0",10);(hb&&Date.now()-hb<5e3||l)?(console.log("[VOICE-WIDGET] syncing ACTIVE"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale - ignoring")})())'
new1 = 'n!=null&&n.active&&!this.isCallActive?((()=>{const hbAge=n.last_heartbeat?Date.now()-new Date(n.last_heartbeat).getTime():Infinity;(hbAge<10000||l)?(console.log("[VOICE-WIDGET] syncing ACTIVE hbAge="+Math.round(hbAge/1000)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(hbAge/1000)+"s ignoring")})())'

if content.include?(old1)
  content = content.sub(old1, new1)
  puts "Fix 1 applied"
else
  puts "Fix 1 NOT FOUND"
end

# Fix 2: startCall guard — replace localStorage check with backend timestamp check
old2 = 'const hb=parseInt(localStorage.getItem("cw_voice_popup_heartbeat")||"0",10);if(hb&&Date.now()-hb<5e3){this._syncCallActiveFromPopup();alert("You already have a voice call open in another tab. Please end it there before starting a new one.");return}'
new2 = 'const hbAge2=f.last_heartbeat?Date.now()-new Date(f.last_heartbeat).getTime():Infinity;if(hbAge2<10000){this._syncCallActiveFromPopup();alert("You already have a voice call open in another tab. Please end it there before starting a new one.");return}'

if content.include?(old2)
  content = content.sub(old2, new2)
  puts "Fix 2 applied"
else
  # Try to find what's actually there
  m = content.match(/localStorage.*cw_voice_popup_heartbeat.*5e3.*alert.*another tab.{0,50}/)
  puts "Fix 2 NOT FOUND. Found: #{m ? m[0][0..150] : 'nothing'}"
end

File.write('/app/public/vite/assets/Messages-Bm4KxdC8.js', content)
puts "Done"
