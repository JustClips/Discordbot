const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Ultra-strict memory limits
const MAX_BRAINROTS = 50;     // Reduced from 200 to 50
const MAX_PLAYERS = 100;

// Use Maps for better performance and memory efficiency
const brainrots = new Map();
const activePlayers = new Map();

// Keep your original timeouts
const BRAINROT_LIVETIME_MS = 30 * 1000; // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30 seconds
const PLAYER_TIMEOUT_MS = 30 * 1000;    // 30 seconds

// Limit for response size
const MAX_RESPONSE_BRAINROTS = 20; // Only send top 20 brainrots

function now() {
  return Date.now();
}

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

// Ultra-optimized brainrot cleanup - DELETE AFTER 30 SECONDS
function cleanupOldBrainrots() {
  const nowTime = now();
  const livetimeCutoff = nowTime - BRAINROT_LIVETIME_MS;

  let deleted = 0;

  // DELETE ALL expired brainrots
  for (const [key, br] of brainrots) {
    if (br.lastSeen < livetimeCutoff) {
      brainrots.delete(key);
      deleted++;
    }
  }

  // Enforce strict size limit
  if (brainrots.size > MAX_BRAINROTS) {
    const sorted = Array.from(brainrots.entries())
      .sort((a, b) => b[1].lastSeen - a[1].lastSeen); // Sort by newest first
    
    const toRemove = brainrots.size - MAX_BRAINROTS;
    for (let i = 0; i < toRemove; i++) {
      brainrots.delete(sorted[i][0]);
      deleted++;
    }
  }
}

// Minimal player heartbeat - store only essential data
app.post('/players/heartbeat', (req, res) => {
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
app.get('/players/active', (req, res) => {
  cleanupInactivePlayers();
  
  // Limit response size
  const allPlayers = Array.from(activePlayers.values());
  const limitedPlayers = allPlayers.slice(0, 50); // Limit to 50 players
  
  const players = limitedPlayers.map(player => ({
    username: player.username,
    serverId: player.serverId,
    jobId: player.jobId,
    placeId: player.placeId,
    secondsSinceLastSeen: Math.floor((now() - player.lastSeen) / 1000)
  }));
  
  res.json(players);
});

// Brainrots endpoint - brainrots auto-delete after 30 seconds
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

  // Store data - brainrots will be deleted after 30 seconds
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
  cleanupOldBrainrots();

  res.json({ success: true });
});

// Ultra-lightweight brainrots getter - LIMIT RESPONSE SIZE
app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();

  const activeBrainrots = [];
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    // Only return brainrots that are still within 30 seconds
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

  // SORT by newest first and LIMIT response size
  activeBrainrots.sort((a, b) => b.lastSeen - a.lastSeen);
  const limitedBrainrots = activeBrainrots.slice(0, MAX_RESPONSE_BRAINROTS);

  res.json(limitedBrainrots);
});

// Minimal debug endpoint
app.get('/brainrots/debug', (req, res) => {
  cleanupOldBrainrots();

  let activeCount = 0;
  let expiredCount = 0;
  const activeList = [];
  
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
      activeCount++;
      if (activeList.length < 5) { // Reduced from 10 to 5
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
      expiredCount++;
    }
  }

  const debugData = {
    summary: {
      totalStored: brainrots.size,
      activeCount: activeCount,
      expiredCount: expiredCount,
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
      brainrots: `${brainrots.size}/${MAX_BRAINROTS}`,
      players: `${activePlayers.size}/${MAX_PLAYERS}`
    }
  });
});

// Essential admin endpoints only
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

// Ultra-minimal health check
app.get('/', (req, res) => {
  let activeCount = 0;
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) activeCount++;
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
}, 2000);

// Force garbage collection if available
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 10000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Ultra-Optimized Brainrot Backend running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📊 Memory limits: ${MAX_BRAINROTS} brainrots, ${MAX_PLAYERS} players`);
  console.log(`[${new Date().toISOString()}] ⏱️ Timeouts: 30s brainrot lifetime, 30s heartbeat`);
  console.log(`[${new Date().toISOString()}] 📈 Response limits: ${MAX_RESPONSE_BRAINROTS} brainrots per request`);
});
