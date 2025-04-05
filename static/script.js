// Global variables
let uploadedImage = null;
let isStreaming = false;
let eventSource = null;

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Scroll functionality
function toggleScrollButton() {
    const chatMessages = document.getElementById("chat-messages");
    const scrollButton = document.getElementById("scroll-to-bottom");

    if (chatMessages.scrollTop + chatMessages.clientHeight < chatMessages.scrollHeight - 50) {
        scrollButton.style.display = "block";
    } else {
        scrollButton.style.display = "none";
    }
}

function scrollToBottom() {
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.scrollTop = chatMessages.scrollHeight;
    toggleScrollButton();
}

// Copy button functionality
function addCopyButtonFunctionality() {
    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', function() {
            const textToCopy = this.getAttribute('data-text');
            const feedback = this.parentElement.querySelector('.copy-feedback');
            
            navigator.clipboard.writeText(textToCopy).then(() => {
                feedback.style.display = 'inline-block';
                setTimeout(() => {
                    feedback.style.display = 'none';
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        });
    });
}

// Image handling functions
function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.match('image.*')) {
        showError("Please select an image file (JPEG, PNG, GIF, etc.)");
        e.target.value = "";
        return;
    }
    
    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
        showError("Image size should be less than 10MB");
        e.target.value = "";
        return;
    }
    
    uploadedImage = file;
    displayImagePreview(file);
    e.target.value = "";
}

function displayImagePreview(file) {
    removeImagePreview();
    
    const previewContainer = document.createElement("div");
    previewContainer.id = "image-preview-container";
    previewContainer.className = "image-preview-container";
    
    const imgPreview = document.createElement("img");
    imgPreview.className = "image-preview";
    imgPreview.src = URL.createObjectURL(file);
    imgPreview.alt = "Uploaded preview";
    
    const removeBtn = document.createElement("div");
    removeBtn.className = "remove-image";
    removeBtn.innerHTML = "✕";
    removeBtn.onclick = removeImagePreview;
    
    previewContainer.appendChild(imgPreview);
    previewContainer.appendChild(removeBtn);
    
    const chatInput = document.getElementById("chat-input");
    chatInput.insertBefore(previewContainer, document.getElementById("user-input"));
}

function removeImagePreview() {
    const existingPreview = document.getElementById("image-preview-container");
    if (existingPreview) {
        URL.revokeObjectURL(existingPreview.querySelector('img').src);
        existingPreview.remove();
    }
    uploadedImage = null;
    document.getElementById('image-upload').value = "";
}

