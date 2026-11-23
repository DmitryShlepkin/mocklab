import Header from './components/Header.js';
import Sidebar from './components/Sidebar.js';
import LogToolbar from './components/LogToolbar.js';
import LogList from './components/LogList.js';
import AddMockModal from './components/AddMockModal.js';

const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

createApp({
  components: {
    HeaderComponent: Header,
    SidebarComponent: Sidebar,
    LogToolbar: LogToolbar,
    LogList: LogList,
    AddMockModal: AddMockModal
  },
  setup() {
    const history = ref([]);
    const overlays = ref([]);
    const currentOverlay = ref(null);
    const methodFilter = ref('ALL');
    const search = ref('');
    const connected = ref(false);
    const refreshing = ref(false);
    const openId = ref(null);
    const toast = ref('');
    const showAddMock = ref(false);
    const addMockEntry = ref(null);
    const addMockJson = ref('');
    const addMockError = ref('');
    let toastTimer = null;
    let eventStream = null;

    const serverUrl = computed(() => {
      const currentPort = Number(location.port) || (location.protocol === 'https:' ? 443 : 80);
      const port = currentPort > 3232 ? currentPort - 1 : 3232;
      return `${location.protocol}//${location.hostname}:${port}`;
    });

    const showToast = message => {
      toast.value = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.value = ''; }, 2400);
    };

    const fmt = value => {
      if (!value) return '—';
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    };

    const hasContent = value => value
      && (typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value));

    const sendEvent = async message => {
      const response = await fetch('/__events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Event request failed');
      }
      return data;
    };

    const connect = () => {
      eventStream = new EventSource('/__events');
      eventStream.onopen = () => { connected.value = true; };
      eventStream.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'reload') {
          window.location.reload();
          return;
        }
        if (data.type === 'snapshot' || data.type === 'state') {
          history.value = data.history;
          currentOverlay.value = data.overlay;
          overlays.value = data.overlays;
        }
      };
      eventStream.onerror = () => {
        connected.value = false;
        eventStream.close();
        setTimeout(connect, 2000);
      };
    };

    const applyOverlay = async overlay => {
      const value = overlay || null;
      try {
        await sendEvent({ type: 'set-overlay', overlay: value });
        showToast(value ? 'Overlay → ' + value : 'Overlay cleared');
      } catch (error) {
        showToast('Overlay update failed: ' + error.message);
      }
    };

    const clearHistory = async () => {
      try {
        await sendEvent({ type: 'clear-history' });
      } catch (error) {
        showToast('History clear failed: ' + error.message);
      }
    };

    const refresh = () => {
      refreshing.value = true;
      openId.value = null;
      history.value = [...history.value];
      setTimeout(() => { refreshing.value = false; }, 500);
    };

    const filteredHistory = computed(() => {
      let entries = history.value;
      if (methodFilter.value !== 'ALL') {
        entries = entries.filter(entry => entry.method === methodFilter.value);
      }
      const query = search.value.trim().toLowerCase();
      if (query) entries = entries.filter(entry => entry.uri.toLowerCase().includes(query));
      return entries;
    });
    const errorCount = computed(() => history.value.filter(entry => entry.error).length);
    const successCount = computed(() => history.value.filter(entry => !entry.error).length);
    const uniquePaths = computed(() => new Set(history.value.map(entry => entry.uri.split('?')[0])).size);

    const computeTargetPath = (uri, method) => {
      if (!uri) return '';
      method = (method || 'GET').toUpperCase();
      const queryIndex = uri.indexOf('?');
      const rawPath = queryIndex >= 0 ? uri.slice(0, queryIndex) : uri;
      const queryString = queryIndex >= 0 ? uri.slice(queryIndex + 1) : '';
      let requestPath = rawPath === '/' || rawPath === '' ? '/index' : rawPath;
      if (!requestPath.startsWith('/')) requestPath = '/' + requestPath;
      const extensionMatch = requestPath.match(/\.([a-z0-9]+)$/i);
      const extension = extensionMatch ? extensionMatch[1] : 'json';
      const pathWithoutExtension = requestPath.replace(/\.[a-z0-9]+$/i, '');
      const methodSuffix = method !== 'GET' ? '-method-' + method.toLowerCase() : '';
      const firstPair = queryString.split('&').filter(Boolean)[0];
      if (firstPair) {
        const equals = firstPair.indexOf('=');
        const name = equals >= 0 ? firstPair.slice(0, equals) : firstPair;
        const value = equals >= 0 ? firstPair.slice(equals + 1) : '';
        const paramFile = value ? `[${name}=${value}]` : `[${name}]`;
        return 'mocks' + pathWithoutExtension + '/' + paramFile + methodSuffix + '.' + extension;
      }
      return 'mocks' + pathWithoutExtension + methodSuffix + '.' + extension;
    };

    const addMockUri = computed(() => addMockEntry.value ? addMockEntry.value.uri : '');
    const addMockMethod = computed(() => addMockEntry.value ? addMockEntry.value.method : 'GET');
    const addMockTarget = computed(() => addMockEntry.value
      ? computeTargetPath(addMockEntry.value.uri, addMockEntry.value.method)
      : '');

    const openAddMock = entry => {
      addMockEntry.value = entry;
      addMockError.value = '';
      const seed = entry && entry.responseBody && typeof entry.responseBody === 'object' && entry.status < 400
        ? entry.responseBody
        : {};
      addMockJson.value = JSON.stringify(seed, null, 2);
      showAddMock.value = true;
    };

    const closeAddMock = () => {
      showAddMock.value = false;
      addMockEntry.value = null;
      addMockError.value = '';
    };

    const submitAddMock = async () => {
      try {
        JSON.parse(addMockJson.value);
      } catch (error) {
        addMockError.value = 'Invalid JSON: ' + error.message;
        return;
      }
      try {
        const data = await sendEvent({
          type: 'add-mock',
          uri: addMockEntry.value.uri,
          method: addMockEntry.value.method,
          content: JSON.parse(addMockJson.value)
        });
        showToast('Mock saved → ' + data.path);
        closeAddMock();
      } catch (error) {
        addMockError.value = 'Request failed: ' + error.message;
      }
    };

    onMounted(() => {
      connect();
    });
    onUnmounted(() => {
      if (eventStream) eventStream.close();
      clearTimeout(toastTimer);
    });

    return {
      history, overlays, currentOverlay, methodFilter, search, connected, refreshing, openId, toast,
      showAddMock, addMockJson, addMockError, addMockUri, addMockMethod, addMockTarget,
      serverUrl, filteredHistory, errorCount, successCount, uniquePaths, fmt, hasContent,
      applyOverlay, clearHistory, refresh, openAddMock, closeAddMock, submitAddMock
    };
  },
  template: `
    <header-component :connected="connected" :server-url="serverUrl"></header-component>
    <main>
      <sidebar-component :overlays="overlays" :current-overlay="currentOverlay"
        :total="history.length" :error-count="errorCount" :success-count="successCount"
        :unique-paths="uniquePaths" @apply-overlay="applyOverlay"></sidebar-component>
      <div class="log-pane">
        <log-toolbar :method-filter="methodFilter" :search="search" :refreshing="refreshing"
          @set-method="methodFilter = $event" @set-search="search = $event"
          @refresh="refresh" @clear-history="clearHistory"></log-toolbar>
        <log-list :entries="filteredHistory" :open-id="openId" :fmt="fmt" :has-content="hasContent"
          @toggle-open="openId = openId === $event ? null : $event"
          @open-add-mock="openAddMock"></log-list>
      </div>
    </main>
    <add-mock-modal :visible="showAddMock" :uri="addMockUri" :method="addMockMethod"
      :target="addMockTarget" :content="addMockJson" :error="addMockError"
      @update-content="addMockJson = $event" @close="closeAddMock" @submit="submitAddMock"></add-mock-modal>
    <div v-if="toast" class="toast">{{ toast }}</div>
  `
}).mount('#app');
