const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const app = express();

// Enable compression
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Rate limiting configurations
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Skip rate limiting for internal/Railway requests
    const ip = req.ip || req.connection.remoteAddress;
    return ip?.includes('railway') || ip?.includes('localhost') || ip?.includes('127.0.0.1');
  }
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // Stricter for admin endpoints
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Ultra-strict memory limits
const MAX_BRAINROTS = 200;
const MAX_PLAYERS = 100;

// Use Maps for better performance and memory efficiency
const brainrots = new Map();
const activePlayers = new Map();

// Keep your original timeouts
const BRAINROT_LIVETIME_MS = 35 * 1000; // 35 seconds
const HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30 seconds
const PLAYER_TIMEOUT_MS = 30 * 1000;    // 30 seconds

function now() {
  return Date.now();
}

// Traffic logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms - ${res.get('Content-Length') || 0} bytes`);
  });
  next();
});

// Ultra-optimized cleanup with size enforcement
function cleanupInactivePlayers() {
  const nowTime = now();
  const cutoff = nowTime - PLAYER_TIMEOUT_MS;
  
  // Remove expired players
  let expired = 0;
  for (const [key, player] of activePlayers) {
    if (player.lastSeen < cutoff) {
      activePlayers.delete(key);
      expired++;
    }
  }
  
  // Enforce size limit - remove oldest if over limit
  if (activePlayers.size > MAX_PLAYERS) {
    const sorted = Array.from(activePlayers.entries())
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    
    const toRemove = activePlayers.size - MAX_PLAYERS;
    for (let i = 0; i < toRemove; i++) {
      activePlayers.delete(sorted[i][0]);
    }
  }
}

// Ultra-optimized brainrot cleanup with strict limits
function cleanupOldBrainrots() {
  const nowTime = now();
  const heartbeatCutoff = nowTime - HEARTBEAT_TIMEOUT_MS;
  const livetimeCutoff = nowTime - BRAINROT_LIVETIME_MS;

  let markedInactive = 0;
  let deleted = 0;

  // Mark inactive and delete expired
  for (const [key, br] of brainrots) {
    if (br.active && br.lastSeen < heartbeatCutoff) {
      br.active = false;
      markedInactive++;
    }
    if (!br.active && br.lastSeen < livetimeCutoff) {
      brainrots.delete(key);
      deleted++;
    }
  }

  // Enforce strict size limit
  if (brainrots.size > MAX_BRAINROTS) {
    const sorted = Array.from(brainrots.entries())
      .sort((a, b) => {
        // Prioritize removing inactive first, then oldest
        if (a[1].active !== b[1].active) {
          return a[1].active ? 1 : -1;
        }
        return a[1].lastSeen - b[1].lastSeen;
      });
    
    const toRemove = brainrots.size - MAX_BRAINROTS;
    for (let i = 0; i < toRemove; i++) {
      brainrots.delete(sorted[i][0]);
      deleted++;
    }
  }
}

// Minimal player heartbeat - store only essential data
app.post('/players/heartbeat', apiLimiter, (req, res) => {
  const { username, serverId, jobId, placeId } = req.body;
  
  if (!username || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing username, serverId, or jobId" });
  }
  
  const key = `${username.toLowerCase()}_${serverId}_${jobId}`;
  
  // Store minimal data only
  activePlayers.set(key, {
    username: username,
    serverId: serverId,
    jobId: jobId,
    placeId: placeId || serverId,
    lastSeen: now()
  });
  
  cleanupInactivePlayers();
  
  res.json({ success: true });
});

// Lightweight active players endpoint
app.get('/players/active', apiLimiter, (req, res) => {
  cleanupInactivePlayers();
  
  const players = Array.from(activePlayers.values()).map(player => ({
    username: player.username,
    serverId: player.serverId,
    jobId: player.jobId,
    placeId: player.placeId,
    secondsSinceLastSeen: Math.floor((now() - player.lastSeen) / 1000)
  }));
  
  res.json(players);
});

// Ultra-optimized brainrots endpoint - store only essential data
app.post('/brainrots', apiLimiter, (req, res) => {
  const data = req.body;

  let name = typeof data.name === "string" ? data.name.trim() : "";
  let serverId = typeof data.serverId === "string" ? data.serverId.trim() : "";
  let jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";

  if (!name || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }

  const source = req.ip?.includes('railway') || req.headers['x-forwarded-for']?.includes('railway') ? 'bot' : 'lua';
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  const existing = brainrots.get(key);

  // Store only essential data to minimize memory usage
  const entry = {
    name: name,
    serverId: serverId,
    jobId: jobId,
    players: data.players,
    moneyPerSec: data.moneyPerSec,
    lastSeen: now(),
    active: true,
    source: source,
    firstSeen: existing?.firstSeen || now()
  };

  brainrots.set(key, entry);
  cleanupOldBrainrots();

  res.json({ success: true });
});

