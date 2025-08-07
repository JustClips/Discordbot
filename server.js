const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// Store: { "<serverId>_<name>_<jobId>": { ...all fields sent by client..., lastSeen, active, lastIP, source, firstSeen } }
const brainrots = {};
const BRAINROT_LIVETIME_MS = 35 * 1000; // 10 seconds (changed from 20)
const HEARTBEAT_TIMEOUT_MS = 30 * 1000;  // 7 seconds (changed from 15)

// Force join commands storage
const forceJoinCommands = {};
const FORCE_JOIN_EXPIRE_MS = 60 * 1000; // Commands expire after 60 seconds

function now() {
  return Date.now();
}

// Cleanup force join commands
function cleanupForceJoinCommands() {
  const nowTime = now();
  const cutoff = nowTime - FORCE_JOIN_EXPIRE_MS;
  
  for (const username in forceJoinCommands) {
    if (forceJoinCommands[username].timestamp < cutoff) {
      delete forceJoinCommands[username];
      console.log(`[${new Date().toISOString()}] Expired force-join command for ${username}`);
    }
  }
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

// POST /forcejoin - Add a force join command for specific users
app.post('/forcejoin', (req, res) => {
  const { targetUsernames, placeId, jobId, issuer } = req.body;
  
  if (!targetUsernames || !placeId || !jobId) {
    return res.status(400).json({ error: "Missing targetUsernames, placeId, or jobId" });
  }
  
  const usernames = Array.isArray(targetUsernames) ? targetUsernames : [targetUsernames];
  
  usernames.forEach(username => {
    const user = username.toLowerCase().trim();
    forceJoinCommands[user] = {
      placeId: String(placeId),
      jobId: String(jobId),
      timestamp: now(),
      issuer: issuer || 'admin',
      executed: false
    };
  });
  
  cleanupForceJoinCommands();
  
  console.log(`[${new Date().toISOString()}] Force-join command added for ${usernames.join(', ')} to ${placeId}:${jobId.substring(0, 8)}... by ${issuer || 'admin'}`);
  
  res.json({ 
    success: true, 
    message: `Force-join command added for ${usernames.length} user(s)`,
    expires: new Date(now() + FORCE_JOIN_EXPIRE_MS).toISOString()
  });
});

// GET /forcejoin/:username - Check if a user has a pending force-join command
app.get('/forcejoin/:username', (req, res) => {
  cleanupForceJoinCommands();
  
  const username = req.params.username.toLowerCase().trim();
  const command = forceJoinCommands[username];
  
  if (command && !command.executed) {
    // Mark as executed so it won't be sent again
    command.executed = true;
    command.executedAt = now();
    
    console.log(`[${new Date().toISOString()}] Force-join command retrieved for ${username}`);
    
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

// GET /forcejoin/status - See all pending force-join commands (admin)
app.get('/forcejoin/status', (req, res) => {
  cleanupForceJoinCommands();
  
  const commands = Object.entries(forceJoinCommands).map(([username, cmd]) => ({
    username,
    ...cmd,
    secondsRemaining: Math.max(0, Math.floor((FORCE_JOIN_EXPIRE_MS - (now() - cmd.timestamp)) / 1000))
  }));
  
  res.json({
    total: commands.length,
    commands
  });
});

// DELETE /forcejoin/:username - Cancel a force-join command
app.delete('/forcejoin/:username', (req, res) => {
  const username = req.params.username.toLowerCase().trim();
  
  if (forceJoinCommands[username]) {
    delete forceJoinCommands[username];
    console.log(`[${new Date().toISOString()}] Force-join command cancelled for ${username}`);
    res.json({ success: true, message: `Command cancelled for ${username}` });
  } else {
    res.status(404).json({ error: `No command found for ${username}` });
  }
});

// POST /brainrots - update or add a brainrot (heartbeat from client/discord bot)
app.post('/brainrots', (req, res) => {
  const data = req.body;

  // Always require these three (mandatory)
  let name = typeof data.name === "string" ? data.name.trim() : "";
  let serverId = typeof data.serverId === "string" ? data.serverId.trim() : "";
  let jobId = typeof data.jobId === "string" ? data.jobId.trim() : "";

  if (!name || !serverId || !jobId) {
    console.warn(`[${new Date().toISOString()}] Bad /brainrots POST from ${req.ip}:`, req.body);
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }

  // Determine source based on IP or other factors
  const source = req.ip?.includes('railway') || req.headers['x-forwarded-for']?.includes('railway') ? 'discord-bot' : 'lua-script';
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  const isNewEntry = !brainrots[key];

  // Copy all fields from the incoming data
  const entry = { ...data };

  // Add/overwrite backend-specific fields
  entry.name = name;
  entry.serverId = serverId;
  entry.jobId = jobId;
  entry.lastSeen = now();
  entry.active = true;
  entry.lastIP = req.ip;
  entry.source = source;
  entry.firstSeen = brainrots[key]?.firstSeen || now();

  brainrots[key] = entry;

  cleanupOldBrainrots();

  const logPrefix = `[${new Date().toISOString()}]`;
  const status = isNewEntry ? '✅ NEW' : '🔄 UPDATE';
  console.log(`${logPrefix} ${status} Heartbeat (${source}):`, { name, serverId: serverId.substring(0, 8) + '...', jobId: jobId.substring(0, 8) + '...', players: entry.players });

  res.json({ success: true });
});

// GET /brainrots - returns active brainrots
app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();

  const activeBrainrots = Object.values(brainrots)
    .filter(br => br.active)
    .map(br => {
      // Optionally exclude lastIP for privacy
      const { lastIP, ...rest } = br;
      return rest;
    });

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
    active: active.slice(0, 20).map(br => ({
      ...br,
      secondsSinceLastSeen: Math.floor((now() - br.lastSeen) / 1000),
      serverId: br.serverId.substring(0, 8) + '...',
      jobId: br.jobId.substring(0, 8) + '...'
    }))
  });

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
    lastUpdate: Math.max(0, ...active.map(br => br.lastSeen))
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
  const pendingForceJoins = Object.keys(forceJoinCommands).length;
  
  res.send(`
    <h1>🧠 Brainrot Backend is Running!</h1>
    <p><strong>Active Brainrots:</strong> ${activeCount}</p>
    <p><strong>Pending Force-Joins:</strong> ${pendingForceJoins}</p>
    <p><strong>Server Time:</strong> ${new Date().toISOString()}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
    <hr>
    <p><a href="/brainrots">📊 View Active Brainrots</a></p>
    <p><a href="/brainrots/debug">🔍 Debug Data</a></p>
    <p><a href="/brainrots/stats">📈 Statistics</a></p>
    <p><a href="/forcejoin/status">🎯 Force-Join Status</a></p>
  `);
});

// Cleanup task every 2 seconds for snappier removal
setInterval(() => {
  cleanupOldBrainrots();
  cleanupForceJoinCommands();
}, 2000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Brainrot Backend Server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] ⏱️ Entries expire after 10 seconds`);
  console.log(`[${new Date().toISOString()}] 🎯 Force-join commands expire after 60 seconds`);
});
