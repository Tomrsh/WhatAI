const { 
    default: makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidDecode
} = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, push, onValue } = require('firebase/database');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const pino = require('pino');

// --- FIREBASE CONFIG (Sahi se bharna bhai) ---
const firebaseConfig = {
  apiKey: "AIzaSyAb7V8Xxg5rUYi8UKChEd3rR5dglJ6bLhU",
  authDomain: "t2-storage-4e5ca.firebaseapp.com",
  databaseURL: "https://t2-storage-4e5ca-default-rtdb.firebaseio.com",
  projectId: "t2-storage-4e5ca",
  storageBucket: "t2-storage-4e5ca.firebasestorage.app",
  messagingSenderId: "667143720466",
  appId: "1:667143720466:web:c8bfe23f3935d3c7e052cb",
  measurementId: "G-K2KPMMC5C6"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const SESSION_PATH = 'wa_session_v8';
const CHAT_PATH = 'wa_backups';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());

let sock;
let isConnected = false;
let qrCodeData = null;

// Firebase clean data helper
const cleanData = (obj) => JSON.parse(JSON.stringify(obj, (key, value) => 
    typeof value === 'undefined' ? null : value
));

// --- FIREBASE AUTH LOGIC ---
async function useFirebaseAuthState() {
    let creds;
    const sessionRef = ref(db, SESSION_PATH + '/creds');
    const snapshot = await get(sessionRef);

    if (snapshot.exists()) {
        creds = JSON.parse(JSON.stringify(snapshot.val()), (key, value) => {
            if (value && typeof value === 'object' && value.type === 'Buffer') return Buffer.from(value.data);
            return value;
        });
    } else {
        creds = require('@whiskeysockets/baileys').initAuthCreds();
    }

    return {
        state: {
            creds,
            keys: makeCacheableSignalKeyStore({
                get: async (type, ids) => {
                    const res = {};
                    for (const id of ids) {
                        const itemSnap = await get(ref(db, `${SESSION_PATH}/keys/${type}-${id}`));
                        if (itemSnap.exists()) res[id] = itemSnap.val();
                    }
                    return res;
                },
                set: async (data) => {
                    for (const type in data) {
                        for (const id in data[type]) {
                            const val = data[type][id];
                            const itemRef = ref(db, `${SESSION_PATH}/keys/${type}-${id}`);
                            val ? await set(itemRef, cleanData(val)) : await remove(itemRef);
                        }
                    }
                }
            }, pino({ level: 'silent' }))
        },
        saveCreds: async () => await set(sessionRef, cleanData(creds))
    };
}

async function startWhatsApp() {
    const { state, saveCreds } = await useFirebaseAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Master-V8", "Safari", "1.0.0"],
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
            io.emit('qr', qrCodeData);
        }

        if (connection === 'close') {
            isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("Reconnecting...");
                setTimeout(() => startWhatsApp(), 5000);
            } else {
                console.log("Logged Out. Clearing Session...");
                await remove(ref(db, SESSION_PATH));
                qrCodeData = null;
                startWhatsApp();
            }
        } else if (connection === 'open') {
            isConnected = true;
            qrCodeData = null;
            io.emit('ready', true);
            console.log('✅ WhatsApp V8 Connected Successfully');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const jid = msg.key.remoteJid;
        const name = msg.pushName || jid.split('@')[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "Media Message";
        const time = new Date().toLocaleString();
        const safeId = jid.replace(/[^a-zA-Z0-9]/g, '');

        push(ref(db, `${CHAT_PATH}/${safeId}`), {
            sender: name, text, time, fromMe: msg.key.fromMe, jid: jid
        });
    });
}

