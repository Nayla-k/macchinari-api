const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL configuration
const pool = new Pool({
    connectionString: process.env.database_url || 'your-postgresql-connection-string',
    ssl: {
        rejectUnauthorized: false, // Adjust this based on your environment
    },
});
// Middleware
app.use(bodyParser.json());

// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    const { machineType, serialNumber, status, data } = req.body;

    try {
        const {
            acquisition_date,
            acquisition_time,
            study_uid,
            series_uid,
            modality_type,
            ...additional_info // Capture remaining fields as JSON
        } = data;

        // Insert data into the appropriate table based on machine type
        let queryText = '';
        if (machineType === 'vimago3030') {
            queryText = `INSERT INTO vimago3030 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, additional_info) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else if (machineType === 'pico3030') {
            queryText = `INSERT INTO pico3030 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, additional_info) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else if (machineType === 'see_factor_ct3') {
            queryText = `INSERT INTO see_factor_ct3 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, additional_info) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else {
            return res.status(400).send('Invalid machine type');
        }

        const values = [
            serialNumber,
            modality_type,
            acquisition_date,
            acquisition_time,
            study_uid,
            series_uid,
            JSON.stringify(additional_info) // Convert additional_info to JSON string
        ];

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



