'use strict';

(() => {
  const slides = Array.from(document.querySelectorAll('.slide'));
  const params = new URLSearchParams(location.search);
  const capture = params.get('capture') === '1';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const groups = [
    { id: 'partners', label: 'Partners' },
    { id: 'compute', label: 'Compute' },
    { id: 'robots', label: 'Robots' },
    { id: 'funding', label: 'Funding' }
  ];
  const $ = (id) => document.getElementById(id);
  let current = 0;
  let idleEnabled = false;
  let manuallyPaused = false;
  let sponsors = [];
  let stations = [];
  let selectedStation = null;
  let mapZoom = 1;
  let layoutEntry = 'first';
  let slideFade = null;
  const mapViews = [
    { figure: 'map-figure', highlights: 'map-highlights', popup: 'station-popup' },
    { figure: 'expanded-map-figure', highlights: 'expanded-map-highlights', popup: 'expanded-station-popup' }
  ];
  const robotIllustrations = {
    Pandroid: 'pandroid.svg',
    YAM: 'yam.svg',
    OpenYAM: 'openyam.svg',
    'Nero Arms': 'nero-arms.svg',
    'Unitree G1': 'unitree-g1.svg',
    'Unitree GO2': 'unitree-go2.svg'
  };

  function slideIndex(id) {
    return slides.findIndex((slide) => slide.id === id);
  }

  document.body.classList.toggle('capture-mode', capture);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function announce(message) {
    $('announcer').textContent = message;
  }

  function slideFromURL() {
    const hash = location.hash.slice(1);
    const named = slides.findIndex((slide) => slide.id === hash);
    if (named !== -1) return named;
    const number = Number(hash || new URLSearchParams(location.search).get('slide') || 1);
    return Number.isInteger(number) && number >= 1 && number <= slides.length ? number - 1 : 0;
  }

  function goToSlide(index, updateURL = true, entry = 'first') {
    const next = Math.max(0, Math.min(slides.length - 1, index));
    if (!Number.isInteger(next)) return;
    if (idleEnabled && next !== 0) {
      setIdle(false, next, updateURL);
      return;
    }
    const previous = current;
    const focusWasInSlide = slides[current].contains(document.activeElement);
    slideFade?.cancel();
    slideFade = null;
    current = next;
    slides.forEach((slide, i) => {
      slide.hidden = i !== current;
      slide.classList.toggle('active', i === current);
      slide.setAttribute('aria-hidden', String(i !== current));
    });
    document.querySelectorAll('.section-nav [data-go]').forEach((button) => {
      if (button.dataset.go === slides[current].id) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    if (slides[current].id === 'map-layout') {
      layoutEntry = entry;
      const station = entry === 'last' ? stations.at(-1) : stations[0];
      if (station) selectStation(station.id);
    }
    updateNavigationControls();
    $('slide-counter').textContent = `${current + 1} / ${slides.length}`;
    document.title = `${slides[current].dataset.title} — Robotics Safety Hackathon`;
    document.body.dataset.slide = String(current + 1);
    if (updateURL) {
      const url = new URL(location.href);
      url.hash = idleEnabled ? 'idle' : slides[current].id;
      if (idleEnabled) url.searchParams.set('idle', '1');
      else url.searchParams.delete('idle');
      if (url.searchParams.has('slide')) url.searchParams.set('slide', String(current + 1));
      history.replaceState(null, '', url);
      announce(`${current + 1} of ${slides.length}: ${slides[current].dataset.title}`);
    }
    if (focusWasInSlide) $('presentation').focus({ preventScroll: true });
    updateMotion();
    // Hide the outgoing section immediately: only the incoming section fades,
    // so rapid navigation cannot leave ghosts or outgoing focusable controls.
    if (previous !== current && !motionPaused() && !matchMedia('print').matches) {
      slideFade = slides[current].animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 260,
        easing: 'ease-out'
      });
    }
  }

  function stepPresentation(direction) {
    if (slides[current].id === 'map-layout' && stations.length) {
      walkStations(direction);
      return;
    }
    goToSlide(current + direction, true, direction < 0 ? 'last' : 'first');
  }

  function walkStations(direction, allowExit = true) {
    if (!stations.length) return;
    const index = stations.findIndex((station) => station.id === selectedStation);
    const next = index + direction;
    if (next >= 0 && next < stations.length) {
      selectStation(stations[next].id);
    } else if (allowExit) {
      if ($('map-dialog').open) $('map-dialog').close();
      goToSlide(direction > 0 ? slideIndex('harness-demo') : slideIndex('map-layout') - 1);
    }
  }

  function updateNavigationControls() {
    const index = stations.findIndex((station) => station.id === selectedStation);
    const inLayout = slides[current].id === 'map-layout' && index !== -1;
    const previousSection = slides[slideIndex('map-layout') - 1].dataset.title;
    const previousLabel = index > 0 ? `Previous: ${stations[index - 1].label}` : `Back: ${previousSection}`;
    const nextLabel = index >= 0 && index < stations.length - 1 ? `Next: ${stations[index + 1].label}` : 'Next: Harness demo';
    $('previous-button').disabled = current === 0;
    $('next-button').disabled = current === slides.length - 1;
    for (const [id, label, key] of [
      ['previous-button', inLayout ? previousLabel : 'Previous section', 'Left arrow'],
      ['next-button', inLayout ? nextLabel : 'Next section', 'Right arrow']
    ]) {
      $(id).setAttribute('aria-label', label);
      $(id).title = `${label} (${key})`;
    }
    document.querySelectorAll('[data-station-progress]').forEach((node) => {
      node.textContent = index < 0 ? 'Loading stations…' : `Station ${index + 1}/${stations.length}`;
    });
    document.querySelectorAll('[data-station-step]').forEach((button) => {
      const previous = Number(button.dataset.stationStep) < 0;
      const boundary = previous ? index === 0 : index === stations.length - 1;
      const label = previous ? previousLabel : nextLabel;
      button.disabled = index < 0;
      button.textContent = button.closest('dialog') && boundary ? `Close map · ${label}` : label;
    });
  }

  function motionPaused() {
    return capture || manuallyPaused || reducedMotion.matches;
  }

  function updateMotion() {
    const paused = motionPaused();
    if (paused) {
      slideFade?.cancel();
      slideFade = null;
    }
    document.body.classList.toggle('motion-paused', paused);
    document.body.classList.toggle('static-sponsors', capture || reducedMotion.matches);
    document.body.classList.toggle('strip-running', !paused && current === 0 && !document.hidden && !document.querySelector('dialog[open]'));
    const button = $('motion-button');
    button.setAttribute('aria-pressed', String(paused));
    button.disabled = reducedMotion.matches || capture;
    button.querySelector('.motion-icon').textContent = paused ? '▷' : 'Ⅱ';
    button.lastElementChild.textContent = reducedMotion.matches ? 'Reduced motion' : paused ? 'Resume' : 'Pause';
    button.title = reducedMotion.matches ? 'Motion disabled by your system preference' : paused ? 'Resume sponsor strip' : 'Pause sponsor strip';
  }

  function setIdle(enabled, slide = 0, updateURL = true) {
    idleEnabled = enabled;
    document.body.classList.toggle('idle-mode', enabled);
    $('idle-button').setAttribute('aria-pressed', String(enabled));
    const motionButton = $('motion-button');
    if (enabled) $('idle-motion').append(motionButton);
    else $('idle-button').after(motionButton);
    goToSlide(enabled ? 0 : slide, updateURL);
    $('presentation').focus({ preventScroll: true });
    announce(enabled ? 'Idle screen. Click or press Right arrow to begin. Escape returns to Welcome.' : `${slides[current].dataset.title}. Presenter controls restored.`);
  }

  function toggleIdle() {
    setIdle(!idleEnabled);
  }

  function syncFromURL() {
    const requestedIdle = location.hash === '#idle' || new URLSearchParams(location.search).get('idle') === '1';
    if (requestedIdle || idleEnabled) setIdle(requestedIdle, slideFromURL(), false);
    else goToSlide(slideFromURL(), false);
  }

  function createLogo(sponsor, className, withName = true) {
    const surface = element('div', `${className} logo-surface`);
    surface.dataset.sponsor = sponsor.id;
    const image = element('img');
    image.src = sponsor.lightPng || sponsor.png || sponsor.logo;
    image.alt = withName ? '' : sponsor.name;
    image.draggable = false;
    image.addEventListener('error', () => {
      image.remove();
      if (!withName) surface.append(element('span', 'logo-fallback', sponsor.name));
    }, { once: true });
    surface.append(image);
    if (withName) surface.append(element('span', 'sponsor-name', sponsor.name));
    return surface;
  }

  function sponsorsFor(group) {
    const orderedIds = group === 'robots' ? ['markov', 'robocurve', 'pantheon', 'dimensional'] : null;
    const matches = sponsors.filter((sponsor) => sponsor.groups.includes(group));
    return orderedIds ? matches.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id)) : matches;
  }

  function renderSponsors() {
    const board = $('sponsor-board');
    board.replaceChildren();
    groups.forEach((group) => {
      const members = sponsorsFor(group.id);
      const section = element('section', 'sponsor-group');
      section.dataset.group = group.id;
      section.setAttribute('aria-label', group.label);
      const label = element('div', 'sponsor-group-label');
      label.textContent = group.label;
      const logos = element('div', 'sponsor-group-logos');
      members.forEach((sponsor) => logos.append(createLogo(sponsor, 'sponsor-logo')));
      section.append(label, logos);
      board.append(section);
    });
    const providers = $('robot-providers');
    providers.replaceChildren();
    sponsorsFor('robots').forEach((sponsor) => {
      const provider = element('article', 'robot-provider');
      provider.append(createLogo(sponsor, 'robot-provider-logo', false), element('h3', '', sponsor.name));
      providers.append(provider);
    });
    renderSponsorStrip();
  }

  function renderJudges(data) {
    $('judges-grid').replaceChildren(...data.organizations.map((organization) => {
      const card = element('article', 'judge-card');
      card.append(createLogo(organization, 'judge-logo', false));
      card.append(element('h3', '', organization.judges.map((judge) => judge.name).join(' · ')));
      card.append(element('p', '', organization.name));
      return card;
    }));
  }

  function renderSponsorStrip() {
    const roles = { partners: 'Partner', compute: 'Compute', robots: 'Robot provider', funding: 'Funding' };
    const track = element('div', 'sponsor-track');
    // Equal-width copies include their trailing gap, so -50% is one exact loop.
    for (let copy = 0; copy < 2; copy += 1) {
      const group = element('div', 'sponsor-strip-group');
      group.setAttribute('role', 'list');
      if (copy === 1) group.setAttribute('aria-hidden', 'true');
      sponsors.forEach((sponsor) => {
        const logo = createLogo(sponsor, 'welcome-logo', false);
        logo.setAttribute('role', 'listitem');
        logo.append(element('span', 'sponsor-role', sponsor.groups.map((role) => roles[role]).join(' · ')));
        group.append(logo);
      });
      track.append(group);
    }
    $('welcome-sponsor-logos').replaceChildren(track);
  }

  function stationProvider(station) {
    return sponsors.find((sponsor) => sponsor.id === station.providerId);
  }

  function selectStation(id) {
    const index = stations.findIndex((entry) => entry.id === id);
    const station = stations[index];
    if (!station) return;
    selectedStation = id;
    document.querySelectorAll('[data-station]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.station === id));
    });
    document.querySelectorAll('[data-footprint]').forEach((tile) => {
      tile.classList.toggle('is-active', tile.dataset.footprint === id);
    });
    const provider = stationProvider(station);
    const providerName = provider ? provider.name : 'Provider to be confirmed';
    const stationName = station.robotModel?.startsWith('Unitree ') ? station.robotModel : station.label;
    mapViews.forEach((view) => {
      const popup = $(view.popup);
      popup.hidden = !station.footprint;
      const heading = element('strong', 'station-popup-label', stationName);
      const affiliation = element('div', 'station-popup-provider');
      if (provider) affiliation.append(createLogo(provider, 'station-popup-logo', false));
      affiliation.append(element('span', '', providerName));
      const copy = element('div', 'station-popup-copy');
      copy.append(heading, affiliation);
      const model = station.robotModel?.startsWith('Pandroid') ? 'Pandroid' : station.robotModel;
      const illustrationFile = robotIllustrations[model];
      popup.classList.toggle('has-illustration', Boolean(illustrationFile));
      if (illustrationFile) {
        const illustration = element('img', 'station-popup-illustration');
        illustration.src = `assets/robot-illustrations/${illustrationFile}`;
        illustration.alt = '';
        popup.replaceChildren(illustration, copy);
      } else {
        popup.replaceChildren(copy);
      }
    });
    revealExpandedStation();
    positionStationPopups();
    updateNavigationControls();
    announce(`Station ${index + 1} of ${stations.length}: ${station.label}. ${providerName}.`);
  }

  function revealExpandedStation() {
    if (!$('map-dialog').open) return;
    const footprint = stations.find((entry) => entry.id === selectedStation)?.footprint;
    if (!footprint) return;
    const figure = $('expanded-map-figure');
    const viewport = figure.parentElement;
    const centerX = (footprint.x + footprint.width / 2) / 100 * figure.clientWidth;
    const centerY = (footprint.y + footprint.height / 2) / 100 * figure.clientHeight;
    viewport.scrollLeft = centerX - viewport.clientWidth * .3;
    viewport.scrollTop = centerY - viewport.clientHeight / 2;
  }

  function positionStationPopups() {
    const station = stations.find((entry) => entry.id === selectedStation);
    if (!station?.footprint) return;
    const footprint = station.footprint;
    mapViews.forEach((view) => {
      const figure = $(view.figure);
      const popup = $(view.popup);
      const width = figure.clientWidth;
      const height = figure.clientHeight;
      if (!width || !height) return;
      const expanded = view.figure === 'expanded-map-figure';
      const viewport = expanded ? figure.parentElement : null;
      const visibleWidth = viewport ? Math.min(width, viewport.clientWidth) : width;
      const visibleHeight = viewport ? Math.min(height, viewport.clientHeight) : height;
      const originX = viewport?.scrollLeft || 0;
      const originY = viewport?.scrollTop || 0;
      const gap = Math.max(8, visibleWidth * .018);
      const inset = Math.max(4, visibleWidth * .008);
      const right = (footprint.x + footprint.width) / 100 * width;
      const centerY = (footprint.y + footprint.height / 2) / 100 * height;
      // Keep the presentation-area pin clear on the overview; zoomed cards
      // stay inside the current scroll viewport.
      const rightLimit = expanded ? originX + visibleWidth : width * .75;
      const left = Math.max(originX + inset, Math.min(right + gap, rightLimit - popup.offsetWidth - inset));
      const top = Math.max(originY + inset, Math.min(centerY - popup.offsetHeight / 2, originY + visibleHeight - popup.offsetHeight - inset));
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.setProperty('--pointer-top', `${Math.max(8, Math.min(popup.offsetHeight - 8, centerY - top))}px`);
    });
  }

  function makeStationFootprint(station) {
    const footprint = station.footprint;
    const base = element('div', 'station-footprint');
    base.dataset.footprint = station.id;
    base.setAttribute('aria-hidden', 'true');
    base.style.left = `${footprint.x}%`;
    base.style.top = `${footprint.y}%`;
    base.style.width = `${footprint.width}%`;
    base.style.height = `${footprint.height}%`;
    const tile = element('div', 'station-tile');
    // Crop the authored rectangle, including its original label and logo.
    // Only this tile lifts; the architectural plan never transforms.
    tile.style.backgroundSize = `${10000 / footprint.width}% ${10000 / footprint.height}%`;
    tile.style.backgroundPosition = `${footprint.x / (100 - footprint.width) * 100}% ${footprint.y / (100 - footprint.height) * 100}%`;
    base.append(tile);
    return base;
  }

  function makeStationMarker(station, index) {
    const marker = element('button', 'map-marker', String(index + 1));
    marker.dataset.station = station.id;
    marker.setAttribute('aria-label', `${station.label}: view station details`);
    marker.setAttribute('aria-pressed', 'false');
    marker.title = station.label;
    marker.style.left = `${station.x}%`;
    marker.style.top = `${station.y}%`;
    marker.addEventListener('click', () => selectStation(station.id));
    return marker;
  }

  function renderStations() {
    $('map-markers').replaceChildren();
    $('expanded-map-markers').replaceChildren();
    mapViews.forEach((view) => $(view.highlights).replaceChildren());
    stations.forEach((station, index) => {
      if (Number.isFinite(station.x) && Number.isFinite(station.y)) {
        $('map-markers').append(makeStationMarker(station, index));
        $('expanded-map-markers').append(makeStationMarker(station, index));
      }
      if (station.footprint) {
        mapViews.forEach((view) => $(view.highlights).append(makeStationFootprint(station)));
      }
    });
    const initial = selectedStation || (layoutEntry === 'last' ? stations.at(-1)?.id : stations[0]?.id);
    if (initial) selectStation(initial);
  }

  function renderEventDetails(details) {
    if (details.slackUrl) {
      const link = element('a', 'slack-link');
      link.href = details.slackUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const qr = element('img', 'slack-qr');
      qr.src = 'assets/slack-qr.svg';
      qr.alt = 'Scan to join the event Slack';
      qr.width = 256;
      qr.height = 256;
      link.append(qr, element('span', 'slack-label', 'Join event Slack'));
      $('slack-join').replaceChildren(link);
      $('slack-join').hidden = false;
    }
  }

  function openDialog(id) {
    $(id).showModal();
    updateMotion();
    if (id === 'map-dialog') {
      revealExpandedStation();
      positionStationPopups();
    }
  }

  function updateMapZoom(value) {
    mapZoom = Math.max(1, Math.min(3, value));
    $('expanded-map-figure').style.width = `${mapZoom * 100}%`;
    $('map-zoom-out').disabled = mapZoom === 1;
    $('map-zoom-in').disabled = mapZoom === 3;
    revealExpandedStation();
    positionStationPopups();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else announce('Fullscreen is unavailable in this browser. Use your browser’s fullscreen command.');
    } catch {
      announce('Fullscreen was not permitted. Use your browser’s fullscreen command.');
    }
  }

  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => goToSlide(slideIndex(button.dataset.go)));
  });
  $('previous-button').addEventListener('click', () => stepPresentation(-1));
  $('next-button').addEventListener('click', () => stepPresentation(1));
  document.querySelectorAll('[data-station-step]').forEach((button) => {
    button.addEventListener('click', () => walkStations(Number(button.dataset.stationStep)));
  });
  const mapResizeObserver = new ResizeObserver(positionStationPopups);
  mapViews.forEach((view) => mapResizeObserver.observe($(view.figure)));
  document.querySelector('.expanded-map-scroll').addEventListener('scroll', positionStationPopups, { passive: true });
  window.addEventListener('beforeprint', () => slideFade?.cancel());
  $('idle-button').addEventListener('click', toggleIdle);
  $('motion-button').addEventListener('click', () => {
    manuallyPaused = !manuallyPaused;
    updateMotion();
  });
  $('fullscreen-button').addEventListener('click', toggleFullscreen);
  $('help-button').addEventListener('click', () => openDialog('help-dialog'));
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('expand-map').addEventListener('click', () => {
    updateMapZoom(1);
    openDialog('map-dialog');
  });
  $('map-zoom-in').addEventListener('click', () => updateMapZoom(mapZoom + 0.5));
  $('map-zoom-out').addEventListener('click', () => updateMapZoom(mapZoom - 0.5));
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('close', updateMotion);
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  });
  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    $('fullscreen-button').setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    $('fullscreen-button').setAttribute('aria-pressed', String(active));
  });
  document.addEventListener('visibilitychange', updateMotion);
  reducedMotion.addEventListener('change', updateMotion);
  window.addEventListener('hashchange', syncFromURL);
  document.addEventListener('click', (event) => {
    if (!idleEnabled || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (event.target.closest('button, a, input, textarea, select, [contenteditable], [role="button"], dialog')) return;
    setIdle(false, 1);
  });
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
    const key = event.key.toLowerCase();
    if (key === ' ' && event.target.closest('button, a, [role="button"]')) return;
    const dialog = document.querySelector('dialog[open]');
    if (dialog) {
      if (dialog.id !== 'map-dialog') return;
      if (key === 'arrowright' || key === 'pagedown' || key === ' ') {
        event.preventDefault();
        walkStations(1, false);
      } else if (key === 'arrowleft' || key === 'pageup') {
        event.preventDefault();
        walkStations(-1, false);
      }
      return;
    }
    if (key === 'escape' && idleEnabled) {
      event.preventDefault();
      setIdle(false);
    } else if (key === 'arrowright' || key === ' ' || key === 'pagedown') {
      event.preventDefault();
      stepPresentation(1);
    } else if (key === 'arrowleft' || key === 'pageup') {
      event.preventDefault();
      stepPresentation(-1);
    } else if (key === 'home' || key === 'h') {
      event.preventDefault();
      if (idleEnabled) setIdle(false);
      else goToSlide(0);
    } else if (key === 'i') {
      event.preventDefault();
      toggleIdle();
    } else if (key === 'f') {
      event.preventDefault();
      toggleFullscreen();
    } else if (key === '?') {
      event.preventDefault();
      openDialog('help-dialog');
    }
  });

  async function loadJSON(path, expectArray = true) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const data = await response.json();
    if (expectArray && !Array.isArray(data)) throw new Error(`${path}: expected an array`);
    return data;
  }

  async function loadAssets() {
    const results = await Promise.allSettled([
      loadJSON('assets/sponsors.json'),
      loadJSON('assets/stations.json'),
      loadJSON('assets/event-details.json', false),
      loadJSON('assets/judges.json', false)
    ]);
    if (results[0].status === 'fulfilled') {
      sponsors = results[0].value;
      renderSponsors();
    } else {
      console.error('Sponsor assets could not be loaded:', results[0].reason);
      $('sponsor-board').append(element('p', 'asset-error', 'Sponsor assets could not be loaded. Please reload the page.'));
      $('welcome-sponsor-logos').append(element('span', 'asset-error', 'Sponsor assets unavailable'));
    }
    if (results[1].status === 'fulfilled') {
      stations = results[1].value;
      renderStations();
    } else {
      console.error('Station data could not be loaded:', results[1].reason);
      $('map-layout').append(element('p', 'asset-error', 'Station details could not be loaded. Ask the event team for orientation.'));
    }
    if (results[2].status === 'fulfilled') {
      renderEventDetails(results[2].value);
    } else {
      console.error('Event details could not be loaded:', results[2].reason);
    }
    if (results[3].status === 'fulfilled') {
      renderJudges(results[3].value);
    } else {
      console.error('Judge roster could not be loaded:', results[3].reason);
      $('judges-grid').append(element('p', 'asset-error', 'The confirmed judge roster could not be loaded.'));
    }
    await Promise.all([document.fonts.ready, ...Array.from(document.images, (image) => image.decode().catch(() => {}))]);
    document.body.dataset.ready = results.every((result) => result.status === 'fulfilled') ? 'true' : 'error';
    return { sponsors: results[0].status, stations: results[1].status, eventDetails: results[2].status, judges: results[3].status };
  }

  updateMotion();
  syncFromURL();
  window.presentation = Object.freeze({
    goTo: (oneBasedSlide) => goToSlide(oneBasedSlide - 1),
    get currentSlide() { return current + 1; }
  });
  window.presentationReady = loadAssets();
})();
