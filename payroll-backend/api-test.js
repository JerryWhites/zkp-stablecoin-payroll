'use strict';

// Final API test for all CZ Payroll endpoints
const http = require('http');

const BASE = 'http://localhost:5000';

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: { 'Content-Type': 'application/json' },
        };
        if (token) options.headers['Authorization'] = `Bearer ${token}`;
        
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

(async () => {
    console.log('=== CZ Payroll API Test ===\n');

    // 1. Login
    const login = await request('POST', '/api/auth/login', {
        email: 'whitesjerrysa@gmail.com',
        password: 'TestPassword123!'
    });
    console.log(`1. Login: ${login.status === 200 ? '✅' : '❌'} (${login.status})`);
    const token = login.data.accessToken;

    // 2. Company
    const company = await request('GET', '/api/companies/current', null, token);
    console.log(`2. Company: ${company.status === 200 ? '✅' : '❌'} (${company.status}) - ${company.data?.company?.name || 'N/A'}`);

    // 3. Employees
    const employees = await request('GET', '/api/v2/employees', null, token);
    console.log(`3. Employees: ${employees.status === 200 ? '✅' : '❌'} (${employees.status}) - ${employees.data?.employees?.length || 0} employees`);

    // 4. Credits balance
    const balance = await request('GET', '/api/credits/balance', null, token);
    console.log(`4. Credits: ${balance.status === 200 ? '✅' : '❌'} (${balance.status}) - ${balance.data?.balance_czk} CZK, tier: ${balance.data?.tier?.name}`);

    // 5. Credits history
    const history = await request('GET', '/api/credits/history', null, token);
    console.log(`5. History: ${history.status === 200 ? '✅' : '❌'} (${history.status}) - ${history.data?.pagination?.total} transactions`);

    // 6. Tax params
    const tax = await request('GET', '/api/v2/payroll/tax-params/2026', null, token);
    console.log(`6. Tax params: ${tax.status === 200 ? '✅' : '❌'} (${tax.status}) - ${tax.data?.params ? 'loaded' : 'N/A'}`);

    // 7. Payroll periods
    const periods = await request('GET', '/api/v2/payroll/periods', null, token);
    console.log(`7. Periods: ${periods.status === 200 ? '✅' : '❌'} (${periods.status}) - ${periods.data?.periods?.length || 0} periods`);

    console.log('\n=== Done ===');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
