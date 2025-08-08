const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json({ limit: '512kb' })); // Reduced request size limit

// Strict memory limits to prevent overload
const MAX_BRAINROTS = 300;    // Reduced from unlimited to 300
const MAX_PLAYERS = 150;      // Reduced from unlimited to 150
const MAX_FORCE_JOINS = 30;   // Reduced from unlimited to 30

// Use Maps for better performance and memory efficiency
const brainrots = new Map();
const activePlayers = new Map();
const forceJoinCommands = new Map();

// Keep your original timeouts
const BRAINROT_LIVETIME_MS = 35 * 1000; // 35 seconds
const HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30 seconds
const PLAYER_TIMEOUT_MS = 30 * 1000;    // 30 seconds
const FORCE_JOIN_EXPIRE_MS = 60 * 1000; // 60 seconds

function now() {
  return Date.now();
}

// Optimized cleanup with size enforcement
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
  
  if (expired > 0) {
    console.log(`[${new Date().toISOString()}] Player cleanup: ${expired} expired, ${activePlayers.size} remaining`);
  }
}

// Optimized brainrot cleanup with strict limits
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

  if (markedInactive > 0 || deleted > 0) {
    console.log(`[${new Date().toISOString()}] Brainrot cleanup: ${markedInactive} inactive, ${deleted} deleted, ${brainrots.size}/${MAX_BRAINROTS} remaining`);
  }
}

// Optimized force join cleanup
function cleanupForceJoinCommands() {
  const nowTime = now();
  const cutoff = nowTime - FORCE_JOIN_EXPIRE_MS;
  
  let expired = 0;
  for (const [username, cmd] of forceJoinCommands) {
    if (cmd.timestamp < cutoff) {
      forceJoinCommands.delete(username);
      expired++;
    }
  }
  
  // Enforce size limit
  if (forceJoinCommands.size > MAX_FORCE_JOINS) {
    const sorted = Array.from(forceJoinCommands.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = forceJoinCommands.size - MAX_FORCE_JOINS;
    for (let i = 0; i < toRemove; i++) {
      forceJoinCommands.delete(sorted[i][0]);
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
  
  const players = Array.from(activePlayers.values()).map(player => ({
    username: player.username,
    serverId: player.serverId,
    jobId: player.jobId,
    placeId: player.placeId,
    secondsSinceLastSeen: Math.floor((now() - player.lastSeen) / 1000)
  }));
  
  res.json(players);
});

// Optimized force join - minimal storage
app.post('/forcejoin', (req, res) => {
  const { targetUsernames, placeId, jobId, issuer } = req.body;
  
  if (!targetUsernames || !placeId || !jobId) {
    return res.status(400).json({ error: "Missing targetUsernames, placeId, or jobId" });
  }
  
  const usernames = Array.isArray(targetUsernames) ? targetUsernames : [targetUsernames];
  
  usernames.forEach(username => {
    const user = username.toLowerCase().trim();
    forceJoinCommands.set(user, {
      placeId: String(placeId),
      jobId: String(jobId),
      timestamp: now(),
      issuer: issuer || 'admin',
      executed: false
    });
  });
  
  cleanupForceJoinCommands();
  
  res.json({ 
    success: true, 
    message: `Force-join command added for ${usernames.length} user(s)`,
    expires: new Date(now() + FORCE_JOIN_EXPIRE_MS).toISOString()
  });
});

app.get('/forcejoin/:username', (req, res) => {
  cleanupForceJoinCommands();
  
  const username = req.params.username.toLowerCase().trim();
  const command = forceJoinCommands.get(username);
  
  if (command && !command.executed) {
    command.executed = true;
    command.executedAt = now();
    
    res.json({
      hasCommand: true,
      placeId: command.placeId,
      jobId: command.jobId,
      issuer: command.issuer
    });
  } else {
    res.json({ hasCommand: false });
  }
});

app.get('/forcejoin/status', (req, res) => {
  cleanupForceJoinCommands();
  
  const commands = Array.from(forceJoinCommands.entries()).map(([username, cmd]) => ({
    username,
    ...cmd,
    secondsRemaining: Math.max(0, Math.floor((FORCE_JOIN_EXPIRE_MS - (now() - cmd.timestamp)) / 1000))
  }));
  
  res.json({
    total: commands.length,
    commands
  });
});

app.delete('/forcejoin/:username', (req, res) => {
  const username = req.params.username.toLowerCase().trim();
  
  if (forceJoinCommands.has(username)) {
    forceJoinCommands.delete(username);
    res.json({ success: true, message: `Command cancelled for ${username}` });
  } else {
    res.status(404).json({ error: `No command found for ${username}` });
  }
});

// Optimized brainrots endpoint - store only essential data
app.post('/brainrots', (req, res) => {
  const data = req.body;

  let name = typeof data.name === "string" ? data.name.trim() : "";
  let serverId = typeof data.serverId === "string" ? data.serverId.trim() : "";
  let jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";

  if (!name || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }

  const source = req.ip?.includes('railway') || req.headers['x-forwarded-for']?.includes('railway') ? 'discord-bot' : 'lua-script';
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

// Lightweight brainrots getter
app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();

  const activeBrainrots = Array.from(brainrots.values())
    .filter(br => br.active)
    .map(br => ({
      name: br.name,
      serverId: br.serverId,
      jobId: br.jobId,
      players: br.players,
      moneyPerSec: br.moneyPerSec,
      lastSeen: br.lastSeen,
      source: br.source
    }));

  res.json(activeBrainrots);
});

// Minimal debug endpoint
app.get('/brainrots/debug', (req, res) => {
  cleanupOldBrainrots();

  const active = Array.from(brainrots.values()).filter(br => br.active);
  const inactive = Array.from(brainrots.values()).filter(br => !br.active);

  const debugData = {
    summary: {
      totalStored: brainrots.size,
      activeCount: active.length,
      inactiveCount: inactive.length,
      limits: {
        maxBrainrots: MAX_BRAINROTS,
        maxPlayers: MAX_PLAYERS,
        maxForceJoins: MAX_FORCE_JOINS
      }
    },
    active: active.slice(0, 10).map(br => ({
      name: br.name,
      serverId: br.serverId.substring(0, 8) + '...',
      jobId: br.jobId.substring(0, 8) + '...',
      players: br.players,
      moneyPerSec: br.moneyPerSec,
      secondsSinceLastSeen: Math.floor((now() - br.lastSeen) / 1000)
    }))
  };

  res.json(debugData);
});

// Lightweight stats endpoint
app.get('/brainrots/stats', (req, res) => {
  const active = Array.from(brainrots.values()).filter(br => br.active);
  const bySource = active.reduce((acc, br) => {
    acc[br.source] = (acc[br.source] || 0) + 1;
    return acc;
  }, {});

  res.json({
    totalActive: active.length,
    totalPlayers: activePlayers.size,
    totalForceJoins: forceJoinCommands.size,
    bySource,
    uptime: Math.floor(process.uptime()),
    limits: {
      brainrots: `${brainrots.size}/${MAX_BRAINROTS}`,
      players: `${activePlayers.size}/${MAX_PLAYERS}`,
      forceJoins: `${forceJoinCommands.size}/${MAX_FORCE_JOINS}`
    }
  });
});

// Admin cleanup endpoints
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
  const entry = brainrots.get(key);
  
  if (entry) {
    entry.active = false;
    entry.lastSeen = now();
  }

  res.json({ success: true });
});

