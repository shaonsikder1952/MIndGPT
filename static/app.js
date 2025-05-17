// app.js

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
let historyList      = document.querySelector('.chat-history ul');

// Ensure an empty <ul> always exists
if (!historyList) {
  const container = document.querySelector('.chat-history');
  historyList = document.createElement('ul');
  container.innerHTML = '';
  container.appendChild(historyList);
}

let currentSessionId = null;
let pendingDeletion  = null;
const chatHistory    = { current: [] };

// Hide modal initially
modalOverlay.style.display = 'none';

// ——— Helper: format AI text ———
function formatAIText(text) {
  let t = text.trim();
  if (t.length === 0) return '';
  // Capitalize first letter
  t = t.charAt(0).toUpperCase() + t.slice(1);
  // Ensure ending punctuation
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

// ——— Render messages into a container ———
function renderMessages(msgs, container) {
  container.innerHTML = '';
  msgs.forEach(m => {
    const div = document.createElement('div');
    div.classList.add('message', m.role === 'user' ? 'user' : 'ai');
    div.textContent = m.role === 'assistant'
                     ? formatAIText(m.content)
                     : m.content.trim();
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
}

// ——— Sidebar session item creation ———
function addSessionToSidebar(id, title) {
  const li = document.createElement('li');
  li.className       = 'chat-history-item';
  li.dataset.chatId  = id;
  li.tabIndex        = 0;
  li.innerHTML       = `
    <i class="fas fa-comments"></i>
    <span class="title">${title}</span>
    <button class="delete-session" data-session-id="${id}" aria-label="Delete">🗑️</button>
  `;
  historyList.prepend(li);
  attachHandlers(li);
}

// ——— Attach click + delete handlers ———
function attachHandlers(item) {
  // load session
  item.addEventListener('click', async () => {
    const sid = item.dataset.chatId;
    if (!sid) return;

    // highlight
    document.querySelectorAll('.chat-history-item')
            .forEach(el => el.classList.remove('active'));
    item.classList.add('active');

    try {
      const res = await fetch(`/session/${sid}`);
      if (!res.ok) throw new Error();
      const msgs = await res.json();
      currentSessionId    = sid;
      chatHistory.current = msgs;
      renderMessages(msgs, messagesDiv);
      prevChatDiv.style.display = 'none';
      prevChatBtn.setAttribute('aria-pressed','false');
    } catch (e) {
      console.error('Load session error:', e);
    }
  });

  // delete session
  const delBtn = item.querySelector('.delete-session');
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    pendingDeletion = delBtn.dataset.sessionId;
    document.getElementById('modal-desc').textContent = 'Delete this conversation?';
    confirmBtn.textContent = 'Delete';
    modalOverlay.style.display = 'flex';
  });
}

// ——— Init existing sidebar items ———
document.querySelectorAll('.chat-history-item').forEach(attachHandlers);

// ——— Submit handler ———
chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  // show user
  chatHistory.current.push({ role: 'user', content: text });
  renderMessages(chatHistory.current, messagesDiv);

  // prepare form
  const body = new URLSearchParams();
  body.append('message', text);
  if (currentSessionId) body.append('session_id', currentSessionId);

  // clear input
  messageInput.value = '';
  messageInput.focus();

  // 1) send chat
  const start = Date.now();
  let data;
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded'},
      body: body.toString()
    });
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch (err) {
    console.error('Chat API error:', err);
    chatHistory.current.push({ role:'assistant', content:'Sorry, something went wrong.' });
    renderMessages(chatHistory.current, messagesDiv);
    return;
  }
  console.log(`Chat API took ${Date.now() - start}ms`);

  // add AI reply
  chatHistory.current.push({ role:'assistant', content:data.response });
  renderMessages(chatHistory.current, messagesDiv);

  // hide prev panel
  prevChatDiv.style.display = 'none';
  prevChatBtn.setAttribute('aria-pressed','false');

  // new session?
  const isNew = !currentSessionId && data.session_id;
  currentSessionId = data.session_id || currentSessionId;

  if (isNew) {
    // provisional title
    addSessionToSidebar(currentSessionId, text.slice(0,30)+'…');

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

  // highlight active/new
  document.querySelectorAll('.chat-history-item')
          .forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.chat-history-item[data-chat-id="${currentSessionId}"]`);
  if (active) active.classList.add('active');
});

// ——— New chat button ———
newChatBtn.addEventListener('click', () => {
  chatHistory.current = [];
  currentSessionId    = null;
  renderMessages([], messagesDiv);
  messageInput.focus();
  prevChatDiv.style.display = 'none';
  prevChatBtn.setAttribute('aria-pressed','false');
  document.querySelectorAll('.chat-history-item')
          .forEach(el => el.classList.remove('active'));
});

// ——— Previous toggle ———
prevChatBtn.addEventListener('click', async () => {
  if (!currentSessionId) {
    prevChatDiv.textContent = 'No active chat session.';
    prevChatDiv.style.display = 'block';
    prevChatBtn.setAttribute('aria-pressed','true');
    return;
  }
  if (prevChatDiv.style.display==='block') {
    prevChatDiv.style.display = 'none';
    prevChatBtn.setAttribute('aria-pressed','false');
    return;
  }
  prevChatDiv.textContent = 'Loading…';
  prevChatDiv.style.display = 'block';
  prevChatBtn.setAttribute('aria-pressed','true');
  try {
    const res = await fetch(`/session/${currentSessionId}`);
    if (!res.ok) throw new Error();
    const msgs = await res.json();
    renderMessages(msgs, prevChatDiv);
  } catch {
    prevChatDiv.textContent = 'Failed to load.';
  }
});

// ——— Modal confirm/cancel ———
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
      const res = await fetch(`/delete-session/${pendingDeletion}`, { method:'DELETE' });
      if (!res.ok) throw new Error();
      document.querySelector(`.delete-session[data-session-id="${pendingDeletion}"]`)
              .closest('li').remove();
      if (currentSessionId===pendingDeletion) {
        currentSessionId    = null;
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
