// ——— Grab elements ———
const modalOverlay   = document.getElementById('modal-overlay');
const logoutBtn      = document.getElementById('logout-btn');
const confirmBtn     = document.getElementById('confirm-logout');
const cancelBtn      = document.getElementById('cancel-logout');
const messagesDiv    = document.getElementById('messages');
const chatForm       = document.getElementById('chat-form');
const messageInput   = document.getElementById('message-input');
const prevChatDiv    = document.getElementById('previous-chat-messages');
const prevChatBtn    = document.getElementById('previous-chat');
const newChatBtn     = document.getElementById('new-chat-btn');
const goToFilesBtn   = document.getElementById('goToFilesBtn');
const fileSection    = document.getElementById('file-section');
let historyList      = document.querySelector('.chat-history ul');

if (!historyList) {
  const container = document.querySelector('.chat-history');
  if (container) {
    historyList = document.createElement('ul');
    container.innerHTML = '';
    container.appendChild(historyList);
  }
}

let currentSessionId = null;
let pendingDeletion  = null;
const chatHistory    = { current: [] };
let chatStarted      = false;

// Hide modal initially
modalOverlay.style.display = 'none';

// ——— Format AI text ———
// Emoji keyword map
const emojiMap = {
  happy: "😊",
  sad: "😢",
  idea: "💡",
  code: "💻",
  error: "❌",
  success: "✅",
};

// Escape HTML special chars to prevent injection
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

// Fix basic grammar & punctuation
function fixGrammar(text) {
  if (!text) return '';
  text = text.trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?]$/.test(text)) text += '.';
  text = text.replace(/\bdo not\b/gi, "don't")
             .replace(/\bcannot\b/gi, "can't")
             .replace(/\bi am\b/gi, "I'm")
             .replace(/\byou are\b/gi, "you're");
  return text;
}

