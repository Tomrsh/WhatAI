/**
 * ULTIMATE WHATSAPP DASHBOARD (Node v24 & Termux Optimized)
 * Fixed: TypeError: makeInMemoryStore is not a function
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pino = require('pino');

// --- SAFE BAILEYS IMPORT (Fix for Node v24/Termux) ---
const BaileysLib = require('@whiskeysockets/baileys');
const makeWASocket = BaileysLib.default || BaileysLib;
const { 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeInMemoryStore, 
    BufferJSON, 
    delay 
} = BaileysLib.default ? BaileysLib : { ...BaileysLib, ...BaileysLib.default };

// --- FIREBASE MODULAR SDK ---
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, set, get, child, push, remove } = require("firebase/database");

// ==============================================================================
// 1. CONFIGURATION (Apna Firebase Config Yahan Dalein)
// ==============================================================================

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

const appFirebase = initializeApp(firebaseConfig);
const db = getDatabase(appFirebase);
const PORT = process.env.PORT || 3000;
const store = makeInMemoryStore({ logger: pino({ level: 'silent' }) });

// ==============================================================================
// 2. CUSTOM FIREBASE AUTH ADAPTER
// ==============================================================================

const useFirebaseAuthState = async (rootRef) => {
    const saveToDb = async (path, data) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await set(child(rootRef, path), json);
    };

    const readFromDb = async (path) => {
        const snapshot = await get(child(rootRef, path));
        if (snapshot.exists()) {
            return JSON.parse(snapshot.val(), BufferJSON.reviver);
        }
        return null;
    };

    let creds = (await readFromDb('creds')) || (await useMultiFileAuthState('temp_auth')).state.creds;

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        const val = await readFromDb(`keys/${type}/${id}`);
                        if (val) data[id] = val;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const path = `keys/${category}/${id}`;
                            if (value) tasks.push(saveToDb(path, value));
                            else tasks.push(remove(child(rootRef, path)));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => saveToDb('creds', creds)
    };
};

// ==============================================================================
// 3. WHATSAPP ENGINE & SERVER
// ==============================================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());

let sock;
let qrCodeData = null;
let connectionStatus = 'disconnected';

async function startWhatsApp() {
    const { state, saveCreds } = await useFirebaseAuthState(ref(db, 'whatsapp_session'));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true,
        browser: ["Ultimate Dash", "Chrome", "1.0.0"]
    });

    store.bind(sock.ev);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) { qrCodeData = qr; io.emit('qr', qr); connectionStatus = 'scanning'; }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = 'disconnected';
            io.emit('status', { status: 'disconnected' });
            if (shouldReconnect) startWhatsApp();
        } else if (connection === 'open') {
            connectionStatus = 'connected';
            qrCodeData = null;
            io.emit('status', { status: 'connected', user: sock.user });
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            for (const msg of messages) {
                if (!msg.message) continue;
                const payload = {
                    id: msg.key.id,
                    remoteJid: msg.key.remoteJid,
                    isFromMe: msg.key.fromMe,
                    text: msg.message.conversation || msg.message.extendedTextMessage?.text || "[Media]",
                    pushName: msg.pushName || "User",
                    timestamp: msg.messageTimestamp
                };
                io.emit('new_message', payload);
                const chatPath = `chats/${payload.remoteJid.replace(/[.#$/\[\]]/g, '_')}`;
                push(ref(db, chatPath), payload);
            }
        }
    });
}

startWhatsApp();

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.emit('status', { status: connectionStatus, user: sock?.user });
    if (qrCodeData) socket.emit('qr', qrCodeData);

    socket.on('send_direct', async ({ number, text }) => {
        const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text });
        socket.emit('ui_notification', { type: 'success', msg: 'Message Sent!' });
    });

    socket.on('schedule_msg', ({ number, text, seconds }) => {
        socket.emit('ui_notification', { type: 'info', msg: `Timer set: ${seconds}s` });
        setTimeout(async () => {
            const jid = `${number.replace(/\D/g, '')}@s.whatsapp.net`;
            if(sock) await sock.sendMessage(jid, { text });
        }, seconds * 1000);
    });
});

// ==============================================================================
// 4. UI (DASHBOARD)
// ==============================================================================

const HTML_UI = `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WA Dash v2.0</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
        body { background-color: #0c1317; color: #e9edef; }
        .wa-bg { background-image: url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); opacity: 0.05; }
    </style>
</head>
<body class="h-screen flex overflow-hidden flex-col md:flex-row">
    <div id="connOverlay" class="fixed inset-0 z-50 bg-[#111b21] flex flex-col items-center justify-center">
        <h1 class="text-2xl mb-4">Link Device</h1>
        <div id="qrcode" class="bg-white p-3 rounded"></div>
        <p class="mt-4 text-gray-500">Scan QR to Start Dashboard</p>
    </div>

    <div class="w-full md:w-80 bg-[#202c33] border-r border-gray-700 flex flex-col">
        <div class="p-4 flex justify-between items-center border-b border-gray-700">
            <div class="flex items-center gap-2">
                <div id="dot" class="w-3 h-3 rounded-full bg-red-500"></div>
                <span class="font-bold">WA Dashboard</span>
            </div>
            <div class="flex gap-2">
                <button onclick="toggleModal('directModal')" class="p-2 hover:bg-gray-600 rounded">💬</button>
                <button onclick="toggleModal('schModal')" class="p-2 hover:bg-gray-600 rounded">⏰</button>
            </div>
        </div>
        <div id="chatList" class="flex-1 overflow-y-auto p-2 text-sm text-gray-400 italic">No recent chats loaded...</div>
    </div>

    <div class="flex-1 relative flex flex-col bg-[#0b141a]">
        <div class="absolute inset-0 wa-bg pointer-events-none"></div>
        <div id="msgs" class="flex-1 p-4 overflow-y-auto space-y-3 z-10"></div>
        <div class="p-4 bg-[#202c33] z-10"><input disabled placeholder="Use Tool Icons for Sending" class="w-full bg-[#2a3942] p-2 rounded text-sm outline-none opacity-50"></div>
    </div>

    <div id="directModal" class="hidden fixed inset-0 bg-black/70 z-[60] items-center justify-center p-4">
        <div class="bg-[#202c33] p-6 rounded-lg w-full max-w-sm">
            <h2 class="text-lg mb-4">Direct Message</h2>
            <input id="num" placeholder="Number (with country code)" class="w-full bg-[#2a3942] p-2 rounded mb-3 outline-none">
            <textarea id="txt" placeholder="Message..." class="w-full bg-[#2a3942] p-2 rounded mb-4 h-24 outline-none"></textarea>
            <div class="flex justify-end gap-2">
                <button onclick="toggleModal('directModal')" class="px-4 py-2">Close</button>
                <button onclick="send()" class="bg-[#00a884] px-4 py-2 rounded text-black font-bold">Send</button>
            </div>
        </div>
    </div>

    <div id="schModal" class="hidden fixed inset-0 bg-black/70 z-[60] items-center justify-center p-4">
        <div class="bg-[#202c33] p-6 rounded-lg w-full max-w-sm">
            <h2 class="text-lg mb-4">Schedule Message</h2>
            <input id="sNum" placeholder="Number" class="w-full bg-[#2a3942] p-2 rounded mb-2 outline-none">
            <textarea id="sTxt" placeholder="Message..." class="w-full bg-[#2a3942] p-2 rounded mb-2 h-20 outline-none"></textarea>
            <input id="sTime" type="number" placeholder="Seconds" class="w-full bg-[#2a3942] p-2 rounded mb-4 outline-none">
            <button onclick="schedule()" class="w-full bg-[#00a884] py-2 rounded text-black font-bold">Set Timer</button>
        </div>
    </div>

    <script>
        const socket = io();
        function toggleModal(id) { document.getElementById(id).classList.toggle('hidden'); document.getElementById(id).classList.toggle('flex'); }
        
        socket.on('qr', qr => {
            const q = document.getElementById('qrcode');
            q.innerHTML = ""; new QRCode(q, qr);
            document.getElementById('connOverlay').classList.remove('hidden');
        });

        socket.on('status', data => {
            const dot = document.getElementById('dot');
            if(data.status === 'connected') {
                document.getElementById('connOverlay').classList.add('hidden');
                dot.classList.replace('bg-red-500', 'bg-green-500');
            }
        });

        socket.on('new_message', msg => {
            const box = document.getElementById('msgs');
            const div = document.createElement('div');
            div.className = \`flex w-full \${msg.isFromMe ? 'justify-end' : 'justify-start'}\`;
            div.innerHTML = \`<div class="\${msg.isFromMe ? 'bg-[#005c4b]' : 'bg-[#202c33]'} p-2 rounded-lg max-w-[80%] shadow text-sm">
                <div class="text-[10px] text-gray-400">\${msg.pushName}</div>\${msg.text}</div>\`;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
        });

        function send() { socket.emit('send_direct', { number: document.getElementById('num').value, text: document.getElementById('txt').value }); toggleModal('directModal'); }
        function schedule() { socket.emit('schedule_msg', { number: document.getElementById('sNum').value, text: document.getElementById('sTxt').value, seconds: document.getElementById('sTime').value }); toggleModal('schModal'); }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(HTML_UI));
server.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
