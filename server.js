const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting - simple in-memory store
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 30; // 30 requests per minute per IP

function isRateLimited(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    if (!requestCounts.has(ip)) {
        requestCounts.set(ip, []);
    }
    
    const requests = requestCounts.get(ip);
    // Remove old requests outside the window
    const recentRequests = requests.filter(time => time > windowStart);
    requestCounts.set(ip, recentRequests);
    
    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        return true;
    }
    
    // Add current request
    recentRequests.push(now);
    return false;
}

// Store: { "<serverId>_<name>_<jobId>": { name, serverId, jobId, lastSeen, active, lastIP, source } }
const brainrots = {};
const BRAINROT_LIVETIME_MS = 300 * 1000; // 5 minutes
const HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60 seconds

function now() {
  return Date.now();
}

// Cleanup: mark stale active as inactive, delete old inactive
function cleanupOldBrainrots() {
  const nowTime = now();
  const heartbeatCutoff = nowTime - HEARTBEAT_TIMEOUT_MS;
  const livetimeCutoff = nowTime - BRAINROT_LIVETIME_MS;
  
  let markedInactive = 0;
  let deleted = 0;
  
  for (const key in brainrots) {
    const br = brainrots[key];
    if (br.active && br.lastSeen < heartbeatCutoff) {
      br.active = false;
      markedInactive++;
    }
    if (!br.active && br.lastSeen < livetimeCutoff) {
      delete brainrots[key];
      deleted++;
    }
  }
  
  if (markedInactive > 0 || deleted > 0) {
    console.log(`[${new Date().toISOString()}] Cleanup: ${markedInactive} marked inactive, ${deleted} deleted`);
  }
}

// POST /brainrots - update or add a brainrot (heartbeat from client/discord bot)
app.post('/brainrots', (req, res) => {
  // Rate limiting check
  if (isRateLimited(req.ip)) {
    console.warn(`[${new Date().toISOString()}] Rate limited: ${req.ip}`);
    return res.status(429).json({ error: "Too many requests. Please slow down." });
  }

  let { name, serverId, jobId } = req.body;

  // Normalize input: force string and trim
  name = typeof name === "string" ? name.trim() : "";
  serverId = typeof serverId === "string" ? serverId.trim() : "";
  jobId = typeof jobId === "string" ? jobId.trim() : "";

  if (!name || !serverId || !jobId) {
    console.warn(`[${new Date().toISOString()}] Bad /brainrots POST from ${req.ip}:`, req.body);
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }

  // Determine source based on IP or other factors
  const source = req.ip?.includes('railway') || req.headers['x-forwarded-for']?.includes('railway') ? 'discord-bot' : 'lua-script';
  
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  const isNewEntry = !brainrots[key];
  
  // Prevent spam - if same brainrot was updated less than 5 seconds ago, ignore
  if (brainrots[key] && (now() - brainrots[key].lastSeen) < 5000) {
    return res.json({ success: true, ignored: true });
  }
  
  brainrots[key] = {
    name,
    serverId,
    jobId,
    lastSeen: now(),
    active: true,
    lastIP: req.ip,
    source: source,
    firstSeen: brainrots[key]?.firstSeen || now()
  };
  
  cleanupOldBrainrots();
  
  const logPrefix = `[${new Date().toISOString()}]`;
  const status = isNewEntry ? '✅ NEW' : '🔄 UPDATE';
  console.log(`${logPrefix} ${status} Heartbeat (${source}):`, { name, serverId: serverId.substring(0, 8) + '...', jobId: jobId.substring(0, 8) + '...' });
  
  res.json({ success: true });
});

// GET /brainrots - returns active brainrots
app.get('/brainrots', (req, res) => {
  // Rate limiting check for GET requests too
  if (isRateLimited(req.ip)) {
    console.warn(`[${new Date().toISOString()}] Rate limited GET: ${req.ip}`);
    return res.status(429).json({ error: "Too many requests. Please slow down." });
  }

  cleanupOldBrainrots();
  
  const activeBrainrots = Object.values(brainrots)
    .filter(br => br.active)
    .map(({ name, serverId, jobId }) => ({
      name,
      serverId,
      jobId
    }));
  
  console.log(`[${new Date().toISOString()}] GET /brainrots - returning ${activeBrainrots.length} active brainrots to ${req.ip}`);
  
  res.json(activeBrainrots);
});

