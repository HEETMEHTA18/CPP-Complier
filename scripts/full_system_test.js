'use strict';
/**
 * FULL SYSTEM TEST — CodeArena
 * Sections:
 *   1.  Health checks
 *   2.  Problems API
 *   3.  Compiler — Run (unit tests)
 *   4.  Compiler — Submit
 *   5.  Game API — Create & Join
 *   6.  Binary Cache / Dedup (race-condition check)
 *   7.  Edge Cases & Security
 *   8.  Database connectivity
 *   9.  LOAD TEST — 20 concurrent mixed compiles (correctness under load)
 *   10. LOAD TEST — 30 identical concurrent submits (dedup + race stress)
 *   11. LOAD TEST — 10 simultaneous game rooms
 */

const http  = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

const BASE = process.env.BASE_URL || 'http://localhost:8080';
let passed = 0, failed = 0, warned = 0;
const results = [];

//  helpers 
function req(method, urlPath, body, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const url  = new URL(BASE + urlPath);
        const lib  = url.protocol === 'https:' ? https : http;
        const data = body ? JSON.stringify(body) : undefined;
        const opts = {
            hostname: url.hostname,
            port:     url.port || 80,
            path:     url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
            },
        };
        const r = lib.request(opts, res => {
            let raw = '';
            res.on('data', c => raw += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw), raw }); }
                catch { resolve({ status: res.statusCode, body: null, raw }); }
            });
        });
        r.on('error', reject);
        const t = setTimeout(() => { r.destroy(); reject(new Error('TIMEOUT')); }, timeoutMs);
        r.on('close', () => clearTimeout(t));
        if (data) r.write(data);
        r.end();
    });
}

