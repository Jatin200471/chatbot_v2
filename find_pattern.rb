content = File.read('/app/public/vite/assets/Messages-CiLd_mvQ.js')
# Find all occurrences of cw_voice_popup_heartbeat
idx = 0
count = 0
while (i = content.index('cw_voice_popup_heartbeat', idx))
  count += 1
  puts "Occurrence #{count} at #{i}:"
  puts content[i-20, 200]
  puts "---"
  idx = i + 1
end
puts "Total: #{count}"