// Format AI response with markdown-like parsing & emoji replacement
function formatAIResponse(text) {
  if (!text) return '';

  // Escape HTML first
  let t = escapeHTML(text);

  // Replace emoji keywords
  Object.entries(emojiMap).forEach(([key, emoji]) => {
    const re = new RegExp(`\\b${key}\\b`, 'gi');
    t = t.replace(re, emoji);
  });

  // Code blocks: ```code```
  t = t.replace(/```([\s\S]*?)```/g, (match, p1) => {
  const code = escapeHTML(p1.trim());
  return `
    <div class="code-wrapper">
      <button class="copy-btn">Copy</button>
      <pre class="code-block"><code>${code}</code></pre>
    </div>`;
});

  // Inline code: `code`
  t = t.replace(/`([^`\n]+)`/g, (match, p1) => {
    return `<code class="inline-code">${p1.trim()}</code>`;
  });

  // Bold **text**
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italics *text*
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Split paragraphs & fix grammar per paragraph
  const paragraphs = t.split(/\n{1,2}/).map(para => fixGrammar(para));

  return paragraphs.map(p => `<p>${p}</p>`).join('');
}


// ——— Render messages ———
function renderMessages(msgs, container) {
  container.innerHTML = '';
  msgs.forEach(m => {
    const div = document.createElement('div');
    div.classList.add('message', m.role === 'user' ? 'user' : 'ai');

    if (m.role === 'assistant') {
      // We don't render full AI messages here to allow typing effect
      // Instead, show the content directly for previous messages (not last)
      div.innerHTML = formatAIResponse(m.content);
    } else {
      div.textContent = m.content.trim();
    }
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

//-----------


async function typeAIResponse(fullText, container) {
  const msgDiv = document.createElement('div');
  msgDiv.classList.add('message', 'ai');
  container.appendChild(msgDiv);

  const parts = fullText.split(/(```[\s\S]*?```)/g);

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      // Code block, same as before
      const codeContent = part.slice(3, -3).trim();
      const wrapper = document.createElement('div');
      wrapper.classList.add('code-wrapper');
      wrapper.style.margin = '1em 0';
      wrapper.style.position = 'relative';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.textContent = 'Copy';

      const pre = document.createElement('pre');
      pre.classList.add('code-block');
      const code = document.createElement('code');
      pre.appendChild(code);

      wrapper.appendChild(copyBtn);
      wrapper.appendChild(pre);
      msgDiv.appendChild(wrapper);

      for (let i = 0; i < codeContent.length; i++) {
        code.textContent += codeContent[i];
        container.scrollTop = container.scrollHeight;
        await new Promise(r => setTimeout(r, 15));
      }

      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy', 1500);
      });

    } else {
      // Text part — no typing effect, just formatted output
      const textDiv = document.createElement('div');
      textDiv.classList.add('ai-text-part');
      msgDiv.appendChild(textDiv);

      const formatted = formatAIResponse(part);
      textDiv.innerHTML = formatted;
      container.scrollTop = container.scrollHeight;
    }
  }
}


// ——— Handlers for sidebar ———
function attachHandlers(item) {
  item.addEventListener('click', async () => {
    const sid = item.dataset.chatId;
    if (!sid) return;
    document.querySelectorAll('.chat-history-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');

    try {
      const res = await fetch(`/session/${sid}`);
      if (!res.ok) throw new Error();
      const msgs = await res.json();
      currentSessionId = sid;
      chatHistory.current = msgs;
      renderMessages(msgs, messagesDiv);
      prevChatDiv.classList.remove('open');
      prevChatBtn.setAttribute('aria-pressed', 'false');
    } catch (e) {
      console.error('Load session error:', e);
    }
  });

  const delBtn = item.querySelector('.delete-session');
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    pendingDeletion = delBtn.dataset.sessionId;
    document.getElementById('modal-desc').textContent = 'Delete this conversation?';
    confirmBtn.textContent = 'Delete';
    modalOverlay.style.display = 'flex';
  });
}

// ——— Initialize existing items ———
document.querySelectorAll('.chat-history-item').forEach(attachHandlers);
function addSessionToSidebar(id, title) {
  const li = document.createElement('li');
  li.className      = 'chat-history-item';
  li.dataset.chatId = id;
  li.innerHTML      = `
    <i class="fas fa-comments"></i>
    <span class="title">${title}</span>
    <button class="delete-session" data-session-id="${id}">🗑️</button>
  `;
  historyList.prepend(li);
  attachHandlers(li);
}

// ——— Chat form submission ———
chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

    // on first message, hide the file UI via a CSS class
  if (!chatStarted) {
    chatStarted = true;
    document.body.classList.add('chat-started');
  }


  // Push user message and render it
// 1) Append user message only
chatHistory.current.push({ role: 'user', content: text });
const userDiv = document.createElement('div');
userDiv.classList.add('message', 'user');
userDiv.textContent = text;
messagesDiv.appendChild(userDiv);
messagesDiv.scrollTop = messagesDiv.scrollHeight;

// 2) Append AI placeholder
const aiThinkingDiv = document.createElement('div');
aiThinkingDiv.classList.add('message', 'ai');
aiThinkingDiv.textContent = 'Thinking...';
messagesDiv.appendChild(aiThinkingDiv);
messagesDiv.scrollTop = messagesDiv.scrollHeight;



  const body = new URLSearchParams();
  body.append('message', text);
  if (currentSessionId) body.append('session_id', currentSessionId);
  messageInput.value = '';
  messageInput.focus();

  let data;
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch (err) {
    console.error('Chat API error:', err);
    chatHistory.current.push({ role: 'assistant', content: 'Sorry, something went wrong.' });
    renderMessages(chatHistory.current, messagesDiv);
    return;
  }

  // Remove the last 'Thinking...' message before adding real response
/// 3) Replace placeholder with typing
aiThinkingDiv.remove();
chatHistory.current.push({ role: 'assistant', content: data.response });
await typeAIResponse(data.response, messagesDiv);
messagesDiv.scrollTop = messagesDiv.scrollHeight;
///saveSessionToLocal();




  prevChatDiv.classList.remove('open');
  prevChatBtn.setAttribute('aria-pressed', 'false');

  // new session?
const isNew = !currentSessionId && data.session_id;
currentSessionId = data.session_id || currentSessionId;

if (isNew) {
  // provisional title
  addSessionToSidebar(currentSessionId, text.slice(0, 30) + '…');

  // then asynchronously fetch AI title
  (async () => {
    try {
      const titler = await fetch(`/session/${currentSessionId}/title`);
      if (!titler.ok) throw new Error();
      const json = await titler.json(); // { title: "AI-generated title" }
      const li = document.querySelector(`.chat-history-item[data-chat-id="${currentSessionId}"] .title`);
      if (li) li.textContent = json.title;
    } catch (e) {
      console.error('Title fetch error:', e);
    }
  })();
}

  document.querySelectorAll('.chat-history-item').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.chat-history-item[data-chat-id="${currentSessionId}"]`);
  if (active) active.classList.add('active');
});

// ——— New chat ———
newChatBtn.addEventListener('click', () => {
  chatHistory.current = [];
  currentSessionId = null;
  renderMessages([], messagesDiv);
  messageInput.focus();
  prevChatDiv.classList.remove('open');
  prevChatBtn.setAttribute('aria-pressed', 'false');
  document.querySelectorAll('.chat-history-item').forEach(el => el.classList.remove('active'));
    // bring back file UI
  chatStarted = false;
  document.body.classList.remove('chat-started');
});

