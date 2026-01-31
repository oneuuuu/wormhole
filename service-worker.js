/**
 * Service Worker - Background coordination for Wormhole extension
 * 
 * Responsibilities:
 * - Manage offscreen document lifecycle
 * - Route messages between components
 * - Handle side panel open/close
 * - Track current tab URL
 */

import { urlToRoomId, generateUserId, generateNickname } from './lib/utils.js';

// ============================================================================
// State
// ============================================================================

let currentTabId = null;
let currentUrl = null;
let currentRoomId = null;
let offscreenReady = false;
let sidePanelOpen = false;

// User info
let userInfo = null;

/**
 * Persist state to session storage (MV3)
 */
async function saveSessionState() {
    await chrome.storage.session.set({
        currentTabId,
        currentUrl,
        currentRoomId,
        sidePanelOpen
    });
}

/**
 * Load state from session storage
 */
async function loadSessionState() {
    const session = await chrome.storage.session.get([
        'currentTabId', 'currentUrl', 'currentRoomId', 'sidePanelOpen'
    ]);
    currentTabId = session.currentTabId || null;
    currentUrl = session.currentUrl || null;
    currentRoomId = session.currentRoomId || null;
    sidePanelOpen = !!session.sidePanelOpen;
    console.log('[SW] Session state loaded:', { sidePanelOpen, currentRoomId });
}

// ============================================================================
// Offscreen Document Management
// ============================================================================

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

async function hasOffscreenDocument() {
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    return contexts.length > 0;
}

async function createOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        console.log('[SW] Offscreen document already exists');
        return;
    }

    console.log('[SW] Creating offscreen document');

    await chrome.offscreen.createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ['WEB_RTC'],
        justification: 'WebRTC peer connections for chat'
    });

    offscreenReady = true;
}

async function closeOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        console.log('[SW] Closing offscreen document');
        await chrome.offscreen.closeDocument();
        offscreenReady = false;
    }
}

async function sendToOffscreen(message) {
    if (!await hasOffscreenDocument()) {
        await createOffscreenDocument();
        // Give it a moment to initialize
        await new Promise(r => setTimeout(r, 100));
    }

    return chrome.runtime.sendMessage(message);
}

// ============================================================================
// User Management
// ============================================================================

async function loadUserInfo() {
    const stored = await chrome.storage.sync.get(['odId', 'nickname', 'email']);

    if (!stored.odId) {
        // First time - generate new user
        userInfo = {
            odId: generateUserId(),
            nickname: generateNickname(),
            email: ''
        };
        await chrome.storage.sync.set(userInfo);
        console.log('[SW] Created new user:', userInfo.nickname);
    } else {
        userInfo = stored;
        console.log('[SW] Loaded user:', userInfo.nickname);
    }

    return userInfo;
}

// ============================================================================
// Room Management
// ============================================================================

async function joinRoomForTab(tabId, url) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) {
        console.log('[SW] Ignoring non-web URL');
        return;
    }

    const roomId = urlToRoomId(url);
    if (!roomId) return;

    // Skip if already in this room
    if (roomId === currentRoomId) {
        console.log('[SW] Already in this room');
        return;
    }

    console.log('[SW] Joining room for:', url);

    // Leave current room first if switching
    if (currentRoomId) {
        console.log('[SW] Leaving old room:', currentRoomId);
        await leaveCurrentRoom();
    }

    currentTabId = tabId;
    currentUrl = url;
    currentRoomId = roomId;
    await saveSessionState();

    // Ensure user is loaded
    if (!userInfo) {
        await loadUserInfo();
    }

    // Join via offscreen document
    try {
        await sendToOffscreen({
            type: 'JOIN_ROOM',
            roomId,
            user: userInfo
        });
    } catch (e) {
        console.error('[SW] Error joining room:', e);
    }
}

async function leaveCurrentRoom() {
    if (!currentRoomId) return;

    console.log('[SW] Leaving room');

    try {
        await sendToOffscreen({ type: 'LEAVE_ROOM' });
    } catch (e) {
        console.error('[SW] Error leaving room:', e);
    }

    currentRoomId = null;
    await saveSessionState();
}

// ============================================================================
// Side Panel
// ============================================================================

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    console.log('[SW] Extension icon clicked');
    await chrome.sidePanel.open({ tabId: tab.id });
});

