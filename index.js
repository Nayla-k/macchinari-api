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
                console.log('No changes detected. Data not inserted into vimago3030.');
            }

            // Handle series_info based on modality
            if (data.series_info) {
                let seriesQueryText;
                let seriesValues;

                // Handle series_info and dr_series_info
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
                        // Check for updates
                        const existingSeriesData = existingSeries.rows[0];
                        const isSeriesUpdated = !(
                            existingSeriesData.temperature === data.series_info.temperature &&
                            existingSeriesData.kV === data.series_info.kV
                        );

                        if (isSeriesUpdated) {
                            const updateSeriesQueryText = `
                                UPDATE series_info SET 
                                    temperature = $1, 
                                    kV = $2 
                                WHERE serial_number = $3 AND series_id = $4
                            `;
                            await client.query(updateSeriesQueryText, [
                                data.series_info.temperature,
                                data.series_info.kV,
                                serialNumber,
                                data.series_info.series_id
                            ]);
                            console.log('Updated existing record in series_info.');
                        } else {
                            console.log('No changes detected for series_info. Data not updated.');
                        }
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

            // Handle source_info and dr_source_info
            if (data.source_info) {
                let sourceQueryText = `
                    SELECT * FROM source_info WHERE serial_number = $1 AND source_type = $2
                `;
                let sourceValues = [
                    serialNumber,
                    data.source_info.source_type,
                ];

                const existingSource = await client.query(sourceQueryText, sourceValues);
                if (existingSource.rows.length === 0) {
                    // Insert new source_info
                    sourceQueryText = `
                        INSERT INTO source_info (
                            serial_number, 
                            source_type, 
                            energy, 
                            modality_type
                        ) VALUES ($1, $2, $3, $4)
                    `;
                    await client.query(sourceQueryText, [
                        serialNumber,
                        data.source_info.source_type,
                        data.source_info.energy,
                        data.modality_type
                    ]);
                    console.log('Inserted new record into source_info.');
                } else {
                    const existingSourceData = existingSource.rows[0];
                    const isSourceUpdated = !(
                        existingSourceData.energy === data.source_info.energy
                    );

                    if (isSourceUpdated) {
                        const updateSourceText = `
                            UPDATE source_info SET 
                                energy = $1 
                            WHERE serial_number = $2 AND source_type = $3
                        `;
                        await client.query(updateSourceText, [
                            data.source_info.energy,
                            serialNumber,
                            data.source_info.source_type
                        ]);
                        console.log('Updated existing record in source_info.');
                    } else {
                        console.log('No changes detected for source_info. Data not updated.');
                    }
                }

                // Handle dr_source_info
                if (data.modality_type === 'DR') {
                    const drSourceQueryText = `
                        SELECT * FROM dr_source_info WHERE serial_number = $1 AND source_type = $2
                    `;
                    const drSourceValues = [
                        serialNumber,
                        data.source_info.source_type,
                    ];

                    const existingDrSource = await client.query(drSourceQueryText, drSourceValues);
                    if (existingDrSource.rows.length === 0) {
                        const insertDrSourceText = `
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
                        await client.query(insertDrSourceText, [
                            serialNumber,
                            data.source_info.source_type,
                            data.source_info.kV,
                            data.source_info.mA,
                            data.source_info.exposure_time_ms,
                            data.source_info.temperature_celsius,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_source_info.');
                    } else {
                        console.log('dr_source_info already exists. No changes detected.');
                    }
                }
            }

            // Handle system_info and dr_system_info
            if (data.system_info) {
                let systemQueryText = `
                    SELECT * FROM system_info WHERE serial_number = $1
                `;
                let systemValues = [serialNumber];

                const existingSystem = await client.query(systemQueryText, systemValues);
                if (existingSystem.rows.length === 0) {
                    // Insert new system_info
                    systemQueryText = `
                        INSERT INTO system_info (
                            serial_number, 
                            angle_range, 
                            linear_position, 
                            modality_type
                        ) VALUES ($1, $2, $3, $4)
                    `;
                    await client.query(systemQueryText, [
                        serialNumber,
                        data.system_info.angle_range,
                        data.system_info.linear_position,
                        data.modality_type
                    ]);
                    console.log('Inserted new record into system_info.');
                } else {
                    const existingSystemData = existingSystem.rows[0];
                    const isSystemUpdated = !(
                        existingSystemData.angle_range === data.system_info.angle_range &&
                        existingSystemData.linear_position === data.system_info.linear_position
                    );

                    if (isSystemUpdated) {
                        const updateSystemText = `
                            UPDATE system_info SET 
                                angle_range = $1, 
                                linear_position = $2 
                            WHERE serial_number = $3
                        `;
                        await client.query(updateSystemText, [
                            data.system_info.angle_range,
                            data.system_info.linear_position,
                            serialNumber
                        ]);
                        console.log('Updated existing record in system_info.');
                    } else {
                        console.log('No changes detected for system_info. Data not updated.');
                    }
                }

                // Handle dr_system_info
                if (data.modality_type === 'DR') {
                    const drSystemQueryText = `
                        SELECT * FROM dr_system_info WHERE serial_number = $1
                    `;
                    const existingDrSystem = await client.query(drSystemQueryText, [serialNumber]);
                    if (existingDrSystem.rows.length === 0) {
                        const insertDrSystemText = `
                            INSERT INTO dr_system_info (
                                serial_number,
                                linear_position_mm,
                                panel_position_mm,
                                angle_range_degrees,
                                manufacturer,
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(insertDrSystemText, [
                            serialNumber,
                            data.system_info.linear_position_mm,
                            data.system_info.panel_position_mm,
                            data.system_info.angle_range_degrees,
                            data.system_info.manufacturer,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_system_info.');
                    } else {
                        console.log('dr_system_info already exists. No changes detected.');
                    }
                }
            }

            // Handle acquisition_info and dr_acquisition_info
            if (data.acquisition_info) {
                let acquisitionQueryText = `
                    SELECT * FROM acquisition_info WHERE serial_number = $1
                `;
                let acquisitionValues = [serialNumber];

                const existingAcquisition = await client.query(acquisitionQueryText, acquisitionValues);
                if (existingAcquisition.rows.length === 0) {
                    // Insert new acquisition_info
                    acquisitionQueryText = `
                        INSERT INTO acquisition_info (
                            serial_number, 
                            frame_rate, 
                            grid_type, 
                            modality_type
                        ) VALUES ($1, $2, $3, $4)
                    `;
                    await client.query(acquisitionQueryText, [
                        serialNumber,
                        data.acquisition_info.frame_rate, 
                        data.acquisition_info.grid_type,    
                        data.modality_type
                    ]);
                    console.log('Inserted new record into acquisition_info.');
                } else {
                    const existingAcquisitionData = existingAcquisition.rows[0];
                    const isAcquisitionUpdated = !(
                        existingAcquisitionData.frame_rate === data.acquisition_info.frame_rate &&
                        existingAcquisitionData.grid_type === data.acquisition_info.grid_type
                    );

                    if (isAcquisitionUpdated) {
                        const updateAcquisitionText = `
                            UPDATE acquisition_info SET 
                                frame_rate = $1, 
                                grid_type = $2 
                            WHERE serial_number = $3
                        `;
                        await client.query(updateAcquisitionText, [
                            data.acquisition_info.frame_rate,
                            data.acquisition_info.grid_type,
                            serialNumber
                        ]);
                        console.log('Updated existing record in acquisition_info.');
                    } else {
                        console.log('No changes detected for acquisition_info. Data not updated.');
                    }
                }

                // Handle dr_acquisition_info
                if (data.modality_type === 'DR') {
                    const drAcquisitionQueryText = `
                        SELECT * FROM dr_acquisition_info WHERE serial_number = $1
                    `;
                    const existingDrAcquisition = await client.query(drAcquisitionQueryText, [serialNumber]);
                    if (existingDrAcquisition.rows.length === 0) {
                        const insertDrAcquisitionText = `
                            INSERT INTO dr_acquisition_info (
                                serial_number,
                                anti_scatter_grid,
                                binning,
                                frames_per_run,
                                frame_rate_hz,
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(insertDrAcquisitionText, [
                            serialNumber,
                            data.acquisition_info.anti_scatter_grid,
                            data.acquisition_info.binning,
                            data.acquisition_info.frames_per_run,
                            data.acquisition_info.frame_rate_hz,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_acquisition_info.');
                    } else {
                        console.log('dr_acquisition_info already exists. No changes detected.');
                    }
                }
            }

            // Handle reconstruction_info
            if (data.reconstruction_info) {
                let reconstructionQueryText = `
                    SELECT * FROM reconstruction_info WHERE serial_number = $1
                `;
                let reconstructionValues = [serialNumber];

                const existingReconstruction = await client.query(reconstructionQueryText, reconstructionValues);
                if (existingReconstruction.rows.length === 0) {
                    // Insert new reconstruction_info
                    reconstructionQueryText = `
                        INSERT INTO reconstruction_info (
                            serial_number, 
                            algorithm, 
                            kernel_type, 
                            total_stacks, 
                            modality_type
                        ) VALUES ($1, $2, $3, $4, $5)
                    `;
                    await client.query(reconstructionQueryText, [
                        serialNumber,
                        data.reconstruction_info.algorithm,
                        data.reconstruction_info.kernel_type,
                        data.reconstruction_info.total_stacks,
                        data.modality_type
                    ]);
                    console.log('Inserted new record into reconstruction_info.');
                } else {
                    const existingReconstructionData = existingReconstruction.rows[0];
                    const isReconstructionUpdated = !(
                        existingReconstructionData.algorithm === data.reconstruction_info.algorithm &&
                        existingReconstructionData.kernel_type === data.reconstruction_info.kernel_type &&
                        existingReconstructionData.total_stacks === data.reconstruction_info.total_stacks
                    );

                    if (isReconstructionUpdated) {
                        const updateReconstructionText = `
                            UPDATE reconstruction_info SET 
                                algorithm = $1, 
                                kernel_type = $2, 
                                total_stacks = $3 
                            WHERE serial_number = $4
                        `;
                        await client.query(updateReconstructionText, [
                            data.reconstruction_info.algorithm,
                            data.reconstruction_info.kernel_type,
                            data.reconstruction_info.total_stacks,
                            serialNumber
                        ]);
                        console.log('Updated existing record in reconstruction_info.');
                    } else {
                        console.log('No changes detected for reconstruction_info. Data not updated.');
                    }
                }
            }

            await client.query('COMMIT');
            res.status(200).send('Data processed successfully.');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Transaction error:', error);
            res.status(500).send('Internal Server Error');
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error in /upload route:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});




