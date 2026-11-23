export default {
  props: ['overlays', 'currentOverlay', 'total', 'errorCount', 'successCount', 'uniquePaths'],
  emits: ['apply-overlay'],
  data() {
    return {
      selectedOverlay: '',
      overlayFilter: '',
      showOverlayFilter: false
    };
  },
  watch: {
    currentOverlay: {
      immediate: true,
      handler(value) {
        this.selectedOverlay = value || '';
      }
    }
  },
  computed: {
    filteredOverlays() {
      const query = this.overlayFilter.trim().toLowerCase();
      return query
        ? this.overlays.filter(overlay => overlay.toLowerCase().includes(query))
        : this.overlays;
    }
  },
  methods: {
    applyOverlay() {
      this.$emit('apply-overlay', this.selectedOverlay);
    },
    clearOverlay() {
      this.selectedOverlay = '';
      this.applyOverlay();
    }
  },
  template: `
    <aside>
      <div class="sb-block">
        <div class="ov-label-row">
          <div class="sb-label">Overlay</div>
          <button class="btn-ov-filter" :class="{ on: showOverlayFilter }"
            @click="showOverlayFilter = !showOverlayFilter" title="Filter by name">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 2.5h10M3 6h6M5 9.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div v-if="showOverlayFilter" class="ov-filter-wrap">
          <input class="ov-filter" v-model="overlayFilter" placeholder="Filter by name…" />
          <button v-if="overlayFilter" class="ov-filter-clear" @click="overlayFilter = ''" title="Clear filter">✕</button>
        </div>
        <select class="ov-select" v-model="selectedOverlay" @change="applyOverlay">
          <option value="">— none —</option>
          <option v-for="overlay in filteredOverlays" :key="overlay" :value="overlay">{{ overlay }}</option>
        </select>
        <div class="ov-active">
          <template v-if="currentOverlay">
            <span class="ov-name" :title="currentOverlay">◈ {{ currentOverlay }}</span>
            <button class="btn btn-red" @click.stop="clearOverlay">✕ clear</button>
          </template>
          <span v-else class="ov-none">no active overlay</span>
        </div>
      </div>
      <div class="sb-block">
        <div class="sb-label">Stats</div>
        <div class="stats-grid">
          <div class="stat"><div class="stat-n c-w">{{ total }}</div><div class="stat-l">TOTAL</div></div>
          <div class="stat"><div class="stat-n c-r">{{ errorCount }}</div><div class="stat-l">ERRORS</div></div>
          <div class="stat"><div class="stat-n c-g">{{ successCount }}</div><div class="stat-l">SUCCESS</div></div>
          <div class="stat"><div class="stat-n c-a">{{ uniquePaths }}</div><div class="stat-l">UNIQUE</div></div>
        </div>
      </div>
    </aside>
  `
};