// Allow side panel to be opened by default
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ============================================================================
// Message Handling
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Log non-ping messages
    if (message.type !== 'PING') {
        console.log('[SW] Message:', message.type, 'from:', sender.id ? 'extension' : sender.tab?.id);
    }

    // Messages from content script
    if (sender.tab) {
        handleContentScriptMessage(message, sender.tab.id, sendResponse);
        return true;
    }

    // Messages from offscreen document or side panel
    handleExtensionMessage(message, sendResponse);
    return true;
});

function handleContentScriptMessage(message, tabId, sendResponse) {
    switch (message.type) {
        case 'URL_CHANGED':
            // Only act if side panel is actually open
            chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }).then(contexts => {
                if (contexts.length > 0) {
                    chrome.tabs.get(tabId).then(tab => {
                        if (tab.active) {
                            joinRoomForTab(tabId, message.url);
                        }
                    });
                }
            });
            sendResponse({ received: true });
            break;
    }
}

function handleExtensionMessage(message, sendResponse) {
    switch (message.type) {
        // From side panel
        case 'SIDE_PANEL_OPENED':
            sidePanelOpen = true;
            handleSidePanelOpened(message.tabId).then(() => {
                sendResponse({ success: true, user: userInfo });
            });
            return;

        case 'SIDE_PANEL_CLOSED':
            sidePanelOpen = false;
            leaveCurrentRoom();
            saveSessionState();
            sendResponse({ success: true });
            break;

        case 'SEND_MESSAGE':
            // Don't forward to offscreen - it already receives this directly from side panel
            // via chrome.runtime.sendMessage (broadcasts to all contexts)
            sendResponse({ success: true });
            break;

        case 'GET_STATE':
            sendResponse({
                roomId: currentRoomId,
                url: currentUrl,
                user: userInfo
            });
            break;

        case 'UPDATE_USER':
            updateUserInfo(message.user).then(() => {
                sendResponse({ success: true });
            });
            return;

        // From offscreen - these messages already reach all contexts directly
        // via chrome.runtime.sendMessage, so we just acknowledge them here
        // and do NOT re-broadcast (which would cause duplicates)
        case 'ROOM_JOINED':
        case 'ROOM_LEFT':
        case 'ROOM_FULL':
        case 'USER_JOINED':
        case 'USER_LEFT':
        case 'PEER_CONNECTED':
        case 'PEER_STATE_CHANGE':
        case 'CHAT_MESSAGE':
        case 'ERROR':
            // Don't re-broadcast - offscreen already sends to all contexts
            sendResponse({ received: true });
            break;
    }
}

async function handleSidePanelOpened(tabId) {
    console.log('[SW] Side panel opened for tab:', tabId);

    // Load user if needed
    if (!userInfo) {
        await loadUserInfo();
    }

    // Get current tab URL
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
        await joinRoomForTab(tabId, tab.url);
        // Note: offscreen will send ROOM_JOINED to all contexts including side panel
    }
}

async function updateUserInfo(updates) {
    userInfo = { ...userInfo, ...updates };
    await chrome.storage.sync.set(userInfo);
    console.log('[SW] Updated user:', userInfo.nickname);
}

function broadcastToExtension(message) {
    // This will be received by the side panel
    chrome.runtime.sendMessage(message).catch(() => {
        // Side panel might be closed
    });
}

// ============================================================================
// Tab Events
// ============================================================================

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (!sidePanelOpen) return;

    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && tab.url !== currentUrl) {
        console.log('[SW] Tab changed, switching room');
        await joinRoomForTab(activeInfo.tabId, tab.url);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!sidePanelOpen) return;
    if (tabId !== currentTabId) return;

    if (changeInfo.url && changeInfo.url !== currentUrl) {
        console.log('[SW] URL updated:', changeInfo.url);
        await joinRoomForTab(tabId, changeInfo.url);
    }
});

// ============================================================================
// Lifecycle
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[SW] Extension installed:', details.reason);
    await loadUserInfo();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('[SW] Browser started');
    await loadUserInfo();
    await loadSessionState();
});

// Load state immediately when service worker starts
loadUserInfo();
loadSessionState();

console.log('[SW] Service worker loaded');
