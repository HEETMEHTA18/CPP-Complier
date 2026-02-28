const express = require('express');
const router = express.Router();
const { enqueueCompilerJob } = require('../../queue/compilerJobs');

// POST /api/compiler/run
router.post('/run', async (req, res) => {
    const { language, code, input = '' } = req.body;

    // ── Input validation ───────────────────────────────────
    if (!language || !code) {
        return res.status(400).json({ error: 'Language and code are required.' });
    }

    if (language !== 'cpp') {
        return res.status(400).json({ error: 'Only C++ (cpp) is supported at this time.' });
    }

    if (code.length > 64 * 1024) {  // 64 KB code limit
        return res.status(400).json({ error: 'Code too large (max 64 KB).' });
    }

    // ── Enqueue & await with explicit timeout ──────────────
    try {
        const job = await enqueueCompilerJob(language, code, input);

        // Add a race between job completion and a hard timeout.
        // Prevents hanging requests if Bull worker crashes mid-job.
        const JOB_TIMEOUT_MS = parseInt(process.env.JOB_WAIT_TIMEOUT_MS) || 60000;

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error('Job timed out waiting for a worker')),
                JOB_TIMEOUT_MS
            )
        );

        // Fallback polling: If Pub/Sub event is dropped by Redis under heavy load,
        // we check the job state manually every 500ms so we don't hang.
        const pollPromise = new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
                try {
                    const state = await job.getState();
                    if (state === 'completed') {
                        clearInterval(interval);
                        resolve(await job.returnvalue);
                    } else if (state === 'failed') {
                        clearInterval(interval);
                        reject(new Error(job.failedReason || 'Job failed'));
                    }
                } catch (err) {
                    // ignore temporary Redis errors
                }
            }, 500);

            // Cleanup the interval when the overall timeout hits
            setTimeout(() => clearInterval(interval), JOB_TIMEOUT_MS);
        });

        const result = await Promise.race([job.finished(), pollPromise, timeoutPromise]);

        return res.status(200).json(result);

    } catch (err) {
        const isTimeout = err.message && err.message.includes('timed out');
        return res.status(isTimeout ? 504 : 500).json({
            status: 'error',
            output: err.message || 'Worker execution queue error',
            time: null,
            memory: null,
        });
    }
});

module.exports = router;
