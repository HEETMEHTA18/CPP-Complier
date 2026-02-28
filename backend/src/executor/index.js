const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const crypto = require('crypto');

// Supported language configuration (C++ ONLY)
const LANGUAGES = {
  'cpp': {
    extension: '.cpp',
    compileCmd: (file, out) => `g++ -O2 -std=c++17 -Wno-unused-result ${file} -o ${out}`,
    runCmd: (out) => `${out}`
  }
};

class Executor {
  constructor(language, code, customTimeLimit, customMemoryLimit) {
    this.language = 'cpp'; // Force C++
    this.code = code;
    this.timeLimit = customTimeLimit || parseInt(process.env.MAX_EXECUTION_TIME) || 2000;
    this.memoryLimit = customMemoryLimit || parseInt(process.env.MAX_MEMORY_MB) || 256;

    this.config = LANGUAGES['cpp'];
    this.runId = uuidv4();
    this.baseDir = path.join(__dirname, '..', '..', 'temp', this.runId);

    this.sourceFile = '';
    this.executable = '';
  }

  // Prepares the execution environment: creates temp dir, writes code.
  async prepare() {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });

      const fileName = `source${this.config.extension}`;
      this.sourceFile = path.join(this.baseDir, fileName);

      await fs.writeFile(this.sourceFile, this.code);

      // Use platform-agnostic naming for the binary
      this.executable = path.join(this.baseDir, 'solution.out');

      logger.debug(`Environment prepared for ${this.runId} (C++)`);
    } catch (err) {
      logger.error('Failed to prepare execution environment:', err);
      throw new Error('System error preparing execution');
    }
  }

  // Compiles the C++ code
  async compile() {
    const cmd = this.config.compileCmd(this.sourceFile, this.executable);

    return new Promise((resolve) => {
      exec(cmd, { timeout: 20000 }, (error, stdout, stderr) => {
        if (error) {
          logger.info(`Compilation failed for ${this.runId}`);

          let errMsg = (error ? error.message : '') + (stderr || stdout || 'Compilation Error');
          if (errMsg.includes('is not recognized') || errMsg.includes('command not found')) {
            errMsg = `The G++ compiler is not installed or not in the PATH. Please check your Docker setup.`;
          }

          return resolve({ success: false, error: errMsg });
        }
        resolve({ success: true });
      });
    });
  }

  // Executes a batch of test cases
  async runBatch(testCases) {
    const cmd = this.executable;
    const args = [];

    const results = [];
    let passedCount = 0;
    let maxTimeUsed = 0;
    let maxMemoryUsed = 0;

    for (const testCase of testCases) {
      const startTime = Date.now();

      try {
        const output = await this._runProcessWithInput(cmd, args, testCase.input);
        const timeElapsed = Date.now() - startTime;

        maxTimeUsed = Math.max(maxTimeUsed, timeElapsed);

        const expected = testCase.expected_output.trim().split('\n').map(l => l.trim()).join('\n');
        const actual = output.trim().split('\n').map(l => l.trim()).join('\n');

        if (expected === actual) {
          results.push({ testCaseId: testCase.id, status: 'accepted', time: timeElapsed, output: output });
          passedCount++;
        } else {
          results.push({ testCaseId: testCase.id, status: 'wrong_answer', time: timeElapsed });

          let debugOutput = `--- Wrong Answer on Test Case ${passedCount + 1} ---\n\n`;
          debugOutput += `[Input]\n${testCase.input.trim()}\n\n`;
          debugOutput += `[Expected Output]\n${testCase.expected_output.trim()}\n\n`;
          debugOutput += `[Your Output]\n${output.trim()}`;

          return {
            verdict: 'wrong_answer',
            testCasesPassed: passedCount,
            totalTestCases: testCases.length,
            timeTaken: maxTimeUsed,
            memoryUsed: maxMemoryUsed,
            details: results,
            error: debugOutput
          };
        }

      } catch (err) {
        const timeElapsed = Date.now() - startTime;
        results.push({ testCaseId: testCase.id, status: err.status || 'runtime_error', time: timeElapsed });

        let debugError = `--- ${err.status ? err.status.toUpperCase().replace(/_/g, ' ') : 'RUNTIME ERROR'} on Test Case ${passedCount + 1} ---\n\n`;
        debugError += `[Input]\n${testCase.input.trim()}\n\n`;
        debugError += `[Error Details]\n${err.message}`;

        return {
          verdict: err.status || 'runtime_error',
          error: debugError,
          testCasesPassed: passedCount,
          totalTestCases: testCases.length,
          timeTaken: timeElapsed,
          memoryUsed: maxMemoryUsed,
          details: results
        };
      }
    }

    let successOutput = results.length > 0 ? `--- STDOUT (Sample Case 1) ---\n\n${results[0].output.trim() || '(No code output)'}` : null;

    return {
      verdict: 'accepted',
      testCasesPassed: passedCount,
      totalTestCases: testCases.length,
      timeTaken: maxTimeUsed,
      memoryUsed: maxMemoryUsed,
      details: results,
      error: successOutput
    };
  }

  _runProcessWithInput(cmd, args, input) {
    return new Promise((resolve, reject) => {
      const process = spawn(cmd, args);

      let stdout = '';
      let stderr = '';

      const timeoutId = setTimeout(() => {
        process.kill('SIGKILL');
        reject({ status: 'time_limit_exceeded', message: 'Time Limit Exceeded' });
      }, this.timeLimit);

      if (input) {
        process.stdin.write(input);
      }
      process.stdin.end();

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 5 * 1024 * 1024) { // 5MB limit
          process.kill('SIGKILL');
          reject({ status: 'memory_limit_exceeded', message: 'Output Limit Exceeded' });
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code !== 0 && code !== null) {
          reject({ status: 'runtime_error', message: stderr || `Process exited with code ${code}` });
        } else {
          resolve(stdout);
        }
      });

      process.on('error', (err) => {
        clearTimeout(timeoutId);
        reject({ status: 'system_error', message: err.message });
      });
    });
  }

  async cleanup() {
    try {
      await fs.rm(this.baseDir, { recursive: true, force: true });
    } catch (err) {
      logger.error('Failed to cleanup execution env:', err);
    }
  }

  static hashFunction(code, language, problemId) {
    // language is ignored as it is always C++
    return crypto.createHash('sha256').update(`cpp:${problemId}:${code}`).digest('hex');
  }
}

module.exports = Executor;
