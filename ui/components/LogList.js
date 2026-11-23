export default {
  props: ['entries', 'openId', 'fmt', 'hasContent'],
  emits: ['toggle-open', 'open-add-mock'],
  template: `
    <div class="log-list">
      <template v-if="entries.length > 0">
        <div v-for="entry in entries" :key="entry.id"
          class="entry" :class="{ 'is-err': entry.status >= 400, open: openId === entry.id }"
          @click="$emit('toggle-open', entry.id)">
          <div class="entry-row">
            <span class="badge" :class="'b-' + entry.method">{{ entry.method }}</span>
            <span class="status" :class="entry.status >= 400 ? 'err' : 'ok'">{{ entry.status }}</span>
            <span class="uri" :title="entry.uri">{{ entry.uri }}</span>
            <span v-if="entry.status >= 400" class="tag-err">{{ entry.status }}</span>
          </div>
          <div v-if="openId === entry.id" class="detail">
            <div class="d-row">
              <span class="d-label">FILE PATH</span>
              <div class="d-val">{{ entry.filePath || '—' }}</div>
            </div>
            <div v-if="hasContent(entry.body)" class="d-row">
              <span class="d-label">BODY</span>
              <div class="d-val">{{ fmt(entry.body) }}</div>
            </div>
            <div v-if="hasContent(entry.query)" class="d-row">
              <span class="d-label">QUERY PARAMS</span>
              <div class="d-val">{{ fmt(entry.query) }}</div>
            </div>
            <div v-if="hasContent(entry.headers)" class="d-row">
              <span class="d-label">REQUEST HEADERS</span>
              <div class="d-val">{{ fmt(entry.headers) }}</div>
            </div>
            <div v-if="hasContent(entry.responseHeaders)" class="d-row">
              <span class="d-label">RESPONSE HEADERS</span>
              <div class="d-val">{{ fmt(entry.responseHeaders) }}</div>
            </div>
            <div v-if="hasContent(entry.responseBody)" class="d-row">
              <span class="d-label">RESPONSE BODY</span>
              <div class="d-val d-val-tall">{{ fmt(entry.responseBody) }}</div>
            </div>
            <div v-if="!entry.filePath && !entry.mockExists" class="d-row detail-foot">
              <button class="btn-add-mock" @click.stop="$emit('open-add-mock', entry)">+ Add Mock</button>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="empty">
        <div class="empty-ico">⬡</div>
        <span>no requests yet</span>
      </div>
    </div>
  `
};
