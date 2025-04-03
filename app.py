from flask import Flask, render_template, request, jsonify, Response, session
from openai import OpenAI
import os
import logging
import secrets
from dotenv import load_dotenv
from langdetect import detect, DetectorFactory, LangDetectException
from datetime import timedelta
import base64
from io import BytesIO
from PIL import Image, ImageDraw

# Load environment variables
load_dotenv()

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Ensure consistent language detection
DetectorFactory.seed = 0

def create_app():
    app = Flask(__name__, template_folder="templates")
    
    # Configuration
    app.config['SECRET_KEY'] = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(16))
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=1)
    app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB
    
    # Initialize OpenAI client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    client = OpenAI(api_key=api_key)

    # Store conversation history
    conversation_histories = {}

    def truncate_conversation(conversation_history, max_messages=100):
        while len(conversation_history) > max_messages:
            conversation_history.pop(1)
        return conversation_history

    @app.route("/")
    def home():
        if 'session_id' not in session:
            session['session_id'] = secrets.token_hex(16)
            session.permanent = True
        return render_template("index.html")

    @app.route("/about")
    def about():
        return render_template("about.html")

    @app.route("/services")
    def services():
        return render_template("services.html")

    @app.route("/contact")
    def contact():
        return render_template("contact.html")

    @app.route("/analyze-image", methods=["POST"])
    def analyze_image():
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No selected file"}), 400
            
        user_prompt = request.form.get('prompt', '')
            
        try:
            # Check file size
            if file.content_length > 20 * 1024 * 1024:  # 20MB
                return jsonify({"error": "File size exceeds 20MB limit"}), 400
                
            # Open the image
            img = Image.open(file.stream)
            
            # Convert RGBA to RGB if needed with checkerboard background
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (242, 242, 242))
                draw = ImageDraw.Draw(background)
                size = 20
                for x in range(0, img.size[0], size):
                    for y in range(0, img.size[1], size):
                        if (x//size + y//size) % 2 == 0:
                            draw.rectangle([x, y, x+size, y+size], fill=(220, 220, 220))
                background.paste(img, mask=img.split()[3])
                img = background
            
            # Convert image to base64
            buffered = BytesIO()
            img.save(buffered, format="WEBP", quality=85)
            img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
            
            # Get session ID
            if 'session_id' not in session:
                session['session_id'] = secrets.token_hex(16)
                session.permanent = True
            session_id = session['session_id']
            
            # Initialize conversation history if needed
            if session_id not in conversation_histories:
                conversation_histories[session_id] = [
                    {
                        "role": "system", 
                        "content": "You are a helpful AI assistant that responds only in English or Arabic. "
                                  "Never respond in any other language. If the user speaks another language, "
                                  "politely inform them you only understand English and Arabic. "
                                  "أنا مساعد مفيد أتحدث الإنجليزية والعربية فقط. لا أستطيع الرد بأي لغة أخرى."
                    }
                ]
            
            # Prepare the image URL object
            image_url_object = {
                "url": f"data:image/webp;base64,{img_base64}"
            }
            
            # Create message content array
            message_content = []
            
            # Add text if provided
            if user_prompt:
                # Verify prompt language
                try:
                    lang = detect(user_prompt)
                    if lang not in ["ar", "en"]:
                        return jsonify({
                            "error": "I only respond in English or Arabic. / أرد باللغة الإنجليزية أو العربية فقط"
                        }), 400
                except (LangDetectException, Exception):
                    pass  # Skip detection if it fails
                
                message_content.append({"type": "text", "text": user_prompt})
            
            # Add image
            message_content.append({
                "type": "image_url",
                "image_url": image_url_object
            })
            
            # Add user message with properly structured content
            conversation_histories[session_id].append({
                "role": "user",
                "content": message_content
            })
            
            # Call OpenAI API with GPT-4o
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=conversation_histories[session_id],
                max_tokens=1500,
                temperature=0.7
            )
            
            # Get the response
            analysis = response.choices[0].message.content
            
            # Add assistant response to conversation history
            conversation_histories[session_id].append({
                "role": "assistant",
                "content": analysis
            })
            
            return jsonify({
                "analysis": analysis,
                "model_used": "gpt-4o"
            })
            
        except Exception as e:
            logger.error(f"Error analyzing image: {e}")
            return jsonify({"error": str(e)}), 500

    @app.route("/chat", methods=["GET"])
    def chat_stream():
        user_input = request.args.get("message", "").strip()
        
        if 'session_id' not in session:
            session['session_id'] = secrets.token_hex(16)
            session.permanent = True
        
        session_id = session['session_id']
            
        if not user_input:
            return jsonify({"response": "Please enter a message."}), 400
            
        try:
            # Detect and enforce Arabic/English only
            lang = detect(user_input)
            if lang not in ["ar", "en"]:
                return jsonify({
                    "response": "I only respond in English or Arabic. / أرد باللغة الإنجليزية أو العربية فقط"
                }), 400
        except (LangDetectException, Exception):
            lang = "en"  # Default to English

        try:
            if session_id not in conversation_histories:
                conversation_histories[session_id] = [
                    {
                        "role": "system", 
                        "content": "You are a helpful assistant that responds exclusively in English or Arabic. "
                                  "Never respond in any other language. If the user speaks another language, "
                                  "politely inform them you only understand English and Arabic. "
                                  "أنا مساعد مفيد أتحدث الإنجليزية والعربية فقط. لا أستطيع الرد بأي لغة أخرى."
                    }
                ]

            conversation_histories[session_id].append({"role": "user", "content": user_input})
            conversation_histories[session_id] = truncate_conversation(conversation_histories[session_id])

            response = client.chat.completions.create(
                model="gpt-4o",
                messages=conversation_histories[session_id],
                stream=True,
                temperature=0.7
            )

            def generate():
                full_response = ""
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        chunk_content = chunk.choices[0].delta.content
                        full_response += chunk_content
                        yield f"data: {chunk_content}\n\n".encode('utf-8')
                yield "data: [END]\n\n".encode('utf-8')
                conversation_histories[session_id].append({"role": "assistant", "content": full_response})

            return Response(generate(), mimetype="text/event-stream; charset=utf-8")
        except Exception as e:
            logger.error(f"Error during chat: {e}")
            return jsonify({"response": "An error occurred. / حدث خطأ"}), 500

    @app.route("/new_chat", methods=["GET"])
    def new_chat():
        session['session_id'] = secrets.token_hex(16)
        session.permanent = True
        return jsonify({"status": "success", "message": "New chat session created"})

    return app

app = create_app()

if __name__ == "__main__":
    app = create_app()
    app.run(debug=False)