export default {
  props: ['connected', 'serverUrl'],
  template: `
    <header>
      <div class="logo"><div class="logo-dot"></div>MOCKLAB</div>
      <div class="conn-dot" :class="{ off: !connected }" :title="connected ? 'Live' : 'Reconnecting…'"></div>
      <div class="header-sep"></div>
      <a class="mocklab-link" :href="serverUrl" target="_blank">↗ mocklab :{{ serverUrl.split(':').pop() }}</a>
    </header>
  `
};
