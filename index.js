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
                console.log('No changes detected for main record. Data not inserted.');
            }

            // Handle series_info and source_info based on modality
            if (data.series_info) {
                // For CT Modality
                if (data.modality_type === 'CT') {
                    const seriesQueryText = `
                        SELECT * FROM series_info WHERE serial_number = $1 AND series_id = $2
                    `;
                    const seriesValues = [
                        serialNumber,
                        data.series_info.series_id,
                    ];

                    const existingSeries = await client.query(seriesQueryText, seriesValues);
                    if (existingSeries.rows.length === 0) {
                        // Insert new series_info
                        const insertSeriesText = `
                            INSERT INTO series_info (
                                serial_number, 
                                series_id, 
                                temperature, 
                                kV, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5)
                        `;
                        await client.query(insertSeriesText, [
                            serialNumber,
                            data.series_info.series_id,
                            data.series_info.temperature,
                            data.series_info.kV,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into series_info.');
                    } else {
                        // Check for updates in series_info
                        const existingSeriesData = existingSeries.rows[0];
                        const isSeriesUpdated = !(
                            existingSeriesData.temperature === data.series_info.temperature &&
                            existingSeriesData.kV === data.series_info.kV
                        );

                        if (isSeriesUpdated) {
                            const updateSeriesText = `
                                UPDATE series_info SET 
                                    temperature = $1, 
                                    kV = $2 
                                WHERE serial_number = $3 AND series_id = $4
                            `;
                            await client.query(updateSeriesText, [
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
                }

                // For DR Modality
                else if (data.modality_type === 'DR') {
                    const drSeriesQueryText = `
                        SELECT * FROM dr_series_info WHERE serial_number = $1 AND series_number = $2
                    `;
                    const drSeriesValues = [
                        serialNumber,
                        data.series_info.series_number,
                    ];

                    const existingDrSeries = await client.query(drSeriesQueryText, drSeriesValues);
                    if (existingDrSeries.rows.length === 0) {
                        // Insert new dr_series_info
                        const insertDrSeriesText = `
                            INSERT INTO dr_series_info (
                                serial_number,
                                series_number,
                                image_count,
                                patient_id,
                                exam_type,
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(insertDrSeriesText, [
                            serialNumber,
                            data.series_info.series_number,
                            data.series_info.image_count,
                            data.series_info.patient_id,
                            data.series_info.exam_type,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_series_info.');
                    } else {
                        // Check for updates in dr_series_info
                        const existingDrSeriesData = existingDrSeries.rows[0];
                        const isDrSeriesUpdated = !(
                            existingDrSeriesData.image_count === data.series_info.image_count &&
                            existingDrSeriesData.patient_id === data.series_info.patient_id &&
                            existingDrSeriesData.exam_type === data.series_info.exam_type
                        );

                        if (isDrSeriesUpdated) {
                            const updateDrSeriesText = `
                                UPDATE dr_series_info SET 
                                    image_count = $1, 
                                    patient_id = $2,
                                    exam_type = $3
                                WHERE serial_number = $4 AND series_number = $5
                            `;
                            await client.query(updateDrSeriesText, [
                                data.series_info.image_count,
                                data.series_info.patient_id,
                                data.series_info.exam_type,
                                serialNumber,
                                data.series_info.series_number
                            ]);
                            console.log('Updated existing record in dr_series_info.');
                        } else {
                            console.log('No changes detected for dr_series_info. Data not updated.');
                        }
                    }
                }
            }

            // Handle source_info updates based on modality
            if (data.source_info) {
                let sourceQueryText;
                let sourceValues;

                if (data.modality_type === 'CT') {
                    sourceQueryText = `
                        SELECT * FROM source_info WHERE serial_number = $1
                    `;
                    sourceValues = [serialNumber];

                    const existingSource = await client.query(sourceQueryText, sourceValues);
                    if (existingSource.rows.length === 0) {
                        // Insert new source_info
                        const insertSourceText = `
                            INSERT INTO source_info (
                                serial_number, 
                                source_type, 
                                energy, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4)
                        `;
                        await client.query(insertSourceText, [
                            serialNumber,
                            data.source_info.source_type,
                            data.source_info.energy,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into source_info.');
                    } else {
                        // Check for updates in source_info
                        const existingSourceData = existingSource.rows[0];
                        const isSourceUpdated = !(
                            existingSourceData.source_type === data.source_info.source_type &&
                            existingSourceData.energy === data.source_info.energy
                        );

                        if (isSourceUpdated) {
                            const updateSourceText = `
                                UPDATE source_info SET 
                                    source_type = $1, 
                                    energy = $2 
                                WHERE serial_number = $3
                            `;
                            await client.query(updateSourceText, [
                                data.source_info.source_type,
                                data.source_info.energy,
                                serialNumber
                            ]);
                            console.log('Updated existing record in source_info.');
                        } else {
                            console.log('No changes detected for source_info. Data not updated.');
                        }
                    }
                } else if (data.modality_type === 'DR') {
                    sourceQueryText = `
                        SELECT * FROM dr_source_info WHERE serial_number = $1
                    `;
                    sourceValues = [serialNumber];

                    const existingDrSource = await client.query(sourceQueryText, sourceValues);
                    if (existingDrSource.rows.length === 0) {
                        // Insert new dr_source_info
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
                        // Check for updates in dr_source_info
                        const existingDrSourceData = existingDrSource.rows[0];
                        const isDrSourceUpdated = !(
                            existingDrSourceData.kV === data.source_info.kV &&
                            existingDrSourceData.mA === data.source_info.mA &&
                            existingDrSourceData.exposure_time_ms === data.source_info.exposure_time_ms &&
                            existingDrSourceData.temperature_celsius === data.source_info.temperature_celsius
                        );

                        if (isDrSourceUpdated) {
                            const updateDrSourceText = `
                                UPDATE dr_source_info SET 
                                    kV = $1, 
                                    mA = $2,
                                    exposure_time_ms = $3,
                                    temperature_celsius = $4 
                                WHERE serial_number = $5
                            `;
                            await client.query(updateDrSourceText, [
                                data.source_info.kV,
                                data.source_info.mA,
                                data.source_info.exposure_time_ms,
                                data.source_info.temperature_celsius,
                                serialNumber
                            ]);
                            console.log('Updated existing record in dr_source_info.');
                        } else {
                            console.log('No changes detected for dr_source_info. Data not updated.');
                        }
                    }
                }
            }

            // Handle other _info updates (dr_system_info, dr_acquisition_info, dr_patient_info)
            // You would follow a similar approach for these tables as well

            if (data.system_info) {
                let systemQueryText;
                let systemValues;

                if (data.modality_type === 'CT') {
                    systemQueryText = `
                        SELECT * FROM system_info WHERE serial_number = $1
                    `;
                    systemValues = [serialNumber];

                    const existingSystem = await client.query(systemQueryText, systemValues);
                    if (existingSystem.rows.length === 0) {
                        // Insert new system_info
                        const insertSystemText = `
                            INSERT INTO system_info (
                                serial_number, 
                                angle_range, 
                                linear_position, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4)
                        `;
                        await client.query(insertSystemText, [
                            serialNumber,
                            data.system_info.angle_range,
                            data.system_info.linear_position,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into system_info.');
                    } else {
                        // Check for updates in system_info
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
                } else if (data.modality_type === 'DR') {
                    systemQueryText = `
                        SELECT * FROM dr_system_info WHERE serial_number = $1
                    `;
                    systemValues = [serialNumber];

                    const existingDrSystem = await client.query(systemQueryText, systemValues);
                    if (existingDrSystem.rows.length === 0) {
                        // Insert new dr_system_info
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
                        // Check for updates in dr_system_info
                        const existingDrSystemData = existingDrSystem.rows[0];
                        const isDrSystemUpdated = !(
                            existingDrSystemData.linear_position_mm === data.system_info.linear_position_mm &&
                            existingDrSystemData.panel_position_mm === data.system_info.panel_position_mm &&
                            existingDrSystemData.angle_range_degrees === data.system_info.angle_range_degrees &&
                            existingDrSystemData.manufacturer === data.system_info.manufacturer
                        );

                        if (isDrSystemUpdated) {
                            const updateDrSystemText = `
                                UPDATE dr_system_info SET 
                                    linear_position_mm = $1, 
                                    panel_position_mm = $2,
                                    angle_range_degrees = $3,
                                    manufacturer = $4 
                                WHERE serial_number = $5
                            `;
                            await client.query(updateDrSystemText, [
                                data.system_info.linear_position_mm,
                                data.system_info.panel_position_mm,
                                data.system_info.angle_range_degrees,
                                data.system_info.manufacturer,
                                serialNumber
                            ]);
                            console.log('Updated existing record in dr_system_info.');
                        } else {
                            console.log('No changes detected for dr_system_info. Data not updated.');
                        }
                    }
                }
            }

            // Handle acquisition_info updates
            if (data.acquisition_info) {
                let acquisitionQueryText;
                let acquisitionValues;

                if (data.modality_type === 'CT') {
                    acquisitionQueryText = `
                        SELECT * FROM acquisition_info WHERE serial_number = $1
                    `;
                    acquisitionValues = [serialNumber];

                    const existingAcquisition = await client.query(acquisitionQueryText, acquisitionValues);
                    if (existingAcquisition.rows.length === 0) {
                        // Insert new acquisition_info
                        const insertAcquisitionText = `
                            INSERT INTO acquisition_info (
                                serial_number, 
                                frames_per_run, 
                                frame_rate_hz, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(insertAcquisitionText, [
                            serialNumber,
                            data.acquisition_info.frames_per_run,
                            data.acquisition_info.frame_rate_hz,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into acquisition_info.');
                    } else {
                        // Check for updates in acquisition_info
                        const existingAcquisitionData = existingAcquisition.rows[0];
                        const isAcquisitionUpdated = !(
                            existingAcquisitionData.frames_per_run === data.acquisition_info.frames_per_run &&
                            existingAcquisitionData.frame_rate_hz === data.acquisition_info.frame_rate_hz
                        );

                        if (isAcquisitionUpdated) {
                            const updateAcquisitionText = `
                                UPDATE acquisition_info SET 
                                    frames_per_run = $3,
                                    frame_rate_hz = $4 
                                WHERE serial_number = $5
                            `;
                            await client.query(updateAcquisitionText, [
                                data.acquisition_info.frames_per_run,
                                data.acquisition_info.frame_rate_hz,
                                serialNumber
                            ]);
                            console.log('Updated existing record in acquisition_info.');
                        } else {
                            console.log('No changes detected for acquisition_info. Data not updated.');
                        }
                    }
                } else if (data.modality_type === 'DR') {
                    acquisitionQueryText = `
                        SELECT * FROM dr_acquisition_info WHERE serial_number = $1
                    `;
                    acquisitionValues = [serialNumber];

                    const existingDrAcquisition = await client.query(acquisitionQueryText, acquisitionValues);
                    if (existingDrAcquisition.rows.length === 0) {
                        // Insert new dr_acquisition_info
                        const insertDrAcquisitionText = `
                            INSERT INTO dr_acquisition_info (
                                serial_number,
                                frames_per_run, 
                                frame_rate_hz, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5, $6)
                        `;
                        await client.query(insertDrAcquisitionText, [
                            serialNumber,
                            data.acquisition_info.frames_per_run,
                            data.acquisition_info.frame_rate_hz,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_acquisition_info.');
                    } else {
                        // Check for updates in dr_acquisition_info
                        const existingDrAcquisitionData = existingDrAcquisition.rows[0];
                        const isDrAcquisitionUpdated = !(
                            existingDrAcquisitionData.frames_per_run === data.acquisition_info.frames_per_run &&
                            existingDrAcquisitionData.frame_rate_hz === data.acquisition_info.frame_rate_hz
                        );

                        if (isDrAcquisitionUpdated) {
                            const updateDrAcquisitionText = `
                                UPDATE dr_acquisition_info SET 
                                    frames_per_run = $3,
                                    frame_rate_hz = $4 
                                WHERE serial_number = $5
                            `;
                            await client.query(updateDrAcquisitionText, [
                                data.acquisition_info.frames_per_run,
                                data.acquisition_info.frame_rate_hz,
                                serialNumber
                            ]);
                            console.log('Updated existing record in dr_acquisition_info.');
                        } else {
                            console.log('No changes detected for dr_acquisition_info. Data not updated.');
                        }
                    }
                }
            }

            // Handle patient_info updates
            if (data.patient_info) {
                let patientQueryText;
                let patientValues;

                if (data.modality_type === 'CT') {
                    patientQueryText = `
                        SELECT * FROM patient_info WHERE serial_number = $1
                    `;
                    patientValues = [serialNumber];

                    const existingPatient = await client.query(patientQueryText, patientValues);
                    if (existingPatient.rows.length === 0) {
                        // Insert new patient_info
                        const insertPatientText = `
                            INSERT INTO patient_info (
                                serial_number, 
                                position, 
                                size_kg, 
                                target, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5)
                        `;
                        await client.query(insertPatientText, [
                            serialNumber,
                            data.patient_info.position,
                            data.patient_info.size_kg,
                            data.patient_info.target,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into patient_info.');
                    } else {
                        // Check for updates in patient_info
                        const existingPatientData = existingPatient.rows[0];
                        const isPatientUpdated = !(
                            existingPatientData.position === data.patient_info.position &&
                            existingPatientData.size_kg === data.patient_info.size_kg &&
                            existingPatientData.target === data.patient_info.target
                        );

                        if (isPatientUpdated) {
                            const updatePatientText = `
                                UPDATE patient_info SET 
                                    position = $1, 
                                    size_kg = $2,
                                    target = $3 
                                WHERE serial_number = $4
                            `;
                            await client.query(updatePatientText, [
                                data.patient_info.position,
                                data.patient_info.size_kg,
                                data.patient_info.target,
                                serialNumber
                            ]);
                            console.log('Updated existing record in patient_info.');
                        } else {
                            console.log('No changes detected for patient_info. Data not updated.');
                        }
                    }
                } else if (data.modality_type === 'DR') {
                    patientQueryText = `
                        SELECT * FROM dr_patient_info WHERE serial_number = $1
                    `;
                    patientValues = [serialNumber];

                    const existingDrPatient = await client.query(patientQueryText, patientValues);
                    if (existingDrPatient.rows.length === 0) {
                        // Insert new dr_patient_info
                        const insertDrPatientText = `
                            INSERT INTO dr_patient_info (
                                serial_number, 
                                position, 
                                size_kg, 
                                target, 
                                modality_type
                            ) VALUES ($1, $2, $3, $4, $5)
                        `;
                        await client.query(insertDrPatientText, [
                            serialNumber,
                            data.patient_info.position,
                            data.patient_info.size_kg,
                            data.patient_info.target,
                            data.modality_type
                        ]);
                        console.log('Inserted new record into dr_patient_info.');
                    } else {
                        // Check for updates in dr_patient_info
                        const existingDrPatientData = existingDrPatient.rows[0];
                        const isDrPatientUpdated = !(
                            existingDrPatientData.position === data.patient_info.position &&
                            existingDrPatientData.size_kg === data.patient_info.size_kg &&
                            existingDrPatientData.target === data.patient_info.target
                        );

                        if (isDrPatientUpdated) {
                            const updateDrPatientText = `
                                UPDATE dr_patient_info SET 
                                    position = $1, 
                                    size_kg = $2,
                                    target = $3 
                                WHERE serial_number = $4
                            `;
                            await client.query(updateDrPatientText, [
                                data.patient_info.position,
                                data.patient_info.size_kg,
                                data.patient_info.target,
                                serialNumber
                            ]);
                            console.log('Updated existing record in dr_patient_info.');
                        } else {
                            console.log('No changes detected for dr_patient_info. Data not updated.');
                        }
                    }
                }
            }

            // Commit the transaction
            await client.query('COMMIT');
            console.log('Transaction committed.');
            res.status(200).send('Data processed successfully');
        } catch (error) {
            console.error('Error during transaction:', error);
            await client.query('ROLLBACK');
            res.status(500).send('Internal Server Error');
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error in /upload endpoint:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});