// GET /brainrots/debug - debug endpoint to see all data
app.get('/brainrots/debug', (req, res) => {
  cleanupOldBrainrots();
  
  const totalStored = Object.keys(brainrots).length;
  const active = Object.values(brainrots).filter(br => br.active);
  const inactive = Object.values(brainrots).filter(br => !br.active);
  
  const debugData = {
    summary: {
      totalStored,
      activeCount: active.length,
      inactiveCount: inactive.length,
      lastCleanup: new Date().toISOString()
    },
    rateLimiting: {
      activeIPs: requestCounts.size,
      windowMinutes: RATE_LIMIT_WINDOW / 60000,
      maxRequestsPerWindow: MAX_REQUESTS_PER_MINUTE
    },
    active: active.slice(0, 10).map(br => ({ // Only show first 10 to avoid spam
      ...br,
      secondsSinceLastSeen: Math.floor((now() - br.lastSeen) / 1000),
      serverId: br.serverId.substring(0, 8) + '...',
      jobId: br.jobId.substring(0, 8) + '...'
    }))
  };
  
  res.json(debugData);
});

// GET /brainrots/stats - simple stats endpoint
app.get('/brainrots/stats', (req, res) => {
  cleanupOldBrainrots();
  
  const active = Object.values(brainrots).filter(br => br.active);
  const bySource = active.reduce((acc, br) => {
    acc[br.source] = (acc[br.source] || 0) + 1;
    return acc;
  }, {});
  
  res.json({
    totalActive: active.length,
    bySource,
    uptime: process.uptime(),
    lastUpdate: Math.max(...active.map(br => br.lastSeen))
  });
});

// DELETE /brainrots - clear all (admin/testing)
app.delete('/brainrots', (req, res) => {
  const count = Object.keys(brainrots).length;
  for (const key in brainrots) delete brainrots[key];
  console.log(`[${new Date().toISOString()}] 🗑️ Admin cleared ${count} brainrots from ${req.ip}`);
  res.json({ success: true, cleared: count });
});

// PATCH /brainrots/leave - mark as inactive (call this on player leave or pet despawn)
app.patch('/brainrots/leave', (req, res) => {
  let { name, serverId, jobId } = req.body;
  name = typeof name === "string" ? name.trim() : "";
  serverId = typeof serverId === "string" ? serverId.trim() : "";
  jobId = typeof jobId === "string" ? jobId.trim() : "";
  
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  if (brainrots[key]) {
    brainrots[key].active = false;
    brainrots[key].lastSeen = now();
    console.log(`[${new Date().toISOString()}] 👋 Marked inactive: ${name} from ${req.ip}`);
  }
  
  res.json({ success: true });
});

// Health check
app.get('/', (req, res) => {
  const activeCount = Object.values(brainrots).filter(br => br.active).length;
  res.send(`
    <h1>🧠 Brainrot Backend is Running!</h1>
    <p><strong>Active Brainrots:</strong> ${activeCount}</p>
    <p><strong>Server Time:</strong> ${new Date().toISOString()}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
    <p><strong>Rate Limit:</strong> ${MAX_REQUESTS_PER_MINUTE} requests/minute per IP</p>
    <hr>
    <p><a href="/brainrots">📊 View Active Brainrots</a></p>
    <p><a href="/brainrots/debug">🔍 Debug Data</a></p>
    <p><a href="/brainrots/stats">📈 Statistics</a></p>
  `);
});

// Cleanup task every 30 seconds
setInterval(() => {
  cleanupOldBrainrots();
}, 30000);

// Clear old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW;
  for (const [ip, requests] of requestCounts.entries()) {
    const recentRequests = requests.filter(time => time > cutoff);
    if (recentRequests.length === 0) {
      requestCounts.delete(ip);
    } else {
      requestCounts.set(ip, recentRequests);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Brainrot Backend Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📊 Rate limit: ${MAX_REQUESTS_PER_MINUTE} requests/minute per IP`);
});
