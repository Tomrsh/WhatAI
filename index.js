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
const { getDatabase, ref, get, set, push, limitToLast, query, update } = require("firebase/database");

const app = express();
const PORT = 3000;

// ================= [ 🛠️ CONFIGURATION ] =================
const MY_NUMBER = "916268249364@s.whatsapp.net"; // ⚠️ Apna No. 91 ke saath
const KEY_URL = "http://key-to-url.onrender.com/get/9odr55"; // Aapka Key URL

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

const AYESHA_PROMPT = `Tumhara naam Ayesha hai. Tum Boss (Owner) ki personal assistant ho. 
Sirf Boss ko "Boss" bolo, baki sab ke liye professional assistant raho. Natural Hinglish use karo.`;
// ======================================================

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

let botStatus = "Initializing...";
let qrCodeImage = "";
let lastRequestTime = Date.now();
let genAI, model;

// --- 1. API KEY FETCHING LOGIC ---
async function fetchApiKey() {
    try {
        console.log("Fetching API Key from URL...");
        const response = await fetch(KEY_URL);
        const API_KEY = await response.text();
        
        if (!API_KEY || API_KEY.includes("error")) {
            throw new Error("Key fetch nahi ho payi!");
        }
        
        genAI = new GoogleGenerativeAI(API_KEY.trim());
        model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("✅ API Key Loaded Successfully!");
        return true;
    } catch (err) {
        console.error("❌ Key Error:", err.message);
        return false;
    }
}

// --- 2. WHATSAPP CONNECTION ---
async function startAyesha() {
    // Pehle Key fetch karein
    const keyLoaded = await fetchApiKey();
    if (!keyLoaded) {
        botStatus = "Error: Key Fetch Failed ❌";
        return;
    }

    const { state, saveCreds } = await useMultiFileAuthState('ayesha_session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["Ayesha AI", "Chrome", "1.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            botStatus = "Scan QR Code 📲";
            qrcodeTerminal.generate(qr, { small: true });
            qrCodeImage = await QRCode.toDataURL(qr);
        }
        if (connection === 'open') {
            botStatus = "Online ✅";
            qrCodeImage = "";
            console.log("✅ Ayesha Connected & Key Secured!");
        }
        if (connection === 'close') {
            botStatus = "Reconnecting... 🔄";
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startAyesha();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const isGroup = jid.endsWith('@g.us');
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const isBoss = (jid === MY_NUMBER);
        const safeId = jid.replace(/[.@]/g, "_");

        try {
            const settingsRef = ref(db, `settings/${safeId}`);
            const settingsSnap = await get(settingsRef);
            let aiActive = settingsSnap.val()?.enabled ?? (!isGroup);

            // Toggle Commands
            if (text === ".aioff" && (isBoss || !isGroup)) {
                await update(settingsRef, { enabled: false });
                return await sock.sendMessage(jid, { text: "Ayesha AI: OFF ❌" });
            }
            if (text === ".aion" && (isBoss || !isGroup)) {
                await update(settingsRef, { enabled: true });
                return await sock.sendMessage(jid, { text: "Ayesha AI: ON ✅" });
            }

            if (!aiActive) return;

            // Rate Limit (Gemini Rules)
            const now = Date.now();
            if (now - lastRequestTime < 3000) return;
            lastRequestTime = now;

            // AI Logic
            const chatRef = ref(db, `chats/${safeId}`);
            const historySnap = await get(query(chatRef, limitToLast(6)));
            let historyText = "";
            historySnap.forEach(s => { historyText += `${s.val().role}: ${s.val().text}\n`; });

            // Check if model is loaded
            if (!model) await fetchApiKey();

            const result = await model.generateContent(`${AYESHA_PROMPT}\n\nHistory:\n${historyText}\nUser: ${text}`);
            const aiReply = result.response.text().trim();

            await push(chatRef, { role: isBoss ? "Boss" : "User", text: text });
            await push(chatRef, { role: "Ayesha", text: aiReply });
            await sock.sendMessage(jid, { text: aiReply });

        } catch (e) {
            console.log("Error in AI Logic:", e.message);
            // Agar Quota ya Key ka error ho toh refresh karein
            if (e.message.includes("429") || e.message.includes("API_KEY")) {
                await fetchApiKey();
            }
        }
    });
}

// --- DASHBOARD (UI) ---
app.get('/', (req, res) => {
    res.send(`
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { background: #0f172a; color: white; font-family: sans-serif; text-align: center; padding: 40px 20px; }
        .card { background: #1e293b; padding: 30px; border-radius: 20px; max-width: 400px; margin: auto; border: 1px solid #334155; }
        .status { font-size: 1.5rem; color: #10b981; font-weight: bold; margin: 20px 0; }
        .key-info { color: #94a3b8; font-size: 0.8rem; margin-top: 10px; }
    </style>
    <script>setInterval(() => { location.reload(); }, 10000);</script></head>
    <body>
        <div class="card">
            <h1>🌸 Ayesha AI Control</h1>
            <div class="status">${botStatus}</div>
            <div class="key-info">API Key: Dynamic (Fetched from URL)</div>
            ${qrCodeImage ? `<p>Scan to Login:</p><img src="${qrCodeImage}" width="250">` : `<p>Ready & Serving Boss.</p>`}
        </div>
    </body></html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 System Live: http://localhost:${PORT}`);
    startAyesha();
});

