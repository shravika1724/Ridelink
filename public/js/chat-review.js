/**
 * RideLink In-App Trip Messaging & Customer Review System
 */

const ChatReview = {
  activeBookingId: null,
  activeRecipientName: null,

  // 1. Open Trip Chat Modal
  async openChat(bookingId, recipientName) {
    this.activeBookingId = bookingId;
    this.activeRecipientName = recipientName || 'Host';

    document.getElementById('chat-recipient-title').textContent = `Chat with ${this.activeRecipientName}`;
    openModal('modal-trip-chat');

    await this.loadMessages();
  },

  async loadMessages() {
    const chatContainer = document.getElementById('chat-messages-container');
    if (!chatContainer) return;

    try {
      const res = await api.get(`/bookings/${this.activeBookingId}/messages`);
      const msgs = res.messages || [];

      if (msgs.length === 0) {
        chatContainer.innerHTML = `
          <div style="text-align: center; color: var(--text-dim); padding: 2rem 1rem; font-size: 0.85rem;">
            <i class="fas fa-comments" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
            Start the conversation with ${this.activeRecipientName} for pickup coordination, key handover, or trip updates.
          </div>
        `;
        return;
      }

      const currentUser = api.getUser();

      chatContainer.innerHTML = msgs.map(m => {
        const isMe = currentUser && m.sender_id === currentUser.id;

        return `
          <div style="display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin-bottom: 0.85rem;">
            <div style="font-size: 0.7rem; color: var(--text-dim); margin-bottom: 0.2rem;">
              ${m.sender_name} • ${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style="
              max-width: 80%;
              padding: 0.65rem 1rem;
              border-radius: ${isMe ? '16px 16px 2px 16px' : '16px 16px 16px 2px'};
              background: ${isMe ? 'var(--gradient-primary)' : 'rgba(255, 255, 255, 0.08)'};
              color: ${isMe ? 'var(--bg-darkest)' : 'var(--text-main)'};
              font-weight: ${isMe ? '600' : 'normal'};
              font-size: 0.875rem;
              line-height: 1.4;
              word-break: break-word;
            ">
              ${m.message_text}
            </div>
          </div>
        `;
      }).join('');

      // Auto scroll to bottom
      chatContainer.scrollTop = chatContainer.scrollHeight;

    } catch (err) {
      console.error('Chat load error:', err);
    }
  },

  async sendMessage(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('chat-input-text');
    const text = input?.value?.trim();

    if (!text || !this.activeBookingId) return;

    try {
      input.value = '';
      await api.post(`/bookings/${this.activeBookingId}/messages`, { text });
      await this.loadMessages();

      // If customer sent message, simulate friendly instant host acknowledgement!
      const user = api.getUser();
      if (user && user.role === 'customer') {
        setTimeout(async () => {
          this.loadMessages();
        }, 800);
      }
    } catch (err) {
      showToast(err.message || 'Failed to send message', 'error');
    }
  },

  // 2. Open Review Modal
  openReviewModal(bookingId, vehicleTitle) {
    this.activeBookingId = bookingId;
    document.getElementById('review-vehicle-title').textContent = vehicleTitle || 'Vehicle';
    document.getElementById('review-comment-input').value = '';
    this.setRating(5);
    openModal('modal-trip-review');
  },

  setRating(rating) {
    this.selectedRating = rating;
    document.querySelectorAll('.star-btn').forEach(btn => {
      const val = parseInt(btn.dataset.val);
      if (val <= rating) {
        btn.classList.add('active');
        btn.innerHTML = '★';
      } else {
        btn.classList.remove('active');
        btn.innerHTML = '☆';
      }
    });
  },

  async submitReview(e) {
    e.preventDefault();
    const comment = document.getElementById('review-comment-input').value;

    try {
      const res = await api.post(`/bookings/${this.activeBookingId}/review`, {
        rating: this.selectedRating || 5,
        comment
      });

      closeModal();
      showToast(res.message);
      if (window.CustomerDash) window.CustomerDash.loadData();
    } catch (err) {
      showToast(err.message || 'Failed to submit review', 'error');
    }
  }
};

window.ChatReview = ChatReview;
