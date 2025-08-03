const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Example: this could be dynamic, from DB, or memory, or even passed by webhook
let brainrots = [
  { name: "Noobini Pizzani", serverId: "s1", jobId: "j1" },
  { name: "Tung Tung Tung Sahur", serverId: "s2", jobId: "j2" },
  { name: "Ultra Brainrot", serverId: "s3", jobId: "j3" }
];

// Endpoint to get all brainrot names (just names, no player info)
app.get('/brainrots', (req, res) => {
  // Only return brainrot names, but you can also include serverId/jobId for the join feature
  res.json(brainrots.map(br => ({
    name: br.name,
    serverId: br.serverId,
    jobId: br.jobId
  })));
});

// Optionally, endpoint to add a brainrot (e.g. POST from webhook)
app.use(express.json());
app.post('/brainrots', (req, res) => {
  const { name, serverId, jobId } = req.body;
  if (!name || !serverId || !jobId) {
    return res.status(400).json({ error: "Missing name, serverId, or jobId" });
  }
  brainrots.push({ name, serverId, jobId });
  res.json({ success: true });
});

// Optionally, endpoint to clear all (for testing)
app.delete('/brainrots', (req, res) => {
  brainrots = [];
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
