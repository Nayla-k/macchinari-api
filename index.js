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
app.post('/upload', async (req, res) => {
    try {
        const { machineType, serialNumber, status, data } = req.body;
        
        console.log('Received request:', { machineType, serialNumber, status });
        console.log('Data object:', data);

        if (!machineType || !serialNumber || !status || !data) {
            console.log('Missing required fields:', { machineType, serialNumber, status, data });
            return res.status(400).send('Missing required fields');
        }

        // Update Prometheus metrics based on incoming data
        if (machineType === 'CT' || machineType === 'DR') {
            const temperature = data.series_info?.temperature || 0;  // Default to 0 if not provided
            const kV = data.source_info?.kV || 0;
            const mA = data.source_info?.mA || 0;
            const exposureTimeMs = data.source_info?.exposure_time_ms || 0;
            const imageCount = data.series_info?.image_count || 0;

            // Set Prometheus metric values with labels
            metrics.temperature.set({ serial_number: serialNumber, machine_type: machineType }, temperature);
            metrics.kV.set({ serial_number: serialNumber, machine_type: machineType }, kV);
            metrics.mA.set({ serial_number: serialNumber, machine_type: machineType }, mA);
            metrics.exposureTimeMs.set({ serial_number: serialNumber, machine_type: machineType }, exposureTimeMs);
            metrics.imageCount.set({ serial_number: serialNumber, machine_type: machineType }, imageCount);
        }

        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');

            // Main table insert remains the same
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

            // Modified series_info insert based on modality type
            if (data.series_info) {
                let seriesQueryText;
                let seriesValues;

                if (data.modality_type === 'CT') {
                    seriesQueryText = `
                        INSERT INTO series_info (
                            serial_number, 
                            series_id, 
                            temperature, 
                            kV, 
                            modality_type
                        ) VALUES ($1, $2, $3, $4, $5)
                    `;
                    seriesValues = [
                        serialNumber,
                        data.series_info.series_id,
                        data.series_info.temperature,
                        data.series_info.kV,
                        data.modality_type
                    ];
                } else if (data.modality_type === 'DR') {
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
                    seriesValues = [
                        serialNumber,
                        data.series_info.series_number,
                        data.series_info.image_count,
                        data.series_info.patient_id,
                        data.series_info.exam_type,
                        data.modality_type
                    ];
                }

                if (seriesQueryText) {
                    await client.query(seriesQueryText, seriesValues);
                }
            }

            // Similar modifications for source_info
            if (data.source_info) {
                let sourceQueryText;
                let sourceValues;

                if (data.modality_type === 'CT') {
                    sourceQueryText = `
                        INSERT INTO source_info (
                            serial_number, 
                            source_type, 
                            energy, 
                            modality_type
                        ) VALUES ($1, $2, $3, $4)
                    `;
                    sourceValues = [
                        serialNumber,
                        data.source_info.source_type,
                        data.source_info.energy,
                        data.modality_type
                    ];
                } else if (data.modality_type === 'DR') {
                    sourceQueryText = `
                        INSERT INTO dr_source_info (
                            serial_number,
                            source_type,
                            kV,
                            mA,
                            exposure_time_ms,
                            temperature_celsius,
                            modality_type
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    `;
                    sourceValues = [
                        serialNumber,
                        data.source_info.source_type,
                        data.source_info.kV,
                        data.source_info.mA,
                        data.source_info.exposure_time_ms,
                        data.source_info.temperature_celsius,
                        data.modality_type
                    ];
                }

                if (sourceQueryText) {
                    await client.query(sourceQueryText, sourceValues);
                }
            }

            // Add similar modifications for other tables...

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




