const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { collectDefaultMetrics, register } = require('prom-client');

const app = express();

// Enable CORS
app.use(cors());
app.use(express.json());

// Setup your database connection
const pool = new Pool({
    connectionString: process.env.database_url,
    ssl: {
        rejectUnauthorized: false,
    },
});

// Initialize metrics collection
collectDefaultMetrics();

// Health check endpoint
app.get('/', (req, res) => {
    res.send('Server is running');
});

// Metrics endpoint with error handling
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        const metrics = await register.metrics();
        res.end(metrics);
    } catch (error) {
        console.error('Error collecting metrics:', error);
        res.status(500).send('Error collecting metrics');
    }
});

// Endpoint to receive machine data with logging
app.post('/upload', async (req, res) => {
    console.log('Received upload request:', req.body);
    
    const { macchinario, seriale, stato } = req.body;
    
    if (!macchinario || !seriale || !stato) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const queryText = `
            INSERT INTO machine_data (macchinario, seriale, stato, timestamp)
            VALUES ($1, $2, $3, NOW()) RETURNING *;
        `;
        const values = [macchinario, seriale, stato];
        
        const result = await pool.query(queryText, values);
        console.log('Data saved successfully:', result.rows[0]);
        
        res.json({
            message: 'Data received and saved successfully!',
            data: result.rows[0],
        });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ error: 'Error saving data', details: error.message });
    }
});

// Start the server
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});




