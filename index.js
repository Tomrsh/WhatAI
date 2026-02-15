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
const KEY_URL = "http://key-to-url.onrender.com/get/755ajy"; // Aapka key fetch URL

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

// --- 🧠 REFINED TRAINING (BOSS + OTHERS) ---
const TRAIN_FOR_BOSS = `Tum Ayesha ho, Boss ki personal assistant aur GF. Boss se sweet aur loyal baatein karo. Inki har baat maano. Short aur natural replies do.`;

const TRAIN_FOR_OTHERS = `Tum Ayesha ho, Boss ki loyal GF aur assistant. 
Rules:
1. Sabse pehle bolo: "Boss busy hain, apna kaam batayein."
2. Samne wale ka haal-chal (khana khaya? etc) pucho par replies ekdum SHORT (max 1-2 lines) rakho.
3. Agar koi flirt kare toh mazaak mein bolo "Main apne Boss ki GF hoon" aur limit mein rakho.
4. Faltu paragraphs mana hain. Strictly professional but sweet.`;
// ======================================================

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
let genAI, model, sock;
let botStatus = "Initializing...";
let qrCodeImage = "";
let isConnected = false;
let lastRequestTime = Date.now();

// --- API KEY FETCHING ---
async function fetchApiKey() {
    try {
        const response = await fetch(KEY_URL);
        const API_KEY = await response.text();
        if (!API_KEY || API_KEY.includes("error")) throw new Error("Key Error");
        genAI = new GoogleGenerativeAI(API_KEY.trim());
        model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        return true;
    } catch (err) {
        console.log("⚠️ Key Fetch Failed... Retrying.");
        return false;
    }
}

// --- WHATSAPP LOGIC ---
async function startAyesha() {
    await fetchApiKey();
    const { state, saveCreds } = await useMultiFileAuthState('ayesha_permanent_session');
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
            console.log("✅ Ayesha Online: Boss Mode Active!");
        }
        if (connection === 'close') {
            isConnected = false;
            botStatus = "Reconnecting... 🔄";
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
        const isGroup = jid.endsWith('@g.us');

        try {
            const settingsRef = ref(db, `settings/${safeId}`);

            // --- BOSS COMMANDS ---
            if (isBoss && text === ".forget all") {
                await remove(ref(db, `chats/${safeId}`));
                return await sock.sendMessage(jid, { text: "Theek hai Boss, memory clear! ❤️" });
            }

            // AI Toggle (.aion / .aioff)
            if (text === ".aioff" && (isBoss || !isGroup)) {
                await update(settingsRef, { enabled: false });
                return await sock.sendMessage(jid, { text: "Ayesha Mode: OFF ❌" });
            }
            if (text === ".aion" && (isBoss || !isGroup)) {
                await update(settingsRef, { enabled: true });
                return await sock.sendMessage(jid, { text: "Ayesha Mode: ON ✅" });
            }

            const settingsSnap = await get(settingsRef);
            const isEnabled = settingsSnap.val()?.enabled ?? (!isGroup);
            if (!isEnabled && !isBoss) return;

            // Rate Limit Gap (4 seconds)
            const now = Date.now();
            if (now - lastRequestTime < 4000) return;
            lastRequestTime = now;

            const historySnap = await get(query(ref(db, `chats/${safeId}`), limitToLast(6)));
            let historyText = "";
            historySnap.forEach(s => { historyText += `${s.val().role}: ${s.val().text}\n`; });

            const training = isBoss ? TRAIN_FOR_BOSS : TRAIN_FOR_OTHERS;

            if (!model) await fetchApiKey();
            const result = await model.generateContent(`${training}\n\nConstraint: Reply in max 2 short sentences.\nHistory:\n${historyText}\nUser: ${text}`);
            const aiReply = result.response.text().trim();

            await push(ref(db, `chats/${safeId}`), { role: isBoss ? "Boss" : "User", text: text });
            await push(ref(db, `chats/${safeId}`), { role: "Ayesha", text: aiReply });
            
            await sock.sendMessage(jid, { text: aiReply });

        } catch (e) {
            console.log("AI Busy.");
        }
    });
}

// --- DASHBOARD UI ---
app.get('/', (req, res) => {
    res.send(`
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { background: #0a0f14; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: #141c24; padding: 40px; border-radius: 30px; box-shadow: 0 10px 50px rgba(0,0,0,0.5); width: 90%; max-width: 400px; text-align: center; border: 1px solid #ffffff10; }
        .orb { width: 12px; height: 12px; border-radius: 50%; display: inline-block; background: ${isConnected ? '#00ffa3' : '#ff3e3e'}; margin-right: 10px; box-shadow: 0 0 10px ${isConnected ? '#00ffa3' : '#ff3e3e'}; }
    </style>
    <script>setInterval(() => { location.reload(); }, 12000);</script></head>
    <body>
        <div class="card">
            <h1 style="color: #00ffa3;">🌸 Ayesha AI</h1>
            <div style="margin: 20px 0;"><span class="orb"></span> <b>${botStatus}</b></div>
            ${!isConnected && qrCodeImage ? `<img src="${qrCodeImage}" width="220" style="background:white; border-radius:15px; padding:10px;">` : `<p>Serving Boss: ${MY_NUMBER.split('@')[0]}</p>`}
        </div>
    </body></html>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 OS Link: http://localhost:${PORT}`);
    startAyesha();
});

