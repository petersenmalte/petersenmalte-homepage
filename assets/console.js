(function () {
  'use strict';

  var STATE_KEY = 'petersenmalte-console-navigation-state';
  var pages = ['index.html', 'education.html', 'work.html', 'writing.html', '404.html'];
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

    function open() {
      panel.hidden = false;
      tab.hidden = true;
      if (!log.children.length) {
        printLine('/\n├── index.html\n├── education.html\n├── work.html\n├── writing.html\n└── 404.html');
        printLine("Type 'help' for commands.");
      }
      input.focus();
    }

    function close() {
      panel.hidden = true;
      tab.hidden = false;
    }

    function restoreNavigationState() {
      var raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) return;
      sessionStorage.removeItem(STATE_KEY);
      try {
        var state = JSON.parse(raw);
        if (typeof state.log === 'string') log.innerHTML = state.log;
        if (state.open) open(); else close();
      } catch (_) {
        sessionStorage.removeItem(STATE_KEY);
      }
    }

    function saveNavigationState() {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ open: !panel.hidden, log: log.innerHTML }));
    }

    function tryOpen(target) {
      var normalized = target.replace(/^\.\//, '');
      if (normalized === 'index') normalized = 'index.html';
      if (pages.indexOf(normalized) === -1) {
        printLine('No such page: ' + target);
        return;
      }
      saveNavigationState();
      window.location.assign(normalized);
    }

    function reason(error) {
      return error && error.message ? error.message : String(error || 'request failed');
    }

    function sendWhatsApp(message) {
      if (!placeholder(CALLMEBOT_PHONE) && !placeholder(CALLMEBOT_APIKEY)) {
        var text = 'Website message from ' + message.name + ' (' + message.email + '): ' + message.message;
        var url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(CALLMEBOT_PHONE) +
          '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(CALLMEBOT_APIKEY);
        return fetch(url).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          printLine('WhatsApp: sent');
        }).catch(function (error) { printLine('WhatsApp: failed — ' + reason(error)); });
      }
      return Promise.resolve();
    }

    function startMailWizard() {
      wizard = { step: 0, data: {} };
      printLine('Your name (or cancel):');
    }

    function continueMailWizard(value) {
      if (value.toLowerCase() === 'cancel') {
        wizard = null;
        printLine('Mail cancelled.');
        return;
      }
      if (wizard.step === 0) {
        wizard.data.name = value;
        wizard.step = 1;
        printLine('Your email (or cancel):');
      } else if (wizard.step === 1) {
        wizard.data.email = value;
        wizard.step = 2;
        printLine('Your message (or cancel):');
      } else {
        wizard.data.message = value;
        var message = wizard.data;
        wizard = null;
        sendWhatsApp(message);
      }
    }

    var commands = {
      help: 'Available commands: help, whoami, ls, cat <page>, open <page>, mail, clear',
      whoami: 'malte — mathematician (M.Sc. Bonn) & backend engineer. More soon.',
      ls: pages.join('  ') + '  robots.txt',
      'sudo hire --me': '[sudo] password for malte: ...not required, just send a message.'
    };
    var commandNames = Object.keys(commands).concat(['cat', 'open', 'mail', 'clear']);

    function execute(raw) {
      if (wizard) return continueMailWizard(raw);
      if (raw === 'clear') { log.innerHTML = ''; return; }
      if (raw === 'mail') { startMailWizard(); return; }
      var match = /^(cat|open)\s+(.+)$/i.exec(raw);
      if (match) { tryOpen(match[2].trim()); return; }
      var reply = commands[raw.toLowerCase()];
      printLine(reply || ('Command not found: ' + raw + " — try 'help'"));
    }

    tab.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    input.addEventListener('keydown', function (event) {
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
        var matches = commandNames.filter(function (command) { return command.indexOf(value) === 0; });
        if (matches.length === 1) input.value = matches[0];
        else if (matches.length > 1) printLine(matches.join('   '));
      }
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var raw = input.value.trim();
      if (!raw) return;
      printLine(raw, true);
      history.push(raw);
      historyIndex = history.length;
      draft = '';
      execute(raw);
      input.value = '';
    });
    restoreNavigationState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
