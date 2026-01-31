/**
 * Offscreen Document - Holds WebRTC connections and Firebase signaling
 * 
 * This runs in an offscreen document because:
 * 1. Service workers are ephemeral and can be terminated
 * 2. WebRTC connections need to persist
 * 3. Firebase listeners need to stay active
 */

import { initializeApp } from 'firebase/app';
import {
    getDatabase,
    ref,
    set,
    push,
    onChildAdded,
    onChildRemoved,
    off,
    remove,
    get,
    onDisconnect,
    serverTimestamp
} from 'firebase/database';

import { firebaseConfig, isFirebaseConfigured } from '../firebase-config.js';
import { createMessageId } from '../lib/utils.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_USERS_PER_ROOM = 8;
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];
const RECONNECT_MAX_RETRIES = 5;
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

// ============================================================================
// State
// ============================================================================

let db = null;
let currentRoomId = null;
let currentUser = null;
let userRef = null;
let signalUnsubscribe = null;
let usersUnsubscribe = null;

// Peer connections: peerId -> { pc: RTCPeerConnection, dc: RTCDataChannel, retryCount: number, queue: Promise }
const peers = new Map();

// Users in room: odId -> user info
const roomUsers = new Map();

// ============================================================================
// Firebase Initialization
// ============================================================================

function initFirebase() {
    if (db) return db;

    if (!isFirebaseConfigured()) {
        throw new Error('Firebase not configured');
    }

    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
    return db;
}

// ============================================================================
// Room Management
// ============================================================================

async function checkRoomCapacity(roomId) {
    const usersRef = ref(db, `rooms/${roomId}/users`);
    const snapshot = await get(usersRef);
    const userCount = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
    return { canJoin: userCount < MAX_USERS_PER_ROOM, userCount };
}

async function joinRoom(roomId, user) {
    try {
        initFirebase();

        // Check capacity
        const { canJoin, userCount } = await checkRoomCapacity(roomId);
        if (!canJoin) {
            sendToServiceWorker({
                type: 'ROOM_FULL',
                userCount: MAX_USERS_PER_ROOM
            });
            return false;
        }

        // Leave current room first
        if (currentRoomId) {
            await leaveRoom();
        }

        currentRoomId = roomId;
        currentUser = user;

        // Add user to room
        userRef = ref(db, `rooms/${roomId}/users/${user.odId}`);
        await set(userRef, {
            odId: user.odId,
            nickname: user.nickname,
            email: user.email || '',
            timestamp: serverTimestamp()
        });

        // Set up disconnect cleanup
        onDisconnect(userRef).remove();

        // Listen for other users
        listenForUsers(roomId);

        // Listen for signaling messages
        listenForSignals(roomId);

        console.log(`[Offscreen] Joined room ${roomId} as ${user.nickname}`);

        sendToServiceWorker({
            type: 'ROOM_JOINED',
            roomId,
            user
        });

        return true;

    } catch (error) {
        console.error('[Offscreen] Error joining room:', error);
        sendToServiceWorker({
            type: 'ERROR',
            message: error.message
        });
        return false;
    }
}

async function leaveRoom() {
    if (!currentRoomId) return;

    console.log(`[Offscreen] Leaving room ${currentRoomId}`);

    // Close all peer connections
    for (const [peerId, peerData] of peers) {
        closePeerConnection(peerId);
    }
    peers.clear();
    roomUsers.clear();

    // Remove user from Firebase
    if (userRef) {
        try {
            await remove(userRef);
        } catch (e) {
            console.error('[Offscreen] Error removing user:', e);
        }
        userRef = null;
    }

    // Clean up listeners
    if (signalUnsubscribe) {
        signalUnsubscribe();
        signalUnsubscribe = null;
    }
    if (usersUnsubscribe) {
        usersUnsubscribe();
        usersUnsubscribe = null;
    }

    currentRoomId = null;

    sendToServiceWorker({ type: 'ROOM_LEFT' });
}

function listenForUsers(roomId) {
    const usersRef = ref(db, `rooms/${roomId}/users`);

    // Handle user join
    const onJoin = onChildAdded(usersRef, (snapshot) => {
        const userData = snapshot.val();
        const odId = snapshot.key;

        // Skip self
        if (odId === currentUser.odId) return;

        console.log(`[Offscreen] User joined: ${userData.nickname}`);

        roomUsers.set(odId, userData);

        // Notify service worker
        sendToServiceWorker({
            type: 'USER_JOINED',
            user: { odId, ...userData }
        });

        // Create peer connection
        createPeerConnection(odId);
    });

    // Handle user leave
    const onLeave = onChildRemoved(usersRef, (snapshot) => {
        const odId = snapshot.key;

        // Skip self (though we shouldn't get this if we unsub correctly)
        if (odId === currentUser?.odId) return;

        const userData = roomUsers.get(odId);
        console.log(`[Offscreen] User left: ${userData?.nickname || odId}`);

        roomUsers.delete(odId);
        closePeerConnection(odId);

        sendToServiceWorker({
            type: 'USER_LEFT',
            odId
        });
    });

    usersUnsubscribe = () => {
        off(usersRef, 'child_added', onJoin);
        off(usersRef, 'child_removed', onLeave);
    };
}

