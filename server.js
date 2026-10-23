const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Frontend files serve karne ke liye
app.use(express.static(__dirname));

// Gemini Chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    // Yahan apni Gemini API key rakh dein
    const apiKey = process.env.GEMINI_API_KEY || "YAHAN_APNI_API_KEY_PASTE_KAREIN";

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a helpful customer support AI for an online lingerie store named 'Her Second Skin PK'. Tagline: 'Comfort, Confidence & Elegance'. Official launch: 15 November 2026. WhatsApp: 0339-7055500. Reply politely in Roman Urdu or Urdu based on user prompt: "${prompt}"` }] }]
      })
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Maazrat, is waqt jawab nahi mil saka.";

    res.json({ reply });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});