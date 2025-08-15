package antibot

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	agents "github.com/monperrus/crawler-user-agents"
	crawlerdetect "github.com/x-way/crawlerdetect"

	"golang.org/x/time/rate"
)

// Middleware implements a multi-layer anti-bot filter:
// - UA checks (libraries + heuristics)
// - Verified search-engine bots via reverse+forward DNS
// - Token-bucket rate limiting per IP (in-memory)
// - Simple risk scoring based on headers + behavior
// - Honeypot trap endpoint
//
// Usage with chi:
//   r := chi.NewRouter()
//   ab := antibot.NewMiddleware(antibot.Config{TrustedHeader: "X-Forwarded-For", AllowVerifiedBots: true})
//   r.Use(ab.Handler())
//   r.Handle(ab.HoneypotPath(), http.HandlerFunc(ab.HoneypotHandler))
//   http.ListenAndServe(":8080", r)
//
// NOTE: In production behind a proxy/CDN, set TrustedHeader to the correct
// client-IP header, e.g. "X-Forwarded-For" or "CF-Connecting-IP".

type Config struct {
	// Rate limiting: requests per second per IP and burst size
	RPS   rate.Limit
	Burst int

	// Path for the honeypot endpoint; default: "/__hp"
	HoneypotPath string

	// Score threshold to block; default: 50
	BlockScore int

	// Whether to block empty or trivially generic UAs; default: true
	BlockEmptyUA bool

	// When true, allow verified Google/Bing/Facebook bots even if they exceed limits
	AllowVerifiedBots bool

	// Header used to fetch real client IP (optional)
	TrustedHeader string // e.g. "CF-Connecting-IP" or "X-Forwarded-For"

	// Optional: If set, these paths are exempted from checks (healthz, metrics, etc.)
	BypassPrefixes []string

	// Optional custom logger
	Logger func(format string, args ...any)
}

func defaultConfig(c Config) Config {
	if c.RPS <= 0 {
		c.RPS = 1
	}
	if c.Burst <= 0 {
		c.Burst = 5
	}
	if c.HoneypotPath == "" {
		c.HoneypotPath = "/__hp"
	}
	if c.BlockScore <= 0 {
		c.BlockScore = 50
	}
	if c.BlockEmptyUA == false {
		c.BlockEmptyUA = true
	}
	return c
}

type limiterEntry struct {
	Limiter  *rate.Limiter
	LastSeen time.Time
}

type Middleware struct {
	cfg      Config
	visitors map[string]*limiterEntry
	mu       sync.Mutex
}

func NewMiddleware(cfg Config) *Middleware {
	cfg = defaultConfig(cfg)
	m := &Middleware{cfg: cfg, visitors: make(map[string]*limiterEntry)}
	go m.gcLoop()
	return m
}

func (m *Middleware) gcLoop() {
	// cleanup idle IP buckets every 10 minutes
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for range t.C {
		cut := time.Now().Add(-20 * time.Minute)
		m.mu.Lock()
		for ip, le := range m.visitors {
			if le.LastSeen.Before(cut) {
				delete(m.visitors, ip)
			}
		}
		m.mu.Unlock()
	}
}

func (m *Middleware) getLimiter(ip string) *rate.Limiter {
	m.mu.Lock()
	defer m.mu.Unlock()
	le, ok := m.visitors[ip]
	if !ok {
		le = &limiterEntry{Limiter: rate.NewLimiter(m.cfg.RPS, m.cfg.Burst)}
		m.visitors[ip] = le
	}
	le.LastSeen = time.Now()
	return le.Limiter
}

