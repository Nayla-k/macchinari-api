const express = require('express'); 
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const cors = require('cors');
const promClient = require('prom-client');
const prometheusMiddleware = require('express-prometheus-middleware');
require('dotenv').config(); // Add this at the top

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
    connectionString: process.env.database_url, // Changed from database_url to DATABASE_URL
    ssl: {
        rejectUnauthorized: false,
    },
});

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

const metrics = {
    temperature: new promClient.Gauge({ name: 'machine_temperature', help: 'Temperature of the machine', labels: ['serial_number', 'machine_type'] }),
    kV: new promClient.Gauge({ name: 'machine_kV', help: 'X-Ray kV', labels: ['serial_number', 'machine_type'] }),
    mA: new promClient.Gauge({ name: 'machine_mA', help: 'X-Ray mA', labels: ['serial_number', 'machine_type'] }),
    exposureTimeMs: new promClient.Gauge({ name: 'machine_exposure_time_ms', help: 'Exposure time in ms', labels: ['serial_number', 'machine_type'] }),
    imageCount: new promClient.Gauge({ name: 'machine_image_count', help: 'Number of images captured', labels: ['serial_number', 'machine_type'] })
};

// Expose metrics at /metrics endpoint
app.use(prometheusMiddleware({
    metricsPath: '/metrics',
    collectDefaultMetrics: {}
}));


// Endpoint to receive machine data
// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    try {
        const { machineType, serialNumber, status, data } = req.body;

        console.log('Received request:', { machineType, serialNumber, status });
        console.log('Data object:', data);

        // Validate incoming data
        if (!machineType || !serialNumber || !status || !data) {
            console.log('Missing required fields:', { machineType, serialNumber, status, data });
            return res.status(400).send('Missing required fields');
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Check for existing record in the main table
            const existingRecord = await client.query(
                `SELECT * FROM vimago3030 WHERE serial_number = $1 AND modality_type = $2`,
                [serialNumber, data.modality_type]
            );

            let isNewRecord = true;

            if (existingRecord.rows.length > 0) {
                const existingData = existingRecord.rows[0];
                // Compare relevant fields to decide if data has changed
                // Add more fields to compare as needed
                isNewRecord = !(
                    existingData.status === status &&
                    existingData.acquisition_date === (data.acquisition_date || null) &&
                    existingData.acquisition_time === (data.acquisition_time || null) &&
                    existingData.study_uid === (data.study_uid || null) &&
                    existingData.series_uid === (data.series_uid || null)
                );
            }

            // Insert new record if data has changed or if it's a new record
            if (isNewRecord) {
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
                console.log('Inserted new record into vimago3030.');
            } else {
                console.log('No changes detected. Data not inserted.');
            }

            // Handle series_info and source_info based on modality
            // Check for existing series_info and source_info similarly
            if (data.series_info) {
                let seriesQueryText;
                let seriesValues;

                // Check if series_info exists and compare
                if (data.modality_type === 'CT') {
                    seriesQueryText = `
                        SELECT * FROM series_info WHERE serial_number = $1 AND series_id = $2
                    `;
                    seriesValues = [
                        serialNumber,
                        data.series_info.series_id,
                    ];

                    const existingSeries = await client.query(seriesQueryText, seriesValues);
                    if (existingSeries.rows.length === 0) {
                        // Insert new series_info since it doesn't exist
                        seriesQueryText = `
                            INSERT INTO series_info (
                                serial_number, 
                                series_id, 
                                temperature, 
                                kV, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5)
                        `;
                        await client.query(seriesQueryText, [
                            serialNumber,
                            data.series_info.series_id,
                            data.series_info.temperature,
                            data.series_info.kV,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into series_info.');
                    } else {
                        console.log('Series_info already exists. No changes detected.');
                    }
                } else if (data.modality_type === 'DR') {
                    seriesQueryText = `
                        SELECT * FROM dr_series_info WHERE serial_number = $1 AND series_number = $2
                    `;
                    seriesValues = [
                        serialNumber,
                        data.series_info.series_number,
                    ];

                    const existingSeries = await client.query(seriesQueryText, seriesValues);
                    if (existingSeries.rows.length === 0) {
                        // Insert new dr_series_info since it doesn't exist
                        seriesQueryText = `
                            INSERT INTO dr_series_info (
                                serial_number,
                                series_number,
                                image_count,
                                patient_id,
                                exam_type,
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(seriesQueryText, [
                            serialNumber,
                            data.series_info.series_number,
                            data.series_info.image_count,
                            data.series_info.patient_id,
                            data.series_info.exam_type,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_series_info.');
                    } else {
                        console.log('dr_series_info already exists. No changes detected.');
                    }
                }
            }

            // Handle source_info similarly based on modality...
            // Perform checks and conditional inserts for source_info like above

            await client.query('COMMIT');
            res.status(201).send('Data successfully processed');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error processing data:', error.stack);
        res.status(500).json({
            message: 'Error processing data',
            error: error.message
        });
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});




