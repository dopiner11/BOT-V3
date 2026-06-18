
import { AttachmentBuilder } from 'discord.js';

export function createDiscordTranscript(messages, ticket, transcriptData, closerUsername = 'Unknown') {
    const exportTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Baghdad' });

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - ${ticket.ticketNumber}</title>
    <style>
        :root {
            --background-primary: #313338;
            --background-secondary: #2b2d31;
            --background-tertiary: #1e1f22;
            --channel-textarea-background: #383a40;
            --text-normal: #dbdee1;
            --text-muted: #949ba4;
            --header-primary: #f2f3f5;
            --brand-experiment: #5865f2;
            --interactive-hover: #4752c4;
            --text-link: #00a8fc;
            --background-message-hover: #2e3035; 
            --mention-background: rgba(88, 101, 242, 0.3);
            --mention-foreground: #c9cdfb;
        }

        @font-face {
            font-family: 'gg sans';
            src: url('https://discord.com/assets/2c21aeda16de3cd95168.woff2') format('woff2');
            font-weight: 400;
        }
        @font-face {
            font-family: 'gg sans';
            src: url('https://discord.com/assets/f50c0ba0c1bcBC43.woff2') format('woff2');
            font-weight: 600;
        }

        body {
            background-color: var(--background-primary);
            color: var(--text-normal);
            font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }

        /* Top Header */
        .header {
            height: 48px;
            min-height: 48px;
            display: flex;
            align-items: center;
            padding: 0 16px;
            box-shadow: 0 1px 0 rgba(4, 4, 5, 0.2), 0 1.5px 0 rgba(6, 6, 7, 0.05), 0 2px 0 rgba(4, 4, 5, 0.05);
            background-color: var(--background-primary);
            z-index: 100;
            font-weight: 600;
            font-size: 16px;
            color: var(--header-primary);
        }
        
        .header-icon {
            color: #80848e;
            margin-right: 8px;
            width: 24px;
            height: 24px;
        }

        /* Chat Container */
        .chat-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            display: flex;
            flex-direction: column;
            padding-bottom: 30px;
        }

        .chat-scroller {
            padding-top: 25px;
            display: flex;
            flex-direction: column;
        }

        /* Channel Intro */
        .channel-intro {
            margin: 16px;
            margin-top: 10px;
            border-bottom: 1px solid rgba(78, 80, 88, 0.48);
            padding-bottom: 20px;
        }
        .channel-intro h1 {
            font-size: 32px;
            font-weight: 700;
            color: var(--header-primary);
            margin: 0 0 8px 0;
        }
        .channel-intro p {
            color: var(--text-normal);
            font-size: 16px;
        }

        /* Message Group */
        .message-group {
            margin-top: 17px;
            margin-bottom: 0;
            padding: 2px 16px;
            display: flex;
            position: relative;
        }
        
        .message-group:hover {
            background-color: var(--background-message-hover);
        }

        .message-group.consecutive {
            margin-top: 0;
            padding: 2px 16px; 
            min-height: 1.375rem;
        }

        /* Avatar */
        .avatar-container {
            width: 40px;
            height: 40px;
            margin-right: 16px;
            margin-top: 2px;
            cursor: pointer;
            flex-shrink: 0;
        }
        
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: var(--background-secondary);
            object-fit: cover;
        }
        
        .timestamp-consecutive {
            position: absolute;
            left: 0;
            width: 56px;
            text-align: right;
            font-size: 11px;
            line-height: 1.375rem;
            color: var(--text-muted);
            opacity: 0;
        }
        
        .message-group.consecutive:hover .timestamp-consecutive {
            opacity: 1;
        }

        /* Content */
        .content-container {
            flex: 1;
            min-width: 0;
        }

        .author-header {
            display: flex;
            align-items: center;
            padding-bottom: 2px;
        }

        .username {
            font-weight: 500;
            font-size: 1rem;
            color: var(--header-primary);
            margin-right: 0.25rem;
            cursor: pointer;
        }
        
        .username:hover {
            text-decoration: underline;
        }
        
        .bot-tag {
            background-color: #5865f2;
            color: #fff;
            border-radius: 3px;
            padding: 0 4px;
            font-size: 0.625rem;
            line-height: .9375rem;
            margin-left: 4px;
            vertical-align: middle;
            display: inline-flex;
            align-items: center;
            height: 15px;
            margin-right: 4px;
        }

        .timestamp {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-left: 0.25rem;
        }

        .message-content {
            font-size: 1rem;
            line-height: 1.375rem;
            color: var(--text-normal);
            white-space: pre-wrap;
            word-wrap: break-word;
            user-select: text;
        }
        
        /* Markdown & Formatting */
        .mention {
            background-color: var(--mention-background);
            color: var(--mention-foreground);
            border-radius: 3px;
            padding: 0 2px;
            font-weight: 500;
            cursor: pointer;
        }
        .mention:hover {
            background-color: #5865f2;
            color: white;
        }
        
        a {
            color: var(--text-link);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        
        code {
            font-family: Consolas, "Andale Mono WT", "Andale Mono", "Lucida Console", "Lucida Sans Typewriter", "DejaVu Sans Mono", "Bitstream Vera Sans Mono", "Liberation Mono", "Nimbus Mono L", Monaco, "Courier New", Courier, monospace;
            background-color: var(--background-secondary);
            padding: 0.2em;
            margin: -0.2em 0;
            border-radius: 3px;
            font-size: 85%;
        }
        
        pre {
            background-color: var(--background-secondary);
            border: 1px solid #202225;
            border-radius: 4px;
            padding: 7px;
            margin-top: 6px;
            color: var(--text-normal);
            font-family: Consolas, monospace;
            max-width: 90%;
            overflow-x: auto;
        }
        pre code {
            background: none;
            padding: 0;
            margin: 0;
            border: none;
        }

        /* Attachments */
        .attachment-container {
            margin-top: 8px;
            max-width: 550px;
        }
        
        .attachment-image {
            max-width: 100%;
            max-height: 350px;
            border-radius: 4px;
            cursor: pointer;
        }
        
        .attachment-video {
            max-width: 100%;
            max-height: 350px;
            border-radius: 4px;
        }
        
        /* Embeds */
        .embed {
            display: flex;
            margin-top: 8px;
            max-width: 520px;
            border-left: 4px solid #202225;
            background-color: var(--background-secondary);
            border-radius: 4px;
        }
        
        .embed-inner {
            padding: 8px 16px 16px 12px;
            width: 100%;
            display: flex;
            flex-direction: column;
        }
        
        .embed-title {
            font-weight: 600;
            color: var(--header-primary);
            margin-top: 8px;
        }
        
        .embed-desc {
            margin-top: 8px;
            font-size: 0.875rem;
            line-height: 1.25rem;
            color: var(--text-normal);
        }
        
        .embed-fields {
            display: flex;
            flex-wrap: wrap;
            margin-top: 8px;
            gap: 8px;
        }
        
        .embed-field {
            min-width: 0;
            flex: 1;
            margin-bottom: 4px;
        }
        
        .embed-field.inline {
            flex: 0 0 auto;
            min-width: 150px;
        }
        
        .embed-field-name {
            font-weight: 600;
            margin-bottom: 2px;
            color: var(--header-primary);
            font-size: 0.875rem;
        }
        
        .embed-field-value {
            font-size: 0.875rem;
            line-height: 1.125rem;
            color: var(--text-normal);
            white-space: pre-wrap;
        }

        .embed-image {
            margin-top: 16px;
            border-radius: 4px;
            max-width: 100%;
            max-height: 300px;
        }
        
        .embed-footer {
            margin-top: 8px;
            font-size: 0.75rem;
            color: var(--text-muted);
            display: flex;
            align-items: center;
        }
        
        .embed-footer-icon {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            margin-right: 8px;
        }

    </style>
</head>
<body>

<div class="header">
    <svg class="header-icon" aria-hidden="false" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.88657 21C5.57547 21 5.3399 20.7189 5.39427 20.4126L6.00001 17H2.59511C2.28449 17 2.04905 16.7198 2.10259 16.4138L2.27759 15.4138C2.31946 15.1746 2.52722 15 2.77011 15H6.35001L7.41001 9H4.00511C3.69449 9 3.45905 8.71977 3.51259 8.41381L3.68759 7.41381C3.72946 7.17456 3.93722 7 4.18011 7H7.76001L8.39657 3.41262C8.43914 3.17316 8.64664 3 8.88972 3H9.87344C10.1845 3 10.4201 3.28107 10.3657 3.58738L9.76001 7H15.76L16.3966 3.41262C16.4391 3.17316 16.6466 3 16.8897 3H17.8734C18.1845 3 18.4201 3.28107 18.3657 3.58738L17.76 7H21.1649C21.4755 7 21.711 7.28023 21.6574 7.58619L21.4824 8.58619C21.4406 8.82544 21.2328 9 20.9899 9H17.41L16.35 15H19.7549C20.0655 15 20.301 15.2802 20.2474 15.5862L20.0724 16.5862C20.0306 16.8254 19.8228 17 19.5799 17H16L15.3634 20.5874C15.3209 20.8268 15.1134 21 14.8703 21H13.8866C13.5755 21 13.3399 20.7189 13.3943 20.4126L14 17H8.00001L7.36344 20.5874C7.32088 20.8268 7.11337 21 6.87028 21H5.88657ZM9.41001 15H15.41L16.47 9H10.47L9.41001 15Z"></path></svg>
    ticket-${ticket.ticketNumber}
</div>

<div class="chat-container">
    <div class="chat-scroller">
        
        <div class="channel-intro">
            <h1>Welcome to #${ticket.ticketNumber}!</h1>
            <p>This is the start of the transcript for <span class="mention">ticket-${ticket.ticketNumber}</span>.</p>
            <p><strong>Category:</strong> ${ticket.type}</p>
            <p><strong>Opened by:</strong> <span class="mention">@${ticket.userId}</span> (${ticket.userId})</p>
            <p><strong>Time:</strong> ${new Date(ticket.createdAt).toLocaleString()}</p>
        </div>
        
        ${generateMessagesHTML(messages)}

        <div style="height: 30px;"></div>
        
        <div style="border-top: 1px solid #4f545c; padding: 20px; margin: 16px; text-align: center; color: #72767d;">
            <p>Transcript generated on ${exportTime}</p>
            <p>Closed by ${closerUsername} - Reason: ${ticket.closeReason || 'No reason provided'}</p>
        </div>
    </div>
</div>

<script>
        function copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => {
                const toast = document.createElement('div');
                toast.innerText = 'Copied ID: ' + text;
                toast.style.position = 'fixed';
                toast.style.bottom = '20px';
                toast.style.right = '20px';
                toast.style.background = '#5865f2';
                toast.style.color = 'white';
                toast.style.padding = '10px 20px';
                toast.style.borderRadius = '5px';
                toast.style.zIndex = '1000';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
            });
        }
    </script>

