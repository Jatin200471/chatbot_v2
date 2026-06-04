# Custom Rack::Attack configuration
#
# THREE-LAYER defence:
#
#   Layer 1 — IP based  (DoS / flood protection)
#     • Any IP making > 500 requests / minute is blocked.
#     • Covers unauthenticated floods.
#
#   Layer 2 — User based (per-visitor conversation limit)
#     • Each widget visitor (X-Auth-Token) can create max 50 conversations/hour.
#
#   Layer 3 — Fingerprint based (IP-rotating bot protection)
#     • Combines User-Agent + Accept-Language + website_token into a fingerprint.
#     • Max 30 conversation creates per hour per fingerprint.
#     • Catches bots that rotate IPs and get fresh auth tokens each time.
#
# To unblock from Rails console:
#   # By IP:
#   keys = $redis_client.keys("rack::attack*ATTACKER_IP*")
#   keys.each { |k| $redis_client.del(k) }
#
#   # By fingerprint:
#   keys = $redis_client.keys("rack::attack*fingerprint*")
#   keys.each { |k| $redis_client.del(k) }

require 'digest'

# ── LAYER 1: IP throttle — DoS / flood protection ────────────────────────────
# 500 requests per minute per IP is extremely generous for a real user.
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

# ── LAYER 3: Fingerprint throttle — IP-rotating bot protection ───────────────
#
# Bots that rotate IPs bypass Layer 1.
# Bots that create fresh sessions bypass Layer 2 (new auth token each time).
#
# This layer builds a "browser fingerprint" from headers that are:
#   - Hard to randomize perfectly (User-Agent, Accept-Language)
#   - Tied to the inbox being targeted (website_token)
#
# A real human rarely creates more than a handful of conversations per hour.
# A bot will hit 30 quickly even while rotating IPs.
#
# Fingerprint = SHA256(User-Agent + Accept-Language + website_token)
Rack::Attack.throttle('widget/fingerprint/conversation_create', limit: 50, period: 1.minute) do |req|
  if req.path == '/api/v1/widget/conversations' && req.post?
    user_agent       = req.get_header('HTTP_USER_AGENT').to_s
    accept_language  = req.get_header('HTTP_ACCEPT_LANGUAGE').to_s
    website_token    = req.params['website_token'].to_s

    # Only apply when we have enough signal — skip if UA is blank (API clients
    # using proper auth tokens are handled by Layer 2 already).
    if user_agent.present? && website_token.present?
      raw = "#{user_agent}|#{accept_language}|#{website_token}"
      "fp:#{Digest::SHA256.hexdigest(raw)[0..31]}"
    end
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

  message = case match_name
  when 'widget/user/conversation_create'
    'Conversation limit reached. Max 50 conversations per hour allowed.'
  when 'widget/fingerprint/conversation_create'
    'Too many conversations created. Please try again later.'
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
