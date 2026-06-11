JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE)

# Patch resetCallState to clear all polling timers immediately
# This prevents polling from re-activating button after endCall
old_reset = 'resetCallState(){y=null,this.isCallActive=!1,this.isConnecting=!1,this.setActive(!1),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","0")}catch{}this.notifyParentWidgetHide(!1)}'

new_reset = 'resetCallState(){y=null,this.isCallActive=!1,this.isConnecting=!1,this.setActive(!1),this.setConnecting(!1);clearInterval(this._activeCheckInterval);clearTimeout(this._activeCheckTimeout);clearTimeout(this._mountRetry1);clearTimeout(this._mountRetry2);clearTimeout(this._mountRetry3);this._endingCall=!0;setTimeout(()=>{this._endingCall=!1},8000);try{localStorage.setItem("cw_voice_active","0")}catch{}this.notifyParentWidgetHide(!1)}'

if content.include?(old_reset)
  content = content.sub(old_reset, new_reset)
  puts "P1 PATCHED: resetCallState clears timers"
else
  puts "P1 NOT FOUND — dumping:"
  i = content.index('resetCallState')
  puts content[[i-10,0].max, 300].inspect if i
end

# Patch _checkBackendCallStatus to skip re-activation if _endingCall flag is set
# Find the activation call inside checkBackendCallStatus
old_check_active = 'a<1e4||l?(console.log("[VOICE-WIDGET] ✅ syncing UI to ACTIVE (backend heartbeat age="+Math.round(a/1e3)+"s)"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] ⚠️ backend active but heartbeat is "+Math.round(a/1e3)+"s old — treating as stale, ignoring")'

new_check_active = 'a<1e4||l?this._endingCall?console.log("[VOICE-WIDGET] endingCall flag — skip re-activation"):(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(a/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(a/1e3)+"s ignoring")'

if content.include?(old_check_active)
  content = content.sub(old_check_active, new_check_active)
  puts "P2 PATCHED: checkStatus respects _endingCall flag"
else
  # Try ASCII-safe without emoji
  m = content.match(/a<1e4\|\|l\?\(console\.log[^,]+,this\._syncCallActiveFromPopup\(\)\):console\.log[^\)]+\)/)
  if m
    old_str = m[0]
    new_str = 'a<1e4||l?this._endingCall?console.log("[VOICE-WIDGET] endingCall flag — skip re-activation"):(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(a/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(a/1e3)+"s ignoring")'
    content = content.sub(old_str, new_str)
    puts "P2 PATCHED (alt match): checkStatus respects _endingCall flag"
  else
    puts "P2 NOT FOUND — dumping a<1e4 context:"
    i = content.index('a<1e4')
    puts content[[i-50,0].max, 300].inspect if i
  end
end

File.write(JS_FILE, content)
puts "Done."
