export default {
  props: ['methodFilter', 'search', 'refreshing'],
  emits: ['set-method', 'set-search', 'refresh', 'clear-history'],
  template: `
    <div class="log-bar">
      <span class="bar-title">REQUESTS</span>
      <div class="fbtns">
        <button v-for="method in ['ALL','GET','POST','PUT','DELETE','PATCH']" :key="method"
          class="fbtn" :class="{ on: methodFilter === method }"
          @click="$emit('set-method', method)">{{ method }}</button>
      </div>
      <input class="search" :value="search" @input="$emit('set-search', $event.target.value)"
        placeholder="filter path…" />
      <button class="btn-refresh" :class="{ spin: refreshing }" @click="$emit('refresh')" title="Refresh list">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M10.5 1.5v4.5H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        REFRESH
      </button>
      <button class="btn-refresh btn-clear" @click="$emit('clear-history')" title="Clear request history">CLEAR</button>
    </div>
  `
};
