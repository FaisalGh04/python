// Global variables
let uploadedImages = [];
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

// Function to fix stuck-together words in responses
function formatResponseText(text) {
    if (!text) return "";
    
    text = text.replace(/([a-z])([A-Z])/g, '$1 $2');
    text = text.replace(/([.,!?:;])([A-Za-z])/g, '$1 $2');
    text = text.replace(/(?<=[a-z])(?=[A-Z])/g, ' ');
    text = text.replace(/\b([A-Z][a-z]+)([A-Z][a-z]+)/g, '$1 $2');
    text = text.replace(/\b(I)(am|can|will|have|do|would)/g, '$1 $2');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

// Scroll functionality
function toggleScrollButton() {
    const chatMessages = document.getElementById("chat-messages");
    const scrollButton = document.getElementById("scroll-to-bottom");

    if (chatMessages && scrollButton) {
        if (chatMessages.scrollTop + chatMessages.clientHeight < chatMessages.scrollHeight - 50) {
            scrollButton.style.display = "block";
        } else {
            scrollButton.style.display = "none";
        }
    }
}

function scrollToBottom() {
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
        toggleScrollButton();
    }
}

// Copy button functionality
function addCopyButtonFunctionality() {
    document.querySelectorAll('.copy-btn').forEach(button => {
        button.addEventListener('click', function() {
            const textToCopy = this.getAttribute('data-text');
            const feedback = this.parentElement.querySelector('.copy-feedback');
            
            navigator.clipboard.writeText(textToCopy).then(() => {
                if (feedback) {
                    feedback.style.display = 'inline-block';
                    setTimeout(() => {
                        feedback.style.display = 'none';
                    }, 2000);
                }
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        });
    });
}

// Image handling functions
function handleImageUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (!file.type.match('image.*')) {
            showError("Please select image files only (JPEG, PNG, GIF, etc.)");
            e.target.value = "";
            return;
        }
        
        if (file.size > 10 * 1024 * 1024) {
            showError("Image size should be less than 10MB");
            e.target.value = "";
            return;
        }
        
        uploadedImages.push(file);
        displayImagePreview(file);
    }
    
    e.target.value = "";
}

function displayImagePreview(file) {
    const previewArea = document.getElementById("image-preview-area");
    if (!previewArea) return;

    const previewContainer = document.createElement("div");
    previewContainer.className = "image-preview-container";
    
    const imgPreview = document.createElement("img");
    imgPreview.className = "image-preview";
    imgPreview.src = URL.createObjectURL(file);
    imgPreview.alt = "Uploaded preview";
    
    const removeBtn = document.createElement("div");
    removeBtn.className = "remove-image";
    removeBtn.innerHTML = "✕";
    removeBtn.onclick = function() {
        removeImagePreview(file, previewContainer);
    };
    
    previewContainer.appendChild(imgPreview);
    previewContainer.appendChild(removeBtn);
    previewArea.appendChild(previewContainer);
    previewArea.style.display = "block";
}

function removeImagePreview(file, container) {
    if (!container) return;
    
    container.remove();
    uploadedImages = uploadedImages.filter(f => f !== file);
    
    const previewArea = document.getElementById("image-preview-area");
    if (previewArea && uploadedImages.length === 0) {
        previewArea.style.display = "none";
    }
    
    URL.revokeObjectURL(file);
}

function clearImagePreviews() {
    const previewArea = document.getElementById("image-preview-area");
    if (previewArea) {
        previewArea.innerHTML = "";
        previewArea.style.display = "none";
        uploadedImages.forEach(file => URL.revokeObjectURL(file));
        uploadedImages = [];
    }
}

// Message handling functions
function toggleSendStop() {
    const sendStopBtn = document.getElementById('send-stop-btn');
    if (!sendStopBtn) return;
    
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
    if (!userInput) return;
    
    const message = userInput.value.trim();
    if (!message && uploadedImages.length === 0) return;

    displayUserMessage(message);
    userInput.value = "";
    userInput.style.height = "auto";
    
    try {
        if (uploadedImages.length > 0) {
            await sendImagesWithMessage(message);
        } else {
            await sendTextMessage(message);
        }
    } catch (error) {
        handleSendError(error);
    } finally {
        resetSendButton();
        clearImagePreviews();
    }
}

