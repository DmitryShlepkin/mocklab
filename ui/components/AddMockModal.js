export default {
  props: ['visible', 'uri', 'method', 'target', 'content', 'error'],
  emits: ['update-content', 'close', 'submit'],
  template: `
    <div v-if="visible" class="modal-backdrop" @click.self="$emit('close')">
      <div class="modal">
        <div class="modal-head">
          <span class="modal-title">ADD MOCK</span>
          <button class="modal-close" @click="$emit('close')" title="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="modal-meta">
            <div class="modal-meta-row">
              <span class="badge" :class="'b-' + method">{{ method }}</span>
              <span class="modal-uri" :title="uri">{{ uri }}</span>
            </div>
            <div class="modal-dest">→ <b>{{ target }}</b></div>
          </div>
          <textarea class="modal-input" :class="{ invalid: error }" :value="content"
            @input="$emit('update-content', $event.target.value)" spellcheck="false"
            placeholder='{\n  "message": "hello"\n}'></textarea>
          <div v-if="error" class="modal-error">{{ error }}</div>
        </div>
        <div class="modal-actions">
          <button class="modal-btn modal-btn-ghost" @click="$emit('close')">Cancel</button>
          <button class="modal-btn modal-btn-go" @click="$emit('submit')">Save Mock</button>
        </div>
      </div>
    </div>
  `
};
