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
const fs = require("fs-extra");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, push, update, remove } = require("firebase/database");

// --- CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyAb7V8Xxg5rUYi8UKChEd3rR5dglJ6bLhU",
  authDomain: "t2-storage-4e5ca.firebaseapp.com",
  databaseURL: "https://t2-storage-4e5ca-default-rtdb>
  projectId: "t2-storage-4e5ca",
  storageBucket: "t2-storage-4e5ca.firebasestorage.ap>
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


// --- WHATSAPP CONNECTION ---
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        printQRInTerminal: true,
        logger: pino({ level: "silent" }),
        browser: ["WA Saver Pro", "Chrome", "110.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeUrl = url; 
                connectionStatus = "SCAN_READY";
            });
        }
        if (connection === 'open') {
            qrCodeUrl = "CONNECTED";
            connectionStatus = "CONNECTED";
            console.log("✅ WhatsApp Connected!");
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            connectionStatus = "RECONNECTING";
            if (shouldReconnect) startWhatsApp();
            else {
                fs.removeSync('./auth_session');
                startWhatsApp();
            }
        }
    });

    // --- MESSAGE HANDLING (View Once & Media Fix) ---
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const jid = msg.key.remoteJid.split('@')[0];
        const isMe = msg.key.fromMe;
        const senderName = msg.pushName || (isMe ? "Me" : jid);
        
        let msgType = Object.keys(msg.message)[0];
        let messageContent = msg.message[msgType];

        // View Once Detection & Bypass
        if (msgType === 'viewOnceMessageV2' || msgType === 'viewOnceMessage') {
            msgType = Object.keys(messageContent.message)[0];
            messageContent = messageContent.message[msgType];
        }

        let bodyText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        let mediaData = null;
        let mType = "text";

        if (['imageMessage', 'videoMessage'].includes(msgType)) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                mediaData = `data:${msgType === 'imageMessage' ? 'image/jpeg' : 'video/mp4'};base64,${buffer.toString('base64')}`;
                mType = msgType === 'imageMessage' ? 'image' : 'video';
                bodyText = mType === 'image' ? "📷 Photo (View Once Saved)" : "🎥 Video (View Once Saved)";
            } catch (e) { console.log("Media Save Error:", e); }
        }

        // Save to Firebase Realtime Database
        const chatRef = ref(db, `Chats/${jid}/messages`);
        push(chatRef, {
            body: bodyText,
            media: mediaData,
            type: mType,
            fromMe: isMe,
            timestamp: Date.now()
        });

        update(ref(db, `Chats/${jid}`), {
            name: senderName,
            lastMsg: bodyText,
            lastTime: Date.now()
        });
    });
}

startWhatsApp();

