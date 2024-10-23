const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { collectDefaultMetrics, register } = require('prom-client');

const app = express();

// Enable CORS with specific options
app.use(cors({
    origin: '*', // In production, you might want to restrict this
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    if (req.method === 'POST') {
        console.log('Body:', req.body);
    }
    next();
});

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

collectDefaultMetrics();

app.get('/metrics', async (req, res) => {
    try {
        console.log('Metrics endpoint accessed');
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
    } catch (error) {
        console.error('Error serving metrics:', error);
        res.status(500).send('Error collecting metrics');
    }
});

app.post('/upload', async (req, res) => {
    console.log('Received upload request');
    console.log('Request body:', req.body);
    
    const { macchinario, seriale, stato } = req.body;
    
    if (!macchinario || !seriale || !stato) {
        console.error('Missing required fields');
        return res.status(400).json({ 
            error: 'Missing required fields',
            received: { macchinario, seriale, stato }
        });
    }

    try {
        const queryText = `
            INSERT INTO machine_data (macchinario, seriale, stato, timestamp)
            VALUES ($1, $2, $3, NOW()) RETURNING *;
        `;
        const values = [macchinario, seriale, stato];
        
        console.log('Executing query:', queryText);
        console.log('With values:', values);
        
        const result = await pool.query(queryText, values);
        console.log('Query result:', result.rows[0]);
        
        res.json({
            message: 'Data received and saved successfully!',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ 
            error: 'Error saving data', 
            details: error.message 
        });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Database URL configured:', !!process.env.DATABASE_URL);
});