// Message handling functions
function toggleSendStop() {
    const sendStopBtn = document.getElementById('send-stop-btn');
    
    if (!isStreaming) {
        sendMessage();
        isStreaming = true;
        sendStopBtn.classList.add('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-stop"></i>';
    } else {
        if (eventSource) {
            eventSource.close();
        }
        isStreaming = false;
        sendStopBtn.classList.remove('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    }
}

async function sendMessage() {
    const userInput = document.getElementById("user-input");
    const message = userInput.value.trim();
    
    if (!message && !uploadedImage) return;

    displayUserMessage(message);
    userInput.value = "";
    userInput.style.height = "auto";
    
    try {
        if (uploadedImage) {
            await sendImageWithMessage(message);
        } else {
            await sendTextMessage(message);
        }
    } catch (error) {
        handleSendError(error);
    } finally {
        resetSendButton();
        removeImagePreview();
    }
}

function displayUserMessage(message) {
    const chatMessages = document.getElementById("chat-messages");
    const userMessage = document.createElement("div");
    userMessage.className = "message sent";
    
    if (message) {
        userMessage.innerHTML = `<p>${message}</p>`;
    }
    
    if (uploadedImage) {
        const imgElement = document.createElement("img");
        imgElement.src = URL.createObjectURL(uploadedImage);
        imgElement.alt = "Uploaded image";
        userMessage.appendChild(imgElement);
    }
    
    chatMessages.appendChild(userMessage);
    scrollToBottom();
}

async function sendImageWithMessage(message) {
    const formData = new FormData();
    if (message) formData.append("prompt", message);
    formData.append("file", uploadedImage);
    formData.append("filename", uploadedImage.name);

    const response = await fetch("/chat-with-image", {
        method: "POST",
        body: formData
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error);

    displayBotResponse(data.response);
}

async function sendTextMessage(message) {
    return new Promise((resolve, reject) => {
        eventSource = new EventSource(`/chat?message=${encodeURIComponent(message)}`);
        const chatMessages = document.getElementById("chat-messages");
        
        const botMessage = document.createElement("div");
        botMessage.className = "message received";
        botMessage.innerHTML = `
            <p>AI: </p>
            <div class="copy-btn-container">
                <button class="copy-btn" style="display:none" data-text="">
                    <i class="far fa-copy"></i>
                </button>
                <span class="copy-feedback">Copied!</span>
            </div>
        `;
        chatMessages.appendChild(botMessage);
        scrollToBottom();

        eventSource.onmessage = (event) => {
            if (event.data === "[END]") {
                eventSource.close();
                const fullText = botMessage.querySelector("p").textContent;
                const copyBtn = botMessage.querySelector(".copy-btn");
                copyBtn.style.display = "inline-block";
                copyBtn.setAttribute("data-text", escapeHtml(fullText));
                addCopyButtonFunctionality();
                resolve();
            } else {
                botMessage.querySelector("p").textContent += event.data;
                toggleScrollButton();
            }
        };

        eventSource.onerror = (error) => {
            eventSource.close();
            reject(new Error("Connection failed"));
        };
    });
}

function displayBotResponse(response) {
    const chatMessages = document.getElementById("chat-messages");
    const botMessage = document.createElement("div");
    botMessage.className = "message received";
    botMessage.innerHTML = `
        <p>${response}</p>
        <div class="copy-btn-container">
            <button class="copy-btn" data-text="${escapeHtml(response)}">
                <i class="far fa-copy"></i>
            </button>
            <span class="copy-feedback">Copied!</span>
        </div>
    `;
    chatMessages.appendChild(botMessage);
    scrollToBottom();
    addCopyButtonFunctionality();
}

function handleSendError(error) {
    console.error("Error:", error);
    const chatMessages = document.getElementById("chat-messages");
    const errorMessage = document.createElement("div");
    errorMessage.className = "message received error";
    errorMessage.innerHTML = `<p>Error: ${error.message}</p>`;
    chatMessages.appendChild(errorMessage);
    scrollToBottom();
}

function resetSendButton() {
    isStreaming = false;
    document.getElementById('send-stop-btn').classList.remove('stop-mode');
    document.getElementById('send-stop-btn').innerHTML = '<i class="fas fa-arrow-up"></i>';
}

function showError(message) {
    const chatMessages = document.getElementById("chat-messages");
    const errorMessage = document.createElement("div");
    errorMessage.className = "message received error";
    errorMessage.innerHTML = `<p>${message}</p>`;
    chatMessages.appendChild(errorMessage);
    scrollToBottom();
}

// Voice recognition
function startVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        alert("Your browser doesn't support voice recognition. Please use Chrome or Edge.");
        return;
    }

    const recognition = new webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = function() {
        document.getElementById("voice-btn").style.backgroundColor = "#ff0000";
    };

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        document.getElementById("user-input").value = transcript;
        document.getElementById("voice-btn").style.backgroundColor = "#000000";
    };

    recognition.onerror = function(event) {
        console.error("Voice recognition error", event.error);
        document.getElementById("voice-btn").style.backgroundColor = "#000000";
    };

    recognition.onend = function() {
        document.getElementById("voice-btn").style.backgroundColor = "#000000";
    };

    recognition.start();
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Image upload
    document.getElementById('image-upload').addEventListener('change', handleImageUpload);
    
    // Textarea handling
    const userInput = document.getElementById("user-input");
    userInput.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";
    });
    
    userInput.addEventListener("keypress", function(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            toggleSendStop();
        }
    });
    
    // Scroll handling
    document.getElementById("chat-messages").addEventListener("scroll", toggleScrollButton);
    
    // Hamburger menu
    const hamburgerMenu = document.querySelector('.hamburger-menu');
    if (hamburgerMenu) {
        hamburgerMenu.addEventListener('click', function() {
            this.classList.toggle('active');
        });
        
        document.addEventListener('click', function(event) {
            if (!hamburgerMenu.contains(event.target)) {
                hamburgerMenu.classList.remove('active');
            }
        });
    }
    
    // Initialize UI
    toggleScrollButton();
});