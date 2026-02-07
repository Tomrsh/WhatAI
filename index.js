const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    delay,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const pino = require('pino');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());

let sock;
let isConnected = false;

// --- FIXED SESSION MANAGEMENT ---
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: true,
        browser: ["Termux-Master", "Chrome", "1.0.0"],
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (requiresPatch) {
                message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
            }
            return message;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            const url = await qrcode.toDataURL(qr);
            io.emit('qr', url);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isConnected = false;
            io.emit('status', 'Offline');
            if (shouldReconnect) {
                console.log("Reconnecting in 5s...");
                setTimeout(() => startWhatsApp(), 5000);
            } else {
                console.log("Logged out. Delete 'auth_info' and scan again.");
            }
        } else if (connection === 'open') {
            isConnected = true;
            io.emit('ready', true);
            console.log('✅ Connected Successfully!');
        }
    });
}

// API for Message
app.post('/send', async (req, res) => {
    const { numbers, message, delayTime } = req.body;
    if (!isConnected) return res.status(500).json({ error: "Not Connected" });

    const list = Array.isArray(numbers) ? numbers : numbers.split(',');
    
    for (const num of list) {
        let cleanNum = num.replace(/\D/g, '');
        if (!cleanNum.startsWith('91') && cleanNum.length === 10) cleanNum = '91' + cleanNum;
        
        try {
            await sock.sendMessage(cleanNum + '@s.whatsapp.net', { text: message });
            await delay(delayTime * 1000);
        } catch (e) { console.log("Error sending to " + num); }
    }
    res.json({ success: true });
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WA-Master Pro v2</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { background: #0b141a; color: #e9edef; font-family: sans-serif; }
        .glass { background: #111b21; border: 1px solid #222d34; }
        .btn-wa { background: #00a884; color: #111b21; }
    </style>
</head>
<body class="pb-20">
    <div class="p-5 glass flex justify-between items-center sticky top-0 z-50">
        <h1 class="text-xl font-bold text-emerald-500"><i class="fab fa-whatsapp"></i> WA-Master Pro</h1>
        <div id="status" class="text-xs bg-red-500/20 text-red-500 px-3 py-1 rounded-full border border-red-500">Offline</div>
    </div>

    <div class="p-4 max-w-lg mx-auto space-y-6">
        <div id="qr-section" class="glass p-8 rounded-2xl text-center">
            <div id="qr-img" class="bg-white p-2 rounded-lg inline-block mb-4">
                <p class="text-black text-sm p-10">Initializing...</p>
            </div>
            <p class="text-gray-400 text-xs">Termux par session save rahegi, bar-bar scan nahi karna hoga.</p>
        </div>

        <div id="main-ui" class="hidden space-y-4">
            <div class="glass p-5 rounded-2xl">
                <h2 class="font-bold mb-4 text-emerald-400"><i class="fas fa-paper-plane"></i> Advanced Bulk Sender</h2>
                
                <button onclick="selectContacts()" class="w-full mb-4 py-2 border border-emerald-500/50 text-emerald-500 rounded-lg text-sm font-bold">
                    <i class="fas fa-address-book"></i> Select From Device Contacts
                </button>

                <textarea id="numbers" rows="3" placeholder="919876543210, 918877..." class="w-full bg-[#2a3942] p-3 rounded-lg text-sm outline-none mb-4"></textarea>
                <textarea id="msg" rows="4" placeholder="Message content..." class="w-full bg-[#2a3942] p-3 rounded-lg text-sm outline-none mb-4"></textarea>
                
                <div class="flex items-center justify-between mb-4">
                    <span class="text-xs text-gray-400">Anti-Ban Delay (Sec)</span>
                    <input id="delay" type="number" value="3" class="w-16 bg-[#2a3942] p-1 rounded text-center">
                </div>

                <button onclick="send()" class="btn-wa w-full py-4 rounded-xl font-extrabold shadow-xl">START BROADCAST</button>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        
        socket.on('qr', url => {
            document.getElementById('qr-img').innerHTML = \`<img src="\${url}" class="w-48 h-48">\`;
        });

        socket.on('ready', () => {
            document.getElementById('qr-section').classList.add('hidden');
            document.getElementById('main-ui').classList.remove('hidden');
            const st = document.getElementById('status');
            st.innerText = 'Online';
            st.className = 'text-xs bg-emerald-500/20 text-emerald-500 px-3 py-1 rounded-full border border-emerald-500';
        });

        async function selectContacts() {
            try {
                const props = ['name', 'tel'];
                const opts = { multiple: true };
                const contacts = await navigator.contacts.select(props, opts);
                if (contacts.length) {
                    const nums = contacts.map(c => c.tel[0].replace(/\s+/g, ''));
                    document.getElementById('numbers').value = nums.join(', ');
                }
            } catch (e) {
                alert("Contact Picker sirf Chrome Mobile par support hota hai. Please manually enter karein.");
            }
        }

        async function send() {
            const btn = event.target;
            btn.disabled = true; btn.innerText = 'Processing...';
            
            await fetch('/send', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    numbers: document.getElementById('numbers').value,
                    message: document.getElementById('msg').value,
                    delayTime: document.getElementById('delay').value
                })
            });
            alert('Messages Sent!');
            btn.disabled = false; btn.innerText = 'START BROADCAST';
        }
    </script>
</body>
</html>
    `);
});

startWhatsApp();
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
