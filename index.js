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
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, push, update, remove, get } = require("firebase/database");

// --- 1. Firebase Config ---
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
let connectionStatus = "DISCONNECTED";

// --- 2. WhatsApp Connection Logic (Stabilized) ---
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');
    
    sock = makeWASocket({
        auth: { 
            creds: state.creds, 
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })) 
        },
        logger: pino({ level: "error" }), // Terminal clutter kam karne ke liye
        browser: ["WA-Supreme-v3", "Chrome", "1.0.0"],
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, qr, lastDisconnect } = u;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeUrl = url; connectionStatus = "SCAN_READY"; });
        }
        
        if (connection === 'open') {
            qrCodeUrl = "CONNECTED";
            connectionStatus = "CONNECTED";
            console.log("✅ Connection Established!");
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log("❌ Connection Closed. Reason:", code);
            // Sirf tab reconnect karega jab logout na kiya ho
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(() => startWhatsApp(), 5000);
            }
        }
    });

    // Message & View Once Bypass
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const jid = msg.key.remoteJid.split('@')[0];
        const dateKey = new Date().toISOString().split('T')[0];
        
        let msgType = Object.keys(msg.message)[0];
        let content = msg.message[msgType];
        
        // Bypass View Once
        if (msgType === 'viewOnceMessageV2' || msgType === 'viewOnceMessage') {
            msgType = Object.keys(content.message)[0];
            content = content.message[msgType];
        }

        let body = msg.message.conversation || msg.message.extendedTextMessage?.text || "Media File";
        let mediaData = null;

        if (['imageMessage', 'videoMessage'].includes(msgType)) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                mediaData = `data:${msgType === 'imageMessage' ? 'image/jpeg' : 'video/mp4'};base64,${buffer.toString('base64')}`;
            } catch (e) { console.error("Media Error"); }
        }

        // Save to Firebase
        const timestamp = Date.now();
        push(ref(db, `Chats/${jid}/history/${dateKey}`), {
            body, media: mediaData, fromMe: msg.key.fromMe,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            timestamp
        });

        update(ref(db, `Chats/${jid}`), { 
            name: msg.pushName || jid, 
            lastMsg: body, 
            lastTime: timestamp 
        });
    });
}

// Timer Engine (AM/PM Fixed)
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
            t.targets.forEach(num => {
                sock.sendMessage(num.replace(/\D/g, "") + "@s.whatsapp.net", { text: t.message });
            });
            remove(ref(db, `Timers/${child.key}`));
        }
    });
}, 30000);

startWhatsApp();