</body>
</html>
  `;

    return Buffer.from(html);
}

function generateMessagesHTML(messages) {
    let html = '';
    let lastAuthorId = null;
    let lastTimestamp = 0;

    messages.forEach(msg => {
        const isConsecutive = lastAuthorId === msg.authorId && (msg.timestamp - lastTimestamp) < 300000; // 5 mins

        if (isConsecutive) {
            html += `
            <div class="message-group consecutive">
                <div class="timestamp-consecutive">${formatTime(new Date(msg.timestamp))}</div>
                <div class="content-container">
                    ${renderMessageContent(msg)}
                </div>
            </div>
            `;
        } else {
            html += `
            <div class="message-group">
                <div class="avatar-container">
                    <img src="${msg.authorAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="avatar" alt="Avatar">
                </div>
                <div class="content-container">
                    <div class="author-header">
                        <span class="username" style="color: ${msg.authorColor || 'inherit'}">${msg.authorTag.split('#')[0]}</span>
                        ${msg.isSystem ? '<span class="bot-tag">BOT</span>' : ''}
                        <span class="timestamp">${formatDate(new Date(msg.timestamp))}</span>
                    </div>
                    ${renderMessageContent(msg)}
                </div>
            </div>
            `;
        }

        lastAuthorId = msg.authorId;
        lastTimestamp = msg.timestamp;
    });

    return html;
}

function renderMessageContent(msg) {
    let contentHtml = '';

    if (msg.content) {
        contentHtml += `<div class="message-content">${parseMarkdown(msg.content)}</div>`;
    }

    // Attachments
    if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(att => {
            const isImage = att.contentType && att.contentType.startsWith('image/');
            const isVideo = att.contentType && att.contentType.startsWith('video/');

            contentHtml += '<div class="attachment-container">';
            if (isImage) {
                contentHtml += `<a href="${att.url}" target="_blank"><img src="${att.url}" class="attachment-image" alt="${att.name}"></a>`;
            } else if (isVideo) {
                contentHtml += `<video controls class="attachment-video"><source src="${att.url}" type="${att.contentType}">Your browser does not support the video tag.</video>`;
            } else {
                contentHtml += `<a href="${att.url}" target="_blank" style="color: #00a8fc;">📎 ${att.name || 'Attachment'} (${formatBytes(att.size)})</a>`;
            }
            contentHtml += '</div>';
        });
    }

    // Embeds
    if (msg.embeds && msg.embeds.length > 0) {
        msg.embeds.forEach(embed => {
            const color = embed.color ? '#' + embed.color.toString(16).padStart(6, '0') : '#202225';

            contentHtml += `
            <div class="embed" style="border-left-color: ${color};">
                <div class="embed-inner">
                    ${embed.title ? `<div class="embed-title">${parseMarkdown(embed.title)}</div>` : ''}
                    ${embed.description ? `<div class="embed-desc">${parseMarkdown(embed.description)}</div>` : ''}
                    
                    ${embed.fields && embed.fields.length > 0 ? `
                    <div class="embed-fields">
                        ${embed.fields.map(f => `
                        <div class="embed-field ${f.inline ? 'inline' : ''}">
                            <div class="embed-field-name">${parseMarkdown(f.name)}</div>
                            <div class="embed-field-value">${parseMarkdown(f.value)}</div>
                        </div>
                        `).join('')}
                    </div>
                    ` : ''}

                    ${embed.image ? `<img src="${embed.image.url}" class="embed-image">` : ''}
                    
                    ${embed.footer || embed.timestamp ? `
                    <div class="embed-footer">
                        ${embed.footer && embed.footer.iconURL ? `<img src="${embed.footer.iconURL}" class="embed-footer-icon">` : ''}
                        <span>
                            ${embed.footer ? embed.footer.text : ''}
                            ${embed.footer && embed.timestamp ? ' • ' : ''}
                            ${embed.timestamp ? formatDate(new Date(embed.timestamp)) : ''}
                        </span>
                    </div>
                    ` : ''}
                </div>
            </div>
            `;
        });
    }

    return contentHtml;
}

function parseMarkdown(text) {
    if (!text) return '';
    let parsed = text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        // Italic
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        // Code block
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Mentions - User
        .replace(/<@!?(\d+)>/g, '<span class="mention" onclick="copyToClipboard(\'$1\')" title="Click to copy ID">@$1</span>')
        // Mentions - Channel
        .replace(/<#(\d+)>/g, '<span class="mention">#$1</span>')
        // Mentions - Role
        .replace(/<@&(\d+)>/g, '<span class="mention" onclick="copyToClipboard(\'$1\')" title="Click to copy ID">@&amp;$1</span>')
        // Newlines
        .replace(/\n/g, '<br>');

    return parsed;
}

function formatDate(date) {
    return date.toLocaleString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatTime(date) {
    return date.toLocaleString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
