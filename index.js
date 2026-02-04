const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = require("@whiskeysockets/baileys");
const express = require("express");
const qrcode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, push, update, onValue, remove, get } = require("firebase/database");

// Folder for session
if (!fs.existsSync('./auth_session')) fs.mkdirSync('./auth_session');

const app = express();
app.use(express.json());

// --- Firebase Config ---
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

let sock;
let qrCodeUrl = "";
let connectionStatus = "INITIALIZING";

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_session');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["WA Chat Saver", "MacOS", "3.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeUrl = url; connectionStatus = "SCAN_READY"; });
        if (connection === 'open') { qrCodeUrl = "CONNECTED"; connectionStatus = "CONNECTED"; }
        if (connection === 'close') startWhatsApp();
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const isMe = msg.key.fromMe;
        const jid = msg.key.remoteJid.split('@')[0];
        const senderName = msg.pushName || (isMe ? "Me" : jid);
        
        let content = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        let mediaData = null;
        let mType = "text";

        // --- View Once & Media Fix ---
        let msgType = Object.keys(msg.message)[0];
        let messageContent = msg.message[msgType];

        // Handle View Once
        if (msgType === 'viewOnceMessageV2' || msgType === 'viewOnceMessage') {
            msgType = Object.keys(messageContent.message)[0];
            messageContent = messageContent.message[msgType];
        }

        if (['imageMessage', 'videoMessage'].includes(msgType)) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                mediaData = `data:${msgType === 'imageMessage' ? 'image/jpeg' : 'video/mp4'};base64,${buffer.toString('base64')}`;
                mType = msgType === 'imageMessage' ? 'image' : 'video';
                content = mType === 'image' ? "📷 Photo" : "🎥 Video";
            } catch (e) { console.log("Media Save Error:", e); }
        }

        const chatRef = ref(db, `Chats/${jid}/messages`);
        push(chatRef, {
            body: content,
            media: mediaData,
            type: mType,
            fromMe: isMe,
            timestamp: Date.now()
        });

        update(ref(db, `Chats/${jid}`), {
            name: senderName,
            lastMsg: content,
            lastTime: Date.now()
        });
    });
}

