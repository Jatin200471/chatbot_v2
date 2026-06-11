JS_FILE = '/app/public/vite/assets/Messages-tfC4zP5w.js'
content = File.read(JS_FILE, encoding: 'binary')

# Find a<1e4||l? and replace the full branch without caring about emoji
idx = content.index('a<1e4||l?')
if idx
  # Find the extent: ends at the closing paren of console.log("...ignoring")
  chunk = content[idx, 600]
  puts "Chunk: " + chunk[0,200].bytes.map{|b| b>127 ? "\\x#{b.to_s(16)}" : b.chr}.join

  # Find the exact end by counting: everything up to and including "s old ...ignoring")"
  # We'll just replace from idx to the next }else
  end_marker = ')}'
  end_idx = chunk.index('):console.log(')
  if end_idx
    # Find closing of the stale console.log
    stale_start = idx + end_idx + 2  # skip ):
    chunk2 = content[stale_start, 200]
    stale_end = chunk2.index(')')
    if stale_end
      full_old = content[idx, end_idx + 2 + stale_end + 1]
      new_str = 'a<1e4||l?this._endingCall?console.log("[VOICE-WIDGET] endingCall skip"):(console.log("[VOICE-WIDGET] ACTIVE hbAge="+Math.round(a/1e3)+"s"),this._syncCallActiveFromPopup()):console.log("[VOICE-WIDGET] stale hbAge="+Math.round(a/1e3)+"s ignoring")'
      content[idx, full_old.length] = new_str.encode('binary')
      File.write(JS_FILE, content, encoding: 'binary')
      puts "PATCHED! Replaced #{full_old.length} bytes"
    else
      puts "stale_end not found"
    end
  else
    puts "end_marker not found in chunk"
  end
else
  puts "a<1e4||l? not found at all"
end
