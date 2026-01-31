/**
 * Internationalization (i18n) for Wormhole
 */

export const translations = {
    en: {
        settings: "Settings",
        room: "Room",
        connecting: "Connecting...",
        connected: "Connected",
        online: "Online",
        noMessages: "No messages yet",
        firstToHello: "Be the first to say hello!",
        typeMessage: "Type a message...",
        error: "Error",
        somethingWrong: "Something went wrong",
        ok: "OK",
        nickname: "Nickname",
        nicknameHint: "This is how others will see you in chat",
        emailOptional: "Email (optional)",
        emailHint: "Displayed to other users if provided",
        userId: "User ID",
        userIdHint: "Your unique identifier (generated automatically)",
        saveChanges: "Save Changes",
        settingsSaved: "Settings saved!",
        pleaseEnterNickname: "Please enter a nickname",
        pleaseEnterValidEmail: "Please enter a valid email",
        copyId: "Copy ID",
        idCopied: "ID copied to clipboard!",
        language: "Language",
        joinedRoom: "Joined room",
        roomFull: "Room Full",
        roomFullMessage: "This room has reached its limit of {count} users. Try another page.",
        anonymous: "Anonymous",
        you: "you",
        profile: "Profile",
        settingsSubtitle: "Configure your profile for chat",
        webrtcPowered: "WebRTC-powered chat for the web"
    },
    zh: {
        settings: "设置",
        room: "房间",
        connecting: "正在连接...",
        connected: "已连接",
        online: "在线人数",
        noMessages: "暂无消息",
        firstToHello: "成为第一个打招呼的人吧！",
        typeMessage: "输入消息...",
        error: "错误",
        somethingWrong: "出错了",
        ok: "确定",
        nickname: "昵称",
        nicknameHint: "这是其他人在聊天中看到你的方式",
        emailOptional: "邮箱 (可选)",
        emailHint: "如果提供，将显示给其他用户",
        userId: "用户 ID",
        userIdHint: "你的唯一标识符 (自动生成)",
        saveChanges: "保存更改",
        settingsSaved: "设置已保存！",
        pleaseEnterNickname: "请输入昵称",
        pleaseEnterValidEmail: "请输入有效的邮箱",
        copyId: "复制 ID",
        idCopied: "ID 已复制到剪贴板！",
        language: "语言",
        joinedRoom: "已加入房间",
        roomFull: "房间已满",
        roomFullMessage: "该房间已达到 {count} 人的限制。请尝试其他页面。",
        anonymous: "匿名",
        you: "你",
        profile: "个人资料",
        settingsSubtitle: "配置您的聊天个人资料",
        webrtcPowered: "基于 WebRTC 的网页聊天"
    },
    es: {
        settings: "Ajustes",
        room: "Sala",
        connecting: "Conectando...",
        connected: "Conectado",
        online: "En línea",
        noMessages: "No hay mensajes aún",
        firstToHello: "¡Sé el primero en decir hola!",
        typeMessage: "Escribe un mensaje...",
        error: "Error",
        somethingWrong: "Algo salió mal",
        ok: "Aceptar",
        nickname: "Apodo",
        nicknameHint: "Así es como te verán los demás en el chat",
        emailOptional: "Correo electrónico (opcional)",
        emailHint: "Se muestra a otros usuarios si se proporciona",
        userId: "ID de usuario",
        userIdHint: "Tu identificador único (generado automáticamente)",
        saveChanges: "Guardar cambios",
        settingsSaved: "¡Ajustes guardados!",
        pleaseEnterNickname: "Por favor, introduce un apodo",
        pleaseEnterValidEmail: "Por favor, introduce un correo válido",
        copyId: "Copiar ID",
        idCopied: "¡ID copiado al portapapeles!",
        language: "Idioma",
        joinedRoom: "Unido a la sala",
        roomFull: "Sala llena",
        roomFullMessage: "Esta sala ha alcanzado su límite de {count} usuarios. Prueba con otra página.",
        anonymous: "Anónimo",
        you: "tú",
        profile: "Perfil",
        settingsSubtitle: "Configura tu perfil para el chat",
        webrtcPowered: "Chat para la web potenciado por WebRTC"
    },
    ja: {
        settings: "設定",
        room: "ルーム",
        connecting: "接続中...",
        connected: "接続済み",
        online: "オンライン",
        noMessages: "メッセージはまだありません",
        firstToHello: "最初に挨拶してみましょう！",
        typeMessage: "メッセージを入力...",
        error: "エラー",
        somethingWrong: "エラーが発生しました",
        ok: "OK",
        nickname: "ニックネーム",
        nicknameHint: "チャットで他のユーザーに表示される名前です",
        emailOptional: "メールアドレス (任意)",
        emailHint: "設定すると他のユーザーに表示されます",
        userId: "ユーザー ID",
        userIdHint: "あなたの一意の識別子です (自動生成されます)",
        saveChanges: "変更を保存",
        settingsSaved: "設定を保存しました！",
        pleaseEnterNickname: "ニックネームを入力してください",
        pleaseEnterValidEmail: "有効なメールアドレスを入力してください",
        copyId: "IDをコピー",
        idCopied: "IDをクリップボードにコピーしました！",
        language: "言語",
        joinedRoom: "ルームに参加しました",
        roomFull: "ルームが満員です",
        roomFullMessage: "このルームは最大 {count} 名に達しています。他のページをお試しください。",
        anonymous: "匿名",
        you: "自分",
        profile: "プロフィール",
        settingsSubtitle: "チャット用のプロフィールを設定します",
        webrtcPowered: "WebRTCを活用したウェブチャット"
    }
};

/**
 * Get a translation string
 * @param {string} key - Translation key
 * @param {string} lang - Language code (en, zh, es, ja)
 * @param {object} params - Replace placeholders like {count}
 */
export function t(key, lang = 'en', params = {}) {
    const dict = translations[lang] || translations['en'];
    let text = dict[key] || translations['en'][key] || key;

    // Replace placeholders
    Object.keys(params).forEach(param => {
        text = text.replace(`{${param}}`, params[param]);
    });

    return text;
}
