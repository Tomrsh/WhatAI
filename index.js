const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, set, push, limitToLast, query, update, remove } = require("firebase/database");

const app = express();
const PORT = 3000;

// ================= [ 🛠️ CONFIGURATION ] =================
const MY_NUMBER = "916268249364@s.whatsapp.net"; // ⚠️ Apna number 91 ke saath likhein
const KEY_URL = "http://key-to-url.onrender.com/get/9odr55"; 

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

// --- PERSONALITY TRAINING ---
const AYESHA_FOR_BOSS = `Tumhara naam Ayesha hai. Tum apne Boss (Owner) se baat kar rahi ho. 
Tum Boss se behad sweet, personal, aur devoted hokar baat karo. Inki har baat maano aur inka khayal rakho. 
Hinglish mein natural baatein karo, robot ki tarah nahi.`;

const AYESHA_FOR_OTHERS = `Tumhara naam Ayesha hai. Tum Boss ki Professional Personal Assistant ho. 
Duniya ke liye tum Boss ki taraf se reply de rahi ho. Strictly professional raho. 
Har msg mein Boss ke busy hone ka rona mat ro, bas kaam ki baat karo aur bolo "Main Boss ki assistant hoon". 
Zyada lambe replies mat do.`;
// ======================================================

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
let genAI, model, sock;
let botStatus = "Initializing...";
let qrCodeImage = "";
let isConnected = false;

async function fetchApiKey() {
    try {
        const response = await fetch(KEY_URL);
        const API_KEY = await response.text();
        genAI = new GoogleGenerativeAI(API_KEY.trim());
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        return true;
    } catch (err) { return false; }
}

async function startAyesha() {
    await fetchApiKey();
    const { state, saveCreds } = await useMultiFileAuthState('ayesha_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["Ayesha OS", "Chrome", "3.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCodeImage = await QRCode.toDataURL(qr);
            botStatus = "Scan QR Code 📲";
            isConnected = false;
        }
        if (connection === 'open') {
            isConnected = true;
            botStatus = "Connected ✅";
            qrCodeImage = "";
            console.log("✅ Ayesha System Online!");
        }
        if (connection === 'close') {
            isConnected = false;
            botStatus = "Reconnecting...";
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startAyesha();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const isBoss = (jid === MY_NUMBER);
        const safeId = jid.replace(/[.@]/g, "_");

        try {
            const settingsRef = ref(db, `settings/${safeId}`);

            // --- BOSS COMMANDS ---
            if (isBoss) {
                if (text === ".forget all") {
                    await remove(ref(db, `chats/${safeId}`));
                    return await sock.sendMessage(jid, { text: "Theek hai Boss, maine sab bhula diya. ✨" });
                }
            }

            // Toggle Logic
            if (text === ".aioff" && isBoss) {
                await update(settingsRef, { enabled: false });
                return await sock.sendMessage(jid, { text: "Ayesha AI: Disabled ❌" });
            }
            if (text === ".aion" && isBoss) {
                await update(settingsRef, { enabled: true });
                return await sock.sendMessage(jid, { text: "Ayesha AI: Enabled ✅" });
            }

            const settingsSnap = await get(settingsRef);
            if (settingsSnap.val()?.enabled === false && !isBoss) return;

            // --- AI LOGIC ---
            const historySnap = await get(query(ref(db, `chats/${safeId}`), limitToLast(10)));
            let historyText = "";
            historySnap.forEach(s => { historyText += `${s.val().role}: ${s.val().text}\n`; });

            // Choose Personality based on who is chatting
            const finalPrompt = isBoss ? AYESHA_FOR_BOSS : AYESHA_FOR_OTHERS;

            const result = await model.generateContent(`${finalPrompt}\n\nChat History:\n${historyText}\nUser: ${text}`);
            const aiReply = result.response.text().trim();

            await push(ref(db, `chats/${safeId}`), { role: isBoss ? "Boss" : "User", text: text });
            await push(ref(db, `chats/${safeId}`), { role: "Ayesha", text: aiReply });
            
            await sock.sendMessage(jid, { text: aiReply });

        } catch (e) { console.log("AI Error"); }
    });
}

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    res.send(`
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { background: #0a0f14; color: white; font-family: sans-serif; text-align: center; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #141c24; padding: 40px; border-radius: 25px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); width: 100%; max-width: 400px; border: 1px solid #ffffff10; }
        .status { font-size: 1.4rem; color: #00ffa3; font-weight: bold; margin: 20px 0; }
        .qr-img { background: white; padding: 10px; border-radius: 15px; width: 200px; }
    </style>
    <script>setInterval(() => { location.reload(); }, 10000);</script></head>
    <body>
        <div class="card">
            <h2 style="color: #00ffa3; margin: 0;">🌸 Ayesha OS</h2>
            <p style="opacity: 0.6;">Boss Tracking & Automation</p>
            <div class="status">${botStatus}</div>
            ${!isConnected && qrCodeImage ? `<img src="${qrCodeImage}" class="qr-img"><p>Scan to link WhatsApp</p>` : `<div style="background: #ffffff05; padding: 15px; border-radius: 12px; text-align: left; font-size: 0.9rem;"><b>Active Mode:</b> ${isConnected ? 'Serving Boss 👑' : 'Offline'}<br><b>System:</b> Secured</div>`}
        </div>
    </body></html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Link: http://localhost:${PORT}`);
    startAyesha();
});

