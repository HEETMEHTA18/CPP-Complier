import { useState } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { Play, Loader2, Code2, Terminal } from 'lucide-react';
import './Compiler.css';

const DEFAULT_CODE: Record<string, string> = {
    cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Read input\n    // string name;\n    // if (cin >> name) cout << "Hello " << name << endl;\n    cout << "Hello World!" << endl;\n    return 0;\n}\n`
};

const Compiler = () => {
    const [language, setLanguage] = useState('cpp');
    const [code, setCode] = useState(DEFAULT_CODE['cpp']);
    const [input, setInput] = useState('');
    const [output, setOutput] = useState('');
    const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
    const [time, setTime] = useState<number | null>(null);
    const [loadTestCount, setLoadTestCount] = useState<number>(1);
    const [averageTime, setAverageTime] = useState<number | null>(null);

    const handleLanguageChange = (e: any) => {
        const lang = e.target.value;
        setLanguage(lang);
        setCode(DEFAULT_CODE[lang] || '');
        setOutput('');
        setStatus('idle');
        setTime(null);
        setAverageTime(null);
    };

    const handleRunCode = async () => {
        setStatus('running');
        setOutput(loadTestCount > 1 ? `Executing code ${loadTestCount} times asynchronously...\nWait for backend response.` : 'Executing code...\nWait for backend response.');
        setTime(null);
        setAverageTime(null);

        try {
            if (loadTestCount <= 1) {
                // Single Run
                const res = await axios.post('/api/compiler/run', {
                    language,
                    code,
                    input
                });

                if (res.data.status === 'success') {
                    setStatus('success');
                    setOutput(res.data.output || '(No Output)');
                    setTime(res.data.time);
                } else {
                    setStatus('error');
                    setOutput(res.data.output || 'Unknown Error Occurred');
                    setTime(res.data.time);
                }
            } else {
                // Load Test Mode
                const globalStartTime = Date.now();
                const promises = [];

                for (let i = 0; i < loadTestCount; i++) {
                    promises.push(axios.post('/api/compiler/run', {
                        language,
                        code,
                        input
                    }));
                }

                const results = await Promise.all(promises);
                const globalEndTime = Date.now();

                // Calculate average execution time returned by backend
                let totalBackendTime = 0;
                let errorOccurred = false;
                let sampleOutput = "";

                results.forEach((res, index) => {
                    if (res.data.status === 'success') {
                        totalBackendTime += (res.data.time || 0);
                        if (index === 0) sampleOutput = res.data.output;
                    } else {
                        errorOccurred = true;
                        sampleOutput = res.data.output;
                    }
                });

                if (!errorOccurred) {
                    setStatus('success');
                    setOutput(`[LOAD TEST COMPLETED HITTING SAME EXPRESS ENDPOINT]\n\nAll ${loadTestCount} requests routed through Redis Bull Queue successfully.\nSample Output:\n\n${sampleOutput || '(No Output)'}`);
                    setTime(globalEndTime - globalStartTime); // Total JS Execution Time for all promises
                    setAverageTime(Math.round(totalBackendTime / loadTestCount));
                } else {
                    setStatus('error');
                    setOutput(`[LOAD TEST ENCOUNTERED ERRORS]\nOne or more concurrent queries failed.\n\nSample Error:\n${sampleOutput}`);
                }
            }
        } catch (err: any) {
            console.error(err);
            setStatus('error');
            setOutput(err.response?.data?.error || err.message || 'System Error');
        }
    };

    return (
        <div className="compiler-view">
            {/* Left Panel - Editor */}
            <div className="panel editor-panel glass-panel">
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Code2 size={20} color="var(--neon-cyan)" />
                        <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Code Editor</h2>
                    </div>

                    <div className="editor-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <select
                            className="language-select input-base"
                            value={language}
                            onChange={handleLanguageChange}
                            style={{ padding: '6px 12px', width: 'auto' }}
                        >
                            <option value="cpp">C++ (G++)</option>
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '4px 12px', borderRadius: '4px' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Load Test (Concurrent):</span>
                            <input
                                type="number"
                                className="input-base"
                                value={loadTestCount}
                                onChange={(e) => setLoadTestCount(Math.max(1, parseInt(e.target.value) || 1))}
                                min={1}
                                max={100}
                                style={{ width: '60px', padding: '4px 8px', textAlign: 'center' }}
                            />
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={handleRunCode}
                            disabled={status === 'running'}
                            style={{ padding: '8px 24px' }}
                        >
                            {status === 'running' ? <Loader2 size={16} className="spinning" /> : <Play size={16} />}
                            <span style={{ marginLeft: '8px' }}>Run Code</span>
                        </button>
                    </div>
                </div>

                <div className="monaco-wrapper">
                    <Editor
                        height="100%"
                        language={language}
                        theme="vs-dark"
                        value={code}
                        onChange={(val) => setCode(val || '')}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 15,
                            fontFamily: "JetBrains Mono, monospace",
                            scrollBeyondLastLine: false,
                            padding: { top: 16 }
                        }}
                    />
                </div>
            </div>

            {/* Right Panel - Input / Output */}
            <div className="panel io-panel">
                {/* Custom Input */}
                <div className="io-box glass-panel">
                    <div className="panel-header io-header">
                        <Terminal size={18} color="var(--text-muted)" />
                        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-muted)' }}>Custom Input (stdin)</h3>
                    </div>
                    <textarea
                        className="io-textarea"
                        placeholder="Type inputs here..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        spellCheck={false}
                    ></textarea>
                </div>

                {/* Output */}
                <div className="io-box glass-panel">
                    <div className="panel-header io-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Terminal size={18} color="var(--text-heading)" />
                            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-heading)' }}>Output (stdout)</h3>
                        </div>
                        {time !== null && (
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: '16px' }}>
                                {averageTime !== null && (
                                    <span>Avg Backend Time: <span style={{ color: 'var(--neon-purple)', fontWeight: 'bold' }}>{averageTime} ms</span></span>
                                )}
                                <span>{loadTestCount > 1 ? 'Total API Time' : 'Time'}: <span style={{ color: 'var(--neon-cyan)', fontWeight: 'bold' }}>{time} ms</span></span>
                            </div>
                        )}
                    </div>
                    <div className={`io-output ${status === 'error' ? 'error' : ''}`}>
                        {output ? (
                            <pre>{output}</pre>
                        ) : (
                            <div className="console-empty text-muted">Output will be displayed here</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Compiler;