// Wrap returns a http.Handler that enforces anti-bot checks before next.
func (m *Middleware) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// bypass rules
		for _, p := range m.cfg.BypassPrefixes {
			if strings.HasPrefix(r.URL.Path, p) {
				next.ServeHTTP(w, r)
				return
			}
		}
		if r.URL.Path == m.cfg.HoneypotPath {
			// Let the dedicated handler deal with it
			next.ServeHTTP(w, r)
			return
		}

		ua := strings.ToLower(strings.TrimSpace(r.Header.Get("User-Agent")))
		ip := clientIP(r, m.cfg.TrustedHeader)

		// Verified search-engine bots get special handling
		if m.cfg.AllowVerifiedBots {
			if (strings.Contains(ua, "googlebot") && verifyGooglebot(ip)) ||
				(strings.Contains(ua, "bingbot") && verifyBingbot(ip)) ||
				((strings.Contains(ua, "facebookexternalhit") || strings.Contains(ua, "facebot")) && verifyFacebook(ip)) {
				next.ServeHTTP(w, r)
				return
			}
		}

		// Library-based crawler detection
		if ua == "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" || strings.Contains(ua, "facebookexternalhit") {
			http.Error(w, "Bots not allowed", http.StatusForbidden)
			return
		}
		if crawlerdetect.IsCrawler(ua) || agents.IsCrawler(ua) {
			http.Error(w, "Bots not allowed", http.StatusForbidden)
			return
		}

		// Heuristic UA checks
		if m.cfg.BlockEmptyUA && (ua == "" || ua == "mozilla/5.0") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(ua, "curl/") || strings.HasPrefix(ua, "wget/") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

		// Rate limiting
		if !m.getLimiter(ip).Allow() {
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			m.logf("rate_limited ip=%s path=%s ua=%q", ip, r.URL.Path, r.Header.Get("User-Agent"))
			return
		}

		// Risk scoring
		score := botScore(r)
		if score >= m.cfg.BlockScore {
			http.Error(w, "Denied", http.StatusForbidden)
			m.logf("blocked score=%d ip=%s path=%s ua=%q", score, ip, r.URL.Path, r.Header.Get("User-Agent"))
			return
		}

		next.ServeHTTP(w, r)
	})
}

// Handler exposes the middleware in chi-style signature: r.Use(ab.Handler())
func (m *Middleware) Handler() func(http.Handler) http.Handler { return m.Wrap }

// HoneypotPath returns the configured honeypot path for easy mounting
func (m *Middleware) HoneypotPath() string { return m.cfg.HoneypotPath }

func (m *Middleware) logf(format string, args ...any) {
	if m.cfg.Logger != nil {
		m.cfg.Logger(format, args...)
	}
}

// HoneypotHandler: if a client touches this path, set a marker cookie and respond 404.
func (m *Middleware) HoneypotHandler(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "__hp", Value: "1", Path: "/", MaxAge: 86400, HttpOnly: true})
	http.NotFound(w, r)
}

// --- Helpers ---

func clientIP(r *http.Request, trustedHeader string) string {
	if trustedHeader != "" {
		if v := r.Header.Get(trustedHeader); v != "" {
			// X-Forwarded-For may contain a list
			parts := strings.Split(v, ",")
			return strings.TrimSpace(parts[0])
		}
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func isSuspiciousUA(ua string) bool {
	u := strings.TrimSpace(strings.ToLower(ua))
	if u == "" || u == "mozilla/5.0" {
		return true
	}
	if strings.HasPrefix(u, "curl/") || strings.HasPrefix(u, "wget/") {
		return true
	}
	return false
}

func botScore(r *http.Request) int {
	score := 0
	ua := r.Header.Get("User-Agent")
	if isSuspiciousUA(ua) {
		score += 40
	}
	// Very bare Accept headers are often non-browser
	acc := strings.ToLower(r.Header.Get("Accept"))
	if acc != "" && !strings.Contains(acc, "text/html") && !strings.Contains(acc, "application/json") {
		score += 10
	}
	// Missing Accept-Language is a mild signal
	if r.Header.Get("Accept-Language") == "" {
		score += 10
	}
	// Honeypot cookie set earlier => strong signal
	if _, err := r.Cookie("__hp"); err == nil {
		score += 100
	}
	return score
}

// --- Verified bot checks ---

func verifyGooglebot(ip string) bool {
	return verifyHostSuffix(ip, ".googlebot.com.") || verifyHostSuffix(ip, ".google.com.")
}

func verifyBingbot(ip string) bool {
	return verifyHostSuffix(ip, ".search.msn.com.")
}

func verifyFacebook(ip string) bool {
	// facebookexternalhit / facebot typically resolve under facebook.com
	return verifyHostSuffix(ip, ".facebook.com.") || verifyHostSuffix(ip, ".tfbnw.net.")
}

func verifyHostSuffix(ip, suffix string) bool {
	ptrs, err := net.LookupAddr(ip)
	if err != nil {
		return false
	}
	for _, h := range ptrs {
		if strings.HasSuffix(h, suffix) {
			// forward-confirmation
			ips, err := net.LookupHost(h)
			if err != nil {
				continue
			}
			for _, fip := range ips {
				if fip == ip {
					return true
				}
			}
		}
	}
	return false
}