// API to Send Message
app.post('/send-api', async (req, res) => {
    let { jid, message } = req.body;
    if (!jid.includes('@')) jid = jid + '@s.whatsapp.net';
    try {
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// UI Route
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <title>WA-Master V8</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { background: #0b141a; color: #e9edef; font-family: 'Segoe UI', sans-serif; height: 100dvh; display: flex; overflow: hidden; }
        .sidebar { width: 100%; max-width: 350px; background: #111b21; border-right: 1px solid #222d34; display: flex; flex-direction: column; z-index: 50; transition: 0.3s; }
        .main { flex: 1; display: flex; flex-direction: column; background: #0b141a; position: relative; }
        @media (max-width: 768px) {
            .sidebar { position: fixed; left: -100%; height: 100%; }
            .sidebar.active { left: 0; }
        }
        .bubble { padding: 10px; border-radius: 12px; margin: 5px; max-width: 80%; font-size: 14px; }
        .in { background: #202c33; align-self: flex-start; }
        .out { background: #005c4b; align-self: flex-end; }
        #overlay { position: fixed; inset: 0; background: #0b141a; z-index: 100; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
        .hidden { display: none !important; }
    </style>
</head>
<body>

    <div id="overlay">
        <div id="qr-container" class="bg-white p-5 rounded-2xl mb-5">
            <div class="p-10 text-black font-bold animate-pulse">Initializing WhatsApp...</div>
        </div>
        <p class="text-emerald-500 font-bold uppercase tracking-tighter">Master V8 Engine</p>
    </div>

    <div class="sidebar" id="sidebar">
        <div class="p-4 bg-[#202c33] flex justify-between items-center">
            <h1 class="font-bold text-emerald-500">Backups</h1>
            <button onclick="openDirect()" class="text-emerald-500 text-lg"><i class="fas fa-plus-circle"></i></button>
        </div>
        <div id="chat-list" class="flex-1 overflow-y-auto"></div>
    </div>

    <div class="main">
        <div id="chat-header" class="hidden p-3 bg-[#202c33] flex items-center border-b border-[#222d34]">
            <button onclick="toggleSidebar()" class="md:hidden mr-3"><i class="fas fa-bars"></i></button>
            <div id="chat-name" class="font-bold flex-1 text-emerald-400">Select Chat</div>
            <div class="flex gap-2">
                <input id="timer-val" type="number" placeholder="Sec" class="w-12 bg-[#2a3942] rounded p-1 text-xs outline-none">
                <button onclick="sendMsg(true)" class="bg-orange-600 text-[10px] px-2 py-1 rounded font-bold">TIMER</button>
            </div>
        </div>

        <div id="msg-container" class="flex-1 overflow-y-auto p-4 flex flex-col">
            <div class="m-auto text-center opacity-10">
                <i class="fab fa-whatsapp text-9xl"></i>
                <p>Firebase Cloud Synced</p>
            </div>
        </div>

        <div id="input-bar" class="hidden p-3 bg-[#202c33] flex gap-2">
            <input id="input-txt" type="text" placeholder="Type a message..." class="flex-1 bg-[#2a3942] p-3 rounded-xl outline-none text-sm">
            <button onclick="sendMsg(false)" class="bg-emerald-500 text-black w-12 h-12 rounded-full flex items-center justify-center shadow-lg"><i class="fas fa-paper-plane"></i></button>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.1.3/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.1.3/firebase-database-compat.js"></script>

    <script>
        const socket = io();
        firebase.initializeApp(${JSON.stringify(firebaseConfig)});
        const fb = firebase.database();

        socket.on('qr', url => {
            document.getElementById('overlay').classList.remove('hidden');
            document.getElementById('qr-container').innerHTML = \`<img src="\${url}" class="w-64 h-64 shadow-xl">\`;
        });

        socket.on('ready', () => {
            document.getElementById('overlay').classList.add('hidden');
            syncList();
        });

        let activeJid = null;

        function toggleSidebar() { document.getElementById('sidebar').classList.toggle('active'); }

        function syncList() {
            fb.ref('${CHAT_PATH}').on('value', snap => {
                const list = document.getElementById('chat-list');
                list.innerHTML = '';
                snap.forEach(child => {
                    const data = Object.values(child.val());
                    const last = data[data.length - 1];
                    const div = document.createElement('div');
                    div.className = "p-4 border-b border-[#222d34] cursor-pointer hover:bg-[#202c33]";
                    div.onclick = () => { openChat(child.key, last.sender, last.jid); if(window.innerWidth < 768) toggleSidebar(); };
                    div.innerHTML = \`<div class="font-bold text-sm">\${last.sender}</div><div class="text-xs text-gray-500 truncate">\${last.text}</div>\`;
                    list.appendChild(div);
                });
            });
        }

        function openChat(id, name, jid) {
            activeJid = jid;
            document.getElementById('chat-header').classList.remove('hidden');
            document.getElementById('input-bar').classList.remove('hidden');
            document.getElementById('chat-name').innerText = name;
            fb.ref('${CHAT_PATH}/' + id).on('value', snap => {
                const box = document.getElementById('msg-container'); box.innerHTML = '';
                snap.forEach(c => {
                    const m = c.val();
                    box.innerHTML += \`<div class="bubble \${m.fromMe ? 'out' : 'in'}">\${m.text}<div class="text-[8px] mt-1 opacity-50 text-right">\${m.time.split(',')[1]}</div></div>\`;
                });
                box.scrollTop = box.scrollHeight;
            });
        }

        async function sendMsg(isTimer) {
            const txt = document.getElementById('input-txt');
            const sec = document.getElementById('timer-val').value;
            if(!txt.value || !activeJid) return;

            if(isTimer && sec) {
                alert('Timer set for ' + sec + 's');
                setTimeout(() => {
                    fetch('/send-api', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ jid: activeJid, message: '[Scheduled]: ' + txt.value }) });
                }, sec * 1000);
            } else {
                await fetch('/send-api', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ jid: activeJid, message: txt.value }) });
            }
            txt.value = '';
        }

        function openDirect() {
            const num = prompt("Enter number with country code (e.g. 91...)");
            if(num) openChat(num.replace(/[^0-9]/g, ''), num, num + '@s.whatsapp.net');
        }
    </script>
</body>
</html>
    `);
});

startWhatsApp();
server.listen(PORT, () => console.log('✅ WA-MASTER V8 LIVE!'));
