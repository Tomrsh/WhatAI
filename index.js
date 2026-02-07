const { 
    default: makeWASocket, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    delay,
    makeCacheableSignalKeyStore,
    jidDecode
} = require('@whiskeysockets/baileys');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, set, remove, push, onValue, update } = require('firebase/database');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const pino = require('pino');

// --- FIREBASE CONFIG (Yahan apni Details Dalein) ---
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
const SESSION_PATH = 'wa_session_v3';
const CHAT_PATH = 'wa_backups';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- FIREBASE AUTH STORAGE LOGIC ---
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
                            val ? await set(itemRef, val) : await remove(itemRef);
                        }
                    }
                }
            }, pino({ level: 'silent' }))
        },
        saveCreds: async () => await set(sessionRef, creds)
    };
}

let sock;
async function startWhatsApp() {
    const { state, saveCreds } = await useFirebaseAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true,
        browser: ["WA-Master-Ultra", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) io.emit('qr', await qrcode.toDataURL(qr));
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startWhatsApp();
            else { await remove(ref(db, SESSION_PATH)); console.log("Logged Out!"); }
        } else if (connection === 'open') {
            io.emit('ready', true);
            console.log('✅ Connected & Synced');
        }
    });

    // --- MESSAGE BACKUP LOGIC (Lifetime) ---
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const remoteJid = msg.key.remoteJid;
        const senderName = msg.pushName || 'Unknown';
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || 'Media Message';
        const timestamp = new Date().toLocaleString();

        // Save to Firebase Backup
        const chatRef = ref(db, `${CHAT_PATH}/${remoteJid.replace(/[^a-zA-Z0-9]/g, '')}`);
        push(chatRef, {
            sender: senderName,
            jid: remoteJid,
            text: messageText,
            time: timestamp,
            fromMe: msg.key.fromMe
        });
        
        io.emit('new_msg', { senderName, messageText, remoteJid });
    });
}

// --- API TO DELETE CHATS ---
app.post('/delete-chat', async (req, res) => {
    const { chatId } = req.body;
    await remove(ref(db, `${CHAT_PATH}/${chatId}`));
    res.json({ success: true });
});

