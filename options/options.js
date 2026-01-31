/**
 * Options Page JavaScript - User settings management
 */

import { generateUserId, generateNickname } from '../lib/utils.js';
import { t } from '../lib/i18n.js';

// DOM Elements
const elements = {
    nickname: document.getElementById('nickname'),
    email: document.getElementById('email'),
    odId: document.getElementById('userId'),
    copyIdBtn: document.getElementById('copyIdBtn'),
    language: document.getElementById('language'),
    saveBtn: document.getElementById('saveBtn'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    subtitle: document.querySelector('.subtitle')
};

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    await loadSettings();
    setupEventListeners();
    translatePage();
}

async function loadSettings() {
    const stored = await chrome.storage.sync.get(['odId', 'nickname', 'email', 'language']);

    if (!stored.odId) {
        // First time - generate new user
        const newUser = {
            odId: generateUserId(),
            nickname: generateNickname(),
            email: ''
        };
        await chrome.storage.sync.set(newUser);
        Object.assign(stored, newUser);
    }

    elements.odId.textContent = stored.odId || 'N/A';
    elements.nickname.value = stored.nickname || '';
    elements.email.value = stored.email || '';
    elements.language.value = stored.language || 'en';
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
    // Save button
    elements.saveBtn.addEventListener('click', saveSettings);


    // Copy ID button
    elements.copyIdBtn.addEventListener('click', async () => {
        const odId = elements.odId.textContent;
        await navigator.clipboard.writeText(odId);
        showToast(t('idCopied', elements.language.value));
    });

    // Save on Enter in inputs
    elements.nickname.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveSettings();
    });

    elements.email.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveSettings();
    });
}

// ============================================================================
// Settings Management
// ============================================================================

async function saveSettings() {
    const nickname = elements.nickname.value.trim();
    const email = elements.email.value.trim();
    const language = elements.language.value;
    const currentLang = language;

    if (!nickname) {
        showToast(t('pleaseEnterNickname', language), true);
        elements.nickname.focus();
        return;
    }

    // Validate email if provided
    if (email && !isValidEmail(email)) {
        showToast(t('pleaseEnterValidEmail', language), true);
        elements.email.focus();
        return;
    }

    await chrome.storage.sync.set({ nickname, email, language });
    translatePage();

    // Notify service worker of update
    const odId = elements.odId.textContent;
    chrome.runtime.sendMessage({
        type: 'UPDATE_USER',
        user: { odId, nickname, email, language }
    });

    showToast(t('settingsSaved', language));
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function translatePage() {
    const lang = elements.language.value || 'en';

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key, lang);
    });

    // Update placeholders
    elements.nickname.placeholder = t('nickname', lang);
}

// ============================================================================
// UI Helpers
// ============================================================================

function showToast(message, isError = false) {
    elements.toastMessage.textContent = message;
    elements.toast.classList.remove('hidden');
    elements.toast.classList.toggle('error', isError);

    setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, 3000);
}

// ============================================================================
// Start
// ============================================================================

init();