// ——— Toggle previous chat panel ———
prevChatBtn.addEventListener('click', () => {
  prevChatDiv.classList.toggle('open');
  prevChatBtn.setAttribute('aria-pressed', prevChatDiv.classList.contains('open').toString());

  if (!currentSessionId) {
    prevChatDiv.textContent = 'No active chat session.';
    return;
  }
  if (!prevChatDiv.classList.contains('open')) return;

  prevChatDiv.textContent = 'Loading…';
  fetch(`/session/${currentSessionId}`)
    .then(res => {
      if (!res.ok) throw new Error();
      return res.json();
    })
    .then(msgs => renderMessages(msgs, prevChatDiv))
    .catch(() => {
      prevChatDiv.textContent = 'Failed to load.';
    });
});

// ——— Modal handling ———
logoutBtn.addEventListener('click', () => {
  pendingDeletion = null;
  document.getElementById('modal-desc').textContent = 'Are you sure you want to log out?';
  confirmBtn.textContent = 'Log out';
  modalOverlay.style.display = 'flex';
});
cancelBtn.addEventListener('click', () => {
  modalOverlay.style.display = 'none';
  pendingDeletion = null;
});
confirmBtn.addEventListener('click', async () => {
  modalOverlay.style.display = 'none';
  if (pendingDeletion) {
    try {
      const res = await fetch(`/delete-session/${pendingDeletion}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      document.querySelector(`.delete-session[data-session-id="${pendingDeletion}"]`)
              .closest('li').remove();
      if (currentSessionId === pendingDeletion) {
        currentSessionId = null;
        chatHistory.current = [];
        renderMessages([], messagesDiv);
      }
    } catch (e) {
      console.error('Delete error:', e);
      alert('Could not delete chat.');
    }
    pendingDeletion = null;
  } else {
    window.location.href = '/logout';
  }
});

// ——— Sidebar toggle ———
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.querySelector('.app').classList.toggle('sidebar-open');
}

// ——— Go to files button ———
if (goToFilesBtn) {
  goToFilesBtn.addEventListener('click', () => {
    window.location.href = 'files.html';
  });
}

// ——— Show files by category ———
function showCategory(category) {
  fetch(`/files/${category}`)
    .then(res => res.json())
    .then(data => {
      const fileView = document.getElementById('fileView');
      if (!fileView) return;
      fileView.innerHTML = `<h3>${category.toUpperCase()}</h3><ul>` +
        data.files.map(f => `<li><a href="${f.url}" target="_blank">${f.name}</a></li>`).join('') +
        `</ul>`;
    })
    .catch(() => {
      const fileView = document.getElementById('fileView');
      if (fileView) fileView.innerHTML = '<p>Failed to load files.</p>';
    });
}

// ——— Hide "Go to Files" button on input ———
if (goToFilesBtn && messageInput) {
  messageInput.addEventListener('input', () => {
    goToFilesBtn.style.display = 'none';
  });
  messageInput.addEventListener('blur', () => {
    if (messageInput.value.trim() === '') {
      goToFilesBtn.style.display = 'inline-block';
    }
  });
}

// Load last session on page load
window.addEventListener('load', async () => {
  try {
    // 1) Fetch the list of sessions & titles from your backend
    const res = await fetch('/sessions');
    if (!res.ok) throw new Error('Failed to load sessions');
    const sessions = await res.json();            // expect [{ id, title }, ...]

    // 2) Populate sidebar
    sessions.forEach(s => addSessionToSidebar(s.id, s.title));

    // 3) Optionally, auto-load the most recent session
    if (sessions.length) {
      const latest = sessions[0].id;              // or backend can mark "last"
      const msgsRes = await fetch(`/session/${latest}`);
      if (msgsRes.ok) {
        const msgs = await msgsRes.json();
        currentSessionId = latest;
        chatHistory.current = msgs;
        renderMessages(msgs, messagesDiv);
        document
          .querySelector(`.chat-history-item[data-chat-id="${latest}"]`)
          ?.classList.add('active');
        chatStarted = true;
        document.body.classList.add('chat-started');
      }
    }
  } catch (e) {
    console.error(e);
  }
});

// Call this after each message

document.addEventListener('click', e => {
  if (e.target.classList.contains('copy-btn')) {
    const code = e.target.nextElementSibling.textContent;
    navigator.clipboard.writeText(code);
    e.target.textContent = 'Copied!';
    setTimeout(() => e.target.textContent = 'Copy', 1500);
  }
});
