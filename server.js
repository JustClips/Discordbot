const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const app = express();

// Enable compression first
app.use(compression());

// More reasonable rate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // Increased to 120 requests per minute per IP
  message: { error: 'Too many requests from this IP' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req, res) => {
    // Skip rate limiting for Railway/internal requests
    const ip = req.ip || req.connection.remoteAddress;
    return ip.includes('railway') || ip.includes('localhost');
  }
});

const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Stricter for admin endpoints
  message: { error: 'Too many requests from this IP' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ limit: '128kb' }));

// Ultra-strict memory limits
const MAX_BRAINROTS = 150;
const MAX_PLAYERS = 75;

const brainrots = new Map();
const activePlayers = new Map();

const BRAINROT_LIVETIME_MS = 35 * 1000;
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;
const PLAYER_TIMEOUT_MS = 30 * 1000;

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

function cleanupInactivePlayers() {
  const nowTime = now();
  const cutoff = nowTime - PLAYER_TIMEOUT_MS;
  
  let expired = 0;
  for (const [key, player] of activePlayers) {
    if (player.lastSeen < cutoff) {
      activePlayers.delete(key);
      expired++;
    }
  }
  
  if (activePlayers.size > MAX_PLAYERS) {
    const sorted = Array.from(activePlayers.entries())
      .sort((a, b) => a[1].lastSeen - b[1].lastSeen);
    
    const toRemove = activePlayers.size - MAX_PLAYERS;
    for (let i = 0; i < toRemove; i++) {
      activePlayers.delete(sorted[i][0]);
    }
  }
}

function cleanupOldBrainrots() {
  const nowTime = now();
  const heartbeatCutoff = nowTime - HEARTBEAT_TIMEOUT_MS;
  const livetimeCutoff = nowTime - BRAINROT_LIVETIME_MS;

  let markedInactive = 0;
  let deleted = 0;

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

  if (brainrots.size > MAX_BRAINROTS) {
    const sorted = Array.from(brainrots.entries())
      .sort((a, b) => {
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

// Apply rate limiting only to specific endpoints
app.post('/players/heartbeat', apiLimiter, (req, res) => {
  const { username, serverId, jobId, placeId } = req.body;
  
  if (!username || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing username, serverId, or jobId" });
  }
  
  const key = `${username.toLowerCase()}_${serverId}_${jobId}`;
  
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

app.get('/players/active', apiLimiter, (req, res) => {
  cleanupInactivePlayers();
  
  const players = Array.from(activePlayers.values()).map(player => ({
    u: player.username,
    s: player.serverId,
    j: player.jobId,
    p: player.placeId,
    t: Math.floor((now() - player.lastSeen) / 1000)
  }));
  
  const hash = require('crypto').createHash('md5').update(JSON.stringify(players)).digest('hex');
  res.set('ETag', `"${hash}"`);
  
  if (req.headers['if-none-match'] === `"${hash}"`) {
    return res.status(304).end();
  }
  
  res.json(players);
});

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

  const entry = {
    n: name,
    s: serverId,
    j: jobId,
    p: data.players,
    m: data.moneyPerSec,
    t: now(),
    a: true,
    src: source,
    f: existing?.f || now()
  };

  brainrots.set(key, entry);
  cleanupOldBrainrots();

  res.json({ success: true });
});

app.get('/brainrots', (req, res) => {  // Removed rate limiting from this endpoint
  cleanupOldBrainrots();

  const activeBrainrots = [];
  for (const br of brainrots.values()) {
    if (br.a) {
      activeBrainrots.push({
        n: br.n,
        s: br.s,
        j: br.j,
        p: br.p,
        m: br.m,
        t: br.t,
        src: br.src
      });
    }
  }

  const hash = require('crypto').createHash('md5').update(JSON.stringify(activeBrainrots)).digest('hex');
  res.set('ETag', `"${hash}"`);
  
  if (req.headers['if-none-match'] === `"${hash}"`) {
    return res.status(304).end();
  }

  res.json(activeBrainrots);
});

app.get('/brainrots/debug', strictLimiter, (req, res) => {
  cleanupOldBrainrots();

  let activeCount = 0;
  let inactiveCount = 0;
  const activeList = [];
  
  for (const br of brainrots.values()) {
    if (br.a) {
      activeCount++;
      if (activeList.length < 10) {
        activeList.push({
          n: br.n,
          s: br.s.substring(0, 8) + '...',
          j: br.j.substring(0, 8) + '...',
          p: br.p,
          m: br.m,
          t: Math.floor((now() - br.t) / 1000)
        });
      }
    } else {
      inactiveCount++;
    }
  }

  const debugData = {
    s: {
      t: brainrots.size,
      a: activeCount,
      i: inactiveCount,
      l: {
        b: MAX_BRAINROTS,
        p: MAX_PLAYERS
      }
    },
    a: activeList
  };

  res.json(debugData);
});

app.get('/brainrots/stats', apiLimiter, (req, res) => {
  let activeCount = 0;
  let luaCount = 0;
  let botCount = 0;
  
  for (const br of brainrots.values()) {
    if (br.a) {
      activeCount++;
      if (br.src === 'lua') luaCount++;
      else if (br.src === 'bot') botCount++;
    }
  }

  res.json({
    t: activeCount,
    p: activePlayers.size,
    b: {
      l: luaCount,
      b: botCount
    },
    u: Math.floor(process.uptime()),
    l: {
      b: `${brainrots.size}/${MAX_BRAINROTS}`,
      p: `${activePlayers.size}/${MAX_PLAYERS}`
    }
  });
});

app.delete('/brainrots', strictLimiter, (req, res) => {
  const count = brainrots.size;
  brainrots.clear();
  res.json({ success: true, c: count });
});

app.patch('/brainrots/leave', apiLimiter, (req, res) => {
  let { name, serverId, jobId } = req.body;
  name = typeof name === "string" ? name.trim() : "";
  serverId = typeof serverId === "string" ? serverId.trim() : "";
  jobId = typeof jobId === "string" ? jobId.trim() : "";

  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  const entry = brainrots.get(key);
  
  if (entry) {
    entry.a = false;
    entry.t = now();
  }

  res.json({ success: true });
});

app.get('/', (req, res) => {
  let activeCount = 0;
  for (const br of brainrots.values()) {
    if (br.a) activeCount++;
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

setInterval(() => {
  cleanupOldBrainrots();
  cleanupInactivePlayers();
}, 5000);

if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 15000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Ultra-Optimized Brainrot Backend running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📊 Memory limits: ${MAX_BRAINROTS} brainrots, ${MAX_PLAYERS} players`);
  console.log(`[${new Date().toISOString()}] ⏱️ Timeouts: 35s brainrot livetime, 30s heartbeat`);
});
