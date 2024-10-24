const express = require('express'); 
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config(); // Add this at the top

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// PostgreSQL configuration with better error handling
const pool = new Pool({
    connectionString: process.env.database_url, // Changed from database_url to DATABASE_URL
    ssl: {
        rejectUnauthorized: false,
    },
});

// Test database connection on startup
pool.connect((err, client, release) => {
    if (err) {
        console.error('Error connecting to the database:', err.stack);
    } else {
        console.log('Successfully connected to database');
        client.query('SELECT NOW()', (err, result) => {
            release();
            if (err) {
                console.error('Error executing query:', err.stack);
            } else {
                console.log('Database query successful:', result.rows[0]);
            }
        });
    }
});

app.use(bodyParser.json());

// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    try {
        const { machineType, serialNumber, status, data } = req.body;
        
        // Debug logging
        console.log('Received request:', { machineType, serialNumber, status });
        console.log('Data object:', data);

        // Validate incoming request
        if (!machineType || !serialNumber || !status || !data) {
            console.log('Missing required fields:', { machineType, serialNumber, status, data });
            return res.status(400).send('Missing required fields');
        }

        // Get a client from the pool
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Insert into main table
            const queryText = `
                INSERT INTO vimago3030 (
                    serial_number, 
                    modality, 
                    acquisition_date, 
                    acquisition_time, 
                    study_uid, 
                    series_uid, 
                    modality_type,
                    status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `;

            const values = [
                serialNumber,
                data.modality_type,
                data.acquisition_date || null,
                data.acquisition_time || null,
                data.study_uid || null,
                data.series_uid || null,
                data.modality_type,
                status
            ];

            await client.query(queryText, values);

            // Insert related data if it exists
            if (data.series_info) {
                await client.query(
                    `INSERT INTO series_info (
                        serial_number, series_id, temperature, kV, modality_type
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [
                        serialNumber,
                        data.series_info.series_id,
                        data.series_info.temperature,
                        data.series_info.kV,
                        data.modality_type
                    ]
                );
            }

            // Add similar checks for other tables...

            await client.query('COMMIT');
            res.status(201).send('Data successfully saved');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error saving data:', error.stack);
        res.status(500).json({
            message: 'Error saving data',
            error: error.message
        });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});