function pass(name, detail = '') {
    passed++;
    results.push({ status: ' PASS', name, detail });
    console.log(`   ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
    failed++;
    results.push({ status: ' FAIL', name, detail });
    console.log(`   ${name}${detail ? ' — ' + detail : ''}`);
}
function warn(name, detail = '') {
    warned++;
    results.push({ status: '  WARN', name, detail });
    console.log(`    ${name}${detail ? ' — ' + detail : ''}`);
}
function section(title) {
    console.log(`\n${''.repeat(64)}`);
    console.log(`  ${title}`);
    console.log(''.repeat(64));
}
function stats(arr) {
    if (!arr.length) return { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p99: 0 };
    const s = [...arr].sort((a, b) => a - b);
    const sum = s.reduce((a, v) => a + v, 0);
    const p = pct => s[Math.max(0, Math.ceil(pct / 100 * s.length) - 1)];
    return { min: s[0], max: s[s.length - 1], avg: Math.round(sum / s.length), p50: p(50), p90: p(90), p99: p(99) };
}

//  1. Health 
async function testHealth() {
    section('1. HEALTH CHECKS');
    try {
        const r = await req('GET', '/health');
        r.status === 200
            ? pass('API health endpoint', `HTTP ${r.status}`)
            : fail('API health endpoint', `HTTP ${r.status}`);
    } catch (e) { fail('API health endpoint', e.message); }
}

//  2. Problems API 
async function testProblems() {
    section('2. PROBLEMS API');
    let problemId = null;
    try {
        const r = await req('GET', '/api/problems?published=true');
        if (r.status === 200 && Array.isArray(r.body?.problems)) {
            pass('GET /api/problems', `${r.body.problems.length} problems returned`);
            if (r.body.problems.length > 0) {
                problemId = r.body.problems[0].id;
                pass('Problems have IDs', `first ID: ${problemId}`);
            } else {
                warn('No problems seeded', 'seed the DB for full test coverage');
            }
        } else {
            fail('GET /api/problems', `status=${r.status}, body=${r.raw?.slice(0, 80)}`);
        }
    } catch (e) { fail('GET /api/problems', e.message); }

    if (problemId) {
        try {
            const r = await req('GET', `/api/problems/${problemId}/testcases`);
            if (r.status === 200 && Array.isArray(r.body?.samples)) {
                pass('GET /api/problems/:id/testcases', `${r.body.samples.length} sample(s)`);
            } else {
                warn('No test cases for problem', 'add test cases via /api/admin');
            }
        } catch (e) { fail('GET /api/problems/:id/testcases', e.message); }
    }
    return problemId;
}

//  3. Compiler — Run 
async function testCompilerRun() {
    section('3. COMPILER — RUN (unit tests)');

    const cases = [
        {
            name: 'Hello World (C++)',
            code: `#include<iostream>\nusing namespace std;\nint main(){cout<<"Hello World"<<endl;return 0;}`,
            input: '', expected: 'Hello World', lang: 'cpp',
        },
        {
            name: 'Sum two numbers via stdin (C++)',
            code: `#include<iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b<<endl;return 0;}`,
            input: '3 4', expected: '7', lang: 'cpp',
        },
        {
            name: 'Fibonacci DP n=10  55 (C++)',
            code: `#include<bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;if(n<=0){cout<<0;return 0;}if(n==1){cout<<1;return 0;}long long a=0,b=1;for(int i=2;i<=n;i++){long long c=a+b;a=b;b=c;}cout<<b<<endl;}`,
            input: '10', expected: '55', lang: 'cpp',
        },
        {
            name: 'Hollow rectangle output (C++)',
            code: `#include<bits/stdc++.h>\nusing namespace std;\nint main(){int r,c;cin>>r>>c;for(int i=0;i<r;i++){for(int j=0;j<c;j++){if(i==0||i==r-1||j==0||j==c-1)cout<<'*';else cout<<' ';}cout<<"\\n";}}`,
            input: '4 6', expected: '******', lang: 'cpp',
        },
        {
            name: 'Compilation error handled gracefully',
            code: `int main(){ this is not valid cpp }`,
            input: '', expectError: true, lang: 'cpp',
        },
        {
            name: 'C language (gcc)',
            code: `#include<stdio.h>\nint main(){printf("hello c\\n");return 0;}`,
            input: '', expected: 'hello c', lang: 'c',
        },
        {
            name: 'TLE — infinite loop killed',
            code: `int main(){while(1){}return 0;}`,
            input: '', expectTle: true, lang: 'cpp',
        },
    ];

    for (const tc of cases) {
        try {
            const r = await req('POST', '/api/compiler/run', { language: tc.lang, code: tc.code, input: tc.input }, 15000);
            if (tc.expectError) {
                r.status === 200 && r.body?.status === 'error'
                    ? pass(tc.name, `error: ${(r.body?.output || '').slice(0, 60)}`)
                    : warn(tc.name, `expected error status, got ${r.body?.status}`);
            } else if (tc.expectTle) {
                const isTle = r.body?.status === 'error' && (r.body?.output || '').toLowerCase().includes('time');
                isTle ? pass(tc.name, 'TLE detected correctly') : warn(tc.name, `got: ${r.body?.output?.slice(0, 60)}`);
            } else {
                const out = (r.body?.output || '').trim();
                if (r.body?.status === 'success' && out.includes(tc.expected)) {
                    pass(tc.name, `output="${out.slice(0, 40)}" time=${r.body?.time}ms`);
                } else {
                    fail(tc.name, `status=${r.body?.status} output="${out.slice(0, 80)}"`);
                }
            }
        } catch (e) { fail(tc.name, e.message); }
    }
}

//  4. Compiler — Submit (judge) 
async function testCompilerSubmit(problemId) {
    section('4. COMPILER — SUBMIT (judge)');
    if (!problemId) { warn('Submit test skipped', 'no problem ID available'); return; }

    try {
        const r = await req('POST', '/api/compiler/submit', {
            language: 'cpp',
            code: `#include<bits/stdc++.h>\nusing namespace std;\nint main(){int r,c;cin>>r>>c;for(int i=0;i<r;i++){for(int j=0;j<c;j++){if(i==0||i==r-1||j==0||j==c-1)cout<<'*';else cout<<' ';}cout<<"\\n";}}`,
            problemId,
            roomCode: 'SYSCK0', teamId: 'A',
        }, 25000);
        if (r.status === 200 && r.body?.verdict) {
            pass('Submit + judge', `verdict=${r.body.verdict} passed=${r.body.testCasesPassed}/${r.body.totalTestCases} time=${r.body.timeTaken}ms`);
        } else {
            warn('Submit judge', `status=${r.status} body=${r.raw?.slice(0, 100)}`);
        }
    } catch (e) { fail('Submit judge', e.message); }
}

