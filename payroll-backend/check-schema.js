// Check actual table columns
'use strict';
require('dotenv').config();
const db = require('./db');

(async () => {
    const cols = await db.getAll(
        `SELECT column_name, data_type, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = 'companies' 
         ORDER BY ordinal_position`
    );
    console.log('Companies columns:');
    for (const c of cols) console.log(`  ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`);
    
    const empCols = await db.getAll(
        `SELECT column_name, data_type, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = 'employees' 
         ORDER BY ordinal_position`
    );
    console.log('\nEmployees columns:');
    for (const c of empCols) console.log(`  ${c.column_name} (${c.data_type}, nullable=${c.is_nullable})`);
    process.exit(0);
})();
