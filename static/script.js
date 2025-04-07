// Global variables
let uploadedImages = [];
let isStreaming = false;
let eventSource = null;
let connectionTimeout;
const MAX_RETRIES = 3;
let retryCount = 0;
let currentLoadingMessage = null;

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendStopBtn = document.getElementById("send-stop-btn");
const imageUpload = document.getElementById("image-upload");
const imagePreviewArea = document.getElementById("image-preview-area");
const scrollButton = document.getElementById("scroll-to-bottom");
const voiceBtn = document.getElementById("voice-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const imageUploadBtn = document.getElementById("image-upload-btn");
const hamburgerMenu = document.querySelector(".hamburger-menu");
const dropdownMenu = document.querySelector(".dropdown-menu");

// Initialize application
function initApp() {
    setupEventListeners();
    toggleScrollButton();
}

// Helper functions
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatResponseText(text) {
    if (!text) return "";
    return text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([.,!?])([A-Za-z])/g, '$1 $2')
        .replace(/\b([A-Z][a-z]+)([A-Z][a-z]+)/g, '$1 $2')
        .replace(/\b(I)(am|can|will|have|do|would)/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

// UI functions
function showLoadingIndicator() {
    if (currentLoadingMessage) {
        currentLoadingMessage.remove();
    }
    currentLoadingMessage = document.createElement("div");
    currentLoadingMessage.className = "message received loading";
    currentLoadingMessage.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(currentLoadingMessage);
    scrollToBottom();
    return currentLoadingMessage;
}

function removeLoadingIndicator() {
    if (currentLoadingMessage) {
        currentLoadingMessage.remove();
        currentLoadingMessage = null;
    }
}

function adjustTextareaHeight() {
    this.style.height = "auto";
    this.style.height = (this.scrollHeight) + "px";
}

function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        toggleSendStop();
    }
}

function toggleScrollButton() {
    if (!chatMessages || !scrollButton) return;
    const showButton = chatMessages.scrollTop + chatMessages.clientHeight < chatMessages.scrollHeight - 100;
    scrollButton.style.display = showButton ? "block" : "none";
}

function scrollToBottom(smooth = true) {
    if (!chatMessages) return;
    chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
    });
    setTimeout(toggleScrollButton, 300);
}

