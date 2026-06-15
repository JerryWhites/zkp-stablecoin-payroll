#!/usr/bin/env node
// ====================================
// 🔒 UNHACKABLE PAYROLL - SECURITY TEST SUITE
// ====================================
// Automated security tests for TIER 1, 2 & 3

const https = require('https');
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:5000';
let authToken = null;
let passedTests = 0;
let failedTests = 0;

// Test helpers
function makeRequest(method, path, body = null, cookies = '') {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(cookies && { 'Cookie': cookies }),
                ...(authToken && { 'Authorization': `Bearer ${authToken}` })
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ 
                        status: res.statusCode, 
                        data: JSON.parse(data),
                        headers: res.headers
                    });
                } catch {
                    resolve({ status: res.statusCode, data: data, headers: res.headers });
                }
            });
        });

        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function test(name, condition) {
    if (condition) {
        console.log(`  ✅ ${name}`);
        passedTests++;
    } else {
        console.log(`  ❌ ${name}`);
        failedTests++;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ====================================
// TIER 1 TESTS
// ====================================

async function testTier1() {
    console.log('\n📋 TIER 1 - CRITICAL SECURITY TESTS\n');
    
    // 1. Health check
    console.log('1. Health Check:');
    const health = await makeRequest('GET', '/api/health');
    test('Health endpoint responds', health.status === 200);
    test('Returns healthy status', health.data?.status === 'healthy');
    
    // 2. Authentication required
    console.log('\n2. Authentication Required:');
    const unauth = await makeRequest('GET', '/api/employees');
    test('Protected route rejects unauthenticated', unauth.status === 401);
    test('Returns appropriate error', unauth.data?.error?.includes('Authentication'));
    
    // 3. Input validation
    console.log('\n3. Input Validation:');
    const weakPass = await makeRequest('POST', '/api/auth/register', {
        email: 'test@test.com',
        password: '123',
        role: 'employee'
    });
    test('Rejects weak password', weakPass.status === 400);
    test('Explains validation error', Array.isArray(weakPass.data?.errors));
    
    const invalidEmail = await makeRequest('POST', '/api/auth/register', {
        email: 'notanemail',
        password: 'SecurePass123!',
        role: 'employee'
    });
    test('Rejects invalid email', invalidEmail.status === 400);
    
    // 4. SQL Injection Protection
    console.log('\n4. SQL Injection Protection:');
    const sqli = await makeRequest('POST', '/api/auth/login', {
        email: "admin'; DROP TABLE users;--",
        password: 'test'
    });
    test('SQL injection blocked', sqli.status === 400 || sqli.status === 401);
    
    // 5. Security Headers
    console.log('\n5. Security Headers:');
    const headers = await makeRequest('GET', '/api/health');
    test('X-Content-Type-Options present', headers.headers['x-content-type-options'] === 'nosniff');
    test('X-Frame-Options present', !!headers.headers['x-frame-options']);
    test('Content-Security-Policy present', !!headers.headers['content-security-policy']);
    
    // 6. Rate Limiting Test (be careful not to lock account)
    console.log('\n6. Rate Limiting:');
    const rateLimitResponses = [];
    for (let i = 0; i < 3; i++) {
        const resp = await makeRequest('POST', '/api/auth/login', {
            email: `ratetest${Date.now()}@test.com`,
            password: 'wrong'
        });
        rateLimitResponses.push(resp.status);
        await sleep(100);
    }
    test('Rate limiter allows initial requests', rateLimitResponses.every(s => s !== 429));
    
    // 7. Login Test
    console.log('\n7. Authentication:');
    const login = await makeRequest('POST', '/api/auth/login', {
        email: 'admin@payroll.local',
        password: 'b4bbcb393a2e0a24bcbcc97fef491289'
    });
    test('Valid login succeeds', login.status === 200);
    test('Returns access token', !!login.data?.accessToken);
    test('Returns user data', !!login.data?.user);
    
    if (login.data?.accessToken) {
        authToken = login.data.accessToken;
    }
    
    // 8. Authenticated access
    console.log('\n8. Authenticated Access:');
    const authed = await makeRequest('GET', '/api/employees');
    test('Protected route accessible with token', authed.status === 200);
    test('Returns employee data', Array.isArray(authed.data?.employees));
}

// ====================================
// TIER 2 TESTS
// ====================================

async function testTier2() {
    console.log('\n📋 TIER 2 - IMPORTANT SECURITY TESTS\n');
    
    // 1. Session Management
    console.log('1. Session Management:');
    const sessions = await makeRequest('GET', '/api/auth/sessions');
    test('Can list sessions', sessions.status === 200);
    test('Returns sessions array', Array.isArray(sessions.data?.sessions));
    
    // 2. GDPR Endpoints
    console.log('\n2. GDPR Compliance:');
    const exportReq = await makeRequest('POST', '/api/gdpr/export-request');
    test('GDPR export endpoint exists', exportReq.status !== 404);
    
    // 3. Audit Log Access
    console.log('\n3. Audit Logging:');
    // Audit logs are internal, but we can test the endpoint
    const auditAccess = await makeRequest('GET', '/api/audit/recent');
    // This might return 403 for non-admin, which is correct
    test('Audit endpoint responds appropriately', [200, 403, 404].includes(auditAccess.status));
}

// ====================================
// SECURITY HEADER ANALYSIS
// ====================================

async function analyzeSecurityHeaders() {
    console.log('\n📋 SECURITY HEADER ANALYSIS\n');
    
    const resp = await makeRequest('GET', '/api/health');
    const headers = resp.headers;
    
    const headerChecks = {
        'x-content-type-options': 'nosniff',
        'x-frame-options': ['DENY', 'SAMEORIGIN'],
        'x-xss-protection': '0', // Modern approach is 0
        'x-download-options': 'noopen',
        'x-dns-prefetch-control': 'off',
        'strict-transport-security': null, // Check exists
        'content-security-policy': null
    };
    
    for (const [header, expected] of Object.entries(headerChecks)) {
        const value = headers[header];
        if (expected === null) {
            test(`${header}: ${value ? '✓' : '✗'}`, !!value);
        } else if (Array.isArray(expected)) {
            test(`${header}: ${value}`, expected.includes(value));
        } else {
            test(`${header}: ${value}`, value === expected);
        }
    }
}

// ====================================
// MAIN
// ====================================

async function main() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║    🔒 UNHACKABLE PAYROLL - SECURITY TEST SUITE             ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\nTarget: ${BASE_URL}`);
    console.log('Starting tests...\n');
    
    try {
        await testTier1();
        await testTier2();
        await analyzeSecurityHeaders();
        
        console.log('\n' + '='.repeat(60));
        console.log(`\n📊 RESULTS: ${passedTests} passed, ${failedTests} failed`);
        
        if (failedTests === 0) {
            console.log('🎉 All security tests passed!\n');
        } else {
            console.log('⚠️  Some tests failed. Review and fix issues.\n');
        }
        
        process.exit(failedTests > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('\n❌ Test suite error:', error.message);
        process.exit(1);
    }
}

main();
