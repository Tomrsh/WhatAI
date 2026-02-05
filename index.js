const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadMediaMessage,
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");
const axios = require("axios");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, push, update, remove, get } = require("firebase/database");

// --- Firebase Configuration ---
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
const app = express();
app.use(express.json());

let sock;
let qrCodeUrl = "";
let connectionStatus = "INITIALIZING";

// Render Anti-Sleep
const RENDER_URL = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}.onrender.com` : null;
if (RENDER_URL) setInterval(() => axios.get(RENDER_URL).catch(() => {}), 5 * 60 * 1000);

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) },
        logger: pino({ level: "silent" }),
        browser: ["WA Supreme Pro", "Chrome", "110.0.0"],
        markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    // Live Presence Tracking
    sock.ev.on('presence.update', ({ id, presences }) => {
        const jid = id.split('@')[0];
        const status = Object.values(presences)[0].lastKnownPresence || "offline";
        update(ref(db, `Chats/${jid}/presence`), { status, lastSeen: Date.now() });
    });

    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeUrl = url; connectionStatus = "SCAN_READY"; });
        if (connection === 'open') { qrCodeUrl = "CONNECTED"; connectionStatus = "CONNECTED"; }
        if (connection === 'close') startWhatsApp();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const jid = msg.key.remoteJid.split('@')[0];
        const dateKey = new Date().toISOString().split('T')[0];
        
        // View Once Bypass Logic
        let msgType = Object.keys(msg.message)[0];
        let content = msg.message[msgType];
        if (msgType === 'viewOnceMessageV2' || msgType === 'viewOnceMessage') {
            msgType = Object.keys(content.message)[0];
            content = content.message[msgType];
        }

        let body = msg.message.conversation || msg.message.extendedTextMessage?.text || "Media File";
        let mediaData = null;

        if (['imageMessage', 'videoMessage'].includes(msgType)) {
            const buffer = await downloadMediaMessage(msg, 'buffer', {});
            mediaData = `data:${msgType === 'imageMessage' ? 'image/jpeg' : 'video/mp4'};base64,${buffer.toString('base64')}`;
            body = msgType === 'imageMessage' ? "📷 Photo" : "🎥 Video";
        }

        push(ref(db, `Chats/${jid}/history/${dateKey}`), {
            body, media: mediaData, fromMe: msg.key.fromMe,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        });

        update(ref(db, `Chats/${jid}`), { name: msg.pushName || jid, lastMsg: body, lastTime: Date.now() });
    });
}

// Timer Logic with Auto-Delete
setInterval(async () => {
    if (connectionStatus !== "CONNECTED") return;
    const snap = await get(ref(db, 'Timers'));
    if (!snap.exists()) return;
    const now = new Date();
    const curT = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');
    const curD = now.toISOString().split('T')[0];

    snap.forEach((child) => {
        const t = child.val();
        if (t.date === curD && t.time === curT) {
            t.targets.forEach(num => sock.sendMessage(num.replace(/\D/g, "") + "@s.whatsapp.net", { text: t.message }));
            // Delete timer once sent
            remove(ref(db, `Timers/${child.key}`));
        }
    });
}, 60000);

startWhatsApp();

// API
app.post('/set-timer', async (req, res) => { await push(ref(db, 'Timers'), req.body); res.json({s:1}); });
app.delete('/del-timer/:id', async (req, res) => { await remove(ref(db, `Timers/${req.params.id}`)); res.json({s:1}); });
app.delete('/del-chat/:jid', async (req, res) => { await remove(ref(db, `Chats/${req.params.jid}`)); res.json({s:1}); });
app.get('/status', (req, res) => res.json({ qr: qrCodeUrl, status: connectionStatus }));

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>WA Supreme Dashboard</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root { --wa-green: #00a884; --wa-bg: #efeae2; --light: #f0f2f5; --danger: #ea0038; }
            body { font-family: 'Segoe UI', sans-serif; margin:0; display:flex; height:100vh; overflow:hidden; background: var(--light); }
            
            #sidebar { width: 350px; background: white; border-right: 1px solid #ddd; display: flex; flex-direction: column; }
            #main { flex: 1; display: flex; flex-direction: column; background: var(--wa-bg) url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); position: relative; }
            
            .header { background: #f0f2f5; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; }
            .chat-list { flex: 1; overflow-y: auto; }
            .chat-item { padding: 15px; border-bottom: 1px solid #f2f2f2; cursor: pointer; display: flex; align-items: center; position: relative; user-select: none; -webkit-tap-highlight-color: transparent; }
            
            .status-dot { width: 10px; height: 10px; border-radius: 50%; margin-right: 12px; }
            .online { background: #25d366; box-shadow: 0 0 5px #25d366; }
            .offline { background: #bbb; }
            
            .msg-container { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }
            .bubble { padding: 8px 12px; margin: 4px 0; border-radius: 8px; max-width: 75%; font-size: 14px; box-shadow: 0 1px 1px rgba(0,0,0,0.1); }
            .sent { align-self: flex-end; background: #dcf8c6; }
            .recv { align-self: flex-start; background: white; }
            
            .dropdown { display: none; position: absolute; right: 10px; top: 50px; background: white; box-shadow: 0 4px 15px rgba(0,0,0,0.15); border-radius: 8px; z-index: 100; overflow:hidden; }
            .dropdown div { padding: 12px 20px; cursor: pointer; border-bottom: 1px solid #eee; }
            
            /* Overlay Manager */
            #overlay-page { display: none; position: fixed; inset: 0; background: white; z-index: 1000; flex-direction: column; }
            
            /* Context Menu Popup */
            #context-menu-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 2000; align-items: center; justify-content: center; }
            .context-box { background: white; border-radius: 12px; width: 280px; overflow: hidden; text-align: center; }
            .context-box button { width: 100%; padding: 15px; border: none; background: none; font-size: 16px; cursor: pointer; border-bottom: 1px solid #eee; }
            .btn-del { color: var(--danger); font-weight: bold; }
            
            @media (max-width: 768px) { #sidebar { width: 100%; } #main { display: none; position: fixed; inset: 0; } }
        </style>
    </head>
    <body>

    <div id="qr-overlay" style="display:none; position:fixed; inset:0; background:white; z-index:9999; flex-direction:column; align-items:center; justify-content:center;">
        <h2>Link WhatsApp</h2>
        <img id="qr-img" style="width:250px;">
    </div>

    <div id="sidebar">
        <div class="header">
            <b>WhatsApp Supreme</b>
            <i class="fa-solid fa-ellipsis-vertical" onclick="toggleDropdown()" style="padding:10px; cursor:pointer;"></i>
            <div class="dropdown" id="main-menu">
                <div onclick="openPage('timer')">Timer Manager</div>
                <div onclick="openPage('analytics')">Analytics</div>
            </div>
        </div>
        <div style="padding:10px;"><input type="text" placeholder="Search chats..." onkeyup="searchChat(this.value)" style="width:100%; padding:10px; border-radius:20px; border:1px solid #ddd; background:#f0f2f5; outline:none; box-sizing:border-box;"></div>
        <div class="chat-list" id="chat-list"></div>
    </div>

    <div id="main">
        <div class="header">
            <i class="fa-solid fa-arrow-left" onclick="closeChat()" style="margin-right:15px; cursor:pointer;"></i>
            <b id="active-name">Select Chat</b>
            <input type="text" placeholder="Search msg..." onkeyup="searchMsg(this.value)" style="width:100px; padding:5px; border-radius:10px; border:1px solid #ddd;">
        </div>
        <div class="msg-container" id="msg-box"></div>
    </div>

    <div id="overlay-page">
        <div class="header" style="background:var(--wa-green); color:white;">
            <i class="fa-solid fa-arrow-left" onclick="closePage()"></i>
            <span id="page-title">Manager</span>
        </div>
        <div id="page-content" style="padding:20px; overflow-y:auto; flex:1; background:#f0f2f5;"></div>
    </div>

    <div id="context-menu-overlay">
        <div class="context-box">
            <div style="padding:20px; font-weight:bold; border-bottom:1px solid #eee;">Chat Settings</div>
            <button class="btn-del" onclick="confirmDelete()">Delete Chat History</button>
            <button onclick="hideContext()">Cancel</button>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>

    <script>
        const config = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(config);
        const rtdb = firebase.database();
        let currentJid = null, selectedJid = null, pressTimer;

        // 1. Sidebar & Real-time Status
        rtdb.ref('Chats').on('value', snap => {
            const list = document.getElementById('chat-list');
            list.innerHTML = "";
            snap.forEach(child => {
                const c = child.val();
                const isOnline = c.presence?.status === 'available' || c.presence?.status === 'composing';
                const div = document.createElement('div');
                div.className = 'chat-item';
                div.innerHTML = \`<div class="status-dot \${isOnline?'online':'offline'}"></div><div style="flex:1"><b>\${c.name}</b><br><small style="color:gray">\${c.lastMsg || ''}</small></div>\`;
                
                div.onclick = () => openChat(child.key, c.name);
                // Long press logic for mobile/web
                div.onmousedown = () => pressTimer = setTimeout(() => showContext(child.key), 800);
                div.onmouseup = () => clearTimeout(pressTimer);
                div.ontouchstart = () => pressTimer = setTimeout(() => showContext(child.key), 800);
                div.ontouchend = () => clearTimeout(pressTimer);
                list.appendChild(div);
            });
        });

        function openChat(jid, name) {
            currentJid = jid;
            document.getElementById('active-name').innerText = name;
            if(window.innerWidth < 768) document.getElementById('main').style.display='flex';
            rtdb.ref('Chats/'+jid+'/history').on('value', snap => {
                const box = document.getElementById('msg-box'); box.innerHTML = "";
                snap.forEach(day => {
                    box.innerHTML += \`<div style="text-align:center; font-size:11px; margin:15px; color:#667781; background:#fff; padding:4px 10px; border-radius:8px; align-self:center; box-shadow:0 1px 1px #ccc;">\${day.key}</div>\`;
                    day.forEach(mVal => {
                        const m = mVal.val();
                        let html = m.media ? \`<img src="\${m.media}" style="max-width:100%; border-radius:8px; margin-bottom:5px;">\` : m.body;
                        box.innerHTML += \`<div class="bubble \${m.fromMe?'sent':'recv'}" data-text="\${m.body.toLowerCase()}">\${html}<div style="font-size:10px; text-align:right; opacity:0.5; margin-top:4px;">\${m.time}</div></div>\`;
                    });
                });
                box.scrollTop = box.scrollHeight;
            });
        }

        // 2. Timer Page Manager
        function openPage(type) {
            const page = document.getElementById('overlay-page');
            const content = document.getElementById('page-content');
            page.style.display = 'flex';
            toggleDropdown();

            if(type === 'timer') {
                document.getElementById('page-title').innerText = 'Timer Manager';
                renderTimerUI();
            } else {
                document.getElementById('page-title').innerText = 'Analytics';
                content.innerHTML = '<div style="background:white; padding:15px; border-radius:10px;"><canvas id="a-chart"></canvas></div>';
                loadAnalytics();
            }
        }

        function renderTimerUI() {
            const content = document.getElementById('page-content');
            content.innerHTML = \`
                <div style="background:white; padding:20px; border-radius:12px; margin-bottom:20px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                    <h4 style="margin-top:0;">+ Schedule New</h4>
                    <button onclick="pickContacts()" style="width:100%; padding:10px; margin-bottom:10px;">Select Contacts</button>
                    <textarea id="t-targets" placeholder="Numbers (comma separated)" style="width:100%; padding:10px; box-sizing:border-box; border-radius:8px; border:1px solid #ddd;"></textarea>
                    <textarea id="t-msg" placeholder="Your Message..." style="width:100%; padding:10px; margin:10px 0; box-sizing:border-box; border-radius:8px; border:1px solid #ddd;"></textarea>
                    <div style="display:flex; gap:10px;">
                        <input type="date" id="t-date" style="flex:1; padding:8px;">
                        <input type="time" id="t-time" style="flex:1; padding:8px;">
                    </div>
                    <button onclick="saveTimer()" style="width:100%; padding:12px; background:var(--wa-green); color:white; border:none; border-radius:8px; margin-top:15px; font-weight:bold;">Set Schedule</button>
                </div>
                <div id="timer-list-box"></div>\`;
            
            // Load Active Timers
            rtdb.ref('Timers').on('value', snap => {
                const box = document.getElementById('timer-list-box');
                box.innerHTML = "<h4>Pending Timers</h4>";
                snap.forEach(child => {
                    const t = child.val();
                    box.innerHTML += \`<div style="background:white; padding:15px; margin-bottom:10px; border-radius:10px; border-left:5px solid var(--wa-green);">
                        <b>To: \${t.targets.join(', ')}</b><br>
                        <p style="margin:5px 0;">\${t.message}</p>
                        <small style="color:gray">\${t.date} | \${t.time}</small>
                        <button onclick="delTimer('\${child.key}')" style="float:right; color:red; border:none; background:none; font-weight:bold;">DELETE</button>
                    </div>\`;
                });
            });
        }

        async function pickContacts() {
            try {
                const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: true });
                document.getElementById('t-targets').value = contacts.map(c => c.tel[0]).join(', ');
            } catch(e) { alert("Use Chrome/Android for Contact Picker"); }
        }

        async function saveTimer() {
            const data = { 
                message: document.getElementById('t-msg').value, 
                date: document.getElementById('t-date').value, 
                time: document.getElementById('t-time').value, 
                targets: document.getElementById('t-targets').value.split(',').map(s => s.trim()) 
            };
            if(!data.message || !data.date || !data.time) return alert("Fill all fields");
            await fetch('/set-timer', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) });
            alert("Message Scheduled!");
        }

        // Helper Functions
        function toggleDropdown() { const m = document.getElementById('main-menu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; }
        function closePage() { document.getElementById('overlay-page').style.display = 'none'; }
        function closeChat() { document.getElementById('main').style.display = 'none'; }
        function showContext(jid) { selectedJid = jid; document.getElementById('context-menu-overlay').style.display='flex'; }
        function hideContext() { document.getElementById('context-menu-overlay').style.display='none'; }
        async function confirmDelete() { await fetch('/del-chat/'+selectedJid, {method:'DELETE'}); hideContext(); }
        async function delTimer(id) { await fetch('/del-timer/'+id, {method:'DELETE'}); }
        function searchChat(v) { document.querySelectorAll('.chat-item').forEach(c => c.style.display = c.innerText.toLowerCase().includes(v.toLowerCase()) ? 'flex' : 'none'); }
        function searchMsg(v) { document.querySelectorAll('.bubble').forEach(b => b.style.border = (v && b.dataset.text.includes(v.toLowerCase())) ? '2px solid orange' : 'none'); }

        // QR Status Monitor
        setInterval(async () => {
            const res = await fetch('/status');
            const data = await res.json();
            if(data.status === "CONNECTED") document.getElementById('qr-overlay').style.display='none';
            else if(data.qr) { document.getElementById('qr-overlay').style.display='flex'; document.getElementById('qr-img').src = data.qr; }
        }, 3000);
    </script>
    </body>
    </html>
    `);
});

app.listen(process.env.PORT || 3000);
