const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
// Increased JSON body limit to 50mb to handle larger payloads
app.use(express.json({ limit: '50mb' }));

// --- REMOVED LIMITS for maximum throughput ---
// const MAX_BRAINROTS = 200;
// const MAX_PLAYERS = 100;
// const MAX_RESPONSE_BRAINROTS = 20; 

// Use Maps for better performance and memory efficiency
const brainrots = new Map();
const activePlayers = new Map();

// Timeouts remain to ensure data eventually expires
const BRAINROT_LIVETIME_MS = 30 * 1000; // 30 seconds
const PLAYER_TIMEOUT_MS = 30 * 1000;    // 30 seconds

function now() {
  return Date.now();
}

// Optimized cleanup: Only removes players by time, no size limit enforcement.
function cleanupInactivePlayers() {
  const cutoff = now() - PLAYER_TIMEOUT_MS;
  
  for (const [key, player] of activePlayers) {
    if (player.lastSeen < cutoff) {
      activePlayers.delete(key);
    }
  }
}

// Optimized cleanup: Only removes brainrots by time, no size limit enforcement.
function cleanupOldBrainrots() {
  const livetimeCutoff = now() - BRAINROT_LIVETIME_MS;

  for (const [key, br] of brainrots) {
    if (br.lastSeen < livetimeCutoff) {
      brainrots.delete(key);
    }
  }
}

// Minimal player heartbeat - optimized for speed
app.post('/players/heartbeat', (req, res) => {
  const { username, serverId, jobId, placeId } = req.body;
  
  if (!username || !serverId || !jobId) {
    // Fast exit for invalid data
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
  
  // No cleanup call here to respond as fast as possible. Cleanup is handled by the interval.
  res.json({ success: true });
});

// Active players endpoint - no response limit
app.get('/players/active', (req, res) => {
  // Run cleanup just before sending to ensure data is fresh
  cleanupInactivePlayers();
  
  const allPlayers = Array.from(activePlayers.values()).map(player => ({
    username: player.username,
    serverId: player.serverId,
    jobId: player.jobId,
    placeId: player.placeId,
    secondsSinceLastSeen: Math.floor((now() - player.lastSeen) / 1000)
  }));
  
  res.json(allPlayers);
});

// Brainrots endpoint - optimized for fast ingestion
app.post('/brainrots', (req, res) => {
  const data = req.body;

  let name = typeof data.name === "string" ? data.name.trim() : "";
  let serverId = typeof data.serverId === "string" ? data.serverId.trim() : "";
  let jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";

  if (!name || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }

  const source = req.ip?.includes('railway') || req.headers['x-forwarded-for']?.includes('railway') ? 'bot' : 'lua';
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;

  const entry = {
    name: name,
    serverId: serverId,
    jobId: jobId,
    players: data.players,
    moneyPerSec: data.moneyPerSec,
    lastSeen: now(),
    active: true,
    source: source
  };

  brainrots.set(key, entry);

  // No cleanup call here to respond as fast as possible. Cleanup is handled by the interval.
  res.json({ success: true });
});

// Brainrots getter - no response limit
app.get('/brainrots', (req, res) => {
  // Run cleanup just before sending to ensure data is fresh
  cleanupOldBrainrots();

  const activeBrainrots = [];
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
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

  // Sort by newest first, but send everything
  activeBrainrots.sort((a, b) => b.lastSeen - a.lastSeen);

  res.json(activeBrainrots);
});

// Debug endpoint with no limits
app.get('/brainrots/debug', (req, res) => {
  cleanupOldBrainrots();

  let activeCount = 0;
  let expiredCount = 0;
  const activeList = [];
  
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
      activeCount++;
      activeList.push({
        name: br.name,
        serverId: br.serverId.substring(0, 8) + '...',
        jobId: br.jobId.substring(0, 8) + '...',
        players: br.players,
        moneyPerSec: br.moneyPerSec,
        secondsSinceLastSeen: Math.floor((now() - br.lastSeen) / 1000)
      });
    } else {
      expiredCount++;
    }
  }

  const debugData = {
    summary: {
      totalStored: brainrots.size,
      activeCount: activeCount,
      expiredCount: expiredCount,
      limits: {
        maxBrainrots: "Unlimited",
        maxPlayers: "Unlimited"
      }
    },
    active: activeList
  };

  res.json(debugData);
});

// Stats endpoint reflecting unlimited nature
app.get('/brainrots/stats', (req, res) => {
  let activeCount = 0;
  let luaCount = 0;
  let botCount = 0;
  
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
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
      brainrots: `${brainrots.size} (Unlimited)`,
      players: `${activePlayers.size} (Unlimited)`
    }
  });
});

// Admin endpoints
app.delete('/brainrots', (req, res) => {
  const count = brainrots.size;
  brainrots.clear();
  res.json({ success: true, cleared: count });
});

app.patch('/brainrots/leave', (req, res) => {
  let { name, serverId, jobId } = req.body;
  name = typeof name === "string" ? name.trim() : "";
  serverId = typeof serverId === "string" ? serverId.trim() : "";
  jobId = typeof jobId === "string" ? jobId.trim() : "";

  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  brainrots.delete(key);

  res.json({ success: true });
});

// Health check root page
app.get('/', (req, res) => {
  let activeCount = 0;
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) activeCount++;
  }
  
  res.send(`
    <h1>🧠 Unchained Brainrot Backend</h1>
    <p><strong>Active Brainrots:</strong> ${activeCount}</p>
    <p><strong>Active Players:</strong> ${activePlayers.size}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
    <hr>
    <p><em>Limits have been removed for maximum performance. Monitor memory usage.</em></p>
    <hr>
    <p><a href="/brainrots">📊 View Active Brainrots</a></p>
    <p><a href="/players/active">👥 View Active Players</a></p>
    <p><a href="/brainrots/debug">🔍 Debug Data</a></p>
    <p><a href="/brainrots/stats">📈 Statistics</a></p>
  `);
});

// Aggressive cleanup interval to manage memory from expired items
setInterval(() => {
  cleanupOldBrainrots();
  cleanupInactivePlayers();
}, 1000); // Shortened to 1 second for faster cleanup

// Force garbage collection if available
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 10000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Unchained Brainrot Backend running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📊 Memory limits: UNLIMITED`);
  console.log(`[${new Date().toISOString()}] ⏱️ Timeouts: 30s brainrot lifetime, 30s heartbeat`);
  console.log(`[${new Date().toISOString()}] ⚡️ Ready for maximum throughput!`);
});