startWhatsApp();

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="hi">
    <head>
        <meta charset="UTF-8">
        <title>WhatsApp Saver Premium v3</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            :root { --wa-green: #00a884; --wa-light-green: #dcf8c6; --gray: #54656f; }
            body { font-family: 'Segoe UI', Tahoma, sans-serif; margin:0; display:flex; height:100vh; background:#f0f2f5; }
            
            #sidebar { width: 380px; background: white; border-right: 1px solid #d1d7db; display: flex; flex-direction: column; }
            .side-head { background: #f0f2f5; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; }
            .search-bar { padding: 8px 15px; }
            .search-bar input { width: 100%; padding: 8px; border-radius: 8px; border: none; background: #f0f2f5; outline: none; box-sizing: border-box; }
            
            #chat-list { flex: 1; overflow-y: auto; }
            .chat-item { display: flex; padding: 12px; border-bottom: 1px solid #f0f2f5; cursor: pointer; align-items: center; transition: 0.2s; }
            .chat-item:hover { background: #f5f6f6; }
            .avatar { width: 45px; height: 45px; border-radius: 50%; background: #dfe5e7; margin-right: 12px; display:flex; align-items:center; justify-content:center; color:white; }
            
            #main { flex: 1; display: flex; flex-direction: column; background: #efeae2 url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png'); }
            .main-head { background: #f0f2f5; padding: 10px 16px; display: flex; align-items: center; border-bottom: 1px solid #d1d7db; z-index: 10; }
            
            #messages { flex: 1; padding: 20px 40px; overflow-y: auto; display: flex; flex-direction: column; }
            .msg { padding: 6px 10px; margin-bottom: 4px; border-radius: 8px; max-width: 65%; font-size: 14.5px; box-shadow: 0 1px 0.5px rgba(0,0,0,0.1); position: relative; display: flex; align-items: flex-start; }
            .msg.sent { align-self: flex-end; background: var(--wa-light-green); }
            .msg.recv { align-self: flex-start; background: white; }
            .msg input[type="checkbox"] { margin-right: 8px; margin-top: 4px; }
            .msg img, .msg video { max-width: 100%; border-radius: 6px; margin-top: 5px; display: block; }
            
            .action-bar { background: #f0f2f5; padding: 12px; border-top: 1px solid #ddd; display: none; justify-content: space-around; align-items: center; }
            .btn { border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; }
            .btn-danger { background: #ea0038; color: white; }
            
            #qr-screen { position: fixed; inset: 0; background: white; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; }
            .highlight { background: yellow; }
        </style>
    </head>
    <body>

    <div id="qr-screen">
        <h2 id="qr-status">System Initializing...</h2>
        <img id="qr-img" style="display:none; width: 280px; border: 1px solid #ccc; padding: 10px; border-radius: 10px;">
        <p style="color: gray; margin-top: 20px;">Open WhatsApp > Linked Devices > Link a Device</p>
    </div>

    <div id="sidebar">
        <div class="side-head">
            <i class="fa-solid fa-circle-user fa-2x" style="color: #54656f"></i>
            <span style="font-weight: bold;">WA Saver Pro</span>
        </div>
        <div class="search-bar">
            <input type="text" id="contact-search" placeholder="Search contacts..." onkeyup="filterContacts()">
        </div>
        <div id="chat-list"></div>
    </div>

    <div id="main">
        <div class="main-head">
            <div id="active-info">
                <span id="active-name" style="font-size: 16px; font-weight: 500;">Select a chat</span>
            </div>
            <div style="margin-left: auto; display: flex; gap: 15px; align-items: center;">
                <input type="text" id="msg-search" placeholder="Find in chat..." onkeyup="searchMessages()" style="padding: 5px; border-radius: 5px; border: 1px solid #ccc; display:none;">
                <button onclick="deleteFullChat()" id="btn-full-del" style="display:none; color: red; border:none; background:none; cursor:pointer;" title="Delete Entire Chat"><i class="fa-solid fa-trash-can fa-lg"></i></button>
            </div>
        </div>
        
        <div id="messages"></div>

        <div class="action-bar" id="action-bar">
            <span id="sel-text">0 selected</span>
            <div>
                <button class="btn" onclick="clearSelection()">Cancel</button>
                <button class="btn btn-danger" onclick="deleteSelected()">Delete Selected</button>
            </div>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js"></script>

    <script>
        const config = ${JSON.stringify(firebaseConfig)};
        firebase.initializeApp(config);
        const rtdb = firebase.database();
        let currentChatId = null;
        let selectedKeys = [];

        // 1. Sidebar Sync
        rtdb.ref('Chats').on('value', snap => {
            const list = document.getElementById('chat-list');
            list.innerHTML = "";
            snap.forEach(child => {
                const c = child.val();
                list.innerHTML += \`
                    <div class="chat-item" data-name="\${c.name.toLowerCase()}" onclick="openChat('\${child.key}', '\${c.name}')">
                        <div class="avatar">\${c.name[0]}</div>
                        <div style="flex:1">
                            <div style="display:flex; justify-content:space-between">
                                <b>\${c.name}</b>
                                <small style="color:gray">\${new Date(c.lastTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</small>
                            </div>
                            <p style="margin:2px 0; color:gray; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:250px;">\${c.lastMsg || ''}</p>
                        </div>
                    </div>\`;
            });
        });

        // 2. Open Chat & Load Messages
        function openChat(id, name) {
            currentChatId = id;
            selectedKeys = [];
            updateActionBar();
            document.getElementById('active-name').innerText = name;
            document.getElementById('btn-full-del').style.display = 'block';
            document.getElementById('msg-search').style.display = 'block';

            rtdb.ref('Chats/'+id+'/messages').on('value', snap => {
                const box = document.getElementById('messages');
                box.innerHTML = "";
                snap.forEach(child => {
                    const m = child.val();
                    const div = document.createElement('div');
                    div.className = 'msg ' + (m.fromMe ? 'sent' : 'recv');
                    div.setAttribute('data-text', m.body.toLowerCase());
                    
                    let body = m.type === 'image' ? '<img src="'+m.media+'">' : 
                               m.type === 'video' ? '<video controls src="'+m.media+'"></video>' : 
                               '<span>'+m.body+'</span>';
                    
                    div.innerHTML = \`<input type="checkbox" \${selectedKeys.includes(child.key)?'checked':''} onclick="toggleSelect(event, '\${child.key}')"> \${body}\`;
                    box.appendChild(div);
                });
                box.scrollTop = box.scrollHeight;
            });
        }

        // 3. Selection Logic
        function toggleSelect(e, key) {
            if(e.target.checked) selectedKeys.push(key);
            else selectedKeys = selectedKeys.filter(k => k !== key);
            updateActionBar();
        }

        function updateActionBar() {
            const bar = document.getElementById('action-bar');
            bar.style.display = selectedKeys.length ? 'flex' : 'none';
            document.getElementById('sel-text').innerText = selectedKeys.length + " selected";
        }

        function clearSelection() {
            selectedKeys = [];
            document.querySelectorAll('#messages input').forEach(i => i.checked = false);
            updateActionBar();
        }

        // 4. Deletion Features
        async function deleteSelected() {
            if(!confirm('Selected messages delete karein?')) return;
            for(let k of selectedKeys) {
                await rtdb.ref('Chats/'+currentChatId+'/messages/'+k).remove();
            }
            selectedKeys = [];
            updateActionBar();
        }

        function deleteFullChat() {
            if(confirm('Warning: Pura chat history delete kar diya jayega. Continue?')) {
                rtdb.ref('Chats/'+currentChatId).remove();
                document.getElementById('messages').innerHTML = "";
                document.getElementById('active-name').innerText = "Select a chat";
            }
        }

        // 5. Search Features
        function filterContacts() {
            const q = document.getElementById('contact-search').value.toLowerCase();
            document.querySelectorAll('.chat-item').forEach(item => {
                item.style.display = item.getAttribute('data-name').includes(q) ? 'flex' : 'none';
            });
        }

        function searchMessages() {
            const q = document.getElementById('msg-search').value.toLowerCase();
            document.querySelectorAll('.msg').forEach(msg => {
                const text = msg.getAttribute('data-text');
                if(q && text.includes(q)) {
                    msg.style.border = "2px solid var(--wa-green)";
                    msg.scrollIntoView({behavior: 'smooth', block: 'center'});
                } else {
                    msg.style.border = "none";
                }
            });
        }

        // 6. QR Connection
        setInterval(async () => {
            const res = await fetch('/status');
            const data = await res.json();
            if(data.status === "CONNECTED") {
                document.getElementById('qr-screen').style.display = 'none';
            } else if(data.qr) {
                const img = document.getElementById('qr-img');
                img.src = data.qr; img.style.display = 'block';
                document.getElementById('qr-status').innerText = "Scan QR Code";
            }
        }, 3000);
    </script>
    </body>
    </html>
    `);
});

app.get('/status', (req, res) => res.json({ qr: qrCodeUrl, status: connectionStatus }));
app.listen(3000, () => console.log("Premium Dashboard: http://localhost:3000"));