function displayUserMessage(message) {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return;
    
    const userMessage = document.createElement("div");
    userMessage.className = "message sent";
    
    if (message) {
        userMessage.innerHTML = `<p>${message}</p>`;
    }
    
    if (uploadedImages.length > 0) {
        uploadedImages.forEach(file => {
            const imgElement = document.createElement("img");
            imgElement.src = URL.createObjectURL(file);
            imgElement.alt = "Uploaded image";
            userMessage.appendChild(imgElement);
        });
    }
    
    chatMessages.appendChild(userMessage);
    scrollToBottom();
}

async function sendImagesWithMessage(message) {
    try {
        const uploadPromises = uploadedImages.map(file => {
            const formData = new FormData();
            formData.append("file", file);
            return fetch("/upload-image", {
                method: "POST",
                body: formData
            }).then(res => {
                if (!res.ok) throw new Error('Upload failed');
                return res.json();
            });
        });

        await Promise.all(uploadPromises);

        const response = await fetch(`/chat?message=${encodeURIComponent(message || "What's in this image?")}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (data.error) throw new Error(data.error);
            displayBotResponse(data.response);
        } else {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let botMessage = createBotMessageElement();
            let fullText = "";
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const content = line.substring(6).trim();
                        if (content === '[END]') {
                            finalizeBotMessage(botMessage, fullText);
                            return;
                        }
                        fullText += content;
                        appendToBotMessage(botMessage, content);
                    }
                }
            }
        }
    } catch (error) {
        throw error;
    }
}

function createBotMessageElement() {
    const chatMessages = document.getElementById("chat-messages");
    const botMessage = document.createElement("div");
    botMessage.className = "message received";
    botMessage.innerHTML = `
        <p></p>
        <div class="copy-btn-container">
            <button class="copy-btn" style="display:none" data-text="">
                <i class="far fa-copy"></i>
            </button>
            <span class="copy-feedback">Copied!</span>
        </div>
    `;
    chatMessages.appendChild(botMessage);
    return botMessage;
}

function appendToBotMessage(botMessage, content) {
    const pElement = botMessage.querySelector("p");
    if (pElement) {
        pElement.textContent += content;
        scrollToBottom();
    }
}

function finalizeBotMessage(botMessage, fullText) {
    const pElement = botMessage.querySelector("p");
    if (pElement) {
        const formattedText = formatResponseText(fullText || pElement.textContent);
        pElement.textContent = formattedText;
        
        const copyBtn = botMessage.querySelector(".copy-btn");
        if (copyBtn) {
            copyBtn.style.display = "inline-block";
            copyBtn.setAttribute("data-text", escapeHtml(formattedText));
            addCopyButtonFunctionality();
        }
    }
    scrollToBottom();
}

async function sendTextMessage(message) {
    return new Promise((resolve, reject) => {
        eventSource = new EventSource(`/chat?message=${encodeURIComponent(message)}`);
        const chatMessages = document.getElementById("chat-messages");
        if (!chatMessages) {
            reject(new Error("Chat messages container not found"));
            return;
        }
        
        const botMessage = document.createElement("div");
        botMessage.className = "message received";
        botMessage.innerHTML = `
            <p></p>
            <div class="copy-btn-container">
                <button class="copy-btn" style="display:none" data-text="">
                    <i class="far fa-copy"></i>
                </button>
                <span class="copy-feedback">Copied!</span>
            </div>
        `;
        chatMessages.appendChild(botMessage);
        scrollToBottom();

        let fullText = "";
        eventSource.onmessage = (event) => {
            if (event.data === "[END]") {
                eventSource.close();
                const responseElement = botMessage.querySelector("p");
                const formattedText = formatResponseText(fullText);
                responseElement.textContent = formattedText;
                
                const copyBtn = botMessage.querySelector(".copy-btn");
                if (copyBtn) {
                    copyBtn.style.display = "inline-block";
                    copyBtn.setAttribute("data-text", escapeHtml(formattedText));
                    addCopyButtonFunctionality();
                }
                resolve();
            } else {
                const pElement = botMessage.querySelector("p");
                if (pElement) {
                    fullText += event.data;
                    pElement.textContent = fullText;
                    toggleScrollButton();
                }
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
    if (!chatMessages) return;

    const botMessage = document.createElement("div");
    botMessage.className = "message received";
    const formattedResponse = formatResponseText(response);
    
    botMessage.innerHTML = `
        <p>${formattedResponse}</p>
        <div class="copy-btn-container">
            <button class="copy-btn" data-text="${escapeHtml(formattedResponse)}">
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
    if (!chatMessages) return;

    const errorMessage = document.createElement("div");
    errorMessage.className = "message received error";
    errorMessage.innerHTML = `<p>Error: ${error.message}</p>`;
    chatMessages.appendChild(errorMessage);
    scrollToBottom();
}

function resetSendButton() {
    isStreaming = false;
    const sendStopBtn = document.getElementById('send-stop-btn');
    if (sendStopBtn) {
        sendStopBtn.classList.remove('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
    }
}

function showError(message) {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return;
    
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
        const voiceBtn = document.getElementById("voice-btn");
        if (voiceBtn) voiceBtn.style.backgroundColor = "#ff0000";
    };

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        const userInput = document.getElementById("user-input");
        if (userInput) userInput.value = transcript;
        const voiceBtn = document.getElementById("voice-btn");
        if (voiceBtn) voiceBtn.style.backgroundColor = "#000000";
    };

    recognition.onerror = function(event) {
        console.error("Voice recognition error", event.error);
        const voiceBtn = document.getElementById("voice-btn");
        if (voiceBtn) voiceBtn.style.backgroundColor = "#000000";
    };

    recognition.onend = function() {
        const voiceBtn = document.getElementById("voice-btn");
        if (voiceBtn) voiceBtn.style.backgroundColor = "#000000";
    };

    recognition.start();
}

// Hamburger menu functionality
function setupHamburgerMenu() {
    const hamburgerMenu = document.querySelector('.hamburger-menu');
    const dropdownMenu = document.querySelector('.dropdown-menu');
    
    if (!hamburgerMenu || !dropdownMenu) return;
    
    hamburgerMenu.addEventListener('click', function(e) {
        e.stopPropagation();
        this.classList.toggle('active');
        dropdownMenu.style.display = this.classList.contains('active') ? 'flex' : 'none';
    });
    
    // Close menu when clicking outside
    document.addEventListener('click', function(e) {
        if (!hamburgerMenu.contains(e.target) && !dropdownMenu.contains(e.target)) {
            hamburgerMenu.classList.remove('active');
            dropdownMenu.style.display = 'none';
        }
    });
    
    // Prevent menu from closing when clicking inside it
    dropdownMenu.addEventListener('click', function(e) {
        e.stopPropagation();
    });
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Image upload
    const imageUpload = document.getElementById('image-upload');
    if (imageUpload) {
        imageUpload.addEventListener('change', handleImageUpload);
    }
    
    // Textarea handling
    const userInput = document.getElementById("user-input");
    if (userInput) {
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
    }
    
    // Scroll handling
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
        chatMessages.addEventListener("scroll", toggleScrollButton);
    }
    
    // New chat button
    const newChatBtn = document.getElementById('new-chat-btn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', function() {
            fetch('/new_chat')
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success') {
                        const chatMessages = document.getElementById('chat-messages');
                        if (chatMessages) chatMessages.innerHTML = '';
                        clearImagePreviews();
                    }
                });
        });
    }
    
    // Setup hamburger menu
    setupHamburgerMenu();
    
    // Initialize UI
    toggleScrollButton();
    addCopyButtonFunctionality();
});