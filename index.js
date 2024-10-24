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

app.use(bodyParser.json());

// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    try {
        const { machineType, serialNumber, status, data } = req.body;

        // Validate incoming request
        if (!machineType || !serialNumber || !status || !data) {
            return res.status(400).send('Missing required fields');
        }

        // Insert data into the appropriate machine table
        let queryText = '';
        if (machineType.toLowerCase() === 'vimago3030') {
            queryText = `INSERT INTO vimago3030 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, modality_type) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else if (machineType.toLowerCase() === 'pico3030') {
            queryText = `INSERT INTO pico3030 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, modality_type) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else if (machineType.toLowerCase() === 'see_factor_ct3') {
            queryText = `INSERT INTO see_factor_ct3 (serial_number, modality, acquisition_date, acquisition_time, study_uid, series_uid, modality_type) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        } else {
            return res.status(400).send('Invalid machine type');
        }

        const values = [
            serialNumber,
            data.modality_type, // Add modality type
            data.acquisition_date || null,
            data.acquisition_time || null,
            data.study_uid || null,
            data.series_uid || null,
            data.modality_type // Include modality type
        ];

        await pool.query(queryText, values);

        // Insert into detailed tables
        await pool.query(`INSERT INTO series_info (serial_number, series_id, temperature, kV, modality_type) 
                          VALUES ($1, $2, $3, $4, $5)`, 
                          [serialNumber, data.series_info.series_id, data.series_info.temperature, data.series_info.kV, data.series_info.modality_type]);

        await pool.query(`INSERT INTO source_info (serial_number, source_type, energy, modality_type) 
                          VALUES ($1, $2, $3, $4)`, 
                          [serialNumber, data.source_info.source_type, data.source_info.energy, data.source_info.modality_type]);

        await pool.query(`INSERT INTO system_info (serial_number, angle_range, linear_position, modality_type) 
                          VALUES ($1, $2, $3, $4)`, 
                          [serialNumber, data.system_info.angle_range, data.system_info.linear_position, data.system_info.modality_type]);

        await pool.query(`INSERT INTO acquisition_info (serial_number, frame_rate, grid_type, modality_type) 
                          VALUES ($1, $2, $3, $4)`, 
                          [serialNumber, data.acquisition_info.frame_rate, data.acquisition_info.grid_type, data.acquisition_info.modality_type]);

        await pool.query(`INSERT INTO reconstruction_info (serial_number, algorithm, kernel_type, total_stacks, modality_type) 
                          VALUES ($1, $2, $3, $4, $5)`, 
                          [serialNumber, data.reconstruction_info.algorithm, data.reconstruction_info.kernel_type, data.reconstruction_info.total_stacks, data.reconstruction_info.modality_type]);

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




