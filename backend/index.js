const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function testConnection() {
  try {
    await client.connect();
    console.log('✅ Connected to Neon database!');
    const res = await client.query('SELECT NOW()');
    console.log('📅 Server time:', res.rows[0].now);
    await client.end();
  } catch (err) {
    console.error('❌ Connection failed:', err.message);
  }
}

testConnection();