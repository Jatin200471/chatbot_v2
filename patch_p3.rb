content = File.read('/app/public/vite/assets/Messages-CiLd_mvQ.js')

# Find the full pattern using the alt match approach
m = content.match(/const r=parseInt\(localStorage[^;]+;r&&Date[^?]+\?[^:]+:[^}]+/)

if m
  old_str = m[0]
  puts "Old (#{old_str.length} chars): #{old_str[0..120]}"

  new_str = 'const hbAge=n.last_heartbeat?Date.now()-new Date(n.last_heartbeat).getTime():Infinity;hbAge<1e4||l?(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(hbAge/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(hbAge/1e3)+"s ignoring")'

  new_content = content.sub(old_str, new_str)
  File.write('/app/public/vite/assets/Messages-CiLd_mvQ.js', new_content)
  puts "PATCHED OK"
else
  puts "PATTERN NOT FOUND - dumping context around idx 12100"
  puts content[12100, 200].bytes.map{|b| b > 127 ? "\\x#{b.to_s(16)}" : b.chr}.join
end
