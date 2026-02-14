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
const MY_NUMBER = "916268249364@s.whatsapp.net"; // ⚠️ Apna No. 91 ke saath yahan likhein
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

// --- 🧠 PERSONALITY TRAINING (PROPERLY TRAINED) ---
const TRAIN_FOR_BOSS = `Tumhara naam Ayesha hai. Tum apne Boss (Owner) se baat kar rahi ho. 
Inse behad sweet, personal, devoted aur caring hokar baat karo. Inki har baat maano. 
Hinglish natural rakho. Agar ye kahein ki kuch bhool jao, toh '.forget all' use karne bolo.`;

const TRAIN_FOR_OTHERS = `Tumhara naam Ayesha hai. Tum Boss ki Professional Assistant ho. 
Duniya ke liye tum hamesha professional aur limited baat karogi. 
Sirf kaam ki baat karo aur natural Hinglish mein bolo "Main Boss ki assistant hoon". 
Faltu lambe bhashan mat do aur hamesha loyal raho.`;
// ======================================================

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
let genAI, model, sock;
let botStatus = "Initializing...";
let qrCodeImage = "";
let isConnected = false;
let lastRequestTime = Date.now();

// --- 1. KEY FETCHING (With Auto-Retry) ---
async function fetchApiKey() {
    try {
        const response = await fetch(KEY_URL);
        const API_KEY = await response.text();
        if (!API_KEY || API_KEY.includes("error")) throw new Error("Key Failed");
        genAI = new GoogleGenerativeAI(API_KEY.trim());
        model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // Stable model
        return true;
    } catch (err) {
        console.log("⚠️ Key Fetch Error... Retrying.");
        return false;
    }
}

// --- 2. WHATSAPP ENGINE ---
async function startAyesha() {
    await fetchApiKey();
    const { state, saveCreds } = await useMultiFileAuthState('ayesha_session_v3');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ["Ayesha AI OS", "Chrome", "3.0.0"],
        syncFullHistory: false
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
            console.log("✅ Ayesha System Online & Fully Trained!");
        }
        if (connection === 'close') {
            isConnected = false;
            botStatus = "Reconnecting... 🔄";
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startAyesha();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const isBoss = (jid === MY_NUMBER);
        const safeId = jid.replace(/[.@]/g, "_");
        const isGroup = jid.endsWith('@g.us');

        try {
            const settingsRef = ref(db, `settings/${safeId}`);

            // --- BOSS COMMANDS (Manual Control) ---
            if (isBoss) {
                if (text === ".forget all") {
                    await remove(ref(db, `chats/${safeId}`));
                    return await sock.sendMessage(jid, { text: "Theek hai Boss, maine sab bhula diya. ✨" });
                }
            }

            // AI Toggle (Boss for all, Others for self)
            if (text === ".aioff" && (isBoss || !isGroup)) {
                await update(settingsRef, { enabled: false });
                return await sock.sendMessage(jid, { text: "Ayesha AI: OFF ❌" });
            }
            if (text === ".aion" && (isBoss || !isGroup)) {
                await update(settingsRef, { enabled: true });
                return await sock.sendMessage(jid, { text: "Ayesha AI: ON ✅" });
            }

            // Check if AI should reply
            const settingsSnap = await get(settingsRef);
            const isEnabled = settingsSnap.val()?.enabled ?? (!isGroup);
            if (!isEnabled && !isBoss) return;

            // --- GEMINI RULES: Rate Limiting ---
            const now = Date.now();
            if (now - lastRequestTime < 3500) return; // 3.5 sec gap
            lastRequestTime = now;

            // --- AI PROCESS ---
            const historySnap = await get(query(ref(db, `chats/${safeId}`), limitToLast(8)));
            let historyText = "";
            historySnap.forEach(s => { historyText += `${s.val().role}: ${s.val().text}\n`; });

            const training = isBoss ? TRAIN_FOR_BOSS : TRAIN_FOR_OTHERS;

            if (!model) await fetchApiKey();
            const result = await model.generateContent(`${training}\n\nChat History:\n${historyText}\nUser: ${text}`);
            const aiReply = result.response.text().trim();

            // Save Memory
            await push(ref(db, `chats/${safeId}`), { role: isBoss ? "Boss" : "User", text: text });
            await push(ref(db, `chats/${safeId}`), { role: "Ayesha", text: aiReply });
            
            await sock.sendMessage(jid, { text: aiReply });

        } catch (e) {
            console.log("System Busy or Limit Reached.");
        }
    });
}

// --- 🛠️ OS DASHBOARD ---
app.get('/', (req, res) => {
    res.send(`
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { background: #0a0f14; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #141c24; padding: 40px; border-radius: 30px; box-shadow: 0 15px 50px rgba(0,0,0,0.6); width: 90%; max-width: 400px; text-align: center; border: 1px solid #ffffff10; }
        .orb { width: 15px; height: 15px; border-radius: 50%; display: inline-block; background: ${isConnected ? '#00ffa3' : '#ff3e3e'}; box-shadow: 0 0 15px ${isConnected ? '#00ffa3' : '#ff3e3e'}; margin-right: 10px; }
        h1 { color: #00ffa3; font-size: 1.8rem; margin: 0; }
        .qr-img { background: white; padding: 15px; border-radius: 20px; width: 220px; margin-top: 20px; }
    </style>
    <script>setInterval(() => { location.reload(); }, 12000);</script></head>
    <body>
        <div class="card">
            <h1>🌸 Ayesha AI OS</h1>
            <p style="opacity: 0.5;">Stable v4.0 - Permanent Connect</p>
            <div style="margin: 25px 0;">
                <span class="orb"></span> <span style="font-weight: bold; font-size: 1.1rem;">${botStatus}</span>
            </div>
            ${!isConnected && qrCodeImage ? `
                <img src="${qrCodeImage}" class="qr-img">
                <p style="margin-top: 15px;">Link your WhatsApp to start</p>
            ` : `
                <div style="background: #ffffff05; padding: 20px; border-radius: 15px; text-align: left;">
                    <b>Status:</b> Operating Normal<br>
                    <b>Role:</b> Personal Assistant<br>
                    <b>Target:</b> ${MY_NUMBER.split('@')[0]} (Boss)
                </div>
            `}
        </div>
    </body></html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 OS Dashboard Live: http://localhost:${PORT}`);
    startAyesha();
});