// --- UI DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <title>WhatsApp Saver Pro Premium</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root { --wa-green: #00a884; --wa-bg: #efeae2; --light: #f0f2f5; }
            body { font-family: 'Segoe UI', sans-serif; margin:0; display:flex; height:100vh; background: var(--light); }
            
            /* Sidebar */
            #sidebar { width: 350px; background: white; border-right: 1px solid #d1d7db; display: flex; flex-direction: column; }
            .header { background: #f0f2f5; padding: 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ddd; }
            .search-box { padding: 10px; background: #fff; }
            .search-box input { width: 100%; padding: 8px; border-radius: 8px; border: 1px solid #ddd; outline: none; background: #f0f2f5; }
            #chat-list { flex: 1; overflow-y: auto; }
            .chat-item { padding: 12px; border-bottom: 1px solid #f2f2f2; cursor: pointer; display: flex; align-items: center; }
            .chat-item:hover { background: #f5f6f6; }
            .avatar { width: 45px; height: 45px; border-radius: 50%; background: #ccc; margin-right: 12px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; }

            /* Main Chat Area */
            #main { flex: 1; display: flex; flex-direction: column; background: var(--wa-bg) url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); }
            .chat-header { background: #f0f2f5; padding: 10px 20px; display: flex; align-items: center; border-bottom: 1px solid #ddd; }
            #messages { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }
            
            /* Bubbles */
            .msg { padding: 8px 12px; margin-bottom: 5px; border-radius: 8px; max-width: 65%; font-size: 14px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.1); display: flex; align-items: center; }
            .sent { align-self: flex-end; background: #dcf8c6; }
            .recv { align-self: flex-start; background: white; }
            .msg input[type="checkbox"] { margin-right: 10px; cursor: pointer; }
            .msg img, .msg video { max-width: 100%; border-radius: 5px; margin-top: 5px; }

            /* Actions */
            .footer-actions { background: #f0f2f5; padding: 15px; border-top: 1px solid #ddd; display: none; justify-content: space-between; align-items: center; }
            .btn { border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; }
            .btn-del { background: #ea0038; color: white; }
            
            /* QR Screen */
            #qr-overlay { position: fixed; inset: 0; background: white; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; }
        </style>
    </head>
    <body>

    <div id="qr-overlay">
        <h2 id="qr-status">Initializing System...</h2>
        <img id="qr-img" style="display:none; width: 280px; border: 1px solid #ddd; padding: 10px;">
        <p style="margin-top:20px; color:gray;">WhatsApp Settings > Linked Devices > Link a Device</p>
    </div>

    <div id="sidebar">
        <div class="header">
            <b>WA Saver Pro</b>
            <i class="fa-solid fa-ellipsis-vertical"></i>
        </div>
        <div class="search-box">
            <input type="text" id="side-search" placeholder="Search contacts..." onkeyup="filterChats()">
        </div>
        <div id="chat-list"></div>
    </div>

    <div id="main">
        <div class="chat-header">
            <b id="active-name">Select a contact</b>
            <div style="margin-left: auto; display: flex; gap: 15px;">
                <input type="text" id="msg-search" placeholder="Search in chat..." onkeyup="searchMsgs()" style="padding:5px; border-radius:5px; border:1px solid #ddd;">
                <button onclick="deleteFullChat()" style="color:red; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>
        
        <div id="messages"></div>

        <div class="footer-actions" id="action-bar">
            <span id="sel-count">0 selected</span>
            <div>
                <button class="btn" onclick="cancelSelection()">Cancel</button>
                <button class="btn btn-del" onclick="deleteSelected()">Delete Selected</button>
            </div>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>

    <script>
        const config = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(config);
        const rtdb = firebase.database();
        let currentJid = null;
        let selectedKeys = [];

        // --- Load Chat List ---
        rtdb.ref('Chats').on('value', snap => {
            const list = document.getElementById('chat-list');
            list.innerHTML = "";
            snap.forEach(child => {
                const c = child.val();
                list.innerHTML += \`
                <div class="chat-item" data-name="\${c.name.toLowerCase()}" onclick="openChat('\${child.key}', '\${c.name}')">
                    <div class="avatar">\${c.name[0]}</div>
                    <div style="flex:1">
                        <b>\${c.name}</b><br>
                        <small style="color:gray">\${c.lastMsg || ''}</small>
                    </div>
                </div>\`;
            });
        });

        // --- Load Messages ---
        function openChat(jid, name) {
            currentJid = jid;
            selectedKeys = [];
            updateBar();
            document.getElementById('active-name').innerText = name;
            
            rtdb.ref('Chats/'+jid+'/messages').on('value', snap => {
                const box = document.getElementById('messages');
                box.innerHTML = "";
                snap.forEach(child => {
                    const m = child.val();
                    const div = document.createElement('div');
                    div.className = 'msg ' + (m.fromMe ? 'sent' : 'recv');
                    div.setAttribute('data-body', m.body.toLowerCase());
                    
                    let content = m.type === 'image' ? '<img src="'+m.media+'">' : 
                                  m.type === 'video' ? '<video controls src="'+m.media+'"></video>' : 
                                  '<span>'+m.body+'</span>';
                    
                    div.innerHTML = \`<input type="checkbox" onclick="toggleSelect(event, '\${child.key}')"> \${content}\`;
                    box.appendChild(div);
                });
                box.scrollTop = box.scrollHeight;
            });
        }

        // --- Features ---
        function toggleSelect(e, key) {
            if(e.target.checked) selectedKeys.push(key);
            else selectedKeys = selectedKeys.filter(k => k !== key);
            updateBar();
        }

        function updateBar() {
            const bar = document.getElementById('action-bar');
            bar.style.display = selectedKeys.length ? 'flex' : 'none';
            document.getElementById('sel-count').innerText = selectedKeys.length + " selected";
        }

        async function deleteSelected() {
            if(!confirm('Delete selected messages?')) return;
            for(let k of selectedKeys) await rtdb.ref('Chats/'+currentJid+'/messages/'+k).remove();
            selectedKeys = []; updateBar();
        }

        function deleteFullChat() {
            if(confirm('Pura chat delete karein?')) rtdb.ref('Chats/'+currentJid).remove();
        }

        function filterChats() {
            let q = document.getElementById('side-search').value.toLowerCase();
            document.querySelectorAll('.chat-item').forEach(i => {
                i.style.display = i.getAttribute('data-name').includes(q) ? 'flex' : 'none';
            });
        }

        function searchMsgs() {
            let q = document.getElementById('msg-search').value.toLowerCase();
            document.querySelectorAll('.msg').forEach(m => {
                m.style.border = (q && m.getAttribute('data-body').includes(q)) ? "2px solid #00a884" : "none";
            });
        }

        function cancelSelection() {
            selectedKeys = []; 
            document.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = false);
            updateBar();
        }

        // --- Connection Status ---
        setInterval(async () => {
            const res = await fetch('/status');
            const data = await res.json();
            if(data.status === "CONNECTED") document.getElementById('qr-overlay').style.display = 'none';
            else if(data.qr) {
                document.getElementById('qr-img').src = data.qr;
                document.getElementById('qr-img').style.display = 'block';
                document.getElementById('qr-status').innerText = "Scan QR to Backup";
            }
        }, 3000);
    </script>
    </body>
    </html>
    `);
});

app.get('/status', (req, res) => res.json({ qr: qrCodeUrl, status: connectionStatus }));
app.listen(3000, () => console.log("✅ Server: http://localhost:3000"));