// Message handling
function displayUserMessage(message) {
    if (!chatMessages) return;
    
    const messageDiv = document.createElement("div");
    messageDiv.className = "message sent";
    messageDiv.innerHTML = `<p>${escapeHtml(message)}</p>`;
    
    if (uploadedImages.length > 0) {
        const imagesContainer = document.createElement("div");
        imagesContainer.className = "uploaded-images-container";
        
        uploadedImages.forEach(img => {
            const imgContainer = document.createElement("div");
            imgContainer.className = "uploaded-image-wrapper";
            
            const imgElement = document.createElement("img");
            imgElement.src = img.url || URL.createObjectURL(img.file);
            imgElement.alt = "Uploaded image";
            imgElement.className = "uploaded-image";
            
            imgContainer.appendChild(imgElement);
            imagesContainer.appendChild(imgContainer);
        });
        
        messageDiv.appendChild(imagesContainer);
    }
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

function createBotMessage() {
    if (!chatMessages) return null;
    
    const messageDiv = document.createElement("div");
    messageDiv.className = "message received";
    messageDiv.innerHTML = `
        <div class="message-content">
            <p></p>
        </div>
        <div class="message-actions">
            <button class="copy-btn" title="Copy text">
                <i class="far fa-copy"></i>
            </button>
            <span class="copy-feedback">Copied!</span>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    return messageDiv;
}

function finalizeBotMessage(messageDiv, fullText) {
    if (!messageDiv) return;
    
    const formattedText = formatResponseText(fullText);
    const pElement = messageDiv.querySelector("p");
    if (pElement) pElement.textContent = formattedText;
    
    const copyBtn = messageDiv.querySelector(".copy-btn");
    if (copyBtn) {
        copyBtn.setAttribute("data-text", escapeHtml(formattedText));
        copyBtn.addEventListener('click', copyToClipboard);
    }
    
    scrollToBottom();
}

function copyToClipboard() {
    const text = this.getAttribute('data-text');
    const feedback = this.parentElement.querySelector('.copy-feedback');
    
    navigator.clipboard.writeText(text).then(() => {
        if (feedback) {
            feedback.style.display = 'inline-block';
            setTimeout(() => feedback.style.display = 'none', 2000);
        }
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

// Image handling
function handleImageUpload(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    clearImagePreviews();
    
    Array.from(files).forEach(file => {
        if (!file.type.match('image.*')) {
            showError("Only image files are allowed");
            return;
        }
        
        if (file.size > 4 * 1024 * 1024) {
            showError("Image size should be less than 4MB");
            return;
        }
        
        const imageObj = {
            file: file,
            id: Math.random().toString(36).substring(2),
            url: URL.createObjectURL(file)
        };
        
        uploadedImages.push(imageObj);
        displayImagePreview(imageObj);
    });
    
    e.target.value = "";
}

function displayImagePreview(imageObj) {
    if (!imagePreviewArea) return;

    const previewContainer = document.createElement("div");
    previewContainer.className = "image-preview-container";
    
    const imgPreview = document.createElement("img");
    imgPreview.className = "image-preview";
    imgPreview.src = imageObj.url;
    imgPreview.alt = "Upload preview";
    
    const removeBtn = document.createElement("div");
    removeBtn.className = "remove-image";
    removeBtn.innerHTML = "✕";
    removeBtn.onclick = () => removeImagePreview(imageObj);
    
    previewContainer.appendChild(imgPreview);
    previewContainer.appendChild(removeBtn);
    imagePreviewArea.appendChild(previewContainer);
    imagePreviewArea.style.display = "flex";
}

function removeImagePreview(imageObj) {
    uploadedImages = uploadedImages.filter(img => img.id !== imageObj.id);
    if (imageObj.url) {
        try {
            URL.revokeObjectURL(imageObj.url);
        } catch (e) {
            console.warn("Failed to revoke URL:", e);
        }
    }
    updateImagePreviews();
}

function clearImagePreviews() {
    if (!imagePreviewArea) return;
    
    imagePreviewArea.innerHTML = "";
    imagePreviewArea.style.display = "none";
    
    uploadedImages.forEach(img => {
        if (img.url && typeof img.url === 'string') {
            try {
                URL.revokeObjectURL(img.url);
            } catch (e) {
                console.warn("Failed to revoke URL:", e);
            }
        }
    });
}

function updateImagePreviews() {
    clearImagePreviews();
    uploadedImages.forEach(img => {
        displayImagePreview(img);
    });
}

// API communication
async function sendMessage() {
    if (!userInput) return;
    
    const message = userInput.value.trim();
    if (!message && uploadedImages.length === 0) {
        showError("Please enter a message or upload an image");
        return;
    }

    displayUserMessage(message);
    userInput.value = "";
    userInput.style.height = "auto";
    
    showLoadingIndicator();
    
    try {
        if (uploadedImages.length > 0) {
            await sendImagesWithMessage(message);
        } else {
            await sendTextMessage(message);
        }
        retryCount = 0;
    } catch (error) {
        handleSendError(error);
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            setTimeout(sendMessage, 2000 * retryCount);
        } else {
            resetSendButton();
        }
    } finally {
        removeLoadingIndicator();
    }
}

async function sendImagesWithMessage(message) {
    try {
        const sentImages = [...uploadedImages];
        
        const uploadResults = await Promise.all(
            sentImages.map(img => {
                const formData = new FormData();
                formData.append("file", img.file);
                return fetch("/upload-image", {
                    method: "POST",
                    body: formData
                }).then(res => res.json());
            })
        );

        const imageIds = uploadResults.filter(res => res.success).map(res => res.image_id);
        if (imageIds.length === 0) {
            throw new Error("No images uploaded successfully");
        }

        const response = await fetch(`/chat?message=${encodeURIComponent(message || "Describe this image")}&image_id=${imageIds[0]}`, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Request failed");
        }

        const data = await response.json();
        
        // Clear images after successful upload and response
        clearImagePreviews();
        uploadedImages = [];
        
        displayBotResponse(data.response);
        
        // Reset send button after image processing is complete
        resetSendButton();
        
    } catch (error) {
        console.error("Error:", error);
        throw error;
    }
}

async function sendTextMessage(message) {
    return new Promise((resolve, reject) => {
        abortCurrentRequest();
        
        connectionTimeout = setTimeout(() => {
            abortCurrentRequest();
            reject(new Error("Connection timeout"));
            showError("Request timed out. Please try again.");
        }, 30000);

        eventSource = new EventSource(`/chat?message=${encodeURIComponent(message)}`);
        
        const botMessage = createBotMessage();
        if (!botMessage) {
            reject(new Error("Could not create message container"));
            return;
        }

        let fullText = "";
        let isFinalized = false;
        
        const finalize = (success = true) => {
            if (isFinalized) return;
            isFinalized = true;
            
            clearTimeout(connectionTimeout);
            if (eventSource) eventSource.close();
            
            if (success) {
                finalizeBotMessage(botMessage, fullText);
                resetSendButton();
                resolve();
            }
        };

        eventSource.onmessage = (event) => {
            clearTimeout(connectionTimeout);
            
            if (event.data === "[END]") {
                finalize();
            } 
            else if (event.data === "[ERROR]") {
                finalize(false);
                reject(new Error("Server error"));
                showError("An error occurred during the conversation.");
            }
            else {
                const pElement = botMessage.querySelector("p");
                if (pElement) {
                    fullText += event.data;
                    pElement.textContent = fullText;
                    toggleScrollButton();
                }
            }
        };

        eventSource.onerror = () => {
            finalize(false);
            reject(new Error("Connection failed"));
            showError("Connection error. Please try again.");
        };
    });
}

function displayBotResponse(response) {
    if (!chatMessages) return;

    const botMessage = document.createElement("div");
    botMessage.className = "message received";
    const formattedResponse = formatResponseText(response);
    
    botMessage.innerHTML = `
        <div class="message-content">
            <p>${formattedResponse}</p>
        </div>
        <div class="message-actions">
            <button class="copy-btn" title="Copy text" data-text="${escapeHtml(formattedResponse)}">
                <i class="far fa-copy"></i>
            </button>
            <span class="copy-feedback">Copied!</span>
        </div>
    `;
    
    chatMessages.appendChild(botMessage);
    
    const copyBtn = botMessage.querySelector(".copy-btn");
    if (copyBtn) {
        copyBtn.addEventListener('click', copyToClipboard);
    }
    
    scrollToBottom();
}

// UI state management
function toggleSendStop() {
    if (!sendStopBtn) return;
    
    if (!isStreaming) {
        sendMessage();
        isStreaming = true;
        sendStopBtn.classList.add('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-stop"></i>';
        sendStopBtn.title = "Stop response";
    } else {
        abortCurrentRequest();
    }
}

function abortCurrentRequest() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
    if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
    }
    removeLoadingIndicator();
    resetSendButton();
}

function resetSendButton() {
    isStreaming = false;
    if (sendStopBtn) {
        sendStopBtn.classList.remove('stop-mode');
        sendStopBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        sendStopBtn.title = "Send message";
    }
}

function showError(message) {
    if (!chatMessages) return;
    
    const errorMessage = document.createElement("div");
    errorMessage.className = "message received error";
    errorMessage.innerHTML = `<p>${escapeHtml(message)}</p>`;
    chatMessages.appendChild(errorMessage);
    scrollToBottom();
}

function handleSendError(error) {
    console.error("Send error:", error);
    showError(error.message || "Failed to send message");
}

// Additional features
function startNewChat() {
    fetch('/new_chat')
        .then(response => {
            if (!response.ok) throw new Error('Failed to start new chat');
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                if (chatMessages) chatMessages.innerHTML = '';
                clearImagePreviews();
                uploadedImages = [];
            }
        })
        .catch(error => {
            showError(error.message);
        });
}

// Voice recognition
function startVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window)) {
        showError("Voice recognition not supported in your browser");
        return;
    }

    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'ar-SA';
    recognition.interimResults = false;
    
    if (voiceBtn) {
        voiceBtn.disabled = true;
        voiceBtn.innerHTML = '<i class="fas fa-microphone-slash"></i>';
    }

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (userInput) {
            userInput.value = transcript;
            userInput.dispatchEvent(new Event('input'));
        }
    };

    recognition.onerror = (event) => {
        showError(`Voice recognition error: ${event.error}`);
    };

    recognition.onend = () => {
        if (voiceBtn) {
            voiceBtn.disabled = false;
            voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        }
    };

    recognition.start();
}

// Hamburger menu functionality
function toggleHamburgerMenu() {
    if (dropdownMenu) {
        dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
    }
}

function closeHamburgerMenu() {
    if (dropdownMenu) {
        dropdownMenu.style.display = 'none';
    }
}

// Setup event listeners
function setupEventListeners() {
    if (userInput) {
        userInput.addEventListener("input", adjustTextareaHeight);
        userInput.addEventListener("keydown", handleKeyDown);
    }

    if (sendStopBtn) sendStopBtn.addEventListener("click", toggleSendStop);
    if (imageUpload) imageUpload.addEventListener("change", handleImageUpload);
    if (scrollButton) scrollButton.addEventListener("click", scrollToBottom);
    if (imageUploadBtn) imageUploadBtn.addEventListener("click", () => imageUpload.click());
    if (voiceBtn) voiceBtn.addEventListener("click", startVoiceRecognition);
    if (newChatBtn) newChatBtn.addEventListener("click", startNewChat);
    
    // Hamburger menu events
    if (hamburgerMenu) {
        hamburgerMenu.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleHamburgerMenu();
        });
    }
    
    // Close menu when clicking outside
    document.addEventListener("click", closeHamburgerMenu);
    
    // Prevent menu from closing when clicking inside it
    if (dropdownMenu) {
        dropdownMenu.addEventListener("click", (e) => {
            e.stopPropagation();
        });
    }

    if (chatMessages) {
        chatMessages.addEventListener("scroll", toggleScrollButton);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', initApp);