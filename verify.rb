content = File.read('/app/public/vite/assets/Messages-CiLd_mvQ.js')
puts 'popup v=2: ' + content.include?('voice-popup.html?v=2').to_s
puts 'guard hbAge2: ' + content.include?('hbAge2').to_s
puts 'checkStatus hbAge: ' + content.include?('hbAge<1e4').to_s
puts 'localStorage r&& removed: ' + (!content.include?('r&&Date.now()-r<5e3')).to_s
