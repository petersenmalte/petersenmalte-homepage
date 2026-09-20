(function () {
  'use strict';

  var STATE_KEY = 'petersenmalte-console-navigation-state';
  var pages = ['index.html', 'education.html', 'work.html', 'writing.html', 'falk.html', '404.html'];
  var config = window.__CONSOLE_CONFIG__ || {};
  var CALLMEBOT_PHONE = config.callmebotPhone || '4915731310946';
  var CALLMEBOT_APIKEY = config.callmebotApiKey || '7598885';
  var wizard = null;

  function addTerminal() {
    var fragment = document.createElement('div');
    fragment.innerHTML =
      '<button id="console-tab" type="button" aria-label="Open terminal">~$</button>' +
      '<div id="console-panel" hidden>' +
        '<button id="console-close" type="button" aria-label="Close terminal">&times;</button>' +
        '<div id="console-log" aria-live="polite"></div>' +
        '<form id="console-form"><span>~$</span>' +
          '<input id="console-input" type="text" autocomplete="off" spellcheck="false" aria-label="Enter command">' +
        '</form>' +
      '</div>';
    document.body.appendChild(fragment);
  }

  function placeholder(value) {
    return !value || /^YOUR_/.test(value);
  }

  function boot() {
    addTerminal();
    var tab = document.getElementById('console-tab');
    var panel = document.getElementById('console-panel');
    var closeButton = document.getElementById('console-close');
    var log = document.getElementById('console-log');
    var form = document.getElementById('console-form');
    var input = document.getElementById('console-input');
    var history = [];
    var historyIndex = 0;
    var draft = '';

    function printLine(text, isCommand) {
      var line = document.createElement('div');
      if (isCommand) line.className = 'cmd';
      line.textContent = text;
      line.style.marginBottom = '8px';
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    function showHome() {
      log.replaceChildren();
      printLine('/\n' + pages.map(function (page, index) {
        return (index === pages.length - 1 ? '└── ' : '├── ') + page;
      }).join('\n'));
      printLine("Type 'help' for commands.");
    }

    function open() {
      panel.hidden = false;
      tab.hidden = true;
      if (!log.children.length) showHome();
      input.focus();
      saveNavigationState();
    }

    function close() {
      panel.hidden = true;
      tab.hidden = false;
      saveNavigationState();
    }

    function restoreNavigationState() {
      try {
        var raw = sessionStorage.getItem(STATE_KEY);
        if (!raw) return;
        var state = JSON.parse(raw);
        // Read old snapshots as inert text; never inject storage as live HTML.
        var lines = state.lines;
        if (!Array.isArray(lines) && typeof state.log === 'string') {
          var legacy = new DOMParser().parseFromString(state.log, 'text/html');
          lines = Array.from(legacy.body.children).map(function (line) {
            return { text: line.textContent, command: line.classList.contains('cmd') };
          });
        }
        log.replaceChildren();
        (lines || []).forEach(function (line) {
          if (typeof line.text === 'string') printLine(line.text, line.command === true);
        });
        history = Array.isArray(state.history) ? state.history.filter(function (entry) {
          return typeof entry === 'string';
        }) : [];
        historyIndex = Number.isInteger(state.historyIndex) ? Math.max(0, Math.min(history.length, state.historyIndex)) : history.length;
        draft = typeof state.draft === 'string' ? state.draft : '';
        input.value = typeof state.input === 'string' ? state.input : '';
        wizard = state.wizard && [0, 1, 2].indexOf(state.wizard.step) !== -1 && state.wizard.data ? state.wizard : null;
        panel.hidden = !state.open;
        tab.hidden = !!state.open;
        if (state.open) {
          if (!log.children.length) showHome();
          input.focus();
        }
        log.scrollTop = typeof state.scrollTop === 'number' ? state.scrollTop : log.scrollHeight;
      } catch (_) {
        // Storage can be unavailable; the terminal still works in this page.
      }
    }

    function saveNavigationState() {
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify({
          open: !panel.hidden,
          lines: Array.from(log.children).map(function (line) {
            return { text: line.textContent, command: line.classList.contains('cmd') };
          }),
          history: history, historyIndex: historyIndex, draft: draft,
          input: input.value, wizard: wizard, scrollTop: log.scrollTop
        }));
      } catch (_) {
        // Keep navigation usable even when storage is disabled or full.
      }
    }

    function tryOpen(target) {
      var normalized = target.toLowerCase().replace(/^(\.\/|\/)/, '');
      if (!normalized) normalized = 'index.html';
      if (normalized.indexOf('.') === -1) normalized += '.html';
      if (pages.indexOf(normalized) === -1) {
        printLine('No such page: ' + target);
        return;
      }
      saveNavigationState();
      window.location.assign(normalized);
    }

    function sendMessage(message) {
      if (!placeholder(CALLMEBOT_PHONE) && !placeholder(CALLMEBOT_APIKEY)) {
        var text = 'Website message from ' + message.name + '\n' +
          (message.email ? 'Reply to: ' + message.email + '\n' : '') + '\n' + message.message;
        var url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(CALLMEBOT_PHONE) +
          '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY);
        // This endpoint does not provide CORS response access. An opaque response
        // confirms the request completed, not that the recipient received it.
        // Never retry automatically: a retry could deliver the message twice.
        return fetch(url, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', keepalive: true })
          .then(function (response) {
            if (response.type !== 'opaque' && !response.ok) throw new Error('Request rejected');
            printLine('sent message.');
            saveNavigationState();
          }).catch(function () {
            printLine('Could not send message. Please check your connection.');
            saveNavigationState();
          });
      }
      printLine('Message sending is not configured yet.');
      return Promise.resolve();
    }

    function startMailWizard() {
      wizard = { step: 0, data: {} };
      printLine('Your name (or cancel):');
    }

    function continueMailWizard(value) {
      if (value.toLowerCase() === 'cancel') {
        wizard = null;
        printLine('Message cancelled.');
        return;
      }
      if (wizard.step === 0) {
        if (!value) { printLine('Please enter your name (or cancel):'); return; }
        wizard.data.name = value;
        wizard.step = 1;
        printLine('Your email (optional, for a reply — Enter to skip, or cancel):');
      } else if (wizard.step === 1) {
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          printLine('Please enter a valid email, or press Enter to skip:');
          return;
        }
        wizard.data.email = value;
        wizard.step = 2;
        printLine('Your message (or cancel):');
      } else {
        if (!value) { printLine('Please enter your message (or cancel):'); return; }
        wizard.data.message = value;
        var message = wizard.data;
        wizard = null;
        sendMessage(message);
      }
    }

    var commands = {
      help: 'Available commands: help, whoami, ls, cat <page>, open <page>, mail, clear',
      whoami: 'malte — mathematician (M.Sc. Bonn) & backend engineer. More soon.',
      ls: pages.join('  '),
      'sudo hire --me': '[sudo] password for malte: ...not required, just send a message.'
    };
    var commandNames = Object.keys(commands).concat(['cat', 'open', 'mail', 'clear']);

    function execute(raw) {
      if (wizard) return continueMailWizard(raw);
      if (raw.toLowerCase() === 'clear') { showHome(); return; }
      if (raw.toLowerCase() === 'mail') { startMailWizard(); return; }
      var match = /^(cat|open)\s+(.+)$/i.exec(raw);
      if (match) { tryOpen(match[2].trim()); return; }
      var reply = commands[raw.toLowerCase()];
      printLine(reply || ('Command not found: ' + raw + " — try 'help'"));
    }

    tab.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    window.addEventListener('pagehide', saveNavigationState);
    window.addEventListener('pageshow', function (event) {
      if (event.persisted) restoreNavigationState();
    });
    input.addEventListener('input', saveNavigationState);
    input.addEventListener('keydown', function (event) {
      if (wizard) {
        if (event.key === 'Tab') event.preventDefault();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (!history.length) return;
        if (historyIndex === history.length) draft = input.value;
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex];
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (historyIndex >= history.length) return;
        historyIndex++;
        input.value = historyIndex === history.length ? draft : history[historyIndex];
      } else if (event.key === 'Tab') {
        event.preventDefault();
        var value = input.value.toLowerCase();
        if (!value) return;
        var fileCommand = /^(cat|open)\s+(.*)$/i.exec(input.value);
        var prefix = fileCommand ? fileCommand[2].replace(/^(\.\/|\/)/, '').toLowerCase() : value;
        var pathPrefix = fileCommand ? (fileCommand[2].match(/^(\.\/|\/)/) || [''])[0] : '';
        var matches = (fileCommand ? pages : commandNames).filter(function (entry) {
          return entry.indexOf(prefix) === 0;
        });
        if (matches.length === 1) input.value = fileCommand ? fileCommand[1] + ' ' + pathPrefix + matches[0] : matches[0];
        else if (matches.length > 1) printLine(matches.join('   '));
      }
      if (['ArrowUp', 'ArrowDown', 'Tab'].indexOf(event.key) !== -1) {
        input.setSelectionRange(input.value.length, input.value.length);
        saveNavigationState();
      }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var raw = input.value.trim();
      if (!raw && !wizard) return;
      printLine(raw || '(skipped)', true);
      if (!wizard) {
        history.push(raw);
        historyIndex = history.length;
        draft = '';
      }
      input.value = '';
      execute(raw);
      saveNavigationState();
    });
    restoreNavigationState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
