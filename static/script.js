let mediaRecorder;
let audioChunks = [];
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

// Toggle between send and stop modes
function toggleSendStop() {
    const sendStopBtn = document.getElementById('send-stop-btn');
    
    if (!isStreaming) {
        // Send message mode
        sendMessage();
        isStreaming = true;
        sendStopBtn.classList.add('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-stop"></i>';
    } else {
        // Stop chat mode
        if (eventSource) {
            eventSource.close();
        }
        isStreaming = false;
        sendStopBtn.classList.remove('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        
        // Remove loading message if exists
        const loadingMessages = document.querySelectorAll('.message.received');
        loadingMessages.forEach(msg => {
            if (msg.textContent.includes('Thinking...')) {
                msg.remove();
            }
        });
    }
}

// Add copy button functionality
function addCopyButtonFunctionality() {
    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', function() {
            const textToCopy = this.getAttribute('data-text');
            const feedback = this.parentElement.querySelector('.copy-feedback');
            
            navigator.clipboard.writeText(textToCopy).then(() => {
                // Show feedback
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

// Hamburger menu functionality
document.addEventListener('DOMContentLoaded', function() {
    const hamburgerMenu = document.querySelector('.hamburger-menu');
    
    hamburgerMenu.addEventListener('click', function() {
        this.classList.toggle('active');
    });
    
    document.addEventListener('click', function(event) {
        if (!hamburgerMenu.contains(event.target)) {
            hamburgerMenu.classList.remove('active');
        }
    });
});

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

document.getElementById("chat-messages").addEventListener("scroll", toggleScrollButton);

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

// Image upload handling
document.getElementById('image-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) {
        showError("Image size should be less than 10MB");
        return;
    }
    
    uploadedImage = file;
    
    const previewContainer = document.createElement("div");
    previewContainer.id = "image-preview-container";
    previewContainer.className = "image-preview-container";
    
    const imgPreview = document.createElement("img");
    imgPreview.className = "image-preview";
    imgPreview.src = URL.createObjectURL(file);
    
    const removeBtn = document.createElement("div");
    removeBtn.className = "remove-image";
    removeBtn.innerHTML = "✕";
    removeBtn.onclick = function() {
        removeImagePreview();
    };
    
    previewContainer.appendChild(imgPreview);
    previewContainer.appendChild(removeBtn);
    
    const chatInput = document.getElementById("chat-input");
    removeImagePreview();
    chatInput.appendChild(previewContainer);
    e.target.value = "";
});

function removeImagePreview() {
    const existingPreview = document.getElementById("image-preview-container");
    if (existingPreview) {
        existingPreview.remove();
    }
    uploadedImage = null;
}

function showError(message) {
    const chatMessages = document.getElementById("chat-messages");
    const errorMessage = document.createElement("div");
    errorMessage.className = "message received error";
    errorMessage.innerHTML = `<p>${message}</p>`;
    chatMessages.appendChild(errorMessage);
    scrollToBottom();
}

// Text message handling
function sendMessage() {
    const userInput = document.getElementById("user-input");
    const message = userInput.value.trim();
    const chatMessages = document.getElementById("chat-messages");
    
    if (message === "" && !uploadedImage) return;

    const textToSend = message;
    userInput.value = "";
    userInput.style.height = "auto";

    const userMessage = document.createElement("div");
    userMessage.className = "message sent";
    
    if (textToSend) {
        userMessage.innerHTML = `<p>${textToSend}</p>`;
    }
    
    if (uploadedImage) {
        const imgElement = document.createElement("img");
        imgElement.src = URL.createObjectURL(uploadedImage);
        userMessage.appendChild(imgElement);
    }
    
    chatMessages.appendChild(userMessage);
    scrollToBottom();

    const formData = new FormData();
    formData.append("prompt", textToSend || "");
    
    if (uploadedImage) {
        formData.append("file", uploadedImage);
    }

    const loadingMessage = document.createElement("div");
    loadingMessage.className = "message received";
    loadingMessage.innerHTML = "<p>Thinking...</p>";
    chatMessages.appendChild(loadingMessage);
    scrollToBottom();

    const endpoint = uploadedImage ? "/analyze-image" : "/chat";

    if (uploadedImage) {
        fetch(endpoint, {
            method: "POST",
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            chatMessages.removeChild(loadingMessage);
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            const botMessage = document.createElement("div");
            botMessage.className = "message received";
            botMessage.innerHTML = `
                <p>${data.analysis}</p>
                <div class="copy-btn-container">
                    <button class="copy-btn" data-text="${escapeHtml(data.analysis)}">
                        <i class="far fa-copy"></i>
                    </button>
                    <span class="copy-feedback">Copied!</span>
                </div>
            `;
            chatMessages.appendChild(botMessage);
            scrollToBottom();
            addCopyButtonFunctionality();
            
            // Reset send/stop button
            isStreaming = false;
            document.getElementById('send-stop-btn').classList.remove('stop-mode');
            document.getElementById('send-stop-btn').innerHTML = '<i class="fas fa-arrow-up"></i>';
        })
        .catch(error => {
            console.error("Error:", error);
            chatMessages.removeChild(loadingMessage);
            
            const errorMessage = document.createElement("div");
            errorMessage.className = "message received error";
            errorMessage.innerHTML = `<p>Error: ${error.message}</p>`;
            chatMessages.appendChild(errorMessage);
            scrollToBottom();
            
            // Reset send/stop button
            isStreaming = false;
            document.getElementById('send-stop-btn').classList.remove('stop-mode');
            document.getElementById('send-stop-btn').innerHTML = '<i class="fas fa-arrow-up"></i>';
        })
        .finally(() => {
            removeImagePreview();
        });
    } else {
        eventSource = new EventSource(`/chat?message=${encodeURIComponent(textToSend)}`);

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
                chatMessages.removeChild(loadingMessage);
                
                const fullText = botMessage.querySelector("p").textContent;
                const copyBtn = botMessage.querySelector(".copy-btn");
                copyBtn.style.display = "inline-block";
                copyBtn.setAttribute("data-text", escapeHtml(fullText));
                addCopyButtonFunctionality();
                
                // Reset send/stop button
                isStreaming = false;
                document.getElementById('send-stop-btn').classList.remove('stop-mode');
                document.getElementById('send-stop-btn').innerHTML = '<i class="fas fa-arrow-up"></i>';
            } else {
                const textSpan = botMessage.querySelector("p");
                textSpan.textContent += event.data;
                toggleScrollButton();
            }
        };

        eventSource.onerror = (error) => {
            console.error("EventSource failed:", error);
            eventSource.close();
            chatMessages.removeChild(loadingMessage);
            
            const errorMessage = document.createElement("div");
            errorMessage.className = "message received error";
            errorMessage.innerHTML = `<p>Error: Connection failed</p>`;
            chatMessages.appendChild(errorMessage);
            scrollToBottom();
            
            // Reset send/stop button
            isStreaming = false;
            document.getElementById('send-stop-btn').classList.remove('stop-mode');
            document.getElementById('send-stop-btn').innerHTML = '<i class="fas fa-arrow-up"></i>';
        };
    }
}

// Textarea auto-resize
document.getElementById("user-input").addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = (this.scrollHeight) + "px";
});

document.getElementById("user-input").addEventListener("keypress", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        toggleSendStop();
    }
});

// Initial call to hide the scroll button
toggleScrollButton();