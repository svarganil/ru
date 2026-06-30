(function () {
  const filterId = 'menu-ripple-filter-defs';
  const isiOSWebKit = () => {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  const rippleTargets = [
    '#menu-label',
    '.menu-links a',
    '.menu-divider',
    '.menu-divider-dash',
    '.menu-subtitle',
    '.menu-bio',
    '.menu-meta-row',
    '.menu-icon-row',
    '.menu-marquee-track',
    '.menu-button',
    '.menu-footer'
  ];

  const injectFilters = () => {
    if (document.getElementById(filterId)) return;

    document.body.insertAdjacentHTML('afterbegin', `
<svg id="${filterId}" class="menu-ripple-filters" width="1" height="1" aria-hidden="true" focusable="false">
  <defs>
    <filter id="menu-squiggly-0" x="-100%" y="-100%" width="300%" height="300%">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="0"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-1" x="-100%" y="-100%" width="300%" height="300%">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="1"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-2" x="-100%" y="-100%" width="300%" height="300%">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="2"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-3" x="-100%" y="-100%" width="300%" height="300%">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="3"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-4" x="-100%" y="-100%" width="300%" height="300%">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="4"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1"></feDisplacementMap>
    </filter>
  </defs>
</svg>`);
  };

  const init = (root = document) => {
    if (isiOSWebKit()) {
      document.documentElement.classList.add('ios-webkit');
    }

    injectFilters();
    root.querySelectorAll(rippleTargets.join(',')).forEach((element) => {
      element.classList.add('menu-ripple-target');
    });
  };

  const setText = (element, text) => {
    if (!element) return;
    element.textContent = text;
    element.classList.add('menu-ripple-target');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  } else {
    init();
  }

  window.menuRipple = {
    init,
    setText
  };
})();