// --- UI (WHATSAPP PREMIUM INTERFACE) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="hi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WA-Master Pro | Cloud Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="/socket.io/socket.io.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        body { background: #0b141a; color: #e9edef; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        .chat-card { background: #111b21; border-bottom: 1px solid #222d34; transition: 0.3s; }
        .chat-card:hover { background: #202c33; cursor: pointer; }
        .active-chat { background: #2a3942; }
        .msg-in { background: #202c33; border-radius: 0 10px 10px 10px; }
        .msg-out { background: #005c4b; border-radius: 10px 0 10px 10px; }
    </style>
</head>
<body class="flex h-screen overflow-hidden">

    <div class="w-full md:w-1/3 border-r border-[#222d34] flex flex-col">
        <div class="p-4 bg-[#202c33] flex justify-between items-center">
            <h1 class="text-xl font-bold text-emerald-500">WA-Master</h1>
            <div id="status" class="w-3 h-3 rounded-full bg-red-500"></div>
        </div>
        
        <div class="p-2">
            <input type="text" id="search" onkeyup="searchChat()" placeholder="Search chat..." class="w-full bg-[#202c33] p-2 rounded-lg text-sm outline-none">
        </div>

        <div id="chat-list" class="flex-1 overflow-y-auto">
            <p class="p-10 text-center text-gray-500">Connecting to Cloud...</p>
        </div>
    </div>

    <div class="hidden md:flex flex-1 flex-col bg-[#0b141a]">
        <div id="chat-header" class="p-4 bg-[#202c33] flex items-center hidden">
            <div class="w-10 h-10 bg-emerald-600 rounded-full flex items-center justify-center font-bold mr-3" id="header-icon">?</div>
            <div>
                <h2 id="current-chat-name" class="font-bold">Select a chat</h2>
                <p class="text-xs text-emerald-500">Online Backup Active</p>
            </div>
            <button onclick="deleteCurrentChat()" class="ml-auto text-red-500 text-sm"><i class="fas fa-trash"></i> Clear Backup</button>
        </div>

        <div id="msg-container" class="flex-1 p-6 overflow-y-auto space-y-4">
            <div class="h-full flex items-center justify-center text-gray-600">
                <p>Firebase Backup Engine v3.0 | Secure & Lifetime</p>
            </div>
        </div>
    </div>

    <div id="qr-overlay" class="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center hidden">
        <div class="bg-white p-4 rounded-xl mb-4" id="qr-box">Initializing...</div>
        <p class="text-white">Scan QR to connect Cloud Session</p>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.1.3/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.1.3/firebase-database-compat.js"></script>

    <script>
        const socket = io();
        // Initialize Firebase Client Side for Real-time Updates
        const config = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(config);
        const fbDb = firebase.database();

        socket.on('qr', url => {
            document.getElementById('qr-overlay').classList.remove('hidden');
            document.getElementById('qr-box').innerHTML = \`<img src="\${url}">\`;
        });

        socket.on('ready', () => {
            document.getElementById('qr-overlay').classList.add('hidden');
            document.getElementById('status').classList.replace('bg-red-500', 'bg-emerald-500');
            loadChatList();
        });

        let currentChatId = null;

        function loadChatList() {
            fbDb.ref('wa_backups').on('value', snapshot => {
                const list = document.getElementById('chat-list');
                list.innerHTML = '';
                snapshot.forEach(child => {
                    const data = Object.values(child.val());
                    const lastMsg = data[data.length - 1];
                    const chatId = child.key;
                    
                    const div = document.createElement('div');
                    div.className = 'chat-card p-4 flex items-center';
                    div.onclick = () => openChat(chatId, lastMsg.sender);
                    div.innerHTML = \`
                        <div class="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center mr-3">\${lastMsg.sender[0]}</div>
                        <div class="flex-1">
                            <div class="flex justify-between"><b class="text-sm">\${lastMsg.sender}</b><span class="text-[10px] text-gray-500">\${lastMsg.time.split(',')[1]}</span></div>
                            <p class="text-xs text-gray-400 truncate">\${lastMsg.text}</p>
                        </div>
                    \`;
                    list.appendChild(div);
                });
            });
        }

        function openChat(chatId, name) {
            currentChatId = chatId;
            document.getElementById('chat-header').classList.remove('hidden');
            document.getElementById('current-chat-name').innerText = name;
            document.getElementById('header-icon').innerText = name[0];
            
            fbDb.ref('wa_backups/' + chatId).on('value', snapshot => {
                const container = document.getElementById('msg-container');
                container.innerHTML = '';
                snapshot.forEach(child => {
                    const m = child.val();
                    const align = m.fromMe ? 'justify-end' : 'justify-start';
                    const color = m.fromMe ? 'msg-out' : 'msg-in';
                    container.innerHTML += \`
                        <div class="flex \${align}">
                            <div class="\${color} p-3 max-w-[80%] shadow-md">
                                <p class="text-sm">\${m.text}</p>
                                <p class="text-[9px] text-right opacity-50 mt-1">\${m.time}</p>
                            </div>
                        </div>
                    \`;
                });
                container.scrollTop = container.scrollHeight;
            });
        }

        function searchChat() {
            let input = document.getElementById('search').value.toLowerCase();
            let cards = document.getElementsByClassName('chat-card');
            for (let card of cards) {
                card.style.display = card.innerText.toLowerCase().includes(input) ? "flex" : "none";
            }
        }

        async function deleteCurrentChat() {
            if(!currentChatId) return;
            if(confirm('Kya aap is chat ka lifetime backup delete karna chahte hain?')) {
                await fetch('/delete-chat', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ chatId: currentChatId })
                });
                document.getElementById('msg-container').innerHTML = '';
            }
        }
    </script>
</body>
</html>
    `);
});

startWhatsApp();
server.listen(PORT, () => console.log(`Master Pro Running on ${PORT}`));
