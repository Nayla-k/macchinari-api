// index.js
const express = require('express');
const { Pool } = require('pg'); // Import PostgreSQL client
const app = express();

// Middleware for handling JSON data
app.use(express.json());

// Setup your database connection using environment variable
const pool = new Pool({
    connectionString: process.env.database_url, // Use the DATABASE_URL environment variable
    ssl: {
        rejectUnauthorized: false, // Only use for development; adjust for production
    },
});

// Endpoint to receive machine data
app.post('/upload', async (req, res) => {
    const { macchinario, seriale, stato } = req.body; // Destructure data from request body

    // SQL query to insert data into the database
    try {
        const queryText = `
            INSERT INTO machine_data (macchinario, seriale, stato, timestamp)
            VALUES ($1, $2, $3, NOW()) RETURNING *; // Return the inserted row
        `;
        const values = [macchinario, seriale, stato]; // Values to insert

        const result = await pool.query(queryText, values); // Execute the query
        console.log('Dati ricevuti e salvati:', result.rows[0]); // Log the saved data

        // Send response back to client
        res.json({
            message: 'Dati ricevuti e salvati con successo!',
            data: result.rows[0], // Include saved data in the response
        });
    } catch (error) {
        console.error('Errore durante il salvataggio dei dati:', error); // Log any errors
        res.status(500).json({ error: 'Errore durante il salvataggio dei dati' }); // Send error response
    }
});

// Start the server
const PORT = process.env.PORT || 3000; // Define the port to listen on
app.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`); // Log server start message
});