// Ultra-lightweight brainrots getter with ETags
app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();

  const activeBrainrots = [];
  for (const br of brainrots.values()) {
    if (br.active) {
      activeBrainrots.push({
        name: br.name,
        serverId: br.serverId,
        jobId: br.jobId,
        players: br.players,
        moneyPerSec: br.moneyPerSec,
        lastSeen: br.lastSeen,
        source: br.source
      });
    }
  }

  // Add ETag support for bandwidth savings
  const hash = require('crypto').createHash('md5').update(JSON.stringify(activeBrainrots)).digest('hex');
  res.set('ETag', `"${hash}"`);
  
  if (req.headers['if-none-match'] === `"${hash}"`) {
    return res.status(304).end(); // Not modified
  }

  res.json(activeBrainrots);
});

// Minimal debug endpoint
app.get('/brainrots/debug', strictLimiter, (req, res) => {
  cleanupOldBrainrots();

  let activeCount = 0;
  let inactiveCount = 0;
  const activeList = [];
  
  for (const br of brainrots.values()) {
    if (br.active) {
      activeCount++;
      if (activeList.length < 10) {
        activeList.push({
          name: br.name,
          serverId: br.serverId.substring(0, 8) + '...',
          jobId: br.jobId.substring(0, 8) + '...',
          players: br.players,
          moneyPerSec: br.moneyPerSec,
          secondsSinceLastSeen: Math.floor((now() - br.lastSeen) / 1000)
        });
      }
    } else {
      inactiveCount++;
    }
  }

  const debugData = {
    summary: {
      totalStored: brainrots.size,
      activeCount: activeCount,
      inactiveCount: inactiveCount,
      limits: {
        maxBrainrots: MAX_BRAINROTS,
        maxPlayers: MAX_PLAYERS
      }
    },
    active: activeList
  };

  res.json(debugData);
});

// Ultra-lightweight stats endpoint
app.get('/brainrots/stats', apiLimiter, (req, res) => {
  let activeCount = 0;
  let luaCount = 0;
  let botCount = 0;
  
  for (const br of brainrots.values()) {
    if (br.active) {
      activeCount++;
      if (br.source === 'lua') luaCount++;
      else if (br.source === 'bot') botCount++;
    }
  }

  res.json({
    totalActive: activeCount,
    totalPlayers: activePlayers.size,
    bySource: {
      lua: luaCount,
      bot: botCount
    },
    uptime: Math.floor(process.uptime()),
    limits: {
      brainrots: `${brainrots.size}/${MAX_BRAINROTS}`,
      players: `${activePlayers.size}/${MAX_PLAYERS}`
    }
  });
});

// Essential admin endpoints only
app.delete('/brainrots', strictLimiter, (req, res) => {
  const count = brainrots.size;
  brainrots.clear();
  res.json({ success: true, cleared: count });
});

app.patch('/brainrots/leave', apiLimiter, (req, res) => {
  let { name, serverId, jobId } = req.body;
  name = typeof name === "string" ? name.trim() : "";
  serverId = typeof serverId === "string" ? serverId.trim() : "";
  jobId = typeof jobId === "string" ? jobId.trim() : "";

  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  const entry = brainrots.get(key);
  
  if (entry) {
    entry.active = false;
    entry.lastSeen = now();
  }

  res.json({ success: true });
});

// Ultra-minimal health check
app.get('/', (req, res) => {
  let activeCount = 0;
  for (const br of brainrots.values()) {
    if (br.active) activeCount++;
  }
  
  res.send(`
    <h1>🧠 Ultra-Optimized Brainrot Backend</h1>
    <p><strong>Active Brainrots:</strong> ${activeCount}/${MAX_BRAINROTS}</p>
    <p><strong>Active Players:</strong> ${activePlayers.size}/${MAX_PLAYERS}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
    <hr>
    <p><a href="/brainrots">📊 View Active Brainrots</a></p>
    <p><a href="/players/active">👥 View Active Players</a></p>
    <p><a href="/brainrots/debug">🔍 Debug Data</a></p>
    <p><a href="/brainrots/stats">📈 Statistics</a></p>
  `);
});

// Aggressive cleanup to prevent memory buildup
setInterval(() => {
  cleanupOldBrainrots();
  cleanupInactivePlayers();
}, 2000); // Every 2 seconds

// Force garbage collection if available
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 10000); // Every 10 seconds
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Ultra-Optimized Brainrot Backend running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📊 Memory limits: ${MAX_BRAINROTS} brainrots, ${MAX_PLAYERS} players`);
  console.log(`[${new Date().toISOString()}] ⏱️ Timeouts: 35s brainrot livetime, 30s heartbeat`);
});
