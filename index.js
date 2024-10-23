const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

// PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.database_url || 'your-postgresql-connection-string',
    ssl: {
        rejectUnauthorized: false, // Adjust this based on your environment
    },
});

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Endpoint to handle incoming machine data
app.post('/upload', async (req, res) => {
    const { macchinario, seriale, stato, modalData } = req.body;

    try {
        // Check if machine exists and insert if not
        let machineId;
        const machineQuery = `
            INSERT INTO machines (serial_number, machine_type) 
            VALUES ($1, $2) 
            ON CONFLICT (serial_number) DO UPDATE 
            SET machine_type = EXCLUDED.machine_type 
            RETURNING id
        `;
        const machineValues = [seriale, macchinario];
        const machineResult = await pool.query(machineQuery, machineValues);
        machineId = machineResult.rows[0].id;

        // Insert modality information
        const { modality_type, acquisition_date, acquisition_time } = modalData; // Adjust this based on your structure
        const modalityQuery = `
            INSERT INTO modalities (machine_id, modality_type, acquisition_date, acquisition_time, modality_info) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id
        `;
        const modalityValues = [machineId, modality_type, acquisition_date, acquisition_time, JSON.stringify(modalData)];
        const modalityResult = await pool.query(modalityQuery, modalityValues);
        const modalityId = modalityResult.rows[0].id;

        // Depending on the modality type, insert the respective data
        if (modality_type === 'CT') {
            const ctDataQuery = `
                INSERT INTO ct_data (modality_id, focal_spot, xray_kv, xray_ma, xray_ms, angle_range_deg, angle_start_deg, gantry_linear_pos_mm, gantry_panel_pos_mm, ctdivol_mgy, total_dlp_mgy_cm, reconstruction_info)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
            const ctDataValues = [
                modalityId,
                modalData.focal_spot,
                modalData.xray_kv,
                modalData.xray_ma,
                modalData.xray_ms,
                modalData.angle_range_deg,
                modalData.angle_start_deg,
                modalData.gantry_linear_pos_mm,
                modalData.gantry_panel_pos_mm,
                modalData.ctdivol_mgy,
                modalData.total_dlp_mgy_cm,
                modalData.reconstruction_info,
            ];
            await pool.query(ctDataQuery, ctDataValues);
        } else if (modality_type === 'DR') {
            const drDataQuery = `
                INSERT INTO dr_data (modality_id, collimator_filter, collimator_mode, focal_spot, xray_kv, xray_ma, xray_ms, gantry_linear_pos_mm, gantry_panel_pos_mm, binning, pixel_pitch_mm, raw_height, raw_width, reconstruction_info)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `;
            const drDataValues = [
                modalityId,
                modalData.collimator_filter,
                modalData.collimator_mode,
                modalData.focal_spot,
                modalData.xray_kv,
                modalData.xray_ma,
                modalData.xray_ms,
                modalData.gantry_linear_pos_mm,
                modalData.gantry_panel_pos_mm,
                modalData.binning,
                modalData.pixel_pitch_mm,
                modalData.raw_height,
                modalData.raw_width,
                modalData.reconstruction_info,
            ];
            await pool.query(drDataQuery, drDataValues);
        }

        res.status(200).json({ message: 'Data saved successfully' });
    } catch (error) {
        console.error('Error saving data:', error);
        res.status(500).json({ error: 'Error saving data' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});






