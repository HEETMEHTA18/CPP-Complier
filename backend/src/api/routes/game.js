const express = require('express');
const router = express.Router();
const GameManager = require('../../game/GameManager');

// Create a room (REST fallback / pre-flight)
router.post('/create', async (req, res) => {
    try {
        const { teamName } = req.body;
        if (!teamName) return res.status(400).json({ error: 'teamName required' });
        const room = await GameManager.createRoom(teamName);
        res.json({ code: room.code, adminCode: room.adminCode, teamACode: room.teamACode, teamBCode: room.teamBCode });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Get room state
router.get('/:code', async (req, res) => {
    const room = await GameManager.getRoom(req.params.code.toUpperCase());
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: GameManager.sanitizeRoom(room) });
});

module.exports = router;
