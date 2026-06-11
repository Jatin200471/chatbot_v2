JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE)
applied = []
failed = []

# ── 1. resetCallState: clear timers + _endingCall flag ───────────────────────
old_reset = 'resetCallState(){y=null,this.isCallActive=!1,this.isConnecting=!1,this.setActive(!1),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","0")}catch{}this.notifyParentWidgetHide(!1)}'
new_reset = 'resetCallState(){y=null,this.isCallActive=!1,this.isConnecting=!1,this.setActive(!1),this.setConnecting(!1);clearInterval(this._activeCheckInterval);clearInterval(this._keepAliveInterval);clearTimeout(this._activeCheckTimeout);this._endingCall=!0;setTimeout(()=>{this._endingCall=!1},8000);try{localStorage.setItem("cw_voice_active","0")}catch{}this.notifyParentWidgetHide(!1)}'
if content.include?(old_reset)
  content = content.sub(old_reset, new_reset)
  applied << "1:resetCallState"
elsif content.include?('clearInterval(this._keepAliveInterval)')
  applied << "1:resetCallState(already patched)"
else
  failed << "1:resetCallState"
end

# ── 2. _syncCallActiveFromPopup: start keep-alive polling when call synced ───
old_sync = '_syncCallActiveFromPopup(){if(!this.isCallActive){F("Detected alive popup via heartbeat — syncing UI to active"),this.isCallActive=!0,this.isConnecting=!1,this.setActive(!0),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","1")}catch{}this.notifyParentWidgetHide(!0)}}'
new_sync = '_syncCallActiveFromPopup(){if(!this.isCallActive){F("Detected alive popup via heartbeat — syncing UI to active"),this.isCallActive=!0,this.isConnecting=!1,this.setActive(!0),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","1")}catch{}this.notifyParentWidgetHide(!0);clearInterval(this._keepAliveInterval);this._keepAliveInterval=setInterval(async()=>{if(!this.isCallActive){clearInterval(this._keepAliveInterval);return;}try{const _wt=typeof WEBSITE_TOKEN!="undefined"?WEBSITE_TOKEN:"";let _ku=X("/api/v1/widget/conversations/voice_call_active");const _cg=this.getCwConversationToken();if(_cg)_ku+="&cw_conversation="+encodeURIComponent(_cg);const{data:_kd}=await j.get(_ku);if(!(_kd&&_kd.active)){console.log("[VOICE-WIDGET] keep-alive: call ended remotely — resetting");this.resetCallState();}}catch{}},5000)}}'
if content.include?(old_sync)
  content = content.sub(old_sync, new_sync)
  applied << "2:keepAliveInterval"
elsif content.include?('_keepAliveInterval=setInterval')
  applied << "2:keepAliveInterval(already patched)"
else
  failed << "2:syncCallActiveFromPopup"
  # dump
  i = content.index('_syncCallActiveFromPopup(){')
  puts "DUMP sync: " + content[[i,0].max, 250].inspect if i
end

# ── 3. endCall: call voice_call_ended backend ─────────────────────────────────
old_end = 'const e=Z();if(e)try{e.postMessage({type:"request-end-call"})}catch{}this.resetCallState()}'
new_end = 'const e=Z();if(e)try{e.postMessage({type:"request-end-call"})}catch{}this.resetCallState();try{const _u=X("/api/v1/widget/conversations/voice_call_ended"),_g=this.getCwConversationToken();j.post(_u+(_g?"&cw_conversation="+encodeURIComponent(_g):""),{}).catch(()=>{})}catch{}}'
if content.include?(old_end)
  content = content.sub(old_end, new_end)
  applied << "3:endCallBackend"
elsif content.include?('voice_call_ended')
  applied << "3:endCallBackend(already patched)"
else
  failed << "3:endCallBackend"
end

# ── 4. _checkBackendCallStatus: respect _endingCall flag ─────────────────────
# Find the activation branch using hbAge or 'a' variable pattern
m4 = content.match(/([a-z])<1e4\|\|l\?(?!this\._endingCall)[^:]+:console\.log\("[^"]*stale[^"]*"\)/)
if m4
  old_check = m4[0]
  var = m4[1]
  new_check = "#{var}<1e4||l?this._endingCall?console.log(\"[VOICE-WIDGET] endingCall — skip re-activation\"):(console.log(\"[VOICE-WIDGET] ACTIVE hbAge=\"+Math.round(#{var}/1e3)+\"s\"),this._syncCallActiveFromPopup()):console.log(\"[VOICE-WIDGET] stale hbAge=\"+Math.round(#{var}/1e3)+\"s ignoring\")"
  content = content.sub(old_check, new_check)
  applied << "4:endingCallFlag"
elsif content.include?('endingCall — skip')
  applied << "4:endingCallFlag(already patched)"
else
  failed << "4:endingCallFlag"
end

File.write(JS_FILE, content)
puts "Applied: " + applied.join(', ')
puts "Failed: " + (failed.empty? ? "none" : failed.join(', '))
