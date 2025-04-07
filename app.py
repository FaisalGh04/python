from flask import Flask, render_template, request, jsonify, Response, session
from flask_cors import CORS
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
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('app_debug.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Ensure consistent language detection
DetectorFactory.seed = 0

class CustomSessionInterface(SecureCookieSessionInterface):
    """Custom session interface to optimize cookie size"""
    def get_signing_serializer(self, app):
        if not app.secret_key:
            logger.error("App secret key is missing!")
            return None
        logger.debug("Creating signing serializer")
        return URLSafeTimedSerializer(
            app.secret_key,
            salt=self.salt,
            serializer=self.serializer
        )

def create_app():
    logger.info("Initializing Flask application")
    app = Flask(__name__, template_folder="templates")
    
    # Enable CORS with more flexible settings
    CORS(app, resources={
        r"/*": {
            "origins": "*",
            "methods": ["GET", "POST", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"]
        }
    })
    
    # Configuration
    app.config.update(
        SECRET_KEY=os.getenv("FLASK_SECRET_KEY", secrets.token_hex(32)),
        PERMANENT_SESSION_LIFETIME=timedelta(hours=6),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=False,  # Changed for mobile compatibility
        SESSION_COOKIE_SAMESITE='Lax',
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,
        MAX_IMAGE_SIZE=4 * 1024 * 1024,
        SESSION_REFRESH_EACH_REQUEST=False
    )

    app.session_interface = CustomSessionInterface()
    logger.debug("Session interface configured")

    # Initialize OpenAI client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.critical("OPENAI_API_KEY environment variable is not set!")
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    
    client = OpenAI(
        api_key=api_key,
        timeout=30.0,
        max_retries=2
    )
    logger.info("OpenAI client initialized")

    # In-memory storage
    conversation_histories = {}
    uploaded_images_cache = {}
    logger.debug("Memory storage initialized")

    # Session cleanup thread
    def cleanup_sessions():
        logger.info("Starting session cleanup thread")
        while True:
            try:
                now = datetime.now()
                logger.debug("Running cleanup cycle")
                
                # Clean expired conversations
                expired_sessions = [
                    sid for sid, data in conversation_histories.items()
                    if now - data['last_activity'] > timedelta(hours=6)
                ]
                if expired_sessions:
                    logger.info(f"Cleaning up {len(expired_sessions)} expired sessions")
                    for sid in expired_sessions:
                        del conversation_histories[sid]
                
                # Clean expired images
                expired_images = [
                    img_id for img_id, img_data in uploaded_images_cache.items()
                    if now - img_data['upload_time'] > timedelta(hours=6)
                ]
                if expired_images:
                    logger.info(f"Cleaning up {len(expired_images)} expired images")
                    for img_id in expired_images:
                        del uploaded_images_cache[img_id]
                
                time.sleep(3600)
            except Exception as e:
                logger.error(f"Cleanup error: {e}", exc_info=True)

    Thread(target=cleanup_sessions, daemon=True).start()

    def format_response_text(text):
        """Format response text for better readability"""
        if not text:
            logger.debug("Empty text received for formatting")
            return ""
        try:
            text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
            text = re.sub(r'([.,!?])([A-Za-z])', r'\1 \2', text)
            text = re.sub(r'\b([A-Z][a-z]+)([A-Z][a-z]+)', r'\1 \2', text)
            text = re.sub(r'\b(I)(am|can|will|have|do|would)', r'\1 \2', text)
            result = ' '.join(text.split()).strip()
            logger.debug(f"Formatted text: {result[:100]}...")
            return result
        except Exception as e:
            logger.error(f"Text formatting error: {e}", exc_info=True)
            return text

    @app.before_request
    def before_request():
        """Initialize session with minimal data"""
        logger.debug(f"Before request: {request.path}")
        if 'session_id' not in session:
            session_id = secrets.token_hex(16)
            session['session_id'] = session_id
            session['init_time'] = datetime.now().isoformat()
            logger.info(f"New session initialized: {session_id}")

    @app.after_request
    def after_request(response):
        """Add headers for mobile support"""
        response.headers.add('Accept-Encoding', 'gzip')
        response.headers.add('Cache-Control', 'no-cache, no-store, must-revalidate')
        response.headers.add('Pragma', 'no-cache')
        response.headers.add('Expires', '0')
        session.modified = False
        logger.debug(f"After request - status: {response.status_code}")
        return response

    @app.route("/")
    def home():
        """Render main page"""
        logger.info("Home page requested")
        return render_template("index.html")

    @app.route("/upload-image", methods=["POST"])
    def upload_image():
        """Handle image uploads with mobile support"""
        try:
            logger.info("Image upload request received")
            
            if 'session_id' not in session:
                logger.warning("Upload attempt without session")
                return jsonify({"error": "Session not initialized"}), 400

            file = request.files.get('file')
            if not file:
                logger.warning("No file in upload request")
                return jsonify({"error": "No file uploaded"}), 400

            logger.debug(f"Received file: {file.filename}, type: {file.content_type}")
            
            # Supported image types including mobile formats
            allowed_mime_types = [
                'image/jpeg', 'image/png', 'image/gif',
                'image/webp', 'image/heic', 'image/heif'
            ]
            
            if file.content_type.lower() not in allowed_mime_types:
                logger.warning(f"Invalid file type: {file.content_type}")
                return jsonify({"error": "Only image files allowed (JPEG, PNG, GIF, WEBP, HEIC)"}), 400

            file_data = file.read()
            if len(file_data) > app.config['MAX_IMAGE_SIZE']:
                logger.warning(f"Image too large: {len(file_data)} bytes")
                return jsonify({"error": f"Image exceeds {app.config['MAX_IMAGE_SIZE']//(1024*1024)}MB limit"}), 400

            image_id = secrets.token_hex(16)
            uploaded_images_cache[image_id] = {
                'data': base64.b64encode(file_data).decode('utf-8'),
                'content_type': file.content_type,
                'upload_time': datetime.now(),
                'used': False
            }
            logger.info(f"Image uploaded successfully, ID: {image_id}")

            return jsonify({
                "success": True,
                "image_id": image_id,
                "filename": file.filename
            })

        except Exception as e:
            logger.error(f"Upload error: {e}", exc_info=True)
            return jsonify({"error": "File upload failed"}), 500

    @app.route("/chat", methods=["GET"])
    def chat():
        """Handle chat requests with mobile optimization"""
        try:
            user_input = request.args.get("message", "").strip()
            image_id = request.args.get("image_id", None)
            logger.info(f"Chat request - message: '{user_input}', image_id: {image_id}")
            
            # Check for mobile user agent
            user_agent = request.headers.get('User-Agent', '').lower()
            is_mobile = any(x in user_agent for x in ['mobile', 'android', 'iphone'])
            
            if not user_input and not image_id:
                logger.warning("Empty chat request - no message or image")
                return jsonify({"error": "Message or image required"}), 400

            if 'session_id' not in session:
                logger.warning("Chat attempt without session")
                return jsonify({"error": "Session not initialized"}), 400

            session_id = session['session_id']
            logger.debug(f"Session ID: {session_id}")
            
            # Initialize conversation history
            if session_id not in conversation_histories:
                logger.info(f"New conversation history for session: {session_id}")
                conversation_histories[session_id] = {
                    'messages': [{
                        "role": "system", 
                        "content": "You are a helpful AI assistant that can analyze images. Respond concisely in the user's language."
                    }],
                    'last_activity': datetime.now()
                }

            messages = conversation_histories[session_id]['messages'].copy()
            logger.debug(f"Current message history length: {len(messages)}")
            
            # Handle language detection
            try:
                if user_input:
                    lang = detect(user_input)
                    logger.debug(f"Detected language: {lang}")
                else:
                    lang = "en"
                    logger.debug("No text input, defaulting to English")
            except LangDetectException as e:
                logger.warning(f"Language detection error: {e}, defaulting to English")
                lang = "en"
            except Exception as e:
                logger.error(f"Unexpected error in language detection: {e}", exc_info=True)
                lang = "en"

            # Prepare message content
            if image_id and image_id in uploaded_images_cache:
                logger.debug("Processing image with text")
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
                logger.debug("Using GPT-4 with image (non-streaming)")
            else:
                logger.debug("Processing text-only message")
                messages.append({"role": "user", "content": user_input})
                model_name = "gpt-4-turbo"
                stream = True
                logger.debug("Using GPT-4 (streaming)")

            # For mobile devices, limit message history
            if is_mobile:
                messages = messages[-4:]  # Keep only last 4 messages

            # Call OpenAI API
            logger.debug(f"Sending request to {model_name} with {len(messages)} messages")
            if stream:
                def generate():
                    full_response = ""
                    try:
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
                        logger.info(f"Streaming response completed: {formatted_response[:100]}...")

                    except Exception as e:
                        logger.error(f"Streaming error: {e}", exc_info=True)
                        yield f"data: [ERROR: {str(e)}]\n\n"

                return Response(generate(), mimetype="text/event-stream")
            else:
                try:
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        max_tokens=800
                    )
                    logger.debug("Received non-streaming response from OpenAI")

                    full_response = response.choices[0].message.content
                    formatted_response = format_response_text(full_response)
                    
                    conversation_histories[session_id]['messages'].append({
                        "role": "assistant",
                        "content": formatted_response
                    })
                    conversation_histories[session_id]['last_activity'] = datetime.now()
                    logger.info(f"Non-streaming response: {formatted_response[:100]}...")

                    return jsonify({"response": formatted_response})
                
                except Exception as e:
                    logger.error(f"OpenAI API error: {e}", exc_info=True)
                    return jsonify({"error": str(e)}), 500

        except Exception as e:
            logger.error(f"Chat processing error: {e}", exc_info=True)
            return jsonify({"error": str(e)}), 500

    @app.route("/new_chat", methods=["GET"])
    def new_chat():
        """Start a new chat session"""
        logger.info("New chat request")
        if 'session_id' in session:
            session_id = session['session_id']
            if session_id in conversation_histories:
                logger.info(f"Clearing conversation history for session: {session_id}")
                del conversation_histories[session_id]
        session.clear()
        logger.info("Session cleared")
        return jsonify({"status": "success"})

    # Mobile-friendly error handler
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({
            "error": "Not found",
            "message": "The requested resource was not found",
            "mobile_friendly": True
        }), 404

    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({
            "error": "Server error",
            "message": "An internal server error occurred",
            "mobile_friendly": True
        }), 500

    return app

app = create_app()

if __name__ == "__main__":
    logger.info("Starting application in main mode")
    app = create_app()
    app.run(host='0.0.0.0', port=5000, debug=False)