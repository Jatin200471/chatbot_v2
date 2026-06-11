content = File.read('/app/public/vite/assets/Messages-Bm4KxdC8.js')
m = content.match(/n!=null&&n\.active&&!this\.isCallActive\?\(console\.log.{0,100}syncCallActiveFromPopup\(\)\)/)
if m
  old_str = m[0]
  new_str = 'n!=null&&n.active&&!this.isCallActive?((()=>{const hb=parseInt(localStorage.getItem("cw_voice_popup_heartbeat")||"0",10);(hb&&Date.now()-hb<5e3||l)?(console.log("[VOICE-WIDGET] syncing ACTIVE"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale - ignoring")})())'
  new_content = content.sub(old_str, new_str)
  File.write('/app/public/vite/assets/Messages-Bm4KxdC8.js', new_content)
  puts 'patched: ' + old_str[0,80]
else
  puts 'NOT FOUND'
end
