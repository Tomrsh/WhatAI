import os
from flask import Flask, request, jsonify
from groq import Groq
import pyrebase

app = Flask(__name__)

# --- Firebase Web SDK Config (Render Environment Variables se aayega) ---
firebase_config = {
    "apiKey": os.environ.get("AIzaSyAb7V8Xxg5rUYi8UKChEd3rR5dglJ6bLhU"),
    "authDomain": os.environ.get("t2-storage-4e5ca.firebaseapp.com"),
    "databaseURL": os.environ.get("https://t2-storage-4e5ca-default-rtdb.firebaseio.com"),
    "projectId": os.environ.get("t2-storage-4e5ca"),
    "storageBucket": os.environ.get("t2-storage-4e5ca.firebasestorage.app"),
    "messagingSenderId": os.environ.get("667143720466"),
    "appId": os.environ.get("1:667143720466:web:c8bfe23f3935d3c7e052cb")
}

firebase = pyrebase.initialize_app(firebase_config)
db = firebase.database()

# --- Groq AI Setup (Key fetched from your URL) ---
# Note: Render par ise GROQ_API_KEY naam ke variable mein save karein
client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_id = data.get("user_id", "default_user")
    user_message = data.get("message")

    # 1. Firebase se User ki 'Memory' fetch karna
    user_data = db.child("users").child(user_id).get().val()
    
    # Agar pehli baar baat ho rahi hai toh memory initialize karein
    if not user_data:
        history = [{
            "role": "system", 
            "content": "Tum ek Thinking AI ho. Tumhare paas apni raay (opinion) hai. Har chat se seekho aur khud ko improve karo."
        }]
    else:
        history = user_data.get("history", [])

    # 2. User ka message add karna
    history.append({"role": "user", "content": user_message})

    # 3. AI 'Thinking' and Response Generation
    try:
        completion = client.chat.completions.create(
            model="llama3-70b-8192", # Bada model behtar sochega
            messages=history,
            temperature=0.7 # Thodi creativity aur raay ke liye
        )
        ai_response = completion.choices[0].message.content

        # 4. Self-Learning: AI ka response history mein save karna
        history.append({"role": "assistant", "content": ai_response})

        # 5. Firebase mein Update karna (Memory Save)
        # Last 15 messages rakhenge taaki context bana rahe
        db.child("users").child(user_id).update({"history": history[-15:]})

        return jsonify({"status": "success", "response": ai_response})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get("PORT", 5000)))