//  5. Game API 
async function testGameAPI() {
    section('5. GAME API — CREATE & JOIN');
    let roomCode = null;

    try {
        const r = await req('POST', '/api/game/create', { teamName: 'TestTeam' });
        if (r.status === 200 && r.body?.code) {
            roomCode = r.body.code;
            pass('POST /api/game/create', `roomCode=${roomCode}`);
        } else {
            fail('POST /api/game/create', `status=${r.status} body=${r.raw?.slice(0, 100)}`);
            return;
        }
    } catch (e) { fail('POST /api/game/create', e.message); return; }

    try {
        const r = await req('GET', `/api/game/${roomCode}`);
        if (r.status === 200 && r.body?.room) {
            pass('GET /api/game/:code', `phase=${r.body.room.phase} code=${r.body.room.code}`);
        } else {
            fail('GET /api/game/:code', `status=${r.status}`);
        }
    } catch (e) { fail('GET /api/game/:code', e.message); }

    try {
        const r = await req('GET', '/api/game/XXXXXX');
        r.status === 404 ? pass('GET invalid room  404', 'correctly not found') : warn('GET invalid room', `status=${r.status}`);
    } catch (e) { warn('GET invalid room', e.message); }

    return { roomCode };
}

//  6. Binary Cache / Dedup race-condition check 
async function testBinaryCache() {
    section('6. BINARY CACHE / DEDUP — race-condition check');

    const code = `#include<bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;long long s=0;for(int i=1;i<=n;i++)s+=i;cout<<s<<endl;}`;

    // Cold compile first
    try {
        const cold = await req('POST', '/api/compiler/run', { language: 'cpp', code, input: '10' }, 15000);
        cold.body?.status === 'success'
            ? pass('Cold compile (first request)', `output=${cold.body?.output?.trim()} time=${cold.body?.time}ms`)
            : fail('Cold compile failed', cold.body?.output?.slice(0, 80));
    } catch (e) { fail('Cold compile', e.message); }

    // 10 identical concurrent  all must succeed (no race on empty executable)
    const t0 = performance.now();
    const dedup = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        req('POST', '/api/compiler/run', { language: 'cpp', code, input: String((i + 1) * 5) }, 15000)
            .then(r => ({
                ok: r.body?.status === 'success',
                time: r.body?.time,
                out: (r.body?.output || '').trim(),
                err: r.body?.status === 'error' ? r.body.output : null,
            }))
            .catch(e => ({ ok: false, err: e.message }))
    ));
    const wall    = Math.round(performance.now() - t0);
    const okCount = dedup.filter(d => d.ok).length;
    const badList = dedup.filter(d => !d.ok);

    if (okCount === 10) {
        const times = dedup.map(d => d.time).filter(Boolean);
        const s = stats(times);
        pass('10 identical concurrent — no race (dedup OK)', `wall=${wall}ms avg_exec=${s.avg}ms`);
    } else {
        fail(`Dedup race: ${okCount}/10 succeeded`, badList.map(d => d.err).join(' | ').slice(0, 150));
    }
}

//  7. Edge Cases & Security 
async function testEdgeCases() {
    section('7. EDGE CASES & SECURITY');

    try {
        const r = await req('POST', '/api/compiler/run', { language: 'cpp', code: '', input: '' });
        r.status !== 500 ? pass('Empty code handled gracefully', `status=${r.status}`) : fail('Empty code crashes server', `status=${r.status}`);
    } catch (e) { fail('Empty code', e.message); }

    try {
        const r = await req('POST', '/api/compiler/run', {
            language: 'cpp',
            code: `#include<iostream>\nusing namespace std;\nint main(){for(int i=0;i<1000000;i++)cout<<"AAAA\\n";return 0;}`,
            input: '',
        }, 15000);
        const handled = r.body?.status === 'error' || (r.body?.status === 'success' && (r.body?.output?.length || 0) > 0);
        handled ? pass('Large output handled (OLE/truncated)', `status=${r.body?.status}`) : fail('Large output', 'no response');
    } catch (e) { warn('Large output test', e.message); }

    try {
        const r = await req('POST', '/api/compiler/run', {
            language: 'cpp',
            code: `#include<vector>\nusing namespace std;\nint main(){vector<int>v;while(1)v.resize(v.size()+100000,1);return 0;}`,
            input: '',
        }, 15000);
        r.body?.status === 'error'
            ? pass('Memory bomb killed (MLE/TLE)', `output=${(r.body?.output || '').slice(0, 60)}`)
            : warn('Memory bomb not killed', `status=${r.body?.status}`);
    } catch (e) { warn('Memory bomb', e.message); }

    try {
        const r = await req('POST', '/api/compiler/run', { code: 'int main(){}', input: '' });
        r.status < 500 ? pass('Missing language field handled', `status=${r.status}`) : fail('Missing language crashes server', `status=${r.status}`);
    } catch (e) { fail('Missing language', e.message); }
}

