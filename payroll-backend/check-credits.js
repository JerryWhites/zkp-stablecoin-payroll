'use strict';
require('dotenv').config();
const db = require('./db');

(async () => {
    // Check credit_balance table
    const cols = await db.getAll(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'credit_balance' ORDER BY ordinal_position"
    );
    console.log('credit_balance columns:', cols);

    // Check credit_transactions table
    const txCols = await db.getAll(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'credit_transactions' ORDER BY ordinal_position"
    );
    console.log('credit_transactions columns:', txCols);

    // Check if there's a credit_balance row for our company
    const uuid = '5c0b8d6a-ddcc-4488-aa1e-52ef6df0b10c';
    const balance = await db.getOne('SELECT * FROM credit_balance WHERE company_id = $1', [uuid]);
    console.log('Credit balance for company:', balance);

    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
