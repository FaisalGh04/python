from flask import Flask, render_template, request, jsonify, Response, session
from openai import OpenAI
import os
import logging
import secrets
from dotenv import load_dotenv
from langdetect import detect, DetectorFactory, LangDetectException
from datetime import timedelta
import base64

# Load environment variables from .env file
load_dotenv()

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Ensure consistent language detection
DetectorFactory.seed = 0

def create_app():
    app = Flask(__name__, template_folder="templates")
    
    # Set the secret key (generate one if not provided in environment variables)
    app.config['SECRET_KEY'] = os.getenv("FLASK_SECRET_KEY", secrets.token_hex(16))
    # Set session lifetime
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=1)
    logger.debug(f"Secret Key: {app.config['SECRET_KEY']}")

    logger.debug(f"Template folder path: {app.template_folder}")

    # Initialize the OpenAI client using the API key from environment variables
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is not set.")
    client = OpenAI(api_key=api_key)

    # Debug: Print the API key to verify it's loaded correctly
    print("API Key loaded successfully.")

    # Store conversation history in a dictionary (keyed by session ID)
    conversation_histories = {}

    # Function to truncate conversation history (based on message count)
    def truncate_conversation(conversation_history, max_messages=100):
        while len(conversation_history) > max_messages:
            conversation_history.pop(1)  # Remove the oldest user-assistant pair (keep system message)
        return conversation_history

    # Routes
    @app.route("/")
    def home():
        # Generate a new session ID if one doesn't exist
        if 'session_id' not in session:
            session['session_id'] = secrets.token_hex(16)
            session.permanent = True
            logger.debug(f"Created new session ID: {session['session_id']}")
        
        logger.debug("Rendering home page...")
        return render_template("index.html")

    @app.route("/about")
    def about():
        logger.debug("Rendering about page...")
        return render_template("about.html")

    @app.route("/services")
    def services():
        logger.debug("Rendering services page...")
        return render_template("services.html")

    @app.route("/contact")
    def contact():
        logger.debug("Rendering contact page...")
        return render_template("contact.html")

    @app.route("/chat", methods=["GET"])
    def chat_stream():
        user_input = request.args.get("message", "").strip()
        
        # Ensure we have a session ID
        if 'session_id' not in session:
            session['session_id'] = secrets.token_hex(16)
            session.permanent = True
            logger.debug(f"Created new session ID: {session['session_id']}")
        
        session_id = session['session_id']
        logger.debug(f"Using session ID: {session_id}")
        
        # Handle empty messages
        if not user_input:
            logger.debug("Empty message received")
            return jsonify({"response": "Please enter a message."}), 400
            
        # Handle language detection with error handling
        try:
            lang = detect(user_input)
            logger.debug(f"Detected language: {lang}")
        except LangDetectException as e:
            logger.warning(f"Language detection failed: {e}, defaulting to English")
            lang = "en"  # Default to English on detection failure
        except Exception as e:
            logger.warning(f"Unexpected error in language detection: {e}, defaulting to English")
            lang = "en"
            
        logger.debug(f"Received user input: {user_input} (Language: {lang})")

        # Handle exit command
        if user_input.lower() == "exit":
            logger.debug("Exit command received.")
            return jsonify({"response": "Goodbye!"})

        # Check if the input contains words similar to other languages
        if lang not in ["ar", "en"]:
            # If the detected language is not Arabic or English, force English
            lang = "en"
            logger.debug(f"Input contains non-Arabic/English words. Forcing response in English.")

        try:
            # Initialize conversation history for the session if it doesn't exist
            if session_id not in conversation_histories:
                conversation_histories[session_id] = [
                    {"role": "system", "content": "You are a helpful assistant that responds in the same language as the user's input."}
                ]

            # Add user message to conversation history
            conversation_histories[session_id].append({"role": "user", "content": user_input})

            # Truncate conversation history if it exceeds the message limit
            conversation_histories[session_id] = truncate_conversation(conversation_histories[session_id], max_messages=100)

            logger.debug("Sending request to GPT-4 API...")
            response = client.chat.completions.create(
                model="gpt-4",  # Use "gpt-4" or "gpt-4-1106-preview"
                messages=conversation_histories[session_id],
                stream=True  # Enable streaming
            )

            # Stream the response back to the client
            def generate():
                full_response = ""
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        chunk_content = chunk.choices[0].delta.content
                        full_response += chunk_content
                        yield f"data: {chunk_content}\n\n".encode('utf-8')  # Send each chunk individually
                yield "data: [END]\n\n".encode('utf-8')  # Signal the end of the response

                # Add assistant's response to conversation history
                conversation_histories[session_id].append({"role": "assistant", "content": full_response})

            return Response(generate(), mimetype="text/event-stream; charset=utf-8")
        except Exception as e:
            logger.error(f"Error during chat: {e}")
            return jsonify({"response": "An error occurred while processing your request."}), 500

    @app.route("/chat-with-image", methods=["POST"])
    def chat_with_image():
        try:
            # Get uploaded file and text prompt
            uploaded_file = request.files.get('file')
            user_input = request.form.get('prompt', '').strip()
            
            if not uploaded_file:
                return jsonify({"error": "Image file is required"}), 400
            if not user_input:
                return jsonify({"error": "Text prompt is required"}), 400

            # Validate file is an image
            if not uploaded_file.content_type.startswith('image/'):
                return jsonify({"error": "Only image files are allowed"}), 400

            # Ensure we have a session ID
            if 'session_id' not in session:
                session['session_id'] = secrets.token_hex(16)
                session.permanent = True
            
            session_id = session['session_id']
            
            # Initialize conversation history if needed
            if session_id not in conversation_histories:
                conversation_histories[session_id] = [
                    {"role": "system", "content": "You are a helpful assistant that can analyze images and answer questions about them."}
                ]

            # Read the image file
            image_bytes = uploaded_file.read()
            base64_image = base64.b64encode(image_bytes).decode('utf-8')

            # Get GPT-4 vision response
            response = client.chat.completions.create(
                model="gpt-4-vision-preview",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_input},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/{uploaded_file.content_type.split('/')[-1]};base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=1000
            )

            # Add to conversation history
            conversation_histories[session_id].append({
                "role": "user",
                "content": f"{user_input} [Attached image: {uploaded_file.filename}]"
            })
            conversation_histories[session_id].append({
                "role": "assistant",
                "content": response.choices[0].message.content
            })

            return jsonify({
                "response": response.choices[0].message.content
            })

        except Exception as e:
            logger.error(f"Error in image chat: {e}")
            return jsonify({"error": str(e)}), 500

    # Add a route to clear the session/start a new chat
    @app.route("/new_chat", methods=["GET"])
    def new_chat():
        # Generate a new session ID
        session['session_id'] = secrets.token_hex(16)
        session.permanent = True
        logger.debug(f"Created new session ID: {session['session_id']}")
        return jsonify({"status": "success", "message": "New chat session created"})

    return app

# Create the Flask app
app = create_app()

if __name__ == "__main__":
    app = create_app()
    app.run(debug=False)