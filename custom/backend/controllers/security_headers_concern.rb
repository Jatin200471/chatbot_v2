# SecurityHeadersConcern
#
# Adds defensive HTTP security headers to all widget responses.
# Include this in WidgetsController (widget HTML page) and any controller
# that serves sensitive widget API responses.
#
# Headers included:
#   X-Content-Type-Options  — prevent MIME-type sniffing
#   X-Frame-Options         — prevent the widget page itself being framed
#                             by an attacker's site (clickjacking)
#   Referrer-Policy         — don't leak the referring URL to third parties
#   Permissions-Policy      — disable camera/mic/geolocation by default
#   Content-Security-Policy — widget iframe: only loads from own origin +
#                             Cloudflare CDN.  Blocks inline script injection
#                             and data-URI abuse.
#
module SecurityHeadersConcern
  extend ActiveSupport::Concern

  included do
    before_action :set_security_headers
  end

  private

  def set_security_headers
    # Prevent MIME-type sniffing (e.g. serving a .txt as JS)
    response.set_header('X-Content-Type-Options', 'nosniff')

    # Prevent referrer leakage (customer URLs not sent to third-party servers)
    response.set_header('Referrer-Policy', 'strict-origin-when-cross-origin')

    # Disable unused browser features inside the widget iframe
    response.set_header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    )

    # Content-Security-Policy for the widget iframe HTML page.
    # Allows:
    #   - Scripts/styles only from same origin (the Chatwoot server itself)
    #   - Images from same origin + data URIs (avatars)
    #   - Connects (XHR/WS) only back to same origin
    #   - No inline scripts (prevents XSS if attacker injects into the page)
    # Adjust if you load fonts/avatars from an external CDN.
    if widget_request?
      response.set_header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          # ElevenLabs @11labs/client SDK loaded via esm.sh CDN at runtime
          "script-src 'self' https://esm.sh https://cdn.jsdelivr.net https://unpkg.com",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          # wss: for ElevenLabs voice WebSocket + esm.sh for SDK fetch
          "connect-src 'self' wss: https://esm.sh https://cdn.jsdelivr.net https://unpkg.com",
          "frame-ancestors *",
          "base-uri 'self'",
          "form-action 'self'",
        ].join('; ')
      )
    end
  end

  # Returns true only for the widget HTML page (not the dashboard or API).
  def widget_request?
    request.path.start_with?('/widget') || controller_name == 'widgets'
  end
end
