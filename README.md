# Wormhole 🌀

**Wormhole** is a Chrome extension that turns every webpage into a private, real-time chat room. Experience the web with others visiting the same page, all through a modern side panel interface.

[**Download from Chrome Web Store**](https://chromewebstore.google.com/detail/wormhole/kiflgnlepagdnokhhbcjljcipcbfalcj)

![Wormhole Screenshot](screenshot.png)

## 🚀 Quick Start

1.  **Clone & Install:**
    ```bash
    git clone https://github.com/1u-w-u1/wormhole.git
    cd wormhole
    npm install
    npm run build
    ```
2.  **Firebase Setup:**
    - Create a Firebase project with a **Realtime Database**.
    - Copy the config values into `firebase-config.js` (see `firebase-config.template.js`).
    - Set your Database rules to allow read/write for the chat flow.
3.  **Load Extension:**
    - Open `chrome://extensions/`.
    - Enable **Developer mode**.
    - Click **Load unpacked** and select the `wormhole` folder.

## 📖 Documentation

-   **[User Guide](user-guide.md):** Learn how to use the extension, manage your profile, and start chatting.
-   **[Developer Guide](developer-guide.md):** Deep dive into the architecture (Service Worker, Offscreen Document), WebRTC mesh implementation, and signaling logic.

## ✨ Key Features

-   **Contextual Chat:** Automatically joins the room for the URL you are currently viewing.
-   **Peer-to-Peer:** Messages are sent directly between users via WebRTC DataChannels.
-   **SPA Support:** Works seamlessly on sites like YouTube, GitHub, and Twitter using advanced URL change detection.
-   **Mesh Networking:** Optimized for up to 8 concurrent users per room with Perfect Negotiation.
-   **Dark Mode:** A premium, modern UI designed for a focused chat experience.

## 🛠 Tech Stack

-   **Chrome Extension (Manifest V3)**
-   **WebRTC** (RTCPeerConnection + DataChannels)
-   **Firebase Realtime Database** (Signaling only)
-   **Vanilla CSS** (Custom design system)
-   **esbuild** (Fast bundling)

## 📄 License

ISC License.
