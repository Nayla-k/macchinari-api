// index.js
const express = require('express');
const { Pool } = require('pg'); // For PostgreSQL
const client = require('prom-client'); // Prometheus client
const app = express();

// Middleware for handling JSON data
app.use(express.json());

// Create a Registry to register the metrics
const register = new client.Registry();

// Optional: Collect default system metrics like memory and CPU usage
client.collectDefaultMetrics({ register });

// Define custom metrics
const httpRequestCounter = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
});

// Register custom metrics
register.registerMetric(httpRequestCounter);

// Setup your database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'your-postgresql-connection-string',
    ssl: {
        rejectUnauthorized: false, // Adjust this based on your environment
    },
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        res.status(500).end(err);
    }
});

// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    const { macchinario, seriale, stato } = req.body;

    // Increment request counter
    httpRequestCounter.inc();

    // Example SQL query to insert data
    try {
        const queryText = `
            INSERT INTO machine_data (macchinario, seriale, stato, timestamp)
            VALUES ($1, $2, $3, NOW()) RETURNING *;
        `;
        const values = [macchinario, seriale, stato];

        const result = await pool.query(queryText, values);
        console.log('Dati ricevuti e salvati:', result.rows[0]);

        res.json({
            message: 'Dati ricevuti e salvati con successo!',
            data: result.rows[0],
        });
    } catch (error) {
        console.error('Errore durante il salvataggio dei dati:', error);
        res.status(500).json({ error: 'Errore durante il salvataggio dei dati' });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});






