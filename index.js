const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');

const app = express();
const port = 3000;
app.use(express.json());

let sock;
let qrCodeData = "";
let connectionStatus = "Disconnected";
let excludedNumbers = new Set();

// --- FREE AI CONFIG (Groq Example) ---
// Aap yahan apni free Groq key daal sakte hain
const GROQ_API_KEY = "http://key-to-url.onrender.com/get/c5js9j"; 

async function getAIResponse(userText) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama3-8b-8192",
            messages: [{ role: "user", content: userText }]
        }, {
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });
        return response.data.choices[0].message.content;
    } catch (err) {
        return "Sorry bhai, AI thoda thak gaya hai.";
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('wa_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) qrCodeData = qr;
        if (connection === 'open') connectionStatus = "Connected ✅";
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid.split('@')[0];
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";

        // Check if Automation is OFF for this person
        if (excludedNumbers.has(sender)) return;

        // Get Free AI Response
        const reply = await getAIResponse(text);
        await sock.sendMessage(m.key.remoteJid, { text: reply });
    });
}

connectToWhatsApp();

// --- Web Dashboard APIs ---
app.get('/', (req, res) => {
    res.send(`
    <html>
    <body style="font-family:sans-serif; text-align:center; background:#121b22; color:white;">
        <h2>WhatsApp Free AI Automation</h2>
        <div id="qr">Loading QR...</div>
        <p id="stat">Status: Checking...</p>
        <button onclick="pickContacts()" style="padding:10px; border-radius:10px; background:#25d366; color:white;">📁 Automation OFF karne ke liye select karein</button>
        <div id="list" style="margin-top:20px; color:#aaa;"></div>
        
        <script>
            setInterval(async () => {
                const r = await fetch('/status');
                const d = await r.json();
                document.getElementById('stat').innerText = d.status;
                if(d.qr) document.getElementById('qr').innerHTML = '<img src="'+d.qr+'" style="background:white; padding:10px;"/>';
                else if(d.status == "Connected ✅") document.getElementById('qr').innerHTML = "🟢 Bot Active!";
            }, 3000);

            async function pickContacts() {
                const contacts = await navigator.contacts.select(['tel'], {multiple: true});
                for(let c of contacts) {
                    let n = c.tel[0].replace(/\\D/g,'');
                    await fetch('/exclude', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({number: n})});
                }
                location.reload();
            }
        </script>
    </body>
    </html>
    `);
});

app.get('/status', async (req, res) => {
    let q = qrCodeData ? await qrcode.toDataURL(qrCodeData) : "";
    res.json({qr: q, status: connectionStatus});
});

app.post('/exclude', (req, res) => {
    excludedNumbers.add(req.body.number);
    res.sendStatus(200);
});

app.listen(port);
