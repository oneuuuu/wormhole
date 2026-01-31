/**
 * Side Panel JavaScript - Chat UI logic
 */

import { formatTime, getDisplayUrl, roomIdToUrl } from '../lib/utils.js';
import { t } from '../lib/i18n.js';

// ============================================================================
// DOM Elements
// ============================================================================

const elements = {
    roomUrl: document.getElementById('roomUrl'),
    statusBar: document.getElementById('statusBar'),
    statusText: document.getElementById('statusText'),
    userList: document.getElementById('userList'),
    userCount: document.getElementById('userCount'),
    chatMessages: document.getElementById('chatMessages'),
    emptyState: document.getElementById('emptyState'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    modal: document.getElementById('modal'),
    modalIcon: document.getElementById('modalIcon'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalBtn: document.getElementById('modalBtn')
};

// ============================================================================
// State
// ============================================================================

let currentUser = null;
let users = new Map(); // odId -> user info
let messages = [];
let seenMessageIds = new Set(); // Track seen messages to prevent duplicates
let isConnected = false;
let currentLanguage = 'en';

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    console.log('[SidePanel] Initializing...');

    // Set up message listener FIRST to catch any messages during init
    setupMessageListener();
    setupEventListeners();

    // Get current tab ID
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (!currentTab) {
        showError('No active tab found');
        return;
    }

    // Load language and translate page
    const stored = await chrome.storage.sync.get(['language']);
    currentLanguage = stored.language || 'en';
    translatePage();

    // Notify service worker that side panel is open
    await chrome.runtime.sendMessage({
        type: 'SIDE_PANEL_OPENED',
        tabId: currentTab.id
    });

    // Get current state from offscreen document as the source of truth
    const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    console.log('[SidePanel] Current status:', status);

    if (status?.isConnected) {
        currentUser = status.user;
        elements.roomUrl.textContent = getDisplayUrl(roomIdToUrl(status.roomId));
        updateConnectionStatus(true);

        // Sync user list
        users.clear();
        addUser(currentUser, true);
        if (status.users) {
            status.users.forEach(u => addUser(u));
        }
    } else {
        // Fallback to service worker state to show "Connecting..." if join is in progress
        const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        if (state?.url) {
            elements.roomUrl.textContent = getDisplayUrl(state.url);
        }
    }

    console.log('[SidePanel] Initialized for tab:', currentTab.id);
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
    // Send message on button click
    elements.sendBtn.addEventListener('click', sendMessage);

    // Send message on Enter key
    elements.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Enable/disable send button based on input
    elements.messageInput.addEventListener('input', () => {
        const hasText = elements.messageInput.value.trim().length > 0;
        elements.sendBtn.disabled = !hasText || !isConnected;
    });

    // Settings button
    elements.settingsBtn.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Modal close button
    elements.modalBtn.addEventListener('click', hideModal);

    // Handle page unload
    window.addEventListener('beforeunload', () => {
        chrome.runtime.sendMessage({ type: 'SIDE_PANEL_CLOSED' });
    });
}

let messageListenerSetup = false;
function setupMessageListener() {
    if (messageListenerSetup) {
        console.log('[SidePanel] Message listener already set up, skipping');
        return;
    }
    messageListenerSetup = true;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[SidePanel] Received:', message.type, message);

        switch (message.type) {
            case 'ROOM_JOINED':
                handleRoomJoined(message);
                break;

            case 'ROOM_LEFT':
                handleRoomLeft();
                break;

            case 'ROOM_FULL':
                showModal('🚫', t('roomFull', currentLanguage), t('roomFullMessage', currentLanguage, { count: message.userCount }));
                break;

            case 'USER_JOINED':
                addUser(message.user);
                break;

            case 'USER_LEFT':
                removeUser(message.odId);
                break;

            case 'PEER_CONNECTED':
                // Already connected via ROOM_JOINED, this just adds a peer
                console.log('[SidePanel] Peer connected:', message.peerId);
                break;

            case 'PEER_STATE_CHANGE':
                // Could update individual user status here
                break;

            case 'CHAT_MESSAGE':
                handleChatMessage(message);
                break;

            case 'ERROR':
                showError(message.message);
                break;

            case 'UPDATE_USER':
                handleUserUpdate(message.user);
                break;
        }

        sendResponse({ received: true });
    });
}

// ============================================================================
// Room Handling
// ============================================================================

function handleRoomJoined(data) {
    console.log('[SidePanel] Joined room:', data.roomId);

    // Update room URL
    elements.roomUrl.textContent = getDisplayUrl(roomIdToUrl(data.roomId));
    updateConnectionStatus(true);
    addSystemMessage(`${t('joinedRoom', currentLanguage)}: ${getDisplayUrl(roomIdToUrl(data.roomId))}`);

    // Add self to user list
    if (data.user) {
        currentUser = data.user;
        addUser(currentUser, true);
    }
}

function handleRoomLeft() {
    console.log('[SidePanel] Left room');

    users.clear();
    messages = [];
    seenMessageIds.clear();
    renderUserList();
    renderMessages();
    updateConnectionStatus(false);
}

function handleUserUpdate(updates) {
    if (!updates) return;

    console.log('[SidePanel] Handling user update:', updates.nickname);

    // Merge updates with current state
    const newUser = { ...currentUser, ...updates };

    // Update language if changed
    if (newUser.language && newUser.language !== currentLanguage) {
        currentLanguage = newUser.language;
        translatePage();
    }

    // Update self in user list
    currentUser = newUser;
    if (currentUser && currentUser.odId) {
        addUser(currentUser, true);
    }
}