function listenForSignals(roomId) {
    const signalsRef = ref(db, `rooms/${roomId}/signals`);

    const onSignal = onChildAdded(signalsRef, async (snapshot) => {
        const signal = snapshot.val();
        const signalId = snapshot.key;

        // Only process signals for us
        if (signal.to !== currentUser.odId) return;

        console.log(`[Offscreen] Signal received: ${signal.type} from ${signal.from}`);

        // Get or create queue for this peer to ensure sequential processing
        let peerData = peers.get(signal.from);
        if (!peerData && signal.type === 'offer') {
            // We'll create the basic structure so we have a queue
            peerData = { pc: null, dc: null, retryCount: 0, queue: Promise.resolve() };
            peers.set(signal.from, peerData);
        }

        if (peerData) {
            // Queue the signal handling
            peerData.queue = peerData.queue.then(() => handleSignal(signal)).catch(err => {
                console.error(`[Offscreen] Signal queue error for ${signal.from}:`, err);
            });
        } else {
            console.warn(`[Offscreen] Ignoring signal ${signal.type} from unknown peer ${signal.from}`);
        }

        // Clean up processed signal
        remove(ref(db, `rooms/${roomId}/signals/${signalId}`));
    });

    signalUnsubscribe = () => {
        off(signalsRef, 'child_added', onSignal);
    };
}

async function sendSignal(toUserId, type, data) {
    if (!currentRoomId || !currentUser) return;

    const signalsRef = ref(db, `rooms/${currentRoomId}/signals`);
    await push(signalsRef, {
        from: currentUser.odId,
        to: toUserId,
        type,
        data,
        timestamp: serverTimestamp()
    });
}

// ============================================================================
// WebRTC Management
// ============================================================================

async function createPeerConnection(peerId) {
    if (peers.has(peerId)) {
        console.log(`[Offscreen] Already connected to ${peerId}`);
        return;
    }

    // Determine initiator by ID comparison
    const isInitiator = currentUser.odId > peerId;

    console.log(`[Offscreen] Creating connection to ${peerId} (initiator: ${isInitiator})`);

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peerData = { pc, dc: null, retryCount: 0, isInitiator, queue: Promise.resolve() };
    peers.set(peerId, peerData);

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(peerId, 'ice-candidate', {
                candidate: event.candidate.toJSON()
            });
        }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
        console.log(`[Offscreen] Connection to ${peerId}: ${pc.connectionState}`);

        sendToServiceWorker({
            type: 'PEER_STATE_CHANGE',
            peerId,
            state: pc.connectionState
        });

        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            handlePeerDisconnect(peerId);
        }
    };

    // Handle incoming data channel
    pc.ondatachannel = (event) => {
        setupDataChannel(peerId, event.channel);
    };

    // If initiator, create data channel and offer
    if (isInitiator) {
        const dc = pc.createDataChannel('chat', { ordered: true });
        setupDataChannel(peerId, dc);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        sendSignal(peerId, 'offer', {
            sdp: pc.localDescription.toJSON()
        });
    }
}

function setupDataChannel(peerId, channel) {
    const peerData = peers.get(peerId);
    if (!peerData) return;

    peerData.dc = channel;

    channel.onopen = () => {
        console.log(`[Offscreen] Data channel to ${peerId} opened`);
        peerData.retryCount = 0;

        sendToServiceWorker({
            type: 'PEER_CONNECTED',
            peerId
        });
    };

    channel.onclose = () => {
        console.log(`[Offscreen] Data channel to ${peerId} closed`);
    };

    channel.onerror = (event) => {
        const error = event.error;
        // Ignore "User-Initiated Abort" as it happens during intentional close
        if (error?.message === "User-Initiated Abort, reason=Close called") return;

        console.error(`[Offscreen] Data channel error with ${peerId}:`, {
            message: error?.message || 'Unknown error',
            errorDetail: error?.errorDetail,
            sctpCauseCode: error?.sctpCauseCode,
            receivedAlert: error?.receivedAlert,
            sentAlert: error?.sentAlert
        });
    };

    channel.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            handlePeerMessage(peerId, message);
        } catch (e) {
            console.error('[Offscreen] Error parsing message:', e);
        }
    };
}

