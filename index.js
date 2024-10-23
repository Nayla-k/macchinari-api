const express = require('express');
const { Pool } = require('pg'); // For PostgreSQL
const client = require('prom-client'); // Import prom-client
const app = express();

// Middleware for handling JSON data
app.use(express.json());

// Create a Registry for Prometheus
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});
// Setup your database connection
const pool = new Pool({
    connectionString: process.env.database_url, // Use your internal database URL here
    ssl: {
        rejectUnauthorized: false, // Only use for development; adjust for production
    },
});
// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    const { macchinario, seriale, stato } = req.body;

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



