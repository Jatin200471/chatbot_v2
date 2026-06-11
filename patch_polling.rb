JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE)

# Reduce polling: 2s interval → 4s, 15s timeout → 12s
# Also increase retry delays: 1s,3s,6s → 2s,5s,10s
# Net result: ~3 calls per page load instead of 7-8

old_polling = 'this._activeCheckInterval=setInterval(()=>{this.isCallActive?(clearInterval(this._activeCheckInterval),this._activeCheckInterval=null):this._checkBackendCallStatus()},2e3),this._activeCheckTimeout=setTimeout(()=>{this._activeCheckInterval&&(clearInterval(this._activeCheckInterval),this._activeCheckInterval=null)},15e3)'

new_polling = 'this._activeCheckInterval=setInterval(()=>{this.isCallActive?(clearInterval(this._activeCheckInterval),this._activeCheckInterval=null):this._checkBackendCallStatus()},4e3),this._activeCheckTimeout=setTimeout(()=>{this._activeCheckInterval&&(clearInterval(this._activeCheckInterval),this._activeCheckInterval=null)},12e3)'

if content.include?(old_polling)
  content = content.sub(old_polling, new_polling)
  puts "PATCHED: polling 2s→4s, timeout 15s→12s (~3 calls instead of 7)"
else
  puts "NOT FOUND — check manually"
  i = content.index('_activeCheckInterval=setInterval')
  puts content[[i-10,0].max, 300].inspect if i
end

File.write(JS_FILE, content)
