from flask import Flask, render_template, request, jsonify, Response, session
from flask.sessions import SecureCookieSessionInterface
from itsdangerous import URLSafeTimedSerializer
from openai import OpenAI
import os
import logging
import secrets
from dotenv import load_dotenv
from datetime import timedelta, datetime
import base64
import re
import time
from threading import Thread
from langdetect import detect, DetectorFactory, LangDetectException

# Load environment variables
load_dotenv()

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('app.log')
    ]
)
logger = logging.getLogger(__name__)

# Ensure consistent language detection
DetectorFactory.seed = 0

class CustomSessionInterface(SecureCookieSessionInterface):
    """Custom session interface to optimize cookie size"""
    def get_signing_serializer(self, app):
        if not app.secret_key:
            return None
        return URLSafeTimedSerializer(
            app.secret_key,
            salt=self.salt,
            serializer=self.serializer
        )

def create_app():
    app = Flask(__name__, template_folder="templates")
    
    # Configuration
    app.config.update(
        SECRET_KEY=os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32)),
        PERMANENT_SESSION_LIFETIME=timedelta(hours=6),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE='Lax',
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,
        MAX_IMAGE_SIZE=4 * 1024 * 1024,
        SESSION_REFRESH_EACH_REQUEST=False
    )

    app.session_interface = CustomSessionInterface()

    # Initialize OpenAI client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    
    client = OpenAI(
        api_key=api_key,
        timeout=30.0,
        max_retries=2
    )

    # In-memory storage
    conversation_histories = {}
    uploaded_images_cache = {}

    # Session cleanup thread
    def cleanup_sessions():
        while True:
            try:
                now = datetime.now()
                expired_sessions = [
                    sid for sid, data in conversation_histories.items()
                    if now - data['last_activity'] > timedelta(hours=6)
                ]
                for sid in expired_sessions:
                    del conversation_histories[sid]
                
                expired_images = [
                    img_id for img_id, img_data in uploaded_images_cache.items()
                    if now - img_data['upload_time'] > timedelta(hours=6)
                ]
                for img_id in expired_images:
                    del uploaded_images_cache[img_id]
                
                time.sleep(3600)
            except Exception as e:
                logger.error(f"Cleanup error: {e}")

    Thread(target=cleanup_sessions, daemon=True).start()

    def format_response_text(text):
        """Format response text for better readability"""
        if not text:
            return ""
        text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
        text = re.sub(r'([.,!?])([A-Za-z])', r'\1 \2', text)
        text = re.sub(r'\b([A-Z][a-z]+)([A-Z][a-z]+)', r'\1 \2', text)
        text = re.sub(r'\b(I)(am|can|will|have|do|would)', r'\1 \2', text)
        return ' '.join(text.split()).strip()

    @app.before_request
    def before_request():
        """Initialize session with minimal data"""
        if 'session_id' not in session:
            session['session_id'] = secrets.token_hex(16)
            session['init_time'] = datetime.now().isoformat()

    @app.after_request
    def after_request(response):
        """Prevent unnecessary session modifications"""
        session.modified = False
        return response

    @app.route("/")
    def home():
        """Render main page"""
        return render_template("index.html")

    @app.route("/upload-image", methods=["POST"])
    def upload_image():
        """Handle image uploads"""
        try:
            if 'session_id' not in session:
                return jsonify({"error": "Session not initialized"}), 400

            file = request.files.get('file')
            if not file:
                return jsonify({"error": "No file uploaded"}), 400

            if not file.content_type.startswith('image/'):
                return jsonify({"error": "Only image files allowed"}), 400

            file_data = file.read()
            if len(file_data) > app.config['MAX_IMAGE_SIZE']:
                return jsonify({"error": f"Image exceeds {app.config['MAX_IMAGE_SIZE']//(1024*1024)}MB limit"}), 400

            image_id = secrets.token_hex(16)
            uploaded_images_cache[image_id] = {
                'data': base64.b64encode(file_data).decode('utf-8'),
                'content_type': file.content_type,
                'upload_time': datetime.now(),
                'used': False
            }

            return jsonify({
                "success": True,
                "image_id": image_id,
                "filename": file.filename
            })

        except Exception as e:
            logger.error(f"Upload error: {e}")
            return jsonify({"error": "File upload failed"}), 500

    @app.route("/chat", methods=["GET"])
    def chat():
        """Handle chat requests with optional image processing"""
        try:
            user_input = request.args.get("message", "").strip()
            image_id = request.args.get("image_id", None)
            
            if not user_input and not image_id:
                return jsonify({"error": "Message or image required"}), 400

            if 'session_id' not in session:
                return jsonify({"error": "Session not initialized"}), 400

            session_id = session['session_id']
            
            # Initialize conversation history
            if session_id not in conversation_histories:
                conversation_histories[session_id] = {
                    'messages': [{
                        "role": "system", 
                        "content": "You are a helpful AI assistant that can analyze images. Respond concisely in the user's language."
                    }],
                    'last_activity': datetime.now()
                }

            messages = conversation_histories[session_id]['messages'].copy()
            
            # Handle language detection
            try:
                lang = detect(user_input) if user_input else "en"
            except (LangDetectException, Exception):
                lang = "en"

            # Prepare message content
            if image_id and image_id in uploaded_images_cache:
                image_data = uploaded_images_cache[image_id]
                message_content = {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_input or "Describe this image"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{image_data['content_type']};base64,{image_data['data']}"
                            }
                        }
                    ]
                }
                messages.append(message_content)
                model_name = "gpt-4-turbo"
                stream = False
            else:
                messages.append({"role": "user", "content": user_input})
                model_name = "gpt-4-turbo"
                stream = True

            # Call OpenAI API
            if stream:
                def generate():
                    full_response = ""
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        max_tokens=800,
                        stream=True
                    )
                    
                    for chunk in response:
                        if chunk.choices[0].delta.content:
                            chunk_content = chunk.choices[0].delta.content
                            full_response += chunk_content
                            yield f"data: {chunk_content}\n\n"
                    yield "data: [END]\n\n"

                    # Update conversation history
                    formatted_response = format_response_text(full_response)
                    conversation_histories[session_id]['messages'].append({
                        "role": "assistant",
                        "content": formatted_response
                    })
                    conversation_histories[session_id]['last_activity'] = datetime.now()

                return Response(generate(), mimetype="text/event-stream")
            else:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    max_tokens=800
                )

                full_response = response.choices[0].message.content
                formatted_response = format_response_text(full_response)
                
                conversation_histories[session_id]['messages'].append({
                    "role": "assistant",
                    "content": formatted_response
                })
                conversation_histories[session_id]['last_activity'] = datetime.now()

                return jsonify({"response": formatted_response})

        except Exception as e:
            logger.error(f"Chat error: {e}")
            return jsonify({"error": str(e)}), 500

    @app.route("/new_chat", methods=["GET"])
    def new_chat():
        """Start a new chat session"""
        if 'session_id' in session:
            session_id = session['session_id']
            if session_id in conversation_histories:
                del conversation_histories[session_id]
        session.clear()
        return jsonify({"status": "success"})

    return app

if __name__ == "__main__":
    from waitress import serve
    app = create_app()
    serve(
        app,
        host="0.0.0.0",
        port=8080,
        threads=4,
        connection_limit=500,
        channel_timeout=60,
        cleanup_interval=30
    )