// Minimal health check
app.get('/', (req, res) => {
  const activeCount = Array.from(brainrots.values()).filter(br => br.active).length;
  
  res.send(`
    <h1>🧠 Optimized Brainrot Backend</h1>
    <p><strong>Active Brainrots:</strong> ${activeCount}/${MAX_BRAINROTS}</p>
    <p><strong>Active Players:</strong> ${activePlayers.size}/${MAX_PLAYERS}</p>
    <p><strong>Pending Force-Joins:</strong> ${forceJoinCommands.size}/${MAX_FORCE_JOINS}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
    <hr>
    <p><a href="/brainrots">📊 View Active Brainrots</a></p>
    <p><a href="/players/active">👥 View Active Players</a></p>
    <p><a href="/brainrots/debug">🔍 Debug Data</a></p>
    <p><a href="/brainrots/stats">📈 Statistics</a></p>
    <p><a href="/forcejoin/status">🎯 Force-Join Status</a></p>
  `);
});

// More frequent cleanup to prevent memory buildup
setInterval(() => {
  cleanupOldBrainrots();
  cleanupForceJoinCommands();
  cleanupInactivePlayers();
}, 3000); // Every 3 seconds

// Force garbage collection if available
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 15000); // Every 15 seconds
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Optimized Brainrot Backend running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] 📊 Memory limits: ${MAX_BRAINROTS} brainrots, ${MAX_PLAYERS} players, ${MAX_FORCE_JOINS} force-joins`);
  console.log(`[${new Date().toISOString()}] ⏱️ Timeouts: 35s brainrot livetime, 30s heartbeat, 60s force-join`);
});
