const express = require('express');
const router = express.Router();
const { randomBytes } = require('crypto');
const GameManager = require('../../game/GameManager');
const redisClient = require('../../cache/redis');
const logger = require('../../utils/logger');
const { broadcastToRoom } = require('../../utils/broadcaster');

const rand = (n) => randomBytes(n).toString('hex').toUpperCase();

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/bulk-create
   Body: { pairs: number (1-50), questionCount: number }
   Creates N rooms at once and stores tournament data in Redis.
═══════════════════════════════════════════════════════════ */
router.post('/bulk-create', async (req, res) => {
    const { pairs = 1, questionCount = 17, name = 'Tournament' } = req.body;

    if (pairs < 1 || pairs > 50) {
        return res.status(400).json({ error: 'pairs must be between 1 and 50' });
    }

    try {
        const tournamentId = 'T-' + rand(3);
        const results = [];

        // Create all rooms in parallel
        const roomPromises = Array.from({ length: pairs }, (_, i) =>
            GameManager.createRoom(questionCount).then(room => ({
                pairNo: i + 1,
                roomCode: room.code,
                teamACode: room.teamACode,
                teamBCode: room.teamBCode,
            }))
        );

        const pairs_data = await Promise.all(roomPromises);
        results.push(...pairs_data);

        // Store tournament in Redis (24h TTL)
        const tournamentData = {
            id: tournamentId,
            name,
            questionCount,
            createdAt: Date.now(),
            rooms: pairs_data.map(p => p.roomCode),
            pairs: pairs_data,
        };
        await redisClient.set(
            `tournament:${tournamentId}`,
            JSON.stringify(tournamentData),
            'EX',
            86400
        );

        logger.info(`Tournament ${tournamentId} created with ${pairs} rooms`);

        res.json({
            status: 'ok',
            tournamentId,
            name,
            totalPairs: pairs,
            pairs: results,
            leaderboardUrl: `/leaderboard/${tournamentId}`,
        });
    } catch (err) {
        logger.error('Tournament bulk-create error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/:id/notify-countdown
   Body: { seconds?: number }
   Broadcasts a game_countdown event to all connected clients
   in all rooms of this tournament. The frontend then shows
   a visual countdown. Admin calls /start after the timer ends.
═══════════════════════════════════════════════════════════ */
router.post('/:id/notify-countdown', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });

        const tournament = JSON.parse(data);
        const seconds = Math.min(Math.max(parseInt(req.body.seconds) || 30, 5), 60);
        const endsAt = Date.now() + seconds * 1000;

        // Broadcast countdown to every room in parallel
        await Promise.all(
            tournament.rooms.map(roomCode =>
                broadcastToRoom(roomCode, {
                    type: 'game_countdown',
                    endsAt,
                    seconds,
                    tournamentName: tournament.name,
                })
            )
        );

        logger.info(`Tournament ${req.params.id}: countdown broadcast (${seconds}s)`);
        res.json({ status: 'ok', endsAt, seconds });
    } catch (err) {
        logger.error('Tournament notify-countdown error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/:id/start
   Starts ALL rooms in the tournament simultaneously.
   Rooms where only one (or no) team has joined are force-started;
   teams that join later will enter a running game.
   Returns: { started: [...roomCodes], skipped: [...roomCodes] }
═══════════════════════════════════════════════════════════ */
router.post('/:id/start', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });

        const tournament = JSON.parse(data);
        const started = [];
        const skipped = [];
        const errors  = [];

        // Start all rooms in parallel
        await Promise.all(
            tournament.rooms.map(async (roomCode) => {
                const result = await GameManager.forceStartRoom(roomCode);
                if (result.error) {
                    errors.push({ roomCode, reason: result.error });
                } else if (result.skipped) {
                    skipped.push({ roomCode, reason: result.reason });
                } else {
                    started.push(roomCode);
                    // Broadcast game_started to any clients already in the room
                    await broadcastToRoom(roomCode, {
                        type: 'game_started',
                        room: GameManager.sanitizeRoom(result.room),
                    });
                }
            })
        );

        logger.info(`Tournament ${req.params.id}: started=${started.length}, skipped=${skipped.length}`);

        res.json({
            status: 'ok',
            tournamentId: req.params.id,
            totalRooms: tournament.rooms.length,
            started: started.length,
            skipped: skipped.length,
            errors:  errors.length,
            details: { started, skipped, errors },
        });
    } catch (err) {
        logger.error('Tournament start error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   GET /api/tournament/:id/leaderboard
   Returns all teams from all rooms in this tournament,
   sorted by score descending.
═══════════════════════════════════════════════════════════ */
router.get('/:id/leaderboard', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });

        const tournament = JSON.parse(data);

        // Fetch all room states in parallel
        const roomStates = await Promise.all(
            tournament.rooms.map(code => GameManager.getRoom(code))
        );

        const leaderboard = [];
        roomStates.forEach((room, idx) => {
            if (!room) return;
            const pairNo = idx + 1;
            ['A', 'B'].forEach(tid => {
                const team = room.teams[tid];
                leaderboard.push({
                    rank: 0,
                    pairNo,
                    teamId: tid,
                    teamName: team.name || `Pair ${pairNo} - Team ${tid}`,
                    solved: team.solved?.length || 0,
                    roomCode: room.code,
                    phase: room.phase,
                    isWinner: room.winner === tid,
                });
            });
        });

        // Sort by score DESC, then solved DESC
        leaderboard.sort((a, b) => b.solved - a.solved);
        leaderboard.forEach((e, i) => { e.rank = i + 1; });

        res.json({
            status: 'ok',
            tournament: {
                id: tournament.id,
                name: tournament.name,
                totalPairs: tournament.rooms.length,
                createdAt: tournament.createdAt,
            },
            leaderboard,
        });
    } catch (err) {
        logger.error('Leaderboard fetch error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════
   GET /api/tournament/:id  — tournament metadata
═══════════════ */
router.get('/:id', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });
        const tournament = JSON.parse(data);
        res.json({ status: 'ok', tournament });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/:id/upload-csv
   Body: { csvContent: string, setType: 'even' | 'odd' }
   Parses CSV, upserts problems in DB, assigns to rooms.
═══════════════════════════════════════════════════════════ */
router.post('/:id/upload-csv', async (req, res) => {
    const { query: dbQuery } = require('../../db');
    const { csvContent, setType } = req.body;

    if (!csvContent || !['even', 'odd'].includes(setType)) {
        return res.status(400).json({ error: 'csvContent and setType (even/odd) required' });
    }

    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });
        const tournament = JSON.parse(data);

        // ── Parse CSV ────────────────────────────────────────
        const lines = csvContent.trim().split(/\r?\n/);
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
        const col = name => headers.indexOf(name);
        const get = (row, name) => {
            const i = col(name);
            return i >= 0 ? (row[i] || '').trim().replace(/^"|"$/g, '') : '';
        };

        if (col('problem_slug') < 0 || col('problem_title') < 0) {
            return res.status(400).json({ error: 'CSV must have problem_slug and problem_title columns' });
        }

        // Group rows by slug
        const problemMap = new Map();
        for (let i = 1; i < lines.length; i++) {
            const row = lines[i].split(',');
            if (row.length < 2) continue;
            const slug = get(row, 'problem_slug');
            if (!slug) continue;
            if (!problemMap.has(slug)) {
                problemMap.set(slug, {
                    slug,
                    title: get(row, 'problem_title') || slug,
                    difficulty: get(row, 'difficulty') || 'Medium',
                    description: get(row, 'description') || get(row, 'problem_title') || slug,
                    testcases: [],
                });
            }
            if (col('input') >= 0 && col('expected_output') >= 0) {
                problemMap.get(slug).testcases.push({
                    input: get(row, 'input'),
                    expected_output: get(row, 'expected_output'),
                    is_sample: get(row, 'is_sample').toLowerCase() === 'true',
                });
            }
        }

        // ── Upsert problems into DB ───────────────────────────
        const problemIds = [];
        const problemSlugs = [];
        for (const p of problemMap.values()) {
            const existing = await dbQuery('SELECT id FROM problems WHERE slug = $1', [p.slug]);
            let problemId;
            if (existing.rows.length > 0) {
                problemId = existing.rows[0].id;
                await dbQuery('UPDATE problems SET title=$1, is_published=true, updated_at=NOW() WHERE id=$2', [p.title, problemId]);
            } else {
                const diffLevel = ['Easy', 'Medium', 'Hard'].includes(p.difficulty) ? p.difficulty : 'Medium';
                const ins = await dbQuery(
                    `INSERT INTO problems (slug, title, description, difficulty, is_published)
                     VALUES ($1,$2,$3,$4::difficulty_level,true) RETURNING id`,
                    [p.slug, p.title, p.description, diffLevel]
                );
                problemId = ins.rows[0].id;
            }
            problemIds.push(problemId);
            problemSlugs.push(p.slug);
            for (const tc of p.testcases) {
                await dbQuery(
                    `INSERT INTO test_cases (problem_id, input, expected_output, is_sample, order_index)
                     VALUES ($1,$2,$3,$4,0)
                     ON CONFLICT DO NOTHING`,
                    [problemId, tc.input, tc.expected_output, tc.is_sample]
                );
            }
        }

        // ── Store in tournament + assign to rooms ─────────────
        tournament[`${setType}SetProblemIds`] = problemIds;
        tournament[`${setType}SetSlugs`] = problemSlugs;
        tournament[`${setType}SetCount`] = problemIds.length;
        tournament[`${setType}SetUploadedAt`] = Date.now();

        // odd pairNo → odd set, even pairNo → even set
        for (const pair of (tournament.pairs || [])) {
            const targetSet = pair.pairNo % 2 === 0 ? 'even' : 'odd';
            if (targetSet !== setType) continue;
            try {
                const roomData = await redisClient.get(`room:${pair.roomCode}`);
                if (roomData) {
                    const room = JSON.parse(roomData);
                    room.tournamentProblems = problemIds;
                    room.questionCount = problemIds.length;
                    await redisClient.set(`room:${pair.roomCode}`, JSON.stringify(room), 'EX', 86400);
                }
            } catch (e) { /* non-fatal */ }
        }

        await redisClient.set(`tournament:${req.params.id}`, JSON.stringify(tournament), 'EX', 86400);
        logger.info(`Tournament ${req.params.id}: uploaded ${problemIds.length} problems for ${setType} set`);
        res.json({ status: 'ok', problemsUploaded: problemIds.length, setType, slugs: problemSlugs });
    } catch (err) {
        logger.error('CSV upload error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   PUT /api/tournament/:id/settings
   Body: { timerMinutes?: number, bonusQuestion?: object }
═══════════════════════════════════════════════════════════ */
router.put('/:id/settings', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });
        const tournament = JSON.parse(data);

        const { timerMinutes, bonusQuestion } = req.body;
        if (timerMinutes !== undefined) {
            tournament.timerMinutes = Math.max(1, Math.min(480, Number(timerMinutes)));
        }
        if (bonusQuestion !== undefined) {
            tournament.bonusQuestion = bonusQuestion;
        }

        await redisClient.set(`tournament:${req.params.id}`, JSON.stringify(tournament), 'EX', 86400);
        logger.info(`Tournament ${req.params.id}: settings updated`);
        res.json({ status: 'ok', tournament });
    } catch (err) {
        logger.error('Tournament settings error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

/* ═══════════════════════════════════════════════════════════
   POST /api/tournament/:id/trigger-bonus/:roomCode
   Sends bonus_round_start event to both teams in a tied room.
═══════════════════════════════════════════════════════════ */
router.post('/:id/trigger-bonus/:roomCode', async (req, res) => {
    try {
        const data = await redisClient.get(`tournament:${req.params.id}`);
        if (!data) return res.status(404).json({ error: 'Tournament not found' });
        const tournament = JSON.parse(data);

        if (!tournament.bonusQuestion) {
            return res.status(400).json({ error: 'No bonus question configured for this tournament' });
        }

        await broadcastToRoom(req.params.roomCode, {
            type: 'bonus_round_start',
            bonusQuestion: tournament.bonusQuestion,
            timerSeconds: tournament.bonusQuestion.timerSeconds || 300,
        });

        logger.info(`Tournament ${req.params.id}: bonus round triggered for room ${req.params.roomCode}`);
        res.json({ status: 'ok', roomCode: req.params.roomCode });
    } catch (err) {
        logger.error('Trigger bonus error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
