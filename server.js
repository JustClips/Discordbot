const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
// Store: { "<serverId>_<name>_<jobId>": { name, serverId, jobId, lastSeen, active, lastIP } }
const brainrots = {};
const BRAINROT_LIVETIME_MS = 600 * 1000; // 10 minutes, for safety
const HEARTBEAT_TIMEOUT_MS = 10 * 1000; // 10 seconds
function now() {
  return Date.now();
}
// Cleanup: mark stale active as inactive, delete old inactive
function cleanupOldBrainrots() {
  const nowTime = now();
  const heartbeatCutoff = nowTime - HEARTBEAT_TIMEOUT_MS;
  const livetimeCutoff = nowTime - BRAINROT_LIVETIME_MS;
  for (const key in brainrots) {
    const br = brainrots[key];
    if (br.active && br.lastSeen < heartbeatCutoff) {
      br.active = false;
      // keep lastSeen as is, it's when last confirmed
    }
    if (!br.active && br.lastSeen < livetimeCutoff) {
      delete brainrots[key];
    }
  }
}
// POST /brainrots - update or add a brainrot (heartbeat from client)
app.post('/brainrots', (req, res) => {
  const { name, serverId, jobId } = req.body;
  if (!name || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  brainrots[key] = {
    name,
    serverId,
    jobId,
    lastSeen: now(),
    active: true,
    lastIP: req.ip
  };
  cleanupOldBrainrots();
  res.json({ success: true });
});
// GET /brainrots - returns active brainrots
app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();
  res.json(Object.values(brainrots)
    .filter(br => br.active)
    .map(({ name, serverId, jobId }) => ({
      name,
      serverId,
      jobId
    }))
  );
});
// DELETE /brainrots - clear all (for admin/testing)
app.delete('/brainrots', (req, res) => {
  for (const key in brainrots) delete brainrots[key];
  res.json({ success: true });
});
// PATCH /brainrots/leave - mark as inactive (call this on player leave or pet despawn)
app.patch('/brainrots/leave', (req, res) => {
  const { name, serverId, jobId } = req.body;
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  if (brainrots[key]) {
    brainrots[key].active = false;
    brainrots[key].lastSeen = now();
  }
  res.json({ success: true });
});
// Health check
app.get('/', (req, res) => {
  res.send('Brainrot backend is running!');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