//  8. Database 
async function testDatabase() {
    section('8. DATABASE CONNECTIVITY');
    try {
        const r = await req('GET', '/api/problems?published=true');
        r.status === 200 ? pass('DB connected (problems table readable)', `${r.body?.problems?.length} rows`) : fail('DB unreachable', `status=${r.status}`);
    } catch (e) { fail('DB connection', e.message); }
}

//  9. LOAD TEST — 20 concurrent mixed compiles 
async function loadTestMixedCompiles() {
    section('9. LOAD TEST — 20 concurrent mixed compiles');

    const testCases = [
        { code: `#include<iostream>\nusing namespace std;\nint main(){cout<<"Hello World"<<endl;return 0;}`,                   input: '',    expected: 'Hello World' },
        { code: `#include<iostream>\nusing namespace std;\nint main(){int a,b;cin>>a>>b;cout<<a+b<<endl;return 0;}`,             input: '3 4', expected: '7' },
        { code: `#include<bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;long long s=0;for(int i=1;i<=n;i++)s+=i;cout<<s<<endl;}`, input: '100', expected: '5050' },
        { code: `#include<bits/stdc++.h>\nusing namespace std;\nint main(){int n;cin>>n;if(n<=0){cout<<0;return 0;}if(n==1){cout<<1;return 0;}long long a=0,b=1;for(int i=2;i<=n;i++){long long c=a+b;a=b;b=c;}cout<<b<<endl;}`, input: '10', expected: '55' },
    ];

    const jobs = Array.from({ length: 20 }, (_, i) => testCases[i % testCases.length]);
    console.log(`  Firing 20 concurrent /api/compiler/run requests (4 distinct programs  5)...`);
    const t0 = performance.now();

    const res = await Promise.all(jobs.map(tc =>
        req('POST', '/api/compiler/run', { language: 'cpp', code: tc.code, input: tc.input }, 20000)
            .then(r => ({
                ok: r.body?.status === 'success' && (r.body?.output || '').trim().includes(tc.expected),
                time: r.body?.time || 0,
                output: (r.body?.output || '').trim(),
                expected: tc.expected,
            }))
            .catch(e => ({ ok: false, time: 0, output: e.message, expected: tc.expected }))
    ));

    const wall    = Math.round(performance.now() - t0);
    const okCount = res.filter(r => r.ok).length;
    const badList = res.filter(r => !r.ok);
    const times   = res.filter(r => r.time > 0).map(r => r.time);
    const s       = stats(times);

    console.log(`  Results: ${okCount}/20 correct | wall=${wall}ms avg=${s.avg}ms p90=${s.p90}ms p99=${s.p99}ms max=${s.max}ms`);

    if (okCount === 20) {
        pass('20-concurrent mixed compile load', `wall=${wall}ms avg=${s.avg}ms p90=${s.p90}ms`);
    } else if (okCount >= 16) {
        warn(`${okCount}/20 passed under load`, `${badList.map(b => b.output.slice(0, 40)).join('; ')}`);
    } else {
        fail(`${okCount}/20 passed under load`, `${badList.map(b => b.output.slice(0, 50)).join('; ')}`);
    }
}