// --- 3. Dashboard Web UI ---
app.get('/status', (req, res) => res.json({ qr: qrCodeUrl, status: connectionStatus }));
app.post('/set-timer', async (req, res) => { await push(ref(db, 'Timers'), req.body); res.json({s:1}); });
app.delete('/del-chat/:jid', async (req, res) => { await remove(ref(db, `Chats/${req.params.jid}`)); res.json({s:1}); });

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WA Pro Supreme</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root { --green: #00a884; --bg: #efeae2; --white: #ffffff; }
            body { font-family: sans-serif; margin:0; display:flex; height:100vh; background:#f0f2f5; }
            #sidebar { width: 350px; background: var(--white); border-right: 1px solid #ddd; display: flex; flex-direction: column; }
            #main { flex: 1; display: flex; flex-direction: column; background: var(--bg); position: relative; }
            .header { background: #f0f2f5; padding: 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; }
            .chat-list { flex:1; overflow-y:auto; }
            .chat-item { padding:15px; border-bottom:1px solid #eee; cursor:pointer; }
            .msg-box { flex:1; padding:20px; overflow-y:auto; display:flex; flex-direction:column; }
            .bubble { padding:8px 12px; margin:4px 0; border-radius:8px; max-width:70%; font-size:14px; }
            .sent { align-self:flex-end; background:#dcf8c6; }
            .recv { align-self:flex-start; background:white; }
            
            /* Overlays */
            #page-overlay { display:none; position:fixed; inset:0; background:white; z-index:1000; flex-direction:column; }
            #context-menu { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:2000; align-items:center; justify-content:center; }
            .popup { background:white; border-radius:15px; width:280px; text-align:center; overflow:hidden; }
            .popup button { width:100%; padding:15px; border:none; border-bottom:1px solid #eee; background:none; font-size:16px; cursor:pointer; }
            
            @media (max-width: 768px) { #sidebar { width:100%; } #main { display:none; position:fixed; inset:0; } }
        </style>
    </head>
    <body>

    <div id="qr-screen" style="display:none; position:fixed; inset:0; background:white; z-index:9999; flex-direction:column; align-items:center; justify-content:center; text-align:center;">
        <h2>WhatsApp Link Karein</h2>
        <img id="qr-img" style="width:250px; margin:20px;">
        <p>Settings > Linked Devices par scan karein.</p>
    </div>

    <div id="sidebar">
        <div class="header">
            <b>WA Supreme</b>
            <i class="fa-solid fa-ellipsis-vertical" onclick="toggleMenu()" style="cursor:pointer"></i>
            <div id="menu" style="display:none; position:absolute; right:10px; top:50px; background:white; box-shadow:0 2px 10px rgba(0,0,0,0.1); border-radius:8px; z-index:100;">
                <div onclick="openPage('timer')" style="padding:15px; cursor:pointer;">Timer Manager</div>
            </div>
        </div>
        <div style="padding:10px;"><input type="text" placeholder="Search..." onkeyup="searchChat(this.value)" style="width:100%; padding:10px; border-radius:20px; border:1px solid #ddd; outline:none;"></div>
        <div class="chat-list" id="chat-list"></div>
    </div>

    <div id="main">
        <div class="header">
            <i class="fa-solid fa-arrow-left" onclick="closeChat()" style="margin-right:15px; cursor:pointer"></i>
            <b id="active-name">Select Chat</b>
            <input type="text" placeholder="Search msg" onkeyup="searchMsg(this.value)" style="width:80px; padding:5px; border-radius:10px; border:1px solid #ddd;">
        </div>
        <div class="msg-box" id="msg-box"></div>
    </div>

    <div id="page-overlay">
        <div class="header" style="background:var(--green); color:white;">
            <i class="fa-solid fa-arrow-left" onclick="this.parentElement.parentElement.style.display='none'"></i>
            <span>Timer Manager</span>
        </div>
        <div style="padding:20px; flex:1; overflow-y:auto; background:#f0f2f5;">
            <div style="background:white; padding:15px; border-radius:12px; margin-bottom:20px;">
                <h4>Naya Schedule</h4>
                <button onclick="pickContacts()" style="width:100%; padding:10px; margin-bottom:10px;">Contacts Select Karein</button>
                <textarea id="t-nums" placeholder="Numbers..." style="width:100%; padding:10px; margin-bottom:10px; box-sizing:border-box;"></textarea>
                <textarea id="t-msg" placeholder="Message..." style="width:100%; padding:10px; margin-bottom:10px; box-sizing:border-box;"></textarea>
                <div style="display:flex; gap:10px;">
                    <input type="date" id="t-date" style="flex:1; padding:8px;">
                    <input type="time" id="t-time" style="flex:1; padding:8px;">
                </div>
                <button onclick="saveTimer()" style="width:100%; margin-top:15px; background:var(--green); color:white; border:none; padding:12px; border-radius:8px; font-weight:bold;">Schedule Karein</button>
            </div>
            <div id="timer-list"></div>
        </div>
    </div>

    <div id="context-menu">
        <div class="popup">
            <div style="padding:20px; font-weight:bold;">Chat History?</div>
            <button onclick="confirmDel()" style="color:red; font-weight:bold;">Delete Chat</button>
            <button onclick="document.getElementById('context-menu').style.display='none'">Cancel</button>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>

    <script>
        const fbase = firebase.initializeApp(${JSON.stringify(firebaseConfig)});
        const rtdb = firebase.database();
        let curJid = null, selJid = null, pressTimer;

        // 1. Sidebar Real-time Sync
        rtdb.ref('Chats').on('value', snap => {
            const list = document.getElementById('chat-list');
            list.innerHTML = "";
            snap.forEach(child => {
                const c = child.val();
                const d = document.createElement('div');
                d.className = 'chat-item';
                d.innerHTML = \`<b>\${c.name}</b><br><small style="color:gray">\${c.lastMsg || ''}</small>\`;
                d.onclick = () => openChat(child.key, c.name);
                d.onmousedown = () => pressTimer = setTimeout(() => { selJid=child.key; document.getElementById('context-menu').style.display='flex'; }, 800);
                d.onmouseup = () => clearTimeout(pressTimer);
                d.ontouchstart = () => pressTimer = setTimeout(() => { selJid=child.key; document.getElementById('context-menu').style.display='flex'; }, 800);
                d.ontouchend = () => clearTimeout(pressTimer);
                list.appendChild(d);
            });
        });

        function openChat(jid, name) {
            curJid = jid;
            document.getElementById('active-name').innerText = name;
            if(window.innerWidth < 768) document.getElementById('main').style.display = 'flex';
            rtdb.ref('Chats/'+jid+'/history').on('value', snap => {
                const box = document.getElementById('msg-box'); box.innerHTML = "";
                snap.forEach(day => {
                    box.innerHTML += \`<div style="text-align:center; font-size:11px; margin:10px; color:gray;">\${day.key}</div>\`;
                    day.forEach(m => {
                        const v = m.val();
                        let h = v.media ? \`<img src="\${v.media}" style="max-width:100%; border-radius:8px;">\` : v.body;
                        box.innerHTML += \`<div class="bubble \${v.fromMe?'sent':'recv'}" data-text="\${v.body.toLowerCase()}">\${h}<div style="font-size:9px; text-align:right; opacity:0.5;">\${v.time}</div></div>\`;
                    });
                });
                box.scrollTop = box.scrollHeight;
            });
        }

        // 2. Timer Manager
        function openPage() {
            document.getElementById('page-overlay').style.display = 'flex';
            document.getElementById('menu').style.display = 'none';
            rtdb.ref('Timers').on('value', snap => {
                const l = document.getElementById('timer-list');
                l.innerHTML = "<h4>Active Timers</h4>";
                snap.forEach(child => {
                    const t = child.val();
                    l.innerHTML += \`<div style="background:white; padding:12px; border-radius:10px; margin-bottom:10px; border-left:4px solid var(--green);">
                        <b>To: \${t.targets.join(', ')}</b><br><p>\${t.message}</p>
                        <small>\${t.date} | \${t.time}</small>
                        <button onclick="delTimer('\${child.key}')" style="float:right; color:red; border:none; background:none; font-weight:bold;">DELETE</button>
                    </div>\`;
                });
            });
        }

        async function pickContacts() {
            try {
                const cs = await navigator.contacts.select(['tel'], {multiple:true});
                document.getElementById('t-nums').value = cs.map(c => c.tel[0]).join(', ');
            } catch(e) { alert("Chrome Mobile use karein contact picker ke liye."); }
        }

        async function saveTimer() {
            const d = { 
                targets: document.getElementById('t-nums').value.split(','),
                message: document.getElementById('t-msg').value,
                date: document.getElementById('t-date').value,
                time: document.getElementById('t-time').value
            };
            await fetch('/set-timer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(d) });
            alert("Scheduled!");
        }

        // UI Helpers
        function confirmDel() { fetch('/del-chat/'+selJid, {method:'DELETE'}); document.getElementById('context-menu').style.display='none'; }
        function delTimer(id) { rtdb.ref('Timers/'+id).remove(); }
        function toggleMenu() { const m = document.getElementById('menu'); m.style.display = m.style.display==='block'?'none':'block'; }
        function closeChat() { document.getElementById('main').style.display='none'; }
        function searchChat(v) { document.querySelectorAll('.chat-item').forEach(c => c.style.display = c.innerText.toLowerCase().includes(v.toLowerCase())?'block':'none'); }
        function searchMsg(v) { document.querySelectorAll('.bubble').forEach(b => b.style.border = (v && b.dataset.text.includes(v.toLowerCase()))?'2px solid orange':'none'); }

        // Connection Check
        setInterval(async () => {
            const r = await fetch('/status');
            const d = await r.json();
            if(d.status === "CONNECTED") document.getElementById('qr-screen').style.display='none';
            else if(d.qr) { document.getElementById('qr-screen').style.display='flex'; document.getElementById('qr-img').src = d.qr; }
        }, 3000);
    </script>
    </body>
    </html>
    `);
});

app.listen(process.env.PORT || 3000, () => console.log("Server Live on Port 3000"));
