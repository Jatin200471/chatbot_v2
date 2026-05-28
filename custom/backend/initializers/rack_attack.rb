# Custom Rack::Attack configuration
#
# TWO-LAYER defence:
#
#   Layer 1 — IP based  (DoS / flood protection)
#     • Any IP making > 500 requests / minute is a bot/attacker → block it.
#     • Covers unauthenticated floods before a token even exists.
#
#   Layer 2 — User based (per-visitor conversation limit)
#     • Each widget visitor (X-Auth-Token) can create max 50 conversations/hour.
#     • Messages are UNLIMITED — no throttle on message sending.
#
# To unblock from Rails console:
#   # By IP:
#   keys = $redis_client.keys("rack::attack*ATTACKER_IP*")
#   keys.each { |k| $redis_client.del(k) }
#
#   # By user token:
#   keys = $redis_client.keys("rack::attack*AUTH_TOKEN*")
#   keys.each { |k| $redis_client.del(k) }

# ── LAYER 1: IP throttle — DoS / flood protection ────────────────────────────
# 500 requests per minute per IP is extremely generous for a real user.
# A bot / DoS tool will hit this instantly.
Rack::Attack.throttle('ip/dos_protection', limit: 500, period: 1.minute) do |req|
  req.ip unless req.ip == '127.0.0.1' || req.ip == '::1'
end

# ── LAYER 2: User throttle — conversation creation limit ─────────────────────
# Each widget visitor (identified by X-Auth-Token) can create max 50
# conversations per hour. Messages are NOT limited — only conversation creation.
Rack::Attack.throttle('widget/user/conversation_create', limit: 50, period: 1.hour) do |req|
  if req.path == '/api/v1/widget/conversations' && req.post?
    req.get_header('HTTP_X_AUTH_TOKEN').presence
  end
end

# ── Safelist: localhost always allowed ────────────────────────────────────────
Rack::Attack.safelist('allow-localhost') do |req|
  req.ip == '127.0.0.1' || req.ip == '::1'
end

# ── Clean JSON 429 response ───────────────────────────────────────────────────
Rack::Attack.throttled_responder = lambda do |env|
  match_data  = env['rack.attack.match_data']
  match_name  = env['rack.attack.matched']

  message = if match_name == 'widget/user/conversation_create'
    'Conversation limit reached. Max 50 conversations per hour allowed.'
  else
    'Too many requests. Please slow down.'
  end

  headers = {
    'Content-Type' => 'application/json',
    'Retry-After'  => match_data[:period].to_s,
  }
  body = { error: message, retry_after_seconds: match_data[:period] }.to_json

  [429, headers, [body]]
end
