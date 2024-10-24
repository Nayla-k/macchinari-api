const express = require('express'); 
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS to allow requests from different origins
app.use(cors());

// PostgreSQL configuration
const pool = new Pool({
    connectionString: process.env.database_url || 'your-postgresql-connection-string',
    ssl: {
        rejectUnauthorized: false,
    },
});

// Middleware
app.use(bodyParser.json());

// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    try {
        // Log the incoming data
        console.log('Request received with body:', req.body);

        const { machineType, serialNumber, status, data } = req.body;

        // Validate incoming request
        if (!machineType || !serialNumber || !status || !data) {
            console.log('Missing required fields');
            return res.status(400).send('Missing required fields');
        }

        // Extract specific fields and treat the rest as additional_info
        const {
            acquisition_date,
            acquisition_time,
            study_uid,
            series_uid,
            modality_type,
            ...additional_info // Capture remaining fields as JSON (like Series Info, Source Info, etc.)
        } = data;

        // Log additional_info for debugging
        console.log('Additional Info:', additional_info);

        // Insert data into the appropriate table based on machine type
        let queryText = '';
        if (machineType.toLowerCase() === 'vimago3030') {
            queryText = `INSERT INTO vimago3030 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, additional_info) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else if (machineType.toLowerCase() === 'pico3030') {
            queryText = `INSERT INTO pico3030 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, additional_info) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else if (machineType.toLowerCase() === 'see_factor_ct3') {
            queryText = `INSERT INTO see_factor_ct3 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, additional_info) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else {
            return res.status(400).send('Invalid machine type');
        }

        // Prepare the values for the query
        const values = [
            serialNumber,
            modality_type,
            acquisition_date || null,   // Use null if missing
            acquisition_time || null,   // Use null if missing
            study_uid || null,          // Use null if missing
            series_uid || null,         // Use null if missing
            JSON.stringify(additional_info) // Convert additional_info to JSON string for storage
        ];

        // Execute the query
        await pool.query(queryText, values);
        res.status(201).send('Data successfully saved');
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).send('Error saving data');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});




