/**
 * WebRTC Manager - Handles peer connections and data channels
 */

import { sendSignal } from './room-manager.js';
import { sleep } from './utils.js';

// ICE servers for NAT traversal
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
];

// Reconnection settings
const RECONNECT_MAX_RETRIES = 5;
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

class PeerConnection {
    constructor(peerId, roomId, isInitiator, onMessage, onStateChange) {
        this.peerId = peerId;
        this.roomId = roomId;
        this.isInitiator = isInitiator;
        this.onMessage = onMessage;
        this.onStateChange = onStateChange;
        this.pc = null;
        this.dataChannel = null;
        this.retryCount = 0;
        this.isConnecting = false;
        this.isClosed = false;
    }

    /**
     * Create the RTCPeerConnection
     */
    async create() {
        if (this.isClosed) return;

        this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        // Handle ICE candidates
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignal(this.roomId, this.peerId, 'ice-candidate', {
                    candidate: event.candidate.toJSON()
                });
            }
        };

        // Monitor connection state
        this.pc.onconnectionstatechange = () => {
            console.log(`Connection to ${this.peerId}: ${this.pc.connectionState}`);
            this.onStateChange(this.peerId, this.pc.connectionState);

            if (this.pc.connectionState === 'failed' ||
                this.pc.connectionState === 'disconnected') {
                this.handleDisconnect();
            }
        };

        // Handle incoming data channel (for non-initiators)
        this.pc.ondatachannel = (event) => {
            this.setupDataChannel(event.channel);
        };

        // If initiator, create data channel and send offer
        if (this.isInitiator) {
            this.dataChannel = this.pc.createDataChannel('chat', {
                ordered: true
            });
            this.setupDataChannel(this.dataChannel);
            await this.createAndSendOffer();
        }
    }

    /**
     * Set up the data channel
     */
    setupDataChannel(channel) {
        this.dataChannel = channel;

        channel.onopen = () => {
            console.log(`Data channel to ${this.peerId} opened`);
            this.retryCount = 0; // Reset retry count on successful connection
            this.onStateChange(this.peerId, 'connected');
        };

        channel.onclose = () => {
            console.log(`Data channel to ${this.peerId} closed`);
            this.onStateChange(this.peerId, 'disconnected');
        };

        channel.onerror = (error) => {
            console.error(`Data channel error with ${this.peerId}:`, error);
        };

        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.onMessage(this.peerId, message);
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        };
    }

    /**
     * Create and send an offer
     */
    async createAndSendOffer() {
        try {
            this.isConnecting = true;
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);

            sendSignal(this.roomId, this.peerId, 'offer', {
                sdp: this.pc.localDescription.toJSON()
            });
        } catch (error) {
            console.error('Error creating offer:', error);
            this.isConnecting = false;
        }
    }

    /**
     * Handle incoming offer
     */
    async handleOffer(sdp, initiatorId) {
        try {
            const polite = this.peerId > initiatorId; // In this lib, we'll use simple ID comparison
            const offerCollision = this.pc.signalingState !== "stable" && this.pc.signalingState === "have-local-offer";

            if (offerCollision) {
                if (!polite) return; // Ignore if impolite
                await this.pc.setLocalDescription({ type: "rollback" });
            }

            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            const answer = await pc.createAnswer();
            await this.pc.setLocalDescription(answer);

            sendSignal(this.roomId, this.peerId, 'answer', {
                sdp: this.pc.localDescription.toJSON()
            });
        } catch (error) {
            console.error('Error handling offer:', error);
            this.isConnecting = false;
        }
    }

    /**
     * Handle incoming answer
     */
    async handleAnswer(sdp) {
        try {
            await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            this.isConnecting = false;
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    /**
     * Handle incoming ICE candidate
     */
    async handleIceCandidate(candidate) {
        try {
            if (this.pc.remoteDescription) {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    /**
     * Handle disconnection with auto-reconnect
     */
    async handleDisconnect() {
        if (this.isClosed || this.isConnecting) return;

        if (this.retryCount >= RECONNECT_MAX_RETRIES) {
            console.log(`Max retries reached for ${this.peerId}`);
            this.onStateChange(this.peerId, 'failed');
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY * Math.pow(2, this.retryCount),
            RECONNECT_MAX_DELAY
        );

        console.log(`Reconnecting to ${this.peerId} in ${delay}ms (attempt ${this.retryCount + 1})`);
        this.retryCount++;

        await sleep(delay);

        if (!this.isClosed) {
            this.close();
            await this.create();
        }
    }

    /**
     * Send a message through the data channel
     */
    send(message) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    /**
     * Check if the connection is open
     */
    isOpen() {
        return this.dataChannel && this.dataChannel.readyState === 'open';
    }

    /**
     * Close the connection
     */
    close() {
        this.isClosed = true;

        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }

        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
    }
}

/**
 * WebRTC Manager - Manages all peer connections
 */
export class WebRTCManager {
    constructor() {
        this.peers = new Map(); // peerId -> PeerConnection
        this.roomId = null;
        this.userId = null;
        this.onMessage = null;
        this.onPeerStateChange = null;
    }

    /**
     * Initialize the manager
     */
    init(roomId, userId, onMessage, onPeerStateChange) {
        this.roomId = roomId;
        this.userId = userId;
        this.onMessage = onMessage;
        this.onPeerStateChange = onPeerStateChange;
    }

    /**
     * Create a new peer connection (as initiator)
     */
    async createConnection(peerId) {
        if (this.peers.has(peerId)) {
            console.log(`Already have connection to ${peerId}`);
            return;
        }

        // Determine who initiates based on ID comparison (higher ID initiates)
        const isInitiator = this.userId > peerId;

        console.log(`Creating connection to ${peerId} (initiator: ${isInitiator})`);

        const peer = new PeerConnection(
            peerId,
            this.roomId,
            isInitiator,
            (fromId, message) => this.onMessage?.(fromId, message),
            (id, state) => this.onPeerStateChange?.(id, state)
        );

        this.peers.set(peerId, peer);
        await peer.create();
    }

    /**
     * Handle incoming signaling message
     */
    async handleSignal(signal) {
        const { from, type, data } = signal;

        let peer = this.peers.get(from);

        // If we receive an offer but don't have a connection, create one
        if (!peer && type === 'offer') {
            peer = new PeerConnection(
                from,
                this.roomId,
                false, // Not initiator since we're receiving offer
                (fromId, message) => this.onMessage?.(fromId, message),
                (peerId, state) => this.onPeerStateChange?.(peerId, state)
            );
            this.peers.set(from, peer);
            await peer.create();
        }

        if (!peer) {
            console.warn(`No peer connection for signal from ${from}`);
            return;
        }

        switch (type) {
            case 'offer':
                await peer.handleOffer(data.sdp, from);
                break;
            case 'answer':
                await peer.handleAnswer(data.sdp);
                break;
            case 'ice-candidate':
                await peer.handleIceCandidate(data.candidate);
                break;
            default:
                console.warn(`Unknown signal type: ${type}`);
        }
    }

    /**
     * Send a message to all connected peers
     */
    broadcast(message) {
        const results = [];
        for (const [peerId, peer] of this.peers) {
            const sent = peer.send(message);
            results.push({ peerId, sent });
        }
        return results;
    }

    /**
     * Send a message to a specific peer
     */
    sendTo(peerId, message) {
        const peer = this.peers.get(peerId);
        if (peer) {
            return peer.send(message);
        }
        return false;
    }

    /**
     * Remove a peer connection
     */
    removePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.close();
            this.peers.delete(peerId);
        }
    }

    /**
     * Get all connected peer IDs
     */
    getConnectedPeers() {
        const connected = [];
        for (const [peerId, peer] of this.peers) {
            if (peer.isOpen()) {
                connected.push(peerId);
            }
        }
        return connected;
    }

    /**
     * Close all connections
     */
    closeAll() {
        for (const [peerId, peer] of this.peers) {
            peer.close();
        }
        this.peers.clear();
        this.roomId = null;
        this.userId = null;
    }
}

// Singleton instance
export const webrtcManager = new WebRTCManager();
