JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE, encoding: 'utf-8')
applied = []
failed = []

# ── PATCH 1: resetCallState — clear all timers + set _endingCall flag ─────────
old_reset = 'resetCallState(){y=null,this.isCallActive=!1,this.isConnecting=!1,this.setActive(!1),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","0")}catch{}this.notifyParentWidgetHide(!1)}'
new_reset = 'resetCallState(){y=null,this.isCallActive=!1,this.isConnecting=!1,this.setActive(!1),this.setConnecting(!1);clearInterval(this._activeCheckInterval);clearInterval(this._keepAliveInterval);clearTimeout(this._activeCheckTimeout);this._activeCheckInterval=null;this._keepAliveInterval=null;this._endingCall=!0;setTimeout(()=>{this._endingCall=!1},8000);try{localStorage.setItem("cw_voice_active","0")}catch{}this.notifyParentWidgetHide(!1)}'
if content.include?(old_reset)
  content = content.sub(old_reset, new_reset); applied << "1:resetCallState"
elsif content.include?('clearInterval(this._keepAliveInterval)')
  applied << "1:resetCallState(already)"
else
  failed << "1:resetCallState NOT FOUND"
end

# ── PATCH 2: _syncCallActiveFromPopup — start keepAlive interval ─────────────
# keepAlive checks: if active=false OR last_heartbeat > 8s old → popup is dead → reset
old_sync = '_syncCallActiveFromPopup(){if(!this.isCallActive){F("Detected alive popup via heartbeat — syncing UI to active"),this.isCallActive=!0,this.isConnecting=!1,this.setActive(!0),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","1")}catch{}this.notifyParentWidgetHide(!0)}}'
new_sync = '_syncCallActiveFromPopup(){if(!this.isCallActive){F("Detected alive popup via heartbeat — syncing UI to active"),this.isCallActive=!0,this.isConnecting=!1,this.setActive(!0),this.setConnecting(!1);try{localStorage.setItem("cw_voice_active","1")}catch{}this.notifyParentWidgetHide(!0);clearInterval(this._keepAliveInterval);this._keepAliveInterval=setInterval(async()=>{if(!this.isCallActive){clearInterval(this._keepAliveInterval);this._keepAliveInterval=null;return;}try{let _ku=X("/api/v1/widget/conversations/voice_call_active");const _cg=this.getCwConversationToken();if(_cg)_ku+="&cw_conversation="+encodeURIComponent(_cg);const{data:_kd}=await j.get(_ku);if(!(_kd&&_kd.active)){console.log("[VOICE-WIDGET] keep-alive: inactive — resetting");this.resetCallState();}else if(_kd.last_heartbeat){const _age=Date.now()-new Date(_kd.last_heartbeat).getTime();if(_age>8000){console.log("[VOICE-WIDGET] keep-alive: heartbeat "+Math.round(_age/1000)+"s stale — popup dead, resetting");this.resetCallState();}else{console.log("[VOICE-WIDGET] keep-alive: ok hbAge="+Math.round(_age/1000)+"s");}}}catch(e){console.warn("[VOICE-WIDGET] keep-alive error",e.message);}},5000)}}'
if content.include?(old_sync)
  content = content.sub(old_sync, new_sync); applied << "2:keepAliveInterval"
elsif content.include?('_keepAliveInterval=setInterval')
  applied << "2:keepAliveInterval(already)"
else
  failed << "2:syncCallActiveFromPopup NOT FOUND"
  i = content.index('_syncCallActiveFromPopup(){')
  puts "DUMP: " + content[[i.to_i, 0].max, 300].inspect
end

# ── PATCH 3: endCall — also call voice_call_ended backend ────────────────────
old_end = 'const e=Z();if(e)try{e.postMessage({type:"request-end-call"})}catch{}this.resetCallState()}'
new_end = 'const e=Z();if(e)try{e.postMessage({type:"request-end-call"})}catch{}this.resetCallState();try{const _u=X("/api/v1/widget/conversations/voice_call_ended"),_g=this.getCwConversationToken();j.post(_u+(_g?"&cw_conversation="+encodeURIComponent(_g):""),{}).catch(()=>{})}catch{}}'
if content.include?(old_end)
  content = content.sub(old_end, new_end); applied << "3:endCallBackend"
elsif content.include?('voice_call_ended')
  applied << "3:endCallBackend(already)"
else
  failed << "3:endCallBackend NOT FOUND"
end

# ── PATCH 4: _checkBackendCallStatus — respect _endingCall flag ──────────────
# Use binary to handle emoji, find and replace the activation branch
content_bin = content.encode('binary', invalid: :replace, undef: :replace)
idx = content_bin.index('a<1e4||l?')
if idx
  chunk = content_bin[idx, 400]
  # Find end of the stale log: ends at first ) after "ignoring"
  ig_idx = chunk.index('ignoring')
  if ig_idx
    close_idx = chunk.index(')', ig_idx)
    old_branch = chunk[0, close_idx + 1]
    new_branch = 'a<1e4||l?this._endingCall?console.log("[VOICE-WIDGET] endingCall skip"):(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(a/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(a/1e3)+"s ignoring")'
    content_bin[idx, old_branch.length] = new_branch
    content = content_bin.encode('utf-8', invalid: :replace, undef: :replace)
    applied << "4:endingCallFlag"
  else
    failed << "4:endingCallFlag(ignoring not found)"
  end
elsif content.include?('endingCall skip')
  applied << "4:endingCallFlag(already)"
else
  failed << "4:endingCallFlag(a<1e4 not found)"
end

File.write(JS_FILE, content)
puts "Applied: #{applied.join(', ')}"
puts "Failed:  #{failed.empty? ? 'none' : failed.join(', ')}"
