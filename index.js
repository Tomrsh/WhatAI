const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const pino = require('pino');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;
app.use(bodyParser.json());

let sock;
let qrCodeData = "";
let connectionStatus = "Disconnected";
let excludedNumbers = new Set(); // Numbers where automation is OFF

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrCodeData = qr;
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "Disconnected";
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = "Connected ✅";
            qrCodeData = "";
        }
    });

    // --- AI Automation Logic ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid.split('@')[0];
        const messageText = m.message.conversation || m.message.extendedTextMessage?.text || "";

        // Check if automation is OFF for this number
        if (excludedNumbers.has(sender)) {
            console.log(`Automation skipped for: ${sender}`);
            return;
        }

        // Simple Trigger Logic
        if (messageText.toLowerCase() === 'hi') {
            await sock.sendMessage(m.key.remoteJid, { text: "Hello! Main Baileys AI hoon. Automation ON hai! 🤖" });
        }
    });
}

connectToWhatsApp();

// --- Frontend HTML & APIs ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <title>Baileys Powerful Automator</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0b141a; color: white; text-align: center; padding: 40px; }
            .card { background: #202c33; padding: 30px; border-radius: 20px; max-width: 500px; margin: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            #qr-box { background: white; padding: 10px; display: inline-block; margin: 20px; border-radius: 10px; }
            .btn { background: #00a884; color: white; border: none; padding: 12px 25px; border-radius: 25px; cursor: pointer; font-size: 16px; font-weight: bold; transition: 0.3s; }
            .btn:hover { background: #06cf9c; }
            .off-list { text-align: left; background: #2a3942; padding: 15px; border-radius: 10px; margin-top: 20px; max-height: 200px; overflow-y: auto; }
            .item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #3b4a54; }
            .remove-btn { color: #ff5e5e; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>WhatsApp Baileys AI</h2>
            <p id="status">Status: Checking...</p>
            <div id="qr-box">QR Code Loading...</div>
            <br><br>
            <button class="btn" onclick="pickContacts()">📁 Contacts Select Karein (Disable Automation)</button>
            
            <div class="off-list">
                <strong>Automation OFF List:</strong>
                <div id="excluded-container"></div>
            </div>
        </div>

        <script>
            async function updateUI() {
                const res = await fetch('/api/status');
                const data = await res.json();
                document.getElementById('status').innerText = "Status: " + data.status;
                
                const qrBox = document.getElementById('qr-box');
                if (data.qr && data.status !== "Connected ✅") {
                    qrBox.innerHTML = '<img src="' + data.qr + '" />';
                } else if (data.status === "Connected ✅") {
                    qrBox.innerHTML = "<h3 style='color:#00a884'>Aap Connected Hain!</h3>";
                }
            }

            async function pickContacts() {
                try {
                    const props = ['name', 'tel'];
                    const contacts = await navigator.contacts.select(props, { multiple: true });
                    for (const c of contacts) {
                        const num = c.tel[0].replace(/\\D/g, '').replace(/^0+/, '');
                        await fetch('/api/exclude', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ number: num.length > 10 ? num : '91' + num })
                        });
                    }
                    loadExcluded();
                } catch (e) { alert("Browser contact picker support nahi karta. Localhost/HTTPS par try karein."); }
            }

            async function loadExcluded() {
                const res = await fetch('/api/excluded-list');
                const list = await res.json();
                document.getElementById('excluded-container').innerHTML = list.map(n => 
                    \`<div class="item"><span>\${n}</span> <span class="remove-btn" onclick="removeExclude('\${n}')">Remove</span></div>\`
                ).join('');
            }

            async function removeExclude(num) {
                await fetch('/api/include', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ number: num }) });
                loadExcluded();
            }

            setInterval(updateUI, 3000);
            loadExcluded();
        </script>
    </body>
    </html>
    `);
});

// --- API Endpoints ---
app.get('/api/status', async (req, res) => {
    let qrImg = qrCodeData ? await qrcode.toDataURL(qrCodeData) : "";
    res.json({ status: connectionStatus, qr: qrImg });
});

app.post('/api/exclude', (req, res) => {
    excludedNumbers.add(req.body.number);
    res.sendStatus(200);
});

app.post('/api/include', (req, res) => {
    excludedNumbers.delete(req.body.number);
    res.sendStatus(200);
});

app.get('/api/excluded-list', (req, res) => {
    res.json(Array.from(excludedNumbers));
});

app.listen(port, () => console.log(`Dashboard: http://localhost:${port}`));
