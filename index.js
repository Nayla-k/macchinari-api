// index.js
const express = require('express');
const app = express();

// Middleware per gestire i dati JSON in arrivo
app.use(express.json());

// Endpoint per ricevere i dati dei macchinari
app.post('/upload', (req, res) => {
    const machineData = req.body;

    // Log dei dati ricevuti dal client
    console.log('Dati ricevuti:', machineData);

    // Puoi salvare i dati in un database o restituirli come conferma
    res.json({
        message: 'Dati ricevuti con successo!',
        data: machineData
    });
});

// Avvia il server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server in ascolto sulla porta ${PORT}`);
});
