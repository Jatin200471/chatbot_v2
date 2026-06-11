JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE)

# Add voice_call_ended backend call to endCall() so widget on any page signals the popup
old_end = 'const e=Z();if(e)try{e.postMessage({type:"request-end-call"})}catch{}this.resetCallState()}'
new_end = 'const e=Z();if(e)try{e.postMessage({type:"request-end-call"})}catch{}this.resetCallState();try{const _u=X("/api/v1/widget/conversations/voice_call_ended"),_g=this.getCwConversationToken();j.post(_u+(_g?"&cw_conversation="+encodeURIComponent(_g):""),{}).catch(()=>{})}catch{}}'

if content.include?(old_end)
  content = content.sub(old_end, new_end)
  File.write(JS_FILE, content)
  puts "PATCHED: endCall now calls voice_call_ended backend"
else
  puts "NOT FOUND — dumping actual endCall area:"
  i = content.index('request-end-call"})}catch{}this.resetCallState()')
  puts i ? content[[i-20,0].max, 200].inspect : "pattern not found"
end