//  10. LOAD TEST — 30 identical concurrent submits (dedup race stress) 
async function loadTestDedup() {
    section('10. LOAD TEST — 30 identical concurrent submits (dedup / race stress)');

    // Gives everyone the same compile hash  exactly 1 g++ fires, 29 wait
    const code = [
        '#include<bits/stdc++.h>',
        'using namespace std;',
        '// dedup_stress_marker_v1',
        'int main(){',
        '    long long s=0;',
        '    for(int i=1;i<=500;i++) s+=i;',
        '    cout<<s<<endl;',
        '    return 0;',
        '}',
    ].join('\n');

    console.log(`  Firing 30 simultaneous identical /api/compiler/run requests...`);
    const t0 = performance.now();

    const jobs = await Promise.all(Array.from({ length: 30 }, () =>
        req('POST', '/api/compiler/run', { language: 'cpp', code, input: '' }, 25000)
            .then(r => ({
                ok: r.body?.status === 'success' && (r.body?.output || '').trim() === '125250',
                status: r.body?.status,
                output: (r.body?.output || '').trim(),
                time:   r.body?.time || 0,
            }))
            .catch(e => ({ ok: false, status: 'error', output: e.message, time: 0 }))
    ));

    const wall    = Math.round(performance.now() - t0);
    const okCount = jobs.filter(j => j.ok).length;
    const badList = jobs.filter(j => !j.ok);
    const times   = jobs.filter(j => j.time > 0).map(j => j.time);
    const s       = stats(times);

    console.log(`  Results: ${okCount}/30 correct | wall=${wall}ms avg=${s.avg}ms p90=${s.p90}ms p99=${s.p99}ms`);

    if (okCount === 30) {
        pass('30 identical concurrent — dedup + no race', `wall=${wall}ms avg=${s.avg}ms`);
    } else if (okCount >= 25) {
        warn(`${okCount}/30 passed dedup stress`, `${badList.map(b => b.output.slice(0, 50)).join(' | ')}`);
    } else {
        fail(`${okCount}/30 passed dedup stress (race condition?)`, `${badList.map(b => b.output.slice(0, 60)).join(' | ')}`);
    }
}

//  11. LOAD TEST — 10 simultaneous game room creations 
async function loadTestGameRooms() {
    section('11. LOAD TEST — 10 simultaneous game room creations');

    console.log(`  Creating 10 game rooms concurrently...`);
    const t0 = performance.now();

    const jobs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
        req('POST', '/api/game/create', { teamName: `LoadTeam${i + 1}` }, 10000)
            .then(r => ({ ok: r.status === 200 && !!r.body?.code, code: r.body?.code, status: r.status }))
            .catch(e => ({ ok: false, code: null, status: 0, err: e.message }))
    ));

    const wall    = Math.round(performance.now() - t0);
    const okCount = jobs.filter(j => j.ok).length;
    const codes   = jobs.filter(j => j.ok).map(j => j.code);
    const unique  = new Set(codes).size;

    console.log(`  Created: ${okCount}/10 rooms | unique codes: ${unique}/10 | wall=${wall}ms`);

    if (okCount === 10 && unique === 10) {
        pass('10 concurrent game room creates — all unique', `wall=${wall}ms`);
    } else if (okCount >= 8) {
        warn(`${okCount}/10 rooms created`, `${unique} unique codes in ${wall}ms`);
    } else {
        fail(`Only ${okCount}/10 rooms created`, `${10 - okCount} failed`);
    }
}

//  MAIN 
(async () => {
    console.log('\n');
    console.log('          CodeArena — Full System + Load Test                ');
    console.log(`  Target : ${BASE.padEnd(52)}`);
    console.log(`  Time   : ${new Date().toISOString().padEnd(52)}`);
    console.log('');

    const t0 = performance.now();

    await testHealth();
    const problemId = await testProblems();
    await testCompilerRun();
    await testCompilerSubmit(problemId);
    await testGameAPI();
    await testBinaryCache();
    await testEdgeCases();
    await testDatabase();
    await loadTestMixedCompiles();
    await loadTestDedup();
    await loadTestGameRooms();

    const totalMs = Math.round(performance.now() - t0);

    //  Summary 
    console.log(`\n${''.repeat(64)}`);
    console.log('  FINAL SUMMARY');
    console.log(''.repeat(64));
    console.log(`   PASS : ${passed}`);
    console.log(`   FAIL : ${failed}`);
    console.log(`    WARN : ${warned}`);
    console.log(`  TOTAL  : ${passed + failed + warned}`);
    console.log(`  TIME   : ${(totalMs / 1000).toFixed(1)}s`);
    console.log(''.repeat(64));

    if (failed > 0) {
        console.log('\n   Failed tests:');
        results.filter(r => r.status.includes('FAIL')).forEach(r => console.log(`      ${r.name} — ${r.detail}`));
    }
    if (warned > 0) {
        console.log('\n    Warnings:');
        results.filter(r => r.status.includes('WARN')).forEach(r => console.log(`      ${r.name} — ${r.detail}`));
    }
    console.log('');
    process.exit(failed > 0 ? 1 : 0);
})();