// ============================================================================
// User Management
// ============================================================================

function addUser(user, isSelf = false) {
    if (!user?.odId) return;

    users.set(user.odId, { ...user, isSelf });
    renderUserList();
}

function removeUser(odId) {
    if (!odId) return;

    // Don't remove self unless explicitly leaving room
    if (currentUser && odId === currentUser.odId) {
        console.log('[SidePanel] Skipping removeUser for self');
        return;
    }

    console.log('[SidePanel] Removing user:', odId);
    if (users.has(odId)) {
        users.delete(odId);
        renderUserList();
    }
}

function renderUserList() {
    elements.userList.innerHTML = '';
    elements.userCount.textContent = users.size;

    // Sort: self first, then alphabetically
    const sortedUsers = Array.from(users.values()).sort((a, b) => {
        if (a.isSelf) return -1;
        if (b.isSelf) return 1;
        const nameA = a.nickname || 'Unknown';
        const nameB = b.nickname || 'Unknown';
        return nameA.localeCompare(nameB);
    });

    for (const user of sortedUsers) {
        const userEl = document.createElement('div');
        userEl.className = `user-item ${user.isSelf ? 'self' : ''}`;
        if (user.email) {
            userEl.title = user.email;
        }
        userEl.innerHTML = `
      <div class="user-avatar">${(user.nickname || 'U').charAt(0).toUpperCase()}</div>
      <span class="user-name">${escapeHtml(user.nickname)}${user.isSelf ? ` (${t('you', currentLanguage)})` : ''}</span>
      <span class="user-status"></span>
    `;
        elements.userList.appendChild(userEl);
    }
}

function translatePage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key, currentLanguage);
    });

    // Update placeholders
    if (elements.messageInput) {
        elements.messageInput.placeholder = t('typeMessage', currentLanguage);
    }
}

// ============================================================================
// Message Handling
// ============================================================================

function handleChatMessage(data) {
    const { message, isSelf } = data;

    console.log('[SidePanel] handleChatMessage called with:', JSON.stringify(data));
    console.log('[SidePanel] message.id =', message?.id, 'seenMessageIds has:', seenMessageIds.size, 'items');

    // Deduplicate messages by ID
    const msgId = message?.id;
    if (msgId && seenMessageIds.has(msgId)) {
        console.log('[SidePanel] SKIPPING duplicate message:', msgId);
        return;
    }

    if (msgId) {
        seenMessageIds.add(msgId);
        console.log('[SidePanel] Added to seen:', msgId);
    } else {
        console.log('[SidePanel] WARNING: Message has no ID, cannot dedupe');
    }

    // Add to messages array
    messages.push({
        ...message,
        isSelf: isSelf || message.from === currentUser?.odId
    });

    // Render and scroll
    renderMessages();
    scrollToBottom();
}

function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text || !isConnected) return;

    chrome.runtime.sendMessage({
        type: 'SEND_MESSAGE',
        message: { text }
    });

    elements.messageInput.value = '';
    elements.sendBtn.disabled = true;
}

function addSystemMessage(text) {
    messages.push({
        id: Date.now().toString(),
        type: 'system',
        text,
        timestamp: Date.now()
    });

    renderMessages();
    scrollToBottom();
}

function renderMessages() {
    // Always clear existing messages first
    const existingMessages = elements.chatMessages.querySelectorAll('.message, .system-message');
    existingMessages.forEach(el => el.remove());

    // Hide/show empty state
    if (messages.length > 0) {
        elements.emptyState.classList.add('hidden');
    } else {
        elements.emptyState.classList.remove('hidden');
        return;
    }

    // Render messages
    for (const msg of messages) {
        if (msg.type === 'system') {
            const el = document.createElement('div');
            el.className = 'system-message';
            el.textContent = msg.text;
            elements.chatMessages.appendChild(el);
        } else {
            const el = document.createElement('div');
            el.className = `message ${msg.isSelf ? 'self' : 'other'}`;
            const displayName = msg.nickname || 'Unknown';
            const displayEmail = msg.email ? ` (${msg.email})` : '';

            el.innerHTML = `
        <div class="message-header" title="${msg.email || ''}">
          <span class="message-sender">${escapeHtml(displayName)}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
        <div class="message-bubble">${escapeHtml(msg.text)}</div>
      `;
            elements.chatMessages.appendChild(el);
        }
    }
}

function scrollToBottom() {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

// ============================================================================
// UI Updates
// ============================================================================

function updateConnectionStatus(connected) {
    isConnected = connected;

    elements.statusBar.className = `status-bar ${connected ? 'status-connected' : 'status-connecting'}`;
    elements.statusText.textContent = connected ? t('connected', currentLanguage) : t('connecting', currentLanguage);

    elements.sendBtn.disabled = !connected || elements.messageInput.value.trim().length === 0;

    if (connected) {
        elements.roomUrl.removeAttribute('data-i18n');
    }
}

function showError(message) {
    showModal('⚠️', t('error', currentLanguage), message);
    updateConnectionStatus(false);
}

function showModal(icon, title, message) {
    elements.modalIcon.textContent = icon;
    elements.modalTitle.textContent = title;
    elements.modalMessage.textContent = message;
    elements.modal.classList.remove('hidden');
}

function hideModal() {
    elements.modal.classList.add('hidden');
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================================
// Start
// ============================================================================

init();
