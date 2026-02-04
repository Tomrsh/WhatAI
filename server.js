const fs = require("fs");
const express = require("express");

const app = express();
app.use(express.json());

// ---------- LOAD DATA ----------
const chat = fs.readFileSync("chat.txt", "utf-8").split("\n");

let memory = [];

for (let i = 0; i < chat.length - 1; i++) {
  if (chat[i].includes("Tinu:") && chat[i + 1].includes("Linux")) {
    const input = chat[i].split("Tinu:")[1]?.trim().toLowerCase();
    const reply = chat[i + 1].split(":").slice(1).join(":").trim();
    if (input && reply) memory.push({ input, reply });
  }
}

// ---------- INTENT ----------
function intentOf(msg) {
  msg = msg.toLowerCase();
  if (msg.includes("recharge") || msg.includes("paisa")) return "money";
  if (msg.includes("call")) return "call";
  if (msg.includes("exam") || msg.includes("school")) return "study";
  if (msg.includes("sure") || msg.includes("confirm")) return "confirm";
  if (msg.includes("help") || msg.includes("problem")) return "help";
  if (msg.includes("hello") || msg.includes("hi")) return "greet";
  return "general";
}

// ---------- CONFIDENCE ----------
function confidence(msg) {
  let score = 0;
  for (let m of memory) {
    if (msg.includes(m.input) || m.input.includes(msg)) score++;
  }
  return score;
}

// ---------- GENERATOR ----------
function generateReply(msg) {
  const intent = intentOf(msg);
  const conf = confidence(msg);

  if (conf < 1) {
    return "Iska exact idea nahi hai, sir se puchkar confirm karke batata hu";
  }

  const candidates = memory
    .filter(m => msg.includes(m.input) || m.input.includes(msg))
    .map(m => m.reply);

  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------- API ----------
app.post("/reply", (req, res) => {
  const msg = req.body.message;
  res.json({
    reply: generateReply(msg)
  });
});

app.listen(3000, () => {
  console.log("🔥 Human-like Self AI running on 3000");
});
