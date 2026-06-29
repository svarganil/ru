(function () {
  const filterId = 'menu-ripple-filter-defs';
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
<svg id="${filterId}" class="menu-ripple-filters" width="0" height="0" aria-hidden="true" focusable="false">
  <defs>
    <filter id="menu-squiggly-0">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="0"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-1">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="1"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-2">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="2"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="2"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-3">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="3"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="3"></feDisplacementMap>
    </filter>
    <filter id="menu-squiggly-4">
      <feTurbulence baseFrequency="0.02" numOctaves="3" result="noise" seed="4"></feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1"></feDisplacementMap>
    </filter>
  </defs>
</svg>`);
  };

  const init = (root = document) => {
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
