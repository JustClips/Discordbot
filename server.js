const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// The number of milliseconds after which a brainrot/server is considered inactive and will be purged
const BRAINROT_LIVETIME_MS = 25 * 1000; // 25 seconds (adjust as needed)

// In-memory store: { "<serverId>_<name>_<jobId>": { name, serverId, jobId, lastSeen } }
const brainrots = {};

function now() {
  return Date.now();
}

// Cleanup inactive entries
function cleanupOldBrainrots() {
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  for (const key in brainrots) {
    if (brainrots[key].lastSeen < cutoff) {
      delete brainrots[key];
    }
  }
}

// POST /brainrots - update or add a brainrot (report from game)
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
    lastSeen: now()
  };
  cleanupOldBrainrots();
  res.json({ success: true });
});

// GET /brainrots - returns active brainrots
app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();
  res.json(Object.values(brainrots).map(({ name, serverId, jobId }) => ({
    name,
    serverId,
    jobId
  })));
});

// Optional: DELETE /brainrots - clear all (for admin/testing)
app.delete('/brainrots', (req, res) => {
  for (const key in brainrots) delete brainrots[key];
  res.json({ success: true });
});

// Health check
app.get('/', (req, res) => {
  res.send('Brainrot backend is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
