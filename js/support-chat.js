/* ==========================================================================
   BITCHAIN PRO X — 24/7 CUSTOMER CHAT SUPPORT MODULE
   Real-Time Two-Way Messaging with Screenshot / Issue Image Upload Support
   ========================================================================== */

'use strict';

(function () {
  let _activeUser = null;
  let _userProfile = null;
  let _activeConvId = null;
  let _realtimeSub = null;
  let _currentTab = 'chat'; // 'chat' | 'new' | 'history'
  let _conversations = [];

  // Image Attachment State
  let _formAttachedImage = null; // { file, dataUrl, name, size }
  let _chatAttachedImage = null; // { file, dataUrl, name, size }

  function getClient() {
    return window.BitchainAuth && typeof window.BitchainAuth.getSupabase === 'function'
      ? window.BitchainAuth.getSupabase()
      : null;
  }

  // ─── Initialize User & Unread Badges ─────────────────────────────────────────
  async function initSupportModule() {
    const client = getClient();
    if (!client) return;

    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session || !session.user) return;
      _activeUser = session.user;

      // Fetch profile for pre-filling Name, Email, Phone
      const { data: prof } = await client
        .from('profiles')
        .select('*')
        .eq('id', _activeUser.id)
        .maybeSingle();
      _userProfile = prof || {};

      // Check for active unread messages from admin
      await checkUnreadSupport();
    } catch (e) {
      console.warn('Support init note:', e);
    }
  }

  // ─── Check Unread Support Messages ──────────────────────────────────────────
  async function checkUnreadSupport() {
    if (!_activeUser) return;
    const client = getClient();
    if (!client) return;

    try {
      const { data } = await client
        .from('support_conversations')
        .select('id, unread_user')
        .eq('user_id', _activeUser.id)
        .gt('unread_user', 0);

      const count = (data || []).reduce((acc, c) => acc + (c.unread_user || 0), 0);
      const badge = document.getElementById('floatingSupportBadge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (_) {}
  }

  // ─── Open Support Modal ─────────────────────────────────────────────────────
  async function openSupportChatModal(tab = null) {
    let backdrop = document.getElementById('supportModalBackdrop');
    if (!backdrop) {
      injectSupportModalHtml();
      backdrop = document.getElementById('supportModalBackdrop');
    }

    await initSupportModule();

    if (backdrop) {
      backdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    // Load user's conversations
    await loadUserConversations();

    // Decide which tab to show
    if (tab) {
      switchSupportTab(tab);
    } else if (_conversations.length > 0) {
      _activeConvId = _conversations[0].id;
      switchSupportTab('chat');
    } else {
      switchSupportTab('new');
    }
  }

  // ─── Close Support Modal ────────────────────────────────────────────────────
  function closeSupportChatModal() {
    const backdrop = document.getElementById('supportModalBackdrop');
    if (backdrop) {
      backdrop.classList.remove('active');
      document.body.style.overflow = '';
    }
    if (_realtimeSub) {
      _realtimeSub.unsubscribe();
      _realtimeSub = null;
    }
  }

  // ─── Switch Tabs: 'chat' | 'new' | 'history' ─────────────────────────────────
  function switchSupportTab(tab) {
    _currentTab = tab;
    const tabChat = document.getElementById('tabBtnSupportChat');
    const tabNew = document.getElementById('tabBtnSupportNew');
    const tabHistory = document.getElementById('tabBtnSupportHistory');

    if (tabChat) tabChat.classList.toggle('active', tab === 'chat');
    if (tabNew) tabNew.classList.toggle('active', tab === 'new');
    if (tabHistory) tabHistory.classList.toggle('active', tab === 'history');

    const bodyEl = document.getElementById('supportModalBody');
    if (!bodyEl) return;

    if (tab === 'new') {
      renderNewRequestForm(bodyEl);
    } else if (tab === 'chat') {
      renderChatRoom(bodyEl);
    } else if (tab === 'history') {
      renderHistoryList(bodyEl);
    }
  }

  // ─── Fetch Conversations ────────────────────────────────────────────────────
  async function loadUserConversations() {
    if (!_activeUser) return;
    const client = getClient();
    if (!client) return;

    try {
      const { data } = await client
        .from('support_conversations')
        .select('*')
        .eq('user_id', _activeUser.id)
        .order('updated_at', { ascending: false });

      _conversations = data || [];
      if (_conversations.length > 0 && !_activeConvId) {
        _activeConvId = _conversations[0].id;
      }
    } catch (e) {
      console.warn('Load conversations error:', e);
    }
  }

  // ─── Image Processing Helpers ───────────────────────────────────────────────
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  async function uploadOrEncodeImage(fileInfo, userId) {
    if (!fileInfo || !fileInfo.file) return null;
    const client = getClient();
    
    // Try uploading to Supabase Storage first
    if (client && client.storage) {
      try {
        const fileExt = fileInfo.name.split('.').pop() || 'png';
        const filePath = `${userId}/support_${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await client.storage
          .from('deposits')
          .upload(filePath, fileInfo.file, { cacheControl: '3600', upsert: true });

        if (!uploadErr) {
          const { data } = client.storage.from('deposits').getPublicUrl(filePath);
          if (data && data.publicUrl) return data.publicUrl;
        }
      } catch (_) {}
    }

    // Fallback directly to Data URL
    return fileInfo.dataUrl;
  }

  // ─── Render: New Support Request Form ───────────────────────────────────────
  function renderNewRequestForm(container) {
    _formAttachedImage = null;
    const fullName = _userProfile?.full_name || _activeUser?.user_metadata?.full_name || '';
    const email = _userProfile?.email || _activeUser?.email || '';
    const phone = _userProfile?.phone || '';

    container.innerHTML = `
      <div style="margin-bottom:16px;">
        <h4 style="font-size:1.1rem;font-weight:800;color:#ffffff;margin-bottom:4px;">Submit Support Request</h4>
        <p style="font-size:0.8rem;color:rgba(224,170,255,0.7);">Our 24/7 dedicated support team will review your query and reply in live chat.</p>
      </div>

      <form id="supportNewTicketForm" onsubmit="event.preventDefault(); window.SupportChat.submitNewTicket();">
        <div class="support-form-row">
          <div class="support-form-group">
            <label class="support-form-label">Full Name</label>
            <input type="text" id="suppInputName" class="support-form-input" value="${fullName}" required />
          </div>
          <div class="support-form-group">
            <label class="support-form-label">Email Address</label>
            <input type="email" id="suppInputEmail" class="support-form-input" value="${email}" required />
          </div>
        </div>

        <div class="support-form-row">
          <div class="support-form-group">
            <label class="support-form-label">Phone / WhatsApp (Optional)</label>
            <input type="tel" id="suppInputPhone" class="support-form-input" placeholder="+1234567890" value="${phone}" />
          </div>
          <div class="support-form-group">
            <label class="support-form-label">Department / Issue Type</label>
            <select id="suppSelectCategory" class="support-form-select">
              <option value="Rank & Package Upgrade">⚡ Package & Rank Upgrade</option>
              <option value="Deposit & Wallet Funding">💳 Deposit & Wallet Funding</option>
              <option value="Withdrawal & Payout">💸 Withdrawal & Payout</option>
              <option value="Direct & Reward Income">🎁 Direct & Reward Income</option>
              <option value="Account & Security">⚙️ Account & Login Security</option>
              <option value="General Inquiry" selected>💬 General Inquiry</option>
            </select>
          </div>
        </div>

        <div class="support-form-group">
          <label class="support-form-label">Subject / Issue Summary</label>
          <input type="text" id="suppInputSubject" class="support-form-input" placeholder="Brief summary of your question or issue…" required />
        </div>

        <div class="support-form-group">
          <label class="support-form-label">Detailed Message</label>
          <textarea id="suppInputMessage" class="support-form-textarea" placeholder="Explain your request in detail. If this is regarding a transaction, please include the Transaction ID or Amount." required></textarea>
        </div>

        <!-- Issue Screenshot / Image Upload Zone -->
        <div class="support-form-group">
          <label class="support-form-label">Attach Screenshot / Issue Proof (Optional)</label>
          <input type="file" id="suppFormFileInput" accept="image/*" style="display:none" onchange="window.SupportChat.handleFormFile(event)" />
          
          <div class="support-upload-zone" id="suppFormUploadZone" onclick="document.getElementById('suppFormFileInput').click()">
            <div class="support-upload-icon">📷</div>
            <div class="support-upload-title">Click to upload issue screenshot or error image</div>
            <div class="support-upload-subtitle">Supports JPG, PNG, WEBP (Max 5MB)</div>
          </div>

          <div id="suppFormImgPreviewWrap" style="display:none;"></div>
        </div>

        <button type="submit" id="suppSubmitBtn" class="support-submit-btn">
          <span>🚀</span> Start Support Chat
        </button>
      </form>
    `;
  }

  // ─── Handle Form Image Selection ────────────────────────────────────────────
  async function handleFormFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, WEBP).');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      _formAttachedImage = {
        file,
        dataUrl,
        name: file.name,
        size: (file.size / 1024).toFixed(1) + ' KB'
      };

      const previewWrap = document.getElementById('suppFormImgPreviewWrap');
      const uploadZone = document.getElementById('suppFormUploadZone');

      if (previewWrap && uploadZone) {
        uploadZone.style.display = 'none';
        previewWrap.style.display = 'block';
        previewWrap.innerHTML = `
          <div class="support-img-preview-box">
            <img src="${dataUrl}" class="support-preview-thumb" alt="Preview" />
            <div class="support-preview-meta">
              <div class="support-preview-filename">${escapeHtml(file.name)}</div>
              <div class="support-preview-size">${_formAttachedImage.size}</div>
            </div>
            <button type="button" class="support-preview-remove-btn" onclick="window.SupportChat.removeFormFile()">✕ Remove</button>
          </div>
        `;
      }
    } catch (e) {
      console.warn('Error previewing form image:', e);
    }
  }

  function removeFormFile() {
    _formAttachedImage = null;
    const previewWrap = document.getElementById('suppFormImgPreviewWrap');
    const uploadZone = document.getElementById('suppFormUploadZone');
    const fileInput = document.getElementById('suppFormFileInput');

    if (fileInput) fileInput.value = '';
    if (previewWrap) {
      previewWrap.innerHTML = '';
      previewWrap.style.display = 'none';
    }
    if (uploadZone) uploadZone.style.display = 'block';
  }

  // ─── Submit New Support Ticket ──────────────────────────────────────────────
  async function submitNewTicket() {
    const client = getClient();
    if (!client || !_activeUser) {
      alert('Please log in to submit a support request.');
      return;
    }

    const name = document.getElementById('suppInputName')?.value?.trim();
    const email = document.getElementById('suppInputEmail')?.value?.trim();
    const phone = document.getElementById('suppInputPhone')?.value?.trim() || null;
    const category = document.getElementById('suppSelectCategory')?.value || 'General Inquiry';
    const subject = document.getElementById('suppInputSubject')?.value?.trim();
    const message = document.getElementById('suppInputMessage')?.value?.trim();

    if (!subject || !message) {
      alert('Please fill out both the Subject and Message.');
      return;
    }

    const btn = document.getElementById('suppSubmitBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Uploading & Connecting…';
    }

    try {
      // 1. Process and upload screenshot if attached
      let finalImageUrl = null;
      if (_formAttachedImage) {
        finalImageUrl = await uploadOrEncodeImage(_formAttachedImage, _activeUser.id);
      }

      let convId = null;

      // 2. Try RPC function first (SECURITY DEFINER guarantees 100% permission bypass)
      try {
        const { data: rpcData, error: rpcErr } = await client.rpc('start_support_ticket', {
          p_subject: `[${category}] ${subject}`,
          p_message: message,
          p_phone: phone || null,
          p_image_url: finalImageUrl || null
        });

        if (!rpcErr && rpcData && (rpcData.conversation_id || rpcData.id)) {
          convId = rpcData.conversation_id || rpcData.id;
        } else if (rpcErr) {
          console.warn('RPC start_support_ticket note, trying direct insert fallback:', rpcErr.message);
        }
      } catch (rpcEx) {
        console.warn('RPC call failed, using direct insert:', rpcEx);
      }

      // 3. Fallback to direct table insert if RPC not installed
      if (!convId) {
        const { data: conv, error: convErr } = await client
          .from('support_conversations')
          .insert({
            user_id: _activeUser.id,
            subject: `[${category}] ${subject}`,
            status: 'open',
            unread_admin: 1,
            unread_user: 0,
            last_message: message,
            last_message_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (convErr) throw convErr;
        convId = conv.id;

        // Insert initial message (with image_url or fallback)
        let initialMsg = `${message}${phone ? `\n\n📞 Contact: ${phone}` : ''}`;
        let msgPayload = {
          conversation_id: convId,
          sender_id: _activeUser.id,
          sender_role: 'user',
          message: initialMsg,
          created_at: new Date().toISOString()
        };
        if (finalImageUrl) {
          msgPayload.image_url = finalImageUrl;
        }

        let { error: msgErr } = await client
          .from('support_messages')
          .insert(msgPayload);

        // Fallback: If image_url column doesn't exist in support_messages
        if (msgErr && msgErr.message && (msgErr.message.includes('image_url') || msgErr.message.includes('schema cache'))) {
          console.warn('support_messages table does not have image_url column, using embedded image fallback:', msgErr);
          delete msgPayload.image_url;
          if (finalImageUrl) {
            msgPayload.message = `${initialMsg}\n\n🖼️ [IMAGE_ATTACHMENT]: ${finalImageUrl}`;
          }
          const retryRes = await client.from('support_messages').insert(msgPayload);
          msgErr = retryRes.error;
        }

        if (msgErr) throw msgErr;
      }

      _formAttachedImage = null;

      // 4. Update active conversation and switch to chat
      _activeConvId = convId;
      await loadUserConversations();
      switchSupportTab('chat');

    } catch (err) {
      console.error('Support ticket error:', err);
      alert('Failed to start support ticket: ' + (err.message || 'Please try again.'));
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span>🚀</span> Start Support Chat';
      }
    }
  }

  // ─── Render: Live Chat Room ─────────────────────────────────────────────────
  async function renderChatRoom(container) {
    _chatAttachedImage = null;

    if (!_activeConvId || _conversations.length === 0) {
      renderNewRequestForm(container);
      return;
    }

    const currentConv = _conversations.find(c => c.id === _activeConvId) || _conversations[0];
    const isResolved = currentConv.status === 'resolved';

    container.innerHTML = `
      <div class="support-chat-room">
        <div class="support-chat-top-info">
          <div>
            <div class="support-chat-subject">${escapeHtml(currentConv.subject || 'Customer Support')}</div>
            <div style="font-size:0.72rem;color:rgba(255,255,255,0.5);margin-top:2px;">Ticket ID: #${currentConv.id.substring(0, 8).toUpperCase()}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="support-ticket-badge ${isResolved ? 'resolved' : 'open'}">${isResolved ? 'RESOLVED' : 'ACTIVE'}</span>
            <button class="support-btn-icon" onclick="window.SupportChat.switchTab('new')" title="New Request">➕</button>
          </div>
        </div>

        <div class="support-messages-stream" id="suppMsgStream">
          <div style="display:flex;justify-content:center;padding:20px;">
            <div style="color:var(--text-muted);font-size:0.82rem;">Loading chat stream…</div>
          </div>
        </div>

        <!-- Chat Image Preview Container -->
        <div id="suppChatImgPreviewBar" style="display:none;padding:8px 16px;background:rgba(14,6,36,0.98);border-top:1px solid rgba(199,125,255,0.2);"></div>

        <div class="support-chat-input-bar">
          <input type="file" id="suppChatFileInput" accept="image/*" style="display:none" onchange="window.SupportChat.handleChatFile(event)" />
          
          <button class="support-chat-attach-btn" onclick="document.getElementById('suppChatFileInput').click()" title="Attach Screenshot or Image">📷</button>

          <input type="text" id="suppChatMsgInput" class="support-chat-input" placeholder="${isResolved ? 'This ticket is resolved. Type to reply and reopen…' : 'Type your reply to support…'}" onkeydown="if(event.key==='Enter') window.SupportChat.sendMessage();" />
          
          <button class="support-chat-send-btn" onclick="window.SupportChat.sendMessage()" title="Send Message">➤</button>
        </div>
      </div>
    `;

    // Mark unread for user as 0
    const client = getClient();
    if (client) {
      client.from('support_conversations').update({ unread_user: 0 }).eq('id', _activeConvId).then();
    }

    // Load messages stream
    await loadMessagesStream(_activeConvId);

    // Subscribe to realtime changes
    if (_realtimeSub) _realtimeSub.unsubscribe();
    if (client) {
      _realtimeSub = client.channel('user-conv-' + _activeConvId)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `conversation_id=eq.${_activeConvId}`
        }, () => {
          loadMessagesStream(_activeConvId);
        })
        .subscribe();
    }
  }

  // ─── Handle Live Chat Image Attachment ──────────────────────────────────────
  async function handleChatFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      _chatAttachedImage = {
        file,
        dataUrl,
        name: file.name,
        size: (file.size / 1024).toFixed(1) + ' KB'
      };

      const previewBar = document.getElementById('suppChatImgPreviewBar');
      if (previewBar) {
        previewBar.style.display = 'block';
        previewBar.innerHTML = `
          <div class="support-img-preview-box" style="margin-top:0;">
            <img src="${dataUrl}" class="support-preview-thumb" alt="Preview" />
            <div class="support-preview-meta">
              <div class="support-preview-filename">${escapeHtml(file.name)}</div>
              <div class="support-preview-size">${_chatAttachedImage.size}</div>
            </div>
            <button type="button" class="support-preview-remove-btn" onclick="window.SupportChat.removeChatFile()">✕ Cancel</button>
          </div>
        `;
      }
    } catch (e) {
      console.warn('Error reading chat image:', e);
    }
  }

  function removeChatFile() {
    _chatAttachedImage = null;
    const previewBar = document.getElementById('suppChatImgPreviewBar');
    const fileInput = document.getElementById('suppChatFileInput');
    if (fileInput) fileInput.value = '';
    if (previewBar) {
      previewBar.innerHTML = '';
      previewBar.style.display = 'none';
    }
  }

  // ─── Load Messages for Chat Room ────────────────────────────────────────────
  async function loadMessagesStream(convId) {
    const stream = document.getElementById('suppMsgStream');
    if (!stream) return;

    const client = getClient();
    if (!client) return;

    try {
      const { data: messages, error } = await client
        .from('support_messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (!messages || messages.length === 0) {
        stream.innerHTML = `
          <div style="text-align:center;padding:30px;color:rgba(224,170,255,0.6);font-size:0.85rem;">
            💬 No messages in this ticket yet. Send a message below.
          </div>
        `;
        return;
      }

      stream.innerHTML = messages.map(m => {
        const isAdmin = m.sender_role === 'admin';
        let imgUrl = m.image_url || null;
        let displayMsg = m.message || '';

        // Extract embedded image fallback if present
        if (!imgUrl && displayMsg.includes('[IMAGE_ATTACHMENT]:')) {
          const parts = displayMsg.split('[IMAGE_ATTACHMENT]:');
          displayMsg = parts[0].replace(/🖼️/g, '').trim();
          imgUrl = (parts[1] || '').trim();
        }

        return `
          <div class="support-msg ${isAdmin ? 'admin' : 'user'}">
            <div class="support-msg-sender">
              ${isAdmin ? '🛡️ Support Desk' : '👤 You'}
            </div>
            <div class="support-msg-bubble">
              ${displayMsg ? escapeHtml(displayMsg).replace(/\n/g, '<br>') : ''}
              
              ${imgUrl ? `
                <div class="support-msg-img-container" onclick="window.SupportChat.openImageModal('${imgUrl.replace(/'/g, "\\'")}')">
                  <img src="${imgUrl}" class="support-msg-img" alt="Attached Screenshot" loading="lazy" />
                  <span class="support-msg-img-zoom-tag">🔍 View Full Image</span>
                </div>
              ` : ''}
            </div>
            <div class="support-msg-time">
              ${formatChatTime(m.created_at)}
            </div>
          </div>
        `;
      }).join('');

      // Auto scroll to bottom
      stream.scrollTop = stream.scrollHeight;

    } catch (e) {
      console.warn('Error loading messages stream:', e);
    }
  }

  // ─── Send User Reply Message ────────────────────────────────────────────────
  async function sendMessage() {
    if (!_activeConvId || !_activeUser) return;
    const input = document.getElementById('suppChatMsgInput');
    const sendBtn = document.querySelector('.support-chat-send-btn');
    const msg = input?.value?.trim() || '';
    
    if (!msg && !_chatAttachedImage) return;

    const client = getClient();
    if (!client) return;

    if (input) {
      input.value = '';
      input.disabled = true;
    }
    if (sendBtn) sendBtn.disabled = true;

    try {
      let finalImg = null;
      if (_chatAttachedImage) {
        finalImg = await uploadOrEncodeImage(_chatAttachedImage, _activeUser.id);
        removeChatFile();
      }

      const textToSend = msg || '📎 [Attached Screenshot]';
      let msgPayload = {
        conversation_id: _activeConvId,
        sender_id: _activeUser.id,
        sender_role: 'user',
        message: textToSend,
        created_at: new Date().toISOString()
      };
      if (finalImg) {
        msgPayload.image_url = finalImg;
      }

      let { error: msgErr } = await client
        .from('support_messages')
        .insert(msgPayload);

      // Fallback if image_url column doesn't exist
      if (msgErr && msgErr.message && (msgErr.message.includes('image_url') || msgErr.message.includes('schema cache'))) {
        console.warn('support_messages does not have image_url column, using embedded fallback');
        delete msgPayload.image_url;
        if (finalImg) {
          msgPayload.message = `${textToSend}\n\n🖼️ [IMAGE_ATTACHMENT]: ${finalImg}`;
        }
        const retryRes = await client.from('support_messages').insert(msgPayload);
        msgErr = retryRes.error;
      }

      if (msgErr) throw msgErr;

      // Update conversation last message & unread_admin
      await client.from('support_conversations').update({
        status: 'open',
        last_message: textToSend,
        last_message_at: new Date().toISOString(),
        unread_admin: 1,
        updated_at: new Date().toISOString()
      }).eq('id', _activeConvId);

      await loadMessagesStream(_activeConvId);
    } catch (err) {
      console.error('Send message error:', err);
      alert('Failed to send message: ' + err.message);
      if (input) input.value = msg;
    } finally {
      if (input) {
        input.disabled = false;
        input.focus();
      }
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  // ─── Render: Ticket History List ────────────────────────────────────────────
  function renderHistoryList(container) {
    if (_conversations.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:50px 20px;">
          <div style="font-size:2.5rem;margin-bottom:12px;">📁</div>
          <div style="font-weight:700;font-size:1rem;color:#ffffff;margin-bottom:6px;">No Support Tickets Found</div>
          <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:18px;">You haven't opened any support requests yet.</p>
          <button class="support-submit-btn" style="width:auto;padding:10px 22px;margin:auto;" onclick="window.SupportChat.switchTab('new')">Open New Ticket 🚀</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
        <h4 style="font-size:1rem;font-weight:800;color:#ffffff;">Your Support Tickets (${_conversations.length})</h4>
        <button class="support-submit-btn" style="width:auto;padding:6px 14px;font-size:0.8rem;margin:0;" onclick="window.SupportChat.switchTab('new')">➕ New Request</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;">
        ${_conversations.map(c => `
          <div class="support-history-item" onclick="window.SupportChat.selectConversation('${c.id}')">
            <div>
              <div style="font-weight:700;font-size:0.9rem;color:#ffffff;margin-bottom:4px;">${escapeHtml(c.subject || 'Support Ticket')}</div>
              <div style="font-size:0.76rem;color:rgba(224,170,255,0.7);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.last_message || 'No messages')}</div>
              <div style="font-size:0.68rem;color:var(--text-muted);margin-top:4px;">${formatChatTime(c.updated_at || c.created_at)}</div>
            </div>
            <div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
              <span class="support-ticket-badge ${c.status === 'resolved' ? 'resolved' : 'open'}">${c.status}</span>
              ${c.unread_user > 0 ? `<span style="background:#ff0055;color:#fff;font-size:0.68rem;font-weight:800;padding:2px 8px;border-radius:10px;">${c.unread_user} new</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function selectConversation(convId) {
    _activeConvId = convId;
    switchSupportTab('chat');
  }

  // ─── Fullscreen Image Lightbox Modal ────────────────────────────────────────
  function openImageModal(imageUrl) {
    if (!imageUrl) return;
    let lightbox = document.getElementById('supportLightboxModal');
    if (!lightbox) {
      const html = `
        <div class="support-lightbox-modal" id="supportLightboxModal" onclick="if(event.target===this) window.SupportChat.closeImageModal()">
          <div class="support-lightbox-content">
            <button class="support-lightbox-close" onclick="window.SupportChat.closeImageModal()">✕</button>
            <img src="" id="supportLightboxImg" class="support-lightbox-img" alt="Zoomed Screenshot" />
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', html);
      lightbox = document.getElementById('supportLightboxModal');
    }

    const img = document.getElementById('supportLightboxImg');
    if (img) img.src = imageUrl;
    if (lightbox) lightbox.classList.add('active');
  }

  function closeImageModal() {
    const lightbox = document.getElementById('supportLightboxModal');
    if (lightbox) lightbox.classList.remove('active');
  }

  // ─── Modal HTML Injection Helper ────────────────────────────────────────────
  function injectSupportModalHtml() {
    if (document.getElementById('supportModalBackdrop')) return;

    const modalHtml = `
      <div class="support-modal-backdrop" id="supportModalBackdrop" onclick="if(event.target===this) window.SupportChat.closeModal();">
        <div class="support-modal-card">
          <!-- Header -->
          <div class="support-modal-header">
            <div class="support-header-left">
              <div class="support-header-avatar">🛡️</div>
              <div>
                <div class="support-header-title">
                  BITCHAIN SUPPORT
                </div>
                <div class="support-header-status">
                  <span class="status-dot-pulse"></span> 24/7 Live Desk Online
                </div>
              </div>
            </div>
            <div class="support-header-actions">
              <button class="support-btn-icon" onclick="window.SupportChat.closeModal()" title="Close">✕</button>
            </div>
          </div>

          <!-- Tabs -->
          <div class="support-tabs-bar">
            <button class="support-tab-btn active" id="tabBtnSupportChat" onclick="window.SupportChat.switchTab('chat')">💬 Live Chat</button>
            <button class="support-tab-btn" id="tabBtnSupportNew" onclick="window.SupportChat.switchTab('new')">➕ New Request</button>
            <button class="support-tab-btn" id="tabBtnSupportHistory" onclick="window.SupportChat.switchTab('history')">📁 My Tickets</button>
          </div>

          <!-- Body -->
          <div class="support-modal-body" id="supportModalBody">
            <!-- Dynamic Tab Content -->
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  // ─── Format Utilities ───────────────────────────────────────────────────────
  function formatChatTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
        d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return dateStr;
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Global Export ──────────────────────────────────────────────────────────
  window.SupportChat = {
    openModal: openSupportChatModal,
    closeModal: closeSupportChatModal,
    switchTab: switchSupportTab,
    submitNewTicket: submitNewTicket,
    sendMessage: sendMessage,
    selectConversation: selectConversation,
    checkUnread: checkUnreadSupport,
    handleFormFile: handleFormFile,
    removeFormFile: removeFormFile,
    handleChatFile: handleChatFile,
    removeChatFile: removeChatFile,
    openImageModal: openImageModal,
    closeImageModal: closeImageModal
  };

  // Helper alias for onclick buttons
  window.openSupportChatModal = openSupportChatModal;

  // Auto initialize on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    initSupportModule();
  });
})();