async function handleSignal(signal) {
    const { from, type, data } = signal;

    let peerData = peers.get(from);

    // If offer from unknown peer or PC not initialized, create connection
    if ((!peerData || !peerData.pc) && type === 'offer') {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        peerData = { pc, dc: null, retryCount: 0, isInitiator: false, queue: Promise.resolve() };
        peers.set(from, peerData);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(from, 'ice-candidate', {
                    candidate: event.candidate.toJSON()
                });
            }
        };

        pc.onconnectionstatechange = () => {
            sendToServiceWorker({
                type: 'PEER_STATE_CHANGE',
                peerId: from,
                state: pc.connectionState
            });

            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                handlePeerDisconnect(from);
            }
        };

        pc.ondatachannel = (event) => {
            setupDataChannel(from, event.channel);
        };
    }

    if (!peerData) {
        console.warn(`[Offscreen] No peer for signal from ${from}`);
        return;
    }

    const { pc } = peerData;

    try {
        switch (type) {
            case 'offer':
                const polite = currentUser.odId < from;
                const offerCollision = pc.signalingState !== 'stable' && pc.signalingState === 'have-local-offer';

                if (offerCollision) {
                    if (!polite) {
                        console.log(`[Offscreen] Ignoring offer collision from ${from} (I am impolite)`);
                        return;
                    }
                    console.log(`[Offscreen] Rolling back for offer collision from ${from} (I am polite)`);
                    await Promise.all([
                        pc.setLocalDescription({ type: 'rollback' }),
                        pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
                    ]);
                } else {
                    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendSignal(from, 'answer', { sdp: pc.localDescription.toJSON() });
                break;

            case 'answer':
                if (pc.signalingState !== 'have-local-offer') {
                    console.log(`[Offscreen] Ignoring answer from ${from}, state is ${pc.signalingState}`);
                    return;
                }
                await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                break;

            case 'ice-candidate':
                try {
                    if (data.candidate && pc.remoteDescription) {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    }
                } catch (e) {
                    console.warn(`[Offscreen] Error adding ICE candidate from ${from}:`, e.message);
                }
                break;
        }
    } catch (error) {
        console.error(`[Offscreen] Error handling ${type} signal from ${from}:`, {
            name: error.name,
            message: error.message,
            state: pc.signalingState,
            error
        });
    }
}

async function handlePeerDisconnect(peerId) {
    const peerData = peers.get(peerId);
    if (!peerData) return;

    if (peerData.retryCount >= RECONNECT_MAX_RETRIES) {
        console.log(`[Offscreen] Max retries for ${peerId}`);
        closePeerConnection(peerId);
        return;
    }

    const delay = Math.min(
        RECONNECT_BASE_DELAY * Math.pow(2, peerData.retryCount),
        RECONNECT_MAX_DELAY
    );

    console.log(`[Offscreen] Reconnecting to ${peerId} in ${delay}ms`);
    peerData.retryCount++;

    setTimeout(() => {
        if (peers.has(peerId) && roomUsers.has(peerId)) {
            closePeerConnection(peerId);
            createPeerConnection(peerId);
        }
    }, delay);
}

function closePeerConnection(peerId) {
    const peerData = peers.get(peerId);
    if (!peerData) return;

    if (peerData.dc) {
        peerData.dc.close();
    }
    if (peerData.pc) {
        peerData.pc.close();
    }

    peers.delete(peerId);
}

function handlePeerMessage(fromPeerId, message) {
    // Forward to service worker -> side panel
    sendToServiceWorker({
        type: 'CHAT_MESSAGE',
        from: fromPeerId,
        message
    });
}

function broadcastMessage(message) {
    const fullMessage = {
        id: createMessageId(),
        from: currentUser.odId,
        nickname: currentUser.nickname,
        text: message.text,
        timestamp: Date.now()
    };

    let sentCount = 0;

    for (const [peerId, peerData] of peers) {
        if (peerData.dc && peerData.dc.readyState === 'open') {
            peerData.dc.send(JSON.stringify(fullMessage));
            sentCount++;
        }
    }

    console.log(`[Offscreen] Broadcast to ${sentCount} peers`);

    // Echo back to side panel
    sendToServiceWorker({
        type: 'CHAT_MESSAGE',
        from: currentUser.odId,
        message: fullMessage,
        isSelf: true
    });
}

// ============================================================================
// Message Handling
// ============================================================================

function sendToServiceWorker(message) {
    chrome.runtime.sendMessage(message).catch(e => {
        // Service worker might be inactive
        console.log('[Offscreen] Could not send to service worker:', e.message);
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Offscreen] Received:', message.type);

    switch (message.type) {
        case 'JOIN_ROOM':
            joinRoom(message.roomId, message.user).then(success => {
                sendResponse({ success });
            });
            return true; // Async response

        case 'LEAVE_ROOM':
            leaveRoom().then(() => {
                sendResponse({ success: true });
            });
            return true;

        case 'SEND_MESSAGE':
            broadcastMessage(message.message);
            sendResponse({ success: true });
            break;

        case 'GET_STATUS':
            const userList = Array.from(roomUsers.entries()).map(([odId, data]) => ({
                odId,
                ...data,
                state: peers.get(odId)?.pc?.connectionState || 'new'
            }));

            sendResponse({
                roomId: currentRoomId,
                user: currentUser,
                users: userList,
                isConnected: !!currentRoomId
            });
            break;

        case 'PING':
            sendResponse({ pong: true });
            break;
    }
});

console.log('[Offscreen] Document ready');
